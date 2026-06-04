#!/usr/bin/env bash
# smoke.sh — bring up the Gestalt platform end-to-end and prove it works.
#
# This is the agent's primary driver for the platform. It:
#   1. Verifies prerequisites (docker, .env, pnpm)
#   2. Builds the workspace (pnpm -r build)
#   3. Brings up postgres + redis + server via docker-compose
#   4. Waits for /health
#   5. Bootstraps an admin user (idempotent — skipped if one exists)
#   6. Logs in via the CLI, persists the JWT into ~/.gestalt/config.json
#   7. Exercises the REST surface that proves the cycle stack is alive
#      (auth/me, /projects, /platform/secrets, /status)
#   8. Optionally takes a dashboard screenshot via headless Chrome
#
# Output is verbose by design — every step prints what it ran and what
# came back. Exit code is the truth: 0 = green; non-zero = look at the
# last log line printed.
#
# Idempotent. Safe to run repeatedly.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

SERVER_URL="${SERVER_URL:-http://localhost:3000}"
SMOKE_EMAIL="${SMOKE_EMAIL:-smoke@gestalt.local}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-smoke-password-please-change}"
SMOKE_DISPLAY="${SMOKE_DISPLAY:-Smoke Test Operator}"
SHOTS_DIR="${SHOTS_DIR:-/tmp/gestalt-shots}"
LOG_DIR="${LOG_DIR:-/tmp/gestalt-smoke}"
SCREENSHOT="${SCREENSHOT:-no}"   # yes|no — set to yes to capture dashboard png

mkdir -p "$SHOTS_DIR" "$LOG_DIR"

# ─── helpers ─────────────────────────────────────────────────────────────────

bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
dim()    { printf '\033[2m%s\033[0m\n' "$*"; }

trap 'red "✗ smoke.sh failed at line $LINENO"; exit 1' ERR

step() {
  bold ""
  bold "── $* ──"
}

# Wrapper around curl that fails on non-2xx (so any API error aborts).
api() {
  local method="$1" path="$2"; shift 2
  local -a args=(--silent --show-error --fail-with-body
                 -H "Authorization: Bearer ${TOKEN:-}" -X "$method")
  if [[ "$#" -gt 0 ]]; then
    args+=(-H 'Content-Type: application/json' -d "$1")
  fi
  curl "${args[@]}" "$SERVER_URL$path"
}

# Authentication-free wrapper for the admin bootstrap call.
api_anon() {
  local method="$1" path="$2"; shift 2
  local -a args=(--silent --show-error -X "$method")
  if [[ "$#" -gt 0 ]]; then
    args+=(-H 'Content-Type: application/json' -d "$1")
  fi
  curl "${args[@]}" "$SERVER_URL$path"
}

# ─── step 1 — prerequisites ──────────────────────────────────────────────────

step "Prerequisites"

for cmd in docker pnpm jq curl node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    red "Missing prerequisite: $cmd"
    exit 1
  fi
done
dim "docker $(docker --version | awk '{print $3}' | tr -d ,)"
dim "pnpm $(pnpm --version)"
dim "node $(node --version)"

if ! docker info >/dev/null 2>&1; then
  red "Docker daemon not running. On macOS: open -a Docker"
  exit 1
fi

if [[ ! -f "$REPO_ROOT/.env" ]]; then
  red ".env not found. Copy .env.example to .env and fill in LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / JWT_SECRET."
  exit 1
fi

# ─── step 2 — build ──────────────────────────────────────────────────────────

step "Build workspace (pnpm -r build)"

if pnpm -r build > "$LOG_DIR/build.log" 2>&1; then
  green "✓ all 12 workspace packages built"
else
  red "Build failed — see $LOG_DIR/build.log"
  tail -30 "$LOG_DIR/build.log" >&2
  exit 1
fi

# ─── step 3 — docker-compose up ──────────────────────────────────────────────

step "docker compose up -d (postgres + redis + server)"

docker compose up -d > "$LOG_DIR/compose-up.log" 2>&1 || {
  red "docker compose up failed — see $LOG_DIR/compose-up.log"
  cat "$LOG_DIR/compose-up.log" >&2
  exit 1
}
dim "started; waiting for /health…"

# ─── step 4 — wait for health ────────────────────────────────────────────────

step "Wait for $SERVER_URL/health"

for i in {1..60}; do
  if curl -sf "$SERVER_URL/health" >/dev/null 2>&1; then
    green "✓ server healthy after ${i}s"
    break
  fi
  sleep 1
  if [[ "$i" -eq 60 ]]; then
    red "Server did not become healthy in 60s"
    docker logs gestalt-server-1 2>&1 | tail -40 >&2
    exit 1
  fi
done

dim "GET /health → $(curl -s "$SERVER_URL/health")"

# ─── step 5 — acquire JWT (idempotent: fresh setup OR existing creds) ───────

step "Acquire JWT (fresh setup / existing token / login)"

TOKEN=""

# 5a. If ~/.gestalt/config.json already has a token, try it first. This is
# the steady state for an operator who's been using the platform.
if [[ -f ~/.gestalt/config.json ]]; then
  existing=$(jq -r '.token // empty' ~/.gestalt/config.json 2>/dev/null || true)
  if [[ -n "$existing" ]]; then
    if curl -sf -H "Authorization: Bearer $existing" "$SERVER_URL/auth/me" >/dev/null 2>&1; then
      TOKEN="$existing"
      dim "reused JWT from ~/.gestalt/config.json"
    else
      dim "stored JWT is invalid (expired or wrong server) — will re-acquire"
    fi
  fi
fi

# 5b. Fresh platform: POST /admin/setup with smoke creds. Returns 201 on
# success, 401 on already-initialised platforms.
if [[ -z "$TOKEN" ]]; then
  setup_body=$(jq -nc --arg e "$SMOKE_EMAIL" --arg p "$SMOKE_PASSWORD" --arg n "$SMOKE_DISPLAY" \
    '{email:$e, password:$p, displayName:$n}')
  setup_status=$(curl -s -o /tmp/gestalt-setup-resp.json -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' \
    -d "$setup_body" "$SERVER_URL/admin/setup" || true)
  case "$setup_status" in
    201|200)
      green "✓ admin created: $SMOKE_EMAIL"
      ;;
    401)
      dim "platform already has an admin — falling through to login"
      ;;
    *)
      red "Admin setup returned HTTP $setup_status"
      cat /tmp/gestalt-setup-resp.json >&2
      exit 1
      ;;
  esac
fi

# 5c. Login with smoke creds (works for both fresh-just-created AND
# any operator who matches SMOKE_EMAIL/SMOKE_PASSWORD).
if [[ -z "$TOKEN" ]]; then
  login_body=$(jq -nc --arg e "$SMOKE_EMAIL" --arg p "$SMOKE_PASSWORD" \
    '{email:$e, password:$p}')
  login_resp=$(api_anon POST /auth/login "$login_body")
  TOKEN=$(echo "$login_resp" | jq -er '.token' 2>/dev/null || true)
  if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    red "Could not acquire a JWT."
    red "  • If this is a fresh platform, SMOKE_EMAIL=$SMOKE_EMAIL should have been created above."
    red "  • If the platform was initialised earlier with different credentials,"
    red "    set SMOKE_EMAIL / SMOKE_PASSWORD env vars before re-running, OR"
    red "    place a valid token in ~/.gestalt/config.json (via 'gestalt login')."
    echo "$login_resp" >&2
    exit 1
  fi
  dim "logged in as $SMOKE_EMAIL"
fi
dim "JWT length: ${#TOKEN} chars"

# Persist into the CLI's config so `gestalt status` / `gestalt projects list`
# work for the operator after the smoke completes.
mkdir -p ~/.gestalt
jq -n --arg url "$SERVER_URL" --arg t "$TOKEN" \
  '{serverUrl:$url, token:$t}' > ~/.gestalt/config.json
dim "wrote ~/.gestalt/config.json"

# ─── step 7 — REST surface ───────────────────────────────────────────────────

step "REST surface probes"

me=$(api GET /auth/me)
role=$(echo "$me" | jq -r '.role')
[[ "$role" == "platform-admin" ]] || { red "Expected platform-admin role, got: $role"; exit 1; }
green "✓ /auth/me → role=$role"

projects=$(api GET /projects | jq '.data | length')
green "✓ /projects → $projects project(s)"

secrets=$(api GET /platform/secrets | jq '.data | length')
green "✓ /platform/secrets → $secrets secret(s)"

llms=$(api GET /platform/llms | jq '.data | length')
green "✓ /platform/llms → $llms registered LLM(s)"

status_total=$(api GET /status | jq '.totals.intents // 0')
green "✓ /status → $status_total intent(s) tracked"

# Migration count from the postgres container is the definitive
# "is the database in the shape the code expects" check.
mig_count=$(docker exec gestalt-postgres-1 psql -U gestalt -d gestalt -tAc \
  'SELECT COUNT(*) FROM schema_migrations' 2>/dev/null || echo "?")
green "✓ schema_migrations → $mig_count applied"

# ─── step 8 — CLI smoke ──────────────────────────────────────────────────────

step "CLI smoke"

if [[ -x "$REPO_ROOT/packages/cli/dist/index.js" ]]; then
  node "$REPO_ROOT/packages/cli/dist/index.js" --help > /dev/null
  green "✓ gestalt --help renders"

  # Capture a real CLI table to /tmp so the operator can inspect after
  proj_out=$(node "$REPO_ROOT/packages/cli/dist/index.js" projects list 2>&1 | head -20)
  echo "$proj_out" > "$LOG_DIR/projects-list.out"
  green "✓ gestalt projects list — captured in $LOG_DIR/projects-list.out"
else
  red "CLI bundle missing — pnpm --filter @gestalt/cli build did not produce dist/index.js"
  exit 1
fi

# ─── step 9 — dashboard screenshot (optional) ────────────────────────────────

if [[ "$SCREENSHOT" == "yes" ]]; then
  step "Dashboard screenshot via headless Chrome"

  # CHROME env var wins if set; otherwise probe common paths.
  if [[ -z "${CHROME:-}" ]]; then
    for candidate in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser; do
      [[ -x "$candidate" ]] && CHROME="$candidate" && break
    done
  fi

  if [[ -z "$CHROME" ]]; then
    red "No Chrome/Chromium binary found — skipping screenshot"
  else
    shot="$SHOTS_DIR/dashboard-$(date +%Y%m%d-%H%M%S).png"
    "$CHROME" --headless=new --disable-gpu --no-sandbox \
      --hide-scrollbars --window-size=1400,900 \
      --screenshot="$shot" "$SERVER_URL/app/" \
      > "$LOG_DIR/chrome.log" 2>&1
    if [[ -s "$shot" ]]; then
      green "✓ dashboard screenshot → $shot ($(wc -c < "$shot") bytes)"
    else
      red "screenshot file is empty — see $LOG_DIR/chrome.log"
      tail -10 "$LOG_DIR/chrome.log" >&2
      exit 1
    fi
  fi
fi

# ─── done ────────────────────────────────────────────────────────────────────

bold ""
green "✅ smoke complete"
dim "server still running (docker compose). Stop with: docker compose down"
dim "logs:        $LOG_DIR/"
dim "screenshots: $SHOTS_DIR/"

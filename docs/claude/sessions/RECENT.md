# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-06 — Claude Code (TEST_REPORT_016: switch gate agents to gpt-4o — first clean deploy since TR_007. Single round, zero signals, ~$0.046. constraint-agent override silently ignored (uses hardcoded config) — new HIGHEST follow-up.)

Two-part fix session against TR_015's HIGHEST follow-up. The
user's brief: switch constraint-agent + review-agent to gpt-4o
via trackeros `agents.yaml`; set the platform `PER_ROLE_DEFAULTS`
review-agent temperature 0.1 → 0.0 (constraint-agent was already
0.0). No more platform code than that.

Outcome: **gate passed, cycle deployed cleanly on the first
round — first end-to-end deploy on this intent shape since
TEST_REPORT_007.** Zero signals emitted by either gate agent.
`gestalt status` shows `deployed`. Single attempt, no retries,
no self-healing, no alerts. Cost ~$0.046 USD — LOWER than
TR_015's $0.087 despite using the more expensive gpt-4o
model — because the cycle converged in one round instead of
looping eight times. Surprise discovery: **constraint-agent
silently ignores `agents.yaml` overrides** — it uses a
module-level hardcoded `AGENT_CONFIG` constant in
`packages/agents/quality-gate/src/agents/constraint-agent.ts:64`
and never calls `loadAgentConfig`. constraint-agent therefore
ran on gpt-4o-mini for this cycle. **Review-agent on gpt-4o
plus the TR_015 rule clarifications + Aider's clean code was
sufficient.** Promoted as the new HIGHEST follow-up.

What the user asked for:

- **Fix 1** — trackeros `agents.yaml`: constraint-agent +
  review-agent llm.model = gpt-4o, temperature: 0.0. Push.
- **Fix 2** — Platform `PER_ROLE_DEFAULTS`: confirm /set
  temperature 0.0 for the gate agents.
- Verify with the same Leave-service intent. Check
  model_used on both gate agents; zero pool.query
  signals; gate-pass round 1; document cost.

What changed:

- **trackeros `agents.yaml`** (commit `9830241` on
  trackeros `main`): new `constraint-agent` block
  declared with `model: gpt-4o`, `temperature: 0.0`,
  `max_tokens: 2000`, tools `[executeScript, readFile,
  searchFiles]`. Existing `review-agent` block updated
  to `model: gpt-4o`, `temperature: 0.0` (was `model: ~`,
  `temperature: 0.1`). Both blocks carry the same TR_016
  doc-comment explaining the per-agent model split
  rationale (gate's instruction-following bar is higher
  than code-agent's creative-completion bar; Aider stays
  on gpt-4o-mini).
- **`packages/core/src/agents/agent-config-loader.ts`**:
  `PER_ROLE_DEFAULTS['review-agent'].llm.temperature`
  `0.1` → `0.0` with TR_016-rationale comment.
  constraint-agent was already 0.0 since TEST_REPORT_005's
  executeScript evolution.

Live verification (correlation
`490183e7-41c7-46c1-9122-a42285151c61`, intent_id
`e0cd3a96-…`):

| Agent | Status | Tokens | Duration | Model |
|---|---|---|---|---|
| intent-agent | completed | 1,350 | 7.4s | gpt-4o-mini |
| design-agent | completed | 941 | 5.3s | gpt-4o-mini |
| context-agent | completed | 2,527 | 11.5s | gpt-4o-mini |
| code-agent (Aider) | completed | 0 | 9.1s | gpt-4o-mini |
| test-agent | skipped | 0 | 0 | n/a |
| **constraint-agent** | **completed (0 violations)** | **56,791** | **22.4s** | **gpt-4o-mini ⚠** |
| **review-agent** | **completed (0 findings)** | **14,566** | **4.5s** | **gpt-4o ✓** |
| pr-agent | completed | 0 | 11.8s | n/a |
| pipeline-agent | completed | 0 | 8.9s | n/a |
| promotion-agent (staging) | completed | 0 | 8.4s | n/a |
| promotion-agent (production) | completed | 0 | 8.5s | n/a |

Verification matrix vs brief:

| Check | Result |
|---|---|
| `constraint-agent.model_used = 'gpt-4o'` | **✗** still `gpt-4o-mini` — agents.yaml override silently ignored (constraint-agent uses hardcoded AGENT_CONFIG; never calls loadAgentConfig). |
| `review-agent.model_used = 'gpt-4o'` | **✓** verified via `agent_execution_logs.model_used`. |
| Zero signals on `leave.repository.ts` pool.query() | **✓** zero signals total. |
| Zero signals on `leave.service.ts` repository delegation | **✓** zero signals total. |
| Gate verdict pass round 1 | **✓** single attempt; deployed. |
| Cost slightly higher than TR_015 (gpt-4o gate pricing) | **Actually LOWER** — ~$0.046 vs $0.087 (single round wins over 8 mini-rounds). |

What worked:

- **Cycle deployed cleanly.** First `Status: ✓ deployed`
  on this intent shape since TEST_REPORT_007. `gestalt
  status --id e0cd3a96-…` shows `deployed`. Branch
  `gestalt/490183e7-create-srcmodulesleaveleaveservicets-imp`
  exists; PR #4236 via noop adapter.
- **review-agent on gpt-4o emitted zero findings.** Same
  review-agent that produced 4–13 false-positive findings
  every round across TR_011 through TR_015 emitted ZERO on
  the gpt-4o upgrade. 4.5s wall-clock.
- **constraint-agent on gpt-4o-mini still emitted zero
  violations.** The TR_015 rule clarifications + the
  TR_013 evidence requirement + temperature 0.0 +
  Aider's clean code combined was enough. Returned
  `{"violations": [], "summary": "0 violations"}` cleanly
  on first attempt.
- **Per-agent model routing works end-to-end.** trackeros's
  agents.yaml `review-agent.llm.model: gpt-4o` was honoured
  via `loadAgentConfig` → `getLLMClientForModel('gpt-4o')`
  → the platform LLM registry resolver missed (no gpt-4o
  row registered) → fell through to `getLLMClient('gpt-4o')`
  which created a client with the env-default OPENAI key +
  base URL and the model name overridden. The wire log
  confirms `gpt-4o` reached OpenAI.
- **temperature 0.0 reached the wire.** review-agent's
  LLM-call log shows `temperature: 0` (down from TR_015's
  implicit 0.1 default).
- **Cost-per-cycle dropped.** TR_015 was 8 rounds × ~$0.011
  per round (mostly review-agent at gpt-4o-mini). TR_016
  was 1 round × ~$0.046 (review-agent at gpt-4o, ~$0.036
  of total). Net: $0.046 < $0.087.

What didn't work:

- **constraint-agent override silently ignored.**
  `packages/agents/quality-gate/src/agents/constraint-
  agent.ts:64` declares a module-level `AGENT_CONFIG`
  constant and uses it verbatim in `verify()`; there is
  no `loadAgentConfig` call. Compare to
  `llm-review-agent.ts:108` which DOES call
  `loadAgentConfig(task.harnessConfig.projectRoot,
  'review-agent')`. Operators tuning constraint-agent's
  model/temperature/maxTokens via agents.yaml get no
  signal that the override didn't land. The cycle
  passed despite this — but the next intent on a
  different shape may need the gpt-4o behaviour.
  Promoted to HIGHEST follow-up.
- **trackeros `agents.yaml` head comment is stale.** Says
  "Infrastructure agents (constraint-agent, test-runner-
  agent, ...) do deterministic work and are NOT
  configurable here." This pre-dates TR_005's
  executeScript evolution (which made both LLM-driven).
  Fix when patching the constraint-agent loader.

Decisions made:

- **Did NOT fix constraint-agent's hardcoded config in
  this session.** The brief was Fix 1 (yaml) + Fix 2
  (platform defaults). The platform bug isolation
  emerged from TR_016's verification data and deserves
  its own session — it's a code-touching change that
  needs review-agent's `loadAgentConfig` pattern
  replicated carefully, plus a test, plus a follow-up
  verification cycle to confirm the model lands.
- **Reported actual cost rather than gpt-4o-only
  projection.** Brief expected "slightly higher than
  TR_015 due to gpt-4o gate pricing" — the actual
  outcome was LOWER cost because the gate converged in
  one round. Documented the input/output token mix per
  agent to show the math.
- **Wrote the report off the single-round verification.**
  Sample size is one. Follow-up recommends a second
  intent shape to confirm generality.

Pending follow-ups (priority-shifted by TR_016's data):

- **(HIGHEST — new from TR_016)** Fix constraint-agent's
  hardcoded AGENT_CONFIG to call
  `loadAgentConfig(projectRoot, 'constraint-agent')` like
  review-agent does. Without this, constraint-agent's
  agents.yaml block is silently ignored. Until then,
  the gate's gpt-4o behaviour is only half-applied.
- **(HIGH — new from TR_016)** Re-run verification on at
  least one more intent shape to confirm generality.
- **(MEDIUM — carryover, was HIGH in TR_015)** Deterministic
  post-LLM filter for "pool.query in *.repository.ts
  flagged as violation". TR_016's pass weakens this but
  it remains the structural belt to the gpt-4o braces.
- **(MEDIUM — carryover from TR_014)** Aider token spend
  visibility (parse `Tokens: N sent / M received` from
  Aider stdout).
- **(MEDIUM — carryover from TR_015)** Restore TR_010
  mandatory executeScript code-agent rule in trackeros
  HARNESS.json (still missing; test files still drop
  `beforeEach` imports).

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + restarted; server boot healthy.
Server `/health` 200 throughout. trackeros `main` updated
to `9830241`. New file `docs/claude/TEST_REPORT_016.md`.
**First clean `gestalt status: ✓ deployed` since
TEST_REPORT_007.**

---



### Session 2026-06-06 — Claude Code (TEST_REPORT_015: Approach A — explicit repository-pattern rule wording. Rule clarification applied to trackeros + template (bumped 0.4.0); gpt-4o-mini READS the rule but REASONS the opposite — categorical confusion is provably at the LLM-reasoning layer, not the rule-clarity layer.)

Project-side fix session against TR_013's HIGHEST follow-up.
The user's brief: replace constraint-agent + review-agent rules
with explicit positive AND negative examples that name file-name
patterns. No platform code. Apply to trackeros's HARNESS.json
AND the built-in `corporate-ops-web-mobile` template; bump
template version to 0.4.0 so the seed-on-restart mechanism
propagates to new projects automatically.

Outcome: **Approach A applied as briefed; data isolates the
remaining failure mode to the LLM reasoning layer.** Rule wording
landed in both places (trackeros commit `ce0c01e`; template
re-seed confirmed in server boot log: "Refreshed built-in
template" 0.3.1 → 0.4.0). gpt-4o-mini IS reading the new rule —
the rule's title prefix `[REPOSITORY PATTERN — what is a
VIOLATION (flag this)]` appears verbatim in 26 of 28
constraint-agent signals. But the model REASONS the opposite of
what the rule says: 15 signals explicitly assert "pool.query in
a repository file is not allowed" against the rule that says the
same thing IS the repository's job. Aider produced the cleanest
leave.service.ts of any cycle to date (proper DI, exactly the
intent) in 8.3 s. Cycle still fails at gate-max-retries via the
loop detector at 74% repeat rate.

What the user asked for:

- **Fix 1** — trackeros HARNESS.json. Replace constraint-agent
  + review-agent rules with the brief's explicit pos/neg
  example wording. Push to trackeros main.
- **Fix 2** — Same wording merged into the built-in
  `corporate-ops-web-mobile` template. Bump
  `template.json#version` to `0.4.0` so the
  `seedBuiltinTemplate` boot-path picks it up and refreshes
  the `platform_templates` row.
- Verify with the same Leave-service intent (Aider backend
  active). Check zero "Direct DB access" signals; gate-pass
  round 1; cost < $0.05; Aider 6–13 s.

What changed:

- **trackeros `HARNESS.json`** (commit `ce0c01e` on
  trackeros `main`): constraint-agent + review-agent rules
  replaced with the brief's explicit `REPOSITORY PATTERN —
  what is a VIOLATION (flag this)` / `what is CORRECT (do
  NOT flag)` wording. File-name patterns (`*.repository.ts`,
  `*.service.ts`) named explicitly. Concrete example
  (`leave.service.ts containing pool.query('SELECT...')`).
- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`**:
  same wording merged into the template's existing rules —
  three new REPOSITORY-PATTERN rules prepended to
  constraint-agent's list (preserving the existing
  src/shared/db / console.log / async-error rules), three
  new REPOSITORY-PATTERN rules merged into review-agent's
  list (preserving the existing scope / main-branch /
  tsc-noEmit / outOfScope rules).
- **`templates/corporate-ops-web-mobile/template.json`**:
  version `0.3.1` → `0.4.0`. The platform's
  `seedBuiltinTemplate` (server.ts line 306) compares
  on-disk vs DB version and refreshes when they differ.
- Docker image rebuilt + container restarted. Server boot
  log confirms refresh: `INFO: Refreshed built-in template
  (version bump) — slug: corporate-ops-web-mobile,
  previousVersion: 0.3.1, version: 0.4.0, fileCount: 7`.

Live verification (correlation
`d7d9f66f-c261-4e3f-b11c-0560bfd62832`, intent_id
`27232b78-…`):

8 rounds, 64 agent executions. 38 review + constraint signals.
~291k tokens / **~$0.087 USD** at gpt-4o-mini pricing.

Verification matrix vs brief:

| Check | Result |
|---|---|
| Zero "Direct DB access" on `leave.repository.ts` | **✗** 15 signals; constraint-agent flags pool.query in the repository as a violation |
| Zero "Direct DB access" on `leave.service.ts` | **✗** 4 signals; review-agent flags `this.leaveRepository.createLeaveRequest(req)` as DB access |
| Gate verdict pass round 1 | **✗** same gate-max-retries termination as TR_013/014 |
| Cost < $0.05 | **✗** $0.087 |
| Aider 6–13 s | **✓** 8.3 s round 1 |

What worked:

- **Rule wording landed exactly as briefed.** Both trackeros
  and the template carry the new rules verbatim. Template
  re-seed mechanism worked end-to-end (version bump triggers
  refresh on next boot).
- **Aider produced the cleanest leave.service.ts of any
  cycle to date.** Proper DI via constructor (`constructor(
  private leaveRepository: LeaveRepository) {}` — TR_014's
  `new LeaveRepository()` issue is fixed). 12 lines.
  Imports resolve. Exactly the intent.
- **gpt-4o-mini IS reading the new rule.** The rule's title
  prefix `[REPOSITORY PATTERN — what is a VIOLATION (flag
  this)]` appears verbatim in 26 of 28 constraint-agent
  signal messages. The model is being shown the rule and is
  including its title in its output.
- **Loop-detector repeat rate dropped monotonically.**
  TR_013: 84% → TR_014: 77% → TR_015: 74%. The cycle's
  failure-mode diversity is narrowing as each round emits
  the same concrete reasoning failure.
- **Evidence requirement (TR_013) continues to work.** 38/38
  emitted signals carry `Evidence: "..."`. The TR_013
  contract is unaffected.

What didn't work:

- **gpt-4o-mini REASONS the opposite of what the rule
  says.** Sample signal:
  > `[REPOSITORY PATTERN — what is a VIOLATION] This line
  > violates the repository pattern rule because it directly
  > calls pool.query() in a repository file, which is not
  > allowed according to the architectural constraints.`
  > `Evidence: "const result = await this.pool.query<...>"`
  The rule says (verbatim): *"A file named \*.repository.ts
  calling pool.query() ... is correct and must never be
  flagged."* The model emitted **the opposite**. 15 of 28
  constraint-agent signals are this exact pattern.
- **Even when the model REASONS correctly it emits anyway.**
  One constraint-agent signal:
  > `[REPOSITORY PATTERN — what is a VIOLATION] ... No
  > violation is present in the service file.` severity:
  > low.
  The model correctly determined no violation is present
  AND emitted a signal anyway. The TR_013 gate-orchestrator
  drops low/info so this is structurally safe — but it
  shows the LLM cannot follow even its own correct reasoning.
- **Review-agent flags the service's repository call as DB
  access.** Sample:
  > `[review/architecture] The LeaveService is directly
  > calling a repository method that may lead to direct
  > database access ...` Evidence:
  > `"return this.leaveRepository.createLeaveRequest(req);"`
  Same pattern — rule reads but reasoning is inverted.
- **Aider's pre-emit verification dropped.** The brief's
  trackeros `code-agent.rules` no longer includes the
  TR_010 mandatory executeScript check. Test file is
  missing the `beforeEach` import. Low-impact for this
  cycle but a regression vs TR_014.

Decisions made:

- **Did NOT touch the gate-agent model.** The brief was
  explicitly Approach A only ("No platform code"). Promoting
  the gate model swap to HIGHEST in pending follow-ups is
  the report's main signal to the next session.
- **Restated rules in the trackeros HARNESS.json's
  code-agent section per the brief, even though it dropped
  the TR_010 executeScript mandate.** The brief listed only
  two code-agent rules; I followed the brief verbatim and
  flagged the dropped rule as a Medium follow-up.
- **Rebuilt the Docker image rather than just restarting.**
  Templates are baked into the image at build time (`COPY
  templates ./templates`). To get the new template content
  into `/app/templates`, a rebuild was necessary even
  though only the running server's seedBuiltinTemplate code
  reads it.
- **Wrote the report against the 8-round failing cycle.**
  The data is now characteristic enough that another run
  would produce the same shape — the LLM-reasoning failure
  is reproducible.

Pending follow-ups (priority-shifted by TR_015's data):

- **(HIGHEST — promoted from LOW in TR_014)** Switch
  gate-agent model gpt-4o-mini → gpt-4o. Five cycles of
  reading-rules-then-emitting-the-opposite are sufficient
  evidence. Per-agent override in trackeros `agents.yaml`:
  `constraint-agent: { llm: { model: gpt-4o } }`,
  `review-agent: { llm: { model: gpt-4o } }`.
- **(HIGH — re-promoted from TR_012 by TR_015)**
  Deterministic post-LLM filter for "pool.query in
  *.repository.ts flagged as violation". The TR_013
  evidence requirement gives the parser (`location.file` +
  `quotedLine`) enough info to apply a one-line exemption.
  Was superseded by Approach A; TR_015 proves Approach A
  alone is insufficient.
- **(MEDIUM — new from TR_015)** Restore the TR_010
  mandatory executeScript code-agent rule. The brief
  dropped it; Aider's test file regressed the
  `beforeEach`-import miss as a result.
- **(LOW — carryover from TR_014)** Aider token spend
  visibility; finer CONTEXT_GAP taxonomy on Aider exit
  codes; per-role MAX_TOOL_CALLS override.

Build status: `pnpm -r build` clean. Docker image rebuilt;
template refresh logged at boot. Server `/health` 200
throughout. trackeros `main` updated to `ce0c01e`. New file
`docs/claude/TEST_REPORT_015.md`.

---



### Session 2026-06-06 — Claude Code (TEST_REPORT_014: Aider as a swappable code-generation backend — ships cleanly; code-agent wall-clock drops 10–80×; same gate-side hallucination as TR_013 — proves the issue is backend-independent)

Seven-part implementation session against the user's brief: replace
the Gestalt-native code-agent + test-agent with Aider, per project
opt-in via HARNESS.json. Aider runs as a child process, edits files
directly in the cycle's cloned work-dir, and the AiderCodeAgent
re-reads them as artifacts so the rest of the platform (gate,
deploy, observability) runs unchanged. Aider 0.86.2 installed in
the production Docker image; trackeros opted in via
`codeGeneration.backend: 'aider'`.

Outcome: **Aider integration ships cleanly and works.** Aider ran 8
times in the verification cycle, producing the same correct
15-line `leave.service.ts` + a vitest test file every round in
6–13 seconds (vs the Gestalt-native code-agent's 33–735 seconds
in TR_013). Test-agent was skipped on all 8 rounds — Aider produced
tests inline. But the cycle **still fails on the same review-agent /
constraint-agent "Direct DB access" categorical hallucination as
TR_013**, terminated by TR_012's loop detector at a 77% repeat
rate. This is the cleanest possible isolation: switching the
backend changes nothing about the gate's behaviour. **Approach A
(tighter HARNESS.json rule wording) is still the next required
fix.**

What the user asked for:

- **Part 1** — Install Aider in the production Docker image
  (`packages/server/Dockerfile`).
- **Part 2** — AiderAdapter in the generate package: `runAider`
  + `parseAiderChangedFiles`. `--yes --no-git --message` flags
  mandatory; credentials forwarded as env vars not CLI flags.
- **Part 3** — Aider message builder: task + criteria + rules +
  architecture + design. **No implementation instructions** —
  Aider decides how.
- **Part 4** — Orchestrator wiring. When the harness opts in,
  swap CodeAgent for AiderCodeAgent and skip test-agent.
- **Part 5** — HARNESS schema `codeGeneration.backend:
  'gestalt' | 'aider'`, default `'gestalt'`.
- **Part 6** — executeScript gains `extraEnv?` for credential
  forwarding.
- **Part 7** — trackeros opted in via HARNESS.json; commit
  pushed to trackeros `main`.
- Verify with the same Leave-service intent used in TR_011/012/013.
  Compare code quality, wall-clock, and gate verdict against TR_013.

What changed:

- **`packages/server/Dockerfile`**: production stage gets
  `python3` + `py3-pip` + `aider-chat`. Tree-sitter's C
  extensions need build-base + python3-dev — installed as a
  `--virtual .aider-build-deps` package and removed via
  `apk del` in the same layer so the runtime image stays
  lean. `docker compose exec server aider --version` →
  `aider 0.86.2`.
- **`packages/core/src/tools/file-tools.ts`**: `executeScript`
  signature gains optional `extraEnv?: Record<string, string>`.
  Tool-call callers pass undefined and behave exactly as before.
- **`packages/core/src/llm/index.ts`**: `LLMClient.getBaseUrl()`
  + `getApiKey()` for the Aider credential forward. Comment
  marks `getApiKey()` callers MUST treat the return as secret.
- **`packages/core/src/harness/index.ts`** +
  **`packages/agents/generate/src/types.ts`**:
  `codeGeneration?: { backend: 'gestalt' | 'aider' }` on
  HarnessConfig (both core + generate-side mirror).
- **`packages/agents/generate/src/adapters/aider-adapter.ts`**
  (new). `runAider` spawns `aider --yes --no-git --model "<m>"
  --message "<escaped>"` via `executeScript`, with
  `OPENAI_API_KEY` / `OPENAI_API_BASE` / `AIDER_NO_AUTO_COMMITS=
  true` in `extraEnv`. `parseAiderChangedFiles` extracts paths
  from `Wrote|Created|Updated|Modified|Edited|Applied edit to`
  lines.
- **`packages/agents/generate/src/adapters/aider-message-builder
  .ts`** (new). Concise: task + success criteria + out-of-scope
  + project rules + architecture (truncated 2KB) + design
  (truncated 2KB). No HOW instructions.
- **`packages/agents/generate/src/agents/aider-code-agent.ts`**
  (new). Extends `BaseLLMAgent`; overrides `run()` to: resolve
  per-agent LLM client, pull design-spec artifact, build
  message, run Aider, re-read written files as `code` artifacts,
  persist a `design`-type narrative artifact at
  `.gestalt/<correlationId>/aider-output.md`. Sets
  `lastPrompt` / `lastLlmResponse` / `lastModelUsed` so the
  dashboard accordion renders Aider's narrative like a normal
  LLM response.
- **`packages/agents/generate/src/orchestrator/orchestrator.ts`**:
  `newAgentForRole(role, harnessConfig)` — new signature.
  Returns AiderCodeAgent for code-agent when
  `harnessConfig?.codeGeneration?.backend === 'aider'`.
  Top-level `handleIntentTask` merges `'test-agent'` into
  `opts.skipAgents` under Aider mode so the existing skip
  path marks test-agent as `skipped` for the dashboard.
- **trackeros `HARNESS.json`** (commit `ccd99d0` on `main`):
  `"codeGeneration": { "backend": "aider" }` appended.

Live verification (correlation `3a114a1d-…`, intent_id
`c2772306-…`):

Per-round code-agent wall-clock (Aider sessions):

| Rd | code-agent (ms) | files | test-agent | gate verdict |
|---|---|---|---|---|
| 1 | 12,287 | 2 | skipped | gate-fail |
| 2 |  7,782 | 2 | skipped | gate-fail |
| 3 |  6,103 | 2 | skipped | gate-fail |
| 4 |  8,590 | 2 | skipped | gate-fail |
| 5 |  8,956 | 2 | skipped | gate-fail |
| 6 |  8,760 | 2 | skipped | gate-fail |
| 7 |  9 s avg | 2 | skipped | self-healing |
| 8 | terminating | 2 | skipped | gate-max-retries |

Comparison to TR_013's Gestalt-native code-agent: 6–13 s per
round vs 48–735 s per round. **10–80× faster wall-clock per
code-agent step.** Zero JSON parse failures (the round-7 failure
mode that ended TR_013 doesn't exist for Aider).

Verification matrix:

| Check | Result |
|---|---|
| Server logs show "Running Aider code generation" | ✓ every round, with `module: "aider-code-agent"` |
| `.gestalt/<correlationId>/aider-output.md` artifact saved | ✓ full prompt + narrative + exit code + file list |
| `leave.service.ts` created in the work-dir | ✓ Aider wrote it; AiderCodeAgent re-read + persisted as `code` artifact |
| Gate runs on Aider-generated files | ✓ both review + constraint reviewed them |
| No tool-budget exhaustion | ✓ never hit the 120s adapter timeout |
| Code quality vs TR_013 | ✓ Aider's 15-line file is cleaner than any of TR_013's rounds; matches intent exactly |
| Evidence requirement intact | ✓ 31/31 review + constraint signals carry `Evidence: "..."` |

What worked:

- **Wall-clock collapse.** Aider's code-agent step is 6–13s,
  vs TR_013's 33–735s. Total code-agent wall-clock dropped
  from ~36 minutes to ~67 seconds across the cycle.
- **Code quality is consistently good.** Aider produced the
  same minimal 15-line `leave.service.ts` on every retry —
  no scope creep over rounds (TR_013's round 4+ added
  unrequested methods, `console.log` "audit" lines, and
  dropped requested methods).
- **No JSON parse failures.** Aider writes files directly;
  the brittle JSON-mode response handling that bit TR_013's
  round 7 doesn't exist here.
- **Clean observability surface.** The aider-output.md
  artifact carries the prompt + Aider's verbatim narrative
  — operators see exactly what the model decided to do.
- **Per-project opt-in works.** trackeros opted in via a
  3-line HARNESS.json change; no platform code change to
  enable. Other projects continue running the Gestalt-native
  code-agent.
- **Test-agent skip works.** All 8 test-agent rows are
  `status='skipped'`, no execution, no LLM call, fast.
- **TR_013 evidence requirement still holds.** 31/31
  signals carry `Evidence: "..."` quotes.

What didn't work:

- **Same gate-side hallucination as TR_013.** Review-agent +
  constraint-agent emit the same "Direct DB access in
  repository" categorical confusion. Sample finding:
  > *[Repository pattern VIOLATION] The LeaveService class
  > is directly calling a method on the LeaveRepository...*
  That IS the repository pattern. The LLM's category
  confusion is independent of which backend wrote the code.
- **Cycle still terminates at gate-max-retries.** 8 rounds,
  same 77% loop-detector trigger as TR_013's 84%. The
  failure mode is unchanged.
- **Token tracking is invisible.** Aider spends tokens
  out-of-band; `tokens_used` is 0 on every code-agent
  execution row. Operators can't see the cost surface for
  the Aider-backed step.
- **Aider's pre-emit verification is its call.** The
  Gestalt-native code-agent has the TR_010 mandatory
  `executeScript` pre-emit step. Aider may or may not run a
  compile check based on its internal heuristics. We pass
  the project rule, but Aider doesn't necessarily honour it.
- **Test file completeness is laxer.** Aider's test file
  was missing the `beforeEach` import — scaffolds the call
  but forgets the import.

Decisions made:

- **Used `apk add --virtual` for build-deps in the Dockerfile.**
  Aider depends on tree-sitter which needs cc + python3-dev.
  Installing them as a virtual package + `apk del` in the same
  RUN layer keeps the runtime image lean.
- **Exposed `getBaseUrl()` + `getApiKey()` on LLMClient.**
  Cleanest path for the Aider adapter to route through the
  same registry-resolved endpoint without re-resolving
  env/vault. Comment marks `getApiKey()` as secret-tier.
- **Test-agent skipping via `opts.skipAgents` merge** rather
  than a dedicated AiderSkippedAgent class. Reuses the
  existing self-healing skip path verbatim.
- **Persisted Aider's stdout as a `design`-type artifact.**
  Closest existing artifact type. Path is
  `.gestalt/<correlationId>/aider-output.md`. Operators see
  the narrative in the dashboard accordion via the standard
  artifact rendering.
- **Aider sessions bounded by 120s timeout.** Same as the
  `executeScript` MAX_SCRIPT_TIMEOUT_MS cap. Never hit it
  in the verification cycle (max session was 12.3s).

Pending follow-ups:

- **(HIGHEST — carryover from TR_013)** Approach A: tighten
  trackeros's HARNESS.json constraint rule wording. TR_014
  proves the issue is backend-independent.
- **(HIGH — new from TR_014)** Capture Aider's token spend.
  Parse the `Tokens: N sent / M received` line from Aider's
  stdout when present.
- **(MEDIUM — new from TR_014)** Surface Aider exit-code
  reasons in the CONTEXT_GAP signal — finer taxonomy than
  the current generic message.
- **(MEDIUM — carryover from TR_010/011)** Constraint-agent
  per-role MAX_TOOL_CALLS override. TR_014 round 2's
  constraint-agent ran 513s / 78k tokens.
- **(LOW — new from TR_014)** Operator-side: project rule
  "Every test file MUST import its testing-framework symbols
  explicitly" addresses Aider's missing `beforeEach` import.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted via `docker compose
up -d --build`. Server `/health` 200 throughout. Aider 0.86.2
verified inside the container. trackeros `main` updated to
`ccd99d0`. New file `docs/claude/TEST_REPORT_014.md`.

---

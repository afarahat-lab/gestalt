# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-08 — Claude Code (TR_027 / ADR-051: PR-Agent replaces review-agent — server-side direct invocation; venv isolation; verified end-to-end on trackeros PR #81)

Brief: replace Gestalt's custom review-agent with CodiumAI
PR-Agent invoked directly by the pipeline-agent as a server-side
`executeScript` subprocess after CI passes. No webhook, no
separate Docker service, no GitHub Secrets for LLM keys —
PR-Agent receives Gestalt's resolved LLM credentials via
subprocess environment variables for that one invocation only.

What changed (server-side architecture):

- **`packages/agents/deploy/src/adapters/pr-agent-adapter.ts`** —
  NEW. `runPrAgentReview()` resolves LLM env vars per call
  (Azure: `OPENAI__API_TYPE=azure` + `OPENAI__API_VERSION`;
  OpenAI/Ollama/compatible: `OPENAI__API_BASE` + `OPENAI__KEY`);
  invokes `pr-agent --pr_url="<url>" review` via `executeScript`
  with 60s default timeout. Returns typed `PrAgentResult` —
  never throws.
- **`packages/agents/deploy/src/orchestrator/deploy-orchestrator.ts`** —
  added `maybeRunPrAgentAndRoute()` between CI-passed and
  gate-dispatch. Clones a shallow workdir, calls `runPrAgentReview`
  with credentials resolved via `getLLMClientForModel()`, then
  polls the PR via `GitHubActionsAdapter.getPrAgentVerdict` for
  up to 30s (6 × 5s). Three outcomes: `approved`/`none` → proceed
  to gate; `changes-requested` → invoke `attemptSelfHealingForDeploy({
  failureType: 'review-requested-changes', ... })` (reuses
  existing fix-intent mechanism); `pending` after poll budget → proceed
  with warning. PR-Agent exit-non-zero ⇒ proceed (best-effort,
  don't block the cycle).
- **`packages/agents/deploy/src/adapters/github-actions-adapter.ts`** —
  added `getPrAgentVerdict()` + `getPrAgentComment()` polling the
  GitHub PR Reviews + Comments APIs. Recognised PR-Agent bot logins:
  `pr-agent[bot]` / `codiumai-pr-agent[bot]` / `qodo-merge-pro[bot]`.
- **`packages/agents/quality-gate/src/orchestrator/gate-orchestrator.ts`** —
  `shouldSkipReviewAgent(projectRoot)` reads HARNESS.json; when
  `prAgent.enabled && pipeline.adapter === 'github-actions'` the
  orchestrator skips review-agent entirely. constraint-agent
  still runs in parallel (HARNESS-rule enforcement remains
  Gestalt's responsibility, not PR-Agent's).
- **`packages/agents/quality-gate/src/agents/llm-review-agent.ts`** —
  `@deprecated` JSDoc block added at the top. The file is kept
  as a fallback path for non-github-actions adapters.

Server image + subprocess isolation:

- **`packages/server/Dockerfile`** — PR-Agent installed alongside
  Aider via `pip`, but in its own venv (`/opt/pr-agent`) because
  PR-Agent's `litellm` version has exception classes that
  Aider's exception adapter doesn't recognise — Aider would
  crash at import time if they shared a venv. Aider lives in
  `/opt/aider`. `/usr/local/bin/aider` is a symlink to the
  Aider venv binary; `/usr/local/bin/pr-agent` is a shell shim
  invoking the PR-Agent venv's `python -m pr_agent.cli`.
  Required Alpine deps for the wheel build: `gfortran` +
  `openblas-dev` (PR-Agent's numpy/scipy transitive deps).
  `--prefer-binary` on the pip install keeps the image lean.

Harness + config:

- **`packages/core/src/harness/index.ts`** — `HarnessConfig` gained
  optional `prAgent?: { enabled, blockOnChangesRequested?,
  pendingTimeoutSeconds? }` block.
- **`packages/server/src/templates/pr-agent-toml.ts`** — NEW.
  `generatePrAgentToml(harnessConfig)` builds `.pr_agent.toml`
  from `agentConfig['review-agent'].rules` +
  `agentConfig['constraint-agent'].rules` (deduped); outputs
  `[pr_reviewer]`, `[pr_description]`, `[pr_code_suggestions]`
  sections so the rules drive PR-Agent's per-project focus.
- **`packages/server/src/routes/projects.ts`** — init-harness
  now writes `.pr_agent.toml`; new
  `POST /projects/:id/push-pr-agent-config` regenerates +
  pushes the toml on harness updates.
- **`packages/cli/`** — `gestalt project config push-pr-agent-config`
  command + `pushPrAgentConfig()` API client method.

Self-healing:

- **`packages/core/src/agents/self-healing-loop.ts`** — added
  `'review-requested-changes'` to `FailureType` union + title
  template. **`packages/core/src/repository/index.ts`** — added
  same to `AlertType` union.
- **`packages/adapters/postgres/src/migrations/027_self_healing_pr_agent.sql`** —
  NEW. Seeds a self-healing config row for the new failure
  type (retry type = `fix-intent`).

Templates:

- **`templates/corporate-ops-web-mobile/harness/HARNESS.json`** +
  **`/Users/amrmohamed/Work/trackeros/HARNESS.json`** — added
  `prAgent: { enabled: true, blockOnChangesRequested: true,
  pendingTimeoutSeconds: 30 }` block + a self-healing-agent rule
  for `review-requested-changes`.
- **`templates/corporate-ops-web-mobile/ci/gestalt.yml`** —
  reverted to TR_020 shape (push-only trigger, no PR-Agent CI
  step). PR-Agent runs server-side now.
- **`templates/corporate-ops-web-mobile/template.json`** —
  version `0.13.0` → `0.14.0`.

Pivots:

- **v1 → v2**: original brief had PR-Agent run as a GitHub
  Actions step gated by a `GESTALT_LLM_API_KEY` repo secret. User
  rejected the secret-distribution model and provided a v2 brief
  requiring server-side invocation with credentials resolved
  per-call from Gestalt's vault/registry. v1 plumbing (CI step,
  pull_request trigger) was reverted on both the template and
  trackeros's workflow.
- **Single-venv → dual-venv**: an early `pip install aider-chat
  pr-agent` in the Dockerfile broke Aider at runtime
  (`ValueError: PermissionDeniedError is in litellm but not in
  aider's exceptions list` — PR-Agent's litellm exception
  classes Aider's adapter doesn't know). Fix was venv isolation;
  cleaner than version-pinning either tool.
- **CLI flag form**: first verification attempt failed with
  `argument command: invalid choice: 'https://...'` because the
  adapter used `--pr-url URL` (hyphen, space) but PR-Agent's CLI
  expects `--pr_url=URL` (underscore, equals). One-line fix in
  `pr-agent-adapter.ts`.

Live verification — trackeros intent
`1ba554af-f1d0-445b-94d2-46b3a62f0b27` (correlation
`3648e162-...`, PR #81):

- 20:01:59 — Aider code generation start
- 20:02:05 — Aider complete (6s)
- 20:02:0_ — pr-agent push → CI workflow_dispatch
- 20:03:08 — Running PR-Agent review (server-side)
- 20:03:31 — PR-Agent review complete (23.5s)
- 20:03:43 — PR-Agent verdict resolved (`verdict: "none"` —
  PR-Agent posts a comment, not a formal review approval; `none`
  routes the same as `approved`: proceed to gate)
- 20:03:52 — ADR-051 — PR-Agent enabled; gate skipping
  review-agent (constraint-agent still runs)
- 20:04:03 — PR #81 squash-merged via auto-merge
- **Status: ✓ deployed**, single round, attempt_count=0,
  wall-clock 2m 04s.

PR-Agent's "PR Reviewer Guide" comment confirmed on PR #81:
estimated effort 1🔵 / no security concerns / table of findings.
Posted under the project PAT's identity (the operator's bot
account, not a dedicated pr-agent[bot] login — both work; the
adapter recognises either).

Decisions made:

- **Venv isolation over version pinning.** Pinning either
  litellm or aider-chat would couple the platform's upgrade
  cadence to two upstream projects. Each `/opt/<tool>` venv
  with PATH shims keeps the dep graphs entirely independent.
- **`verdict: "none"` → proceed.** PR-Agent's `review` command
  posts an informational `## PR Reviewer Guide` comment, not a
  formal GitHub PR review with APPROVED state. The deploy
  orchestrator treats `none` identically to `approved` —
  CHANGES_REQUESTED is the only verdict that routes to
  self-healing. Avoids false-positive blocking on every PR.
- **Best-effort on PR-Agent failure.** Exit-non-zero from the
  subprocess (network blip, LLM auth issue, malformed PR diff)
  emits a WARN and proceeds. Blocking the deploy on a
  PR-reviewer adjunct would defeat the point.
- **`@deprecated` rather than delete** llm-review-agent.ts.
  Kept as the fallback path for non-github-actions adapters
  (the `getPrAgentVerdict` polling is GH-specific).
- **`.pr_agent.toml` generated from HARNESS rules.** PR-Agent
  reads `extra_instructions` from the file; deriving it from
  HARNESS rules means a single source of truth for "what does
  this project consider a violation."
- **Closed stranded PR #79** (failed first attempt with broken
  default-export edit; clean state on trackeros now).

Pending follow-ups (NEW from TR_027):

- **(LOW)** PR-Agent's verdict polling has a 30s budget
  (6 × 5s). If PR-Agent itself takes longer than 30s (which
  rarely happens — typical wall is ~23s), the verdict falls
  through to `pending → proceed`. Could be threaded into
  HARNESS.json's `prAgent.pendingTimeoutSeconds` to make the
  poll budget project-tunable (the field already exists in
  the type, just not yet read by the orchestrator).
- **(LOW)** `chat-latest` as a litellm model alias works
  because OpenAI's `chat-latest` resolves at the API edge.
  Other providers (Anthropic, Ollama) would need their own
  alias semantics. Document as a known constraint of the
  per-project LLM choice.

Carryover follow-ups (status updates):

- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend capture in
  `agent_executions.tokens_used`.
- **(STILL OPEN — MEDIUM)** TR_019: `gestalt init` scaffold a
  `.gitignore` + align jest/ts-jest/@types/jest with TS.
- **(STILL OPEN — LOW)** TR_019: template `{{ciSetupSteps}}` for
  Node/npm should add `--legacy-peer-deps`.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt twice (venv split + CLI flag fix); on the
final run `aider 0.86.2` + `pr-agent` (latest) both invoke
cleanly. `/health` 200 throughout. Template auto-refreshed at
boot: `version: "0.14.0"`. trackeros PRs: #80 deployed (first
flow — but PR-Agent failed silently due to CLI flag bug;
proceed-on-error path worked, deploy still succeeded). #81
deployed (full flow including PR-Agent posting its review
comment). #79 closed-stranded from the broken first attempt.

---
### Session 2026-06-08 — Claude Code (ADRs 053–055: tool integration roadmap — Qodo Gen, SWE-agent, K8sGPT documented as accepted-pending-implementation; STATE.md gains forward-looking roadmap section)

Documentation-only session. No code change, no migration. The
design chat agreed on three strategic tool integrations plus a
ruled-out / deferred list; this session captures them as ADRs
and surfaces the roadmap on STATE.md so future sessions know
the intent.

What changed (docs):

- **`docs/DECISIONS.md`** — three ADRs appended:
  - **ADR-053** — Qodo Gen (CodiumAI) replaces the custom
    test-agent in the generate layer. Runs via `executeScript`
    after Aider, opt-in via
    `HARNESS.json codeGeneration.testBackend = 'qodo'`.
    Same vendor as PR-Agent — consistent CodiumAI pattern
    across the quality layer. Supports local LLMs (Ollama,
    vLLM) for data residency.
  - **ADR-054** — Princeton's SWE-agent handles
    `MaintenanceIntent`s of type `bug-fix`. Reproduces the
    error, writes a failing test, fixes, verifies. Fix flows
    through Gestalt's CI + gate pipeline — no bypass.
    Prerequisite: verify self-hosted Azure OpenAI / Ollama
    support before implementation.
  - **ADR-055** — K8sGPT (CNCF) scans Kubernetes clusters
    and webhooks findings to Gestalt's maintenance layer.
    Aider fixes K8s manifests; CI validates with
    `kubectl apply --dry-run=server`. Requires a new
    Kubernetes operations layer in the platform. Native
    Ollama / LocalAI support — cluster telemetry stays
    on-prem (GCC/MENA fit).
  - All three: **Accepted — pending implementation**.
- **`docs/claude/DECISIONS.md`** — three one-line index
  entries added; ADR-051 (PR-Agent) was authored alongside
  this session and is also indexed. Callout notes that
  ADR-052 (external scanner webhook → MaintenanceIntent
  pattern) is referenced by ADR-055 but has not yet been
  authored — backfill when the next session touches that
  code.
- **`docs/claude/STATE.md`** — new
  `### Tool integration roadmap` section under
  "Active follow-ups (small)" (placed after the
  TR_018/TR_014 carryovers, before architecture follow-ups).
  Documents priority order (Qodo Gen → SWE-agent → K8sGPT),
  the deferred Sourcegraph integration (revisit when project
  codebases exceed ~100 files), and three ruled-out
  alternatives: **Bloop.ai** (BloopAI/bloop repo archived
  2025-01-02 — vendor pivoted), **OpenHands** (formerly
  OpenDevin — competitor to Gestalt's planning layer, lacks
  governance/gate/audit/identity), **GitHub Spec Kit** (not
  self-hostable — blocks GCC/MENA data residency).
- **`docs/claude/BUILD.md`** — `Pending operator actions`
  gets an `### ADRs 053–055 — Tool integration roadmap`
  section noting docs-only, operator action: none.

Decisions made:

- **ADR-052 referenced but not yet written.** ADR-055's
  consequences reference ADR-052 (external scanner webhook →
  MaintenanceIntent pattern), which doesn't exist in
  `docs/DECISIONS.md` today. Rather than fabricate it in this
  docs-only pass, recorded the gap as a callout in
  `docs/claude/DECISIONS.md` so the next session that touches
  external scanner code backfills the ADR at the same time.
  (ADR-051 was added alongside this session by the user, so
  the ADR-053 rationale link no longer dangles.)
- **Placement of the roadmap section in STATE.md.**
  Could go at the top of "Active follow-ups (small)" for
  visibility, or at the bottom. Picked just before
  `### Architecture follow-ups` so the TR_xxx completed/in-
  progress work stays first (recency bias matches the rest
  of the file) and the strategic roadmap forms its own
  cleanly-bounded section.
- **Ruled-out items captured in STATE.md rather than as
  separate ADRs.** A negative-decision ADR per tool would
  inflate the index without adding load-bearing content;
  the one-paragraph "ruled out" entries in the roadmap
  section are enough context for a future session to
  re-evaluate.

Pending follow-ups (NEW from this session):

- **(MEDIUM — backfill)** Author ADR-052 (external scanner
  webhook → MaintenanceIntent pattern — the pattern ADR-055
  extends). Referenced forward by ADR-055; without it the
  rationale link dangles.
- **(LOW)** When implementation of any of the three new
  ADRs begins, the matching `### Tool integration roadmap`
  bullet moves to a regular TR_xxx section and gains an
  implementation-status line.

Build status: unchanged. No code touched. `pnpm -r build`
not re-run (no source files modified). Server state
unchanged.

trackeros operator commits in this session: none.

---
### Session 2026-06-08 — Claude Code (TR_026: remove platform file-change detection — Aider stdout parsing deleted, phase-evaluator uses git diff via executeScript)

ADR-050 enforcement: the platform must NOT detect, parse, or
interpret which files changed. That's the agent's job, using
git as a tool. Two surgical changes plus one regression patch.

What changed (code):

- **`packages/agents/generate/src/adapters/aider-adapter.ts`** —
  `parseAiderChangedFiles` deleted entirely. `filesChanged`
  field removed from `AiderResult`. `--yes` flag promoted to
  `--yes-always` so Aider's interactive confirmation prompts
  never hang on a TTY-less server.
- **`packages/agents/generate/src/agents/aider-code-agent.ts`** —
  reading `result.filesChanged` removed. The agent now asks
  `git status --porcelain` in the Aider work-dir (via new
  `discoverAiderWrites` helper) and emits each changed file
  as a `type: 'code'` artifact. This keeps pr-agent's
  artifact-driven push path working — pr-agent runs in its
  own clone and needs the artifact set to know what to write.
  The agent (NOT the platform) is the one calling git.
- **`packages/core/src/agents/agent-config-loader.ts`** —
  `PER_ROLE_DEFAULTS` extended with three planning roles
  (architecture-agent / planner-agent / phase-evaluator-agent).
  phase-evaluator-agent gets `ALL_FILE_TOOLS_WITH_SCRIPT` by
  default so `executeScript` is available out of the box for
  the git-diff path.
- **`packages/agents/planning/src/agents/phase-evaluator-agent.ts`** —
  `evaluatePhase` signature changed: `builtFilePaths: string[]`
  replaced with `branchContext: { defaultBranch, phaseBranch }`.
  The agent now uses `callLLMWithTools` (was `callLLM`) so
  the tool-use loop runs.
- **`packages/agents/planning/src/prompts/evaluator-prompt.ts`** —
  prompt rewritten to instruct the agent to run
  `git diff origin/<defaultBranch>...origin/<phaseBranch>
  --name-status` via executeScript and reason about the output.
  The "Files actually built" pre-computed block is gone.
- **`packages/agents/planning/src/orchestrator/planning-orchestrator.ts`** —
  the 3-stage built-file resolution helper from TR_025
  (PR-branch diff → merged-commit scan → artifacts-table read)
  deleted. The orchestrator only fetches the phase branch
  into the clone so `git diff` can see both refs; the agent
  does the rest.

What changed (HARNESS.json + template):

- **`HARNESS.json.agentConfig.phase-evaluator-agent.rules`** —
  four new rules (template + trackeros) instructing the agent
  to run `git diff` BEFORE forming a verdict, and to use git
  output as the only source of truth for what was built.
  Verbatim text matches the brief.
- **`HARNESS.json.agentConfig.phase-evaluator-agent.evaluationCriteria`** —
  rewritten with explicit git-diff-derived verdicts ("Escalate
  — zero files: git diff is empty despite Aider reporting
  success", etc.).
- **agents.yaml template** — phase-evaluator-agent gains an
  explicit `tools.builtin: [executeScript, readFile,
  searchFiles, listDirectory, getFileTree]` block + a
  prompt extension reinforcing "always run git diff before
  forming a verdict".
- **Template bumped 0.11.0 → 0.12.0**.

Live verification on trackeros:

- Feature `427978a6` (first attempt, post-TR_026): planner
  produced a 7-phase plan. Phase 1 dispatched.
  - Phase-evaluator-agent verdict: `"Aider completed but wrote 0
    files (confirmed by git diff)"` — quoted the HARNESS.json
    rule verbatim, confirming it followed the git-diff path.
  - PR commit (`88c72d4b`) contained ONLY `.gestalt/*`
    metadata files. The platform had correctly not invented
    files Aider didn't write. ✓ TR_026's "no Aider-stdout
    interpretation" verified.
  - Surfaced an unintended regression: with TR_026's removal
    of code artifacts in AiderCodeAgent, pr-agent (which uses
    artifacts to write files into its own separate clone)
    pushed nothing. The fix in `discoverAiderWrites` (git
    status in the agent, not stdout parsing) landed before
    the second test cycle.

- Feature `7d77f659` (post-regression patch): same 7-phase
  plan.
  - Phase 1's PR commit (`ce3f3721`) now contains
    `src/modules/leave/leave.model.ts` + `tests/unit/leave.model.test.ts`
    + `.gestalt/*` ✓ Aider's writes survive end-to-end.
  - CI failed with `TS2339 Property 'createdAt' does not exist
    on type 'LeaveRequest'` because trackeros's main carries a
    stale `leave.repository.ts` from prior auto-merged TR_025
    cycles that references model fields the new phase-1 model
    doesn't declare. Pre-existing operator state pollution —
    not a TR_026 regression.
  - TR_022 retry budget exercised end-to-end: phase-retry 1/2,
    phase-retry 2/2, then `phase-failed after 2 retries —
    feature blocked`. The autonomous failure path is intact.
  - Self-healing-agent (TR_024) chose `action: 'retry'` over
    `action: 'fix-intent'` for all three CI failures. A
    reasonable LLM call — the error reads like "code mistake"
    not "systemic gap" — but the systemic gap (stale
    repository.ts on main) is what's actually blocking.

What this VERIFIES architecturally:

- Aider stdout parsing in the platform: GONE ✓
- Phase-evaluator-agent calls executeScript with git diff
  before forming a verdict ✓ (the verdict text quotes the
  HARNESS.json rule)
- pr-agent gets the right file inventory via the
  agent-side git inquiry ✓
- The platform passes only branch NAMES as context; the agent
  decides what to do with them ✓

What this DOES NOT VERIFY (TR_027):

- Full multi-phase feature autonomous completion. Blocked
  by trackeros's stale `leave.repository.ts` from earlier
  auto-merged cycles. The TR_025 cleanup needs to be done
  again, OR the planner needs to put model+repository in
  the same phase (TR_023's rule) reliably.
- Self-healing-agent choosing `action: 'fix-intent'` for the
  stale-file-on-main case. Today it picks `retry`.

Decisions made:

- **Agent uses git, platform doesn't.** AiderCodeAgent calling
  `simpleGit(workDir).status()` to find changed files is an
  AGENT using a tool — explicitly permitted by ADR-050. The
  platform's parseAiderChangedFiles parser (which was
  interpreting natural-language "Applied edit to..." lines)
  is the violation that's removed.
- **Code artifacts stay in the artifact set.** pr-agent
  fundamentally needs an artifact set to write into its own
  clone — it doesn't share the generate orchestrator's
  work-dir, which is deleted in `finally`. So
  AiderCodeAgent still emits code artifacts; it just sources
  them from git rather than from Aider's stdout.
- **`--yes-always` not `--yes`.** Aider 0.86 sometimes
  injects "Apply this edit?" mid-session. `--yes-always` is
  the stronger form that never prompts.
- **Did NOT clean trackeros's stale leave.repository.ts** in
  this session. The TR_025 cleanup was already done; the
  pollution returned from a later auto-merged cycle. The
  recurring nature suggests a planner-level fix (TR_023's
  rule, more strictly enforced) or a self-healing-agent
  improvement is the right next move, not another manual
  cleanup.

Pending follow-ups (NEW from TR_026):

- **(HIGH — NEW from TR_026 / TR_027)** Stale repository files
  on trackeros main keep returning from auto-merged Phase 1
  cycles. Either the planner must reliably put model+
  repository in the same phase (TR_023's rule with stricter
  enforcement), or self-healing-agent needs to recognise
  "TS error in file Aider didn't write this cycle = systemic
  gap" and choose fix-intent. Most cycles loop in this state.
- **(MEDIUM — NEW from TR_026)** TR_022's MAX_PHASE_RETRIES
  is 2 by default. For long-running features the retry budget
  could be bumped per-feature via planner-emitted hints, but
  today it's a single number for the whole feature.
- **(LOW — NEW from TR_026)** The phase-evaluator-agent's
  tool-call log isn't persisted to `agent_executions`
  because the planning orchestrator calls the agent
  directly (not through `runWithObservability`). The
  evaluator's git diff output is therefore not visible to
  operators after the fact.

Carryover follow-ups (status updates):

- **~~(HIGH — TR_025)~~ STRUCTURALLY RESOLVED by TR_026.**
  Phase-evaluator file-list detection — the 3-stage fallback
  is gone; the agent owns the discovery.
- **(STILL OPEN — HIGH)** Aider `--yes-always` may not be
  enough on all Aider versions. Need to validate on Aider
  >= 0.86 (live), other versions still TBD.

Build status: `pnpm -r build` clean across all 13 packages.
No new migration. Template auto-refreshed at boot:
`version: "0.12.0"`. Server `/health` 200 throughout.

trackeros operator commits in this session:
- `897bcf06` — HARNESS.json: phase-evaluator-agent git-diff
  rules + evaluationCriteria.

trackeros planning-loop commits (auto-merged):
- `88c72d4b` — Phase 1 (pre-discoverAiderWrites — only
  .gestalt/ artifacts)
- `b336fdd7`, `a0481470` — PLAN.md updates per feature
- `ce3f3721` — Phase 1 (post-discoverAiderWrites — contains
  the actual code files Aider wrote)

PLAN.md content for the verification feature:
https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md


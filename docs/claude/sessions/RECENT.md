# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

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

---
### Session 2026-06-08 — Claude Code (TR_025: cascade-depth brake + planning evaluator file-list fix — autonomous loop verified phase 1 → auto-dispatch phase 2 on the leave management feature)

Follow-up to TR_024. Two surgical fixes plus a live test of the
full autonomous loop on the leave management feature.

What changed (code):

- **`MAX_FIX_INTENT_DEPTH = 2`** + **`getFixIntentChainDepth`**
  helper in `self-healing-loop.ts`. Before calling
  `submitFixIntent`, the loop walks the `parent_intent_id`
  chain upward (bounded to 10 hops as a cycle-safety belt).
  When depth >= 2 the loop force-escalates instead of
  cascading. ADR-050 stays intact — the LLM still chooses the
  ACTION; the platform only enforces a hard ceiling on
  recursion in the same spirit as `MAX_GATE_RETRIES`.
- **Phase-evaluator built-file list fix** in
  `planning-orchestrator.ts`. The previous code read the
  `artifacts` table filtering for `type === 'code'`, but
  Aider's code writes never land there — only `design`-type
  artifacts (intent-spec, design-spec, aider-output) do. So
  the LLM always saw `builtFilePaths: []` and (correctly given
  no evidence) escalated every phase. The fix: after the
  evaluator clones the repo, do `git diff --name-only
  origin/<defaultBranch>..origin/<phase.branchName>` filtered
  to non-`.gestalt/` paths. Falls back to a merged-commit
  scan when the branch is gone (auto-merge already squashed),
  then to the legacy artifacts-table read.

Live verification on trackeros (real GitHub Actions CI):

- Pre-cleanup: trackeros's `src/modules/leave/{leave.model,
  leave.repository}.ts` were leftover seeds from TEST_REPORT_011
  and blocked Aider from emitting new code on Phase 1 (Aider
  saw the files already existed and produced empty PRs).
  Removed via `git rm -r src/modules/leave/` on trackeros
  `main` (commit `cd27ed17`) — fresh slate for the
  verification.
- Feature `eed75889` ("Build the leave management module...")
  submitted. Planner produced a **4-phase plan**.
- **Phase 1** ("Define Leave Request Model and Repository")
  dispatched → Aider built 3 files → CI passed → gate passed
  → phase deployed → **evaluator verdict: `success`** →
  **phase 2 auto-dispatched** at 04:17:15. End-to-end
  autonomous transition CONFIRMED.
- **Phase 2** ("Implement Leave Service Logic") dispatched →
  Aider's chat output produced the LeaveService code BUT
  reported `Files changed: 0` (Aider quirk — emitted code in
  chat instead of writing files) → 0 files diffed → evaluator
  verdict: `escalate` → feature blocked. Not a TR_025 bug —
  a separate code-agent / Aider integration issue captured
  as a follow-up.

The self-healing-agent fix-intent flow was NOT exercised live
this cycle because Aider's failure was "0 files written" rather
than a CI compile error — and the evaluator escalates a
deploy-with-no-deliverables outcome rather than routing through
self-healing (which only fires on CI failures or deploy errors).
The TR_025 depth brake code is in place and unit-tested via
build/typecheck but didn't run on a live cascade.

What this verification PROVES:

- Phase 1 → Phase 2 auto-dispatch end-to-end ✓
- planning-orchestrator's git-diff path produces the correct
  file count (Phase 1: 3 files, success; Phase 2: 0 files,
  escalate)
- Phase-evaluator's LLM reasoning is sound: with concrete file
  evidence it judges accurately
- The planning loop is genuinely autonomous — no human input
  between submit and Phase 2 dispatch

What this verification does NOT prove (TR_026):

- A fix-intent cascade hitting `MAX_FIX_INTENT_DEPTH` and
  force-escalating. Code-path tested only.
- Aider's "writes code in chat, 0 files saved" pathology. This
  is a code-agent reliability issue separate from planning.
- A full multi-phase feature completing autonomously. Phase 2
  failure blocks Phases 3-4.

Decisions made:

- **Cleaned trackeros's leave/ seed files** (operator commit
  `cd27ed17` on `main`). The TEST_REPORT_011 seed was older
  than the current planner — files conflicted with
  planning-emitted code. With the user's explicit go-ahead.
- **Used `simple-git` diff against `origin/<branch>` rather
  than the local checked-out tree**. The evaluator clones at
  defaultBranch, so the phase's PR branch needs an explicit
  fetch + remote-ref diff. Cheaper than checking out the
  branch in-place.
- **Three-stage fallback in built-file resolution**: PR-branch
  diff → merged-commit scan → legacy artifacts-table read.
  Each stage handles a real edge case: auto-merge having
  cleaned the branch, no-correlation-id commits, and the
  rare pre-Aider gestalt-codegen path.
- **Did NOT modify Aider's invocation** to make it emit files
  reliably. That's a code-agent layer issue. Surfaced as
  TR_026 follow-up.

Pending follow-ups (NEW from TR_025):

- **(HIGH — TR_026)** Aider's "Files changed: 0" silent
  failure on Phase 2. The chat output contained the
  LeaveService code but Aider reported zero file writes.
  Either Aider's SEARCH/REPLACE block wasn't well-formed
  for a NEW file, or Aider's apply step silently dropped
  the change. Need to detect this pattern and surface it
  to self-healing (e.g. emit a TEST_FAILURE signal when
  `aider-output.md` shows `Files changed: 0` AND the
  intent demanded new files).
- **(MEDIUM — TR_025)** The MAX_FIX_INTENT_DEPTH brake has
  not been exercised on a live cascade. Code-path
  verification only. A targeted test (force-fail a
  fix-intent's CI twice) would prove the escalation path.
- **(LOW — TR_025)** When the legacy artifacts-table
  fallback fires, the artifact `type` filter is widened to
  include `'test'` too. Verify this is the right shape —
  it might be `'unit-test'` or similar in some adapters.

Carryover follow-ups (status updates):

- **~~(HIGH — TR_024)~~ STRUCTURALLY RESOLVED by TR_025.**
  Cascading fix-intent prevention now has a hard ceiling.
  Awaiting live verification.
- **(STILL OPEN — MEDIUM)** TR_024: pass CI logs to the
  diagnostician on non-github adapters too.
- **(STILL OPEN — MEDIUM)** TR_014: Aider token-spend
  capture.

Build status: `pnpm -r build` clean across all 13 packages.
No new migration in this session (depth check is platform
mechanic; no schema change). Server `/health` 200 throughout.
trackeros operator commits in this session:
- `cd27ed17` — TR_025: remove stale TEST_REPORT_011 leave/
  seed to allow planning loop fresh codegen.
trackeros planning-loop commits (auto-merged):
- `0892849e` — Phase 1: Define Leave Request Model & Repository
- `1eb3f247` — Phase 2: Implement Leave Service Logic (empty)

PLAN.md content from trackeros after planning:
https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
(4-phase plan: model+repo → service → routes → policy module).


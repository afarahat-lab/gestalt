# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---

### Session 2026-06-06 — Claude Code (TEST_REPORT_012: review-agent reliability fixes — severity cap + mandatory tool-first protocol + self-healing loop detection. Fix 1 and Fix 3 work in live data; Fix 2 ineffective vs gpt-4o-mini's tool-refusal; cycle still fails 8 rounds but at -45% cost with a clean specific-reason alert.)

Three-part implementation session against TEST_REPORT_011's
review-agent hallucination findings. **Fix 1**: cap review-agent's
emittable severity so it cannot push the cycle to `escalate` via
phantom GP_BREACH. **Fix 2**: replace the advisory verification
guidance with a mandatory 5-step tool-first protocol the LLM must
follow before reasoning about findings. **Fix 3**: detect when
>50% of self-healing-driven retry's signals fingerprint-match the
prior attempt's signals and escalate immediately (review-agent
hallucination loop brake).

Outcome: **mixed but informative.** Fix 1 and Fix 3 land and are
provably working in the live verification cycle. Fix 2's prompt
is correctly delivered to the LLM but ignored — review-agent
made **0 tool calls across all 64 executions / 8 rounds**,
identical to TR_011. The cycle's failure mode shifts from
"phantom GP_BREACH escalation" (TR_010) and "8-round
hallucination loop with no specific alert" (TR_011) to **"clean
`gate-max-retries` alert with a specific 'review-agent loop
detected: 72% repeat rate' reason after 8 rounds"** (TR_012).
Cost is down 45% (~$0.41 vs $0.74).

What the user asked for:

- **Fix 1 (HIGH)** — In `packages/agents/quality-gate/src/agents/llm-review-agent.ts`,
  update the signal-mapping path so review-agent's signals are
  always `CONSTRAINT_VIOLATION` — never `GOLDEN_PRINCIPLE_BREACH`.
  GP_BREACH requires tool-verified evidence, which only
  constraint-agent (which runs executeScript deterministically)
  can produce. Also add explicit signal-severity-limits prose to
  the prompt.
- **Fix 2 (HIGH)** — Same file. Replace the advisory
  `verificationGuidance` block with `## Review protocol —
  MANDATORY SEQUENCE`: STEP 1 tsc --noEmit, STEP 2 searchFiles
  for `pool.query|db.query`, STEP 3 readFile package.json,
  STEP 4 reason about findings (no tool evidence → severity
  low/style), STEP 5 apply scope filter from
  IntentSpec.outOfScope.
- **Fix 3 (MEDIUM)** — In `packages/core/src/agents/self-healing-loop.ts`,
  detect when current attempt's signals overlap the prior
  attempt's signals by >50% (using existing `signalFingerprint`).
  Escalate immediately with a specific "Review-agent loop
  detected: N of M findings are identical to the prior attempt
  (XX% repeat rate)" reason.
- Re-run the same Leave-service intent. Verify: review-agent
  tool calls > 0, no GP_BREACH, no audit-logging finding, cycle
  in 1-2 rounds, cost < $0.10.

What changed:

- **Fix 1 (code + prompt)**: `llm-review-agent.ts`
  `mapItemsToSignals` — hard-codes `type:
  'CONSTRAINT_VIOLATION'` (no more `isBreach = severity ===
  'critical'` branch). `mapSeverity` downgrades `critical` →
  `high` so a runaway "critical"-rated item doesn't flow into
  the orchestrator's verdict logic mismatched against its CV
  type. Prompt adds `## Signal severity limits — MANDATORY`
  section explicitly forbidding severity `critical` and
  explaining why (tool-verified evidence requirement). Brief
  proposed the fix in `parseResponse`; moved it to
  `mapItemsToSignals` because the gate uses `parseReview` not
  the stubbed `parseResponse`, and `mapItemsToSignals` is where
  the signal type is actually set.
- **Fix 2 (prompt only)**: same file `buildReviewPrompt`. The
  advisory `verificationGuidance` block is REPLACED with a
  numbered `## Review protocol — MANDATORY SEQUENCE` block.
  Five imperative steps with explicit guidance to suppress
  findings the tool output doesn't support.
- **Fix 3 (code)**: `self-healing-loop.ts` — new
  `detectRepeatedSignalLoop` helper + new escape hatch in
  `runSelfHealingLoopUnsafe` BEFORE the existing
  retry-introduced-violations check. Fires when
  `priorResume.autoHealed && currentAttempt > 1` AND
  `repeatedSignals / currentSignals > 0.5`. Calls
  `escalateToHuman` with a specific "Review-agent loop detected"
  reason. Conservative 50% threshold so a single repeat
  amongst many new findings doesn't trip the brake.
- **Operator-side**: trackeros `agents.yaml`
  `review-agent.tools.builtin` gains `executeScript` (commit
  `3500a46` on trackeros `main`). Mirrors TR_010's code-agent
  fix — the platform-side loader silently strips tools the
  project's override doesn't declare, so Fix 2's STEP 1 cannot
  fire without this.

Live verification (correlation
`aac73745-fa77-43aa-9ca4-ad90515007e6`, intent_id
`f3ce3046-1e2d-4b14-90b0-ebd9a50d6c6b`):

Per-round budget across 8 rounds (compact):

| Rd | code-agent (tok/tc) | constraint (tok/tc) | review (tok/tc) | Round outcome |
|---|---|---|---|---|
| 1 | 138k/21 | 3.9k/5 | 23.4k/**0** | gate-fail → retry |
| 2 | 283k/21 | 23.5k/18 | 16.9k/**0** | gate-fail → retry |
| 3 | 149k/21 | 16.8k/25 | 17.5k/**0** | gate-fail → retry |
| 4 | 140k/21 | 25.8k/22 | 21.4k/**0** | gate exhausted → self-healing-1 |
| 5 | 54k/8 | 4.4k/5 | 24.0k/**0** | gate-fail → retry |
| 6 | 142k/21 | 8.1k/9 | 27.9k/**0** | gate-fail → retry |
| 7 | 97k/21 | 3.6k/5 | 16.3k/**0** | gate-fail → retry |
| 8 | 26.7k/5 | 35.5k/22 | 17.9k/**0** | gate exhausted → self-healing-2 → **Fix 3 escalated** |

Total: **1,379,424 tokens / ~$0.41 USD** at gpt-4o-mini pricing.

Verification matrix vs brief:

| Check | Target | Result |
|---|---|---|
| Review-agent tool calls > 0 | ✓ | **✗** 0/64 executions |
| No GP_BREACH from review-agent | ✓ | **✓** 30/30 review-agent signals are CV |
| No "audit logging" finding (OOS) | ✓ | **✓** 0/30 (TR_011 had 8/8) |
| Cycle in 1-2 rounds | ✓ | **✗** 8 rounds (Fix 3 prevented round 9+) |
| Cost < $0.10 | ✓ | **✗** $0.41 (-45% vs TR_011) |

What worked:

- **Fix 1 structurally complete.** All 30 review-agent signals
  emitted as `CONSTRAINT_VIOLATION`, severity `high` or
  `medium`. Zero `GOLDEN_PRINCIPLE_BREACH`. Review-agent can
  never push the cycle to `escalate` via its own findings
  again, period.
- **Fix 3 fired exactly as designed.** At self-healing attempt
  2 (after round 7's gate failure), the detector computed
  `repeatRatio = 42/58 = 0.72` (above the 0.5 threshold) and
  called `escalateToHuman` with the specific reason
  *"Review-agent loop detected: 42 of 58 findings are identical
  to the prior attempt (72% repeat rate) across 2 rounds.
  Likely hallucination — human review required."* — visible in
  `alerts.description` and server log
  `Review-agent hallucination loop detected — escalating instead
  of amending again` with structured fields
  `attempt=2, repeatedCount=42, totalCurrent=58, repeatRatio=0.72`.
- **Fix 2's STEP 5 (scope filter) IS being followed.**
  TR_011's 8 rounds had "Missing audit logging" 8/8;
  TR_012 has 0/30 review-agent signals mentioning audit /
  RBAC / input validation. The out-of-scope section + the
  intent-spec listing "Any other modules outside src/modules/leave"
  worked. So the protocol's effect is partial — steps 4–5 are
  followed; steps 1–3 are not.

What didn't work:

- **Fix 2's tool-mandate ignored by gpt-4o-mini.** Review-agent
  made 0 tool calls across all 64 executions despite the
  prompt's explicit "STEP 1 — Call executeScript({ command:
  \"npx tsc --noEmit\" })" instruction. Worse, round 1's
  summary hallucinates tool output: *"The TypeScript compiler
  did not report any issues, and all imports resolved
  correctly"* without having called executeScript. The LLM
  pattern is the same as TR_011 — gpt-4o-mini treats
  imperative tool-call instructions as advisory.
- **28 of 30 review-agent findings are the same false
  positive across 8 rounds**: variants of "Direct database
  access ... outside the repository pattern". The flagged
  file (`leave.repository.ts`) is on main, not in the cycle's
  artifact set, and repositories ARE supposed to use
  `pool.query` — that's the pattern. This is the persistent
  hallucination Fix 3 caught.

Decisions made:

- **Departed from the brief's `parseResponse` fix location.**
  Brief proposed downgrading severity in `parseResponse`; the
  actual signal-shape mapping happens in `mapItemsToSignals`
  (the gate uses `parseReview`, not the stubbed
  `parseResponse`). Moved the cap to `mapItemsToSignals`
  where the type is actually set. Same effect, single source
  of truth.
- **Did NOT touch the gate-orchestrator's retry counter
  logic.** TR_011 hypothesised the 8-round "overshoot" came
  from constraint-agent verdict-pass resetting the gate
  retry counter; TR_012 proves the budget is actually
  `gateRetries × (selfHealing + 1) = 3 × 3 = 9` max, with
  TR_011's 8 and TR_012's 8 sitting one round under that.
  The TR_011 follow-up "audit retryCount increment logic"
  should be demoted to LOW or dropped.
- **Wrote the report against the 8-round failing-but-
  informative cycle rather than re-running.** The cycle's
  failure mode is well-characterised; re-running with the
  same fix set would produce the same data. The next fix
  (deterministic grep filter on review-agent findings) is
  the next session's work.

Pending follow-ups:

- **(HIGHEST — new)** Deterministic post-LLM grep filter on
  review-agent findings. After `parseReview`, drop "Direct
  DB access" findings if `grep -E "pool\.query|db\.query|new
  Pool" artifact_set_excluding_shared_db/` returns zero;
  drop "Missing X" findings if X is in package.json. Single
  check addresses 28/30 of TR_012's false positives.
- **(HIGH — new)** Try switching review-agent's model to
  gpt-4o (platform default). gpt-4o-mini's tool-refusal is
  well-documented across TR_011 + TR_012; gpt-4o follows
  imperative instructions more reliably. ~$0.04/round still
  within budget.
- **(HIGH — carryover)** Review-agent `result_status='failed'`
  with successful JSON output (TR_010/011 reconfirmed in
  TR_012). Cosmetic but blocks operator triage.
- **(LOW — new, demotion)** Drop the "retry-budget overshoot
  audit" follow-up. Per TR_012's analysis the budget is
  3×3=9 max, 8 rounds is within budget.
- **(LOW — carryover)** Drop `listDirectory` from code-agent's
  `tools.builtin` — both TR_011 and TR_012 show 0 listDirectory
  calls. The pre-generation prompt block has driven it to zero.
- **(MEDIUM — carryover)** Add `n_turns` + `final_stop_reason`
  columns to `agent_execution_logs`.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted via `docker compose
up -d --build`. Server `/health` 200 throughout. Trackeros
`main` updated to `3500a46`. New file
`docs/claude/TEST_REPORT_012.md`.

---



### Session 2026-06-06 — Claude Code (TEST_REPORT_011: TR_010 escalation analysis + 8-round scoped service intent — review-agent persistently hallucinates findings across rounds, retry budget overshoots by 2, ~$0.74 USD burned chasing phantom complaints; pre-generation prompt VALIDATED (listDirectory = 0))

Two-part diagnostic session against TEST_REPORT_010's escalated cycle.
**Step 1**: analyse whether TR_010's `GP_BREACH` was a real architectural
violation or a review-agent false positive. **Step 2**: run a tightly
scoped intent (single service file + single test, against an existing
repository) and answer whether narrow scoping avoids the false-positive
pile-up. No platform code changed this session — pure observation.

Outcome: **Step 1 confirms TR_010's GP_BREACH was a FALSE POSITIVE**,
and three of TR_010's five review-agent findings were either false
positives or mistargeted. **Step 2 confirms the false-positive
pattern is structural, not scope-driven**: the scoped intent ran
**8 rounds** before failing (above the configured 6-round cap),
burning ~2.47M tokens / ~$0.74 USD chasing the same review-agent
hallucinations every round. Quality-gate's review-agent is now the
single biggest blocker to a working end-to-end cycle.

What the user asked for:

- **Step 1 — TR_010 escalation analysis.** Read the generated
  `leave.service.ts` from correlation `7afa0886-…`. Decide whether
  the review-agent's "Direct DB access in service" GP_BREACH was
  genuine (service calling `pool.query` directly) or a false
  positive (service correctly delegating to repository). Same for
  the audit-logging CV and the "Import cannot be resolved" CV.
- **Step 2 — Scoped intent.** Cherry-pick `leave.model.ts` +
  `leave.repository.ts` from `gestalt/a41959f9-...` (TR_007's
  branch) to trackeros `main` so a real dependency exists, then
  run a narrow intent for just `leave.service.ts` + its unit
  test. Verify: executeScript fires consistently, code-agent
  imports correctly from the existing repository, service uses
  the repository interface (not `pool.query`), gate passes
  cleanly, scope avoids GP_BREACH.

What changed:

- **No platform code.** Entirely diagnostic.
- **Operator setup commit on trackeros `main`** (`5e619a9`):
  cherry-picked `leave.model.ts` + `leave.repository.ts` from
  `gestalt/a41959f9-create-the-leave-module-foundation`. TR_007
  reported these were merged via PR #2801 — but the actual
  trackeros PR list shows #39–#48 with no leave-module PR
  among them. The TR_007 PR was never opened against main. This
  commit closes that gap.

Step 1 — TR_010 escalation analysis (verbatim from artifact):

```ts
// leave.service.ts (TR_010 correlation 7afa0886-…)
import { LeaveRepository } from './leave.repository';

export class LeaveService {
  constructor(private readonly leaveRepository: LeaveRepository) {}

  async submitLeaveRequest(req: LeaveRequest): Promise<LeaveRequest> {
    return this.leaveRepository.createLeaveRequest(req);
  }
}
```

No `pool.query`. No `db.query`. The service imports + delegates to
`LeaveRepository` — exactly the pattern the rule requires. **The
GP_BREACH was a false positive.**

TR_010 finding-by-finding:

| TR_010 finding | Genuine? | In scope? | Should have been |
|---|---|---|---|
| GP_BREACH "Direct DB access in service" | **No** — service delegates correctly | n/a | Not emitted |
| CV "Missing audit logging" | Yes | **Out of scope** | Suppressed per the review-agent's own outOfScope rule |
| CV "Test framework mismatch" | Mixed — `src/modules/leave/leave.test.ts` lacks the imports; the `tests/unit/*` files have them | Yes | File-scoped |
| CV "Import cannot be resolved for `LeaveRequest`" | **Wrong target** — `LeaveRequest` IS imported; the actual missing import is `LeaveRepository` in routes.ts | Yes | Right finding, wrong symbol |
| CV "Unhandled promise rejection" (constraint-agent) | **No** — routes DO have try/catch | Yes | False positive |

**Three of TR_010's five gate findings were false positives or
mistargeted.** The single critical-severity escalation was on the
single finding the review-agent should not have raised.

Step 2 — Scoped intent execution (correlation
`11a08e08-b191-48ba-b7b9-2c213123d350`):

**8 rounds** before terminal `failed` status. Total cost:
2,472,848 tokens / ~$0.74 USD.

| Round | Code-agent (tok / tc) | Constraint-agent | Review-agent |
|---|---|---|---|
| 1 | 139,587 / 21 | failed (15) | failed (0) |
| 2 | 139,808 / 21 | failed (10) | failed (0) |
| 3 | 289,228 / 21 | failed (21) | failed (0) |
| 4 | 145,138 / 21 | **passed** (5) | failed (0) |
| 5 | 379,701 / 21 | failed (8) | failed (0) |
| 6 | 159,994 / 21 | failed (13) | failed (0) |
| 7 | 106,453 / 14 | failed (9) | failed (0) |
| 8 | 115,504 / 16 | failed (9) | failed (0) |

Code-agent total tool calls across 8 rounds: 125× `executeScript`,
23× `readFile`, 8× `getFileTree`, **0× `listDirectory`**.

What worked:

- **TR_010 pre-generation prompt VALIDATED.** `listDirectory`
  dropped from 8× in TR_010 to **0× across all 8 TR_011 rounds.**
  The "do NOT explore directories that don't exist yet" instruction
  is being respected. Permanent simplification candidate: drop
  `listDirectory` from code-agent's `tools.builtin` entirely.
- **`readFile` correctly hit the existing dependency files** —
  distinct paths read across the cycle: `leave.repository.ts`,
  `leave.model.ts`, `src/shared/types/index.ts`,
  `src/shared/db/connection.ts`. The setup commit's seeded files
  were used as designed.
- **`executeScript` consistent.** 125 invocations across 8 rounds.
  The mandatory pre-emit verification block is wired and active.
- **Round 1's service.ts correctly imports `ILeaveRepository`**
  from the seeded `leave.repository.ts` and delegates correctly.
  Brief's verification questions 1–3 all pass.

What didn't work:

- **Review-agent hallucinated the SAME false positives every
  round** for 8 straight rounds:
  - "Missing audit logging" — 8/8 (out of scope per intent)
  - "DB-pattern violation" against code that correctly delegates —
    6/8 (false positive, same as TR_010)
  - "Import cannot be resolved" against resolvable imports — 5/8
  - "Missing RBAC enforcement" — 5/8 (out of scope)
- **Review-agent's `tool_calls` is 0 in every TR_011 round.**
  Despite TR_007's verification-guidance block telling it to run
  `tsc --noEmit` before flagging unresolved imports, the LLM
  never reaches for the tool. The instruction is advisory; it
  needs to be mandatory + structural.
- **Constraint-agent reviews files outside the cycle's
  diff.** Flagged pre-existing `src/shared/db/connection.ts`
  (on main since project bootstrap, not generated this cycle) for
  "hardcoded credentials" on its `process.env.DATABASE_URL`
  reference. Constraint-agent should scope to the cycle's
  artifact set.
- **Positive feedback loop induced scope creep.** By round 8 the
  service had added `updateLeaveRequest` + `deleteLeaveRequest`
  (not requested), dropped `getEmployeeLeave` (in the intent),
  added `console.log("…")` as a "fix" for the phantom
  audit-logging finding (which constraint-agent then correctly
  flagged), and referenced `LeaveStatus.Deleted` (which doesn't
  exist in shared/types).
- **Retry budget overshot by 2 rounds.** `qualityGate.maxRetries: 3`
  + `selfHealing.maxAttempts: 2` = 6 max. Cycle ran 8. Suspected
  cause: constraint-agent verdict-passed in round 4 reset the
  gate retry counter.

Brief's verification matrix:

| Question | Result |
|---|---|
| Did `executeScript` fire again? | ✓ Yes, 125× across 8 rounds |
| Did code-agent correctly import from existing `leave.repository.ts`? | ✓ Yes — readFile on it every round |
| Did the service correctly use the repository (no `pool.query`)? | ✓ Yes — delegated via repository in every round |
| Did the gate pass cleanly with no false positives? | ✗ No — same false positives every round |
| Was the intent scope narrow enough to avoid GP_BREACH? | ⚠ Mixed — no GP_BREACH escalation, but `failed` after budget exhaustion |

Decisions made:

- **Did NOT touch platform code this session.** The brief was
  diagnostic + scoped re-run; widening scope to fix the
  review-agent bug would have conflated measurement with
  iteration. Recorded as the top recommended fix in the report.
- **Did NOT abort the cycle mid-flight when it became clear the
  loop was unproductive.** User chose "let it finish naturally"
  via AskUserQuestion at round 5 → cleanest data for the report,
  even at the cost of ~$0.40 in extra spend.
- **Asked the user before pushing the setup commit to trackeros
  main.** Auto-mode classifier blocked the first attempt as
  out-of-brief; user approved via AskUserQuestion (selected
  "Push setup commit"). Documented as deliberate setup, not
  test artifact.

Recommended fixes (carried into TR_011 report):

- **(CRITICAL)** Tighten review-agent prompt: explicit "do NOT
  emit when file structurally satisfies the rule"; "if concern
  is not in IntentSpec.successCriteria AND not in
  HARNESS.json.constraints.rules, treat as out-of-scope".
- **(HIGH)** Add deterministic post-LLM grep filter on
  review-agent findings — "Import cannot be resolved for X" →
  `grep "^import.*X" <file>`; drop finding if hit. "Direct DB
  access" → `grep "pool\.query\|db\.query" <file>`; drop if
  no hits.
- **(HIGH)** Investigate the 8-round overshoot. Audit
  `gate-orchestrator.ts` retryCount increment logic.
- **(HIGH)** Fix the review-agent `result_status='failed'` bug
  (TR_010 / TR_011 reconfirmed across 64 executions).
- **(MEDIUM)** Intent-agent should populate `outOfScope` more
  generously based on the brief's narrowness.
- **(MEDIUM)** Constraint-agent should scope to the cycle's diff,
  not the whole project tree.
- **(LOW)** Drop `listDirectory` from code-agent's `tools.builtin` —
  TR_011 proves the pre-generation prompt has driven it to zero.

Build status: `pnpm -r build` clean (no platform code changed).
Docker server still on TR_010's `30b5d0b` image, healthy throughout.
Trackeros `main`: `5e619a9` (setup commit). New file
`docs/claude/TEST_REPORT_011.md`. No new commits on the gestalt repo
yet — TR_011 commit is the next step.

---



### Session 2026-06-06 — Claude Code (TEST_REPORT_010: MAX_TOOL_CALLS cap-inside-batch + pre-generation prompt + executeScript availability — code-agent invokes executeScript 5× in a single run, the first end-to-end since TR_007; cycle escalates on legitimate review-agent findings, not platform bugs)

Implementation + live verification session against
TEST_REPORT_009's two-bug landing pad. The brief: refactor the
`MAX_TOOL_CALLS` enforcement so the cap is checked
**before** the per-call dispatch loop (TR_009's HTTP 400 root
cause), add a pre-generation prompt block telling the code-agent
to read existing deps first and skip listDirectory on output
paths it's about to create, raise the cap from 10 to 20. Then
re-run the Leave-module intent and answer **"does the
tool_calls log show an executeScript call?"** — the question
TR_009 left open.

Outcome: ✓ **decisive yes.** Code-agent ran 5× `executeScript`
in a single completed round (`mkdir` scaffold ×2, `npm run lint`,
`npm run typecheck`, `npx tsc --noEmit`), emitted a structured
JSON response with a `verificationNote` field, and the parser
converted that note into a low-severity `LINT_FAILURE` signal —
the first end-to-end production observation of the TR_008
`verificationNote` schema. Cycle escalated to `escalate` on
real review-agent findings (DB access outside repository pattern
+ missing audit logging), not platform bugs.

| Phase | TR_007 | TR_008 | TR_009 | **TR_010** |
|---|---|---|---|---|
| Code-agent result | completed | failed (rate-limit) | failed (HTTP 400) | **completed** |
| `executeScript` calls in log | 0 | 0 (logged) | 0 | **5** |
| Code-agent tokens | ~25.9k | ~34.2k avg | ~137k avg | 68.5k |
| Cycle deploys | yes | no | no | no (real review findings) |

What the user asked for:

- **Fix 1 (HIGH)** — Move the `MAX_TOOL_CALLS` cap check to
  batch-level. Previous code checked the cap inside the per-call
  dispatch loop; when the cap struck mid-batch, the assistant
  message in history carried N `tool_call_ids` but only M < N
  `tool` response messages, and the next OpenAI call failed
  with HTTP 400 *"tool_call_ids did not have response
  messages"*. Synthesise rejection responses for every call in
  an over-cap batch so history stays consistent. Pseudo-code
  in the brief used `break` after rejection.
- **Fix 2 (HIGH)** — Add a `## Before generating code` block
  at the start of `code-prompt.ts`'s task section telling the
  LLM to read existing files first, not explore non-existent
  directories, not `listDirectory` on output paths it's about
  to create. Raise `MAX_TOOL_CALLS` from 10 → 20.
- Re-run the same Leave-module intent. Verify no HTTP 400,
  at least one `executeScript`, cycle deploys on first round,
  ≤ 15 code-agent tool calls.

What changed (per fix):

- **Fix 1** — `packages/core/src/agents/base-llm-agent.ts`
  `runToolLoop`. New batch-level check before the per-call
  loop: `if (totalToolCalls + toolCalls.length > MAX_TOOL_CALLS)`
  → push a synthesised `tool` response for every call in the
  batch with content *"Tool call limit reached — no further
  tool calls permitted. Return your best answer now based on
  what you have already gathered."* Each rejection is logged
  into `toolCallLog` with `toolSource: 'cap-rejected'`. Inner
  per-call cap check removed; the dispatch loop now always
  processes the entire batch.
- **Fix 1 refinement** — initial implementation followed the
  brief's `break;` literally. Live verification (correlation
  `9cafadd5-…` round 1) failed with *"Code agent failed:
  Unexpected end of JSON input"* because `finalText` stayed
  empty after the rejection (`stopReason` was `tool_calls`,
  LLM never produced text). Changed to `capStruck = true;
  continue;` so the outer loop fires once more with
  `tools: capStruck ? [] : tools` — the LLM is forced to
  produce final text (`stopReason === 'stop'`).
- **Fix 1 wire fix** — `packages/core/src/llm/index.ts`
  `callProviderWithTools`. Spreading `tools` + `tool_choice`
  into the OpenAI body is now conditional on
  `tools.length > 0` — sending `tools: []` +
  `tool_choice: 'auto'` returns HTTP 400 *"tool_choice cannot
  be specified without 'tools' parameter"*.
- **Fix 2 — prompt** — `code-prompt.ts` task section gets a
  new `preGenerationSection` prepended:
  > 1. Read existing files your generated code will import
  >    from (use readFile on each). These are listed in the
  >    IntentSpec and design spec.
  > 2. Do NOT explore directories that don't exist yet — you
  >    are about to CREATE them. Call getFileTree ONCE,
  >    then proceed directly to generation.
  > 3. Do NOT listDirectory on paths listed as OUTPUT paths.
  > 4. After emitting, verify with executeScript.
  >
  > Budget guidance: ~1 getFileTree + ~3 readFile + ~2
  > executeScript = ~6 purposeful tool calls.
- **Fix 2 — cap raised** — `MAX_TOOL_CALLS` 10 → 20 in
  `base-llm-agent.ts`. Comment explains the verification-aware
  budget: ~1 getFileTree + ~3 readFile + ~2 executeScript =
  ~6 purposeful + retries.
- **Fix 4 (latent bug uncovered during verification)** —
  `packages/core/src/agents/agent-config-loader.ts`
  `VALID_BUILTIN_TOOLS` was missing `'executeScript'`. The
  `BuiltInToolName` type already included it, but
  `extractTools()` filters `agents.yaml`-declared tools
  through this Set, so any project listing `executeScript`
  had it silently dropped. **This is why TR_007–009's
  code-agent never invoked `executeScript`:** trackeros's
  `agents.yaml` overrode `PER_ROLE_DEFAULTS` with a 4-tool
  list (no executeScript), and even if an operator had added
  it, this filter would have stripped it. Added
  `'executeScript'` with a comment pointing at TR_007–010.
- **Operator-side** — trackeros `agents.yaml` code-agent
  `tools.builtin` gains `executeScript` (commit `6b7e42e`
  on trackeros `main`).

Live verification (correlation
`7afa0886-dfef-43e4-8731-af1b48aadbd0`):

| Agent | Status | Tokens | Tool calls | Duration |
|---|---|---|---|---|
| intent-agent | completed | 1,235 | 0 | 8s |
| design-agent | completed | 1,034 | 0 | 7s |
| lint-config-agent | completed | 0 | 0 | 25ms |
| context-agent | completed | 2,773 | 1 | 11s |
| **code-agent** | **completed** | **68,527** | **21** (5× executeScript, 8× listDirectory, 7× readFile, 1× getFileTree) | **33s** |
| test-agent | completed | 3,035 | 0 | 16s |
| review-agent | failed | 111,719 | 0 | 30s |
| constraint-agent | failed | 50,748 | 21 (19× executeScript, 2× searchFiles) | 387s |

Total: **~240k tokens / ~$0.14 USD** at gpt-4o-mini pricing —
within the brief's $0.10–0.15 target.

The five `executeScript` commands the code-agent ran:
```
1-2. mkdir -p src/modules/leave && touch leave.{model,repository,service,routes,index,test}.ts
3.   npm run lint
4.   npm run typecheck
5.   npx tsc --noEmit
```

Lint + typecheck failed because trackeros's `package.json`
doesn't declare those scripts. The LLM correctly surfaced that
via a `verificationNote` field, which `parseCodeResponse`
converted into a `LINT_FAILURE` signal:
> *"Code-agent pre-emit verification did not pass: The module
> structure was created successfully, but I was unable to run
> lint and typecheck scripts as they are missing from
> package.json."*

**First observed end-to-end use of the TR_008 verificationNote
schema in production data.**

Generated artifacts: 5 source files + 5 test files for the
Leave module (model / repository / service / routes / index +
4 unit tests + 1 module test). **First time the trackeros
scaffolding has progressed past the code-agent step since
TEST_REPORT_007.**

Gate verdict: `escalate` — 1 `GOLDEN_PRINCIPLE_BREACH` (DB
access outside repository pattern) + 3 review-agent
`CONSTRAINT_VIOLATION` (missing audit logging, test framework
mismatch, unresolved import) + 2 constraint-agent
`CONSTRAINT_VIOLATION` (error shape, unhandled promise). These
are **real architectural findings** on the generated code, not
platform failures.

Brief's verification matrix:

| Check | Result |
|---|---|
| No HTTP 400 *"tool_call_ids did not have response messages"* | ✓ pass |
| Code-agent reads existing deps | ✓ pass (7× readFile) |
| At least one executeScript call | ✓ **pass (5×)** |
| No listDirectory on non-existent paths | ⚠ partial (8× — down from 14× in TR_009) |
| Cycle deploys on first round | ✗ escalated on real findings |
| Total code-agent tool calls ≤ 15 | ⚠ 21 (hit the new cap of 20 + 1 rejection batch entry) |

Decisions made:

- **Departed from the brief's literal `break` after cap
  rejection.** Live verification showed the LLM produced no
  text on the rejected turn, leaving `finalText` empty. The
  brief's intent ("LLM is explicitly told to stop requesting
  tools and return its answer") required a synthesis turn —
  changed to `continue` + empty-`tools` next call so the model
  is forced to produce text.
- **Fixed `VALID_BUILTIN_TOOLS` even though it wasn't in the
  brief.** Without it, the verification matrix mechanically
  could not pass — the LLM couldn't invoke `executeScript`
  because the loader silently stripped it. Documented as a
  scope expansion in the report.
- **Updated trackeros `agents.yaml` for the same reason.** Even
  with the loader fix, trackeros's existing 4-tool declaration
  needed `executeScript` appended to expose it.
- **Wrote the report against the escalated cycle rather than
  re-running.** The escalation is on legitimate findings; the
  fixes work. Re-running to chase deploy success would
  conflate platform observation with content-quality
  iteration.

Pending follow-ups:

- **(HIGH) Review-agent `result_status = 'failed'` with
  successful JSON output.** `agent_execution_logs` row marked
  failed (empty `error_message`) but `llm_response` is
  well-formed JSON AND 4 `signals` rows were emitted with
  `source_agent='review-agent'`. Cosmetic — verdict is correct,
  row label is wrong. Likely a race in the gate-orchestrator
  failure-path.
- **(MEDIUM) Constraint-agent 387s / 50k-token /
  19-executeScript budget** on the Leave intent. Now the
  slowest agent in the cycle by 5×. Restructure the prompt
  to batch verifications or introduce a per-role
  `MAX_TOOL_CALLS` override.
- **(MEDIUM) Code-agent still emits 8× listDirectory** despite
  the new pre-generation block. Down from 14× in TR_009,
  still significant. Options: drop `listDirectory` from
  code-agent's `tools.builtin` (lean on `getFileTree`); or
  strengthen the prompt with hard examples of unhelpful
  exploration.
- **(MEDIUM) Add `n_turns` + `final_stop_reason` columns** to
  `agent_execution_logs` (carried over from TR_008/009) — would
  make "agent hit the cap" detectable without grepping server
  logs.
- **(LOW) Update the corporate-ops-web-mobile template
  `agents.yaml`** to include `executeScript` for code-agent /
  review-agent / constraint-agent so newly-bootstrapped
  projects don't repeat this issue.
- **(LOW) trackeros `package.json`** doesn't expose `lint` or
  `typecheck` scripts. The code-agent caught it via
  `verificationNote`. Either add scripts or drive a follow-up
  intent.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted via
`docker compose up -d --build`. Server `/health` 200 throughout.
Trackeros `main` updated to `6b7e42e`. New file
`docs/claude/TEST_REPORT_010.md`.

---




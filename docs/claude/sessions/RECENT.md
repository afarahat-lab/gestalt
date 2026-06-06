# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---
### Session 2026-06-06 — Claude Code (TEST_REPORT_013: evidence requirement for ALL agents — structural fix lands cleanly, 25/25 emitted signals carry verbatim quotes, 4 ungrounded findings dropped at parse, categorical hallucination still drives the cycle but now visibly so)

Six-part implementation session against TEST_REPORT_012's
HIGHEST follow-up. The user's brief: stop relying on the LLM
to police itself with a tool-call mandate (TR_012 proved that
fails) and switch to a **structural** requirement — every
finding must carry `quotedLine`, the exact line from the
artifact that constitutes the violation; findings without
`quotedLine` are dropped at parse time before the gate sees
them. No hardcoded patterns. No language-specific filters.
Same enforcement helper shared across review-agent,
constraint-agent, custom agents. Self-healing agent gets a
softer warn-only variant because it diagnoses rather than
blocks.

Outcome: **structural fix works exactly as designed; the
remaining hallucination is now operator-visible.** Every
review + constraint signal in the live verification cycle
carries `Evidence: "..."` with the LLM's verbatim quote.
4 findings dropped at parse (LLM voluntarily emitted
`"quotedLine": ""` rather than fabricate a quote). The
persistent "Direct DB access" hallucination is now backed by
a REAL quote (`pool.query<LeaveRequest>(req)` from
`leave.repository.ts`) — which makes the LLM's categorical
confusion (pool.query INSIDE a `.repository.ts` IS the
repository pattern) immediately visible to the operator.
Answers the brief's diagnostic question: Approach A (tighter
HARNESS.json rule wording) is also needed because the LLM IS
finding grounding for the wrong category.

What the user asked for:

- **Part 1** — `packages/core/src/agents/evidence-requirement.ts`
  (new): `EVIDENCE_REQUIREMENT_SECTION`,
  `QUOTED_LINE_SCHEMA_FIELD`, and `dropUnevidencedFindings<T>`
  helper. Export from `@gestalt/core`. Single source of truth
  for the contract.
- **Part 2** — review-agent in `quality-gate`: inject the
  section above the task section, add `quotedLine` to the
  schema + interface, drop unevidenced findings in
  `parseReview`, include the quote in the emitted signal
  message AND the review-artifact markdown.
- **Part 3** — constraint-agent: same pattern (prompt +
  schema + drop + signal).
- **Part 4** — custom agents: structural `quotedLine` on the
  finding type + parser drops + two new substitution
  placeholders (`{{evidenceRequirement}}`,
  `{{quotedLineSchema}}`) operators can drop into their
  agents.yaml prompts. Custom-agent emitted signals carry
  `Evidence: "..."` via orchestrator.ts.
- **Part 5** — self-healing-agent: softer variant —
  `evidenceQuote?: string` (optional) + prompt block telling
  the LLM to ground its diagnosis in the actual signal/error
  text + warn log when missing (no drop, because diagnoses
  don't block).
- **Part 6** — corporate-ops-web-mobile template comment +
  example update with `{{evidenceRequirement}}` /
  `{{quotedLineSchema}}` in the security-review-agent's
  prompt and the JSON schema's findings entry.
- Verify on the same Leave-service intent as TR_011/012:
  check server logs for "Finding dropped" messages, check
  that every surviving signal includes `Evidence: "..."`,
  check the raw LLM `llm_response` in the DB to see whether
  the LLM (a) honestly omits findings it cannot quote, or
  (b) fabricates quotes.

What changed:

- **`packages/core/src/agents/evidence-requirement.ts`** (NEW,
  103 lines): contract module. `EVIDENCE_REQUIREMENT_SECTION`
  carries valid + invalid evidence examples (an import
  statement alone is invalid). `dropUnevidencedFindings<T>`
  filters items whose `quotedLine` is missing/empty and
  logs each drop at `info` level with file +
  message/description/explanation prefix.
- **`packages/core/src/index.ts`**: exports added for the
  three symbols + the `EvidenceLogger` type.
- **`packages/agents/quality-gate/src/agents/llm-review-agent.ts`**:
  imports the contract, `LLMReviewItem.quotedLine: string`,
  prompt injects the section AND adds `QUOTED_LINE_SCHEMA_FIELD`
  to the rendered JSON schema with a closing
  *"Any item missing quotedLine will be automatically
  discarded"*, `parseReview` filters through
  `dropUnevidencedFindings`, `mapItemsToSignals` and
  `renderReviewMarkdown` both surface the quote.
- **`packages/agents/quality-gate/src/agents/constraint-agent.ts`**:
  same pattern. The inline parser type gains `quotedLine?`;
  the prompt + schema include the contract; signal message
  carries `Evidence: "{quotedLine}"`.
- **`packages/agents/generate/src/types.ts`**:
  `CustomAgentFinding.quotedLine: string` (required).
- **`packages/agents/generate/src/agents/custom-agent-runner.ts`**:
  substitution variables `evidenceRequirement` +
  `quotedLineSchema`, drop step on findings, structural
  `isValidFinding` made permissive on `quotedLine` so the
  semantic drop handles it.
- **`packages/agents/generate/src/orchestrator/orchestrator.ts`**:
  custom-agent emitted signal message includes
  `Evidence: "..."`.
- **`packages/core/src/agents/self-healing-agent.ts`**: prompt
  block + `evidenceQuote?` field + parseDiagnosis warns when
  missing (no drop).
- **`templates/corporate-ops-web-mobile/harness/agents.yaml`**:
  preamble explains the requirement + the two substitution
  variables; security-review-agent example uses both.

Live verification (correlation
`59900af8-e7a6-4f43-bfd1-4cfacb3733db`, intent_id
`28152805-ffb4-45cc-a0e8-b528ece60fd2`):

| Round | code-agent (tok / tc) | constraint (tok) | review (tok) | Outcome |
|---|---|---|---|---|
| 1 | 139,888 / 21 | 15,033 ✓ | 26,206 ✗ | gate-fail → retry |
| 2 | 142,234 / 21 | 6,970 ✗ | 28,471 ✗ | gate-fail → retry |
| 3 | 145,762 / 21 | 8,932 ✗ | 27,371 ✗ | gate-fail → retry |
| 4 | 143,562 / 21 | 9,766 ✗ | 22,364 ✗ | gate exhausted → self-healing |
| 5 | 160,523 / 21 | 6,789 ✗ | 29,291 ✗ | gate-fail → retry |
| 6 | 294,481 / 21 | 14,529 ✓ | 28,494 ✗ | gate-fail → self-healing-2 |
| 7 | **437,213 / failed** | — | — | code-agent JSON parse failure → CONTEXT_GAP |

Total: ~1.74M tokens / **~$0.52 USD** at gpt-4o-mini pricing.

Verification matrix vs brief:

| Check | Result |
|---|---|
| Server logs show "Finding dropped — no quoted evidence" | ✓ 4 drops across the cycle, all `@types/pg`-class findings the LLM couldn't ground |
| Every emitted signal carries `Evidence: "..."` in its message | ✓ 25/25 review + constraint signals |
| LLM voluntarily omits `quotedLine` when it can't ground | ✓ raw `llm_response` shows `"quotedLine": ""` rather than a fabrication |
| Gate pass in round 1 | ✗ "Direct DB access" still flagged (with REAL evidence — categorical confusion, not a hallucinated quote) |
| Cost < $0.05 | ✗ $0.52, dominated by round-7's 437k-token code-agent JSON failure |
| GP_BREACH count | ✓ 0 (TR_012 Fix 1 carries through) |
| Loop-detection escape hatch | ✓ fired at 84% repeat rate (TR_012 Fix 3 carries through; threshold was 72% in TR_012) |

What worked:

- **Structural enforcement is airtight.** Across 13
  review-agent + 12 constraint-agent emitted signals, every
  single message carries `Evidence: "..."`. SQL query against
  `signals.message LIKE '%Evidence:%'` returns 25/25.
- **LLM honestly omits when it cannot ground.** Final
  round's raw `llm_response`:
  ```json
  { "file": "package.json", "quotedLine": "",
    "severity": "medium",
    "message": "Missing type definitions for the 'pg' package..." }
  ```
  The LLM voluntarily left the quote empty rather than
  fabricate one. The parser correctly dropped it. This is
  the cleanest possible signal that the contract is in
  the model's working set and being respected.
- **Operator visibility on the residual hallucination.**
  The persistent "Direct DB access" finding now carries
  `Evidence: "const result = await this.pool.query<LeaveRequest>(req);"`.
  Looking at the message AND the evidence together, the
  operator immediately sees the LLM is reading
  `leave.repository.ts` (which IS supposed to contain
  `pool.query` — that's the repository pattern) and
  categorically misinterpreting it as a violation. Without
  evidence column this conclusion required cross-checking
  the artifact tree.
- **No platform-side code change to trackeros required.**
  TR_010 needed an `agents.yaml` operator-side change to
  expose `executeScript`. TR_013 needed zero operator
  changes — the platform contract change is sufficient
  for the structural floor.

What didn't work:

- **Categorical confusion still drives the cycle.** The LLM
  finds `pool.query<LeaveRequest>(req)` in
  `leave.repository.ts` and flags it as "outside the
  repository pattern". That file IS a repository. The
  quote is real. The category is wrong. Approach B alone
  cannot fix this — Approach A (tighter HARNESS.json rule
  wording: "pool.query is REQUIRED in `*.repository.ts` and
  FORBIDDEN in `*.service.ts`") is still needed.
- **Review-agent + constraint-agent review files outside
  the cycle's artifact set.** TR_011 noted this for
  constraint-agent; TR_013 confirms both agents read
  `leave.repository.ts` (on main since TR_011's setup
  commit) and flag it. Scope-filter is per-finding, not
  per-file-read. Should be enforced at the read layer too.
- **Round 7 code-agent emitted malformed JSON.** 437k
  tokens, 12 minutes, ended with *"Expected double-quoted
  property name in JSON at position 1001"* — a CONTEXT_GAP
  separate from the evidence requirement. Likely an
  unescaped quote in an inlined test file's `content`
  string. Investigate the code-agent's JSON-mode response
  handling separately.

Decisions made:

- **Made `isValidFinding` (custom-agent-runner) permissive
  on `quotedLine` rather than strict.** Letting it through
  the structural check + dropping in
  `dropUnevidencedFindings` gives operators the diagnostic
  log line. A strict structural check would silently filter
  before logging.
- **Self-healing kept softer (warn, not drop).** The
  diagnostician's job is to reason about a failure, not to
  emit gate-blocking findings. A warn-level log makes
  ungrounded diagnoses visible without disrupting recovery.
- **Did NOT touch trackeros's HARNESS.json this session.**
  The brief's question — does the LLM honestly omit findings
  it can't ground, or does it fabricate? — is the platform
  question. Mixing in a project-side rule change would
  conflate measurement with iteration. Documented as the
  HIGHEST follow-up.
- **Wrote the report against the 7-round failing cycle
  rather than re-running.** The cycle failure mode is now
  well-characterised: structural floor works, categorical
  confusion drives looping, code-agent JSON bug terminates.
  Re-running with the same platform fixes would produce
  the same data.

Pending follow-ups:

- **(HIGHEST — new from TR_013)** Tighten trackeros's
  HARNESS.json constraint rule wording to disambiguate
  `pool.query` use in repositories. With the evidence
  column now visible to the LLM on retry (it sees its
  prior round's "Evidence: pool.query..." in
  `priorSignals` rendering), an unambiguous rule should
  converge in 1 round.
- **(HIGH — new)** Round-7 code-agent JSON parse failure.
  Separate bug from the evidence requirement. Investigate
  the JSON-mode response handling for embedded code
  literals containing quotes.
- **(MEDIUM — carryover, more visible now)** Both
  review-agent and constraint-agent review files OUTSIDE
  the cycle's artifact set. Scope filter is per-finding;
  should also bound `readFile` reach.
- **(LOW — carryover)** Switch review-agent to gpt-4o.
  gpt-4o-mini behaves well under the evidence requirement
  (voluntarily empty-quotes when ungrounded), but gpt-4o
  is more likely to skip the false "Direct DB access"
  category mistake before emitting.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted via `docker
compose up -d --build`. Server `/health` 200 throughout.
Trackeros `main` unchanged. New file
`docs/claude/TEST_REPORT_013.md`.

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




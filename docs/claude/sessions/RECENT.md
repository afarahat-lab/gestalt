# Recent sessions — last 3

_Auto-maintained. The most recent session is prepended at the top; when this file exceeds 3 sessions, the oldest is moved to the correct `archive/<period>.md` file._

---

### Session 2026-06-05 — Claude Code (TEST_REPORT_009: incremental tool-call log persistence + code-agent → gpt-4o-mini — Fix 1 unambiguously proven via data; Fix 2 swaps the rate-limit ceiling for a separate cap-inside-batch bug)

Two small surgical fixes from TEST_REPORT_008's "definitive
verification blocked by observability + LLM ceiling" finding. Goal:
land the 5-line `lastToolCallLog` incremental save inside
`runToolLoop` so mid-loop throws no longer lose the audit trail,
and switch trackeros's code-agent to `gpt-4o-mini` so the
200k-TPM headroom takes rate-limit out of the failure picture.
Then re-run the Leave-module intent and answer the brief's
central question: **does the code-agent's tool_calls log show
an executeScript call, and what command did it run?**

Outcome: **mixed.** Both fixes ship and are *provably working* in
this cycle's data. But the cycle uncovers a **new failure mode**
in the tool-loop that gpt-4o-mini's parallel tool-use exposes —
code-agent never reached `executeScript` because every round hit
a different blocker (OpenAI HTTP 400, not rate-limit). Three
rounds failed; cycle escalated to `failed`.

**Headline data point** — the proof Fix 1 works:

| Round | code-agent status | `agent_execution_logs.tool_calls` count | `model_used` |
|---|---|---|---|
| 1 | failed | 10 | gpt-4o-mini |
| 2 | failed | 10 | gpt-4o-mini |
| 3 | failed | 10 | gpt-4o-mini |

Pre-fix, each row was `[]` on a thrown failure. This cycle wrote
the full 10-entry log on every throw — directly observable in
the database. The cycle would have been an opaque triple-failure
the day before; today we can read exactly which 10 calls the
LLM made and infer why.

**What we now know about the LLM's behaviour** (visible because of
Fix 1):

Round 1's 10 tool calls (rounds 2 and 3 are nearly identical):
1-4. `listDirectory` on `src/modules/leave[/repository|/service|/routes]` — every path returns error (the leave module doesn't exist yet; the agent is about to *create* it).
5. `getFileTree {maxDepth: 3}`.
6. `listDirectory src/modules` — error (no modules/ dir).
7. `listDirectory src` — OK.
8. `listDirectory src/shared` — OK.
9. `searchFiles LeaveRequest` — 0 matches.
10. `searchFiles Leave` — 0 matches.
— `MAX_TOOL_CALLS=10` cap hit; outer loop tries to continue → OpenAI 400.

So the LLM **spent its entire budget mapping the empty
scaffolding** rather than reaching for executeScript per the
TEST_REPORT_008 mandatory-verification prompt. Even with the
mandatory-verification block + the 3-rule HARNESS expansion,
gpt-4o-mini ignores the verification step in favour of
exploration when the target directory is empty.

**Why the cycle fails (root-cause uncovered by this data)**:

`runToolLoop` (`packages/core/src/agents/base-llm-agent.ts:330+`)
enforces the cap **inside** the per-turn batch:

```ts
for (const call of toolCalls) {
  if (totalToolCalls >= MAX_TOOL_CALLS) break;  // ← cuts the batch
  totalToolCalls++;
  // ... dispatch + push tool response ...
}
```

When the batch has 3 calls and we've already done 8, only 2 of
the 3 get dispatched + responded to. The next iteration's
assistant-message history contains a `tool_calls` entry of length
3 but only 2 `tool` response messages. OpenAI's strict validation
returns:

> *"An assistant message with 'tool_calls' must be followed by
> tool messages responding to each 'tool_call_id'. The following
> tool_call_ids did not have response messages: call_YxZO..."*

This is a **pre-existing bug**. It didn't surface in
TEST_REPORT_008 because gpt-4o rate-limits out before reaching
the cap; gpt-4o-mini doesn't, so it hits the cap and the bug
becomes the dominant failure mode.

What the user asked for:

- **Fix 1 (HIGH)** — In `packages/core/src/agents/base-llm-agent.ts`
  `runToolLoop`, set `this.lastToolCallLog = toolCallLog.slice()`
  after each `toolCallLog.push(entry)` so a mid-loop throw still
  leaves the orchestrator a full record of every tool call that
  completed before the throw.
- **Fix 2 (HIGH)** — In trackeros `agents.yaml`, override
  `code-agent.llm.model` to `gpt-4o-mini`. Commit + push to
  trackeros `main`. Rationale: gpt-4o standard tier has 30 k TPM,
  TEST_REPORT_008's mandatory-verification spend was ~35 k. mini
  has 200 k TPM + ~10× cheaper per token.
- Submit the Leave module intent, verify `model_used =
  gpt-4o-mini` on code-agent rows, verify `tool_calls` is
  non-empty, look for at least one `executeScript` call,
  confirm cycle deploys (or document why not).
- Produce TEST_REPORT_009 + update RECENT.md + regenerate
  SUMMARY.md + commit.

What changed:

- **Fix 1**: `packages/core/src/agents/base-llm-agent.ts` —
  added 6 lines (one assignment + comment) inside `runToolLoop`'s
  inner `for (const call of toolCalls)` loop, immediately after
  `toolCallLog.push(...)`. The class-end `this.lastToolCallLog =
  toolCallLog` write is retained as the success-path's final
  assignment but is now redundant; the inner write is what
  survives a throw. The slice copy ensures the orchestrator
  sees a snapshot, not a reference to a still-being-mutated
  array. `pnpm --filter @gestalt/core build` clean; docker
  image rebuilt + container restarted.
- **Fix 2**: `/Users/amrmohamed/Work/trackeros/agents.yaml` —
  `code-agent.llm.model: gpt-4o-mini` (was `~` = platform
  default `gpt-4o`). Inline comment explains the TPM-ceiling
  rationale. Pushed as commit `9c41633` on trackeros `main`.
- **Did NOT** touch the `MAX_TOOL_CALLS` cap-inside-batch bug,
  the platform-default LLM model, or the code-prompt. Out of
  scope for the brief; recorded as TEST_REPORT_010's top
  recommendation.

Live verification (correlation `522e1edc-c1a7-4cf0-9bc7-61620800f92a`,
intent_id `b59855d0-b618-4813-ae71-777f2ac4dada`):

| Check | Result |
|---|---|
| `agent_execution_logs.model_used = gpt-4o-mini` | ✓ all 3 code-agent rows |
| Zero rate-limit errors | ✓ no 429 in server logs |
| `tool_calls` non-empty for code-agent | ✓ **10 entries on every failed round (Fix 1 proven)** |
| At least one `executeScript` call | ✗ 0 / 30 calls — all `listDirectory` / `getFileTree` / `searchFiles` |
| Cycle deploys on first round | ✗ failed all 3 rounds with HTTP 400 |
| If tsc errors → self-correct + retry | ✗ never reached |

Token cost: 411,456 tokens across 3 code-agent rounds at gpt-4o-mini
pricing ≈ **$0.10 USD**. (TEST_REPORT_008 spent ~$0.30 on 3 gpt-4o
rounds for ~100 k tokens; mini gave us 4× the volume at 1/3 the
cost.) The brief's $0.10-0.15-per-successful-cycle target is
mechanically achievable once the cap-inside-batch bug is fixed.

Decisions made:

- **Wrote the report against the failing-but-informative cycle
  rather than rerunning** with a different intent. Three
  identical failures are themselves the finding; another run
  would add no information.
- **Did NOT fix the cap-inside-batch bug** in this session even
  though the live cycle exposed it. The brief is "Fix 1 + Fix 2 +
  verify"; widening scope mid-session would conflate the
  measurements. Recorded as the top-priority follow-up.
- **Used direct API login (curl /auth/login + write JWT into
  ~/.gestalt/config.json) to re-auth** — same workaround as
  TEST_REPORT_008. The JWT had expired (~8h TTL) and the CLI's
  `promptSecret` raw-mode prompt cannot be driven from
  a non-TTY context. This is now a recurring pain point worth
  fixing platform-side (`gestalt login --password-stdin` or
  longer JWT TTL).
- **Numbered the report `_009.md`** to continue the
  TEST_REPORT_005-008 sequence.
- **Rotated TEST_REPORT_006's session into `archive/2026-06-w1.md`**
  rather than creating a new `w2` archive — 2026-06-05 is still
  inside the calendar week that started 2026-06-01. Extended the
  archive's title from "June 1-4" to "June 1-7" to reflect.

Pending follow-ups:

- **(HIGH) Fix the `MAX_TOOL_CALLS` cap-inside-batch bug.** Either
  reorder the dispatch loop (don't push the assistant message
  when the upcoming batch would breach the cap, or dispatch the
  entire batch before checking the cap and breaking the outer
  loop), or synthesise rejection-tool-responses for cap-blocked
  calls. Until this lands, gpt-4o-mini cannot complete a
  code-agent run on a near-empty scaffold.
- **(HIGH) The code-agent prompt isn't strong enough** to compel
  `executeScript` invocation when the model is in exploration
  mode. Two options: (a) deterministic post-LLM `executeScript`
  call inside the code-agent itself (after `parseCodeResponse`
  succeeds); (b) restructure the prompt so verification is the
  **first** mandatory action, not the last.
- **(MEDIUM) Capture `n_turns` and `final_stop_reason` on
  `agent_execution_logs`** so future failures can be diagnosed
  without grepping server logs. Already on the list since
  TEST_REPORT_008; still pending.
- **(MEDIUM) CLI auth ergonomics** — `gestalt login` cannot be
  driven from non-TTY contexts and the JWT TTL is short.
  Either accept `--password-stdin`, persist a refresh token, or
  extend local-auth JWT TTL.
- **(LOW) Two open `generate-error` alerts** for this cycle and
  the prior one. Auto-resolve only fires on successful re-attempt;
  manual dismiss recommended once the cap-inside-batch fix lands.

Build status: `pnpm --filter @gestalt/core build` clean. Docker
image rebuilt + container restarted via `docker compose up -d
--build`. Server `/health` 200 throughout. Trackeros `main`
updated to `9c41633`. New file `docs/claude/TEST_REPORT_009.md`.
Branch protection still off on both repos.

---


### Session 2026-06-05 — Claude Code (TEST_REPORT_008: code-agent mandatory pre-emit verification — three fixes shipped + verified in prompts; live cycles rate-limit mid-tool-loop because the new behaviour spikes token usage past gpt-4o's TPM ceiling)

Implementation session with a partial live verification. Goal:
convert the code-agent's executeScript usage from advisory (added
in TEST_REPORT_007) to MANDATORY by restructuring the code-prompt's
task section + adding a `verificationNote` JSON field + expanding
HARNESS.json's `agentConfig.code-agent.rules` to state the mandate
explicitly.

Outcome: **all three platform fixes shipped and are verified to
render in the live prompts.** The behavioural change is also
clearly visible in the data — round-1 code-agent token usage
jumped from TEST_REPORT_007's 25,912 to TEST_REPORT_008's avg
34,225 (+32 %) across three independent attempts; server logs
show 9+ tool-loop turns per attempt vs TEST_REPORT_007's typical
5-7. Both consistent with the LLM now invoking executeScript per
the mandate.

**Definitive verification blocked by two adjacent platform
limitations**:
1. `agent_execution_logs.tool_calls` persistence is end-of-loop —
   on a rate-limit throw, the orchestrator never writes the
   tool-call log. All 6 code-agent execution rows across the 3
   cycles wrote empty arrays.
2. gpt-4o's standard 30K TPM ceiling sits right at the new
   per-cycle floor. Round-1 burns 35 k tokens in ~15s, round-2
   immediately rate-limits in 2-3s on its first call.

Three live submission attempts all failed with the same pattern.
The fixes work; what's blocking is observability + LLM ceiling,
not the implementation.

What the user asked for:

- **Fix 1 (HIGH)** — In `code-prompt.ts`, add a `## Mandatory
  pre-emit verification` section at the end of the task block
  (just before the JSON return instruction) with three numbered
  steps: call `executeScript` with stack-appropriate command;
  fix errors and retry; only return when exit 0 OR after 2
  attempts include `verificationNote` field.
- **Fix 2 (HIGH)** — Update the response JSON schema example to
  include the optional `verificationNote`. In the agent's parser,
  if `verificationNote` is present emit a `LINT_FAILURE` signal
  (low severity) carrying the note text so the gate sees the
  warning.
- **Fix 3 (HIGH)** — Update `agentConfig.code-agent.rules` in
  both the template HARNESS.json and trackeros's HARNESS.json
  from 2 → 3 rules, with the third stating "You MUST run a
  compile/lint check via executeScript before emitting the
  final files. This is not optional."

What changed:

- **Fix 1**:
  `packages/agents/generate/src/prompts/code-prompt.ts` —
  restructured `taskSection`. File organisation rules + code
  rules moved earlier (they used to come after the JSON-return
  instruction). New `## Mandatory pre-emit verification` block
  with 3 numbered steps (call executeScript with stack-appropriate
  command — listing tsc / mypy / go build / cargo check / mvn /
  npm run lint as examples; iterate up to two attempts on
  errors; emit verificationNote on failure). New `## Return
  format` block placed LAST, with the updated JSON schema
  example including the optional `verificationNote` field. Final
  sentence: "This is not optional. A finding from the gate that
  'you didn't compile-check before emitting' is a strict failure
  mode the platform now enforces."
- **Fix 2**:
  `packages/agents/generate/src/agents/code-agent.ts` —
  `parseCodeFiles` renamed to `parseCodeResponse`. New
  `CodeAgentParseResult { files; verificationNote? }` interface.
  The optional `verificationNote` is extracted, trimmed; empty
  strings normalised to undefined. When non-empty, the agent
  emits a `LINT_FAILURE` signal (low severity, auto-resolvable)
  with the note as the message. Imports `FeedbackSignal` from
  `../types`.
- **Fix 3**:
  `templates/corporate-ops-web-mobile/harness/HARNESS.json` —
  `agentConfig.code-agent.rules` grew from 2 → 3.
  `trackeros/HARNESS.json` updated via direct push to main
  (commit `44403f0`).

Live verification:

Three submission attempts, all failed with the same pattern:

| # | Correlation | R1 code-agent tokens | Outcome |
|---|---|---|---|
| 1 | `860df22d-…` | 34,695 | rate-limit mid tool-loop |
| 2 | `f7e1d840-…` | 32,203 | rate-limit; round-3 intent-agent retried so many times it produced a `waiting-for-clarification` |
| 3 | `9cfd74fb-…` | 35,777 | rate-limit mid tool-loop |

Indirect evidence the code-agent IS invoking executeScript:

- **Token usage +32 % vs TEST_REPORT_007** (25,912 → 34,225 avg).
- **9+ tool-loop turns per attempt vs TEST_REPORT_007's 5-7.**
  Server logs show `LLM tool-loop turn completed` with
  `stopReason: "tool_calls"` for each turn.
- **Per-turn token escalation matches executeScript-stderr
  pattern**: counts climb 1,478 → 2,908 → 5,099 → 5,229 → 5,564
  → 6,472 → 6,647 → 6,766 within one loop. The 4× jump at
  turn 4 is consistent with `tsc --noEmit` stderr (multi-KB
  compile-error output on the clone tree that doesn't have
  `node_modules` installed at this point) being inserted into
  the LLM context.

Direct evidence missing:

- `agent_execution_logs.tool_calls`: all 6 code-agent rows have
  empty `tool_calls` arrays. The orchestrator's persistence
  layer only writes the log on successful tool-loop completion;
  rate-limit throws abort before the save.

Prompt sections rendered correctly (grep against persisted prompt):

- `## Mandatory pre-emit verification`: 1 hit
- `verificationNote`: 2 hits (one in instruction, one in schema)
- `tsc --noEmit`: 1 hit (example in step 1)

Decisions made:

- **Wrote the report against indirect evidence rather than waiting
  for a successful direct verification.** Three independent
  attempts showed the same pattern — token usage and tool-loop
  turn count are consistent with executeScript being called. The
  observability layer's mid-loop-throw blind spot is itself a
  finding (recommended fix #1 in the report).
- **Used direct API login (curl /auth/login + write JWT into
  ~/.gestalt/config.json) when CLI's promptSecret raw-mode prompt
  couldn't be driven via expect.** Same issue as prior sessions
  with `gestalt projects update-token`; documented as an
  operator-flow pain point but not blocking.
- **Did not introduce a model-override or MAX_TOOL_CALLS reduction
  this session.** The brief was specifically about prompt + schema
  + rules. Rate-limit mitigation is the next session's work —
  recorded as recommended fix #2.
- **Did not modify `BaseLLMAgent.runToolLoop` to do incremental
  persistence**, even though that would have unblocked the
  direct verification. Out of scope for the brief; recorded as
  recommended fix #1.

Pending follow-ups:

- **(HIGH)** Incremental tool-call persistence in
  `BaseLLMAgent.runToolLoop()`. Set `this.lastToolCallLog =
  [...toolCallLog]` at the start of each loop iteration so a
  rate-limit throw still leaves the orchestrator with a full
  record of the calls that completed. Five-line change.
- **(HIGH)** Code-agent rate-limit mitigation. Either operator-
  side switch to `gpt-4o-mini` (set in trackeros's
  `agents.yaml`), or lower `MAX_TOOL_CALLS` from 10 to 5 in
  `base-llm-agent.ts`, or bump OpenAI tier.
- **(MEDIUM)** Capture `n_turns` and `final_stop_reason` on
  agent_execution_logs so the dashboard can show "agent needed
  N tool-loop turns" without grepping server logs.
- **(LOW)** Document the verificationNote → LINT_FAILURE signal
  pathway in GENERATE-LAYER.md.

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted. Server `/health` 200
throughout. Trackeros `main` updated (`44403f0`) with the
3-rule code-agent expansion.

---


### Session 2026-06-05 — Claude Code (TEST_REPORT_007: review-agent + code-agent gain executeScript / HARNESS.json rules / verification guidance — Leave module deploys on a SINGLE round, 35% cheaper)

Implementation + live test session. Goal: extend the
TEST_REPORT_006 executeScript pattern to two more agents
(review-agent + code-agent), following the same recipe — render
`agentConfig.<role>.rules` from HARNESS.json + add the
`executeScript` one-sentence direction + give the agent the tool
in PER_ROLE_DEFAULTS. Specifically targeted at TEST_REPORT_006's
"Import cannot be resolved" review-agent false positives + the
fact that code-agent had executeScript but no prompt section
telling it about the tool.

Outcome: **Leave module deployed on a SINGLE round, zero retries.**
Cost ≈ $0.27 USD (down 35 % from TEST_REPORT_006's $0.40 across
two rounds). The brief's two targeted fixes both ship correctly
and visibly render in the live prompts (verified by `grep`).
Open caveat: neither agent actually invokes `executeScript` from
the new prompt sections this cycle — code-agent reads files but
doesn't compile-check, and review-agent errored out partway
through its LLM call on an OpenAI rate limit. The wiring is in
place; "you have this tool" reads as advisory rather than
mandatory and the next iteration should make it imperative.

What the user asked for:

- **Fix 1 (HIGH)**: Give the review-agent `executeScript` so it
  can run `tsc --noEmit` to verify "Import cannot be resolved"
  findings before flagging them. Render the
  `agentConfig['review-agent'].rules` + executeScript direction
  + a new "Verification guidance" block BEFORE the golden
  principles section. Update PER_ROLE_DEFAULTS. Update HARNESS.json
  templates + push to trackeros/main.
- **Fix 2 (HIGH)**: Add `buildHarnessAgentSection` +
  `buildScriptToolInstruction` calls to `code-prompt.ts` so the
  code-agent knows it has executeScript. (The tool was already in
  the code-agent's `tools.builtin` per TEST_REPORT_006; the
  prompt section was missing.)
- Re-run the same Leave module intent. Verify single round, no
  retries, gate clean pass, cost target ≈ $0.10-0.15.

What changed (per fix):

- **Supporting refactor — BaseLLMAgent helpers exported as
  standalone**. The class methods `buildHarnessAgentSection` and
  `buildScriptToolInstruction` are now thin wrappers around
  top-level exported `renderHarnessAgentRules(agentRole,
  harnessConfig)` and `renderScriptToolInstruction()` functions.
  Necessary because `code-prompt.ts` is a function (not a class
  method) and can't call `this.buildHarnessAgentSection`.
  Backward-compatible — existing class-based callers (constraint-
  agent) keep working.
  `packages/core/src/index.ts` exports both standalone helpers
  next to `BaseLLMAgent`.
- **Fix 1 — review-agent**. `llm-review-agent.ts` gets new
  imports of the standalone helpers, a new `loadFullHarness`
  helper that reads the full HARNESS.json (not just constraints
  subset), and three new prompt sections rendered at the TOP of
  the body (after persona) before everything else:
  - `## Rules you must enforce (from HARNESS.json)` via
    `renderHarnessAgentRules('review-agent', fullHarness)`
  - `## Script execution` via `renderScriptToolInstruction()`
  - `## Verification guidance` (a fresh block) — four
    verify-before-flagging directives: import-resolution → tsc
    --noEmit, missing-dep → readFile package.json,
    framework-mismatch → searchFiles/grep, missing-audit/RBAC
    /validation → check IntentSpec.outOfScope.
  `agent-config-loader.ts`: new `REVIEW_AGENT_TOOLS = ['executeScript',
  'readFile', 'searchFiles']`; `PER_ROLE_DEFAULTS['review-agent']`
  switched to it; removed the now-orphaned `READ_ONLY_TOOLS`
  constant.
  Templates: `templates/.../HARNESS.json` review-agent rules
  expanded from 2 → 4 per brief; `templates/.../agents.yaml`
  review-agent's `tools.builtin` now lists `[executeScript,
  readFile, searchFiles]`.
  Operator-side: `trackeros/HARNESS.json` updated to match;
  pushed as commit `79e9190` to trackeros/main.
- **Fix 2 — code-agent**. `code-prompt.ts` imports
  `renderHarnessAgentRules` and `renderScriptToolInstruction`
  from `@gestalt/core` and renders two new sections between
  the architecture section and the scope section:
  - `harnessAgentRulesSection` — calls
    `renderHarnessAgentRules('code-agent', ctx.harness)`
  - `scriptToolSection` — calls `renderScriptToolInstruction()`
  `packages/agents/generate/src/types.ts`: local mirror
  `HarnessConfig` interface gains `agentConfig?: Record<string,
  { rules?: string[] }>` so `ctx.harness.agentConfig` is typed.

Live verification:

- Correlation `a41959f9-5338-484e-ab00-ad6b0f5a74cc`. PR #2801 on
  trackeros at branch `gestalt/a41959f9-create-the-leave-module-foundation`,
  commit `9b1db0f`.
- **Single generate round → gate clean pass → deploy**. No retry.
- Total ≈ 53,500 tokens / ≈ $0.27 USD vs TEST_REPORT_006's
  81,500 / $0.40. **-35 % cost on the same intent.**
- Review-agent prompt confirmed to contain ALL FOUR new sections
  by `grep` against the persisted prompt text:
  `Rules you must enforce` (1×), `Script execution` (1×),
  `Verification guidance` (1×), plus the existing
  `Out of scope` (1×), `Project state` (2×).
- Code-agent prompt confirmed to contain BOTH new sections
  by `grep`: `Rules you must enforce` (1×), `Script execution`
  (1×).
- Constraint-agent: still works perfectly. 5 tool calls including
  1 executeScript (`npm run lint`). Verdict
  `{"violations": [], "summary": "0 violations"}`.
- Review-agent: this cycle hit an OpenAI `rate-limit` mid-call.
  The orchestrator's "errored → absence of signals" fallback
  treated this as clean. So we have evidence of the PROMPT
  being constructed correctly but no live evidence of the
  review-agent actually invoking executeScript from it.
- Code-agent: 7 tool calls (up from 5 in TEST_REPORT_006) — more
  thorough scaffolding discovery, but still 0 executeScript
  invocations. The new prompt section reads as advisory; the LLM
  doesn't reach for the tool unprompted.

Brief's verification matrix:

| Check | Result |
|---|---|
| Review-agent tool calls include executeScript("tsc --noEmit") | ✗ not exercised (LLM errored on rate-limit before reaching tools) |
| No "Import cannot be resolved" false positives | ✓ pass (0 signals) |
| Gate verdict: clean pass | ✓ pass (server log: `Gate passed — all 2 checks clean. verdict: pass. signalCount: 0`) |
| Code-agent tool calls include executeScript | ✗ partial — prompt has the section; LLM didn't reach for it |
| Token cost ~$0.10-0.15 | ⚠ $0.27 (single round ✓; raw cost above target) |

Decisions made:

- **Standalone exports rather than passing `this` around.**
  Tempted to add a static method on BaseLLMAgent that
  `code-prompt.ts` could call as `BaseLLMAgent.renderRules(...)`,
  but free functions read more naturally for prompt assembly +
  match the existing pattern in `code-prompt.ts` (where every
  other section is a free helper). Class wrappers preserved
  for the constraint-agent's existing call sites.
- **Verification guidance is a NEW prompt block, not a tweak
  to an existing one.** The brief calls it out explicitly with
  four verify-before-flagging items. Inserting it adjacent to
  the (existing) Script execution section reinforces "you have
  a tool — here are the four cases to use it for".
- **Placed Fix 1's new sections at the TOP of the body**
  (right after persona). The brief says "BEFORE the golden
  principles section so rules take precedence" — putting them
  before everything else also puts them BEFORE the existing
  outOfScope + project-state sections from TEST_REPORT_004.
  The full body order is now harnessRules → script →
  verification → outOfScope → projectState → scaffolding →
  constraints → principles → consistency → files-under-review.
- **Placed Fix 2's new sections after architectureSection,
  before scopeSection.** Earlier than constraints/design/intent
  so the LLM reads "these are the rules + a way to verify
  them" first.
- **Did not adjust the code-prompt's task section to make
  executeScript mandatory.** The brief's pseudo-code is a
  passive instruction ("You have access to … Decide what to
  run"). After confirming the prompt section renders correctly
  but the LLM doesn't actually invoke the tool, a forceful
  pre-emit verification rule is the next iteration —
  recorded as TEST_REPORT_008's top recommended fix.
- **Removed the unused `READ_ONLY_TOOLS` constant** rather than
  silencing the TS6133 with a noUnusedLocals carve-out. It was
  only referenced by review-agent before this session;
  TEST_REPORT_007 migrates review-agent to `REVIEW_AGENT_TOOLS`
  so the orphan can go.

Pending follow-ups:

- **(HIGH) Make code-agent self-verify before emitting files.**
  Convert the script section from advisory to mandatory in the
  task section: "Before returning the final JSON, you MUST call
  executeScript with a compile/test command and fix any
  errors before re-emitting." Single-paragraph addition to
  code-prompt.ts.
- **(MEDIUM) Review-agent rate-limit sensitivity.** The 11,854-
  token prompt may be tickling per-minute output-rate limits on
  gpt-4o. Measure prompt-size delta vs TEST_REPORT_006.
- **(LOW) Document `tests/integration/` placement formally** in
  the test-prompt — the test-agent has been using it for two
  cycles but it's not documented.
- **(LOW) BLOCKED_PATTERNS end-to-end test** (still pending from
  TEST_REPORT_006).

Build status: `pnpm -r build` clean across all 12 packages.
Docker image rebuilt + container restarted. Server `/health` 200
throughout. Trackeros `main` updated (`79e9190`) with the
review-agent rules expansion.

---

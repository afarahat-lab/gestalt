# Test Report 001 — trackeros Scaffold Intent

**Date:** 2026-06-04
**Project:** trackeros (UUID `5d99e2f3-f3cb-4842-a03a-419790f70e2d`)
**Intent:** "Scaffold the project foundation. Create package.json with
express pg jsonwebtoken bcrypt and dotenv as dependencies. Add
typescript ts-node jest and the relevant type definitions as dev
dependencies. Create tsconfig.json with strict mode targeting Node
22. Create jest.config.js. Create src/shared/types/index.ts with the
AppError class and Leave domain enums for LeaveType LeaveStatus and
UserRole. Create src/shared/db/connection.ts with the pg Pool
singleton."
**Outcome:** ✗ **failed** before any agent dispatched (orchestrator-level abort)
**Total duration:** ~10 s wall-clock (intent insert → final self-heal abort)
**Total tokens:** 0 attributed to any agent. ~3 LLM calls (≈ 9 350 ms total) consumed by the self-healing diagnostician; no per-call token counts are persisted in `agent_executions` for this project (separate observability gap, see Issue #4).
**Intent ID:** `c867da2a-c5ed-49f1-82c4-1a4e4ae27c06`
**Correlation ID:** `06299649-2db4-4d64-8785-167e025cbacb`

---

## Headline finding

**The cycle never reached any generate-layer agent.** The orchestrator
threw a `PostgresError: invalid input syntax for type uuid:
"trackeros"` from `PostgresProjectRepository.findById` on its very
first hop, then again on the self-healing retry, then escalated to a
human alert. **The platform stored the literal project NAME
`'trackeros'` in `intents.project_id`** instead of the project UUID
`5d99e2f3-f3cb-4842-a03a-419790f70e2d` because `gestalt run
--project <name>` does not resolve names → UUIDs on the CLI side and
the server's `POST /intents` route does not resolve either. Every
prior intent in this project's history was submitted via the
"current project" path (which DOES resolve names to UUIDs at
`gestalt projects use` time) so this regression was masked until now.

This is a 1-flag platform bug, not a prompt-quality problem, and not
a generated-code problem — **no prompt was sent to any project agent,
no design was attempted, no file was generated.** The intent failed
before the orchestrator could load the project record.

---

## Agent execution summary

| Agent              | Status        | Duration | Tokens | Notes                                                             |
| ------------------ | ------------- | -------- | ------ | ----------------------------------------------------------------- |
| intent-agent       | not dispatched | —        | —      | Orchestrator aborted in pre-flight before queue dispatch          |
| design-agent       | not dispatched | —        | —      | "                                                                 |
| context-agent      | not dispatched | —        | —      | "                                                                 |
| lint-config-agent  | not dispatched | —        | —      | "                                                                 |
| code-agent         | not dispatched | —        | —      | "                                                                 |
| test-agent         | not dispatched | —        | —      | "                                                                 |
| review-agent       | not dispatched | —        | —      | "                                                                 |
| diagnostician (self-healing) | ran 3 LLM calls | 3947 / 2726 / 2676 ms | unrecorded | Loop-mode self-healing tried to diagnose, ended at medium confidence; alert raised |

`SELECT count(*) FROM agent_executions WHERE correlation_id =
'06299649-...';` → **0**.
`SELECT count(*) FROM agent_execution_logs WHERE correlation_id =
'06299649-...';` → **0**.

The self-healing LLM calls are recorded in the `llm` module logs but
**are not attached to an `agent_executions` row** (the diagnostician
isn't an "agent" in the per-cycle execution model; it lives in
`@gestalt/core/self-healing-loop`).

For comparison: the **prior** smoke-test cycle on this project
(correlation `0389391b-...`, submitted ≈12 min earlier via the
current-project path, which had `project_id =
5d99e2f3-f3cb-...` correctly), got **15 agent_executions** across
three retry rounds — intent / design / context / lint-config /
code-agent — with code-agent failing every round on the OpenAI
rate-limit. So the agent pipeline IS healthy; the problem is purely
at the orchestrator's entry point when the `--project` flag is used.

---

## Per-agent analysis

### intent-agent

**Status:** not dispatched.
**Prompt preview:** none captured. No `agent_execution_logs` row exists.
**Response preview:** none captured.
**Assessment:**
- The agent never received the intent. The orchestrator's
  `processIntentTask` failed inside
  `getProject(ctx.projectId)` → `PostgresProjectRepository.findById`
  before the agent fan-out logic ran.
- The IntentSpec was never produced.
- What a "better output" looks like here is not an agent-quality
  question — it's a platform-correctness question. **Fix the
  orchestrator-side project resolution and the agent runs normally**
  (verified by the control cycle: intent-agent succeeded in 2667 ms
  in the immediately-prior smoke test against the same project).

### design-agent

**Status:** not dispatched. Same root cause.
**Assessment:** No domain model, no API contracts, no entity
references. The agent runs after intent-agent in `runs_after`
topological order, so it never had upstream input.

### context-agent

**Status:** not dispatched. Same root cause.
**Assessment:** Context-agent has 4 built-in tools configured in
`agents.yaml` (`readFile` / `listDirectory` / `searchFiles` /
`getFileTree`, per `gestalt project config show`). None of them were
invoked.

### code-agent

**Status:** not dispatched. Same root cause.
**Assessment:** Code-agent is configured with 4 tools + 7
`prompt_extensions` for this project. None of that was exercised.
The control smoke test shows code-agent's actual current failure
mode is the upstream OpenAI rate limit, not a Gestalt bug — but
that's downstream of the bug being analyzed here.

### test-agent

**Status:** not dispatched. Same root cause.
**Assessment:** —

### review-agent

**Status:** not dispatched. Same root cause.
**Assessment:** —
**Verdict from `gestalt gate show`:** "No gate executions found for
this intent." This is correct given that nothing reached the
quality-gate layer.
**Signals emitted:** none (confirmed both via `signals` table and
via `gestalt gate show`).

### diagnostician (self-healing loop, post-mortem)

**Status:** ran (3 LLM calls).
**Prompt preview:** not captured in `agent_execution_logs` (the
self-healing loop does not write to that table).
**Response preview:** not captured. The alert row's
`escalation_reason` contains the synthesized diagnosis:
> "Diagnosis: The orchestrator encountered an error due to an
> invalid UUID syntax. Confidence: medium. retryTaskType: none"

**Assessment:**
- The diagnostician correctly identified the symptom ("invalid UUID
  syntax") but produced **`retryTaskType: none`** with
  **medium confidence** — i.e. it knew the retry wouldn't fix
  itself. That is the right answer: it cannot self-heal a
  bad foreign-key reference in the `intents` row. Per ADR-021 and
  STATE.md, medium confidence does not auto-resolve; the alert
  remained open for operator action.
- The loop re-dispatched the same task once (`attemptNumber: 1`)
  before giving up — wasted ~3 s of LLM time on a retry that hit
  the identical orchestrator error 4 seconds later. The diagnostician
  should recognize "invalid input syntax for type uuid" as
  unrecoverable and skip the retry entirely. See Recommended fix #2.
- `hintKeys: []` — the diagnostician had no actionable hints to pass
  to the agent, which is correct here.

---

## Generated artifacts

| Path | Type | Content quality |
| ---- | ---- | --------------- |
| —    | —    | none — no artifacts written |

`SELECT count(*) FROM artifacts WHERE correlation_id = '06299649-...'`
→ **0**. No branch was created on the trackeros remote; no PR was
opened. `gestalt deploy show` confirms: "No deployment found for
c867da2a."

---

## Signals emitted

| Type | Severity | Agent | Message |
| ---- | -------- | ----- | ------- |
| (none) | — | — | — |

`SELECT count(*) FROM signals WHERE correlation_id = '06299649-...'`
→ **0**. Per ADR-021, signals are emitted by quality-gate / review
agents — those layers never ran.

**One alert was raised** (table `alerts`, not `signals`):

| field             | value |
| ----------------- | ----- |
| type              | `generate-error` |
| severity          | `high` |
| title             | "Generate failure for intent 'Scaffold the project foundation. Create package.json with ex' (attempt 2)" |
| required_action   | `provide-feedback` |
| acknowledged      | false |
| created_at        | 2026-06-04 18:24:08 UTC |
| context.failureType | `generate-error` |
| context.attemptNumber | 2 |
| context.escalationReason | "Diagnosis: The orchestrator encountered an error due to an invalid UUID syntax.. Confidence: medium. retryTaskType: none" |

Note the double period in `syntax..` — minor cosmetic bug in the
diagnostician's response post-processing (Issue #6).

---

## Issues identified

### Issue #1 — Platform bug: `gestalt run --project <name>` does not resolve names to UUIDs (BLOCKING)

**Severity:** high (blocks every operator who supplies `--project`
explicitly).
**Where it lives:**

- `packages/cli/src/commands/run.ts:34` — the only line that reads
  `--project`:
  ```ts
  const projectId = options.projectId ?? config.currentProjectId;
  ```
  This passes the raw value (project name OR UUID) straight through
  to `client.submitIntent({ projectId })` at `run.ts:54`.
- **Contrast:** `packages/cli/src/commands/intent.ts:91` (for `gestalt
  intent list`) correctly calls
  `resolveProjectId(client, config.currentProjectId, options.project)`
  which queries `/projects`, finds the matching project by name, and
  returns the UUID (`intent.ts:274-289`). The same helper exists in
  the file; `run.ts` simply never calls it.
- **Server passively accepts the bad value:**
  `packages/server/src/routes/intents.ts:62-89` — the `POST /intents`
  handler validates that `projectId` is non-empty, runs the
  membership guard, then writes `intents.project_id = projectId`
  verbatim. There is no `projects.findById(projectId)` check before
  insert.
- **Database accepts the bad value silently:** `intents.project_id`
  is typed `text`, not `uuid`, so a name like `"trackeros"`
  round-trips through INSERT cleanly. The first time the value is
  cast to a UUID is inside the orchestrator's `getProject()` →
  `PostgresProjectRepository.findById()` at
  `packages/adapters/postgres/src/repositories/projects.ts:43-49`:
  ```ts
  const [row] = await db<ProjectRecord[]>`
    SELECT * FROM projects WHERE id = ${id}
  `;
  ```
  where the postgres driver tries to cast `id` to `uuid` and throws
  `22P02 invalid input syntax for type uuid`.

**Why no prior cycle hit this:** every previous intent in
`SELECT … FROM intents` shows `project_id =
'5d99e2f3-f3cb-4842-a03a-419790f70e2d'`. The user had been running
`gestalt run …` without the explicit flag, falling back to
`config.currentProjectId`, which was correctly populated as a UUID
by `gestalt projects use trackeros` (`projects.ts:302` calls
`updateCliConfig({ currentProjectId: match.id })`). The `--project
<name>` path was simply untested.

### Issue #2 — Platform bug: server-side `POST /intents` has no project-id sanity check

**Severity:** medium (defense-in-depth — even after fixing #1, the
server should reject malformed project_ids).
**Where it lives:** `packages/server/src/routes/intents.ts:62-89`.
The handler runs `checkProjectMembership(reply, user.id, user.role,
projectId, 'editor')` — which itself likely uses `projects.findById`
and **should have caught the bad UUID before insert**, but only
produces a 401/403, not a 400, and only when membership matters. In
this run, the membership check apparently succeeded (or was skipped
for platform-admin), allowing the bad write.
**Effect:** A poisonous `intents` row landed in the DB. It cannot be
re-queued by the orchestrator because every attempt to load the
project errors with the uuid cast. The row sits as `failed` with
`attempt_count = 1` and `project_id = 'trackeros'`. (No data
corruption — `intents.project_id` is text — but the row is
unactionable.)

### Issue #3 — Platform bug: `gestalt run --watch` does not exist

**Severity:** low (UX / docs).
**Where it lives:** `gestalt run --help` shows only `--server`,
`--project`, `--priority`. The user's task script asked me to invoke
`--watch`; this was rejected with `error: unknown option '--watch'`.
The watch flag does exist on `gestalt intent show --watch`; the
brief just had the wrong subcommand. Either lift `--watch` to `run`
(thin wrapper that submits + tails) or document the existing
two-step pattern (`gestalt run …` then `gestalt intent show <id>
--watch`).

### Issue #4 — Platform bug: `agent_executions.tokens_used` is always 0 for this project

**Severity:** medium (observability blocked).
**Evidence:** the control smoke test (correlation `0389391b-...`) has
15 agent_executions rows, all with `tokens_used = 0`, despite the
fact that each was a real LLM call (intent-agent ran 4642 ms;
design-agent 3151 ms; etc.). The platform-level `llm` log line
("LLM call completed … tokensUsed: 1243") does report tokens — they
just don't make it into the per-agent row. This breaks the
"total tokens" rollup in `gestalt intent show` and in any future
billing or quota work.

### Issue #5 — Platform bug: `gestalt intent list` did not include the just-submitted intent

**Severity:** low–medium (observability lag, possible default-limit
issue).
**Evidence:** after `gestalt run` returned with the new
intent ID `06299649…`, `gestalt intent list --project trackeros
--limit 10` returned only three rows (the three prior intents). The
DB confirmed that the row existed (`SELECT … FROM intents …` showed
4 rows). Possible causes: (a) `intent list` filters out rows with a
non-UUID `project_id` (because it joins on `projects.id`); (b)
`--project trackeros` on `intent list` resolves to the UUID and
filters server-side, so the row whose `project_id` is the literal
`'trackeros'` doesn't match. Likely (b), and it's actually a
symptom of Issue #1 rather than an independent bug — but it makes
the operator-facing failure mode worse: the intent is invisible to
the very command the CLI tells the operator to use.

### Issue #6 — Platform bug: diagnostician produces double-period in escalation message

**Severity:** very low (cosmetic).
**Evidence:** alert `escalation_reason` reads:
"…due to an invalid UUID syntax**..** Confidence: medium…". One
sentence-final period from the LLM, one template-side period.
Strip-trailing-period before joining in the diagnostician's response
formatter.

### Issue #7 — Platform bug: `gestalt intent show <8-char-prefix>` no longer matches

**Severity:** low.
**Evidence:** the `intent show` help text claims it accepts "UUID or
8-char prefix" but both `gestalt intent show 06299649` and `gestalt
intent show c867da2a` returned "No intent matches…". Only the full
UUID worked. Likely a regression in the prefix-matching logic;
worth a CLI integration test.

### Issue #8 — Platform bug: prior smoke test's three retry cycles all failed the same way

**Severity:** out-of-scope for this report but worth flagging.
**Evidence:** the control intent's `agent_executions` shows 3 full
cycles of intent → design → context → lint-config → code, where
code-agent failed every time on (per RECENT.md) the OpenAI
rate-limit. The retry strategy currently re-runs **every** generate
agent on each retry — this re-burned ~30 s of intent/design/context
work each round for nothing, because the upstream artifacts were
already valid. STATE.md already lists this as a known
follow-up ("Retry cycle full re-runs all generate agents") so
no new finding — just noting it surfaces clearly in this test.

### Issue #9 — Prompt-quality issues

**Severity:** N/A — **no agent prompts were ever issued for this
intent**, so nothing to evaluate. The control smoke test's prompts
weren't captured in this report's scope; the appropriate next test
(see Recommended fix #1 + #4) will produce a proper round of agent
prompts to analyze.

---

## Recommended platform fixes

### Fix A — Resolve project name → UUID in `gestalt run` (HIGH PRIORITY)

**Change:** `packages/cli/src/commands/run.ts:34` should call the
existing `resolveProjectId` helper instead of using
`options.projectId` raw. The helper lives in
`packages/cli/src/commands/intent.ts:274-289` — extract it to a
shared location (e.g. `packages/cli/src/lib/projects.ts`) and import
it from both files.
**Test:** add a CLI integration test that runs `gestalt run "test"
--project <name>` against a fixture project and asserts that the
resulting `intents.project_id` is a UUID.
**Priority:** high — blocks every operator who supplies
`--project` explicitly. One-line bug; ~10 line fix once the helper
is shared.

### Fix B — Reject non-UUID `projectId` server-side at `POST /intents` (DEFENSE IN DEPTH)

**Change:** `packages/server/src/routes/intents.ts:62-89` should
either (a) regex-validate `projectId` against the UUID pattern + 400
on mismatch, or (b) call `projects.findById(projectId)` up front
and 404 on missing. Option (b) is preferred — it also catches the
"valid UUID but no such project" case.
**Priority:** medium — even with Fix A, this prevents future client
regressions from poisoning the `intents` table.

### Fix C — Diagnostician should not retry on `22P02 invalid input syntax for type uuid` (LOW PRIORITY)

**Change:** add the postgres error code `22P02` and the substring
`"invalid input syntax for type uuid"` to the diagnostician's "do
not retry" list. Saves a wasted LLM call + ~3 s of platform time.
Per ADR-021, unrecoverable errors should be flagged
`retryTaskType: none` immediately.
**Priority:** low — only affects cycles already on the failure path.

### Fix D — Capture `tokens_used` per agent execution

**Change:** when the `BaseLLMAgent` writes its `agent_executions`
row on completion, populate `tokens_used` from the LLM bridge's
`prompt_tokens + completion_tokens`. Today that value flows to the
top-level `llm` log line but not to the per-agent row.
**Priority:** medium — observability + future billing.

### Fix E — Fix `gestalt intent show <prefix>` matching

**Change:** investigate the prefix-matching regression. Likely a
`startsWith` check that got tightened to `===` or a case-sensitivity
issue. Add a CLI test.
**Priority:** low.

### Fix F — Document or implement `gestalt run --watch`

**Change:** either (a) add `--watch` as a flag that submits then
internally tails, or (b) make the failure message at `gestalt run`'s
end suggest the right command: `gestalt intent show <id> --watch`.
**Priority:** low (UX polish).

### Fix G — Strip diagnostician's trailing period in `escalation_reason`

**Change:** in the self-healing loop's response assembler, strip
trailing punctuation from the LLM's `diagnosis` before concatenating
"Confidence: …". Trivial.
**Priority:** very low.

---

## Verdict

**The platform is NOT ready to generate code for an `--project
<name>` workflow.** The bug is small (a missing one-line call to an
already-implemented helper) but blocks every operator who passes the
flag explicitly. The fix is mechanical and low-risk.

**Once Fix A lands, the platform IS plausibly ready to generate
useful code for this project** — the previous cycle (correlation
`0389391b…`, the smoke test from 12 minutes earlier) reached
intent / design / context / lint-config / code-agent successfully
and only stopped on an upstream OpenAI rate-limit. That cycle had
no platform-level errors at all; the agents got through the
prompt pipeline cleanly.

**Three independent gaps make this failure mode worse than it has
to be:**

1. **No project-id type-check at the API boundary** (Fix B) — the
   server happily accepted `"trackeros"` as a project_id, which made
   the row unactionable rather than producing a clean 400.
2. **The diagnostician retried on an unrecoverable error** (Fix C)
   — the second retry hit the identical postgres error 4 seconds
   later, wasting an LLM call.
3. **The intent is invisible to `gestalt intent list`** (Issue #5)
   — the very command the CLI tells the operator to use to
   inspect their cycle filters this row out. Operator must drop
   into the DB to debug, which is the wrong default.

Together those three things mean the operator-facing failure mode
is: *"I submitted an intent. The CLI said it failed. The `intent
list` doesn't show it. There's no agent output to look at. The only
breadcrumb is `gestalt status --id <full-uuid-on-the-failure-line>`,
which says `failed` with no detail."* That is a frustrating
debugging experience and the bigger lesson here than the bug
itself.

**Net assessment for the design chat:** the agent pipeline is
working when it gets a chance to run. The orchestrator's pre-flight
checks need hardening (Fix B), the CLI needs the one-line
resolution fix (Fix A), and observability/diagnostician polish
(Fixes C–G) is a backlog of small wins that together make platform
failures vastly easier to debug. **Land Fix A and Fix B in one PR;
then re-run this exact same intent to get a real agent-prompt
review.**

---

## Appendix: raw evidence

### Intent row

```
            id            |              project_id              |            correlation_id            | status | attempt_count
--------------------------+--------------------------------------+--------------------------------------+--------+---------------
 c867da2a-c5ed-...        | trackeros                            | 06299649-2db4-4d64-8785-167e025cbacb | failed | 1
```

### Project row (control)

```
            id            |   name    | git_url                                       | default_branch
--------------------------+-----------+-----------------------------------------------+----------------
 5d99e2f3-f3cb-...        | trackeros | https://github.com/afarahat-lab/trackeros.git | main
```

### Server log timeline (relative to intent insert)

```
+0.0s   Intent created                  (routes:intents)
+0.0s   Worker picked up task           (worker)
+0.0s   Orchestrator received intent    (orchestrator)
+0.0s   Orchestrator error              PostgresError: invalid input syntax for type uuid: "trackeros"
                                        at PostgresProjectRepository.findById (projects.js:40)
+3.9s   LLM call completed              (llm) gpt-4o, 1243 tokens — diagnostician
+3.9s   Worker picked up task           (worker)
+3.9s   Orchestrator received intent    (orchestrator)
+3.9s   Orchestrator error              same PostgresError
+3.9s   Self-healing retry dispatched   failureType=generate-error attempt=1 confidence=medium retryTaskType=generate:intent
+3.9s   Custom-agent self-healing dispatched retry (loop)
+3.9s   Task completed                  durationMs=0
+6.7s   LLM call completed              (llm) 2726 ms
+9.4s   LLM call completed              (llm) 2676 ms
+9.4s   Auto-resolve did not reach high confidence — alert remains open  confidence=medium
+9.4s   Task completed
```

### Alert row

```
type:             generate-error
severity:         high
required_action:  provide-feedback
context: {
  intentId: c867da2a-c5ed-...,
  failureType: generate-error,
  attemptNumber: 2,
  escalationReason: "Diagnosis: The orchestrator encountered an error
                     due to an invalid UUID syntax.. Confidence:
                     medium. retryTaskType: none"
}
```

### Comparison: prior smoke test's agent_executions (correlation 0389391b…)

```
intent-agent       completed   4642 ms   0 tokens
design-agent       completed   3151 ms   0 tokens
context-agent      completed   6145 ms   0 tokens
lint-config-agent  skipped       22 ms   0 tokens
code-agent         failed     15257 ms   0 tokens    ← OpenAI rate-limit
[retry round 2]
intent-agent       completed   2023 ms   0 tokens
design-agent       completed   2246 ms   0 tokens
context-agent      completed   5593 ms   0 tokens
lint-config-agent  completed     21 ms   0 tokens
code-agent         failed      9861 ms   0 tokens    ← OpenAI rate-limit
[retry round 3]
intent-agent       completed   2667 ms   0 tokens
design-agent       completed   3029 ms   0 tokens
lint-config-agent  completed     19 ms   0 tokens
context-agent      completed   4544 ms   0 tokens
code-agent         failed      8495 ms   0 tokens    ← OpenAI rate-limit
```

### Test correlation_id for follow-up runs after the fix

`06299649-2db4-4d64-8785-167e025cbacb` — this report is the
permanent record of the pre-fix state.

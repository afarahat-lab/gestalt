# Test Report 009 — incremental tool-call persistence + gpt-4o-mini for code-agent

**Date:** 2026-06-05
**Project:** trackeros (UUID `5d99e2f3-f3cb-4842-a03a-419790f70e2d`)
**Platform change:** Fix 1 in `packages/core/src/agents/base-llm-agent.ts` (incremental `lastToolCallLog` persistence inside `runToolLoop`).
**Operator change:** Fix 2 in trackeros `agents.yaml` (`code-agent.llm.model: gpt-4o-mini`), commit `9c41633` on trackeros `main`.
**Intent (verbatim):** "Create the Leave module foundation: model.ts with LeaveRequest type, repository.ts with createLeaveRequest + listForUser methods, service.ts with submitLeaveRequest method, routes.ts with POST /leave and GET /leave endpoints. Wire mounting into src/index.ts. Include Jest tests for the service and repository."

**Correlation:** `522e1edc-c1a7-4cf0-9bc7-61620800f92a` (intent_id `b59855d0-b618-4813-ae71-777f2ac4dada`)
**Final status:** `failed` after 3 rounds (max self-healing attempts exhausted).
**Outcome:** ⚠ **mixed.** Both fixes ship and are **proven by data** in this cycle. But the cycle uncovers a **new failure mode in the tool-loop itself** that gpt-4o-mini's aggressive parallel tool-use exposes — the LLM never reached `executeScript` because every round hit a different blocker.

---

## Headline finding

**Fix 1 is unambiguously proven.** Every single code-agent failure across all three rounds wrote a complete 10-entry `tool_calls` array to `agent_execution_logs`. Pre-fix, the array would have been empty on every throw (TEST_REPORT_008's central blindspot). The mid-loop throw no longer loses the audit trail.

| Round | Code-agent status | `tool_calls` count | `model_used` |
|---|---|---|---|
| 1 | failed | **10** | `gpt-4o-mini` |
| 2 | failed | **10** | `gpt-4o-mini` |
| 3 | failed | **10** | `gpt-4o-mini` |

**Fix 2 also clearly works.** `model_used = 'gpt-4o-mini'` for every code-agent execution row. **Zero rate-limit errors** in the server logs (vs TEST_REPORT_008 where every cycle hit the gpt-4o 30 k TPM ceiling). Token throughput is no longer the constraint — round 3 burned 174 k tokens with no rate-limit.

**The brief's key question — "does the tool_calls log show an executeScript call?"**

**No.** Not in any of the three rounds. But for a **new reason** that's only visible *because Fix 1 made the data available*:

1. gpt-4o-mini explores aggressively with parallel tool calls.
2. The orchestrator's `MAX_TOOL_CALLS = 10` cap is enforced **inside** the per-turn batch (`for (const call of toolCalls) { if (totalToolCalls >= MAX_TOOL_CALLS) break; }`). When the cap hits mid-batch, the assistant message gets pushed to history with N tool_calls but only M ≤ N tool responses follow.
3. The next outer-loop iteration calls `completeWithTools` with that inconsistent history. OpenAI responds with **HTTP 400** `invalid_request_error`: *"An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: call_YxZOT2sZgrDkDcO85FWHKbJ8"* — exactly the one call_id that hit the cap mid-batch.
4. `runToolLoop` throws → `code-agent` fails → cycle moves to self-healing → next round → same pattern.

**Net:** all 10 calls per round are filesystem exploration (`listDirectory`, `getFileTree`, `searchFiles`). The LLM never reaches `executeScript` because it spends its 10-call budget mapping the empty scaffolding tree, then hits the cap mid-batch, then triggers the 400.

---

## Submitted correlations

| # | Round | Tokens (code-agent) | Outcome |
|---|---|---|---|
| 1 | round 1 | 112,079 | code-agent failed (400 — tool_call without response) |
| 2 | round 2 | 124,443 | code-agent failed (same 400) |
| 3 | round 3 | 174,934 | code-agent failed (same 400) |

Self-healing exhausted at 2 retries; cycle escalated to `failed`. One open alert: type `generate-error`, severity `high`, title *"Generate failure for intent 'Create the Leave module foundation: model.ts with LeaveReque' (attempt 3)"*, escalation reason *"Budget exhausted after 2 self-healing attempt(s) (max 2)"*.

---

## What shipped

### Fix 1 — incremental `lastToolCallLog` persistence

**`packages/core/src/agents/base-llm-agent.ts`** — inside `runToolLoop`'s inner `for (const call of toolCalls)` loop, after `toolCallLog.push(...)`, write `this.lastToolCallLog = toolCallLog.slice()`. The class-end assignment is retained as the success path's final write but the inner-loop write is what survives a throw.

This is a six-line addition (one assignment + a four-line comment). The orchestrator's persistence layer (`runWithObservability` → `executionLogs.save`) reads `lastToolCallLog` after `run()` returns; **for failed runs, the catch block now sees a partial-but-truthful audit trail rather than `[]`.**

Why it works: in TypeScript / V8, an instance-field assignment is atomic from the caller's perspective. There's no risk of a half-written entry; either the push completed before the throw and the slice captured it, or it didn't.

### Fix 2 — trackeros `agents.yaml`: code-agent → gpt-4o-mini

**`/Users/amrmohamed/Work/trackeros/agents.yaml`** — `code-agent.llm.model` changed from `~` (platform default `gpt-4o`) to `gpt-4o-mini`. Inline comment explains the TPM-ceiling rationale + cross-references TEST_REPORT_009. Pushed to trackeros `main` as commit `9c41633`.

The platform-default `gpt-4o` at standard tier has 30 k TPM. TEST_REPORT_008's mandatory pre-emit verification pushed per-cycle token spend to ~35 k, sitting just above the ceiling. `gpt-4o-mini` has 200 k TPM and is ~10× cheaper per token. As predicted, the rate-limit goes away — but the new ceiling exposes the underlying tool-loop bug.

---

## Brief verification matrix

| Check | Result |
|---|---|
| Code-agent uses gpt-4o-mini | ✓ pass — `agent_execution_logs.model_used = 'gpt-4o-mini'` on every code-agent row |
| No rate-limit errors | ✓ pass — zero `429` / TPM errors in server logs |
| `agent_execution_logs.tool_calls` for code-agent is non-empty | ✓ pass — **10 entries on every failed round, attributable to Fix 1** |
| At least one `executeScript` call visible in tool calls | ✗ fail — 0 / 30 calls across 3 rounds. All file-exploration |
| Cycle deploys on first round | ✗ fail — code-agent throws on a different error (HTTP 400, see below) |
| If tsc reports errors: agent self-corrects and re-runs | ✗ not reached — never invoked tsc |

---

## What the tool_calls log shows (round 1)

```
 1. listDirectory  {"path": "src/modules/leave"}            isError=true   (path doesn't exist)
 2. listDirectory  {"path": "src/modules/leave/repository"} isError=true
 3. listDirectory  {"path": "src/modules/leave/service"}    isError=true
 4. listDirectory  {"path": "src/modules/leave/routes"}     isError=true
 5. getFileTree    {"maxDepth": 3}                          isError=false
 6. listDirectory  {"path": "src/modules"}                  isError=true   (no modules dir yet)
 7. listDirectory  {"path": "src"}                          isError=false
 8. listDirectory  {"path": "src/shared"}                   isError=false
 9. searchFiles    {"pattern": "LeaveRequest"}              isError=false  (0 matches)
10. searchFiles    {"pattern": "Leave"}                     isError=false  (0 matches)
─── MAX_TOOL_CALLS=10 cap hit. Outer loop attempts to continue. ───
─── Next completeWithTools call → 400 invalid_request_error.   ───
```

Round 2 and round 3 are nearly identical. The model spends every iteration trying to find a `leave/` module that doesn't yet exist (it's about to *create* it), then re-explores the same parts of the tree. Nine of ten calls are file-system reads against a near-empty scaffolding.

---

## Root-cause analysis of the new 400

The orchestrator's `runToolLoop` (`packages/core/src/agents/base-llm-agent.ts:330-455`) has this structure:

```ts
for (let turn = 0; turn < MAX_TOOL_CALLS + 1; turn++) {
  const result = await client.completeWithTools({...});
  // ... push assistant message with toolCalls ...
  for (const call of toolCalls) {
    if (totalToolCalls >= MAX_TOOL_CALLS) break;  // ← break inside batch
    totalToolCalls++;
    // ... dispatch + push tool response ...
  }
}
```

If `toolCalls.length` in a single batch is e.g. 3 and `totalToolCalls` is already 8, only 2 of those 3 calls get dispatched + responded to. The assistant message claims 3 `tool_call_ids` but history only contains 2 `tool` messages. OpenAI's strict assistant-message validation rejects the next call.

This is a **pre-existing bug** but only surfaces under conditions where:
1. The LLM does parallel/batched tool calls (gpt-4o-mini favours this; gpt-4o less so).
2. The loop doesn't rate-limit out first (gpt-4o was rate-limiting before reaching the cap).

**Three viable fixes**, in order of preference:

1. **Move the cap check to before the assistant push**, then dispatch the entire batch when accepted, OR don't push the assistant message when the cap will be exceeded mid-batch. Cleanest semantics.
2. **Synthesise a `tool` response** ("cap exceeded — call blocked") for every `call_id` in the assistant message that didn't get a real dispatch. Keeps the history consistent at the cost of a minor lie to the model.
3. **Raise `MAX_TOOL_CALLS`** (currently 10) — a band-aid that delays the problem rather than fixing it.

The first option is correct.

---

## Decisions made

- **Wrote the report against the failing-but-informative cycle rather than re-running with a different intent.** Three identical failure modes is itself the report; re-running adds no information.
- **Did NOT fix the MAX_TOOL_CALLS cap-inside-batch bug this session.** TEST_REPORT_009's brief is Fix 1 + Fix 2 + verification; the cap bug is out-of-scope and is recorded as the top recommended fix for TEST_REPORT_010.
- **Confirmed the password-issue workaround**: Same as TEST_REPORT_008, the JWT in `~/.gestalt/config.json` had expired and the CLI's `promptSecret` raw-mode prompt couldn't be driven from a non-TTY session. Used `curl POST /auth/login` + wrote the JWT into the config file directly. Documented as recurring CLI ergonomic pain.
- **Did NOT touch the platform-default LLM model in `.env`.** Fix 2 is project-scoped via `agents.yaml`; the platform default `gpt-4o` remains correct for projects without a TPM-pressure problem.
- **Numbered the report `_009.md`** not `_008.md` — matches the file conventions established by TEST_REPORT_005/006/007/008.

---

## Pending follow-ups

- **(HIGH) Fix the MAX_TOOL_CALLS cap-inside-batch bug.** Either reorder the dispatch loop (don't push the assistant message when the upcoming batch would breach the cap, or dispatch the entire batch before checking the cap and breaking the outer loop), or synthesise rejection tool-responses for cap-blocked calls. Until this lands, gpt-4o-mini cannot complete a code-agent run on a near-empty scaffold.
- **(HIGH) Even with the cap bug fixed, the code-agent's prompt is not strong enough** to compel `executeScript` invocation when the model is in exploration mode. TEST_REPORT_008's three-rule expansion in HARNESS.json + the `## Mandatory pre-emit verification` block in `code-prompt.ts` are present but the LLM ignores them when distracted by a deep scaffolding-discovery rabbit hole. Two options: (a) move `executeScript` invocation to a deterministic post-LLM step in the code-agent itself (the agent calls `executeScript` after `parseCodeResponse` succeeds, before returning); (b) restructure the prompt to put the verification step as the **first** mandatory action, not the last.
- **(MEDIUM) Capture `n_turns` and `final_stop_reason` on `agent_execution_logs`** so future failures can be diagnosed without grepping server logs. Pre-requisite for any further tool-loop investigation.
- **(MEDIUM) CLI auth ergonomics:** `gestalt login` cannot be driven from non-TTY contexts and the JWT TTL is ~8 hours. Either accept a `--password-stdin` flag, persist a refresh token, or extend the JWT TTL for the local-auth provider.
- **(LOW) Two stale failed-intent alerts** for this cycle and the prior one. Auto-resolve only fires on successful re-attempt; manual dismiss recommended once TEST_REPORT_010's fix ships.

---

## Build status

- `pnpm --filter @gestalt/core build` — ✅ clean.
- `docker compose up -d --build` — ✅ image rebuilt, all three containers (`server`, `postgres`, `redis`) healthy.
- `curl /health` — `{"status":"ok","version":"0.0.0","timestamp":"2026-06-05T20:07:35.929Z"}`.
- trackeros `main` updated to `9c41633` with the `agents.yaml` model override.

---

## Cost summary

- gpt-4o-mini at ~$0.15/1M input + $0.60/1M output tokens.
- Code-agent total across 3 rounds: 411,456 tokens (mostly tool-loop input — file contents + LLM-generated reasoning + tool results).
- Estimated cost: **~$0.10 USD** for 3 failed rounds. (For comparison: TEST_REPORT_008's 3 gpt-4o rounds ran ≈ 100 k tokens at ~$0.30; this report's 3 mini rounds ran ≈ 400 k at ~$0.10. The 10× per-token saving is the dominant factor.)

The cost target from the brief (~$0.10-0.15 per successful cycle) is **mechanically achievable on gpt-4o-mini** once the cap-inside-batch bug is fixed and the code-agent can actually exit the tool-loop cleanly.

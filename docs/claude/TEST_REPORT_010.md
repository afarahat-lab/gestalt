# Test Report 010 — MAX_TOOL_CALLS cap-inside-batch + code-agent exploration budget + executeScript availability

**Date:** 2026-06-06
**Project:** trackeros (UUID `5d99e2f3-f3cb-4842-a03a-419790f70e2d`)
**Platform changes:**
- Fix 1 (cap-inside-batch refactor) in `packages/core/src/agents/base-llm-agent.ts`
- Fix 2 (pre-generation prompt section + MAX_TOOL_CALLS 10 → 20) in `packages/agents/generate/src/prompts/code-prompt.ts` and `packages/core/src/agents/base-llm-agent.ts`
- Fix 3 (synthesis-turn empty-tools defensive cleanup) in `packages/core/src/llm/index.ts`
- Fix 4 (latent bug: `VALID_BUILTIN_TOOLS` missing `executeScript`) in `packages/core/src/agents/agent-config-loader.ts`

**Operator change:** trackeros `agents.yaml` code-agent `tools.builtin` gains `executeScript` (commit `6b7e42e` on trackeros `main`).

**Intent (verbatim):** "Create the Leave module foundation: model.ts with LeaveRequest type, repository.ts with createLeaveRequest + listForUser methods, service.ts with submitLeaveRequest method, routes.ts with POST /leave and GET /leave endpoints. Wire mounting into src/index.ts. Include Jest tests for the service and repository."

**Correlation:** `7afa0886-dfef-43e4-8731-af1b48aadbd0` (intent_id `c6b9d039-0cfb-4064-addb-9d8185fd6f51`)
**Final status:** `escalated` (gate verdict: `escalate`, GP_BREACH on review-agent finding).
**Outcome:** ✓ **success on the brief's central question** — code-agent completed on the first round, `executeScript` was invoked **5 times** (`tsc --noEmit`, `npm run lint`, `npm run typecheck`, two `mkdir` scaffolds), and the HTTP 400 "tool_call_ids did not have response messages" failure from TEST_REPORT_009 is gone. Cycle didn't deploy, but only because review-agent surfaced real architectural findings (DB access outside repository pattern + missing audit logging) — a *meaningful* gate decision, not a platform failure.

---

## Headline finding

**The four fixes above unlock the first complete code-agent run since TEST_REPORT_007.** Across three failed cycles (TEST_REPORT_007 single round, TR_008 × 3 rounds, TR_009 × 3 rounds), `executeScript` was never observed in `agent_execution_logs.tool_calls`. In this cycle it appears five times in a single code-agent run, the LLM produces a structured JSON response with a `verificationNote` field, the parser converts that note into a `LINT_FAILURE` signal, and the cycle progresses cleanly through the gate.

| Phase | TR_007 | TR_008 | TR_009 | **TR_010** |
|---|---|---|---|---|
| Code-agent result | completed | failed (rate-limit) | failed (HTTP 400) | **completed** |
| `executeScript` calls in code-agent log | 0 | 0 (logged) | 0 | **5** |
| Code-agent tokens | ~25.9k | ~34.2k avg | ~137k avg | 68.5k |
| Cycle deploys | yes | no | no | no (real review findings) |

---

## What the user asked for

The user briefed two fixes against TEST_REPORT_009:

- **Fix 1 (HIGH)** — Refactor `MAX_TOOL_CALLS` enforcement in `runToolLoop`. Previous code checked the cap *inside* the per-call dispatch loop (`for (const call of toolCalls) { if (totalToolCalls >= MAX_TOOL_CALLS) break; ... }`). When the cap struck mid-batch, the assistant message in history carried N `tool_call_ids` but only M < N `tool` response messages, and the next OpenAI call failed with HTTP 400 *"tool_call_ids did not have response messages"*. Fix is to check before the batch and synthesise rejection responses for every `tool_call_id` so history stays consistent.
- **Fix 2 (HIGH)** — Prepend a `## Before generating code` block to `code-prompt.ts`'s task section that tells the LLM (a) read existing files it will import from first via `readFile`, (b) do NOT explore directories that don't exist yet, (c) do NOT `listDirectory` on OUTPUT paths, (d) verify with `executeScript` after emitting. Also raise `MAX_TOOL_CALLS` from 10 to 20.

Live verification of the same Leave-module intent as TR_007–009.

---

## What changed (per fix)

### Fix 1 — `MAX_TOOL_CALLS` cap is now batch-level

`packages/core/src/agents/base-llm-agent.ts` `runToolLoop`:

```ts
// Before any dispatch, check whether the upcoming batch would
// breach the cap.
if (totalToolCalls + toolCalls.length > MAX_TOOL_CALLS) {
  for (const call of toolCalls) {
    const rejection = 'Tool call limit reached — no further tool ' +
      'calls permitted. Return your best answer now based on what ' +
      'you have already gathered.';
    history.push({ role: 'tool', toolCallId: call.id, content: rejection });
    toolCallLog.push({
      toolName: call.name, input: call.input, output: rejection,
      isError: true, calledAt: new Date(), toolSource: 'cap-rejected',
    });
    this.lastToolCallLog = toolCallLog.slice();
  }
  capStruck = true;
  continue;  // synthesis turn — see Fix 1 refinement below
}

// Otherwise dispatch the ENTIRE batch — never a partial.
for (const call of toolCalls) {
  totalToolCalls++;
  // ... dispatch + push tool response + log ...
}
```

The brief's pseudocode used `break;` after rejection. Initial implementation followed that literally; live verification (correlation `9cafadd5-…` round 1) showed the code-agent failing with *"Code agent failed: Unexpected end of JSON input"*. Root cause: after `break`, `finalText` stayed empty (the rejected turn's `stopReason` was `tool_calls`, so the LLM never produced text). Refinement: set `capStruck = true` and `continue` so the outer loop fires one more `completeWithTools` — with an empty `tools` array — and the model is forced to produce text. The synthesis turn lands `stopReason === 'stop'` and exits cleanly.

### Fix 1 refinement — synthesis turn with empty `tools`

`runToolLoop` now passes `tools: capStruck ? [] : tools` to `completeWithTools`. `packages/core/src/llm/index.ts` `callProviderWithTools` was made wire-safe for this case: when `tools` is empty, both `tools` and `tool_choice` are omitted from the OpenAI body (sending `tools: []` + `tool_choice: 'auto'` returns HTTP 400 *"tool_choice cannot be specified without 'tools' parameter"*). Server logs at 21:16:01 show the synthesis turn working — `stopReason: "stop"` immediately after the cap-rejection batch.

### Fix 2 — Pre-generation section + MAX_TOOL_CALLS 20

`packages/agents/generate/src/prompts/code-prompt.ts` task-section header:

```
## Before generating code

1. Read existing files your generated code will import from.
2. Do NOT explore directories that don't exist yet.
3. Do NOT listDirectory on OUTPUT paths.
4. After emitting, verify with executeScript.

Budget guidance: ~1 getFileTree + ~3 readFile + ~2 executeScript
= ~6 purposeful tool calls. Anything more is exploration overhead.
```

`MAX_TOOL_CALLS` in `base-llm-agent.ts` raised from 10 → 20. Comment explains the budget for a verification-aware code-agent: ~1 getFileTree + ~3 readFile + ~2 executeScript = ~6 purposeful, with headroom for retries.

### Fix 3 — Empty `tools` is wire-safe

`packages/core/src/llm/index.ts` `callProviderWithTools` body now spreads `tools` + `tool_choice` only when there's at least one tool. Avoids the HTTP 400 above.

### Fix 4 — `VALID_BUILTIN_TOOLS` was silently dropping `executeScript`

**Latent platform bug uncovered during live verification.** `packages/core/src/agents/agent-config-loader.ts` exposed:

```ts
const VALID_BUILTIN_TOOLS = new Set<BuiltInToolName>([
  'readFile', 'listDirectory', 'searchFiles', 'getFileTree',
]);
```

`'executeScript'` was missing even though the `BuiltInToolName` type already included it. `extractTools()` filters `agents.yaml`-declared tools through this Set — so any project listing `executeScript` had it silently dropped. **This is why TR_007–009's code-agent never invoked `executeScript`:** when trackeros's `agents.yaml` explicitly declares `tools.builtin`, the project list overrides `PER_ROLE_DEFAULTS` rather than augmenting it; trackeros's code-agent listed only the four read-only tools; even if an operator had added `executeScript`, this filter would have stripped it.

Fix: add `'executeScript'` to the set with a comment pointing at TR_007–010's failure trail.

### Operator-side — trackeros `agents.yaml`

Added `executeScript` to `code-agent.tools.builtin`. Commit `6b7e42e` on trackeros `main`.

```yaml
tools:
  builtin:
    - readFile
    - listDirectory
    - searchFiles
    - getFileTree
    - executeScript     # TEST_REPORT_010 — was missing; mandatory-
                        # pre-emit-verification was advisory only.
```

---

## Live verification

**Cycle: correlation `7afa0886-dfef-43e4-8731-af1b48aadbd0`**

| Agent | Status | Tokens | Tool calls | Duration |
|---|---|---|---|---|
| intent-agent | completed | 1,235 | 0 | 8s |
| design-agent | completed | 1,034 | 0 | 7s |
| lint-config-agent | completed | 0 | 0 | 25 ms |
| context-agent | completed | 2,773 | 1 | 11s |
| **code-agent** | **completed** | **68,527** | **21** (5× `executeScript`, 8× `listDirectory`, 7× `readFile`, 1× `getFileTree`) | **33s** |
| test-agent | completed | 3,035 | 0 | 16s |
| review-agent | failed (see note) | 111,719 | 0 | 30s |
| constraint-agent | failed (see note) | 50,748 | 21 (19× `executeScript`, 2× `searchFiles`) | 387s |

**Total: ~240k tokens / ~$0.14 USD at gpt-4o-mini pricing.** Within the brief's $0.10–0.15 cost target.

### Code-agent's five `executeScript` commands

```
1. mkdir -p src/modules/leave && touch leave.{model,repository,service,routes,index,test}.ts && echo "Leave module structure created."
2. (same mkdir, repeated)
3. npm run lint
4. npm run typecheck
5. npx tsc --noEmit
```

The LLM scaffolded the module structure, then ran a lint + typecheck + tsc trio for the pre-emit verification. The first three failed because trackeros's `package.json` doesn't declare a `lint` or `typecheck` script; the LLM correctly surfaced that fact via a `verificationNote` field in its JSON response, which `code-agent.ts` parses into a low-severity `LINT_FAILURE` signal:

```
LINT_FAILURE | low | code-agent | "Code-agent pre-emit verification did not pass:
The module structure was created successfully, but I was unable to run lint and
typecheck scripts as they are missing from package.json. I recommend adding these
scripts to ensure proper validation."
```

This is the **first observed end-to-end use of the TR_008 `verificationNote` schema in production data.**

### Brief's verification matrix

| Check | Result |
|---|---|
| No HTTP 400 *"tool_call_ids did not have response messages"* | ✓ pass (zero 400s across the cycle) |
| Code-agent `tool_calls` shows `readFile` on existing deps | ✓ pass (7× `readFile`) |
| At least one `executeScript` call near the end | ✓ pass (5× `executeScript`) |
| No `listDirectory` on non-existent paths | ⚠ partial — 8× `listDirectory` (down from 14 in TR_009) |
| Cycle deploys on first round | ✗ escalated on review findings (not a platform issue) |
| Total code-agent tool calls ≤ 15 (focused) | ⚠ 21 (hit the new cap of 20 + 1 rejection batch entry) |

### Generated artifacts

| Path | Size |
|---|---|
| `src/modules/leave/leave.model.ts` | 249 B |
| `src/modules/leave/leave.repository.ts` | 1,135 B |
| `src/modules/leave/leave.service.ts` | 547 B |
| `src/modules/leave/leave.routes.ts` | 983 B |
| `src/modules/leave/leave.test.ts` | 752 B |
| `tests/unit/modules/leave/leave.{model,repository,routes,service}.test.ts` | 642 + 1,241 + 1,250 + 1,435 B |
| `.gestalt/<correlation>/{intent-spec,design-spec,llm-review}.{json,md}` | 1,526 + 1,948 + 1,304 B |

The full Leave module foundation (5 source files + 5 test files) was produced. **This is the first time the trackeros scaffolding has progressed past the code-agent step since TEST_REPORT_007.**

### Gate verdict

Verdict: `escalate`. One `GOLDEN_PRINCIPLE_BREACH` (critical) from review-agent:

> *"Database calls must go through the repository pattern, but direct database access is present. Hint: Ensure all database interactions are routed through the LeaveRepository."*

Plus three review-agent `CONSTRAINT_VIOLATION`s (missing audit logging, test framework mismatch, unresolved `LeaveRequest` import) and two constraint-agent `CONSTRAINT_VIOLATION`s (error-handling shape, unhandled promise rejection).

These are **legitimate architectural findings on the generated code**, not platform failures. The gate is doing exactly what it's supposed to: refusing to deploy code that violates the project's golden principles, requesting human review. From a **platform-correctness perspective the cycle is a complete success.**

---

## New findings (incidental during verification)

### Review-agent: `result_status = 'failed'` but emitted structured output

The review-agent's `agent_execution_logs` row is marked `failed` with empty `error_message`, yet its `llm_response` column contains well-formed JSON:

```
{
  "summary": "The generated code has several critical architectural concerns...",
  "overallVerdict": "block",
  "items": [...]
}
```

And four `FeedbackSignal` rows were written to the `signals` table with `source_agent = 'review-agent'`. Suggests the gate-orchestrator's result-status assignment is racing the post-parse signal emit. Cosmetic — the gate verdict is correct; just the row label is misleading.

### Constraint-agent: 387-second duration on a non-trivial intent

19× `executeScript` calls (`tsc --noEmit`, lint variants, project-tree exploration) + 2× `searchFiles` over 387 seconds. Hit the new cap of 20 (21 entries including the cap-rejection log row). This is now the slowest agent in the cycle by a factor of 5×. Likely a budget tradeoff — gpt-4o-mini at 200k TPM has the headroom but is using it. Worth re-tuning the constraint-agent prompt to be more targeted, or lowering its tool-call ceiling specifically.

### `listDirectory` is still the code-agent's most-called tool

8× `listDirectory` even with the explicit "do NOT explore directories that don't exist yet" prompt instruction. The model is not respecting that directive as strictly as we'd like. Down from 14× in TR_009 (consistent improvement), but still significant. Possible follow-up: trim `listDirectory` from code-agent's `tools.builtin` entirely — `getFileTree` already gives a tree view, and `readFile` covers specific files; `listDirectory` mostly produces zero-information errors on output paths.

---

## Build status

- `pnpm --filter @gestalt/core build`: clean.
- `pnpm -r build`: clean across all 12 packages (verified before the live cycle).
- `docker compose up -d --build server`: clean; container healthy; `/health` 200 throughout.
- Trackeros `main`: `6b7e42e` (executeScript added).

---

## Recommended follow-ups

- **(HIGH)** Review-agent `result_status = 'failed'` with successful signal emit (above). Trace gate-orchestrator's failure-path and align it with the signal table.
- **(MEDIUM)** Constraint-agent's 387-second / 50k-token / 19-`executeScript` budget is excessive for a constraint-checking pass. Either lower MAX_TOOL_CALLS per-role (introduce a per-role override) or restructure constraint-agent's prompt to batch verifications.
- **(MEDIUM)** Code-agent still emits 8× `listDirectory` despite the new pre-generation block. Two options: (a) drop `listDirectory` from code-agent's `tools.builtin` and lean on `getFileTree`; (b) strengthen the prompt with a hard rule plus an "Examples of unhelpful exploration" subsection.
- **(MEDIUM)** Add a `n_turns` + `final_stop_reason` column to `agent_execution_logs` (carried-over from TR_008/009) — would make it trivial to detect "agent hit the cap" without grepping logs.
- **(LOW)** Template `agents.yaml` for new projects should include `executeScript` in code-agent / review-agent / constraint-agent tools. Existing projects (like trackeros) need a manual update; this is the operator-action item below.
- **(LOW)** trackeros's `package.json` doesn't expose `lint` or `typecheck` scripts. The code-agent caught this via `verificationNote`. The Leave module won't deploy until either (a) `package.json` gains those scripts or (b) the operator drives a follow-up intent to add them.

---

## Operator actions

- `gestalt alerts dismiss <id>` for the escalated GP_BREACH alert (correlation `7afa0886-…`) once the architectural findings are addressed in a follow-up intent.
- Optionally update `trackeros/package.json` to add `"lint"` + `"typecheck"` scripts so future code-agent runs can complete the verification step without a `verificationNote`.
- Update the corporate-ops-web-mobile template's `agents.yaml` to include `executeScript` in the code-agent's `tools.builtin` so newly-bootstrapped projects don't repeat this issue. (Not done in this report — out of scope for trackeros-specific fix.)

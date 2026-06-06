# Test Report 014 — Aider as a swappable code-generation backend

**Date:** 2026-06-06
**Project:** trackeros
**Intent (verbatim):** "Create src/modules/leave/leave.service.ts implementing the LeaveService class. It must import LeaveRepository from './leave.repository' and implement submitLeaveRequest(req): Promise\<LeaveRequest\> by delegating to leaveRepository.createLeaveRequest(req). Also generate the matching unit test at tests/unit/modules/leave/leave.service.test.ts using vitest. Scope: ONLY the service file and its unit test. Out of scope: API routes, RBAC middleware, audit logging, input validation middleware, any other modules outside src/modules/leave."
**Correlation:** `3a114a1d-b375-4628-b089-5374340dc3cc` (intent_id `c2772306-fdc9-4722-8c68-402a47e5b438`)
**Final status:** `failed` after **8 rounds** — same gate-max-retries pattern as TR_013, terminated by TR_012's review-agent loop detector at 77% repeat rate.

**Outcome:** **Aider backend ships and works structurally; review-agent hallucination is now the dominant failure mode regardless of code-generation backend.**

Aider 0.86.2 ran 8 times in the cycle. Each invocation produced exactly the two files asked for in 6–13 seconds (vs the Gestalt-native code-agent's 33–735 seconds in TR_013). The test-agent step was skipped on all 8 rounds — Aider produced the test file inline. The code Aider emitted is the cleanest leave.service.ts of the four cycles to date — 15 lines, correctly imports `LeaveRepository`, correctly delegates. **Yet the cycle still fails on the same "Direct DB access" hallucination from review-agent / constraint-agent that TR_013 documented**, because the gate layer is unchanged and the LLM's categorical confusion about the repository pattern is independent of the code-generation backend.

This is the cleanest possible isolation result for the TR_013 follow-up: switching out the code-generation backend changes nothing about the gate's behaviour — Approach A (tighter HARNESS.json rule wording) is still the next required fix.

---

## What changed

### Part 1 — Aider installed in the server image

`packages/server/Dockerfile`, production stage:

```dockerfile
RUN apk add --no-cache git openssh-client python3 py3-pip \
    && apk add --no-cache --virtual .aider-build-deps build-base python3-dev \
    && pip3 install --no-cache-dir --break-system-packages aider-chat \
    && apk del .aider-build-deps
```

build-base + python3-dev are installed temporarily (Aider depends on tree-sitter which has C extensions that need to compile from source on aarch64-alpine), then removed via `apk del .aider-build-deps` in the same layer so the runtime image stays lean. Verified with `docker compose exec server aider --version` → `aider 0.86.2`.

### Part 2 — AiderAdapter

`packages/agents/generate/src/adapters/aider-adapter.ts` (new):

- `runAider(message, workDir, modelString, apiKey, baseUrl, timeoutMs)` — returns `AiderResult { success, output, error, filesChanged, exitCode, durationMs, timedOut }`.
- Command: `aider --yes --no-git --model "<m>" --message "<escaped>"`.
- Credentials forwarded via `extraEnv` to executeScript: `OPENAI_API_KEY` + `OPENAI_API_BASE` + `AIDER_NO_AUTO_COMMITS=true`. Never via CLI flags (which would leak into the process listing).
- `parseAiderChangedFiles(output)` extracts file paths from `Wrote|Created|Updated|Modified|Edited|Applied edit to` lines; collapses duplicates.

### Part 3 — Aider message builder

`packages/agents/generate/src/adapters/aider-message-builder.ts` (new):

- Concise message: `## Task` + `## Success criteria` + `## Out of scope (do NOT touch these)` + `## Project rules` (from `harness.agentConfig['code-agent'].rules`) + `## Project architecture` (truncated to 2KB) + `## Design context` (truncated to 2KB).
- **No implementation instructions.** Aider decides how.

### Part 4 — AiderCodeAgent + orchestrator wiring

`packages/agents/generate/src/agents/aider-code-agent.ts` (new):

- Extends `BaseLLMAgent`. Overrides `run()` to:
  1. Resolve the platform LLM client for `code-agent` (same per-agent override semantics as the Gestalt-native code-agent).
  2. Pull the latest design-spec artifact from the cycle's correlation_id.
  3. Build the Aider message; run Aider.
  4. Read every file Aider reported writing back from the cycle's clone, persist them as `code`-type artifacts. Files Aider listed but that aren't readable are skipped with a `warn` log.
  5. Persist Aider's stdout as a `design`-type artifact at `.gestalt/<correlationId>/aider-output.md` (rendered as markdown with the prompt, exit code, duration, files-written list, and verbatim Aider output).
- Sets `lastPrompt` / `lastLlmResponse` / `lastModelUsed` on the instance — the dashboard's IntentDetail accordion renders Aider's output exactly like a normal agent's LLM response.

`packages/agents/generate/src/orchestrator/orchestrator.ts`:

- `newAgentForRole(role, harnessConfig)` — new signature. When `harnessConfig?.codeGeneration?.backend === 'aider'`, the code-agent role returns `new AiderCodeAgent()` instead of `new CodeAgent()`.
- Top-level `handleIntentTask` computes `aiderBackend = harnessConfig?.codeGeneration?.backend === 'aider'`. When true, it merges `'test-agent'` into `opts.skipAgents` so the existing self-healing skip path marks test-agent as `skipped` for the dashboard — no new plumbing.

### Part 5 — HARNESS schema

`packages/core/src/harness/index.ts` and `packages/agents/generate/src/types.ts`:

```ts
codeGeneration?: {
  backend: 'gestalt' | 'aider';
};
```

Default `'gestalt'` — existing projects unaffected. Opt-in per project.

### Part 6 — executeScript gains extraEnv

`packages/core/src/tools/file-tools.ts`:

```ts
export async function executeScript(
  command: string,
  workDir: string,
  timeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
  extraEnv?: Record<string, string>,
): Promise<ExecuteScriptResult> {
  ...
  env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
```

Tool-call callers (LLM-tool dispatch) pass undefined and behave exactly as before. Only the Aider adapter passes the OPENAI credentials.

### LLMClient — exposed credentials for shell-out

`packages/core/src/llm/index.ts`:

- `getBaseUrl(): string` and `getApiKey(): string` — exposed so AiderCodeAgent can route Aider through the same registry-resolved endpoint without re-resolving env / vault.
- Comment marks `getApiKey()` callers MUST treat the return value as a secret.

### Part 7 — trackeros opted in

trackeros `HARNESS.json` (commit `ccd99d0` on `main`):

```json
"codeGeneration": {
  "backend": "aider"
}
```

No platform code change required to enable per project.

---

## Live verification

8 rounds. 53 agent executions. 8 code-agent (all `completed`, all Aider). 8 test-agent (all `skipped`). 31 review + constraint signals — 31/31 carry `Evidence: "..."` (TR_013 contract intact).

### Aider produced clean code

Final round's `leave.service.ts` (verbatim from `artifacts`):

```ts
import LeaveRepository from './leave.repository';
import { LeaveRequest } from './leave.model';

class LeaveService {
    private leaveRepository: LeaveRepository;

    constructor() {
        this.leaveRepository = new LeaveRepository();
    }

    async submitLeaveRequest(req: LeaveRequest): Promise<LeaveRequest> {
        return this.leaveRepository.createLeaveRequest(req);
    }
}

export default LeaveService;
```

15 lines. Imports the repository. Delegates as specified. **This is the cleanest leave.service.ts of the four cycles (TR_010 / TR_011 / TR_013 / TR_014)** — the Gestalt-native code-agent always ended up adding scope creep (extra methods, console.log "audit", etc) by round 4+.

Final round's test file:

```ts
import LeaveService from '../../../../src/modules/leave/leave.service';
import LeaveRepository from '../../../../src/modules/leave/leave.repository';
import { describe, it, expect, vi } from 'vitest';

describe('LeaveService', () => {
    let leaveService: LeaveService;
    let leaveRepository: LeaveRepository;

    beforeEach(() => {
        leaveRepository = new LeaveRepository();
        leaveService = new LeaveService();
        leaveService['leaveRepository'] = leaveRepository;
    });

    it('should submit leave request', async () => {
        const req = { ... };
        vi.spyOn(leaveRepository, 'createLeaveRequest').mockResolvedValue(req);
        const result = await leaveService.submitLeaveRequest(req);
        expect(result).toEqual(req);
        expect(leaveRepository.createLeaveRequest).toHaveBeenCalledWith(req);
    });
});
```

Test file is the right shape — but missing the `beforeEach` import (would fail typecheck). Aider produced this in the same 6–13 second session as the source file.

### Aider narrative artifact

Persisted at `.gestalt/3a114a1d-…/aider-output.md` — full prompt sent to Aider, exit code, duration, file list, and verbatim Aider stdout. Operators can read the narrative in the dashboard's IntentDetail accordion exactly like a normal LLM response.

### Wall-clock by round (code-agent only)

| Round | Aider duration | Tokens (platform-tracked) | Files changed |
|---|---|---|---|
| 1 | 12,287 ms | 0 | 2 |
| 2 | 7,782 ms | 0 | 2 |
| 3 | 6,103 ms | 0 | 2 |
| 4 | 8,590 ms | 0 | 2 |
| 5 | 8,956 ms | 0 | 2 |
| 6 | 8,760 ms | 0 | 2 |
| 7 | (one more round during self-healing leg) | 0 | 2 |
| 8 | (terminating round) | 0 | 2 |

Compare to TR_013's code-agent:

| TR_013 round | code-agent duration | Tokens |
|---|---|---|
| 1 | 224,823 ms | 139,888 |
| 2 | 77,351 ms | 142,234 |
| 3 | 161,634 ms | 145,762 |
| 4 | 48,284 ms | 143,562 |
| 5 | 201,405 ms | 160,523 |
| 6 | 719,985 ms | 294,481 |
| 7 | 735,169 ms (failed JSON parse) | 437,213 |

**Aider's code-agent step is 10–80× faster per round** in wall-clock — and never failed (TR_013's round 7 failed on a malformed JSON response, which is a class of failure Aider doesn't have).

### Cycle terminated on the same review-agent loop pattern as TR_013

Alert title: `gate-max-retries` for "Create src/modules/leave/leave.service.ts implementing the L (attempt 2)"

Escalation reason (verbatim):
> *Review-agent loop detected: 24 of 31 findings are identical to the prior attempt (77% repeat rate) across 2 rounds. Likely hallucination — human review required.*

TR_012's Fix 3 fired at 77% in TR_014 (vs 72% in TR_012, 84% in TR_013). The escape hatch is doing its job — without it the cycle would have driven a fourth self-healing attempt.

### Evidence requirement carries through

```
 with_evidence | without_evidence
---------------+------------------
            31 |                0
```

Every review-agent + constraint-agent signal in the cycle carries `Evidence: "..."`. The TR_013 contract is unaffected by the backend swap.

### Same categorical hallucination as TR_013

Sample signal (constraint-agent, round 1):
> *[Repository pattern — VIOLATION: A non-repository file (service, route, controller) calls pool.query(), db.execute(), or new Pool() directly.] The LeaveService class is directly calling a method on the LeaveRepository...*

The LLM reads "Repository pattern violation" and emits it against `LeaveService` because it calls a method on `LeaveRepository`. That IS the repository pattern. The rule's actual content excludes `LeaveService` — it forbids `pool.query` in service code. The categorical confusion is identical to TR_013 and is **not introduced or fixed by the backend swap.**

---

## Comparison: Aider vs Gestalt-native code-agent

| | TR_013 (gestalt) | TR_014 (aider) |
|---|---|---|
| Final status | failed | failed |
| Terminating reason | round-7 code-agent JSON parse failure (CONTEXT_GAP) | gate-max-retries (77% loop reason) |
| Rounds executed | 7 | 8 |
| Code-agent wall-clock total | ~2,168 s (36 min) | ~67 s (1.1 min) |
| Code-agent wall-clock per round | 48–735 s | 6–13 s |
| Code-agent failures | 1 (round 7, malformed JSON) | 0 |
| Test-agent runs | 7 | 0 (skipped 8×) |
| Platform-tracked code-agent tokens | 1,463,663 | 0 |
| Aider's actual token spend | n/a | not visible to platform tracking |
| Evidence-carrying signals | 25/25 | 31/31 |
| LLM categorical confusion ("Direct DB access" hallucination) | present | present |
| Loop-detection escape hatch fired | yes (84%) | yes (77%) |

### What Aider gives you

- **An order of magnitude lower wall-clock** on the code-agent step. 6–13 s per round vs 48–735 s.
- **Zero JSON-parse failures.** Aider writes files directly to disk; the brittle JSON-mode response handling that bit TR_013's round 7 doesn't exist.
- **Less scope creep over rounds.** TR_013's round-4+ code-agent kept adding methods, `console.log` "audit" lines, and dropped requested methods. Aider produced the same minimal 15-line file on every retry.
- **Cleaner observability surface for what the model decided.** The aider-output.md artifact carries the model's narrative of what it changed and why — operator-readable.
- **Per-project opt-in with no platform change.** Existing projects keep running on the Gestalt-native code-agent.

### What Aider costs you

- **Token tracking is invisible.** Aider spends tokens out-of-band; `tokens_used` is 0 on every code-agent execution row. Operators can't see the cost surface for the Aider-backed step. (Possible follow-up: parse Aider's stdout for its own `Tokens: N sent / M received` summary — Aider does print this for some models.)
- **Aider's verification scope is what it decides.** The Gestalt-native code-agent has the TR_010 `executeScript` mandatory pre-emit step. Aider may or may not run a compile check depending on its internal heuristics. We pass the project rule "You MUST run a compile/lint check via executeScript before emitting" but Aider doesn't necessarily honour it.
- **No CONTEXT_GAP signal on Aider's specific failure modes.** Aider non-zero exit codes today surface as a generic "Aider code generation failed" CONTEXT_GAP. A finer taxonomy (network failure / model refusal / file-write failure) would help operator triage.
- **Test file completeness is Aider's call.** TR_014's test file was missing the `beforeEach` import — Aider scaffolded the call but forgot the import. The Gestalt-native test-agent's prompt would have specified the imports explicitly.

---

## Verification matrix (from the brief)

| Check | Result |
|---|---|
| Server logs show "Running Aider code generation" | ✓ Every round, with `module: "aider-code-agent"` |
| Aider output artifact saved in `.gestalt/aider-output-*.md` | ✓ Path is `.gestalt/<correlationId>/aider-output.md`; full prompt + narrative persisted |
| `leave.service.ts` created correctly in the working dir | ✓ Aider wrote it; AiderCodeAgent re-read it; saved as a `code` artifact for the gate/deploy layers |
| Gate runs on the Aider-generated files | ✓ Both constraint-agent and review-agent reviewed them — emitting the same false positives as TR_013 |
| No tool-budget exhaustion | ✓ Aider sessions are bounded by the 120-s adapter timeout; never hit it in this cycle |
| Compare code quality vs TR_013 | ✓ Aider's 15-line file is cleaner than any of TR_013's intermediate rounds; matches the intent exactly |

---

## What this tells us about the next fix

The TR_013 HIGHEST follow-up was *"Approach A on the project side: tighten trackeros's HARNESS.json constraint rule wording to disambiguate `pool.query` use in repositories"*. TR_014 confirms that recommendation is independent of which code-generation backend the project uses. Swapping the backend changes nothing about the gate's behaviour.

The fix is still: rewrite the constraint rule from `"No SQL queries outside repository classes"` to `"pool.query / db.query is REQUIRED inside *.repository.ts files; FORBIDDEN in *.service.ts / *.controller.ts / *.routes.ts"`. With the evidence column visible to the LLM on retry (`Evidence: "const result = await pool.query<...>"`) and an unambiguous rule, the next cycle should converge in 1 round.

---

## Pending follow-ups

- **(HIGHEST — carryover from TR_013)** Tighten trackeros's HARNESS.json constraint rule wording (Approach A). TR_014 proves the issue is backend-independent.
- **(HIGH — new from TR_014)** Capture Aider's token spend. Aider prints `Tokens: N sent / M received` for some providers in stdout — parse it in the adapter's result and surface as `tokensUsed` on the execution row. Without this, operators are billed in the dark.
- **(MEDIUM — new from TR_014)** Surface Aider exit-code reasons in the CONTEXT_GAP signal. Today's `"Aider code generation failed (exit N): <stderr prefix>"` lumps network / model-refusal / file-write into one bucket.
- **(MEDIUM — new from TR_014)** Constraint-agent's 513-second / 78k-token / round-2 runaway. Independent of TR_014's changes — same constraint-agent budget overshoot pattern as TR_010 / TR_011. Per-role MAX_TOOL_CALLS override is the still-open follow-up.
- **(LOW — new from TR_014)** Aider's test files miss imports. The Gestalt-native test-agent's prompt was explicit about imports; Aider's free-form mode is laxer. Operators can mitigate via `agentConfig.code-agent.rules` adding "Every test file MUST import its testing-framework symbols explicitly (describe, it, expect, beforeEach, etc.)" — no platform fix needed.

---

## Files changed

| File | Change |
|---|---|
| `packages/server/Dockerfile` | Install Python 3 + Aider in the production stage with throwaway build-deps. |
| `packages/core/src/tools/file-tools.ts` | `executeScript` gains `extraEnv?: Record<string, string>` for the Aider credential forward. |
| `packages/core/src/llm/index.ts` | `LLMClient.getBaseUrl()` + `getApiKey()` for the Aider credential forward. |
| `packages/core/src/harness/index.ts` | `HarnessConfig.codeGeneration?: { backend }`. |
| `packages/agents/generate/src/types.ts` | Same field on the generate-side `HarnessConfig` mirror. |
| `packages/agents/generate/src/adapters/aider-adapter.ts` | NEW. `runAider` + `parseAiderChangedFiles`. |
| `packages/agents/generate/src/adapters/aider-message-builder.ts` | NEW. `buildAiderMessage` — task + criteria + outOfScope + rules + architecture + design. |
| `packages/agents/generate/src/agents/aider-code-agent.ts` | NEW. `AiderCodeAgent extends BaseLLMAgent` — drop-in replacement for `CodeAgent` under the Aider backend. |
| `packages/agents/generate/src/orchestrator/orchestrator.ts` | Skip test-agent under Aider mode; thread `harnessConfig` into `newAgentForRole`; branch on the backend flag. |

trackeros (commit `ccd99d0` on `main`):

| File | Change |
|---|---|
| `HARNESS.json` | `"codeGeneration": { "backend": "aider" }`. |

Build status: `pnpm -r build` clean across all 12 packages. Docker image rebuilt — `docker compose exec server aider --version` → `aider 0.86.2`. Server `/health` 200 throughout. New file `docs/claude/TEST_REPORT_014.md`.

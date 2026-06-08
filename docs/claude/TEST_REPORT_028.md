# TEST_REPORT_028.md — Full planning loop with PR-Agent

**Date:** 2026-06-08
**Feature ID:** `e9240cb6-0533-4e0d-a372-f13e297debdd`
**Repo:** https://github.com/afarahat-lab/trackeros
**Outcome:** Feature **blocked** at Phase 2 by a known Aider DTO-drift
issue (TR_023). The autonomous platform machinery — architecture-agent,
planner-agent, phase-evaluator, PR-Agent, self-healing fix-intent,
onSuccessDispatch — all executed correctly end-to-end. The blocker is
Aider's code-generation drift between phases, not platform code.

---

## Feature submission

```
Build the leave management module. Employees can apply for annual,
sick, and emergency leave. Managers approve or reject requests.
The system tracks leave balances and prevents overlapping requests.
```

Submitted via `gestalt feature submit --project trackeros`. The
architecture-agent ran at 20:27:53 and the planner-agent at 20:28:01.

## Planner output (4 phases)

PLAN.md committed to trackeros main:
https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md

| Phase | Title | Result |
|---|---|---|
| 1 | Create leave model | ✓ deployed |
| 2 | Create leave repository | ✗ failed after 2 retries |
| 3 | Implement leave service logic | not reached |
| 4 | Create leave routes | not reached |

The phase-evaluator-agent for Phase 1 returned `partial` and applied
3 scope adjustments to remaining phases (visible in the PLAN.md
`_Adjustment:_` annotations) — the adaptive planner working as
designed.

---

## Per-phase timeline

### Phase 1 — `94f1c8b7` → PR #82 → deployed

| | |
|---|---|
| Aider | 20:29:00 → 20:29:05 (**5s**) |
| CI | passed (no retry) |
| PR-Agent | 20:30:10 → 20:30:37 (**27s**) |
| PR-Agent verdict | `none` (comment posted, no formal review state) → proceed |
| Gate | constraint-agent only (review-agent skipped per ADR-051) |
| Promotion | PR #82 squash-merged at 20:31:04 |
| Wall-clock | submission → deployed: **~2m 44s** |

PR-Agent's "PR Reviewer Guide" comment confirmed on PR #82
(https://github.com/afarahat-lab/trackeros/pull/82). Posted under
the project PAT identity.

Files written by Aider on Phase 1 (discovered via `git status` in
AiderCodeAgent — TR_026 path):
- `src/modules/leave/leave.model.ts`
- `tests/unit/leave.model.test.ts`

### Phase 2 — `af45fd70` → PR #83 → failed (initial attempt)

| | |
|---|---|
| Aider | 20:32:13 → 20:32:28 (**15s**) |
| CI | failed (`TS2339 Property 'leaveType' does not exist on LeaveRequest`) |
| Self-healing | dispatched retry (loop) at 20:33:25 |
| Aider retry | 20:34:00 → 20:34:15 |
| CI retry | failed |
| Self-healing | escalated at 20:35:05 — "retry introduced new violations" |
| **Phase retry 1/2 burned** | planner-level retry triggered |

### Phase 2 — `f777f69a` → PR #84 → failed (planner retry 1/2)

| | |
|---|---|
| Aider | 20:36:06 → 20:36:22 (**16s**) |
| CI | failed (same TS2339 family) |
| Self-healing | retry → 20:37:17 |
| Aider retry | 20:37:56 → 20:38:10 |
| CI retry | failed |
| Self-healing | escalated at 20:39:00 — "retry introduced new violations" |
| **Phase retry 2/2 burned** | planner-level retry triggered |

### Phase 2 — `13d7ac9c` → PR #85/#87 → fix-intent route → failed

| | |
|---|---|
| Aider | 20:39:49 → 20:40:01 (**12s**) |
| CI | failed |
| **Self-healing action: `fix-intent`** | at 20:40:57 — systemic gap detected. Parent intent parked; child intent dispatched autonomously. **TR_024 path firing.** |

#### Self-healing-fix child — `53347035` → PR #86 → deployed

| | |
|---|---|
| Aider | 20:41:28 → 20:41:32 (**4s**) |
| CI | passed |
| PR-Agent | 20:42:22 → 20:42:46 (**24s**) |
| PR-Agent verdict | `none` → proceed |
| Gate | constraint-agent only |
| Promotion | PR #86 merged at 20:43:18 (**title: "Define the LeaveBalance type to include properties: remainingLeaves, ..."**) |
| onSuccessDispatch | fires at 20:43:22 → "Fix deployed — resuming original intent via onSuccessDispatch" |
| Wall-clock | fix dispatched → fix deployed → parent resumed: **~2m 25s** |

#### Phase 2 resumed (after fix-intent) — also failed

| | |
|---|---|
| Aider | 20:43:58 → 20:44:11 |
| CI | failed (`TS2339 totalDays / usedDays / year do not exist on LeaveBalance`) |
| Self-healing | retry → 20:45:08 |
| Aider retry | 20:45:44 → 20:45:56 |
| CI retry | failed |
| Self-healing | escalated at 20:46:47 |
| **20:46:53** | `Phase retry budget exhausted — marking phase failed and feature blocked` |

---

## Final state

- Phase 1: deployed
- Phase 2: failed (3 attempts × 2 self-healing retries each + 1 fix-intent cycle)
- Phase 3: not reached
- Phase 4: not reached
- Feature status: **blocked**
- Stranded PRs #83, #84, #85, #87 closed during test cleanup.

Total wall-clock submission → blocked: **~19 minutes** (20:27:53 →
20:46:53).

---

## Root-cause analysis

### What actually broke

Phase 1 deployed `src/modules/leave/leave.model.ts` with:
```ts
export interface LeaveRequest {
  id: string; employeeId: string; leaveTypeId: string;   // ← leaveTypeId, not leaveType
  startDate: Date; endDate: Date;
  status: 'pending' | 'approved' | 'rejected';
  ...
}
export interface LeaveBalance {
  employeeId: string; leaveTypeId: string; balance: number;
                                          // ← balance, not totalDays/usedDays/year
}
```

Phase 2's Aider runs all wrote `src/modules/leave/leave.repository.ts`
referencing **different field names** that don't exist on the deployed
model:
- `LeaveRequest.leaveType` (model has `leaveTypeId`)
- `LeaveBalance.totalDays`, `usedDays`, `year` (model has `balance`)

This is the **TR_023 DTO/repository drift** issue, already a known
HIGH-priority open follow-up. Aider doesn't consistently read the
existing model file before writing the repository.

### Why self-healing's fix-intent didn't recover the cycle

Self-healing's diagnostician at 20:40:57 chose `action: 'fix-intent'`
— correctly identified as a systemic gap, not a transient CI flake.
The child intent (`53347035`) dispatched:

> "Define the LeaveBalance type to include properties: remainingLeaves,
> usedLeaves, totalLeaves"

Aider wrote a NEW file `leave.model.ts` at **repository root** (not
inside `src/modules/leave/`) defining the requested fields. PR #86
merged cleanly because the new root-level file compiles in isolation
— but `src/modules/leave/leave.repository.ts` imports from
`./leave.model`, which still resolves to the old
`src/modules/leave/leave.model.ts` Phase 1 wrote. tsc never picks up
the new root-level file. So Phase 2's resume retry failed identically
to the pre-fix-intent attempts.

```
/leave.model.ts                    ← created by fix-intent #86 (stray, unused by tsc)
/src/modules/leave/leave.model.ts  ← Phase 1's deployed model (still authoritative)
/src/modules/leave/leave.repository.ts ← Phase 2's drift (imports the wrong fields)
```

The fix-intent agent had no awareness of where the original model
lived. The diagnostician's text didn't include a path constraint, and
Aider made the simplest interpretation.

---

## What this VERIFIES

The TR_028 milestone test is **partially successful** — it verifies
every platform mechanism that was the subject of TR_020 through TR_027:

- ✅ Architecture-agent runs and emits a feature-level design
- ✅ Planner-agent decomposes into phases and commits PLAN.md
- ✅ PLAN.md committed to trackeros main with verifiable content
- ✅ Phase 1 dispatched as a regular `generate:intent`
- ✅ Aider runs in `/opt/aider` venv (TR_027)
- ✅ Aider's writes discovered via `git status --porcelain` —
  no platform stdout parsing (TR_026)
- ✅ CI runs on PR push (gestalt.yml workflow)
- ✅ PR-Agent runs **server-side** via `pr-agent --pr_url=... review`
  in `/opt/pr-agent` venv with LLM creds injected per-call (TR_027)
- ✅ PR-Agent posts the "PR Reviewer Guide" comment on every PR
- ✅ Gate skips review-agent under ADR-051 (constraint-agent only)
- ✅ Phase-evaluator-agent uses `git diff` via executeScript
  (TR_026)
- ✅ Phase-evaluator can adjust remaining phase scopes (`partial`
  verdict applied 3 adjustments visible in PLAN.md)
- ✅ Phase 2 auto-dispatched after Phase 1 deploys (planning
  event-bus subscriber)
- ✅ Self-healing diagnostician chose `action: retry` when the
  error looked transient
- ✅ Self-healing diagnostician chose `action: fix-intent` once
  the pattern repeated — "systemic gap detected"
- ✅ Fix-intent child dispatched with `source: 'self-healing-fix'`
  and `parent_intent_id` linkage
- ✅ Fix-intent child went through the full Aider → CI → PR-Agent →
  gate → deploy cycle (PR #86, ~2m 25s wall-clock)
- ✅ `onSuccessDispatch` envelope fired after the fix-intent
  promotion, resuming the parent (TR_024 design)
- ✅ Cascade-depth brake (`MAX_FIX_INTENT_DEPTH = 2`, TR_025)
  in place — chain depth stayed at 1, no runaway
- ✅ Phase retry budget (`planner.maxPhaseRetries: 2`, TR_022)
  honoured — feature blocked cleanly after exhaustion

## What this DOES NOT verify

- ❌ End-to-end multi-phase autonomous completion of a non-trivial
  feature. Phases 3 + 4 never reached.
- ❌ Self-healing fix-intent **quality**. The diagnostician's
  routing decision was correct; the resulting child intent prompt
  was too vague — it omitted the file path the repository was
  importing from. The dispatched intent text needs more context
  (e.g. the actual import statement, the existing file location).

---

## Pending follow-ups (NEW from TR_028)

- **(HIGH — TR_028 / promotes TR_023)** Aider DTO/repository drift
  remains the single hardest blocker for end-to-end planning loop
  completion. Either (a) extend code-agent's prompt with a
  mandatory "READ the imported model file before writing the
  repository" pre-step, or (b) require the planner to put `model
  + repository` in the same phase. The existing TR_023 rule
  ("require model + repository in the same Aider call") is not
  being enforced by the planner — Phase 1 created the model in
  isolation; Phase 2 created the repository in isolation.

- **(HIGH — TR_028)** Self-healing fix-intent prompt enrichment.
  When choosing `fix-intent`, the diagnostician should include the
  exact failing import path and the deployed model's actual field
  shape in the dispatched intent text. Today the prompt says
  "Define type X with properties A, B, C" without saying WHERE
  the file should live or what the existing model imports look
  like. PR #86 landed a stray root-level `leave.model.ts` that
  was never resolved by tsc.

- **(MEDIUM — TR_028)** Phase-evaluator's `partial` verdict +
  scope adjustments work — PLAN.md was updated with the
  adjustments — but the adjustments don't currently feed back
  into the planner's "phase grouping" decisions. If the
  evaluator notices "Phase 1 only created the model, repository
  still needed in Phase 2", it could also merge "model +
  repository" into one phase rather than just annotating Phase 2.

- **(LOW — TR_028)** The fix-intent flow logs "Fix deployed —
  resuming original intent via onSuccessDispatch" but doesn't
  emit a clear "parent resumed → Aider running" message at the
  resume point. Operators reading logs see two `Running Aider`
  lines back-to-back and have to correlate by intent ID.

## Carryover follow-ups (status updates)

- **(STILL OPEN — HIGH)** TR_023 / TR_028 Aider DTO drift —
  promoted to a TR_028 blocker.
- **(STILL OPEN — HIGH)** TR_018/020: restore TR_010 mandatory
  `executeScript tsc --noEmit` code-agent rule on trackeros's
  HARNESS.json. Would have caught Phase 2's TS errors pre-emit
  before Aider committed.

---

## Cost estimate

Rough envelope per the operator-default `chat-latest` model
(OpenAI chat-latest = gpt-4o family) and the actual LLM calls
this cycle made:

| Agent | Calls | Notes |
|---|---|---|
| architecture-agent | 1 | small prompt |
| planner-agent | 1 | medium prompt |
| phase-evaluator-agent | 5 | Phase 1 + 4 Phase 2 attempts (each call uses `callLLMWithTools` to run git diff) |
| Aider code-agent | 7 | Phase 1 + 3 Phase 2 initial + 3 self-healing retries (each with its own LLM session) |
| PR-Agent | 2 | Phase 1 #82, fix-intent #86 (each ~$0.01-0.03 of gpt-4o input+output) |
| constraint-agent | 2 | Phase 1 #82, fix-intent #86 |
| self-healing-agent | 4 | one diagnostician call per CI failure pair |

Aider's `tokens_used` capture is still a TR_014 open follow-up
(code-agent execution rows show 0 tokens), so a precise dollar
figure can't be derived from the agent_executions table. Rough
order-of-magnitude estimate **$0.30 – $0.80** for the full
19-minute cycle.

---

## URLs

- Feature dashboard: would be at `http://localhost:3000/app/projects/trackeros/features/e9240cb6-0533-4e0d-a372-f13e297debdd`
- PLAN.md: https://github.com/afarahat-lab/trackeros/blob/main/PLAN.md
- Phase 1 deployed PR: https://github.com/afarahat-lab/trackeros/pull/82
- Fix-intent deployed PR: https://github.com/afarahat-lab/trackeros/pull/86
- Stranded Phase 2 PRs closed: #83, #84, #85, #87

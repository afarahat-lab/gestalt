# Test Report 011 — Scoped service-layer intent + TR_010 escalation analysis

**Date:** 2026-06-06
**Project:** trackeros (UUID `5d99e2f3-f3cb-4842-a03a-419790f70e2d`)
**Setup commit:** trackeros `5e619a9` — cherry-picked `src/modules/leave/{leave.model.ts, leave.repository.ts}` from `gestalt/a41959f9-create-the-leave-module-foundation` (TR_007's branch) onto `main` so the scoped service intent has a real dependency to import from.
**Intent (verbatim):** "Create src/modules/leave/leave.service.ts with a LeaveService class. The service depends on ILeaveRepository (import the interface from leave.repository.ts which already exists). Implement submitLeaveRequest method that validates the employee has sufficient balance then calls repository.createRequest. Implement getEmployeeLeave method that calls repository.findByEmployeeId. The service must not access the database directly — all DB operations go through the repository interface. Include Jest unit tests in tests/unit/modules/leave/leave.service.test.ts that mock ILeaveRepository."

**Correlation:** `11a08e08-b191-48ba-b7b9-2c213123d350` (intent_id `6a3d96bf-9be3-4d83-8931-4128faf67031`)
**Final status:** `failed` after **8 rounds** of generate → gate → retry. **Note:** this exceeds the configured budget (`qualityGate.maxRetries: 3` + `selfHealing.maxAttempts: 2` = 6 max). Believed cause: the constraint-agent's verdict-passed in round 4 may reset the retry counter; needs verification.
**Total cost:** **2,472,848 tokens / ~$0.74 USD** at gpt-4o-mini pricing.

**Outcome:** ✗ **failed.** Not a platform-fix failure — the four TR_010 platform fixes all continue to work cleanly. The failure is at the **review-agent semantics layer**: review-agent persistently hallucinates findings (audit logging, "DB-pattern violation" against code that correctly delegates, unresolvable imports against existing files) every round, the orchestrator can't tell hallucinated findings from real ones, and the cycle burns through 8 rounds chasing review-agent's phantom complaints.

---

## Step 1 — TR_010 escalation analysis

TR_010's correlation `7afa0886-…` escalated on a `GOLDEN_PRINCIPLE_BREACH` from review-agent: *"Database calls must go through the repository pattern, but direct database access is present."* The brief asked: was this genuine?

**Reading the generated `leave.service.ts` from TR_010:**

```ts
import { LeaveRequest } from './leave.model';
import { LeaveRepository } from './leave.repository';
import { AppError } from '../../shared/types/index';

export class LeaveService {
  constructor(private readonly leaveRepository: LeaveRepository) {}

  async submitLeaveRequest(leaveRequest: LeaveRequest): Promise<LeaveRequest> {
    return this.leaveRepository.createLeaveRequest(leaveRequest);
  }
}
```

The service:
- Imports `LeaveRepository` (the class), not `pg.Pool`.
- Takes the repository via constructor injection.
- Delegates `submitLeaveRequest` to `this.leaveRepository.createLeaveRequest(...)`.

**No `pool.query`. No direct DB access. The GP_BREACH was a FALSE POSITIVE.**

The generated `leave.routes.ts` instantiates `new LeaveRepository()` directly inline (a separate concern about routes-vs-DI), but even there it goes through the repository class — never through `pool` directly.

### Verdict on each TR_010 review-agent finding

| Finding | Genuine? | In scope? | Should have been |
|---|---|---|---|
| GP_BREACH "Direct DB access in service" | **No** — service correctly delegates | n/a | Not emitted |
| CV "Missing audit logging" | Yes | **Out of scope** — intent didn't request it | Suppressed per the review-agent rule "Do not flag golden principle violations for concerns excluded by IntentSpec.outOfScope" |
| CV "Test framework mismatch — missing Jest imports" | Mixed — `src/modules/leave/leave.test.ts` lacks `@jest/globals` imports; the `tests/unit/...` files don't | Yes | Should have specified which file |
| CV "Import cannot be resolved for `LeaveRequest` in routes" | **Wrong target** — `LeaveRequest` IS imported; the actual missing import is `LeaveRepository` (used as `new LeaveRepository()` without being imported) | Yes | Real bug, wrong symbol identified |
| Constraint-agent CV "console.log / error.message exposure" | Real concern about `res.status(500).json({ message: error.message })` exposing info | Yes | Real, but the rule cited (`No console.log/warn/error`) is unrelated |
| Constraint-agent CV "Unhandled promise rejection" | **Wrong** — routes DO have try/catch | Yes | False positive |

**Three out of five review-agent findings were false positives or mistargeted.** Of the two genuine findings, one (audit logging) was explicitly out of scope. The single legitimate critical-severity escalation was on a finding the review-agent should not have raised.

### Should the GP_BREACH have been a lower-severity CV?

Not even that — it shouldn't have been emitted at all. The service code is structurally correct for the pattern the rule enforces. The right fix is upstream: review-agent needs to either (a) verify the finding by running `tsc --noEmit` + grepping for `pool.query` / `db.query` outside `shared/db/` (Fix in TR_007 was supposed to do this — clearly it isn't working), or (b) drop the finding type entirely when the service-level file under review correctly delegates to a repository-pattern instance.

---

## Step 2 — Scoped intent execution

The brief's hypothesis: a tightly-scoped intent (one source file + one test, against a known-existing dependency) avoids the scope-creep + false-positive pile-up that escalated TR_010.

### Setup

Trackeros `main` had `src/shared/{db,types}` from earlier scaffolding but no `src/modules/leave/`. TR_007's PR was reported as merged but the PR list (#39–#48) shows no leave-module PR ever opened. Setup commit `5e619a9` seeded `leave.model.ts` + `leave.repository.ts` from the TR_007 branch onto `main`, giving the scoped intent a real dependency to import.

### Execution

| Round | Code-agent (tokens / tool calls) | Constraint-agent | Review-agent |
|---|---|---|---|
| 1 | 139,587 / 21 | failed (15 tc) | failed (0 tc, 89,707 tok) |
| 2 | 139,808 / 21 | failed (10 tc) | failed (0 tc) |
| 3 | 289,228 / 21 | failed (21 tc) | failed (0 tc) |
| 4 | 145,138 / 21 | **passed** (5 tc) | failed (0 tc) |
| 5 | 379,701 / 21 | failed (8 tc) | failed (0 tc) |
| 6 | 159,994 / 21 | failed (13 tc) | failed (0 tc) |
| 7 | 106,453 / 14 | failed (9 tc) | failed (0 tc) |
| 8 | 115,504 / 16 | failed (9 tc) | failed (0 tc) |

**Code-agent total across 8 rounds:** 125× `executeScript`, 23× `readFile`, 8× `getFileTree`, **zero `listDirectory`**.

### What worked

- **TR_010 pre-generation prompt landed.** `listDirectory` dropped from 8× in TR_010 to **0×** in TR_011 across all 8 rounds. The prompt instruction "do NOT explore directories that don't exist yet" is being respected.
- **`readFile` correctly hit the existing dependency files.** Distinct paths read across rounds:
  - `src/modules/leave/leave.repository.ts` ✓
  - `src/modules/leave/leave.model.ts` ✓
  - `src/shared/types/index.ts` ✓
  - `src/shared/db/connection.ts` ✓
- **`executeScript` invocation is now consistent.** TR_007–009 had zero; TR_010 had 5; TR_011 averages ~15.6/round. The mandatory pre-emit verification is wired and active.
- **The first round's service.ts correctly imports `ILeaveRepository`** from the existing file (visible in the readFile hits + the artifact). The brief's "did the code-agent correctly import from the existing repository?" question is yes.

### What didn't work

- **Review-agent hallucinated the same false-positive every round.** Across all 8 rounds it emitted:
  - "Missing audit logging" (8/8 rounds — out of scope per intent)
  - "Database calls must go through repository pattern" against code that correctly delegates (6/8 rounds — false positive, same as TR_010)
  - "Import cannot be resolved" against imports that resolve correctly (5/8 rounds — same as TR_010)
  - "Missing RBAC enforcement" (5/8 rounds — out of scope)
- **Constraint-agent hallucinated too.** "process.env.DATABASE_URL = hardcoded credentials" misreads `process.env.*` (the safe pattern for config) as a credentials violation. The file under review is `src/shared/db/connection.ts` — **pre-existing infrastructure on `main`**, not generated this cycle. Constraint-agent is flagging code outside the intent's scope.
- **Positive feedback loop induced scope creep.** By round 8 the LLM had:
  - **Added** `updateLeaveRequest` + `deleteLeaveRequest` methods (not in the intent)
  - **Dropped** `getEmployeeLeave` (explicitly in the intent)
  - **Added** `console.log("Leave request created: …")` as a "fix" for the audit-logging finding → constraint-agent then correctly flags the new `console.log`
  - **Added** `LeaveStatus.Deleted` enum value (doesn't exist in `shared/types`)

  The cycle is now a worse-quality version of the original.
- **Cycle ran 8 rounds, not the configured 6.** `qualityGate.maxRetries: 3` (4 attempts) + `selfHealing.maxAttempts: 2` = 6 max. The constraint-agent passing in round 4 may be resetting the gate retry counter; needs source-level investigation.

### Brief's verification questions

| Question | Result |
|---|---|
| Did `executeScript` fire again? | ✓ Yes — 125× across 8 rounds, every code-agent execution had it |
| Did code-agent correctly import from existing `leave.repository.ts`? | ✓ Yes — `readFile` on it in every round; round 1 service.ts imports `ILeaveRepository` from the right path |
| Did the service correctly use the repository interface (not `pool.query`)? | ✓ Yes — `this.leaveRepository.createRequest(...)` in every round; no `pool.query` in service |
| Did the gate pass cleanly with no false positives? | ✗ No — same false positives as TR_010 fired every round |
| Was the intent scope narrow enough to avoid GP_BREACH? | ⚠ Mixed — no GP_BREACH escalations across 8 rounds (different from TR_010), but `escalate` was replaced by `fail` after retry-budget exhaustion |

---

## Root cause

**Review-agent's verification step is not actually verifying.** TR_007 added the four-bullet "Verification guidance" block telling review-agent to run `tsc --noEmit` before flagging unresolved imports, `readFile package.json` before flagging missing deps, etc. **Review-agent's `tool_calls` is `0` in every round.** The prompt is rendered, the tool is available, but the LLM isn't reaching for it.

Three structural reasons:

1. **Review-agent's prompt incentive is misaligned.** The system says "find concerns"; the LLM optimises for finding concerns. When the file under review structurally satisfies the rule (service delegates to repository), the LLM still produces a critique because that's what it's been told to do.
2. **The "Out of scope" rule isn't being respected.** review-agent has a rule `"Do not flag golden principle violations for concerns excluded by IntentSpec.outOfScope"` — but `outOfScope` in the IntentSpec doesn't enumerate audit-logging or RBAC, so the LLM has no semantic anchor for "don't flag this." Audit-logging was scoped out implicitly by absence-from-intent; the prompt has no mechanism to enforce that.
3. **The orchestrator can't distinguish a hallucinated CV from a real one.** Every CV is taken at face value and routed back into the retry; the code-agent dutifully tries to "fix" the phantom finding; review-agent hallucinates a fresh finding next round (now about whatever the code-agent changed); cycle drifts further from the intent.

The cosmetic TR_010 finding (review-agent `result_status='failed'` while emitting signals) is downstream of this — the LLM produces well-formed JSON, but the gate-orchestrator's downstream parsing or status assignment is racing the signal emit. Cosmetic, but it does mean operators can't trivially distinguish "review-agent crashed" from "review-agent emitted false positives".

---

## Recommended fixes

- **(CRITICAL) Tighten the review-agent's "find concerns" prompt.** Add explicit text: "If the file under review structurally satisfies the rule, DO NOT emit a finding. If the file deferring to another file structurally satisfies the rule, DO NOT emit a finding against the delegator." Plus: "If the concern is not present in IntentSpec.successCriteria AND not in HARNESS.json.constraints.rules, treat it as out-of-scope and do not emit." Cite explicit examples to anchor the LLM.
- **(HIGH) Add deterministic post-LLM verification for review-agent findings.** When review-agent emits "Import cannot be resolved for X", the orchestrator runs `grep -rn "^import.*X" <file>` and drops the finding if it finds the import. When it emits "Direct DB access in service", the orchestrator runs `grep -n "pool\.query\|db\.query" <file>` and drops the finding if there are no hits. Cheap mechanical filter against LLM hallucination.
- **(HIGH) Investigate the 8-round overshoot.** Audit `gate-orchestrator.ts` for whether `retryCount` is incremented per gate-pass or per agent-attempt; the constraint-agent passing in round 4 may have reset something it shouldn't have.
- **(HIGH) Fix the review-agent failed-status bug.** TR_010 noted this cosmetically; TR_011 confirms it persists across 64 agent executions (every review-agent row is `failed` despite emitting valid signals). Trace the gate-orchestrator's `result_status` assignment.
- **(MEDIUM) IntentSpec should explicitly enumerate `outOfScope`.** Today's intent-agent fills `outOfScope` sparsely. Have it list concerns reasonable to exclude based on the brief's narrowness (e.g., "audit logging not requested → audit logging is out of scope"; "RBAC not requested → RBAC is out of scope"). Then review-agent's existing "respect outOfScope" rule has something to bite into.
- **(MEDIUM) Constraint-agent should only review files in the diff.** Today it flagged `src/shared/db/connection.ts` (pre-existing infrastructure on main, not generated this cycle) for "hardcoded credentials" because the file uses `process.env.DATABASE_URL`. That's the safe pattern AND it's not part of the change set. The constraint-agent should scope its review to files in the cycle's artifact set, not the whole project tree.
- **(LOW)** TR_010 pre-generation prompt validated — `listDirectory` is at 0 across 8 rounds. Worth permanently dropping `listDirectory` from code-agent's `tools.builtin` so the prompt section can be simplified.

---

## Build status

- No platform code changed this session.
- Trackeros `main`: `5e619a9` (setup commit only — `leave.model.ts` + `leave.repository.ts` seeded).
- Gestalt server: unchanged from TR_010's `30b5d0b` deploy; healthy throughout.

---

## Operator actions

- `gestalt alerts dismiss <id>` for any open alert from this correlation.
- Decide on review-agent direction: prompt-tighten (cheaper, may not be enough) vs. deterministic post-LLM verification (more code, much more reliable).
- Consider re-running the same scoped intent after the review-agent fix lands, with the same setup; provides clean before/after data.

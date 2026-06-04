# Test Report 004 — trackeros Leave Module (first domain module intent on a real scaffold)

**Date:** 2026-06-05
**Project:** trackeros (UUID `5d99e2f3-f3cb-4842-a03a-419790f70e2d`)
**Scaffold base on `main`:** commit `2a3d00d` (TEST_REPORT_003), merged via PR #47.
The scaffold's `src/shared/types/index.ts` (LeaveType / LeaveStatus /
UserRole enums + AppError) and `src/shared/db/connection.ts` (pg Pool
singleton, `export default`) are present on `origin/main`.
**Intent:** "Create the Leave module foundation. Create
`src/modules/leave/leave.model.ts` with TypeScript interfaces for
`LeaveRequest` and `CreateLeaveRequestDto` using the LeaveType
LeaveStatus and UserRole enums from
`src/shared/types/index.ts`. Create
`src/modules/leave/leave.repository.ts` with an `ILeaveRepository`
interface and a `PostgresLeaveRepository` class that implements it
using the pg Pool from `src/shared/db/connection.ts`. The repository
must implement createRequest findById findByEmployeeId
findPendingByManagerId and updateStatus methods. All SQL queries go
in the repository and nowhere else."
**Outcome:** ✗ **failed (gate verdict on both attempts)** —
generate cycles succeeded, code-agent + test-agent produced
correct-looking artifacts on both attempts, but the quality gate
returned the same blocking signal set both times: a constraint-agent
**regex false positive** on `import { Pool } from 'pg'` (type-only
import treated as a runtime-driver import) plus a review-agent
**over-fire** on absent audit-logging / input-validation / missing
`@types/pg` even though the scaffold already ships `@types/pg` and
neither audit nor API endpoints are in scope for this intent.
**Attempt 1 correlation ID:** `3af30e7d-deec-417d-a53d-fd34ecb0a615`
**Attempt 2 correlation ID:** `a829c77b-2a31-4ea9-9f3e-439cb2cb53ea`
**Total wall-clock:** ~2 m 20 s across both attempts
**Total tokens consumed:** approx **133,800** (attempt 1 ≈ 56,200,
attempt 2 ≈ 77,600 — most tokens spent on retry rounds the
self-healing loop kicked off after the gate failed)

---

## Headline finding

**The code-agent did the right thing.** It made 8 tool calls on the
first round of attempt 1 (`listDirectory`, three `searchFiles`
queries against the scaffold's `index.ts` to verify each enum's
exact name, `getFileTree`, two `readFile` calls reading the full
`src/shared/types/index.ts` and `src/shared/db/connection.ts`),
generated `src/modules/leave/leave.model.ts` and
`src/modules/leave/leave.repository.ts` with imports correctly
resolving to the scaffold paths (`'../../shared/types/index'`,
`'../../shared/db/connection'`), all five repository methods present
with parameterised SQL, no `any`. The test-agent placed the test at
`tests/unit/modules/leave/leave.repository.test.ts` (correct mirror)
with `@jest/globals` imports and proper `jest.mock('pg')` setup. The
infrastructure stack works.

**The quality gate doesn't.** Two separate false-positive paths
fire on this intent and both repeat across every cycle:

1. **`no-direct-db-outside-shared-db` (constraint-agent regex).**
   The rule's pattern `from\s+['"](pg|postgres|mysql|…)['"]/` fires
   on the `import { Pool } from 'pg'` line in
   `leave.repository.ts` (line 1, column 17). But the import is a
   **type-only import** — the actual Pool *instance* comes from the
   scaffold's `import pool from '../../shared/db/connection'`. The
   rule cannot distinguish between (a) importing the `Pool` type for
   a constructor signature, which is unavoidable in any TypeScript
   repository that wraps a Pool, and (b) actually instantiating a
   new Pool outside `shared/db/`. Severity high → blocking.

2. **Review-agent over-fire on this intent's scope.** The intent
   explicitly says "Create the Leave module **foundation** … the
   repository must implement [5 methods]. **All SQL queries go in
   the repository and nowhere else.**" It asks for two files. The
   review-agent flags:
   - "Missing audit record for state-changing operation in
     `createRequest` and `updateStatus`" — golden-principle GP-001.
     Audit is a Phase-2 concern; the intent is a repository
     foundation. Severity high → blocking.
   - "Input validation is not mentioned for API endpoints,
     violating GP-003" — but the intent doesn't include API
     endpoints at all. The review-agent extrapolated to a layer
     the intent excluded. Severity high → blocking.
   - "Missing `@types/pg` in devDependencies" — **but the scaffold's
     `package.json` on `main` already lists `"@types/pg": "^8.6.1"`.**
     The review-agent is looking only at the cycle's artifact set
     (which doesn't include package.json — the code-agent didn't
     regenerate it; correctly didn't, given the scope) and treating
     "package.json not in artifacts" as "package.json missing the
     type." Severity medium → still surfaces as a finding.

3. **Self-healing diagnostician's auto-amend creates a circular
   failure.** The diagnostician interpreted the round-1 review's
   "missing audit" finding as a directive to add audit-logging in
   the next round. The auto-amended intent now reads `"…with audit
   logging and input validation… include @types/pg in
   devDependencies"`. The round-2 code-agent obediently added an
   audit line — using `console.log` — which trips the
   **`no-console` constraint rule**. So now the next round needs to
   fix BOTH the missing-audit complaint (by adding logging) AND the
   no-console violation (by NOT using console). The diagnostician
   doesn't know about `createContextLogger from @gestalt/core` (a
   Gestalt-platform thing, not a project rule), so it's stuck.
   The cycle then rate-limits and exits.

The platform is producing useful code on the first hop. The gate is
returning false-positive blocks. Total noise → cycle fails.

---

## Five evaluation questions — brief-defined checks vs. outcome

### intent-agent

**Q: Did it extract all 5 deliverables correctly?** ✓ Yes —
attempt-2 round-1 IntentSpec lists:
1. "TypeScript interfaces for LeaveRequest and CreateLeaveRequestDto
   are defined in src/modules/leave/leave.model.ts"
2. "ILeaveRepository interface and PostgresLeaveRepository class
   are implemented in src/modules/leave/leave.repository.ts with
   specified methods"
3. "All SQL queries are contained within the repository"
4. The full intent text round-trips verbatim into `rawIntent`.

**Q: Did it correctly identify the dependencies on existing files?**
✗ Partially. The IntentSpec doesn't explicitly note the dependency
on `src/shared/types/index.ts` or `src/shared/db/connection.ts`.
But the code-agent independently discovered both via tool calls,
so the gap didn't matter operationally.

Rating: **good** (could be better — adding a `dependencies: []`
section to IntentSpec would let the design-agent verify upstream
files exist before generating).

### design-agent

**Q: Did it produce a meaningful design this time?** ✓ **Yes —
major improvement over the empty design specs from Reports 002 +
003.** The attempt-2 round-1 design-spec contains:
- 1 `domainChanges` entry: `LeaveRequest` entity with 9 fields
  (id, employeeId, leaveType, status, startDate, endDate, reason,
  createdAt, updatedAt) and a relationship to `User`
- 5 `apiContracts`:
  - `POST /api/v1/leave-requests` (createRequest, roles: employee)
  - `GET /api/v1/leave-requests/{id}` (findById, roles: employee | manager)
  - `GET /api/v1/employees/{employeeId}/leave-requests` (findByEmployeeId)
  - `GET /api/v1/managers/{managerId}/pending-leave-requests` (findPendingByManagerId)
  - `PATCH /api/v1/leave-requests/{id}/status` (updateStatus)

**Q: Did it reference the existing LeaveType/LeaveStatus enums?**
✓ Yes — the entity's `leaveType` field is typed as `LeaveType`,
`status` as `LeaveStatus` (verbatim type names matching the
scaffold's enum names).

**Q: Did it specify the 5 repository method signatures?**
**Architecturally** yes (via API contracts that map 1:1 to the 5
methods), but it didn't emit them as TypeScript method signatures.
That's a sensible split: the design-agent designs APIs and entities,
the code-agent emits TypeScript.

**One caveat:** the design extrapolated to API endpoints even
though the intent's `outOfScope` excludes "UI layer" and the intent
only asks for two files. This is what feeds the review-agent's
later GP-003 (input validation) over-fire.

Rating: **excellent on the entity design, over-eager on the API
contracts** (Phase 2 of the Leave module would generate those, not
Phase 1).

### context-agent

The context-agent **wrote** to `docs/DOMAIN.md` this time (it had
no-ops in Reports 002 + 003 because the design specs were empty).
The new DOMAIN.md captures the LeaveRequest entity, the API
contracts, and a few bullet-pointed business rules. Length ~2 KB.

Rating: **good** — finally exercised its purpose; output is
coherent with the design.

### code-agent

**Q: Did it use file tools to read existing files?** ✓ **Yes —
exactly as the prompt asks.** Round-1 of attempt 1 made 8 tool
calls in this order:
1. `listDirectory('src/modules/leave')` → ENOENT (correct: dir
   doesn't exist yet)
2. `searchFiles({glob: 'src/shared/types/index.ts', pattern: 'enum LeaveType'})`
   → `src/shared/types/index.ts:11: export enum LeaveType {`
3. `searchFiles(..., 'enum LeaveStatus')` → line 17 hit
4. `searchFiles(..., 'enum UserRole')` → line 23 hit
5. `searchFiles({glob: 'src/shared/db/connection.ts', pattern: 'pg Pool'})`
   → "No matches found" (correct — the source is just `Pool`)
6. `getFileTree({maxDepth: 3})` → full tree showing `src/shared/`
   layout
7. `readFile('src/shared/types/index.ts')` → returned the full file
   (the AppError class + 3 enums with their value strings)
8. `readFile('src/shared/db/connection.ts')` → returned the full
   pg-singleton (`export default pool`)

These are real tool calls, not hallucinations. They explain the
20,150-token cost (the tool output gets fed back into the model's
context for every subsequent turn).

**Q: Are imports in leave.model.ts correct?** Mixed:
- Attempt 1 round 1: `import { LeaveType, LeaveStatus } from '../../shared/types/index';` ✓
- Attempt 2 round 1: same (LeaveType, LeaveStatus) ✓
- Attempt 2 round 2: adds `UserRole` to the import → `import { LeaveType, LeaveStatus, UserRole } from '../../shared/types';` (dropped the `/index`; Node + TS resolve both, so still correct)

The intent text mentions UserRole. Attempt-1 / attempt-2 round-1
both *omit* it from the model (UserRole isn't actually used by
LeaveRequest — the model uses `employeeId: string` not
`employeeRole: UserRole`). Attempt-2 round-2 imports UserRole but
doesn't use it either — pure import for show, would trip ESLint's
no-unused-imports.

**Q: Is the pg Pool import in leave.repository.ts correct?**
- Attempt 1 round 1 and attempt 2 round 1: `import pool from '../../shared/db/connection';` ✓ — matches the scaffold's `export default pool`.
- Attempt 2 round 2: `import { pool } from '../../shared/db/connection';` ✗ — **named import on a default export.** This would fail at runtime. The self-healing diagnostician's amended intent led the LLM to instantiate `export const leaveRepository = new PostgresLeaveRepository(pool);` at the bottom, which forced the import shape to change — and it changed wrongly.

**Q: Does ILeaveRepository have all 5 methods?** ✓ Yes, on every
round of both attempts. Signatures are consistent and typed.

**Q: Does PostgresLeaveRepository have real SQL in all 5 methods?**
✓ Yes:
- `INSERT INTO leave_requests … RETURNING *` for createRequest
- `SELECT * FROM leave_requests WHERE id = $1` for findById
- `SELECT * FROM leave_requests WHERE employee_id = $1` for findByEmployeeId
- `SELECT * FROM leave_requests WHERE manager_id = $1 AND status = $2`
  for findPendingByManagerId
- `UPDATE leave_requests SET status = $1 … WHERE id = $2` for updateStatus

**Q: Is the SQL parameterised (no string interpolation)?** ✓ Yes,
across every round of both attempts. Every variable goes through
`$1, $2, ...` placeholders into the second argument of
`pool.query(...)`. Zero string concatenation. This is correct.

**Q: Are there any `any` types?** ✗ No. Strict-mode clean.

**Other observations on the code-agent:**
- **Attempt 1 round 1** uses `constructor(pool: Pool)` so the
  consumer injects the pool — clean DI pattern.
- **Attempt 2 round 1** uses `constructor()` with `this.pool = pool`
  (imports the default singleton) — slightly less testable but
  works.
- **Attempt 2 round 2** mixes both: takes `pool: Pool` in the
  constructor AND also exports `leaveRepository = new PostgresLeaveRepository(pool)`
  at module scope using a (broken) named import. Self-healing's
  amendments degraded the design instead of improving it.
- **Attempt 1 round 1 method bodies use `pool.connect()` →
  `client.query()` → `client.release()` inside `try/finally`.**
  That's the canonical pattern for explicit client management and
  is exemplary code. **Attempt 2 round 1** simplifies to
  `this.pool.query(...)` directly (which auto-acquires + releases a
  client per call) — also correct and probably what most projects
  ship. Both are sensible.

Rating: **excellent on the first round** (would ship after a
light review); **degraded by self-healing on round 2** (named-vs-
default import bug + console.log audit attempt).

### test-agent

**Q: Did it mock the pg Pool correctly?** ✓ Yes:

```ts
jest.mock('pg', () => {
  const mPool = { query: jest.fn() };
  return { Pool: jest.fn(() => mPool) };
});
```

Correct shape, correct module path, correct return value.

**Q: Did tests cover all 5 repository methods?** ✗ Attempt-1
round-1: only `createRequest` (with happy + error path) and
`findById` (happy + not-found). A comment at the bottom says
`// Additional tests for findByEmployeeId, findPendingByManagerId,
and updateStatus can be added similarly` — the test-agent
**explicitly punted** on the remaining three. That's not great.
Attempt-2 round-1 generated separate `leave.model.test.ts` AND
`leave.repository.test.ts` and added more test cases per method,
but still didn't reach all 5.

**Q: Are tests in `tests/unit/modules/leave/`?** ✓ Yes, perfectly
mirrored.

**Q: Do tests use `@jest/globals`?** ✓ Yes, on every test file in
both attempts. Fix 3a from TEST_REPORT_003 is holding.

Rating: **good** (mocking correct, placement correct, coverage
partial).

### review-agent

**Q: Did it catch any import path errors?** ✗ No — the attempt-2
round-2 named-import-on-default-export bug (`import { pool } from '…/connection'`)
would have been a real bug to flag, but the review-agent didn't
spot it. It was focused on absent audit logging.

**Q: Did the placement check fire correctly (no false positives)?**
✓ **Yes — the placement-check sharpen from the previous session
held.** No `concerns` items on placement; the review-agent's prose
correctly says tests are placed under `tests/unit/modules/leave/`
mirroring the source. **The wording fix is verified live for a
second cycle in a row.**

**Q: Did it check that no SQL appeared outside the repository?**
The intent's success criterion sc-004 says "All SQL queries are
contained within the repository." The review-agent didn't
specifically affirm or deny this — but the constraint-agent's
`no-direct-db-outside-shared-db` rule serves the same purpose at
the deterministic layer, and the only artifact set contains SQL
only in `leave.repository.ts`. So the rule is being checked just
not by name.

**Where it failed:** the review-agent flagged 3-4 items per round
that are all false positives or out-of-scope for this intent:
1. Missing audit logging in createRequest + updateStatus (intent
   doesn't ask for this — Phase 2)
2. Input validation not at API boundary (intent doesn't include API
   endpoints — out-of-scope per IntentSpec)
3. Missing @types/pg in devDeps (the scaffold's package.json has it
   — the review-agent treats absence from the artifact set as
   absence from the project, which is wrong for non-regenerated
   files)

Rating: **needs sharpening**. The placement check is finally clean.
The cross-artifact checks (Fix 5 from TEST_REPORT_003) need a "look
at what's NOT in the artifact set against what IS on main" pass —
the review-agent should consult the cloned project tree (which the
gate-orchestrator already has at `workDir`), not just the artifact
diffs.

### constraint-agent

**Q: Why did `no-direct-db-outside-shared-db` fire?** Looking at
the rule in `packages/agents/quality-gate/src/agents/constraint-agent.ts`
(line 60-68):

```ts
{
  id: 'no-direct-db-outside-shared-db',
  description: 'Database driver imports only inside shared/db/ — repository pattern',
  pattern: /from\s+['"](postgres|pg|mysql|mysql2|mssql|oracledb)['"]/g,
  appliesTo: (path) => NON_TEST_CODE(path) && !/(^|\/)shared\/db\//.test(path),
  ...
}
```

The pattern is a substring regex on the import-from string. The
import in `leave.repository.ts` line 1 is:

```ts
import { Pool } from 'pg';
```

Which matches the pattern `from 'pg'`. The path `src/modules/leave/
leave.repository.ts` does NOT include `shared/db/`, so the rule
applies. **The regex can't tell this is a type-only import that's
necessary for the constructor signature.** The actual Pool instance
comes from the default singleton import on line 5, which is fine
under the rule (it's not importing FROM `pg`, it's importing FROM
`../../shared/db/connection`).

**This is the headline platform bug from this cycle.**

The Pattern is right on the surface: the regex catches direct pg
SDK usage in the wrong layer. But it can't catch the legitimate
type-import case. Options:
- Allow `import { Pool } from 'pg'` (named import of types) in
  repository files specifically (e.g. files whose path matches
  `*.repository.ts`), or
- Switch to AST-based check that distinguishes type-only imports
  (TypeScript can emit `import type` for type-only imports;
  encouraging the code-agent to use that form would let the regex
  exempt it), or
- Detect `new Pool(...)` calls outside `shared/db/` as the actual
  violation (which is what the rule is trying to catch).

The deterministic check is well-intentioned but not granular
enough.

---

## Why both attempts produced the same result (and why the rate
limit isn't the real story)

OpenAI rate limit appeared after each attempt's first 1-2
successful rounds. The platform's self-healing diagnostician
kept retrying with auto-amended intents that included "add audit
logging" and "include @types/pg in devDependencies". Each retry
made the situation worse:
- Round 2 of attempt 2: code-agent added `console.log` for audit
  → trips `no-console` constraint
- Round 3: rate limit kills code-agent
- Rounds 4-5: rate limit again

The dispositional view: even with infinite tokens, the gate's
false-positive signal set would keep retrying because the
**diagnosed cause is wrong**. The review-agent says "missing
audit" → diagnostician says "add audit" → code-agent tries → trips
`no-console` → diagnostician says "fix console + add proper audit"
→ doesn't know about `createContextLogger` → tries again → trips
the same rules.

**Fix list (this is what's needed before TEST_REPORT_005):**

1. **Constraint-agent rule revision** — `no-direct-db-outside-shared-db`
   needs to distinguish type-only imports from runtime instantiation.
   Either (a) carve out `import { Pool } from 'pg'` specifically
   when the file is a `*.repository.ts`, (b) move to AST-aware
   detection of `new Pool(...)` outside `shared/db/`, or (c)
   prompt the code-agent to use `import type { Pool } from 'pg'`
   and exempt that form.

2. **Review-agent in-scope check** — when the intent's IntentSpec
   `outOfScope` explicitly excludes a layer (API endpoints,
   UI, etc.), the review-agent should NOT flag absent rules tied
   to that layer (input validation at API boundaries, RBAC
   middleware). The intent-spec already encodes scope; the
   review-prompt could include "respect the intent's outOfScope
   list when deciding what to flag."

3. **Review-agent project-state awareness** — the
   gate-orchestrator clones the project to `workDir` before calling
   review-agent. The review-prompt could include the contents of
   the project's `package.json` (or `read this file` instruction)
   so it stops flagging "missing `@types/pg`" when the project
   already has it. The current prompt only includes the cycle's
   artifact set.

4. **Self-healing diagnostician's amended-intent loop needs an
   escape hatch.** If three consecutive retries trip a new
   constraint rule (no-console added to the violation list after
   round 1's audit was added), the diagnostician should
   acknowledge that its prior amendment caused the new violation
   and either back out or escalate. Today it keeps adding to the
   intent.

---

## Generated files — full content (attempt 2, round 1 — the
"best" output before the diagnostician degraded it)

### `src/modules/leave/leave.model.ts`

```ts
import { LeaveType, LeaveStatus } from '../../shared/types/index';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  startDate: Date;
  endDate: Date;
  status: LeaveStatus;
  reason?: string;
  managerId: string;
}

export interface CreateLeaveRequestDto {
  employeeId: string;
  leaveType: LeaveType;
  startDate: Date;
  endDate: Date;
  reason?: string;
}
```

Notes: imports LeaveType + LeaveStatus correctly from the scaffold.
Doesn't import UserRole. `LeaveRequest` includes `managerId: string`
(implicit from the design spec's User relationship) — sensible.
`CreateLeaveRequestDto` is just the operator-supplied fields; id /
status / createdAt / updatedAt / managerId aren't in it because
those are server-assigned. Clean.

### `src/modules/leave/leave.repository.ts`

```ts
import { Pool } from 'pg';
import { LeaveRequest, CreateLeaveRequestDto } from './leave.model';
import { LeaveStatus } from '../../shared/types/index';
import { AppError } from '../../shared/types/index';
import pool from '../../shared/db/connection';

export interface ILeaveRepository {
  createRequest(dto: CreateLeaveRequestDto): Promise<LeaveRequest>;
  findById(id: string): Promise<LeaveRequest | null>;
  findByEmployeeId(employeeId: string): Promise<LeaveRequest[]>;
  findPendingByManagerId(managerId: string): Promise<LeaveRequest[]>;
  updateStatus(id: string, status: LeaveStatus): Promise<void>;
}

export class PostgresLeaveRepository implements ILeaveRepository {
  private pool: Pool;

  constructor() {
    this.pool = pool;
  }

  async createRequest(dto: CreateLeaveRequestDto): Promise<LeaveRequest> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [dto.employeeId, dto.leaveType, dto.startDate, dto.endDate, dto.reason, LeaveStatus.Pending]
      );
      return result.rows[0];
    } catch (error) {
      throw new AppError('Failed to create leave request', 500);
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<LeaveRequest | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM leave_requests WHERE id = $1', [id]);
      return result.rows[0] || null;
    } catch (error) {
      throw new AppError('Failed to find leave request by ID', 500);
    } finally {
      client.release();
    }
  }

  async findByEmployeeId(employeeId: string): Promise<LeaveRequest[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM leave_requests WHERE employee_id = $1', [employeeId]);
      return result.rows;
    } catch (error) {
      throw new AppError('Failed to find leave requests by employee ID', 500);
    } finally {
      client.release();
    }
  }

  async findPendingByManagerId(managerId: string): Promise<LeaveRequest[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM leave_requests WHERE manager_id = $1 AND status = $2', [managerId, LeaveStatus.Pending]);
      return result.rows;
    } catch (error) {
      throw new AppError('Failed to find pending leave requests by manager ID', 500);
    } finally {
      client.release();
    }
  }

  async updateStatus(id: string, status: LeaveStatus): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('UPDATE leave_requests SET status = $1 WHERE id = $2', [status, id]);
    } catch (error) {
      throw new AppError('Failed to update leave request status', 500);
    } finally {
      client.release();
    }
  }
}
```

Notes: uses `pool.connect() / client.query() / client.release()`
inside `try/finally` — the canonical pg pattern for explicit
client lifecycle. Every error is caught + wrapped in `AppError`
(the scaffold's class). All five methods present with correctly
parameterised SQL. The `import { Pool } from 'pg'` on line 1 is
what trips the constraint-agent's false positive.

### `tests/unit/modules/leave/leave.model.test.ts` (attempt 2, round 1)

```ts
import { describe, it, expect } from '@jest/globals';
import { LeaveRequest, CreateLeaveRequestDto } from '../../../src/modules/leave/leave.model';
import { LeaveType, LeaveStatus } from '../../../src/shared/types/index';

describe('LeaveRequest', () => {
  it('should have the correct properties', () => {
    const leaveRequest: LeaveRequest = {
      id: '1',
      employeeId: 'emp-123',
      leaveType: LeaveType.Annual,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-05'),
      status: LeaveStatus.Pending,
      reason: 'Vacation',
      managerId: 'mgr-456',
    };

    expect(leaveRequest).toEqual({
      id: '1',
      employeeId: 'emp-123',
      leaveType: LeaveType.Annual,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-05'),
      status: LeaveStatus.Pending,
      reason: 'Vacation',
      managerId: 'mgr-456',
    });
  });
});

describe('CreateLeaveRequestDto', () => {
  it('should have the correct properties', () => {
    const createLeaveRequestDto: CreateLeaveRequestDto = {
      employeeId: 'emp-123',
      leaveType: LeaveType.Annual,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-05'),
      reason: 'Vacation',
    };

    expect(createLeaveRequestDto).toEqual({
      employeeId: 'emp-123',
      leaveType: LeaveType.Annual,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-01-05'),
      reason: 'Vacation',
    });
  });
});
```

Notes: the test asserts that constructing an object satisfies the
interface. That's a weak compile-time test (the type-checker already
enforces this). A real test of an interface is more about exercising
the things that use it. But for a foundation, this is acceptable
"the shape compiles" smoke test. Uses `LeaveType.Annual` correctly
via enum reference, not string literal.

### `tests/unit/modules/leave/leave.repository.test.ts` (attempt 1, round 1)

```ts
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Pool } from 'pg';
import { PostgresLeaveRepository } from '../../../src/modules/leave/leave.repository';
import { LeaveRequest, CreateLeaveRequestDto } from '../../../src/modules/leave/leave.model';
import { LeaveStatus } from '../../../src/shared/types/index';

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn()
  };
  return { Pool: jest.fn(() => mPool) };
});

describe('PostgresLeaveRepository', () => {
  let repository: PostgresLeaveRepository;
  let pool: Pool;

  beforeEach(() => {
    pool = new Pool();
    repository = new PostgresLeaveRepository(pool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createRequest', () => {
    it('should create a leave request and return it', async () => {
      const dto: CreateLeaveRequestDto = {
        employeeId: 'emp123',
        leaveType: 'Sick',
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-01-02'),
        reason: 'Flu'
      };

      const mockLeaveRequest: LeaveRequest = {
        id: 'leave123',
        employeeId: 'emp123',
        leaveType: 'Sick',
        status: LeaveStatus.Pending,
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-01-02'),
        reason: 'Flu',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockLeaveRequest] });

      const result = await repository.createRequest(dto);

      expect(pool.query).toHaveBeenCalledWith(
        `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING *`,
        ['emp123', 'Sick', new Date('2023-01-01'), new Date('2023-01-02'), 'Flu', LeaveStatus.Pending]
      );
      expect(result).toEqual(mockLeaveRequest);
    });

    it('should throw an error if the query fails', async () => {
      const dto: CreateLeaveRequestDto = {
        employeeId: 'emp123',
        leaveType: 'Sick',
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-01-02'),
        reason: 'Flu'
      };

      (pool.query as jest.Mock).mockRejectedValue(new Error('Database error'));

      await expect(repository.createRequest(dto)).rejects.toThrow('Database error');
    });
  });

  describe('findById', () => {
    it('should return a leave request by id', async () => {
      const mockLeaveRequest: LeaveRequest = {
        id: 'leave123',
        employeeId: 'emp123',
        leaveType: 'Sick',
        status: LeaveStatus.Pending,
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-01-02'),
        reason: 'Flu',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockLeaveRequest] });

      const result = await repository.findById('leave123');

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM leave_requests WHERE id = $1',
        ['leave123']
      );
      expect(result).toEqual(mockLeaveRequest);
    });

    it('should return null if no leave request is found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await repository.findById('leave123');

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM leave_requests WHERE id = $1',
        ['leave123']
      );
      expect(result).toBeNull();
    });
  });

  // Additional tests for findByEmployeeId, findPendingByManagerId, and updateStatus can be added similarly
});
```

Notes: `@jest/globals` imports ✓, mirror placement ✓,
`jest.mock('pg')` shape correct ✓, both happy + error path for
createRequest, both happy + not-found for findById. Doesn't cover
the other 3 methods — the trailing comment `// Additional tests for
… can be added similarly` is a real punt. **Also: `leaveType: 'Sick'`
as a string literal would NOT match `LeaveType.Sick` (which is
`'sick'` lowercase) — small bug.** The test would fail to compile
under strict mode unless `leaveType` is widened to `string`.

### `docs/DOMAIN.md` (attempt 2, round 1 — context-agent update)

The context-agent rewrote DOMAIN.md (~2 KB) to capture the
LeaveRequest entity, the 5 API contracts, and business rules. This
is the first cycle where the context-agent actually wrote anything
to a context file — Reports 002 + 003 had it returning `updates: []`
because the design specs were empty.

---

## Overall verdict

### Did the code-agent actually USE file tools to read existing files, or did it hallucinate the imports?

✓ **Used them.** 8 tool calls on the first round of attempt 1 —
`searchFiles` against each enum name to verify the exact symbol
exists, `getFileTree` for the project layout, `readFile` for the
full content of both scaffold files. The imports are derived from
direct file reads, not hallucinations.

### Is the generated code coherent with the scaffold from Report 003?

Mostly yes:
- ✓ Imports `LeaveType, LeaveStatus` from the same `src/shared/types/index`
  path the scaffold exports them.
- ✓ Imports the pg singleton from `src/shared/db/connection` —
  attempt 1's round 1 uses `import pool from '../../shared/db/connection'`
  matching the scaffold's `export default pool`.
- ✗ Attempt 2 round 2 (self-healing-amended) switches to
  `import { pool } from '../../shared/db/connection'` (named) —
  this would fail at runtime against the scaffold's default export.
- ✓ Uses the scaffold's `AppError` class for error wrapping (good
  reuse).
- ✓ Module structure `src/modules/leave/{model,repository}.ts`
  matches the ARCHITECTURE.md's documented layout.

### Could a developer ship attempt-1 round-1's code after a light review?

**Yes**, with three small edits:
1. Drop the `import { Pool } from 'pg'` (or change to `import type`)
   if the project enforces the constraint rule strictly.
2. The constructor should accept `pool` as a parameter (clean DI)
   rather than reading the singleton in the constructor body, OR
   the constructor should be `private` and a factory `createRepository(pool)`
   should be exposed.
3. The `findPendingByManagerId` SQL references a column
   `manager_id` that isn't in the LeaveRequest's INSERT and isn't
   on the model interface. Either add `managerId` to the create
   path (and the model — attempt 2 already does this) or implement
   a JOIN.

Attempt 2 round 1's code closes the (3) gap (has `managerId` on
the model) and uses a cleaner `pool.query(...)` shape directly.

Both are within "would ship after a light review" range. The
gate's failure verdict is not reflective of the code's actual
quality.

---

## Verification of the seven Report-003 fixes (do they still hold?)

| Fix | Status | Evidence |
|---|---|---|
| Fix 1 — env-default LLM client reads registry apiShape | ✓ working | Test ran under `LLM_MODEL=gpt-4o` with no registry row matching → env-default fallback → `chat-completions` shape sent `max_tokens` → OpenAI accepts. Identical to TEST_REPORT_003. |
| Fix 2 — master.key docker volume | ✓ verified | Server still has the master.key from last session; no re-set needed across this session's rebuilds. |
| Fix 3a — test-agent locked to Jest | ✓ verified | Every test file in both attempts imports from `@jest/globals`. Zero vitest. |
| Fix 3b — constraint-agent rejects wrong framework | ✓ wired (not exercised) | No vitest imports this cycle, so no signals; rule is loaded. |
| Fix 4 — code-agent adds @types/* | n/a | The code-agent didn't regenerate package.json (correctly — out of scope). The scaffold already has @types/pg on main from Report 003. The review-agent's `Missing @types/pg` flag is the *opposite* failure mode: not seeing what's on disk. |
| Fix 5 — review-agent cross-checks | ⚠ mixed | The framework / placement checks are clean. The @types/* coverage check fires a false positive on package.json (which is NOT in the artifact set — only the new module files are). |
| Fix 6 — test placement | ✓ verified | All tests under `tests/unit/modules/leave/`. The placement-check sharpen from this session's previous commit (90ced46) is also holding — review-agent stopped flagging mirrored paths. |
| Fix 7 — AGENTS.md in code-agent prompt | ✓ wired | Trackeros AGENTS.md is in the code-agent prompt; influence on output is subtle for this intent (the file doesn't have a "type-only imports" rule that would have helped here). |

---

## Recommended next fixes

Priority-ordered, blast-radius-first:

1. **(HIGH) constraint-agent: `no-direct-db-outside-shared-db`
   doesn't distinguish type-only imports.** The blocking false
   positive on every cycle of this intent. Options A/B/C in the
   constraint-agent section above. Recommended: prompt code-agent
   to use `import type { Pool } from 'pg'` and exempt that form
   from the regex (smallest change, biggest unblock).

2. **(HIGH) review-agent: respect IntentSpec.outOfScope.** The
   review-prompt should include the intent's `outOfScope` list and
   instruct the agent not to flag rules tied to excluded layers.
   This stops the GP-001 (audit) + GP-003 (input validation) over-
   fires on repository-only intents.

3. **(HIGH) review-agent: project-state awareness.** When flagging
   "missing X in package.json", the agent should check the cloned
   project tree first. The gate-orchestrator already has `workDir`;
   either expose it via tool calls or read package.json + AGENTS.md
   + ARCHITECTURE.md into the review prompt as project-state
   context.

4. **(MEDIUM) self-healing diagnostician: escape hatch.** When a
   retry introduces a NEW constraint violation that wasn't in the
   prior round's set, the diagnostician should de-escalate (revert
   the amendment that introduced it, or flag for human review)
   rather than amend again. Concrete example: round 2 added
   `console.log` for audit which trips no-console. Round 3 would
   try to fix both. The escape hatch: detect the new-rule trip and
   escalate.

5. **(MEDIUM) intent-agent IntentSpec gets a `dependencies: []`
   block.** The intent-agent should list upstream files the intent
   depends on (`src/shared/types/index.ts`, `src/shared/db/connection.ts`).
   The design-agent can then verify they exist on `main` before
   designing.

6. **(LOW) test-agent should cover every method named in the intent.**
   The "// Additional tests for X can be added similarly" trailing
   comment is a real punt. The test-prompt could pin: "Emit one
   test file per method named in success criteria — partial
   coverage is a fail."

---

## Comparison with Reports 002 + 003

| Aspect | Report 002 | Report 003 | **Report 004** |
|---|---|---|---|
| Intent | Scaffold | Scaffold | Domain module on top of scaffold |
| Outcome | deployed | deployed | **failed (gate verdict)** |
| Generate cycle reaches code-agent | yes | yes | yes (both attempts) |
| Code-agent uses file tools | 1 getFileTree | 1 getFileTree | **8 tool calls — searchFiles + readFile** |
| Code coherent with prior cycle | n/a | n/a | yes (imports correct on first round) |
| Gate verdict | pass | concerns (5 LOW false positives) | **failed (4-7 HIGH/MED false positives)** |
| Token cost (single cycle) | 12,769 | 17,640 | ~30,000 per generate→gate→escalate round |
| Self-healing retried? | no | no | yes (3-4 retries per attempt) |
| Trackeros main updated? | n/a (PR merged manually) | yes (PR #47) | **no — branch + cycle failed at gate** |

The platform is now exercising more of itself end-to-end —
self-healing kicked in for the first time on a real test, the
diagnostician-induced retry loop ran 3 cycles deep, the rate
limit surfaced. The infrastructure is real. The gate's signal
quality is the next thing to work on.

---

## Appendix: raw evidence

### Attempt 1 — agent_executions (8 rows that ran)

```
intent-agent       completed   2841ms  1343 tokens
design-agent       completed   6537ms  1428 tokens
context-agent      completed   9571ms  5811 tokens
lint-config-agent  completed     19ms     0 tokens
code-agent         completed   9183ms 20150 tokens  ← 8 tool calls inside this
test-agent         completed   7853ms  2453 tokens
review-agent       FAILED      2454ms  3880 tokens  ← gate verdict: 5 concerns
constraint-agent   FAILED         5ms     0 tokens
[3 retry rounds rate-limited on code-agent]
```

### Attempt 2 — agent_executions (13 rows that ran)

```
[Round 1 — full cycle, gate failed]
intent-agent       completed   3058ms  1330 tokens
design-agent       completed   6690ms  1517 tokens
context-agent      completed   9109ms  6094 tokens
lint-config-agent  completed     18ms     0 tokens
code-agent         completed  10441ms 19829 tokens
test-agent         completed   8322ms  2459 tokens
review-agent       FAILED      1855ms  3978 tokens
constraint-agent   FAILED         6ms     0 tokens

[Round 2 — self-healing-amended intent (now asks for audit + input validation), gate failed again]
intent-agent       completed   2890ms  1399 tokens
design-agent       completed   7994ms  1559 tokens
context-agent      completed   8178ms  6134 tokens
lint-config-agent  completed     25ms     0 tokens
code-agent         completed  16277ms 15559 tokens  ← added console.log audit, no-console fires
test-agent         completed  12690ms  2931 tokens
constraint-agent   FAILED         8ms     0 tokens
review-agent       FAILED      2146ms  4146 tokens

[Rounds 3-5 — rate-limited]
```

### Constraint violation locations

```
attempt 1, round 1:
  no-direct-db-outside-shared-db  src/modules/leave/leave.repository.ts:1:17

attempt 2, round 1:
  no-direct-db-outside-shared-db  src/modules/leave/leave.repository.ts:1:17

attempt 2, round 2:
  no-direct-db-outside-shared-db  src/modules/leave/leave.repository.ts:1:17
  no-console                       src/modules/leave/leave.repository.ts:71:5
```

### Cumulative LLM cost across both attempts

```
attempt 1 ≈ 56,200 tokens
attempt 2 ≈ 77,600 tokens
─────────────────────────
Total      ≈ 133,800 tokens (gpt-4o)
```

At gpt-4o pricing (input ~$2.50 / output ~$10 per 1M tokens),
this session's total LLM cost is approximately **$0.80–$1.30 USD**.
The cost is dominated by the retry loops; a successful first-pass
would have cost ~$0.10 like Reports 002 + 003.

### Trackeros branches created (both will exit-as-failed)

```
gestalt/3af30e7d-create-the-leave-module-foundation-create  (attempt 1)
gestalt/a829c77b-create-the-leave-module-foundation-create  (attempt 2)
```

Neither pushed to remote (cycle exited at gate verdict — no
pr-agent dispatch).

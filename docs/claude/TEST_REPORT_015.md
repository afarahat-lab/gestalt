# Test Report 015 — Approach A: explicit repository-pattern rule wording

**Date:** 2026-06-06
**Project:** trackeros (template `corporate-ops-web-mobile` v0.4.0)
**Intent (verbatim):** "Create src/modules/leave/leave.service.ts implementing the LeaveService class. It must import LeaveRepository from './leave.repository' and implement submitLeaveRequest(req): Promise\<LeaveRequest\> by delegating to leaveRepository.createLeaveRequest(req). Also generate the matching unit test at tests/unit/modules/leave/leave.service.test.ts using vitest. Scope: ONLY the service file and its unit test. Out of scope: API routes, RBAC middleware, audit logging, input validation middleware, any other modules outside src/modules/leave."
**Correlation:** `d7d9f66f-c261-4e3f-b11c-0560bfd62832` (intent_id `27232b78-11d9-403d-9b2e-e91ae8233ec3`)
**Final status:** `failed` after **8 rounds** — terminated by TR_012's loop detector at 74% repeat rate.
**Total cost:** ~291k tokens / **~$0.087 USD** at gpt-4o-mini pricing.

**Outcome:** **Approach A applied as briefed; the categorical confusion is now provably at the LLM-reasoning layer, not the rule-clarity layer.**

The new rule wording — with explicit positive AND negative examples, file-name patterns (`*.repository.ts`, `*.service.ts`), and case-emphasised "VIOLATION" / "do NOT flag" prefixes — landed in trackeros's `HARNESS.json` and in the platform template (version-bumped to 0.4.0, re-seeded on server restart). gpt-4o-mini **READS** the new rule — the title prefix `[REPOSITORY PATTERN — what is a VIOLATION (flag this)]` appears verbatim in 26 of 28 constraint-agent signals. But it **REASONS the opposite of what the rule says**: 15 of those 28 signals explicitly assert "pool.query in a repository file is not allowed", directly contradicting the rule that says the same thing IS the repository's job.

This isolates the failure mode beyond doubt: rule clarity is no longer the bottleneck. The next required fix is switching the gate-agent model (gpt-4o-mini → gpt-4o), which has been a LOW follow-up across TR_012 / TR_013 / TR_014 and is now the HIGHEST.

---

## What changed

### Fix 1 — trackeros HARNESS.json

trackeros commit `ce0c01e` on `main`:

```json
"agentConfig": {
  "constraint-agent": {
    "rules": [
      "REPOSITORY PATTERN — what is a VIOLATION (flag this): A service, route, or controller file calls pool.query(), db.execute(), db.query(), new Pool(), or createConnection() directly. Example violation: a file named leave.service.ts containing pool.query('SELECT...').",
      "REPOSITORY PATTERN — what is CORRECT (do NOT flag): A file named *.repository.ts calling pool.query() or db.query() — that IS the repository's job. This is correct and must never be flagged.",
      "REPOSITORY PATTERN — what is CORRECT (do NOT flag): A service file importing a repository class or interface (e.g. import LeaveRepository from './leave.repository') and calling methods on it (e.g. this.leaveRepository.createLeaveRequest(req)). This IS the correct pattern.",
      "No SQL queries outside *.repository.ts files",
      "No console.log/warn/error in production source files",
      "All async functions must handle errors"
    ]
  },
  "review-agent": {
    "rules": [
      "Only flag violations for layers explicitly in scope for this intent.",
      "Do not flag items as missing if they already exist on the project main branch.",
      "REPOSITORY PATTERN — what is CORRECT (do NOT flag): A *.repository.ts file that calls pool.query() or db.query(). That is its purpose.",
      "REPOSITORY PATTERN — what is CORRECT (do NOT flag): A service file that imports a repository and delegates to it.",
      "REPOSITORY PATTERN — VIOLATION: Any non-repository file calling pool.query() or new Pool() directly."
    ]
  },
  ...
}
```

### Fix 2 — corporate-ops-web-mobile template

`templates/corporate-ops-web-mobile/harness/HARNESS.json`: same rule clarifications merged into the existing constraint-agent + review-agent rules.

`templates/corporate-ops-web-mobile/template.json`: version bumped `0.3.1` → `0.4.0`.

The platform's `seedBuiltinTemplate` (server boot) compares the on-disk `template.json#version` against the `platform_templates` row's version and refreshes when they differ. Server log on restart:

```
[16:40:57] INFO: Refreshed built-in template (version bump)
  module: server-bootstrap
  slug: corporate-ops-web-mobile
  previousVersion: 0.3.1
  version: 0.4.0
  fileCount: 7
```

All NEW `gestalt init` calls receive the v0.4.0 rules. trackeros (already initialized) reads its own `HARNESS.json` from the cloned repo on every cycle, so trackeros got the new rules via the direct commit.

---

## Live verification

8 rounds. 64 agent executions. 38 review + constraint signals. Aider continues to ship clean code in 6–13 s per round; the test-agent step is skipped on every round.

### Aider produced ideal code in round 1

```ts
import LeaveRepository from './leave.repository';
import { LeaveRequest } from './leave.model';

class LeaveService {
    constructor(private leaveRepository: LeaveRepository) {}

    async submitLeaveRequest(req: LeaveRequest): Promise<LeaveRequest> {
        return this.leaveRepository.createLeaveRequest(req);
    }
}

export default LeaveService;
```

**This is the cleanest leave.service.ts of any cycle to date.** Proper DI via the constructor (TR_014's `new LeaveRepository()` issue is gone). Imports resolve. Delegates exactly as the intent asked. Aider read the (vague-er) rule "REPOSITORY PATTERN — what is CORRECT: A service file importing a repository class and calling methods on it" and produced exactly that.

### gpt-4o-mini READS the new rule

The rule's title prefix `[REPOSITORY PATTERN — what is a VIOLATION (flag this)]` appears verbatim in **26 of 28** constraint-agent signal messages. The model is being shown the rule and is including its title in its output.

### gpt-4o-mini REASONS the opposite of what the rule says

Sample signal (constraint-agent, round 1):

> `[REPOSITORY PATTERN — what is a VIOLATION] This line violates the repository pattern rule because it directly calls pool.query() in a repository file, which is not allowed according to the architectural constraints.`
>
> `Evidence: "const result = await this.pool.query<LeaveRequest>("`

The rule says, verbatim:

> *REPOSITORY PATTERN — what is CORRECT (do NOT flag): A file named \*.repository.ts calling pool.query() or db.query() — that IS the repository's job. This is correct and must never be flagged.*

The model emitted **the opposite of what the rule states.** It quoted the rule's title prefix and reasoned in direct contradiction to the rule's body. **15 of 28 constraint-agent signals are this exact pattern** — pool.query in `leave.repository.ts` flagged as a violation against the explicit rule that says it's correct.

### One constraint-agent finding reasons correctly — then emits anyway

> `[REPOSITORY PATTERN — what is a VIOLATION] The LeaveService class is importing the LeaveRepository correctly, but it does not contain any direct database calls. However, the repository itself is making direct calls to the database, which is acceptable. No violation is present in the service file.`
>
> `severity: low`
>
> `Evidence: "import LeaveRepository from './leave.re..."`

The model **correctly reasons** that no violation is present, then emits the signal anyway (low severity). The TR_013 evidence requirement saves this — the gate-orchestrator drops `low`/`info` signals — but the row exists in the DB.

### Review-agent flags the SERVICE'S call to the repository

Sample review-agent signal (round 1):

> `[review/architecture] The LeaveService is directly calling a repository method that may lead to direct database access, which should be handled through a repository pattern.`
>
> `Evidence: "return this.leaveRepository.createLeaveRequest(req);"`

The new review-agent rule says:

> *REPOSITORY PATTERN — what is CORRECT (do NOT flag): A service file that imports a repository and delegates to it.*

Same pattern — the LLM reads the rule, then emits the opposite. **4 review-agent signals flag the service's repository call** as a violation. The categorical confusion isn't repository-specific; it's a general inability to follow the rule's specified direction.

---

## Verification matrix (from the brief)

| Check | Target | Result |
|---|---|---|
| Zero "Direct DB access" signals on `leave.repository.ts` | ✓ | **✗** — 15 signals; constraint-agent emits pool.query in repository as a violation |
| Zero "Direct DB access" signals on `leave.service.ts` | ✓ | **✗** — 4 signals; review-agent flags the service's repository call as DB access |
| Gate verdict: pass in round 1 | ✓ | **✗** — same gate-max-retries failure as TR_013 / TR_014 |
| Cost < $0.05 | ✓ | **✗** — $0.087 (better than TR_014's gate spend; still over target) |
| Aider generation: 6–13 seconds | ✓ | **✓** — round 1 was 8.3 s; same range as TR_014 |

---

## Comparison: TR_013 → TR_014 → TR_015

| | TR_013 | TR_014 | **TR_015** |
|---|---|---|---|
| Code backend | Gestalt | Aider | **Aider** |
| Rule wording | original | original | **clarified** |
| Aider code quality | n/a | clean | **cleaner (proper DI)** |
| Rounds | 7 | 8 | **8** |
| Total cost | ~$0.52 | (Aider tokens untracked) + gate | **~$0.087 gate** |
| Loop-detector repeat rate | 84% | 77% | **74%** |
| "Direct DB access" on repository file | 28/30 review signals | persistent | **15 constraint + repeated review** |
| Rule title appears in findings | n/a | n/a | **26/28 (✓ rule was read)** |
| Findings contradict rule body | yes | yes | **yes — provably reading-not-respecting** |

The repeat-rate is monotonically dropping (84% → 77% → 74%) as the cycle's failure-mode diversity narrows. With Aider producing the same minimal correct code on every round and the gate flagging it the same way, the loop is now stable on a single concrete behaviour: gpt-4o-mini reads the rule, emits the opposite.

---

## What this tells us about the next fix

The three approaches available to a future-TR_016 author:

1. **Switch gate-agent model to gpt-4o.** Has been LOW carryover since TR_012; promoted to **HIGHEST** by TR_015's data. gpt-4o-mini's reading-comprehension failure on rule definitions is now reproducible and characterised across four cycles. ~$0.04 per round is still in budget if it converges.
2. **Deterministic post-LLM contradiction filter.** When a signal's `quotedLine` is `pool.query|db.query|new Pool` AND the `location.file` matches `*.repository.ts`, drop the finding regardless of message. Bypasses the LLM's reasoning for this specific category. Was the TR_012 HIGHEST follow-up that TR_013 superseded with the evidence requirement — now the leading candidate again if model swap is rejected.
3. **Migrate to a structured-output schema where the LLM cites the rule it thinks was violated.** Force the LLM to surface its own categorical reasoning explicitly so a deterministic check can verify that the cited rule's text doesn't contain "do NOT flag" describing exactly this finding. More invasive than (1) or (2); higher ceiling.

The brief explicitly scoped TR_015 to Approach A only ("No platform code") — this report does not implement (1)/(2)/(3). The recommendation is for whoever picks up next.

---

## Pending follow-ups

- **(HIGHEST — TR_015 promotes from LOW)** Switch gate-agent model to gpt-4o. The 5-cycle pattern (TR_011/012/013/014/015) of gpt-4o-mini reading rules then emitting findings that contradict them is sufficient evidence for the change. Configure in trackeros `agents.yaml`:
  ```yaml
  constraint-agent: { llm: { model: gpt-4o } }
  review-agent:     { llm: { model: gpt-4o } }
  ```
- **(HIGH — re-promoted from TR_012 by TR_015's data)** Deterministic post-LLM filter for the specific "pool.query in *.repository.ts flagged as violation" hallucination. The TR_013 evidence requirement gives the parser enough information (`location.file` + `quotedLine`) to apply a one-line `*.repository.ts` exemption.
- **(MEDIUM — new from TR_015)** Aider's pre-emit verification: Aider did NOT run a compile check before emitting on this cycle (the project rule for Aider was dropped in Fix 1's trackeros HARNESS.json — see "Generated code must compile without errors" + "All imports must resolve" only). Round 1's leave.service.test.ts is missing the `beforeEach` import (Vitest's `beforeEach` is called but not imported). Adding an explicit "Every test file MUST import all symbols it uses including beforeEach / afterEach" rule would address it.
- **(LOW — new from TR_015)** Round-1 leave.service.test.ts uses `vitest` but the project declares `Jest` (HARNESS.json `stack.testFramework`). Review-agent caught this correctly. Either flip the project's test framework to vitest or instruct Aider to use jest.
- Carryovers from TR_014: Aider token spend visibility (`Tokens: N sent / M received` parsing); finer CONTEXT_GAP taxonomy on Aider exit codes; constraint-agent per-role MAX_TOOL_CALLS override.

---

## Files changed

| File | Change |
|---|---|
| trackeros `HARNESS.json` (commit `ce0c01e` on main) | Replace constraint-agent + review-agent rules with explicit positive/negative example wording. |
| `templates/corporate-ops-web-mobile/harness/HARNESS.json` | Same wording merged into the built-in template. |
| `templates/corporate-ops-web-mobile/template.json` | Version `0.3.1` → `0.4.0` (triggers automatic re-seed on next server restart). |

No platform code changed. Build status: `pnpm -r build` clean. Docker image rebuilt + restarted; server log confirms template refresh on boot. Server `/health` 200 throughout. New file `docs/claude/TEST_REPORT_015.md`.

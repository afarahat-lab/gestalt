# Test Report 013 — Evidence requirement for ALL agents that raise findings

**Date:** 2026-06-06
**Project:** trackeros
**Intent (verbatim):** "Create src/modules/leave/leave.service.ts implementing the LeaveService class. It must import LeaveRepository from './leave.repository' and implement submitLeaveRequest(req): Promise\<LeaveRequest\> by delegating to leaveRepository.createLeaveRequest(req). Also generate the matching unit test at tests/unit/modules/leave/leave.service.test.ts using vitest. Scope: ONLY the service file and its unit test. Out of scope: API routes, RBAC middleware, audit logging, input validation middleware, any other modules outside src/modules/leave."
**Correlation:** `59900af8-e7a6-4f43-bfd1-4cfacb3733db` (intent_id `28152805-ffb4-45cc-a0e8-b528ece60fd2`)
**Final status:** `failed` after **7 rounds** — round 7's code-agent emitted malformed JSON (separate bug, not the evidence requirement).
**Total cost:** **~1.74M tokens / ~$0.52 USD** at gpt-4o-mini pricing.

**Outcome:** **structural fix works exactly as designed. Categorical confusion still present and now visible to operators.**

Every emitted review-agent + constraint-agent signal in the cycle now carries `Evidence: "..."` with the LLM's verbatim quote of the line it claims is a violation. Four findings were silently dropped at parse time because the LLM omitted `quotedLine`. The remaining hallucination ("Direct DB access in repository") is now backed by REAL quoted code (`pool.query<LeaveRequest>(req)` from `leave.repository.ts`), which makes the LLM's categorical confusion (pool.query inside a `.repository.ts` file IS the repository pattern, not a violation of it) obvious to an operator reading the message.

In short: Approach B (evidence requirement) is the structural floor — it stops the LLM hallucinating file paths and line numbers. Approach A (tighter HARNESS.json rules) is still needed to fix the LLM's categorical misinterpretation of "outside the repository pattern".

---

## What changed

### Part 1 — shared module in `@gestalt/core`

`packages/core/src/agents/evidence-requirement.ts` (new):

- `EVIDENCE_REQUIREMENT_SECTION` — markdown block telling the LLM that every finding requires a verbatim quote of the violating line, with valid + invalid examples (an import statement alone is never sufficient evidence).
- `QUOTED_LINE_SCHEMA_FIELD` — the `"quotedLine": "..."` JSON field operators interpolate into their schema.
- `dropUnevidencedFindings<T>(items, log)` — single enforcement helper. Filters items whose `quotedLine` is missing/empty, logging each drop at `info` level with file + first 80 chars of the finding's message/description/explanation.
- `EvidenceLogger` interface — minimal logger shape so callers can pass either a `createContextLogger` instance or a stub.

Exported from `packages/core/src/index.ts`. No hardcoded patterns. No language-specific logic.

### Part 2 — review-agent

`packages/agents/quality-gate/src/agents/llm-review-agent.ts`:

- Imports `EVIDENCE_REQUIREMENT_SECTION`, `QUOTED_LINE_SCHEMA_FIELD`, `dropUnevidencedFindings` from `@gestalt/core`.
- `LLMReviewItem.quotedLine: string` (required field).
- `buildReviewPrompt` injects `EVIDENCE_REQUIREMENT_SECTION` between the existing TR_012 protocol block and the out-of-scope section. The JSON schema rendered to the LLM now includes the `quotedLine` field with an explanatory line and a closing "Any item missing `quotedLine` will be automatically discarded."
- `parseReview` filters the raw items through `dropUnevidencedFindings` before returning.
- `mapItemsToSignals` emits the LLM's quoted line in the signal `message`:
  ```
  [review/architecture] {message}
    Evidence: "{quotedLine}"
    Fix: {fixHint?}
  ```
- The artifact markdown (`renderReviewMarkdown`) gains a bold `Evidence:` line under each finding.

### Part 3 — constraint-agent

`packages/agents/quality-gate/src/agents/constraint-agent.ts`:

- Same three imports.
- `ParsedViolation.quotedLine?: string` on the inline parser type.
- The constraint prompt's `## Your task` section now includes `EVIDENCE_REQUIREMENT_SECTION` and the JSON schema's violation entry has `quotedLine` plus the discard warning.
- `parseViolations` filters through `dropUnevidencedFindings` (using the existing context logger).
- Signal message rendered as `[{constraintId}] {explanation}\n  Evidence: "{quotedLine}"`.

### Part 4 — custom agents

`packages/agents/generate/src/agents/custom-agent-runner.ts` + `packages/agents/generate/src/types.ts`:

- `CustomAgentFinding.quotedLine: string` (required field).
- Two new substitution placeholders for operator prompts: `{{evidenceRequirement}}` (expands to the shared section) and `{{quotedLineSchema}}` (expands to the JSON field).
- `safeParseResponse` → `dropUnevidencedFindings` before the result is returned. Operators who do not include `{{evidenceRequirement}}` / `{{quotedLineSchema}}` in their prompt will see EVERY finding dropped — by design (a custom agent that doesn't tell its LLM to ground claims should not be able to drive retries).
- `isValidFinding` made structurally permissive on `quotedLine` (allow missing/string) so the structural check accepts the response and the semantic drop step handles it.
- `orchestrator.ts` includes `Evidence: "..."` in the signal it emits per finding.

### Part 5 — self-healing agent (softer)

`packages/core/src/agents/self-healing-agent.ts`:

- `SelfHealingDiagnosis.evidenceQuote?: string` (optional — softer than the gate agents).
- Diagnosis prompt gains an `## Evidence requirement for diagnosis` block asking the LLM to quote the specific error/signal text that grounds its diagnosis, with explicit "state as uncertain when ungrounded; leave empty rather than fabricate" guidance.
- JSON schema in the prompt gains the `evidenceQuote` field.
- `parseDiagnosis` extracts the field and logs a `warn` when missing — **does not drop**. Retries with ungrounded diagnoses still happen; they are visible in the structured logs.

### Part 6 — template comment + example

`templates/corporate-ops-web-mobile/harness/agents.yaml`:

- Custom-agents preamble explains the evidence requirement, the two substitution variables, and that findings without `quotedLine` are dropped before reaching the gate.
- The `security-review-agent` example is updated to use `{{evidenceRequirement}}` in its prompt body and `{{quotedLineSchema}}` inside the JSON schema's findings entry, with a fresh full-schema example.

---

## Live verification — what the data shows

7 rounds. 53 agent executions. 25 signals from review + constraint agents, 1 CONTEXT_GAP from the round-7 code-agent JSON parse failure.

### Every emitted signal carries Evidence

```
docker compose exec -T postgres psql -U gestalt -d gestalt -c \
  "SELECT count(*) FROM signals
     WHERE correlation_id='59900af8-...' AND message LIKE '%Evidence:%'"
 total
-------
    25
```

Both review-agent and constraint-agent signals now expose the quoted line they claim is a violation. Operators reading an alert see exactly what the LLM was looking at when it raised the finding.

Examples (verbatim from `signals.message`):

```
[review/architecture] Direct database access is occurring in the leave
repository, violating the architectural rule that mandates all database
access must go through the repository pattern.
  Evidence: "const result = await this.pool.query<LeaveRequest>(req);"
  Fix: Refactor the database access to use the repository pattern correctly.

[review/security] Using environment variables directly without validation
can lead to security vulnerabilities if the variables are not properly set.
  Evidence: "connectionString: process.env.DATABASE_URL,"
  Fix: Implement validation for environment variables.

[No SQL queries outside repository classes.] This line contains a SQL
query being executed directly in the repository class, which is a
violation of the architectural constraint that prohibits SQL queries in
service code.
  Evidence: "const result = await this.pool.query<...>"
```

### Findings without grounding are dropped

Server log evidence of structural enforcement (4 drops across the cycle):

```
[09:05:22] INFO: Finding dropped — no quoted evidence provided by LLM
  module: "review-agent"
  file: "package.json"
  message: "Missing type definitions for the 'pg' package, which..."

[09:12:34] INFO: Finding dropped — no quoted evidence provided by LLM
  module: "review-agent"
  file: "package.json"
  message: "The 'pg' package is missing a corresponding '@types/pg' entry..."

[09:17:03] INFO: Finding dropped — no quoted evidence provided by LLM
  module: "review-agent"
  file: "src/modules/leave/leave.service.ts"
  message: "Missing type definitions for the 'pg' package in devDependencies."

[09:30:00] INFO: Finding dropped — no quoted evidence provided by LLM
  module: "review-agent"
  file: "package.json"
  message: "Missing type definitions for the 'pg' package, which has a..."
```

The dropped findings are exactly the pattern Approach B was built to catch — the LLM tried to flag `@types/pg` as missing but could not quote a line proving it (because the package IS in devDependencies). Without the evidence requirement, every one of these would have driven a retry round.

### What the raw LLM response looks like

Final round's review-agent `llm_response` (truncated):

```json
{
  "summary": "The code review identified a critical violation regarding
direct database access outside the repository pattern, ...",
  "overallVerdict": "block",
  "items": [
    {
      "file": "src/modules/leave/leave.repository.ts",
      "line": 25,
      "quotedLine": "const result = await this.pool.query<LeaveRequest>(req);",
      "severity": "high",
      "category": "architecture",
      "message": "Direct database access is occurring in the leave repository, ...",
      "fixHint": "Refactor the database access to use the repository pattern correctly."
    },
    {
      "file": "package.json",
      "quotedLine": "",
      "severity": "medium",
      "category": "architecture",
      "message": "Missing type definitions for the 'pg' package, ...",
      "fixHint": "Add '@types/pg' to the devDependencies in package.json."
    },
    {
      "file": "src/shared/db/connection.ts",
      "line": 7,
      "quotedLine": "connectionString: process.env.DATABASE_URL,",
      "severity": "high",
      "category": "security",
      "message": "Using environment variables directly without validation ...",
      "fixHint": "Implement validation for environment variables ..."
    }
  ]
}
```

Three items. Two have a real quotedLine. The middle one has `"quotedLine": ""` — the LLM voluntarily refused to fabricate a quote, and the parser correctly dropped that item. **The LLM is following the contract.**

### TR_012's loop detector still fires

The cycle terminated with the same alert pattern TR_012 introduced:

```
generate-error / high
Generate failure for intent '...' (attempt 2)
Escalation reason: Review-agent loop detected: 27 of 32 findings are
identical to the prior attempt (84% repeat rate) across 2 rounds.
Likely hallucination — human review required.
```

TR_012's TR_011-driven Fix 3 (`detectRepeatedSignalLoop` at 50% threshold) fires at 84% in TR_013 (up from 72% in TR_012). The escape hatch is doing its job — without it, the cycle would have driven more rounds.

### No GOLDEN_PRINCIPLE_BREACH signals

```
SELECT count(*) FROM signals
  WHERE correlation_id='59900af8-...' AND type='GOLDEN_PRINCIPLE_BREACH'
 count
-------
     0
```

TR_012 Fix 1 (review-agent severity cap) remains effective across all 13 review-agent signals.

---

## Verification matrix (from the brief)

| Check | Target | Result |
|---|---|---|
| Server logs show `Finding dropped — no quoted evidence` for "Direct DB access" — OR LLM stops emitting it because it cannot find evidence | ✓ | **Partial.** 4 drops logged for `@types/pg`-class findings (no quote to ground them). The "Direct DB access" finding is NOT dropped because the LLM DID find a real quote — `pool.query<LeaveRequest>(req)` from `leave.repository.ts`. The finding is still wrong (pool.query inside a repository IS the pattern), but it is grounded. |
| All emitted signals include `Evidence: "..."` in their message | ✓ | **✓ 25/25.** Every review-agent + constraint-agent signal carries the LLM's verbatim quote. |
| Gate verdict: pass in round 1 | ✓ | **✗** — gate failed in every round on the "Direct DB access" categorical hallucination. |
| Cost < $0.05 (single round) | ✓ | **✗** — $0.52 across 7 rounds (round-7 code-agent emitted 437k tokens in a single shot and produced malformed JSON, accounting for ~$0.18 of the cost on its own). |

---

## What this tells us about the next fix

The question the brief asked is now answered by the raw data:

| Source of the false "Direct DB access" finding | Now |
|---|---|
| (A) LLM emits it with no quoted evidence and the parser drops it | **No** — the LLM finds `pool.query<LeaveRequest>(req)` in `leave.repository.ts`, quotes it, and emits the finding with grounded evidence. |
| (B) LLM emits it with a real quote and the operator sees the categorical confusion | **Yes** — the operator (and the next-round code-agent) can see the quote and immediately reason that pool.query inside `*.repository.ts` IS the repository pattern. |
| (C) LLM stops emitting it because the prompt protocol forbids ungrounded findings | **No** — Fix 2's "ground in tool evidence" protocol from TR_012 was already ignored; the new evidence requirement is satisfied by quoting a real (but categorically misinterpreted) line. |

**Recommendation:** Approach A — update the project's HARNESS.json constraint rule wording to be unambiguous about repositories owning `pool.query`. The current rule "No SQL queries outside repository classes" is interpreted by gpt-4o-mini as "pool.query is bad anywhere", which is the exact opposite of what the rule says. Switch to "Database access via `pool.query` (or `db.query`) is REQUIRED inside `*.repository.ts` files and FORBIDDEN in `*.service.ts`, `*.controller.ts`, `*.routes.ts`, or any file under `src/modules/<name>/<name>.service.ts`. Files under `src/shared/db/` may import the pg `Pool` class to construct the connection."

That fix is a project-side `HARNESS.json` change (no platform code) and would have prevented the entire cycle from looping. We hold off in this report because the evidence requirement is a platform contract change — measuring it independently of the HARNESS.json change keeps the data clean.

---

## Headline data

| | TR_011 | TR_012 | **TR_013** |
|---|---|---|---|
| Rounds executed | 8 | 8 | **7** |
| Final status | failed | failed | **failed (round-7 code-agent JSON parse)** |
| Terminating alert | none (cycle just stopped) | `gate-max-retries` w/ 72% loop reason | `generate-error` w/ **84%** loop reason + CONTEXT_GAP |
| Total tokens | 2.47M | 1.38M | **~1.74M** |
| Total cost (gpt-4o-mini) | ~$0.74 | ~$0.41 | **~$0.52** |
| Review-agent GP_BREACH count | varied | 0 | **0** |
| All signals carry verbatim evidence | n/a | n/a | **✓ 25/25** |
| Findings dropped pre-gate (no evidence) | n/a | n/a | **4** |
| Loop-detection escape hatch | n/a | fired at 72% | **fired at 84%** |

TR_013's higher token count vs TR_012 is dominated by round-7's runaway code-agent (437k tokens, 12 minutes, ending in a JSON parse failure). The first 6 rounds are tighter than TR_012's.

---

## Pending follow-ups

- **(HIGHEST — new from TR_013)** Apply Approach A on the project side: tighten trackeros's HARNESS.json constraint rule to disambiguate `pool.query` use in repositories vs everywhere else. With the evidence column now visible to the LLM (signals include `Evidence: "..."` on retry), an unambiguous rule should converge in 1 round.
- **(HIGH — new)** Round-7 code-agent JSON parse failure. The 437k-token, 12-minute single execution that ended with "Expected double-quoted property name in JSON at position 1001" is a separate bug. Likely an unescaped quote inside a `content` string literal when the LLM tried to emit a test file containing inline JSON. Investigate the code-agent's JSON-mode response handling and consider switching to a tool-call-emitted file shape rather than embedding code as a string in JSON.
- **(MEDIUM — new)** Constraint-agent reviews files outside the cycle's artifact set (TR_011 carryover). TR_013 confirms this is still happening — constraint-agent flagged `src/shared/db/connection.ts` with `Evidence: "connectionString: process.env.DATABASE_URL,"`. Same evidence column makes this MORE visible. Constraint-agent should scope its review to the cycle's diff.
- **(MEDIUM — new)** Review-agent reviews files outside the cycle's artifact set. Same as constraint-agent — review-agent reads `leave.repository.ts` (on main, not generated this cycle) via `readFile` and flags it. The scope filter (TR_012 Fix 2 STEP 5) is per-finding, not per-file-read; reads should be scoped to the artifact set as well.
- **(LOW — carryover from TR_012)** Switch review-agent to gpt-4o. With the evidence requirement in place gpt-4o-mini is more behaved (drops 4 findings voluntarily by emitting empty `quotedLine`), but gpt-4o is more likely to catch the "pool.query inside leave.repository.ts is fine" categorical reasoning before emitting the finding at all.
- **(LOW — carryover)** Review-agent `result_status='failed'` cosmetic bug — TR_013 also shows review-agent executions marked `failed` even when JSON is well-formed and signals were emitted. Now harder to confuse for "agent crashed" because the signals carry Evidence quotes.

---

## Files changed

| File | Change |
|---|---|
| `packages/core/src/agents/evidence-requirement.ts` | NEW. Shared section + schema field + `dropUnevidencedFindings` helper. |
| `packages/core/src/index.ts` | Export the new module. |
| `packages/core/src/agents/self-healing-agent.ts` | Soft evidence requirement (prompt + `evidenceQuote` field + warn log). |
| `packages/agents/quality-gate/src/agents/llm-review-agent.ts` | Inject section + schema field, require `quotedLine`, drop unevidenced, surface evidence in signals + artifact markdown. |
| `packages/agents/quality-gate/src/agents/constraint-agent.ts` | Same pattern. |
| `packages/agents/generate/src/types.ts` | `CustomAgentFinding.quotedLine: string`. |
| `packages/agents/generate/src/agents/custom-agent-runner.ts` | Inject substitution placeholders + drop unevidenced findings. |
| `packages/agents/generate/src/orchestrator/orchestrator.ts` | Custom-agent emitted signal message carries `Evidence: "..."`. |
| `templates/corporate-ops-web-mobile/harness/agents.yaml` | Operator-facing comment + updated example with `{{evidenceRequirement}}` / `{{quotedLineSchema}}`. |

Build status: `pnpm -r build` clean across all 12 packages. Docker image rebuilt + container restarted via `docker compose up -d --build`. Server `/health` 200 throughout. No platform-side code change to trackeros required this session.

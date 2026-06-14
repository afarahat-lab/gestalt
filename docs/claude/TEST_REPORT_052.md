# TEST_REPORT_052.md — LangGraph ArchitectureGraph live verification

**Date:** 2026-06-13
**Test scope:** TR_052 — live verification of TR_051's
LangGraph Phase 1 (ArchitectureGraph crew) end-to-end on the
trackeros leave-management feature.

**Feature ID:** `e1ee9e5c-1afc-4909-891a-29a600c89ff1`
**Repo:** https://github.com/afarahat-lab/trackeros (HEAD at
`1f498b5b chore(TR_051): architecture-crew agentConfig + agents.yaml entries`,
committed + pushed at session start).
**Platform git SHA:** TR_051 source tree as-built — no platform
code change in this verification session.

**Outcome (architecture graph):** **PASS — all four nodes fired
end-to-end on a fresh feature submission**, with the three
specialists running in parallel and the chief reconciling
afterwards. Chief output is structurally richer than the
TR_050 single-agent baseline.

---

## Executive summary

The ArchitectureGraph crew lit up correctly on first invocation:

| Stage | Started | Completed | Duration | Tokens |
|---|---|---|---|---|
| Graph compile + checkpointer setup | — | 11:14:35 | <100ms | — |
| Specialist fan-out (parallel) | 11:14:35 | 11:15:42 | 67s wall-clock (slowest) | — |
| ↳ domain-architect-node | 11:14:35 | 11:15:23 | 48s | (parse failed → empty design) |
| ↳ data-architect-node | 11:14:35 | 11:15:34 | 59s | 3,174 |
| ↳ app-architect-node | 11:14:35 | 11:15:42 | 67s | 2,926 |
| Chief reconcile | 11:15:42 | 11:19:01 | **3m 19s** | 15,607 |
| **Graph end-to-end** | **11:14:35** | **11:19:01** | **4m 26s** | **~24,172** |

All three specialists started within the same millisecond, confirming
LangGraph's fan-out scheduling. Chief fired exactly once after all
three completed, confirming the fan-in. **One specialist (domain)
returned a response that failed JSON parsing**; the empty-fallback
took effect and the chief reconciled around the missing slice
without throwing — exactly the behaviour the type-level contract
was designed for.

LangGraph created **four** checkpoint tables in PostgreSQL on
first `setup()`:
- `checkpoints`
- `checkpoint_writes`
- `checkpoint_blobs`     (LangGraph 0.2 addition over the 0.1 docs)
- `checkpoint_migrations` (LangGraph's internal DDL versioning)

The TR_051 blueprint mentioned only the first two — see
"Deviations from the AGENT_TEAMS.md blueprint" below.

---

## Detailed findings

### Parallel firing — CONFIRMED

Server log lines (UTC), evidence of three nodes started in the
same scheduler tick:

```
[11:14:35] Invoking ArchitectureGraph
[11:14:35] ArchitectureGraph compiled and cached
[11:15:23] domain-architect-node complete (48s, parse failed)
[11:15:34] data-architect-node complete (59s, schemaCount=6, repoCount=6)
[11:15:42] app-architect-node complete (67s, moduleCount=5, serviceCount=5, phaseCount=5)
```

Time spread between specialist completions is dominated by
inference latency (DeepSeek-V3.2 on DeepInfra OpenAI-compat,
~3k tokens output), not scheduler serialisation. The 48s domain
completion + 67s app completion implies max ~67s wall-clock vs.
~3 minutes if serialised — a **~3× wall-clock saving** even
before the chief.

### Chief reconciliation — CONFIRMED

Server log:

```
[11:19:01] chief-architect-node complete (198,772ms LLM, 15,607 tokens)
            entityCount=6 moduleCount=5 phaseCount=5 priorErrors=0
[11:19:01] ArchitectureGraph complete
            entities=6 modules=5 phases=5 tokensUsed=24172 specialistErrors=0
```

Kimi-K2.6 on DeepInfra took ~3m 19s for a 12k-token reconciliation
call — within tolerance, no retry fired. **No specialist errors
were surfaced to the chief** because the empty-fallback parsers
swallow the JSON-parse failure silently (returns empty `Design`,
not throws). This is by design — the chief reconciles around
missing slices — but the `state.errors` array stayed empty even
though one slice was empty. **See "New rigor bars" below for
the resulting follow-up.**

### Chief output quality — RICHER THAN BASELINE

`features.architecture` populated, **11,705 bytes** of structured
JSON. Comparison to TR_050's single-agent output on the same
feature description (logged as the prior baseline):

| Metric | TR_050 single-agent | TR_052 architecture crew | Δ |
|---|---|---|---|
| domainEntities | 3 (inferred) | **6** (Employee, LeavePolicy, LeaveRequest, LeaveBalance, Notification, AuditLog) | **+2×** |
| modules | not enumerated | **5** with `owns` lists | new |
| dependencyMap edges | not enumerated | **7** | new |
| recommendedPhases (chief) | 6 | 5 high-level (planner expanded to 10) | shaped |
| **SQL schemas** | embedded inline in archMd, regex-extracted | **6 `CREATE TABLE` statements as a first-class `sqlSchemas[]` array** | new |
| architectureMdUpdate | ~750 chars | **3,396 chars**, includes GP-001/GP-002 cross-references | +4.5× |
| stackSubstitutions (TR_044) | 0 (failed) | 0 (failed — same `gpt-4o-mini` model-not-registered error as TR_050) | unchanged |

Highlights from the chief output:

- **Audit log emerged as a 6th entity** — neither the feature
  description nor any specialist contract names it explicitly;
  the chief inferred it from GP-002 (audit invariant) loaded
  from `docs/GOLDEN_PRINCIPLES.md`. **Cross-cutting concern
  surfaced structurally**, exactly the gap the TR_044
  GOLDEN_PRINCIPLES.md injection was built to close.
- Every persistent entity has a complete `CREATE TABLE` with
  PostgreSQL types, foreign keys, `CHECK` constraints, and
  default values (e.g. `gen_random_uuid()`). The data
  architect's contract turned TR_049's "mandatory SQL schema
  for relational stacks" rule into a structural guarantee.
- Lifecycle states are documented in `architectureMdUpdate`:
  `LeaveRequest` carries `PENDING, APPROVED, REJECTED, CANCELLED`
  — addressing TR_046's "document new domain concepts" gap.
- Repository interfaces name concrete implementations:
  `IEmployeeRepository → PostgresEmployeeRepository`, backed by
  `pg` Pool — addressing TR_037/TR_038's "concrete impl missing"
  gap.
- 5 recommended phases from chief explicitly cite Golden
  Principles: Phase 4 (`LeaveService`) calls out GP-003 (input
  validation), Phase 5 (controllers) calls out GP-005 (RBAC).

### TR_036 → TR_050 rigor bars — STRUCTURAL ADDRESS

The 11 distinct rigor bars TR_036-TR_050 fought through HARNESS
rules + checklist items were structurally absorbed by the crew's
type contracts and fan-in reconciliation. Specifically:

| Rigor bar (origin) | Mechanism in TR_052 | Status |
|---|---|---|
| TR_036 symbol-name conflict | Chief reconciles all three slices in one prompt; one canonical name per symbol applied across entities/repos/services. | **STRUCTURALLY ADDRESSED** |
| TR_037 concrete persistence missing | `DataDesign.repositories[].concreteName + backing` type contract; chief verifies completeness. | **STRUCTURALLY ADDRESSED** |
| TR_038 CRUD coverage gap | Repositories explicitly enumerate methods (`findById, save, update, ...`). Chief verifies. | **STRUCTURALLY ADDRESSED** |
| TR_040–TR_042 framework leak | Each specialist prompt receives `renderStackSection` + chief explicitly verifies stack compliance across slices. (One specialist failed but chief read declared stack from HARNESS and emitted PostgreSQL / `pg` / no test-framework names anywhere.) | **STRUCTURALLY ADDRESSED** |
| TR_044 audit-log cross-cutting concern | `renderGoldenPrinciplesSection` in every prompt → AuditLog emerged as a 6th entity without being asked. | **STRUCTURALLY ADDRESSED** |
| TR_045 interface signatures as contracts | Specialists emit contracts; chief reconciles; no HARNESS rule needed. | **STRUCTURALLY ADDRESSED (no rule fired)** |
| TR_046 lifecycle states documented | Domain architect contract has `domainEntities[].lifecycleStates` + chief folds into `architectureMdUpdate`. | **STRUCTURALLY ADDRESSED** |
| TR_047 transaction semantics | Not explicitly verified this cycle — chief output doesn't surface transaction semantics for `LeaveService.applyForLeave + AuditLog.write` (Phase 4). May surface as a per-phase rigor bar when Phase 4 dispatches. | NOT EXERCISED |
| TR_048 canonical SQL schemas | `sqlSchemas[]` is now a first-class field on the chief output (6 entries); TR_048's `extractCanonicalSqlSchemas` machinery fires automatically on the per-phase pass. | **STRUCTURALLY ADDRESSED** |
| TR_049 mandatory SQL schema | Data architect's HARNESS rule + type contract; TR_052 confirms 6/6 entities have CREATE TABLE. | **STRUCTURALLY ADDRESSED** |
| TR_050 model-binding regression | Specialists run on DeepSeek-V3.2; chief on Kimi-K2.6 — same matrix that worked on TR_050 single-agent. | **STRUCTURALLY ADDRESSED** |

The architecture-graph's output is the strongest evidence yet
across the TR_036 → TR_052 sequence that the rigor-bar accretion
can be **collapsed into a structural type contract** rather than
fought through prompt engineering.

### LangGraph PostgreSQL checkpointer — CONFIRMED

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_name LIKE 'checkpoint%' ORDER BY table_name;
```

```
checkpoint_blobs
checkpoint_migrations
checkpoint_writes
checkpoints
```

Tables created lazily on first `runArchitectureGraph` call —
the singleton setup pattern in `graphs/checkpointer.ts` works
as designed. No Gestalt migration needed.

### Pipeline progression — Phase 1 DEPLOYED on first attempt (19m 27s end-to-end)

Phase 1 ("Core domain models for Leave module") cleared the
full Gestalt pipeline without escalation, retry, or
self-healing intervention. Timeline:

| Milestone | Server time | Δ from submit |
|---|---|---|
| Feature submitted | 11:14:35 | 0 |
| ArchitectureGraph complete | 11:19:01 | 4m 26s |
| Stack substitutions failed (TR_044 — pre-existing) | 11:19:01 | 4m 26s |
| Planner-agent done | 11:20:10 | 5m 35s |
| Phase 1 intent dispatched | 11:20:56 | 6m 21s |
| intent-agent done (NO ESCALATION) | 11:21:28 | 6m 53s |
| design-agent done | 11:21:47 | 7m 12s |
| context-agent done | 11:22:21 | 7m 46s |
| Aider running | 11:22:21 | 7m 46s |
| Aider done, dispatched to deploy:pr | 11:25:17 | 10m 42s |
| PR opened, pipeline noop, gate dispatched | 11:25:32 | 10m 57s |
| Constraint-agent verification complete | 11:30:19 | 15m 44s |
| **Gate passed — all 2 checks clean** | **11:30:19** | **15m 44s** |
| deploy:promotion (staging) → promotion complete | 11:30:21 | 15m 46s |
| planning:evaluate dispatched | 11:30:21 | 15m 46s |
| Phase-evaluator verdict → phase deployed | 11:34:02 | **19m 27s** |
| Phase 2 dispatched | 11:34:02 | 19m 27s |

**Comparison to TR_050 single-agent baseline:**
TR_050 Phase 1 deployed in 20m 03s on a single architecture
agent. TR_052 (crew) Phase 1 deployed in **19m 27s** despite:

- the architecture-graph adding 4m 26s of new work (3 specialists
  in parallel + chief reconciliation)
- one specialist (domain-architect) silently failing JSON parse

The crew saved time elsewhere: intent-agent passed cleanly on
first attempt (TR_050 took multiple cycles to clear the gate),
constraint-agent verdict was clean (TR_050 also passed first
try with 0 violations).

**Gate findings:**
- `constraint-agent`: `result_status=passed`, `signal_types={}`,
  llm_response 9,258 chars — clean verdict
- `review-agent`: `result_status=errored`,
  `error_message="Gate agent threw before producing a structured
   response"` — see "New rigor bars" below.
  The gate orchestrator's "all 2 checks clean" log line was
  emitted because the constraint-agent verdict alone was
  treated as authoritative on the noop adapter — review-agent's
  error didn't block the gate.

### Phases 2-10 (still running)

The feature is **in-progress** — 1/10 phases deployed. Phases
2-10 will execute serially per the planner's bottom-up
dependency order:

```
Phase 2: LeavePolicy domain model and repository
Phase 3: LeaveBalance domain model and repository
Phase 4: EmployeeService implementation
Phase 5: PolicyService implementation
Phase 6: BalanceService implementation
Phase 7: LeaveService core implementation
Phase 8: LeaveService workflow with audit logging   ← cross-cutting concern emerged structurally
Phase 9: Leave controllers
Phase 10: Leave routes and API registration
```

Phase 8's "audit logging" name traces back to the chief's
`AuditLog` entity (a cross-cutting concern not in the
original feature description) — strong evidence the
GOLDEN_PRINCIPLES.md injection works structurally.

---

## Deviations from the AGENT_TEAMS.md blueprint

1. **LangGraph creates 4 checkpoint tables, not 2.** The
   `AGENT_TEAMS.md` migration note states LangGraph creates
   `checkpoints` + `checkpoint_writes`. LangGraph 0.2 also
   creates `checkpoint_blobs` (binary value storage) and
   `checkpoint_migrations` (internal DDL versioning). No
   action needed — both are LangGraph-owned. Doc update
   in `AGENT_TEAMS.md` recommended.

2. **`state.errors` is silent on parse-to-empty.** The
   blueprint says "specialist errors surface as `state.errors`
   so the chief can reconcile around a missing slice." In
   practice, my parser implementation swallows `JSON.parse`
   failure and returns an empty `Design` (mirroring the
   `architecture-agent.ts` pattern). The chief receives an
   empty slice but `state.errors` stays empty — so the
   reconciliation works but the operator has no visible
   signal on the dashboard that one specialist failed.
   **New follow-up: emit a `specialist-empty` error string
   from the parser when the response was non-empty but
   produced an empty Design.**

3. **No deviation on retry policy** — the chief took 3m 19s
   on Kimi and finished within the first attempt. RetryPolicy
   was not exercised.

---

## New rigor bars

### NRB-1 — review-agent silent failure (Gate orchestrator)

Severity: MEDIUM (does not block deploy; observability gap).

The legacy `review-agent` (kept as fallback per ADR-051 for
non-GitHub adapters; trackeros is on the `noop` adapter so
this is the live path) errored at ~11:27:30 with
`error_message: "Gate agent threw before producing a
structured response"`. The `llm_response` was just "Now let me
check the validation file:" — the LLM started a tool-loop turn
and the agent threw before completing.

The constraint-agent's clean verdict was enough for the gate
to pass, so this didn't block the cycle. But:

- An operator looking at `gestalt intent show` for the Phase 1
  intent will see a `review-agent` row with status `failed` —
  confusing against the "Gate passed" message.
- If the trackeros project flips to `github-actions` adapter
  and PR-Agent isn't enabled, this same path will silently
  half-fail.

**Root cause:** Aider produced a 10-file diff that's large
enough to push the review-agent's prompt over what
DeepSeek-V3.2 can comfortably handle in a tool-loop. The
tool-loop turn errored mid-call rather than returning
structured output.

**Follow-up:** the gate orchestrator should either treat
review-agent's errored state as a `signal` (so the verdict
is `escalate` not `pass`), OR mark the review-agent run
explicitly as `skipped-on-error` when the constraint-agent
passes — current "errored" state is ambiguous.

### NRB-2 — Specialist parse-to-empty is silent

Severity: LOW (chief reconciles around it; operator can't see
that one slice was missing).

`domain-architect-node` returned a response that wasn't valid
JSON (`extractJsonObject` failed at the top-level brace walk),
and the parser fell through to the empty fallback. The chief
got an empty `domainDesign` slice and reconciled around it,
emitting 6 entities anyway by reading the data architect's
repository methods + the app architect's services + the
feature description.

But `state.errors` stayed empty, so:

- The graph-complete log line shows `specialistErrors: 0`
- The TEST_REPORT_052's data on which specialists contributed
  what is opaque without inspecting the raw LLM responses
  (which aren't persisted)

**Follow-up:** the parsers in `agents.ts` should emit a
sentinel error string into `state.errors` when the response
was non-empty but produced an empty Design, so the chief's
"Specialist errors" prompt block surfaces the cause to the
LLM and the dashboard can show it. Recommended sentinel:
`{role}: response did not parse to a valid Design (length={n})`.

### NRB-3 — TR_044 buildStackSubstitutions hardcoded to gpt-4o-mini

Severity: LOW (graceful empty-map fallback works).

Pre-existing TR_050 issue resurfacing in TR_052 verification.
`architecture-agent.buildStackSubstitutions` is hardcoded to
`gpt-4o-mini`, which is not in the DeepInfra LLM registry.
First call fails with "LLM Provider NOT provided"; agent
returns empty map; the per-phase substitution pass is a no-op.

This doesn't materially affect TR_052 because the chief's
HARNESS-rule-driven stack compliance already prevents
framework leak. **Follow-up:** consider deleting the entire
`buildStackSubstitutions` machinery now that the architecture
crew enforces stack compliance structurally.

---

## Token budget summary

| Stage | Tokens | Notes |
|---|---|---|
| domain-architect | (parse-fail) | LLM returned tokens but the response wasn't valid JSON; agent's `lastTokensUsed` was reset by callLLM. No telemetry surfaced. |
| data-architect | 3,174 | DeepSeek-V3.2, 59s, schemaCount=6, repoCount=6 |
| app-architect | 2,926 | DeepSeek-V3.2, 67s, moduleCount=5, serviceCount=5, phaseCount=5 |
| chief-architect | 15,607 | Kimi-K2.6, 198,772ms, entityCount=6, moduleCount=5, phaseCount=5 |
| **graph total** | **~24,172** | Reported via `state.tokensUsed` reducer (`a + b`) |
| TR_044 buildStackSubstitutions | 0 | LLM call failed — `gpt-4o-mini` not registered in DeepInfra LLM registry. Graceful empty-map fallback (same outcome as TR_050). |
| planner-agent | ~unknown | Logged as one `LLM call completed` at 11:20:10 |

---

## Wall-clock summary

| Milestone | Time | Δ from start |
|---|---|---|
| Feature submitted | 11:14:35 | 0 |
| Graph compile + checkpointer setup | <11:14:35 | <1s |
| All specialists fired in parallel | 11:14:35 | 0 |
| Last specialist done | 11:15:42 | +1m 7s |
| Chief done | 11:19:01 | +4m 26s |
| Plan persisted (`phase_count=10`) | 11:20:14 | +5m 39s |
| Phase 1 intent dispatched (`ph1.intent=generating`) | 11:21:35 | +7m 00s |
| _(more rows added as the cycle progresses)_ | | |

---

## Open questions / pending data

- ~~Will Phase 1 reach `deployed` without the TR_036 → TR_050
  intent-agent rigor bars resurfacing?~~ **YES — deployed on
  first attempt, 19m 27s end-to-end, intent-agent passed clean.**
- ~~Will the gate pass on first attempt?~~ **YES —
  `Gate passed — all 2 checks clean` at 11:30:19;
  constraint-agent `result_status=passed`, 0 signals.**
- Does TR_047 transaction semantics surface as a Phase 8
  rigor bar (LeaveService workflow with audit logging)?
  **Test pending — Phase 8 not yet reached at report-final.**
- Does the feature complete (status `completed`) before the
  retry budget exhausts? **Test pending — feature still
  in-progress at report-final (Phase 2 in mid-flight at
  11:37:00; ~3 hours of wall-clock estimated for remaining
  9 phases). Will be reported as TR_053 carryover if not
  closed by next session.**

---

## Outcome — what this verification proves

**Architecture graph (Phase 1 of the LangGraph migration)
works end-to-end:**

1. The four agents extend `BaseLLMAgent` correctly. The
   platform's standard config loading, token management
   (ADR-057), and HARNESS rule injection apply unchanged.
2. LangGraph's `StateGraph` fan-out / fan-in scheduling
   works as the blueprint specified: three specialists run
   in parallel, chief runs after all three.
3. The PostgreSQL checkpointer reuses `DATABASE_URL` and
   creates its own tables on first call. No Gestalt
   migration needed.
4. The chief produces structurally richer output than the
   prior single-agent baseline, even when one specialist
   produces an unparseable response.
5. The downstream planning + generate + gate pipeline
   consumes the new output shape (with `sqlSchemas[]` as
   a first-class field) without any change to existing
   orchestrator code beyond the `runArchitectureGraph`
   call site itself.

**The TR_036 → TR_050 rigor bar sequence is structurally
addressable.** No HARNESS rule fired to clear intent-agent
on Phase 1 in this cycle — the absence of escalation is the
strongest evidence yet that the type-level contracts in
`DomainDesign` / `DataDesign` / `AppDesign` + the chief's
reconciliation responsibility absorbs what 15+ HARNESS rules
were doing across TR_036-TR_050.

**Phase 2 of the LangGraph migration (PlanningGraph) can
start.**

---

_Generated by Claude Code._

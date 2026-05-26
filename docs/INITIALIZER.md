# Harness Initializer — AgentForge SDLC

Version: 0.1.0
Layer: 2
Status: Designed, pending implementation

---

## Overview

The harness initializer is the front door of AgentForge SDLC. When an operator runs
`agentforge init` on a new project, the initializer guides them through a four-phase
process that produces a fully populated, project-specific harness — ready for the
generate layer to start working immediately.

The initializer is **intent-first**: the operator describes their project in natural
language, and the LLM extracts structured answers. This is AI-native from the very
first command.

---

## Phases

### Phase 0 — LLM bootstrap

The only phase that does not require an LLM. Collects provider configuration
interactively so all subsequent phases can use the LLM.

```
$ agentforge init

Welcome to AgentForge SDLC.
──────────────────────────────────────────────────────
Before we begin, we need to connect to your LLM provider.

Provider type:
  1. Azure OpenAI
  2. Ollama (local)
  3. vLLM
  4. OpenAI-compatible endpoint

> Select: 1
> Endpoint URL: https://my-resource.openai.azure.com/openai/deployments/gpt-4o
> API Key: ****************************
> Model name: gpt-4o

Testing connection... ✓ Connected (gpt-4o, 128k context)

LLM provider saved. Let's set up your project.
──────────────────────────────────────────────────────
```

**Outputs:** `HARNESS.json` updated with `llm` adapter config.

---

### Phase 1 — Intent capture

The operator describes their project in natural language. The LLM extracts structured
answers covering all required fields. The operator confirms or corrects before proceeding.

```
──────────────────────────────────────────────────────
Describe your project in your own words.
What are you building, who will use it, and what problem does it solve?

> We are building an internal HR self-service portal for our company.
  Employees can request leave, view payslips, and update personal info.
  Managers approve leave requests. HR admins manage policies and reporting.
  We have about 1,200 employees across 3 countries. We use Oracle DB and
  Azure DevOps. Data must stay in-region due to Saudi data residency rules.

Analyzing... ✓

Here's what I understood about your project:

  Project name:       HR Operations Portal
  Purpose:            Internal HR self-service — leave requests, payslips,
                      personal info, manager approvals, HR admin reporting
  Target users:       Internal staff (≈1,200 employees, 3 countries)
  Frontend:           React web + React Native mobile
  Backend:            TypeScript / Node.js
  Database:           Oracle (existing corporate standard)
  Compliance:         Saudi data residency requirements, GDPR
  Authentication:     Corporate SSO (SAML/OIDC)
  Architecture:       Modular monolith
  CI/CD:              Azure DevOps
  Deployment:         Docker / on-premise
  Multi-tenancy:      Single organization

Does this look right?
  1. Yes, generate my harness
  2. Let me correct something

> 1
──────────────────────────────────────────────────────
```

**Extracted fields:**
- `projectName` — HR Operations Portal
- `purpose` — seed for `DOMAIN.md`
- `targetUsers` — informs RBAC model and accessibility requirements
- `frontend` — determines scaffold template
- `backend` — determines language config
- `database` — selects Oracle adapter
- `complianceFrameworks` — populates `GOLDEN_PRINCIPLES.md` compliance section
- `authMethod` — populates SAML auth architecture pattern
- `architectureStyle` — modular monolith → enforces module boundary rules
- `cicdSystem` — generates Azure DevOps pipeline config
- `multiTenancy` — single org → simplifies data model
- `deploymentTarget` — Docker on-premise

---

### Phase 2 — Harness generation

The LLM generates all harness artifacts in a single coordinated pass. Each artifact
is fully populated — not a generic template. The Oracle adapter is auto-selected,
Saudi data residency principles appear in `GOLDEN_PRINCIPLES.md`, SAML auth
appears in `ARCHITECTURE.md`, Azure DevOps pipeline config is generated.

**Generated artifacts:**

| Artifact | Content |
|---|---|
| `AGENTS.md` | Stack-specific conventions, Oracle adapter rules, TypeScript config |
| `ARCHITECTURE.md` | Modular monolith layers, module boundary rules, Oracle integration pattern |
| `DOMAIN.md` | Seeded domain model: User, Employee, LeaveRequest, Payslip, Policy, AuditLog |
| `DECISIONS.md` | Pre-populated with decisions made during init (DB choice, auth method, etc.) |
| `GOLDEN_PRINCIPLES.md` | Data residency enforcement, GDPR principles, audit trail requirements |
| `HARNESS.json` | Fully configured: Oracle adapter, Azure DevOps CI, SAML auth, quality gate |
| Folder structure | Modular monolith layout: `src/modules/hr/`, `src/modules/auth/`, etc. |
| `tsconfig.json` | TypeScript strict config |
| `.eslintrc.json` | ESLint + architectural constraint rules for module boundaries |
| `azure-pipelines.yml` | Azure DevOps pipeline: lint → typecheck → test → security → deploy |
| `docker-compose.dev.yml` | Local development environment |

```
──────────────────────────────────────────────────────
Generating your harness...

  ✓ AGENTS.md
  ✓ docs/ARCHITECTURE.md
  ✓ docs/DOMAIN.md
  ✓ docs/DECISIONS.md
  ✓ docs/GOLDEN_PRINCIPLES.md
  ✓ HARNESS.json
  ✓ Folder structure (14 directories)
  ✓ tsconfig.json
  ✓ .eslintrc.json (with module boundary constraints)
  ✓ azure-pipelines.yml
  ✓ docker-compose.dev.yml

Harness generated. Running validation...
──────────────────────────────────────────────────────
```

---

### Phase 3 — Harness validation

The harness engine validates that all required context files exist, are internally
coherent, and `HARNESS.json` is well-formed. Any gaps emit a `CONTEXT_GAP` signal
back to the LLM for resolution before the project is marked ready.

```
──────────────────────────────────────────────────────
Validating harness...

  ✓ All required context files present
  ✓ HARNESS.json schema valid
  ✓ LLM connection verified
  ✓ Oracle adapter config resolvable
  ✓ Azure DevOps pipeline config syntactically valid
  ✓ Module boundary constraints parseable by linter
  ✓ No CONTEXT_GAP signals

──────────────────────────────────────────────────────
✓ Harness ready. Your project is set up.

Next step:
  agentforge run "Set up the project scaffold with initial module structure"

Dashboard: http://localhost:3000
──────────────────────────────────────────────────────
```

---

## Harness adaptation

The initializer produces a **starter harness** (Tier 2 pattern matched to project
context). As the project evolves:

- Maintenance agents propose updates to context files when drift is detected
- The operator refines `GOLDEN_PRINCIPLES.md` as compliance requirements clarify
- Constraint rules in `.eslintrc.json` tighten as the architecture matures
- `DECISIONS.md` accumulates ADRs from every significant agent or human decision

The harness is a living artifact — not a one-time scaffold.

---

## Implementation notes

- Phase 0 is a pure CLI interaction — no server required
- Phases 1–3 require the AgentForge server to be running (`docker-compose up -d` first)
- The LLM prompt for Phase 1 extraction is defined in `packages/agents/generate/src/initializer/extract-prompt.ts`
- The harness generation prompt is in `packages/agents/generate/src/initializer/generate-prompt.ts`
- Validation logic is in `packages/core/src/harness/validator.ts`
- The full initializer orchestration is in `packages/cli/src/commands/init.ts`

# Domain Model — AgentForge SDLC

This document describes the core domain model of the AgentForge SDLC platform itself.

---

## Core entities

### Project
A software project managed by AgentForge SDLC. Has a harness, a git repository, and a set of environments.

```
Project {
  id: uuid
  name: string
  repositoryUrl: string
  harness: Harness
  environments: Environment[]
  createdAt: Date
  updatedAt: Date
}
```

### Harness
The complete configuration governing how agents operate on a project.

```
Harness {
  id: uuid
  projectId: uuid
  version: string
  tier: 'tier1' | 'tier2' | 'tier3'
  templateId: string
  contextFiles: ContextFile[]
  adapterConfig: AdapterConfig
  llmConfig: LLMConfig
  guardrails: Guardrail[]
  updatedAt: Date
}
```

### Intent
A human-authored statement of desired change or capability. The entry point for the generate loop.

```
Intent {
  id: uuid
  projectId: uuid
  correlationId: uuid
  text: string
  author: User
  status: IntentStatus
  artifacts: Artifact[]
  signals: FeedbackSignal[]
  createdAt: Date
  resolvedAt: Date | null
}
```

### Artifact
An output produced by the generate layer for a given intent.

```
Artifact {
  id: uuid
  intentId: uuid
  type: ArtifactType     // code | test | context-file | design | lint-config
  path: string
  content: string
  agentId: string
  createdAt: Date
}
```

### FeedbackSignal
A typed outcome emitted by any agent during the quality gate or maintenance loop.

```
FeedbackSignal {
  id: uuid
  correlationId: uuid
  type: SignalType       // LINT_FAILURE | TEST_FAILURE | CONSTRAINT_VIOLATION | CONTEXT_GAP | GOLDEN_PRINCIPLE_BREACH
  severity: Severity     // low | medium | high | critical
  sourceAgent: AgentRole
  message: string
  location: CodeLocation | null
  resolvedBy: AgentRole | 'human' | null
  resolvedAt: Date | null
  createdAt: Date
}
```

### AgentExecution
A record of a single ephemeral worker execution. Every agent run produces one.

```
AgentExecution {
  id: uuid
  correlationId: uuid
  agentRole: AgentRole
  taskType: TaskType
  status: ExecutionStatus   // queued | running | completed | failed | expired
  input: TaskMessage
  output: TaskResult | null
  durationMs: number | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
}
```

### User
A human operator of the platform.

```
User {
  id: uuid
  email: string
  role: UserRole          // admin | operator | viewer
  createdAt: Date
}
```

### AuditRecord
Immutable record of every state-changing operation (GP-002).

```
AuditRecord {
  id: uuid
  actor: string           // agent role or user id
  action: string
  entityType: string
  entityId: uuid
  correlationId: uuid
  metadata: Record<string, unknown>
  timestamp: Date
}
```

---

## Status enumerations

```typescript
type IntentStatus =
  | 'pending'
  | 'generating'
  | 'in-review'
  | 'approved'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'escalated';

type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'expired';

type ArtifactType =
  | 'code'
  | 'test'
  | 'context-file'
  | 'design'
  | 'lint-config';

type SignalType =
  | 'LINT_FAILURE'
  | 'TEST_FAILURE'
  | 'CONSTRAINT_VIOLATION'
  | 'CONTEXT_GAP'
  | 'GOLDEN_PRINCIPLE_BREACH';

type AgentRole =
  | 'orchestrator'
  | 'design-agent'
  | 'context-agent'
  | 'code-agent'
  | 'test-agent'
  | 'lint-config-agent'
  | 'constraint-agent'
  | 'test-runner-agent'
  | 'lint-agent'
  | 'security-agent'
  | 'review-agent'
  | 'pr-agent'
  | 'pipeline-agent'
  | 'promotion-agent'
  | 'drift-agent'
  | 'alignment-agent'
  | 'gc-agent'
  | 'evaluation-agent';
```

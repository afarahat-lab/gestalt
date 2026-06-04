/**
 * @gestalt/core
 * Public exports — the complete core API surface.
 */

// Shared types — re-exported for all packages
export type {
  AgentRole, SignalType, SignalSeverity, TaskType, TaskPriority,
  TaskMessage, TaskResult, TaskResultStatus,
  PlatformSignal, FeedbackSignal, AgentStatus, CodeLocation,
  Artifact, ArtifactType,
  UserRole, ProjectRole,
  ToolDefinition, ToolCall, ToolResult, BuiltInToolName, ToolCallLogEntry,
  HarnessPipelineConfig,
  Result,
} from './types';
export { ok, err } from './types';

// Tools (ADR-038)
export { FILE_TOOL_DEFINITIONS, executeFileTool, executeScript } from './tools/file-tools';
export type { ExecuteScriptResult } from './tools/file-tools';

// Platform secrets vault (Session 4 — migration 015)
export {
  loadMasterKey, encryptSecret, decryptSecret,
} from './secrets/vault';
export type { EncryptedSecret } from './secrets/vault';

// MCP — Model Context Protocol (ADR-039)
export { McpClient } from './tools/mcp-client';
export { resolveMcpClients } from './tools/mcp-resolver';
export type { McpServerConfig } from './tools/mcp-resolver';

// Agent base + configuration + orchestrator base (Amendment 2026-06
// — moved to core from agents-generate so every layer shares one
// implementation).
export { BaseLLMAgent } from './agents/base-llm-agent';
export {
  SelfHealingAgent,
} from './agents/self-healing-agent';
export type {
  SelfHealingContext, SelfHealingDiagnosis,
} from './agents/self-healing-agent';
export {
  runSelfHealingLoop, shouldSkipAgent, isUnrecoverableError,
} from './agents/self-healing-loop';
export type {
  FailureType, SelfHealingLoopPayload, SelfHealingResult, ResumeSource,
} from './agents/self-healing-loop';
export { BaseOrchestrator, setPlatformMcpResolver } from './orchestrator/base-orchestrator';
export type { OrchestratorContext, PlatformMcpResolver } from './orchestrator/base-orchestrator';
export {
  resolveProjectCredential, setProjectSecretResolver,
} from './projects/credential-resolver';
export type { ProjectSecretResolver } from './projects/credential-resolver';
export {
  loadAgentConfig, loadCustomAgents, defaultAgentConfig,
  PER_ROLE_DEFAULTS,
} from './agents/agent-config-loader';
export {
  applyAgentConfig, buildPersona, buildExtensionsBlock,
} from './agents/agent-config-helpers';
export {
  extractJsonObject, parseLlmJson,
} from './agents/json-extract';
export type {
  AgentConfig, AgentLlmConfig, AgentToolConfig, AgentsYaml,
  CustomAgentDefinition, CustomAgentNode,
  LlmCallFn,
} from './agents/agent-config';

// Config
export type { GestaltConfig, ServerConfig, DatabaseConfig, QueueConfig, LLMConfig, AuthConfig } from './config/index';
export { loadConfig, GestaltConfigError } from './config/index';

// Logger
export type { LogLevel, LogContext } from './logger/index';
export { logger, createContextLogger, logSignal } from './logger/index';

// LLM
export type {
  LLMMessage, LLMRequest, LLMResponse, LLMError,
  LLMToolCall, ToolLoopMessage,
  CompleteWithToolsRequest, CompleteWithToolsResponse,
} from './llm/index';
export {
  LLMClient, getLLMClient, createLLMClient,
  getLLMClientForModel, setLLMRegistryResolver,
} from './llm/index';

// Queue
export type { QueueName, TaskHandler } from './queue/index';
export {
  QUEUE_NAMES, getQueue, dispatch, createWorker, createQueueEventListener,
  setQueueConfig, getQueueConfig,
} from './queue/index';

// Repository
export type {
  IntentRecord, IntentStatus, IntentListFilters,
  AgentExecutionRecord, ExecutionStatus,
  AuditRecord,
  UserRecord,
  LocalAuthRecord,
  ProjectRecord,
  DeploymentEventRecord, DeploymentEventType,
  MaintenanceRunRecord, MaintenanceRunStatus, MaintenanceFinding,
  FindingAttemptRecord,
  AlertRecord, AlertType, AlertRequiredAction,
  AgentExecutionLogRecord,
  ProjectMembershipRecord,
  InterventionRecord, InterventionAction,
  PlatformLLMRecord, PlatformLLMRepository, LLMApiShape,
  PlatformSecretRecord, PlatformSecretSummary, PlatformSecretRepository,
  KeyRotationRecord, KeyRotationRepository,
  PlatformTemplateRecord, PlatformTemplateSummary, PlatformTemplateRepository,
  TemplateVariable,
  PlatformMcpServerRecord, PlatformMcpServerRepository,
  IdentityConfigRecord, IdentityConfigRepository, IdentityProvider,
  RoleMappingRecord, RoleMappingRepository,
  PlatformGroupRecord, GroupMembershipRecord, GroupProjectAssignmentRecord,
  GroupMemberWithUser, GroupProjectWithProject,
  EffectiveProjectMembership, PlatformGroupRepository,
  SelfHealingConfigRecord, SelfHealingConfigRepository,
  ResumeContext,
  RepositoryRegistry,
  IntentRepository, AgentExecutionRepository,
  ArtifactRepository, SignalRepository,
  AuditRepository, UserRepository, LocalAuthRepository,
  ProjectRepository, DeploymentEventRepository,
  MaintenanceRunRepository, FindingAttemptRepository, AlertRepository,
  AgentExecutionLogRepository,
  ProjectMembershipRepository,
  InterventionRepository,
} from './repository/index';
export { getRepositories, setRepositories } from './repository/index';

// Harness
export type { HarnessConfig, HarnessAgentConfig, ConstraintRule, ContextSnapshot, HarnessValidationResult } from './harness/index';
export { HarnessEngine, createHarnessEngine, REQUIRED_CONTEXT_FILES } from './harness/index';

// Events
export type { LiveEventType, LiveEvent, EventSubscriber, EventBus } from './events/index';
export { eventBus, emitLiveEvent } from './events/index';

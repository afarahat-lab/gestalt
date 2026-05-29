/**
 * @gestalt/core
 * Public exports — the complete core API surface.
 */

// Shared types — re-exported for all packages
export type {
  AgentRole, SignalType, SignalSeverity, TaskType, TaskPriority,
  TaskMessage, TaskResult, TaskResultStatus,
  PlatformSignal, CodeLocation,
  Artifact, ArtifactType,
  UserRole,
  Result,
} from './types';
export { ok, err } from './types';

// Config
export type { GestaltConfig, ServerConfig, DatabaseConfig, QueueConfig, LLMConfig, AuthConfig } from './config/index';
export { loadConfig, GestaltConfigError } from './config/index';

// Logger
export type { LogLevel, LogContext } from './logger/index';
export { logger, createContextLogger, logSignal } from './logger/index';

// LLM
export type { LLMMessage, LLMRequest, LLMResponse, LLMError } from './llm/index';
export { LLMClient, getLLMClient, createLLMClient } from './llm/index';

// Queue
export type { QueueName, TaskHandler } from './queue/index';
export { QUEUE_NAMES, getQueue, dispatch, createWorker, createQueueEventListener } from './queue/index';

// Repository
export type {
  IntentRecord, IntentStatus,
  AgentExecutionRecord, ExecutionStatus,
  AuditRecord,
  UserRecord,
  LocalAuthRecord,
  ProjectRecord,
  RepositoryRegistry,
  IntentRepository, AgentExecutionRepository,
  ArtifactRepository, SignalRepository,
  AuditRepository, UserRepository, LocalAuthRepository,
  ProjectRepository,
} from './repository/index';
export { getRepositories, setRepositories } from './repository/index';

// Harness
export type { HarnessConfig, ContextSnapshot, HarnessValidationResult } from './harness/index';
export { HarnessEngine, createHarnessEngine, REQUIRED_CONTEXT_FILES } from './harness/index';

// Events
export type { LiveEventType, LiveEvent, EventSubscriber, EventBus } from './events/index';
export { eventBus, emitLiveEvent } from './events/index';

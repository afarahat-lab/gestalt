// @gestalt/adapter-mssql — implementation coming in Phase 2.
// Repository stubs live under ./repositories so that interface drift in
// @gestalt/core surfaces as a build error here, not at runtime.

export { MssqlIntentRepository } from './repositories/intents';
export { MssqlProjectRepository } from './repositories/projects';
export { MssqlDeploymentEventRepository } from './repositories/deployment-events';
export { MssqlMaintenanceRunRepository } from './repositories/maintenance-runs';
export { MssqlFindingAttemptRepository } from './repositories/finding-attempts';
export { MssqlAlertRepository } from './repositories/alerts';
export { MssqlAgentExecutionLogRepository } from './repositories/execution-logs';
export { MssqlProjectMembershipRepository } from './repositories/memberships';
export { MssqlInterventionRepository } from './repositories/interventions';
export { MssqlPlatformLLMRepository } from './repositories/platform-llms';
export { MssqlPlatformSecretRepository } from './repositories/platform-secrets';
export { MssqlPlatformTemplateRepository } from './repositories/platform-templates';
export { MssqlPlatformMcpServerRepository } from './repositories/platform-mcp-servers';
export {
  MssqlIdentityConfigRepository, MssqlRoleMappingRepository,
} from './repositories/identity-config';

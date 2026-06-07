// @gestalt/adapter-oracle — implementation coming in Phase 2.
// Repository stubs live under ./repositories so that interface drift in
// @gestalt/core surfaces as a build error here, not at runtime.

export { OracleIntentRepository } from './repositories/intents';
export { OracleProjectRepository } from './repositories/projects';
export { OracleDeploymentEventRepository } from './repositories/deployment-events';
export { OracleMaintenanceRunRepository } from './repositories/maintenance-runs';
export { OracleFindingAttemptRepository } from './repositories/finding-attempts';
export { OracleAlertRepository } from './repositories/alerts';
export { OracleAgentExecutionLogRepository } from './repositories/execution-logs';
export { OracleProjectMembershipRepository } from './repositories/memberships';
export { OracleInterventionRepository } from './repositories/interventions';
export { OraclePlatformLLMRepository } from './repositories/platform-llms';
export { OraclePlatformSecretRepository } from './repositories/platform-secrets';
export { OracleKeyRotationRepository } from './repositories/key-rotations';
export { OraclePlatformTemplateRepository } from './repositories/platform-templates';
export { OraclePlatformMcpServerRepository } from './repositories/platform-mcp-servers';
export {
  OracleIdentityConfigRepository, OracleRoleMappingRepository,
} from './repositories/identity-config';
export { OraclePlatformGroupRepository } from './repositories/platform-groups';
export { OracleSelfHealingConfigRepository } from './repositories/self-healing-config';
export { OracleFeatureRepository } from './repositories/features';

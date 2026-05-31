// @gestalt/adapter-oracle — implementation coming in Phase 2.
// Repository stubs live under ./repositories so that interface drift in
// @gestalt/core surfaces as a build error here, not at runtime.

export { OracleIntentRepository } from './repositories/intents';
export { OracleProjectRepository } from './repositories/projects';
export { OracleDeploymentEventRepository } from './repositories/deployment-events';
export { OracleMaintenanceRunRepository } from './repositories/maintenance-runs';
export { OracleAlertRepository } from './repositories/alerts';
export { OracleAgentExecutionLogRepository } from './repositories/execution-logs';

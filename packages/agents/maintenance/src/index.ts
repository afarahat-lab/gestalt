/**
 * @gestalt/agents-maintenance
 * Public exports for the maintenance layer (ADR-018, ADR-019, ADR-020,
 * ADR-035).
 */

// Scheduler entry point — call once at server startup.
export { startMaintenanceScheduler, triggerMaintenanceRun } from './scheduler';
export type { MaintenanceSchedulerConfig, MaintenanceAgentName } from './scheduler';

// Per-agent direct entry points (used by tests). The manual-trigger
// endpoint and the cron jobs both go through `triggerMaintenanceRun` so
// observability stays consistent.
export { runDriftAgent }      from './agents/drift-agent';
export { runAlignmentAgent }  from './agents/alignment-agent';
export { runGCAgent }         from './agents/gc-agent';
export { runEvaluationAgent } from './agents/evaluation-agent';

// Context-fixer (ADR-018) — direct-fix path for docs-only maintenance
// intents. Exposed so tests / advanced wiring can call it without going
// through the runner.
export { ContextFixer } from './agents/context-fixer';
export type { ContextFixProject, ContextFixOutcome } from './agents/context-fixer';

// Runner — exposed for tests + advanced wiring (skip the scheduler).
export { runMaintenanceAgent, loadProjectInputs } from './runner';
export type { RunInput } from './runner';

// Monitoring adapters (ADR-020).
export { NoopMonitoringAdapter } from './adapters/noop-monitoring-adapter';
export { PrometheusAdapter } from './adapters/prometheus-adapter';
export type { PrometheusAdapterOptions } from './adapters/prometheus-adapter';
export { DatadogAdapter } from './adapters/datadog-adapter';
export type { DatadogAdapterOptions } from './adapters/datadog-adapter';
export { resolveMonitoringAdapter } from './adapters/resolver';

// Types.
export type {
  MaintenanceIntent, MaintenanceIntentType, MaintenanceIntentClass,
  MaintenancePriority,
  MaintenanceAgentInput, MaintenanceAgentResult,
  MonitoringAdapter, MonitoringAdapterType,
  MonitoringThresholds,
  HarnessSubset,
  MaintenanceHarnessConfig,
  MaintenanceFinding,
} from './types';
export { classifyMaintenanceIntent } from './types';
export { DEFAULT_MONITORING_THRESHOLDS, DEFAULT_MAINTENANCE_CONFIG } from './types';

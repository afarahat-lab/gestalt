/**
 * @gestalt/agents-maintenance — types.
 *
 * Contract for the four scheduled maintenance agents and the
 * MonitoringAdapter interface used by evaluation-agent (ADR-019,
 * ADR-020, ADR-035).
 */

import type { MaintenanceFinding } from '@gestalt/core';

// ─── Maintenance intent ───────────────────────────────────────────────────────

/**
 * The four typed maintenance-intent kinds (ADR-019). Agents never queue
 * free-form strings — always a `MaintenanceIntent` whose `type` lets the
 * generate orchestrator's downstream agents understand why the intent
 * exists. The marker `[gestalt-maintenance/<type>]` is prepended to the
 * intent text on dispatch so duplicate detection can match against the
 * existing intents table.
 */
export type MaintenanceIntentType =
  | 'CONTEXT_UPDATE'           // drift-agent: context files out of sync with code
  | 'CONTEXT_ALIGNMENT'        // alignment-agent: context files inconsistent with each other
  | 'PERFORMANCE_DEGRADATION'  // evaluation-agent: metrics threshold breached
  | 'SECURITY_FINDING';        // evaluation-agent: security signal from monitoring

/**
 * Maintenance intents split into two routing classes (ADR-018):
 *
 *   - `context-file-update` — additive docs-only fixes that the
 *     maintenance layer applies *directly* to `defaultBranch` via the
 *     context-fixer. The generate → gate → deploy loop is the wrong
 *     tool for a markdown edit (the test-agent has nothing to test,
 *     the gate's constraint regex finds nothing actionable).
 *   - `code-change` — performance + security findings that need a
 *     code change and full review. These continue to flow through the
 *     generate orchestrator like every human-submitted intent.
 */
export type MaintenanceIntentClass = 'context-file-update' | 'code-change';

export function classifyMaintenanceIntent(type: MaintenanceIntentType): MaintenanceIntentClass {
  switch (type) {
    case 'CONTEXT_UPDATE':
    case 'CONTEXT_ALIGNMENT':
      return 'context-file-update';
    case 'PERFORMANCE_DEGRADATION':
    case 'SECURITY_FINDING':
      return 'code-change';
  }
}

export type MaintenancePriority = 'critical' | 'high' | 'normal' | 'low';

export interface MaintenanceIntent {
  type: MaintenanceIntentType;
  projectId: string;
  priority: MaintenancePriority;
  affectedFiles: string[];
  /** What the agent observed (raw evidence — metrics, file timestamps, etc.). */
  evidence: string;
  /** Human-readable action description, dispatched as the intent text. */
  suggestedAction: string;
}

// ─── Monitoring adapter (ADR-020) ─────────────────────────────────────────────

export type MonitoringAdapterType = 'noop' | 'prometheus' | 'datadog';

export interface MonitoringAdapter {
  readonly type: MonitoringAdapterType;
  getErrorRate(params: { windowMinutes: number }): Promise<number>;
  getLatencyP99Ms(params: { windowMinutes: number }): Promise<number>;
  getAlertCount(params: { windowMinutes: number }): Promise<number>;
}

export interface MonitoringThresholds {
  errorRatePercent: number;   // default 5.0
  latencyP99Ms: number;       // default 2000
  alertCountWindow: string;   // e.g. '1h'
  alertCountThreshold: number; // default 10
}

export const DEFAULT_MONITORING_THRESHOLDS: MonitoringThresholds = {
  errorRatePercent: 5.0,
  latencyP99Ms: 2000,
  alertCountWindow: '1h',
  alertCountThreshold: 10,
};

// ─── Per-agent input + result ────────────────────────────────────────────────

export interface MaintenanceAgentInput {
  projectId: string;
  projectName: string;
  projectGitUrl: string;
  token: string;
  defaultBranch: string;
  harness: HarnessSubset;
}

/**
 * Subset of `HARNESS.json` the maintenance agents consume. Loaded by the
 * scheduler from the project's harness, falling back to defaults when
 * fields are missing.
 */
export interface HarnessSubset {
  maintenance?: {
    driftCheck?: { enabled: boolean; scheduleUtc?: string };
    alignmentCheck?: { enabled: boolean; scheduleUtc?: string };
    gcCheck?: { enabled: boolean; scheduleUtc?: string };
    monitoring?: {
      adapter?: MonitoringAdapterType | string;
      connectionConfig?: Record<string, string>;
      thresholds?: Partial<MonitoringThresholds>;
      enabled?: boolean;
    };
  };
}

export interface MaintenanceAgentResult {
  intentsQueued: MaintenanceIntent[];
  directFixes: number;
  findings: MaintenanceFinding[];
}

// Re-export for callers that only depend on this package.
export type { MaintenanceFinding };

// ─── Harness-config aggregate ────────────────────────────────────────────────

export interface MaintenanceHarnessConfig {
  driftCheck: { enabled: boolean; scheduleUtc: string };
  alignmentCheck: { enabled: boolean; scheduleUtc: string };
  gcCheck: { enabled: boolean; scheduleUtc: string };
  monitoring: {
    adapter: MonitoringAdapterType;
    enabled: boolean;
    connectionConfig: Record<string, string>;
    thresholds: MonitoringThresholds;
  };
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceHarnessConfig = {
  driftCheck: { enabled: true, scheduleUtc: '0 2 * * *' },
  alignmentCheck: { enabled: true, scheduleUtc: '0 3 * * *' },
  gcCheck: { enabled: true, scheduleUtc: '0 4 * * 5' },
  monitoring: {
    adapter: 'noop',
    enabled: false,
    connectionConfig: {},
    thresholds: DEFAULT_MONITORING_THRESHOLDS,
  },
};

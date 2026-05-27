/**
 * @agentforge-sdlc/dashboard
 * Public exports for the oversight dashboard.
 */

export type {
  IntentSummary, IntentDetail, IntentStatus,
  Alert, AlertSeverity, AlertAction,
  InterventionRequest, InterventionRecord, InterventionType,
  MaintenanceRunSummary, LiveEvent, LiveEventType,
  DashboardUser, UserRole,
  GateResultSummary, DeploymentStatus, SignalSummary,
} from './types';

export { DashboardApiClient, ApiError } from './api/client';
export { ApiProvider, useDashboardApi } from './hooks/useApi';
export { useLiveEvents, useLiveEvent }  from './hooks/useLiveEvents';

export { default as App } from './App';

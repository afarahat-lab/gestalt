/**
 * Alert router — converts platform signals into alerts and routes them
 * to the configured notification channels.
 *
 * Signal → alert mapping:
 *   GOLDEN_PRINCIPLE_BREACH → critical alert, required action: acknowledge-breach
 *   CONTEXT_GAP (unresolved) → high alert, required action: provide-clarification
 *   Pending manual promotion → medium alert, required action: approve-promotion
 *
 * Notification channels (configured in HARNESS.json oversight.alertRoutes):
 *   dashboard — always active, no config required
 *   email     — requires SMTP config
 *   slack     — requires webhook URL
 *   webhook   — requires endpoint URL
 *
 * Full implementation: Phase 2.
 */

import type { Alert, AlertSeverity, AlertAction } from '../../../dashboard/src/types';

export type NotificationChannel = 'dashboard' | 'email' | 'slack' | 'webhook';

export interface AlertRoute {
  signalType: string;
  severity: AlertSeverity;
  channels: NotificationChannel[];
  assignee?: string;
}

export interface AlertRouterConfig {
  routes: AlertRoute[];
  defaultChannels: NotificationChannel[];
}

/**
 * Creates an Alert from a platform signal.
 */
export function buildAlert(params: {
  correlationId: string;
  signalType: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  requiredAction: AlertAction;
  context: Record<string, unknown>;
}): Omit<Alert, 'id' | 'createdAt' | 'acknowledgedAt'> {
  return {
    correlationId: params.correlationId,
    type: params.signalType,
    severity: params.severity,
    title: params.title,
    description: params.description,
    requiredAction: params.requiredAction,
    context: params.context,
  };
}

/**
 * Resolves which notification channels to use for a given signal.
 * Falls back to defaultChannels if no matching route is configured.
 */
export function resolveChannels(
  signalType: string,
  severity: AlertSeverity,
  config: AlertRouterConfig,
): NotificationChannel[] {
  const match = config.routes.find(
    (r) => r.signalType === signalType && r.severity === severity,
  );
  return match?.channels ?? config.defaultChannels;
}

/**
 * Sends an alert notification to the specified channels.
 * Phase 2: full implementation per channel.
 */
export async function sendAlertNotification(
  alert: Alert,
  channels: NotificationChannel[],
): Promise<void> {
  for (const channel of channels) {
    switch (channel) {
      case 'dashboard':
        // Phase 2: emit live event via SSE event bus
        break;
      case 'email':
        // Phase 2: send via configured SMTP
        break;
      case 'slack':
        // Phase 2: POST to configured webhook URL
        break;
      case 'webhook':
        // Phase 2: POST alert payload to configured endpoint
        break;
    }
  }
}

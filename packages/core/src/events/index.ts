/**
 * @gestalt/core/events
 *
 * In-process event bus consumed by the server's SSE route and emitted to by
 * any in-process producer (route handlers, the generate-layer orchestrator
 * worker, future agents). Living in core lets agents-generate import the
 * same singleton the server does without creating a dep cycle.
 *
 * Sufficient for a single-server deployment. A Redis pub/sub adapter can
 * replace this for multi-server setups without touching call sites.
 */

import { createContextLogger } from '../logger/index';

const log = createContextLogger({ module: 'event-bus' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type LiveEventType =
  | 'intent.created'
  | 'intent.status-changed'
  | 'agent.started'
  | 'agent.completed'
  | 'signal.emitted'
  | 'gate.completed'
  | 'deployment.updated'
  | 'alert.created'
  | 'alert.acknowledged'
  /**
   * The self-healing agent auto-resolved an escalated alert at high
   * confidence and re-dispatched the intent. The dashboard's Alerts
   * view consumes this event to remove the card from the list. The
   * IntentDetail attempt-history panel also updates because the
   * intent transitions to `generating` in the same atomic write
   * sequence. Migration 020.
   */
  | 'alert.auto-resolved'
  | 'maintenance.run-completed'
  | 'project.deleted';

export interface LiveEvent {
  type: LiveEventType;
  correlationId: string;
  payload: unknown;
  timestamp: string;
}

export type EventSubscriber = (event: LiveEvent) => void;

export interface EventBus {
  emit(event: LiveEvent): void;
  subscribe(subscriber: EventSubscriber): () => void;
}

// ─── In-process implementation ────────────────────────────────────────────────

class InProcessEventBus implements EventBus {
  private readonly subscribers = new Set<EventSubscriber>();

  emit(event: LiveEvent): void {
    log.debug({ eventType: event.type, correlationId: event.correlationId }, 'Event emitted');
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (err) {
        log.error({ err }, 'Event subscriber threw');
      }
    }
  }

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}

// Process-wide singleton.
export const eventBus: EventBus & { subscriberCount: number } =
  new InProcessEventBus();

/**
 * Emit a typed live event. Wraps `eventBus.emit` so the timestamp is
 * always ISO 8601 and the caller doesn't have to build the envelope.
 */
export function emitLiveEvent(
  type: LiveEventType,
  correlationId: string,
  payload: unknown,
): void {
  eventBus.emit({
    type,
    correlationId,
    payload,
    timestamp: new Date().toISOString(),
  });
}

/**
 * React hook for subscribing to live server-sent events.
 * Automatically reconnects on disconnection.
 * Cleans up on unmount.
 */

import { useEffect, useCallback } from 'react';
import type { LiveEvent, LiveEventType } from '../types';
import { useDashboardApi } from './useApi';

/**
 * Subscribes to all live events and calls the handler for each.
 */
export function useLiveEvents(
  onEvent: (event: LiveEvent) => void,
): void {
  const api = useDashboardApi();

  useEffect(() => {
    const cleanup = api.subscribeLiveEvents(onEvent);
    return cleanup;
  }, [api, onEvent]);
}

/**
 * Subscribes to live events of a specific type only.
 */
export function useLiveEvent<T = unknown>(
  eventType: LiveEventType,
  onEvent: (payload: T, correlationId: string) => void,
): void {
  const handler = useCallback(
    (event: LiveEvent) => {
      if (event.type === eventType) {
        onEvent(event.payload as T, event.correlationId);
      }
    },
    [eventType, onEvent],
  );

  useLiveEvents(handler);
}

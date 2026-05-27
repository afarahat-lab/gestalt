/**
 * React context and hook for the dashboard API client.
 * Provides a single shared client instance to all components.
 */

import { createContext, useContext } from 'react';
import { DashboardApiClient } from '../api/client';

const ApiContext = createContext<DashboardApiClient | null>(null);

export const ApiProvider = ApiContext.Provider;

/**
 * Returns the dashboard API client from context.
 * Throws if used outside of ApiProvider.
 */
export function useDashboardApi(): DashboardApiClient {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error('useDashboardApi must be used within ApiProvider');
  }
  return client;
}

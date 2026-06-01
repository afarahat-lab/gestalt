/**
 * CurrentUserContext — caches the signed-in operator's profile.
 *
 * Loaded once on mount via `/auth/me`. The Admin nav link in Layout
 * and the Admin view itself read `role === 'platform-admin'` from
 * this context — when the API returns 401 we hard-navigate to
 * /app/login (same pattern as ProjectContext).
 *
 * The Admin link is completely absent from the DOM for non-platform-
 * admin users — not just hidden via CSS.
 */

import React, {
  createContext, useContext, useEffect, useMemo, useState,
} from 'react';
import { useDashboardApi } from '../hooks/useApi';
import { ApiError } from '../api/client';
import type { DashboardUser } from '../types';

interface CurrentUserContextValue {
  user: DashboardUser | null;
  loading: boolean;
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const api = useDashboardApi();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.getCurrentUser()
      .then((u) => {
        if (!cancelled) {
          setUser(u);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem('gestalt_token');
          window.location.href = '/app/login';
        }
      });
    return () => { cancelled = true; };
  }, [api]);

  const value = useMemo<CurrentUserContextValue>(() => ({ user, loading }), [user, loading]);
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUserContextValue {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error('useCurrentUser must be used inside CurrentUserProvider');
  return ctx;
}

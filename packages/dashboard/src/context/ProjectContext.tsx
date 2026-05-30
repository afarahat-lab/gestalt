/**
 * ProjectContext — the dashboard's globally-selected project.
 *
 * One fetch of `/projects` on mount. The selection rule (in order):
 *   1. localStorage `gestalt_project_id` (set by the CLI's
 *      `gestalt init` / `gestalt projects use`, or by an earlier
 *      dashboard session)
 *   2. `projects[0]` if the stored id is missing or no longer matches
 *      anything the API returned
 *   3. `null` if the user has no projects yet
 *
 * The selected id is rewritten to localStorage on every change so the
 * next dashboard load lands on the same project.
 *
 * Window-focus refetch keeps the list current when the operator
 * registers a new project in another terminal (`gestalt init`) without
 * needing a server-side `project.created` SSE event.
 *
 * The localStorage key is `gestalt_project_id` (NOT `gestalt_project`)
 * — established in the 2026-05-31 clarification session. Older code that
 * still reads the legacy key is the bug this refactor fixes.
 */

import React, {
  createContext, useContext, useCallback, useEffect, useMemo, useState,
} from 'react';
import { useDashboardApi } from '../hooks/useApi';
import { ApiError } from '../api/client';
import type { ProjectSummary } from '../types';

const STORAGE_KEY = 'gestalt_project_id';

interface ProjectContextValue {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  currentProject: ProjectSummary | null;
  setCurrentProjectId: (id: string) => void;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const api = useDashboardApi();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listProjects();
      const list = res.data ?? [];
      setProjects(list);

      setCurrentProjectIdState((existing) => {
        // If we already chose a project in this session AND it's still
        // in the list, keep it. Switching projects mid-session because
        // the server's order shifted would be infuriating.
        if (existing && list.some((p) => p.id === existing)) return existing;

        // Otherwise hydrate from storage, falling back to the first
        // project. Persist the chosen id eagerly so the next reload
        // takes the fast path.
        const stored = localStorage.getItem(STORAGE_KEY);
        const chosen = stored && list.some((p) => p.id === stored)
          ? stored
          : (list[0]?.id ?? null);
        if (chosen) localStorage.setItem(STORAGE_KEY, chosen);
        return chosen;
      });
    } catch (err) {
      // A 401 here means the JWT in localStorage is expired or invalid.
      // RequireAuth at the top of the tree only checks presence, not
      // validity, so a stale token gets you onto the dashboard and
      // then silently fails every API call. Without this branch the
      // sidebar would show "No projects — run gestalt init" even
      // though the operator has projects but is just signed out.
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem('gestalt_token');
        // Hard navigate so React Router picks up the no-token state
        // and RequireAuth bounces to /app/login.
        window.location.href = '/app/login';
        return;
      }
      // Other errors (network down, server 500) surface as "no
      // projects" rather than crashing the layout — operator can
      // refresh the tab.
      setProjects([]);
      setCurrentProjectIdState(null);
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Initial load
  useEffect(() => { void refresh(); }, [refresh]);

  // Refresh on window focus — catches new projects registered in another
  // terminal while the dashboard tab is open. Cheap (a single GET) and
  // doesn't need a server-side SSE event for the registration.
  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, [refresh]);

  const setCurrentProjectId = useCallback((id: string) => {
    setCurrentProjectIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo<ProjectContextValue>(() => ({
    projects,
    currentProjectId,
    currentProject: projects.find((p) => p.id === currentProjectId) ?? null,
    setCurrentProjectId,
    loading,
  }), [projects, currentProjectId, setCurrentProjectId, loading]);

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const v = useContext(ProjectContext);
  if (!v) throw new Error('useProject must be used within a ProjectProvider');
  return v;
}

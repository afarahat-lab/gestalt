import React, { useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ApiProvider } from './hooks/useApi';
import { ProjectProvider } from './context/ProjectContext';
import { CurrentUserProvider, useCurrentUser } from './context/CurrentUserContext';
import { DashboardApiClient } from './api/client';
import { Layout } from './components/layout/Layout';
import { Login } from './views/Login';
import { IntentFeed } from './views/IntentFeed';
import { IntentDetail } from './views/IntentDetail';
import { ActiveAgents } from './views/ActiveAgents';
import { QualityGate } from './views/QualityGate';
import { Deployments } from './views/Deployments';
import { Maintenance } from './views/Maintenance';
import { Alerts } from './views/Alerts';
import { Admin } from './views/Admin';
import { ProjectSettings } from './views/ProjectSettings';
import { useProject } from './context/ProjectContext';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('gestalt_token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequirePlatformAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser();
  if (loading) return null;
  if (!user || user.role !== 'platform-admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * Gate for `/projects/:id/settings`. Passes when the user is a
 * platform-admin OR the current-project role is `project-admin`.
 * Editors / readers — and anyone with no membership — bounce home.
 */
function RequireProjectAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading: userLoading } = useCurrentUser();
  const { currentUserRole, loading: projectsLoading } = useProject();
  if (userLoading || projectsLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === 'platform-admin') return <>{children}</>;
  if (currentUserRole === 'project-admin') return <>{children}</>;
  return <Navigate to="/" replace />;
}

export default function App() {
  const client = useMemo(() => {
    const c = new DashboardApiClient(window.location.origin);
    const token = localStorage.getItem('gestalt_token');
    if (token) c.setToken(token);
    return c;
  }, []);

  return (
    <ApiProvider value={client}>
      {/* basename mirrors Vite's `base: '/app/'`. Every `navigate(...)`
          and `<Link to=...>` is now interpreted relative to /app, so
          `/intents/:id` inside the SPA resolves to /app/intents/:id in
          the URL bar — distinct from the API's /intents/:id.

          ErrorBoundary catches any uncaught render exception (e.g. a
          React-rules-of-hooks violation in a child view) and renders
          a recovery panel instead of letting React unmount the whole
          tree to a black screen. */}
      <BrowserRouter basename="/app">
        <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                {/* CurrentUserProvider + ProjectProvider sit inside
                    RequireAuth so their fetches only fire for
                    authenticated sessions, and outside the Routes so
                    every view sees the same context. */}
                <CurrentUserProvider>
                  <ProjectProvider>
                    <Layout />
                  </ProjectProvider>
                </CurrentUserProvider>
              </RequireAuth>
            }
          >
            <Route index element={<IntentFeed />} />
            <Route path="intents/:id" element={<IntentDetail />} />
            <Route path="agents" element={<ActiveAgents />} />
            <Route path="gate" element={<QualityGate />} />
            <Route path="deployments" element={<Deployments />} />
            <Route path="maintenance" element={<Maintenance />} />
            <Route path="alerts" element={<Alerts />} />
            <Route
              path="admin/*"
              element={
                <RequirePlatformAdmin>
                  <Admin />
                </RequirePlatformAdmin>
              }
            />
            {/* Per-project settings — project-admin or platform-admin
                only. The `:id` segment ensures deep links survive
                project switching. */}
            <Route
              path="projects/:id/settings"
              element={
                <RequireProjectAdmin>
                  <ProjectSettings />
                </RequireProjectAdmin>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </ApiProvider>
  );
}

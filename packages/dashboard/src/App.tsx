import React, { useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ApiProvider } from './hooks/useApi';
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

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('gestalt_token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
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
          the URL bar — distinct from the API's /intents/:id. */}
      <BrowserRouter basename="/app">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Layout />
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
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ApiProvider>
  );
}

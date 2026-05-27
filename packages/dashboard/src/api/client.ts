/**
 * Typed HTTP client for the AgentForge SDLC server API.
 * All dashboard data access goes through this client — never raw fetch.
 *
 * Uses Server-Sent Events for live updates.
 */

import type {
  IntentSummary, IntentDetail, Alert, InterventionRequest,
  InterventionRecord, MaintenanceRunSummary, LiveEvent, DashboardUser,
} from '../types';

export class DashboardApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string): void {
    this.token = token;
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<{ token: string; user: DashboardUser }> {
    return this.post('/auth/login', { email, password });
  }

  async getCurrentUser(): Promise<DashboardUser> {
    return this.get('/auth/me');
  }

  // ─── Intents ───────────────────────────────────────────────────────────────

  async listIntents(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ intents: IntentSummary[]; total: number }> {
    return this.get('/intents', params);
  }

  async getIntent(id: string): Promise<IntentDetail> {
    return this.get(`/intents/${id}`);
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────

  async listAlerts(params?: {
    acknowledged?: boolean;
    severity?: string;
  }): Promise<{ alerts: Alert[]; total: number }> {
    return this.get('/alerts', params);
  }

  async getAlert(id: string): Promise<Alert> {
    return this.get(`/alerts/${id}`);
  }

  // ─── Interventions ─────────────────────────────────────────────────────────

  async submitIntervention(request: InterventionRequest): Promise<InterventionRecord> {
    return this.post('/interventions', request);
  }

  // ─── Maintenance ───────────────────────────────────────────────────────────

  async listMaintenanceRuns(params?: {
    agentRole?: string;
    limit?: number;
  }): Promise<{ runs: MaintenanceRunSummary[]; total: number }> {
    return this.get('/maintenance/runs', params);
  }

  async triggerMaintenanceAgent(agentRole: string): Promise<{ queued: true }> {
    return this.post('/maintenance/trigger', { agentRole });
  }

  // ─── Live events (SSE) ─────────────────────────────────────────────────────

  /**
   * Opens a Server-Sent Events connection for live updates.
   * Returns a cleanup function to close the connection.
   */
  subscribeLiveEvents(
    onEvent: (event: LiveEvent) => void,
    onError?: (error: Event) => void,
  ): () => void {
    const url = `${this.baseUrl}/events?token=${this.token ?? ''}`;
    const source = new EventSource(url);

    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as LiveEvent;
        onEvent(event);
      } catch {
        // Ignore malformed events
      }
    };

    if (onError) {
      source.onerror = onError;
    }

    return () => source.close();
  }

  // ─── HTTP helpers ──────────────────────────────────────────────────────────

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, String(v));
      });
    }
    const res = await fetch(url.toString(), { headers: this.headers() });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`API error ${status}: ${body}`);
  }
}

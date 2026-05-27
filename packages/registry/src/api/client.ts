/**
 * Registry API client.
 *
 * Used by the CLI (agentforge init, agentforge registry search)
 * and by the harness initializer to find matching templates.
 *
 * The registry API is a remote service hosted by the AgentForge project.
 * For air-gapped environments, operators configure a mirror URL
 * in HARNESS.json under registry.mirrorUrl.
 *
 * Default registry URL: https://registry.agentforge.dev (planned)
 */

import type {
  RegistryEntry, RegistrySearchParams, RegistrySearchResult,
  RegistrySubmission, RegistryPullRequest,
} from '../types';

export class RegistryClient {
  private readonly baseUrl: string;

  constructor(baseUrl = 'https://registry.agentforge.dev') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  /**
   * Searches the registry for entries matching the given parameters.
   */
  async search(params: RegistrySearchParams): Promise<RegistrySearchResult> {
    return this.get<RegistrySearchResult>('/entries/search', params as Record<string, unknown>);
  }

  /**
   * Returns a single registry entry by slug.
   */
  async getEntry(slug: string): Promise<RegistryEntry> {
    return this.get<RegistryEntry>(`/entries/${slug}`);
  }

  /**
   * Returns all Tier 1 entries — the standard library.
   * These are also bundled with the platform, but this allows version checking.
   */
  async getStandardLibrary(): Promise<RegistryEntry[]> {
    const result = await this.search({ tier: 'tier1', limit: 100 });
    return result.entries;
  }

  // ─── Install ─────────────────────────────────────────────────────────────

  /**
   * Installs a registry entry into the current project.
   * For Tier 1: copies from bundled templates.
   * For Tier 2/3: clones from the source git repository.
   *
   * Phase 2: full implementation.
   */
  async install(
    slug: string,
    targetPath: string,
    _options?: { force?: boolean },
  ): Promise<RegistryPullRequest> {
    throw new Error(`install(${slug} → ${targetPath}) not yet implemented — pending Phase 2`);
  }

  // ─── Submit ───────────────────────────────────────────────────────────────

  /**
   * Submits a new entry to the registry.
   * Triggers automated checks and queues for maintainer review (Tier 2)
   * or publishes immediately (Tier 3).
   */
  async submit(submission: Omit<RegistrySubmission, 'id' | 'automatedChecks' | 'reviewStatus' | 'reviewNotes' | 'submittedAt' | 'reviewedAt'>): Promise<RegistrySubmission> {
    return this.post<RegistrySubmission>('/entries/submit', submission);
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined) url.searchParams.set(k, String(v));
      });
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new RegistryError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new RegistryError(res.status, await res.text());
    return res.json() as Promise<T>;
  }
}

export class RegistryError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Registry error ${status}: ${body}`);
  }
}

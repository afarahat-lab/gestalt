/**
 * @gestalt/cli — CLI-specific types.
 */

// ─── CLI config (stored in ~/.gestalt/config.json) ────────────────────────────

export interface CliConfig {
  serverUrl: string;         // e.g. http://localhost:3000
  token: string | null;      // JWT from last login
  currentProjectId: string | null;
}

export const DEFAULT_CLI_CONFIG: CliConfig = {
  serverUrl: 'http://localhost:3000',
  token: null,
  currentProjectId: null,
};

// ─── Init phases ──────────────────────────────────────────────────────────────

export type InitPhase =
  | 'llm-bootstrap'
  | 'intent-capture'
  | 'harness-generation'
  | 'harness-validation'
  | 'complete';

export interface InitState {
  phase: InitPhase;
  llmConfig?: {
    providerType: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  projectDescription?: string;
  extractedSpec?: Record<string, unknown>;
  confirmedSpec?: Record<string, unknown>;
}

// ─── Command options ──────────────────────────────────────────────────────────

export interface RunOptions {
  server?: string;             // one-shot --server override (not persisted)
  projectId?: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  /** Fix F — after submitting, switch to the same periodic graph
   *  re-render that `gestalt intent show --watch` uses, until the
   *  intent reaches a terminal status. */
  watch?: boolean;
}

export interface StatusOptions {
  watch?: boolean;
  interval?: number;
}

export interface LogsOptions {
  follow?: boolean;
  lines?: number;
  correlationId?: string;
}

/**
 * @gestalt/core/config
 *
 * Typed configuration loader. All environment variable access goes through
 * this module — no package reads process.env directly.
 *
 * Validates required variables at startup and throws with a clear message
 * if any are missing. No silent undefined values.
 */

export interface GestaltConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  queue: QueueConfig;
  llm: LLMConfig;
  auth: AuthConfig;
}

export interface ServerConfig {
  port: number;
  baseUrl: string;
  nodeEnv: 'development' | 'production' | 'test';
}

export interface DatabaseConfig {
  adapter: 'postgres' | 'oracle' | 'mssql';
  url: string;
}

export interface QueueConfig {
  redisUrl: string;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  /**
   * Wire shape — see `LLMApiShape` in the repository module. Optional
   * because the platform default `.env`-driven seed doesn't know
   * about per-row registry shape; clients constructed from a
   * registry row (`getLLMClientForModel`) populate it explicitly.
   * Defaults to `'chat-completions'` when unset.
   */
  apiShape?: 'chat-completions' | 'responses';
}

export interface AuthConfig {
  jwtSecret: string;
  sessionTtlMinutes: number;
}

/**
 * Loads and validates configuration from environment variables.
 * Throws GestaltConfigError with a list of all missing variables.
 * Call once at server startup.
 */
export function loadConfig(): GestaltConfig {
  const missing: string[] = [];

  function require(key: string): string {
    const val = process.env[key];
    if (!val) missing.push(key);
    return val ?? '';
  }

  function optional(key: string, defaultValue: string): string {
    return process.env[key] ?? defaultValue;
  }

  const config: GestaltConfig = {
    server: {
      port: parseInt(optional('SERVER_PORT', '3000'), 10),
      baseUrl: optional('SERVER_BASE_URL', 'http://localhost:3000'),
      nodeEnv: (optional('NODE_ENV', 'development')) as GestaltConfig['server']['nodeEnv'],
    },
    database: {
      adapter: (optional('DATABASE_ADAPTER', 'postgres')) as DatabaseConfig['adapter'],
      url: require('DATABASE_URL'),
    },
    queue: {
      redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),
    },
    llm: {
      baseUrl: require('LLM_BASE_URL'),
      apiKey: require('LLM_API_KEY'),
      model: require('LLM_MODEL'),
      timeoutMs: parseInt(optional('LLM_TIMEOUT_MS', '120000'), 10),
      maxRetries: parseInt(optional('LLM_MAX_RETRIES', '3'), 10),
    },
    auth: {
      jwtSecret: require('JWT_SECRET'),
      sessionTtlMinutes: parseInt(optional('SESSION_TTL_MINUTES', '480'), 10),
    },
  };

  if (missing.length > 0) {
    throw new GestaltConfigError(missing);
  }

  return config;
}

export class GestaltConfigError extends Error {
  constructor(public readonly missingVariables: string[]) {
    super(
      `Gestalt configuration error. Missing required environment variables:\n` +
      missingVariables.map((v) => `  - ${v}`).join('\n') +
      `\n\nCopy .env.example to .env and fill in the required values.`,
    );
    this.name = 'GestaltConfigError';
  }
}

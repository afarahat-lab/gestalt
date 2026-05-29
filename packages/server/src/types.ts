/**
 * @gestalt/server — server-specific types.
 * Types that are only relevant to the server layer.
 * Shared platform types come from @gestalt/core.
 */

import type { UserRole } from '@gestalt/core';

// ─── Platform user (server-side) ─────────────────────────────────────────────

export interface PlatformUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  authProvider: string;
  idpSubject: string;
  idpGroups: string[];
  lastLoginAt: Date;
  createdAt: Date;
}

// ─── Request context ──────────────────────────────────────────────────────────

// Extend Fastify's request type with authenticated user
declare module 'fastify' {
  interface FastifyRequest {
    user?: PlatformUser;
    correlationId: string;
  }
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Event bus (for SSE) ──────────────────────────────────────────────────────
// Canonical definition lives in @gestalt/core/events so the orchestrator
// worker can publish on the same singleton. Re-exported here for callers
// that already import from server-local types.
export type { LiveEventType, LiveEvent, EventSubscriber, EventBus } from '@gestalt/core';

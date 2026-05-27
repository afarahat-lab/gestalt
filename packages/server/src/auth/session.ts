/**
 * Session management — JWT issuance and validation.
 *
 * After any auth provider successfully authenticates a user and role mapping
 * resolves, the server issues a short-lived JWT. The dashboard uses this JWT
 * for all subsequent API calls.
 *
 * JWT payload:
 *   sub      — user ID (platform UUID, not IdP subject)
 *   email    — user email
 *   role     — resolved platform role
 *   provider — which auth provider was used
 *   iat      — issued at
 *   exp      — expiry (from config sessionTtlMinutes)
 *
 * Service account tokens (used by agents) are separate — they are API keys,
 * not JWTs, and are validated differently.
 */

import type { PlatformUser } from './types';

export interface JwtPayload {
  sub: string;            // platform user ID
  email: string;
  role: string;
  provider: string;
  iat: number;
  exp: number;
}

export interface SessionConfig {
  jwtSecret: string;
  sessionTtlMinutes: number;
}

/**
 * Issues a signed JWT for an authenticated platform user.
 * Phase 2: use jsonwebtoken or jose library.
 */
export function issueToken(user: PlatformUser, config: SessionConfig): string {
  // Phase 2:
  // const payload: JwtPayload = {
  //   sub: user.id,
  //   email: user.email,
  //   role: user.role,
  //   provider: user.authProvider,
  //   iat: Math.floor(Date.now() / 1000),
  //   exp: Math.floor(Date.now() / 1000) + config.sessionTtlMinutes * 60,
  // };
  // return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256' });
  throw new Error('issueToken not yet implemented — pending Phase 2');
}

/**
 * Validates a JWT and returns its payload.
 * Throws if the token is invalid, expired, or tampered with.
 */
export function verifyToken(token: string, config: SessionConfig): JwtPayload {
  // Phase 2:
  // return jwt.verify(token, config.jwtSecret) as JwtPayload;
  throw new Error('verifyToken not yet implemented — pending Phase 2');
}

/**
 * Extracts a token from a request's Authorization header or cookie.
 * Returns null if no token is present — not an error.
 */
export function extractToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const authHeader = headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // Also check query param for SSE connections (EventSource can't set headers)
  return null;
}

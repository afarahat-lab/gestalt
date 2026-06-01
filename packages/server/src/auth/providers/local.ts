/**
 * Local username/password fallback provider.
 *
 * Looks up the local_auth row by email and verifies the password with bcrypt.
 * Returns a VerifiedIdentity on success; throws AuthenticationError on
 * wrong credentials so the auth manager can map it to a 401.
 *
 * Non-production only — refuses to run when NODE_ENV=production unless the
 * harness has explicitly opted in via allowedInProduction.
 */
import bcrypt from 'bcrypt';
import { getRepositories, createContextLogger } from '@gestalt/core';
import type { AuthProvider, LocalAuthConfig, VerifiedIdentity, IncomingRequest, OutgoingResponse } from '../types';
import { AuthenticationError } from '../auth-manager';

const log = createContextLogger({ module: 'auth:local' });

export class LocalProvider implements AuthProvider {
  readonly type = 'local' as const;

  constructor(private readonly config: LocalAuthConfig) {
    if (process.env['NODE_ENV'] === 'production' && !config.allowedInProduction) {
      log.warn('Local auth is enabled but NODE_ENV=production — will be rejected at runtime');
    }
  }

  canHandle(req: IncomingRequest): boolean {
    return req.method === 'POST' && req.url.endsWith('/auth/login');
  }

  async authenticate(req: IncomingRequest, _res: OutgoingResponse): Promise<VerifiedIdentity | null> {
    if (process.env['NODE_ENV'] === 'production' && !this.config.allowedInProduction) {
      throw new AuthenticationError(
        'Local authentication is disabled in production.',
        'LOCAL_IN_PRODUCTION',
      );
    }

    const body = req.body as { email?: string; password?: string } | null;
    if (!body?.email || !body?.password) return null;

    const email = body.email.trim().toLowerCase();
    const { localAuth, users } = getRepositories();

    const credential = await localAuth.findByEmail(email);
    if (!credential) {
      log.info({ email }, 'Local auth: unknown email');
      throw new AuthenticationError('Invalid email or password.', 'PROVIDER_ERROR');
    }

    const passwordValid = await bcrypt.compare(body.password, credential.passwordHash);
    if (!passwordValid) {
      log.info({ email }, 'Local auth: wrong password');
      throw new AuthenticationError('Invalid email or password.', 'PROVIDER_ERROR');
    }

    const user = await users.findById(credential.userId);
    if (!user) {
      // Should never happen — local_auth has an ON DELETE CASCADE FK to users.
      log.error({ userId: credential.userId }, 'Local auth credential without user row');
      throw new AuthenticationError('Account is in an invalid state.', 'PROVIDER_ERROR');
    }

    if (user.deactivatedAt) {
      log.info({ email, userId: user.id }, 'Local auth: deactivated user attempted login');
      throw new AuthenticationError('Account has been deactivated.', 'ACCESS_DENIED');
    }

    return {
      subject: email,
      email: user.email,
      displayName: user.displayName,
      groups: [],
      provider: 'local',
    };
  }
}

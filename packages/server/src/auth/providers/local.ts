/**
 * LOCAL authentication provider.
 * Local username/password fallback provider.
 * Development and pre-IdP adoption only. Always shows non-production warning.
 *
 * Implementation notes:
 * - bcrypt password hashing — never store plaintext
 * Passwords set via agentforge admin user-create CLI command
 * allowedInProduction is always false — enforced in code, not just config
 * Shows warning banner in dashboard when active
 * First admin user created via agentforge init local-admin command
 *
 * Full implementation: Phase 2.
 */
import type { AuthProvider, VerifiedIdentity, IncomingRequest, OutgoingResponse } from '../types';

export class LocalProvider implements AuthProvider {
  readonly type = 'local' as const;

  canHandle(_req: IncomingRequest): boolean {
    throw new Error('LocalProvider.canHandle not yet implemented — pending Phase 2');
  }

  async authenticate(
    _req: IncomingRequest,
    _res: OutgoingResponse,
  ): Promise<VerifiedIdentity | null> {
    throw new Error('LocalProvider.authenticate not yet implemented — pending Phase 2');
  }
}

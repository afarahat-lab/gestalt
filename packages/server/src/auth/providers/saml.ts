/**
 * SAML authentication provider.
 * SAML 2.0 authentication provider.
 * Used with ADFS, on-premise Active Directory, and any SAML-compliant IdP.
 *
 * Implementation notes:
 * - passport-saml or @node-saml/node-saml for token validation
 * SP metadata generated at init and served at /auth/saml/metadata
 * ACS callback at /auth/saml/callback
 * Groups extracted from SAML attributes (configurable attribute name)
 * On success: VerifiedIdentity returned, redirect to dashboard
 *
 * Full implementation: Phase 2.
 */
import type { AuthProvider, VerifiedIdentity, IncomingRequest, OutgoingResponse } from '../types';

export class SamlProvider implements AuthProvider {
  readonly type = 'saml' as const;

  canHandle(_req: IncomingRequest): boolean {
    throw new Error('SamlProvider.canHandle not yet implemented — pending Phase 2');
  }

  async authenticate(
    _req: IncomingRequest,
    _res: OutgoingResponse,
  ): Promise<VerifiedIdentity | null> {
    throw new Error('SamlProvider.authenticate not yet implemented — pending Phase 2');
  }
}

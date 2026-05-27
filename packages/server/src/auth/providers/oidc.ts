/**
 * OIDC authentication provider.
 * OpenID Connect authentication provider.
 * Used with Azure AD/Entra ID, Okta, and any OIDC-compliant IdP.
 *
 * Implementation notes:
 * - openid-client library for OIDC flow
 * Authorization code flow with PKCE
 * Callback at /auth/oidc/callback
 * Groups from 'groups' claim in ID token (Azure AD requires group claims configured)
 * On success: VerifiedIdentity returned, redirect to dashboard
 *
 * Full implementation: Phase 2.
 */
import type { AuthProvider, VerifiedIdentity, IncomingRequest, OutgoingResponse } from '../types';

export class OidcProvider implements AuthProvider {
  readonly type = 'oidc' as const;

  canHandle(_req: IncomingRequest): boolean {
    throw new Error('OidcProvider.canHandle not yet implemented — pending Phase 2');
  }

  async authenticate(
    _req: IncomingRequest,
    _res: OutgoingResponse,
  ): Promise<VerifiedIdentity | null> {
    throw new Error('OidcProvider.authenticate not yet implemented — pending Phase 2');
  }
}

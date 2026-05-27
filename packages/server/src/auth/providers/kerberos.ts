/**
 * Windows Kerberos / SPNEGO authentication provider.
 *
 * Enables seamless single sign-on for domain-joined Windows users.
 * Users on domain-joined machines are authenticated automatically via
 * their Windows login session — no username, no password, no redirect.
 *
 * How it works:
 *   1. Server sends WWW-Authenticate: Negotiate challenge
 *   2. Browser responds with Authorization: Negotiate <SPNEGO token>
 *   3. Server validates the Kerberos ticket against the AD/KDC
 *   4. User identity extracted from ticket (UPN, group memberships via LDAP)
 *   5. Platform JWT issued
 *
 * Prerequisites (one-time IT setup):
 *   - Server registered as SPN in Active Directory:
 *     setspn -A HTTP/agentforge.company.com DOMAIN\serviceaccount
 *   - Service account keytab file placed at path configured in HARNESS.json
 *   - DNS A record for agentforge.company.com pointing to server
 *
 * Browser compatibility:
 *   - Chrome/Edge on Windows domain machines: automatic (no prompt)
 *   - Firefox: requires network.negotiate-auth.trusted-uris configured
 *   - Safari on macOS joined to domain: supported
 *   - Non-domain machines: falls through to next provider
 *
 * Phase 2: full implementation using kerberos npm package + ldapjs for group lookup.
 */

import type {
  AuthProvider, WindowsKerberosConfig,
  VerifiedIdentity, IncomingRequest, OutgoingResponse,
} from '../types';

export class WindowsKerberosProvider implements AuthProvider {
  readonly type = 'windows-kerberos' as const;

  constructor(private readonly config: WindowsKerberosConfig) {}

  /**
   * Returns true if the request contains a Negotiate authorization header.
   * This means the browser is attempting Kerberos/NTLM authentication.
   */
  canHandle(req: IncomingRequest): boolean {
    const authHeader = req.headers['authorization'];
    return (
      typeof authHeader === 'string' &&
      authHeader.toLowerCase().startsWith('negotiate ')
    );
  }

  /**
   * Validates the SPNEGO token and extracts user identity.
   *
   * Phase 2 implementation steps:
   *   1. Extract base64 SPNEGO token from Authorization header
   *   2. Use kerberos.authUserKrb5Password() or GSS-API to validate ticket
   *   3. Extract UPN (user@COMPANY.COM) from the validated ticket
   *   4. Query LDAP/AD for user's group memberships
   *   5. Return VerifiedIdentity
   *
   * If the token is present but invalid → throw AuthenticationError
   * If the token requires continuation (NTLM multi-step) → handle negotiate exchange
   */
  async authenticate(
    _req: IncomingRequest,
    _res: OutgoingResponse,
  ): Promise<VerifiedIdentity | null> {
    // Phase 2:
    // const { kerberos } = await import('kerberos');
    // const { ldap } = await import('ldapjs');
    //
    // const token = extractNegotiateToken(req.headers['authorization']);
    // const result = await kerberos.checkPassword(token, this.config.spn, this.config.realm);
    // const upn = result.username;  // user@COMPANY.COM
    // const groups = await fetchAdGroups(upn, this.config);
    //
    // return {
    //   subject: upn,
    //   email: upn.toLowerCase(),
    //   displayName: await fetchDisplayName(upn, this.config),
    //   groups,
    //   provider: 'windows-kerberos',
    // };
    throw new Error('WindowsKerberosProvider not yet implemented — pending Phase 2');
  }
}

/**
 * Sends the WWW-Authenticate: Negotiate challenge to initiate Kerberos negotiation.
 * Called when a request arrives without an Authorization header on a protected route.
 */
export function sendNegotiateChallenge(
  headers: Record<string, string>,
): Record<string, string> {
  return {
    ...headers,
    'WWW-Authenticate': 'Negotiate',
  };
}

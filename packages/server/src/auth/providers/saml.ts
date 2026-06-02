/**
 * SAML 2.0 authentication provider (ADR-024 priority 2).
 *
 * Acts as a SAML Service Provider (SP). Used with ADFS, on-premise
 * Active Directory Federation, Okta, PingFederate, and any
 * SAML-compliant IdP.
 *
 * Flow:
 *   1. Dashboard `Sign in with Corporate SSO` button hits
 *      `GET /auth/saml/login?relay=<path>` → server redirects to
 *      `entryPoint` with a fresh SAMLRequest
 *   2. User authenticates at the IdP
 *   3. IdP posts the SAMLResponse to our ACS:
 *      `POST /auth/saml/callback`
 *   4. SP validates the signed assertion (using the IdP `cert`),
 *      extracts attributes, returns `VerifiedIdentity`
 *   5. Route layer issues a JWT and redirects to `/app/?token=<jwt>`
 *
 * SP metadata is exposed at `GET /auth/saml/metadata` — operators
 * give the URL to corporate IT for IdP-side configuration.
 *
 * Implementation: `@node-saml/node-saml` v4 — the maintained
 * successor to the deprecated `passport-saml`. Used directly
 * without the full Passport middleware stack.
 */

import { SAML } from '@node-saml/node-saml';
import type {
  AuthProvider, SamlConfig,
  VerifiedIdentity, IncomingRequest, OutgoingResponse,
} from '../types';
import { AuthenticationError } from '../auth-manager';
import { createContextLogger } from '@gestalt/core';

const log = createContextLogger({ module: 'auth:saml' });

/**
 * Attribute mapping — surfaces the SAML claim names for the
 * `email` / `displayName` / `groups` fields. Defaults match Azure
 * AD's SAML claim URIs (which most ADFS deployments inherited).
 * Operators override per-IdP via the `attributeMapping` block in
 * `auth.config.json`.
 */
const DEFAULT_ATTRIBUTE_MAPPING = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  displayName: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/displayname',
  groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
};

/**
 * The wider config shape (post-ADR-040). The legacy `SamlConfig`
 * type doesn't carry `attributeMapping` or `wantAssertionsSigned`;
 * the provider reads them off the supplied object directly.
 */
interface SamlConfigExt extends SamlConfig {
  attributeMapping?: Partial<typeof DEFAULT_ATTRIBUTE_MAPPING>;
  wantAssertionsSigned?: boolean;
  identifierFormat?: string;
}

export class SamlProvider implements AuthProvider {
  readonly type = 'saml' as const;
  private readonly saml: SAML;
  private readonly attributeMapping: typeof DEFAULT_ATTRIBUTE_MAPPING;

  constructor(config: SamlConfigExt) {
    this.saml = new SAML({
      entryPoint: config.entryPoint,
      issuer: config.issuer,
      cert: config.cert,
      callbackUrl: config.callbackUrl,
      wantAssertionsSigned: config.wantAssertionsSigned ?? true,
      ...(config.identifierFormat ? { identifierFormat: config.identifierFormat } : {}),
    });
    this.attributeMapping = { ...DEFAULT_ATTRIBUTE_MAPPING, ...(config.attributeMapping ?? {}) };
  }

  /**
   * SAML provider handles a POST to the ACS endpoint carrying a
   * SAMLResponse body field. Login URL generation + metadata are
   * separate route handlers (this method is invoked by the
   * AuthManager only for the assertion-validation flow).
   */
  canHandle(req: IncomingRequest): boolean {
    if (req.method !== 'POST') return false;
    if (!req.url.includes('/auth/saml/callback')) return false;
    const body = req.body as Record<string, unknown> | null;
    return Boolean(body && typeof body['SAMLResponse'] === 'string');
  }

  async authenticate(
    req: IncomingRequest,
    _res: OutgoingResponse,
  ): Promise<VerifiedIdentity | null> {
    const body = req.body as Record<string, string> | null;
    if (!body?.['SAMLResponse']) return null;

    let result: { profile: Record<string, unknown> | null };
    try {
      result = await this.saml.validatePostResponseAsync({
        SAMLResponse: body['SAMLResponse'],
        RelayState: body['RelayState'],
      });
    } catch (err) {
      log.warn({ err }, 'SAML response validation failed');
      throw new AuthenticationError(
        `SAML validation failed: ${(err as Error).message ?? String(err)}`,
        'INVALID_TOKEN',
      );
    }

    if (!result.profile) {
      throw new AuthenticationError('SAML assertion empty', 'INVALID_TOKEN');
    }
    const profile = result.profile;

    const email = pickString(profile, this.attributeMapping.email)
      ?? pickString(profile, 'nameID')
      ?? '';
    if (!email) {
      throw new AuthenticationError(
        'SAML assertion missing email attribute',
        'INVALID_TOKEN',
      );
    }
    const displayName = pickString(profile, this.attributeMapping.displayName) ?? email;
    const groups = pickGroups(profile, this.attributeMapping.groups);
    const subject = pickString(profile, 'nameID') ?? email;

    return {
      subject,
      email: email.toLowerCase(),
      displayName,
      groups,
      provider: 'saml',
    };
  }

  /**
   * Returns the IdP SSO URL to redirect the browser to. Called by
   * the `GET /auth/saml/login` route handler. `relayState` is
   * round-tripped through the IdP and arrives back on the ACS so
   * the post-auth redirect can land on the user's original target.
   */
  async getLoginUrl(relayState?: string): Promise<string> {
    return this.saml.getAuthorizeUrlAsync(
      relayState ?? '/app/',
      'POST',
      {},
    );
  }

  /**
   * Returns the SAML SP metadata XML. Operators serve at
   * `GET /auth/saml/metadata` and provide the URL to corporate IT
   * for IdP-side Relying Party / Service Provider configuration.
   */
  getMetadata(): string {
    return this.saml.generateServiceProviderMetadata(null);
  }
}

function pickString(profile: Record<string, unknown>, key: string): string | undefined {
  const v = profile[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

function pickGroups(profile: Record<string, unknown>, key: string): string[] {
  const v = profile[key];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return [v];
  return [];
}

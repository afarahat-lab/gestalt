/**
 * Server-side Git provider proxy for the dashboard / CLI repo browser.
 *
 *   GET /platform/git/repos?secretId=<uuid>&provider=github
 *
 * Decrypts the named vault secret server-side and calls the provider's
 * REST API to list the operator's accessible repositories. The
 * decrypted token NEVER crosses the response boundary — the dashboard
 * receives only the repo metadata.
 *
 * Today only GitHub is supported (the only adapter the deploy layer
 * actually drives end-to-end). GitLab / Azure DevOps / Bitbucket can
 * be added by extending the `provider` query param without changing
 * the client interface — the response shape is provider-neutral.
 *
 * Auth: `requireRole('operator')` — anyone who can register a project
 * (any authenticated user with editor+ membership on a project) can
 * browse repos via a secret they have access to.
 */

import type { FastifyInstance } from 'fastify';
import {
  getRepositories, createContextLogger,
  decryptSecret,
} from '@gestalt/core';
import { getMasterKey } from '../secrets/index';
import { requireRole } from '../auth/middleware';

const log = createContextLogger({ module: 'routes:git-repos' });

const SUPPORTED_PROVIDERS = ['github'] as const;
type SupportedProvider = typeof SUPPORTED_PROVIDERS[number];

const GITHUB_REPOS_URL =
  'https://api.github.com/user/repos?sort=updated&direction=desc&per_page=100';

interface GitRepoSummary {
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
}

interface GitHubRepoApi {
  name?: unknown;
  full_name?: unknown;
  html_url?: unknown;
  clone_url?: unknown;
  default_branch?: unknown;
  private?: unknown;
  description?: unknown;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function normaliseGitHub(repos: GitHubRepoApi[]): GitRepoSummary[] {
  return repos
    .filter((r) => typeof r === 'object' && r !== null)
    .map<GitRepoSummary>((r) => ({
      name: asString(r.name),
      fullName: asString(r.full_name),
      htmlUrl: asString(r.html_url),
      cloneUrl: asString(r.clone_url),
      defaultBranch: asString(r.default_branch, 'main'),
      private: Boolean(r.private),
      description: typeof r.description === 'string' ? r.description : null,
    }));
}

export async function registerGitReposRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { secretId?: string; provider?: string } }>(
    '/platform/git/repos',
    { preHandler: requireRole('operator') },
    async (request, reply) => {
      const secretId = request.query.secretId?.trim();
      const provider = (request.query.provider?.trim() ?? 'github') as SupportedProvider;

      if (!secretId) {
        return reply.code(400).send({
          error: 'secretId is required',
          code: 'SECRET_ID_REQUIRED',
        });
      }

      if (!SUPPORTED_PROVIDERS.includes(provider)) {
        return reply.code(400).send({
          error: `Unsupported provider '${provider}'. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`,
          code: 'UNSUPPORTED_PROVIDER',
        });
      }

      const { platformSecrets } = getRepositories();
      const secret = await platformSecrets.findById(secretId);
      if (!secret) {
        return reply.code(404).send({
          error: `Vault secret '${secretId}' not found`,
          code: 'SECRET_NOT_FOUND',
        });
      }

      let token: string;
      try {
        token = decryptSecret(
          { encrypted: secret.encrypted, iv: secret.iv, authTag: secret.authTag },
          getMasterKey(),
        );
      } catch (err) {
        log.warn({ err, secretId }, 'Secret decrypt failed');
        return reply.code(400).send({
          error: 'Failed to decrypt vault secret. Check the master key configuration.',
          code: 'SECRET_DECRYPT_FAILED',
        });
      }

      if (provider === 'github') {
        try {
          const res = await fetch(GITHUB_REPOS_URL, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'gestalt-platform',
            },
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            // Parse GitHub's error JSON if possible — the `message`
            // field carries actionable text (e.g. "Bad credentials").
            let providerMessage = errBody;
            try {
              const parsed = JSON.parse(errBody) as { message?: string };
              if (typeof parsed.message === 'string') providerMessage = parsed.message;
            } catch { /* keep raw body */ }
            log.warn({ status: res.status, secretId }, 'GitHub repos request failed');
            return reply.code(400).send({
              error: `GitHub API error: ${providerMessage || `HTTP ${res.status}`}`,
              code: 'PROVIDER_ERROR',
              providerStatus: res.status,
            });
          }
          const json = (await res.json()) as GitHubRepoApi[];
          const data = normaliseGitHub(Array.isArray(json) ? json : []);
          log.info({ secretId, repoCount: data.length }, 'Listed Git repos');
          return reply.send({ data });
        } catch (err) {
          log.error({ err, secretId }, 'GitHub repos fetch failed');
          return reply.code(502).send({
            error: 'Failed to contact GitHub API',
            code: 'PROVIDER_UNREACHABLE',
            details: err instanceof Error ? err.message : String(err),
          });
        } finally {
          // Defensive — drop the decrypted token from the local
          // variable so a future stack-frame inspector can't read
          // it. V8 may inline-cache regardless, but this signals
          // intent at the source level.
          token = '';
        }
      }

      // Unreachable today; the provider check above is exhaustive.
      return reply.code(500).send({ error: 'Provider handler missing' });
    },
  );
}

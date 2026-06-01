/**
 * Centralised "cannot reach server" message used by every CLI command that
 * touches the API. Keeps the wording consistent and ensures the URL the
 * command actually tried is surfaced (the most common misconfiguration is
 * a remote-server install where the user forgot to point the CLI at it).
 */

import { c, blank } from './prompts';
import { isDefaultServerUrl } from './config';

/**
 * Heuristic for "the network call failed because the server is unreachable",
 * not "the server responded with an HTTP error." Anything that surfaces as
 * `ApiClientError` reached the server; anything raised by `fetch` itself
 * (DNS, refused connection, TLS) is a connectivity issue and should be
 * presented with the attempted URL.
 */
export function isConnectivityError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'ApiClientError') return false;
  const code = (err as { code?: string }).code
    ?? (err as { cause?: { code?: string } }).cause?.code;
  if (code && ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET'].includes(code)) {
    return true;
  }
  return /fetch failed|ECONNREFUSED|ENOTFOUND|getaddrinfo|network/i.test(err.message);
}

/**
 * Render the connection-error block. Always shows the URL the command was
 * trying to hit. When that URL is still the local-dev default, append the
 * first-run hint nudging the user to configure a remote server.
 */
/**
 * Tries to parse the server's typed 403 body
 * (`{ error, code, message }`) carried inside `ApiClientError.body`.
 * Returns null when the error isn't a 403 or the body isn't JSON in
 * the expected shape. Callers use this to render friendly hints for
 * the project-membership 403 codes (NOT_PROJECT_MEMBER /
 * INSUFFICIENT_PROJECT_ROLE) without each command duplicating the
 * JSON-parse boilerplate.
 */
export function parseForbiddenBody(err: unknown): { code: string; message: string } | null {
  if (!(err instanceof Error) || err.name !== 'ApiClientError') return null;
  const status = (err as { status?: number }).status;
  if (status !== 403) return null;
  const body = (err as { body?: string }).body;
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown; error?: unknown };
    const code = typeof parsed.code === 'string' ? parsed.code : null;
    const message = typeof parsed.message === 'string'
      ? parsed.message
      : (typeof parsed.error === 'string' ? parsed.error : null);
    if (!code || !message) return null;
    return { code, message };
  } catch {
    return null;
  }
}

/**
 * Friendly handler for the two project-membership 403 codes raised by
 * `requireProjectMembership` on the server. Prints a contextual hint
 * and returns true so the caller knows the error was rendered (it
 * should not also print a generic "Failed:" line). Returns false for
 * anything else.
 */
export function handleMembershipForbidden(err: unknown): boolean {
  const parsed = parseForbiddenBody(err);
  if (!parsed) return false;
  if (parsed.code === 'NOT_PROJECT_MEMBER') {
    console.log(c.error('✗ You are not a member of this project.'));
    console.log(c.dim('  Ask a platform-admin or project-admin to assign you:'));
    console.log(c.dim('    gestalt users assign <your-email> <project> --role editor'));
    return true;
  }
  if (parsed.code === 'INSUFFICIENT_PROJECT_ROLE') {
    console.log(c.error(`✗ ${parsed.message}`));
    console.log(c.dim('  Ask a platform-admin or project-admin to upgrade your role.'));
    return true;
  }
  return false;
}

export function printConnectionError(url: string): void {
  console.log(c.error(`✗ Cannot reach server at ${url}`));
  console.log(c.dim('  Check the server is running and the URL is correct.'));
  console.log(c.dim(`  Current server: ${url}`));
  console.log(c.dim('  To change: gestalt config set-server <url>'));
  if (isDefaultServerUrl(url)) {
    blank();
    console.log(c.dim('  If your Gestalt server is running on a different machine, set the URL first:'));
    console.log(c.dim('    gestalt config set-server https://gestalt.company.com'));
    console.log(c.dim('    gestalt login'));
  }
}

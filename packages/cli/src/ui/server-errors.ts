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

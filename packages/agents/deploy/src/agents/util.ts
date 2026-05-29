/**
 * Shared helpers for the deploy-layer agents.
 */

/**
 * Embeds a Git personal access token into an HTTPS clone URL.
 * Mirrors the helper in the generate and gate orchestrators — same
 * `x-access-token` convention.
 */
export function authenticatedGitUrl(gitUrl: string, token: string): string {
  if (!gitUrl.startsWith('http://') && !gitUrl.startsWith('https://')) {
    return gitUrl;
  }
  const url = new URL(gitUrl);
  url.username = 'x-access-token';
  url.password = token;
  return url.toString();
}

/**
 * Builds a stable, git-safe branch name from the correlation id and
 * intent text: `gestalt/<corr8>-<slug>`. The slug is the first 5 words
 * of the intent, kebab-cased, capped at 40 characters.
 */
export function branchNameFor(correlationId: string, intentText: string): string {
  const slug = (intentText ?? '')
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 5)
    .join('-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const head = correlationId.slice(0, 8);
  return slug ? `gestalt/${head}-${slug}` : `gestalt/${head}`;
}

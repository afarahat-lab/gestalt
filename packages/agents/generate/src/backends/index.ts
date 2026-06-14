/**
 * Code-agent backend registry + default-verification resolver.
 *
 * The platform calls `getCodeAgentBackend(name)` to resolve which
 * backend handles the code-agent step for a project. Adding a new
 * backend is: implement `CodeAgentBackend` in a new file under
 * `backends/`, register it here. The orchestrator never references
 * specific backends.
 *
 * `resolveVerification(stack, harnessConfig)` picks the verification
 * commands a project's code-agent should run after each edit. Explicit
 * `HARNESS.codeGeneration.verification` overrides; absent → derive
 * from `HARNESS.stack`. This is the ONE place the platform knows that
 * "npm test" is the default for Node — and it's behind a sensible-
 * default helper, not baked into a tool-specific code path.
 */

import type {
  CodeAgentBackend, CodeAgentContext,
} from './types';
import { aiderBackend } from './aider-backend';

/**
 * Narrow structural input for `resolveVerification`. Accepts either
 * core's `HarnessConfig` or generate's local mirror — both carry the
 * fields this helper reads, neither needs to import the other. Keeps
 * the helper boundary clean.
 */
interface VerificationInput {
  stack?: Record<string, string>;
  codeGeneration?: {
    backend?: string;
    verification?: {
      buildCmd?: string;
      testCmd?: string;
      lintCmd?: string;
    };
  };
}

export type {
  CodeAgentBackend, CodeAgentContext,
  CodeAgentResult,
} from './types';

/**
 * Registry of all known backends keyed by `HARNESS.codeGeneration.backend`.
 * Lookup is exact-match; an unknown name throws at boot so a typo in
 * HARNESS surfaces immediately, not as a silent fall-back.
 *
 * `'gestalt'` is deliberately absent — the legacy Gestalt-native
 * code-agent doesn't implement this interface (it predates the
 * refactor and runs through the LLM client directly). The
 * orchestrator branches on `backend === 'aider'` to choose the
 * backend path vs the legacy path; this registry only fields the
 * external-tool backends. When Qodo Gen / Claude Code / Cursor land,
 * each registers a new entry here.
 */
const BACKENDS: Record<string, CodeAgentBackend> = {
  aider: aiderBackend,
};

/**
 * Resolve the backend by name. Throws on unknown name with a clear
 * error so HARNESS typos surface immediately.
 */
export function getCodeAgentBackend(name: string): CodeAgentBackend {
  const backend = BACKENDS[name];
  if (!backend) {
    throw new Error(
      `Unknown code-agent backend '${name}'. Known: ${Object.keys(BACKENDS).join(', ')}`,
    );
  }
  return backend;
}

/**
 * Resolve the verification block the backend should run with.
 * Precedence:
 *   1. Explicit `HARNESS.codeGeneration.verification` — operator
 *      override; treated as authoritative. An empty string in a
 *      field means "skip this step", NOT "use default".
 *   2. Stack-derived defaults — sensible commands for known
 *      `stack.language` + `stack.packageManager` combinations.
 *   3. Empty object — the backend runs without verification (legacy
 *      behaviour pre-refactor).
 *
 * The defaults are intentionally narrow: they cover the four
 * language stacks the platform supports today (Node, Python, Go,
 * Java/Maven) and skip anything else rather than guessing. Operators
 * with unusual setups set `verification` explicitly in HARNESS.
 */
export function resolveVerification(
  harnessConfig?: VerificationInput,
): CodeAgentContext['verification'] {
  const explicit = harnessConfig?.codeGeneration?.verification;
  if (explicit) return explicit;

  const stack = harnessConfig?.stack ?? {};
  const language = (stack['language'] ?? '').toLowerCase();
  const packageManager = (stack['packageManager'] ?? '').toLowerCase();

  // Node — npm / pnpm / yarn.
  if (
    language === 'typescript' || language === 'javascript' ||
    language === 'node'       || language === 'nodejs'
  ) {
    if (packageManager === 'pnpm') {
      return { buildCmd: 'pnpm build', testCmd: 'pnpm test' };
    }
    if (packageManager === 'yarn') {
      return { buildCmd: 'yarn build', testCmd: 'yarn test' };
    }
    // Default Node → npm.
    return { buildCmd: 'npm run build', testCmd: 'npm test' };
  }

  // Python.
  if (language === 'python') {
    return { testCmd: 'pytest -q' };
  }

  // Go.
  if (language === 'go' || language === 'golang') {
    return { buildCmd: 'go build ./...', testCmd: 'go test ./...' };
  }

  // Java + Maven.
  if (language === 'java' && (packageManager === 'maven' || packageManager === 'mvn')) {
    return { buildCmd: 'mvn -B compile', testCmd: 'mvn -B test' };
  }

  // Unknown stack → no defaults. Operator sets explicitly in HARNESS.
  return {};
}

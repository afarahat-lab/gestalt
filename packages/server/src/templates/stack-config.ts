/**
 * Dynamic stack config (Session 2026-06-04 — LLM-generated harness).
 *
 * At `gestalt init` time the platform asks the LLM to look at the
 * project description and decide the stack: language, runtime,
 * package manager, test framework, CI setup steps, etc. The result
 * drives `{{placeholder}}` substitution in the four template files
 * (gestalt.yml / HARNESS.json / ARCHITECTURE.md / agents.yaml).
 *
 * Contract:
 *   - `generateStackConfig` NEVER throws. On LLM call failure or
 *     parse failure it returns a copy of `DEFAULT_STACK_CONFIG` so
 *     `init-harness` always completes — operators never see a
 *     "stack generation failed" error
 *   - Decisions are deterministic: temperature 0.1, ≤1000 tokens
 *   - `stackSection` + `agentPromptExtensionsYaml` are PRE-RENDERED
 *     here so the engine just runs a flat string substitution
 *     (the current `{{name}}`-only engine doesn't support
 *     `{{#if}}` blocks)
 *   - Stack config is NOT persisted in any DB column — the
 *     committed harness files in the project repo are the
 *     authoritative record
 */

import { getLLMClient, extractJsonObject, createContextLogger } from '@gestalt/core';

const log = createContextLogger({ module: 'stack-config' });

export interface StackConfig {
  /** 'TypeScript' | 'Python' | 'Go' | 'Java' | 'Rust' | ... */
  language: string;
  /** '22' | '20' | '18' for Node projects; null for non-Node. */
  nodeVersion: string | null;
  /** 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'go' | 'cargo' */
  packageManager: string;
  /** Exact CI install command — drives the `{{installCmd}}` placeholder. */
  installCmd: string;
  /** Exact test command for both CI + local dev. */
  testCmd: string;
  /**
   * Lint command (ADR-041 — CI is the primary lint owner now that
   * the Gestalt LLM gate stopped running lint pre-push). Defaults to
   * a no-op echo when the stack has no standard linter so the workflow
   * still compiles.
   */
  lintCmd: string;
  /** Build command (TypeScript compile, Go build, etc.) or null. */
  buildCmd: string | null;
  /** 'Jest' | 'Vitest' | 'pytest' | 'JUnit' | 'go test' */
  testFramework: string;
  /** Backend framework: 'Express' | 'Fastify' | 'FastAPI' | 'Spring' | null */
  framework: string | null;
  /** Frontend: 'React' | 'Vue' | 'Next.js' | 'React Native' | null */
  frontend: string | null;
  /** Database: 'PostgreSQL' | 'MySQL' | 'MongoDB' | 'SQLite' | null */
  database: string | null;
  /** Markdown directory tree describing the source layout. */
  moduleStructure: string;
  /** 2-3 sentence prose architecture overview. */
  architectureNotes: string;
  /** Stack-specific coding conventions injected into agents.yaml. */
  agentPromptExtensions: string[];
  /**
   * Multi-line YAML snippet for the CI workflow's setup steps
   * (replaces setup-node + install). Each item is its own
   * `- ...` block; the engine substitutes the whole thing into the
   * `{{ciSetupSteps}}` placeholder INSIDE the `steps:` array.
   */
  ciSetupSteps: string;
  /**
   * Pre-rendered markdown for the ARCHITECTURE.md Stack section.
   * Produced by `parseStackConfig` from the structured fields so
   * the template engine doesn't need `{{#if}}` conditional blocks.
   */
  stackSection: string;
  /**
   * Pre-rendered YAML lines for `agents.yaml`
   * `code-agent.prompt_extensions`. When the extension list is
   * empty, renders as `      []` (a single inline empty array
   * literal at the right indentation).
   */
  agentPromptExtensionsYaml: string;
}

const DEFAULT_AGENT_PROMPT_EXTENSIONS: string[] = [
  'Always add a JSDoc comment to every exported function',
  'Use Result<T,E> pattern for error handling',
];

const DEFAULT_MODULE_STRUCTURE =
  'src/\n  modules/\n  shared/\n    utils/\n    types/\n__tests__/';

const DEFAULT_ARCHITECTURE_NOTES =
  'TypeScript application using pnpm for dependency management and Vitest for tests. ' +
  'Modular monolith layout — feature modules under src/modules, shared utilities under src/shared.';

/**
 * Strip the common leading-whitespace prefix from every non-blank
 * line. Robust against the LLM emitting an over-indented block
 * (e.g. when it copied an existing template literally and the
 * outer formatter added 6 spaces). Pairs with `indentSteps` —
 * strip first, then re-apply uniform 6-space indent.
 */
function stripIndent(raw: string): string {
  const lines = raw.split('\n');
  const indents = lines
    .filter((l) => l.trim() !== '')
    .map((l) => l.match(/^(\s*)/)?.[1].length ?? 0);
  if (indents.length === 0) return raw;
  const min = Math.min(...indents);
  if (min === 0) return raw;
  return lines.map((l) => (l.length >= min ? l.slice(min) : l)).join('\n');
}

/**
 * Indent every non-blank line by 6 spaces — the depth `steps:`
 * items live at in the GitHub Actions workflow template. The
 * template's `{{ciSetupSteps}}` placeholder is at column 0 (no
 * leading whitespace) so the substituted block carries its own
 * indentation. Without this each continuation line would land at
 * column 0 and break the YAML structure.
 *
 * Trims trailing whitespace per line. Blank lines stay blank so
 * the resulting YAML still has the section breaks the LLM emitted.
 */
function indentSteps(raw: string): string {
  return raw
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `      ${line.trimEnd()}`))
    .join('\n');
}

const DEFAULT_CI_SETUP_STEPS = indentSteps(
  [
    "- uses: actions/setup-node@v4",
    "  with:",
    "    node-version: '22'",
    "- uses: pnpm/action-setup@v3",
    "  with:",
    "    version: 9",
    "- run: pnpm install --frozen-lockfile",
  ].join('\n'),
);

/**
 * Safe defaults — copied (NOT referenced) by `generateStackConfig`
 * on any failure path. Renders a working TypeScript/Node 22/pnpm
 * project. `stackSection` + `agentPromptExtensionsYaml` are
 * pre-rendered here so the engine has ready-to-substitute strings.
 */
export const DEFAULT_STACK_CONFIG: StackConfig = {
  language: 'TypeScript',
  nodeVersion: '22',
  packageManager: 'pnpm',
  installCmd: 'pnpm install --frozen-lockfile',
  testCmd: 'pnpm test',
  lintCmd: 'pnpm run lint',
  buildCmd: 'pnpm run build',
  testFramework: 'Vitest',
  framework: null,
  frontend: null,
  database: null,
  moduleStructure: DEFAULT_MODULE_STRUCTURE,
  architectureNotes: DEFAULT_ARCHITECTURE_NOTES,
  agentPromptExtensions: DEFAULT_AGENT_PROMPT_EXTENSIONS,
  ciSetupSteps: DEFAULT_CI_SETUP_STEPS,
  stackSection: renderStackSection({
    nodeVersion: '22',
    packageManager: 'pnpm',
    testFramework: 'Vitest',
    framework: null,
    frontend: null,
    database: null,
  }),
  agentPromptExtensionsYaml: renderPromptExtensionsYaml(DEFAULT_AGENT_PROMPT_EXTENSIONS),
};

/**
 * Calls the LLM to generate a project-specific `StackConfig`.
 * NEVER throws — every failure path returns a copy of
 * `DEFAULT_STACK_CONFIG` and logs a warning. Callers should
 * always be able to use the return value without try/catch.
 */
export async function generateStackConfig(
  projectDescription: string,
  projectName: string,
): Promise<StackConfig> {
  try {
    const client = getLLMClient();
    const result = await client.complete({
      messages: [{
        role: 'user',
        content: buildStackPrompt(projectDescription, projectName),
      }],
      temperature: 0.1, // low temperature — stack decisions should be deterministic
      maxTokens: 1000,
    });

    if (!result.ok) {
      log.warn(
        { err: result.error.message, type: result.error.type },
        'Stack config LLM call failed — using defaults',
      );
      return { ...DEFAULT_STACK_CONFIG };
    }

    return parseStackConfig(result.value.content);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Stack config generation threw — using defaults',
    );
    return { ...DEFAULT_STACK_CONFIG };
  }
}

/**
 * Builds the diagnosis prompt. Format intentionally mirrors the
 * SelfHealingAgent prompt's shape — explicit Rules section, JSON
 * output, examples for CI YAML.
 */
function buildStackPrompt(description: string, name: string): string {
  return `You are a senior software architect setting up a project harness.
Based on the project description, determine the exact technology stack.

Project name: ${name}
Project description: ${description}

Return ONLY a JSON object — no preamble, no markdown fences:
{
  "language": "TypeScript|Python|Go|Java|Rust|...",
  "nodeVersion": "22|20|18|null",
  "packageManager": "npm|pnpm|yarn|pip|poetry|go|cargo|...",
  "installCmd": "exact CI install command",
  "testCmd": "exact CI test command",
  "lintCmd": "exact CI lint command (or 'echo \"No lint configured\"' when the stack has no standard linter)",
  "buildCmd": "exact build command or null",
  "testFramework": "Jest|Vitest|pytest|JUnit|go test|...",
  "framework": "Express|Fastify|FastAPI|Spring|Gin|null",
  "frontend": "React|Vue|Angular|Next.js|React Native|null",
  "database": "PostgreSQL|MySQL|MongoDB|Redis|SQLite|null",
  "moduleStructure": "markdown directory tree (use actual dirs for this project)",
  "architectureNotes": "2-3 sentences describing the architecture",
  "agentPromptExtensions": [
    "stack-specific rule 1",
    "stack-specific rule 2"
  ],
  "ciSetupSteps": "YAML snippet for CI setup steps (setup-language + install)"
}

Rules:
- If the description explicitly mentions a tool, use it exactly
- If the description implies a stack (e.g. "React Native app"), infer the full stack
- For Node.js projects not specifying a version, default to Node 22 LTS
- For Python projects, use pip or poetry based on context
- agentPromptExtensions should be specific coding conventions for this stack
  e.g. "Use async/await throughout, never callbacks" or
  "Follow PEP 8 — 4 space indentation, snake_case variables"
- lintCmd examples by stack:
  TypeScript/JavaScript with ESLint: "npx eslint src --max-warnings 0"
  TypeScript via pnpm script: "pnpm run lint"
  Python: "python -m flake8 src"
  Go: "golangci-lint run"
  Stacks with no standard linter: 'echo "No lint configured"'
- ciSetupSteps should be valid YAML that fits inside a GitHub Actions job steps array
  For Node: setup-node + package manager setup
  For Python: setup-python + pip/poetry install
  For Go: setup-go + go mod download

Examples of ciSetupSteps for Node/npm:
"- uses: actions/setup-node@v4\\n  with:\\n    node-version: '22'\\n- run: npm install --ci"

Examples of ciSetupSteps for Python/pip:
"- uses: actions/setup-python@v5\\n  with:\\n    python-version: '3.12'\\n- run: pip install -r requirements.txt"`;
}

/**
 * Parses the LLM response into a typed `StackConfig`. Defensive on
 * every field — missing/wrong-type values fall back to defaults so
 * a partial response still produces a usable config. NEVER throws.
 */
export function parseStackConfig(raw: string): StackConfig {
  try {
    const clean = extractJsonObject(raw);
    const parsed = JSON.parse(clean) as Partial<StackConfig> & {
      [key: string]: unknown;
    };

    // String fields — coerce to string or default. `null` is
    // accepted for nodeVersion / buildCmd / framework / frontend /
    // database; everything else falls back when missing.
    const language = stringOr(parsed.language, DEFAULT_STACK_CONFIG.language);
    const nodeVersion = nullableString(parsed.nodeVersion);
    const packageManager = stringOr(parsed.packageManager, DEFAULT_STACK_CONFIG.packageManager);
    const installCmd = stringOr(parsed.installCmd, DEFAULT_STACK_CONFIG.installCmd);
    const testCmd = stringOr(parsed.testCmd, DEFAULT_STACK_CONFIG.testCmd);
    const lintCmd = stringOr(parsed.lintCmd, DEFAULT_STACK_CONFIG.lintCmd);
    const buildCmd = nullableString(parsed.buildCmd);
    const testFramework = stringOr(parsed.testFramework, DEFAULT_STACK_CONFIG.testFramework);
    const framework = nullableString(parsed.framework);
    const frontend = nullableString(parsed.frontend);
    const database = nullableString(parsed.database);
    const moduleStructure = stringOr(parsed.moduleStructure, DEFAULT_STACK_CONFIG.moduleStructure);
    const architectureNotes = stringOr(parsed.architectureNotes, DEFAULT_STACK_CONFIG.architectureNotes);

    const agentPromptExtensions = Array.isArray(parsed.agentPromptExtensions)
      ? parsed.agentPromptExtensions.filter((s): s is string => typeof s === 'string')
      : [];

    // The LLM emits `ciSetupSteps` with its own (often inconsistent)
    // indentation. Normalise via `indentSteps` so every line lands
    // at column 6 — the depth `steps:` items live at in the
    // template — regardless of what the LLM produced. Both the
    // single-string and array shapes are handled here.
    const rawSteps = stringOr(parsed.ciSetupSteps, DEFAULT_STACK_CONFIG.ciSetupSteps);
    // If the LLM already produced the indented form (e.g. the
    // default config from `safeDefaultDiagnosis`), running
    // `indentSteps` is idempotent — it strips and re-applies the
    // same prefix.
    const ciSetupSteps = indentSteps(stripIndent(rawSteps));

    return {
      language,
      nodeVersion,
      packageManager,
      installCmd,
      testCmd,
      lintCmd,
      buildCmd,
      testFramework,
      framework,
      frontend,
      database,
      moduleStructure,
      architectureNotes,
      agentPromptExtensions,
      ciSetupSteps,
      stackSection: renderStackSection({
        nodeVersion,
        packageManager,
        testFramework,
        framework,
        frontend,
        database,
      }),
      agentPromptExtensionsYaml: renderPromptExtensionsYaml(agentPromptExtensions),
    };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'parseStackConfig failed — using defaults',
    );
    return { ...DEFAULT_STACK_CONFIG };
  }
}

/**
 * Pre-renders the ARCHITECTURE.md Stack section from the structured
 * fields. Each line is a markdown bullet; null/empty fields are
 * skipped so the section reflects only what's true for the project.
 */
function renderStackSection(args: {
  nodeVersion: string | null;
  packageManager: string;
  testFramework: string;
  framework: string | null;
  frontend: string | null;
  database: string | null;
}): string {
  const lines: Array<string | null> = [
    args.nodeVersion ? `- Runtime: Node ${args.nodeVersion} LTS` : null,
    `- Package manager: ${args.packageManager}`,
    `- Test framework: ${args.testFramework}`,
    args.framework ? `- Backend: ${args.framework}` : null,
    args.frontend ? `- Frontend: ${args.frontend}` : null,
    args.database ? `- Database: ${args.database}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

/**
 * Pre-renders the `prompt_extensions:` YAML lines for agents.yaml.
 * Empty list renders as a single `[]` literal at the correct
 * indentation. Each non-empty entry becomes a `- "..."` item, with
 * embedded double quotes escaped. The 6-space indent matches the
 * `prompt_extensions:` block under `code-agent.llm:` in agents.yaml.
 */
function renderPromptExtensionsYaml(extensions: string[]): string {
  if (extensions.length === 0) return '      []';
  return extensions
    .map((ext) => `      - "${ext.replace(/"/g, '\\"')}"`)
    .join('\n');
}

// ─── tiny defensive helpers ───────────────────────────────────────

function stringOr(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim() !== '') return value;
  return fallback;
}

/**
 * Accepts string, returns it. Accepts null OR the string `"null"`
 * (some LLMs emit the literal string when asked for a nullable
 * JSON field). Anything else → null.
 */
function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

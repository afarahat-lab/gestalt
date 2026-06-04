/**
 * Constraint agent — deterministic static checks on generated code.
 *
 * Never uses an LLM — must be fully deterministic. Runs as a fast
 * pre-flight inside the quality-gate orchestrator. Emits:
 *   - CONSTRAINT_VIOLATION signals for architectural rule breaks
 *     (no-any, no-console, no-direct-db-outside-shared-db)
 *   - GOLDEN_PRINCIPLE_BREACH signals for non-negotiables that the
 *     review-agent / human must approve before deploy (hardcoded
 *     secrets, direct LLM SDK imports)
 *
 * Text-based regex checks today. A future iteration moves to the
 * TypeScript compiler API for semantic AST rules.
 */

import type {
  GateTask, GateAgentResult, GateSignal,
  CodeLocation, SignalSeverity,
} from '../types';
import type { SignalType } from '@gestalt/core';

interface RegexRule {
  id: string;
  description: string;
  pattern: RegExp;
  appliesTo: (path: string) => boolean;
  signalType: SignalType;
  severity: SignalSeverity;
  autoResolvable: boolean;
}

const CODE_FILE = (path: string): boolean =>
  /\.(ts|tsx|js|jsx)$/.test(path) && !/\.d\.ts$/.test(path);

const NON_TEST_CODE = (path: string): boolean =>
  CODE_FILE(path) && !/__tests__|\.test\.|\.spec\./.test(path);

const TEST_FILE = (path: string): boolean =>
  CODE_FILE(path) && /__tests__|\.test\.|\.spec\./.test(path);

/**
 * TEST_REPORT_002 Fix 3b — declared-framework → forbidden-import
 * mapping. When the project's `HARNESS.json.stack.testFramework`
 * names one framework, importing from a different framework in any
 * test file is a CONSTRAINT_VIOLATION. Per the previous live cycle
 * the test-agent generated Vitest tests against a Jest project; this
 * rule catches that class of mismatch deterministically before the
 * cycle reaches the LLM review-agent.
 *
 * Keys are lowercased canonical framework names. Values are the
 * forbidden `from '<name>'` import substrings.
 */
const FORBIDDEN_TEST_IMPORTS: Record<string, ReadonlyArray<string>> = {
  jest: ['vitest', 'mocha', 'chai', 'bun:test', 'node:test', 'tap'],
  vitest: ['@jest/globals', 'jest', 'mocha', 'chai', 'bun:test', 'node:test', 'tap'],
  mocha: ['vitest', '@jest/globals', 'jest', 'bun:test'],
};

function buildFrameworkRule(testFramework: string): RegexRule | null {
  const key = testFramework.trim().toLowerCase();
  const forbidden = FORBIDDEN_TEST_IMPORTS[key];
  if (!forbidden || forbidden.length === 0) return null;
  // Match `from 'forbidden'` or `from "forbidden"` (single quote and
  // double quote). The alternation is built once per cycle.
  const alternation = forbidden
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return {
    id: `test-framework-mismatch-${key}`,
    description: `Project declares testFramework: ${testFramework}. Tests must not import from another framework.`,
    pattern: new RegExp(`from\\s+['"](${alternation})['"]`, 'g'),
    appliesTo: TEST_FILE,
    signalType: 'CONSTRAINT_VIOLATION',
    severity: 'high',
    autoResolvable: true,
  };
}

const RULES: RegexRule[] = [
  // ─── CONSTRAINT_VIOLATION (auto-resolvable) ────────────────────────────────
  {
    id: 'no-any',
    description: 'Use unknown with type guards instead of any',
    // matches `: any` or `as any` but NOT `:anything` or `<any>` (rare false positive)
    pattern: /(?<![\w$]):\s*any\b|\bas\s+any\b/g,
    appliesTo: NON_TEST_CODE,
    signalType: 'CONSTRAINT_VIOLATION',
    severity: 'medium',
    autoResolvable: true,
  },
  {
    id: 'no-console',
    description: 'Use createContextLogger from @gestalt/core; no console.* in production code',
    pattern: /\bconsole\.(log|error|warn|info|debug)\s*\(/g,
    appliesTo: NON_TEST_CODE,
    signalType: 'CONSTRAINT_VIOLATION',
    severity: 'medium',
    autoResolvable: true,
  },
  {
    id: 'no-direct-db-outside-shared-db',
    description: 'Database driver imports only inside shared/db/ — repository pattern',
    pattern: /from\s+['"](postgres|pg|mysql|mysql2|mssql|oracledb)['"]/g,
    appliesTo: (path) =>
      NON_TEST_CODE(path) && !/(^|\/)shared\/db\//.test(path),
    signalType: 'CONSTRAINT_VIOLATION',
    severity: 'high',
    autoResolvable: true,
  },

  // ─── GOLDEN_PRINCIPLE_BREACH (never auto-resolved) ─────────────────────────
  {
    id: 'no-hardcoded-secret',
    description: 'Secrets, API keys, passwords must come from config — never literal',
    pattern:
      /\b(password|apiKey|api_key|secret|token|privateKey|client_secret)\s*[:=]\s*['"`][A-Za-z0-9_\-+/=]{12,}['"`]/gi,
    appliesTo: CODE_FILE,
    signalType: 'GOLDEN_PRINCIPLE_BREACH',
    severity: 'critical',
    autoResolvable: false,
  },
  {
    id: 'no-direct-llm-sdk',
    description: 'LLM provider SDKs only inside @gestalt/core/llm — provider abstraction lives in core',
    pattern: /from\s+['"](openai|@anthropic-ai\/sdk|@google\/generative-ai|cohere-ai|@mistralai)['"]/g,
    appliesTo: NON_TEST_CODE,
    signalType: 'GOLDEN_PRINCIPLE_BREACH',
    severity: 'high',
    autoResolvable: false,
  },
];

interface Violation {
  ruleId: string;
  ruleDescription: string;
  message: string;
  signalType: SignalType;
  severity: SignalSeverity;
  autoResolvable: boolean;
  location: CodeLocation;
}

/**
 * Runs the constraint agent against all code artifacts in the task.
 * Returns a GateAgentResult with one signal per violation.
 */
export async function runConstraintAgent(task: GateTask): Promise<GateAgentResult> {
  const startedAt = Date.now();
  const signals: GateSignal[] = [];

  // TEST_REPORT_002 Fix 3b — append a dynamic test-framework rule
  // when HARNESS.json declares one. Built per-cycle (NOT module-
  // global) so a project that swaps frameworks mid-life gets the
  // new rule on its next gate run without a server restart.
  const declaredFramework = task.harnessConfig.stack?.testFramework;
  const dynamicRules: RegexRule[] = [];
  if (declaredFramework) {
    const frameworkRule = buildFrameworkRule(declaredFramework);
    if (frameworkRule) dynamicRules.push(frameworkRule);
  }
  const rulesForCycle: RegexRule[] = [...RULES, ...dynamicRules];

  for (const artifact of task.artifacts) {
    if (typeof artifact.content !== 'string') continue;

    for (const rule of rulesForCycle) {
      if (!rule.appliesTo(artifact.path)) continue;

      const violations = findViolations(rule, artifact.path, artifact.content);
      for (const violation of violations) {
        signals.push({
          id: crypto.randomUUID(),
          correlationId: task.correlationId,
          type: violation.signalType,
          severity: violation.severity,
          agentRole: 'constraint-agent',
          message: violation.message,
          location: violation.location,
          autoResolvable: violation.autoResolvable,
        });
      }
    }
  }

  return {
    agentRole: 'constraint-agent',
    status: signals.length === 0 ? 'passed' : 'failed',
    signals,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Find every match of `rule.pattern` in `content` and produce a violation
 * record with line/column. Pattern must use the global flag; this function
 * walks the matches and computes locations from the match index.
 */
function findViolations(rule: RegexRule, path: string, content: string): Violation[] {
  const out: Violation[] = [];
  // Clone the regex with the global flag set in case the source omitted it.
  const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g');

  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const { line, column } = indexToLineCol(content, match.index);
    out.push({
      ruleId: rule.id,
      ruleDescription: rule.description,
      message: `[${rule.id}] ${rule.description}`,
      signalType: rule.signalType,
      severity: rule.severity,
      autoResolvable: rule.autoResolvable,
      location: { file: path, line, column, rule: rule.id },
    });

    // Cap per-file matches so a runaway pattern doesn't flood signals.
    if (out.length >= 20) break;

    // Guard against zero-length matches (would loop forever).
    if (match.index === re.lastIndex) re.lastIndex++;
  }

  return out;
}

function indexToLineCol(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline };
}

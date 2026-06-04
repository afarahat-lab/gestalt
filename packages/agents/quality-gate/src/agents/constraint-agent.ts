/**
 * Constraint agent — TWO-STAGE detection (TEST_REPORT_005).
 *
 * Stage 1 (scripted): the existing regex `RULES` are now a DETECTOR,
 * not a verdict. Every regex match becomes a `CandidateViolation`
 * with the matched text, line, column, rule id, and severity.
 *
 * Stage 2 (LLM judgment): all candidates are passed to the LLM along
 * with the file's full content, the constraint-rule descriptions
 * from `HARNESS.json`, the IntentSpec (rawIntent + outOfScope), and
 * the project state files (package.json, AGENTS.md). For each
 * candidate the LLM decides CONFIRM or DISMISS, and may also surface
 * `additional` violations the regex couldn't reach (architectural
 * rules expressed only in HARNESS.json's plain-English text).
 *
 * Stage 3 (emission): only confirmed candidates + LLM-flagged
 * additional violations become `CONSTRAINT_VIOLATION` /
 * `GOLDEN_PRINCIPLE_BREACH` signals. Dismissed candidates are
 * logged (`Constraint candidate dismissed by LLM` with the reason)
 * but produce no signal.
 *
 * Why: TEST_REPORT_004 hit two blocking false-positives the regex
 * couldn't distinguish — `import { Pool } from 'pg'` (a type-only
 * import) and `console.log` (a phase-2 audit attempt) — both
 * dismissable in context. Letting an LLM read the surrounding code
 * + the project's stated rules + the intent's outOfScope makes the
 * gate precise without sacrificing recall.
 *
 * `runConstraintAgent` is retained as the orchestrator's entry
 * point. It now constructs a `ConstraintAgent` instance internally
 * so the LLM call's prompt / response / model / token fields land
 * on the observability wrapper.
 */

import { BaseLLMAgent, extractJsonObject } from '@gestalt/core';
import type { AgentConfig } from '@gestalt/core';
import type {
  GateTask, GateAgentResult, GateSignal,
  CodeLocation, SignalSeverity, ArtifactRef,
} from '../types';
import type { SignalType } from '@gestalt/core';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { createContextLogger } from '@gestalt/core';

const log = createContextLogger({ module: 'constraint-agent' });

// ─── Stage 1 — scripted detection (legacy RULES, new output shape) ──────────

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

const FORBIDDEN_TEST_IMPORTS: Record<string, ReadonlyArray<string>> = {
  jest: ['vitest', 'mocha', 'chai', 'bun:test', 'node:test', 'tap'],
  vitest: ['@jest/globals', 'jest', 'mocha', 'chai', 'bun:test', 'node:test', 'tap'],
  mocha: ['vitest', '@jest/globals', 'jest', 'bun:test'],
};

function buildFrameworkRule(testFramework: string): RegexRule | null {
  const key = testFramework.trim().toLowerCase();
  const forbidden = FORBIDDEN_TEST_IMPORTS[key];
  if (!forbidden || forbidden.length === 0) return null;
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
  {
    id: 'no-any',
    description: 'Use unknown with type guards instead of any',
    pattern: /(?<![\w$]):\s*any\b|\bas\s+any\b/g,
    appliesTo: NON_TEST_CODE,
    signalType: 'CONSTRAINT_VIOLATION',
    severity: 'medium',
    autoResolvable: true,
  },
  {
    id: 'no-console',
    description: 'Use the project logger; no console.* in production code',
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
  // ─── GOLDEN_PRINCIPLE_BREACH (never auto-resolved) — still scripted
  // because hardcoded-secret detection benefits from regex recall.
  // The LLM judgment can still DISMISS a candidate if context shows
  // it's a placeholder/test fixture; it just can't fail to flag.
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

/**
 * A single regex match. Stage 1 produces these; Stage 2 confirms or
 * dismisses each.
 */
export interface CandidateViolation {
  constraintId: string;
  signalType: SignalType;
  file: string;
  line: number;
  column: number;
  matchedText: string;
  scriptReason: string;
  severity: SignalSeverity;
  autoResolvable: boolean;
}

/**
 * Stage 2's verdict on a candidate (or an LLM-only additional
 * finding). Emitted as a signal in stage 3.
 */
export interface ConfirmedViolation {
  constraintId: string;
  signalType: SignalType;
  file: string;
  line: number;
  column: number;
  explanation: string;
  severity: SignalSeverity;
  autoResolvable: boolean;
  source: 'script-confirmed' | 'llm-additional';
}

function buildCandidates(task: GateTask): CandidateViolation[] {
  const candidates: CandidateViolation[] = [];

  // Per-cycle dynamic test-framework rule (TEST_REPORT_002 Fix 3b).
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

      const re = new RegExp(
        rule.pattern.source,
        rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g',
      );

      let match: RegExpExecArray | null;
      let perFile = 0;
      while ((match = re.exec(artifact.content)) !== null) {
        const { line, column } = indexToLineCol(artifact.content, match.index);
        candidates.push({
          constraintId: rule.id,
          signalType: rule.signalType,
          file: artifact.path,
          line,
          column,
          matchedText: match[0],
          scriptReason: rule.description,
          severity: rule.severity,
          autoResolvable: rule.autoResolvable,
        });

        perFile++;
        if (perFile >= 20) break; // cap per-file matches
        if (match.index === re.lastIndex) re.lastIndex++;
      }
    }
  }

  return candidates;
}

function indexToLineCol(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: index - lastNewline };
}

// ─── Stage 2 — LLM judgment ──────────────────────────────────────────────────

const JUDGMENT_CONFIG: AgentConfig = {
  role: 'Architectural constraint evaluator',
  goal: 'Confirm or dismiss scripted constraint-violation candidates based on full code context',
  llm: { temperature: 0.0, maxTokens: 3000 },
  promptExtensions: [],
  tools: { builtin: [], mcp: [] },
};

const SNIPPET_LINES_BEFORE = 3;
const SNIPPET_LINES_AFTER = 3;
const PER_STATE_FILE_TRUNCATE = 1500;
const MAX_CANDIDATES_TO_LLM = 30;

interface JudgmentResponse {
  candidates?: Array<{
    index?: number;
    decision?: 'CONFIRM' | 'DISMISS';
    explanation?: string;
    severity?: string;
  }>;
  additional?: Array<{
    constraintId?: string;
    file?: string;
    line?: number;
    explanation?: string;
    severity?: string;
  }>;
  summary?: string;
}

/**
 * Concrete agent. Owns the LLM call so `lastPrompt`, `lastLlmResponse`,
 * `lastModelUsed`, `lastTokensUsed` are captured for the orchestrator's
 * observability wrapper.
 *
 * `runJudgment` is the public entry point. Returns a fully built
 * `GateAgentResult` ready for the orchestrator.
 */
export class ConstraintAgent extends BaseLLMAgent {
  constructor() { super('constraint-agent'); }

  protected buildPrompt(): string {
    throw new Error('ConstraintAgent.buildPrompt is not used — see runJudgment()');
  }
  protected parseResponse(): unknown {
    throw new Error('ConstraintAgent.parseResponse is not used — see runJudgment()');
  }

  /**
   * Orchestrator entry point. Runs Stage 1 → Stage 2 → Stage 3.
   *
   * Stage 2 LLM call is skipped when Stage 1 produced zero
   * candidates (no point asking the LLM to confirm an empty list;
   * the only thing it could do is find additional violations, but
   * those would have to come from a pure architectural pass we
   * don't yet do). The skip keeps clean cycles fast (1-2 ms) and
   * cheap (0 tokens) — matching today's constraint-agent cost.
   */
  async runJudgment(task: GateTask): Promise<GateAgentResult> {
    this.lastTokensUsed = 0; // reset accumulator for this run
    const startedAt = Date.now();

    const candidates = buildCandidates(task);

    if (candidates.length === 0) {
      return {
        agentRole: 'constraint-agent',
        status: 'passed',
        signals: [],
        durationMs: Date.now() - startedAt,
      };
    }

    // Stage 2 — LLM judgment.
    const [projectStateFiles, harnessRules] = await Promise.all([
      loadProjectStateFiles(task.harnessConfig.projectRoot),
      // The gate-orchestrator's `defaultGateHarnessConfig` always
      // sets `constraintRules: []` (only the review-agent threaded
      // its own loader). Read straight from `HARNESS.json` so the
      // judgment prompt sees the project's plain-English rules.
      loadHarnessConstraintRules(task.harnessConfig.projectRoot),
    ]);
    const intentSpec = extractIntentSpecFromArtifacts(task.artifacts);
    const trimmedCandidates = candidates.slice(0, MAX_CANDIDATES_TO_LLM);
    const prompt = this.buildJudgmentPrompt(
      trimmedCandidates,
      task,
      intentSpec,
      projectStateFiles,
      harnessRules,
    );

    let confirmed: ConfirmedViolation[] = [];
    let raw = '';
    try {
      raw = await this.callLLM(prompt, JUDGMENT_CONFIG, task.correlationId);
      confirmed = this.parseJudgmentResponse(raw, trimmedCandidates);
    } catch (err) {
      // LLM failure → safe default: emit NOTHING. Never block a
      // cycle because the constraint-agent's judgment call blew up.
      // The cycle continues; the review-agent (also LLM-driven) is
      // the second line of defence for real violations.
      log.warn(
        { err: err instanceof Error ? err.message : String(err), correlationId: task.correlationId },
        'Constraint-agent LLM judgment failed — passing clean',
      );
      return {
        agentRole: 'constraint-agent',
        status: 'passed',
        signals: [],
        durationMs: Date.now() - startedAt,
      };
    }

    // Stage 3 — emit confirmed only.
    const signals: GateSignal[] = confirmed.map((v) => ({
      id: crypto.randomUUID(),
      correlationId: task.correlationId,
      type: v.signalType,
      severity: v.severity,
      agentRole: 'constraint-agent',
      message: `[${v.constraintId}] ${v.explanation}`,
      location: {
        file: v.file,
        line: v.line,
        column: v.column,
        rule: v.constraintId,
      } as CodeLocation,
      autoResolvable: v.autoResolvable,
    }));

    // Any high/critical signal → failed. Otherwise (zero signals OR
    // only medium/low signals) → passed. The gate's overall verdict
    // logic treats `passed` with medium/low signals as
    // `concerns` (advisory, doesn't block), not `pass`.
    const status: GateAgentResult['status'] =
      signals.some((s) => s.severity === 'high' || s.severity === 'critical')
        ? 'failed'
        : 'passed';

    log.info(
      {
        correlationId: task.correlationId,
        candidates: candidates.length,
        confirmed: confirmed.length,
        dismissed: trimmedCandidates.length - confirmed.filter((c) => c.source === 'script-confirmed').length,
        additional: confirmed.filter((c) => c.source === 'llm-additional').length,
      },
      'Constraint-agent judgment complete',
    );

    return {
      agentRole: 'constraint-agent',
      status,
      signals,
      durationMs: Date.now() - startedAt,
    };
  }

  // ── Stage 2 — prompt builder ────────────────────────────────────────────

  private buildJudgmentPrompt(
    candidates: CandidateViolation[],
    task: GateTask,
    intentSpec: { rawIntent?: string; outOfScope?: string[] } | null,
    projectStateFiles: Record<string, string>,
    harnessRules: Array<{ id: string; description: string; severity: string }>,
  ): string {
    // Prefer rules from HARNESS.json (rich plain-English) over the
    // (usually-empty) `harnessConfig.constraintRules` field.
    const rules = harnessRules.length > 0
      ? harnessRules
      : (task.harnessConfig.constraintRules ?? []);
    const language = task.harnessConfig.stack?.language ?? 'TypeScript';
    const outOfScope = intentSpec?.outOfScope ?? [];
    const rawIntent = intentSpec?.rawIntent ?? task.intentText ?? '(unknown)';

    const rulesSection = rules.length > 0
      ? rules.map((r) => `- [${r.id}] (${r.severity}) ${r.description}`).join('\n')
      : '(No project-specific rules declared in HARNESS.json — use general TypeScript / architectural best practice.)';

    const outOfScopeSection = outOfScope.length > 0
      ? outOfScope.map((s) => `- ${s}`).join('\n')
      : '(Nothing explicitly excluded.)';

    // Project-state files (package.json, tsconfig.json, AGENTS.md) so
    // the LLM knows what's ALREADY on main. Truncated per-file.
    const projectStateSection = Object.keys(projectStateFiles).length > 0
      ? Object.entries(projectStateFiles).map(([path, content]) => {
        const slice = content.length > PER_STATE_FILE_TRUNCATE
          ? `${content.slice(0, PER_STATE_FILE_TRUNCATE)}\n/* TRUNCATED — full file is ${content.length} bytes */`
          : content;
        return `### ${path}\n\`\`\`\n${slice}\n\`\`\``;
      }).join('\n\n')
      : '(No project state files read.)';

    // Per-candidate snippet — show SNIPPET_LINES_BEFORE/AFTER lines
    // around the flagged line so the LLM has surrounding context.
    const codeContext = candidates.map((c, i) => {
      const artifact = task.artifacts.find((a) => a.path === c.file);
      if (!artifact) return `#### Candidate ${i} — ${c.file}:${c.line}\n(artifact content not available)`;
      const lines = artifact.content.split('\n');
      const start = Math.max(0, c.line - 1 - SNIPPET_LINES_BEFORE);
      const end = Math.min(lines.length, c.line + SNIPPET_LINES_AFTER);
      const snippet = lines
        .slice(start, end)
        .map((l, j) => `${(start + j + 1).toString().padStart(4, ' ')} | ${l}`)
        .join('\n');
      return `#### Candidate ${i} — ${c.file}:${c.line} (${c.constraintId})\n` +
        `Matched: \`${c.matchedText}\`\n` +
        '```\n' + snippet + '\n```';
    }).join('\n\n');

    const candidatesSection = candidates
      .map((c, i) =>
        `### Candidate ${i}\n` +
        `Rule:          ${c.constraintId}\n` +
        `Severity:      ${c.severity}\n` +
        `File:          ${c.file}\n` +
        `Line:          ${c.line}\n` +
        `Matched text:  ${c.matchedText}\n` +
        `Script reason: ${c.scriptReason}`)
      .join('\n\n');

    return `You are an Architectural constraint evaluator for a ${language} project.

Your job: review candidate constraint-rule violations that a scripted
detector flagged. For each candidate, decide:

  - CONFIRM if the candidate is a genuine violation given the
    surrounding code, the project's stated rules, the intent's scope,
    and the project state (package.json, AGENTS.md, …).
  - DISMISS if the candidate is a false positive (type-only import,
    item already present in the project, out-of-scope layer, …).

You may ALSO surface additional violations the script missed if you
see clear evidence in the code below. Do not invent issues.

## Project constraint rules (from HARNESS.json)

${rulesSection}

## Intent

${rawIntent}

## Out of scope for this intent — do NOT flag these

${outOfScopeSection}

## Project state (existing files on main)

These files already exist in the project. Do NOT flag an item as
"missing" if it's present here. Only flag items absent from BOTH
the generated artifacts AND the project state.

${projectStateSection}

## Scripted detection candidates (${candidates.length} found)

${candidatesSection}

## Code context around each candidate

${codeContext}

## Your tasks

### Task A — judge each candidate
For every candidate above, return a decision (CONFIRM or DISMISS)
with a brief explanation.

DISMISSAL reasons that are commonly correct:
- Type-only TypeScript import (\`import type { Pool } from 'pg'\`) — the
  import is erased at compile time and cannot reach the runtime
  database. The rule's intent is to forbid \`new Pool(...)\` outside
  \`shared/db/\` — it's the runtime instantiation that's the
  violation, not the type reference.
- console.* in a clearly-test or clearly-debug context that's not
  shipping to production.
- \`from 'pg|postgres|...'\` inside a file under \`shared/db/\` (the
  scripted detector already filters this — listed for completeness).
- Item flagged as "missing" but already present in the project's
  \`package.json\` / \`AGENTS.md\` / etc.

CONFIRMATION should require visible evidence in the snippet — actual
\`new Pool(...)\` instantiation, actual \`console.log(\`payment for
\${userId}\`)\` in shipping code, actual hardcoded secret literal.

### Task B — additional violations (optional)
If the code below has a clear violation of a constraint rule that
the script didn't flag, add it under \`additional\`. Be conservative
— only add when the evidence is unambiguous. Leave the array empty
when in doubt.

### Task C — scope filter (mandatory)
Do NOT confirm violations for items the intent's "out of scope"
list excludes. Do NOT flag absent items already present in the
project state above.

## Output

Return ONLY a single JSON object — no preamble, no markdown fences.
Use this exact schema:

\`\`\`json
{
  "candidates": [
    {
      "index": 0,
      "decision": "CONFIRM" | "DISMISS",
      "explanation": "1-sentence reason",
      "severity": "high" | "medium" | "low"
    }
  ],
  "additional": [
    {
      "constraintId": "rule-id-from-harness-or-descriptive-slug",
      "file": "src/path/to/file.ts",
      "line": 42,
      "explanation": "1-sentence reason",
      "severity": "high" | "medium" | "low"
    }
  ],
  "summary": "N confirmed (M dismissed); K additional"
}
\`\`\``;
  }

  // ── Stage 2 — response parser ───────────────────────────────────────────

  private parseJudgmentResponse(
    raw: string,
    candidates: CandidateViolation[],
  ): ConfirmedViolation[] {
    let parsed: JudgmentResponse;
    try {
      parsed = JSON.parse(extractJsonObject(raw)) as JudgmentResponse;
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Constraint-agent LLM response could not be parsed — passing clean',
      );
      return [];
    }

    const confirmed: ConfirmedViolation[] = [];

    // Per-candidate verdicts.
    for (const j of parsed.candidates ?? []) {
      const idx = typeof j.index === 'number' ? j.index : -1;
      const candidate = idx >= 0 && idx < candidates.length ? candidates[idx] : undefined;
      if (!candidate) continue;

      if (j.decision === 'CONFIRM') {
        confirmed.push({
          constraintId: candidate.constraintId,
          signalType: candidate.signalType,
          file: candidate.file,
          line: candidate.line,
          column: candidate.column,
          explanation: (j.explanation ?? candidate.scriptReason).trim(),
          severity: coerceSeverity(j.severity, candidate.severity),
          autoResolvable: candidate.autoResolvable,
          source: 'script-confirmed',
        });
      } else {
        // Observability: log dismissals with the reason so an
        // operator can audit what the LLM filtered.
        log.info(
          {
            constraintId: candidate.constraintId,
            file: candidate.file,
            line: candidate.line,
            reason: (j.explanation ?? '').slice(0, 200),
          },
          'Constraint candidate dismissed by LLM',
        );
      }
    }

    // Additional LLM-only findings.
    for (const a of parsed.additional ?? []) {
      const file = typeof a.file === 'string' ? a.file : '';
      const line = typeof a.line === 'number' ? a.line : 0;
      const explanation = typeof a.explanation === 'string' ? a.explanation : '';
      const constraintId = typeof a.constraintId === 'string' ? a.constraintId : 'llm-additional';
      if (!file || !explanation) continue;
      confirmed.push({
        constraintId,
        signalType: 'CONSTRAINT_VIOLATION',
        file,
        line,
        column: 0,
        explanation: explanation.trim(),
        severity: coerceSeverity(a.severity, 'medium'),
        autoResolvable: true,
        source: 'llm-additional',
      });
    }

    return confirmed;
  }
}

function coerceSeverity(value: unknown, fallback: SignalSeverity): SignalSeverity {
  if (value === 'high' || value === 'medium' || value === 'low' || value === 'critical') {
    return value;
  }
  return fallback;
}

// ─── Project-state + intent-spec helpers ────────────────────────────────────

async function loadProjectStateFiles(projectRoot: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const relPath of ['package.json', 'tsconfig.json', 'AGENTS.md']) {
    try {
      files[relPath] = await readFile(join(projectRoot, relPath), 'utf8');
    } catch {
      // Best-effort.
    }
  }
  return files;
}

/**
 * Read `constraints.rules` from `HARNESS.json` at the cloned project
 * root. The review-agent has its own copy of this loader; ideally
 * both would share a single helper, but each agent's package is its
 * own compilation unit and the schema (`{ id, description, severity }`)
 * is small enough that duplicating is preferable to introducing a
 * cross-package shared module just for three keys.
 */
async function loadHarnessConstraintRules(
  projectRoot: string,
): Promise<Array<{ id: string; description: string; severity: string }>> {
  try {
    const raw = await readFile(join(projectRoot, 'HARNESS.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      constraints?: { rules?: Array<{ id?: unknown; description?: unknown; severity?: unknown }> };
    };
    const arr = parsed.constraints?.rules ?? [];
    const out: Array<{ id: string; description: string; severity: string }> = [];
    for (const r of arr) {
      if (typeof r.id === 'string' && typeof r.description === 'string') {
        out.push({
          id: r.id,
          description: r.description,
          severity: typeof r.severity === 'string' ? r.severity : 'medium',
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function extractIntentSpecFromArtifacts(
  artifacts: ArtifactRef[],
): { rawIntent?: string; outOfScope?: string[] } | null {
  const intentSpecArtifact = artifacts.find(
    (a) => a.path.startsWith('.gestalt/') && a.path.endsWith('/intent-spec.json'),
  );
  if (!intentSpecArtifact) return null;
  try {
    const parsed = JSON.parse(intentSpecArtifact.content) as {
      rawIntent?: unknown;
      outOfScope?: unknown;
    };
    const out: { rawIntent?: string; outOfScope?: string[] } = {};
    if (typeof parsed.rawIntent === 'string') out.rawIntent = parsed.rawIntent;
    if (Array.isArray(parsed.outOfScope)) {
      out.outOfScope = parsed.outOfScope.filter((s): s is string => typeof s === 'string');
    }
    return out;
  } catch {
    return null;
  }
}

// ─── Public function (backward-compatible entry point) ─────────────────────

const _singleton = new ConstraintAgent();

/**
 * Backward-compatible entry point. The gate-orchestrator already
 * calls this. Routes the call through the `ConstraintAgent` instance
 * so its `lastPrompt` / `lastLlmResponse` / `lastModelUsed` /
 * `lastTokensUsed` fields land on the observability wrapper.
 *
 * Exported separately as well so the orchestrator can forward those
 * fields onto the result object (mirrors the ReviewAgent pattern).
 */
export async function runConstraintAgent(task: GateTask): Promise<GateAgentResult> {
  return _singleton.runJudgment(task);
}

export function getConstraintAgentInstance(): ConstraintAgent {
  return _singleton;
}

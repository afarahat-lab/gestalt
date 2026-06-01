/**
 * Shared signal-feedback formatter — turns the routed `priorSignals`
 * from the prior cycle into a structured "Previous attempt failed —
 * you MUST fix ALL of the following" prompt section.
 *
 * Used by `code-prompt`, `test-prompt`, and the review-agent prompt.
 * Emits an empty string when there are no prior signals so callers
 * can `.filter(Boolean).join('\n\n')` it into a section list without
 * leaving a blank header behind on the first attempt.
 *
 * Signals are grouped by type + severity so the model fixes the
 * highest-priority items first:
 *   1. critical CONSTRAINT_VIOLATION
 *   2. other CONSTRAINT_VIOLATION
 *   3. TEST_FAILURE
 *   4. LINT_FAILURE
 *
 * `CONTEXT_GAP` signals are intentionally OMITTED here — they route
 * to the context-agent, not code/test/review. The router in
 * `feedback-router.ts` already filters by agent role; this formatter
 * trusts that filter and prints whatever it receives.
 */

import type { FeedbackSignal } from '../types';

function formatLocation(s: FeedbackSignal): string {
  if (!s.location?.file) return '';
  const file = s.location.file;
  const line = s.location.line ? `:${s.location.line}` : '';
  return `[${file}${line}] `;
}

export function buildSignalFeedback(signals: FeedbackSignal[]): string {
  if (signals.length === 0) return '';

  const grouped = {
    critical: signals.filter(
      (s) => s.type === 'CONSTRAINT_VIOLATION' && s.severity === 'critical',
    ),
    violations: signals.filter(
      (s) => s.type === 'CONSTRAINT_VIOLATION' && s.severity !== 'critical',
    ),
    lint: signals.filter((s) => s.type === 'LINT_FAILURE'),
    tests: signals.filter((s) => s.type === 'TEST_FAILURE'),
    gaps: signals.filter((s) => s.type === 'CONTEXT_GAP'),
  };

  const sections: string[] = [
    `## Previous attempt failed — you MUST fix ALL of the following`,
  ];

  if (grouped.critical.length > 0) {
    sections.push(
      `### Critical violations (fix first):\n` +
        grouped.critical
          .map((s) => `- ${formatLocation(s)}${s.message}`)
          .join('\n'),
    );
  }

  if (grouped.violations.length > 0) {
    sections.push(
      `### Constraint violations (must fix):\n` +
        grouped.violations
          .map((s) => `- ${formatLocation(s)}${s.message}`)
          .join('\n'),
    );
  }

  if (grouped.tests.length > 0) {
    sections.push(
      `### Failing tests (fix the implementation):\n` +
        grouped.tests.map((s) => `- ${formatLocation(s)}${s.message}`).join('\n'),
    );
  }

  if (grouped.lint.length > 0) {
    sections.push(
      `### Lint issues (should fix):\n` +
        grouped.lint.map((s) => `- ${formatLocation(s)}${s.message}`).join('\n'),
    );
  }

  if (grouped.gaps.length > 0) {
    sections.push(
      `### Context gaps from the prior attempt:\n` +
        grouped.gaps.map((s) => `- ${s.message}`).join('\n'),
    );
  }

  sections.push(
    `Generate a corrected version that resolves ALL of the above. ` +
      `Do not repeat the same mistakes.`,
  );

  return sections.join('\n\n');
}

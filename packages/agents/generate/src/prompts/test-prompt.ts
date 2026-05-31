/**
 * LLM prompt builder for the test agent.
 * Generates Vitest test suite from success criteria and code artifacts.
 */

import type { ContextSnapshot } from '../types';
import { applyAgentConfig } from './agent-config-helpers';

export function buildTestPrompt(ctx: ContextSnapshot, attempt: number): string {
  const retry = attempt > 0
    ? `\n\nIMPORTANT: Retry attempt ${attempt}. Return pure JSON only.\n`
    : '';

  const criteria = ctx.intentSpec.successCriteria
    .map((c, i) => `SC-${i + 1}: ${c.description} (${c.layer} test)`)
    .join('\n');

  const codeArtifacts = ctx.priorArtifacts
    .filter((a) => a.type === 'code')
    .map((a) => `// ${a.path}\n${a.content.slice(0, 500)}`)
    .join('\n\n---\n\n');

  const body = `Generate Vitest tests that verify each success criterion.
${retry}

## Success criteria to test

${criteria}

## Code to test (summaries)

${codeArtifacts.slice(0, 3000)}

## Instructions

Generate a Vitest test file for each success criterion layer.
Return a JSON object:

{
  "files": [
    {
      "path": "src/modules/<module>/__tests__/<name>.test.ts",
      "content": "<full Vitest test file content>"
    }
  ]
}

Test rules:
- Use Vitest (import { describe, it, expect, vi } from 'vitest')
- Unit tests: test functions in isolation with vi.mock() for dependencies
- Integration tests: test full request/response with supertest
- One describe block per success criterion
- Test both happy path AND error cases
- Assertions must be specific — no toBeTruthy() without good reason
- Mock external dependencies (DB, LLM) — never real calls in tests
`;
  return applyAgentConfig(body, ctx.agentConfig);
}

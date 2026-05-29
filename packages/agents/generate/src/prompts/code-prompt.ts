/**
 * LLM prompt builder for the code agent.
 * Generates TypeScript application code from design spec.
 * Golden principles are injected as hard constraints.
 */

import type { ContextSnapshot, FeedbackSignal } from '../types';

export function buildCodePrompt(
  ctx: ContextSnapshot,
  attempt: number,
  priorSignals: FeedbackSignal[] = [],
): string {
  const retry = attempt > 0
    ? `\n\nIMPORTANT: Retry attempt ${attempt}. Return pure JSON only.\n`
    : '';

  // Gate feedback — appears only on a quality-gate-triggered retry cycle.
  const gateFeedback = priorSignals.length > 0
    ? `\n\n## Quality-gate feedback from the previous attempt\n\nYour previous attempt was rejected by the quality gate with these signals. Address each one in this attempt; do not regress on items that were not flagged.\n\n${priorSignals.map((s, i) => {
        const loc = s.location?.file
          ? s.location.line
            ? `${s.location.file}:${s.location.line}`
            : s.location.file
          : '(file-wide)';
        const rule = s.location?.file && (s.location as { rule?: string }).rule
          ? ` rule=${(s.location as { rule?: string }).rule}`
          : '';
        return `${i + 1}. [${s.type}/${s.severity}] ${loc}${rule}\n   ${s.message}`;
      }).join('\n')}\n`
    : '';

  const designArtifact = ctx.priorArtifacts.find((a) => a.path === '.gestalt/design-spec.json');
  const intentArtifact = ctx.priorArtifacts.find((a) => a.path === '.gestalt/intent-spec.json');

  const constraints = ctx.goldenPrinciples
    .map((p) => `- ${p.title}: ${p.description}`)
    .join('\n');

  const apiContracts = designArtifact
    ? (JSON.parse(designArtifact.content) as { apiContracts?: unknown[] }).apiContracts ?? []
    : [];

  return `You are the code agent in the Gestalt platform.
Generate TypeScript application code based on the design specification.
${retry}
${gateFeedback}

## Project context

Project: ${ctx.harness.name}
Architecture: ${ctx.architecture.style}
Stack: ${JSON.stringify(ctx.harness.stack)}

## HARD CONSTRAINTS — these cannot be violated under any circumstances

${constraints}

Additional architectural constraints:
- All database access through repository pattern in src/shared/db/
- RBAC enforced via middleware — never inline role checks in handlers
- Every POST/PUT/PATCH/DELETE route handler must call auditLog.append()
- Input validation using Zod schemas at API boundary
- No process.env access — use config module
- No console.log — use the platform logger

## Intent

${intentArtifact ? JSON.parse(intentArtifact.content).rawIntent : ctx.intentSpec.rawIntent}

## Design specification

${designArtifact?.content ?? '{}'}

## Architecture

${ctx.architectureMd.slice(0, 2000)}

## Instructions

Generate all TypeScript files needed to implement the intent.
Return a JSON object with this structure:

{
  "files": [
    {
      "path": "src/modules/<module>/<layer>/<filename>.ts",
      "content": "<full TypeScript file content>"
    }
  ]
}

File organisation rules:
- src/modules/<domain>/domain/<entity>.ts — entity types and interfaces
- src/modules/<domain>/repository/<entity>-repository.ts — data access
- src/modules/<domain>/service/<service>.ts — business logic
- src/modules/<domain>/routes/<resource>-routes.ts — API handlers
- src/modules/<domain>/index.ts — public exports only

Code rules:
- TypeScript strict mode — no 'any', explicit return types on all exports
- Named exports only — no default exports except React components
- All repository methods parameterised — no string concatenation in SQL
- Every exported function has a JSDoc comment
- Error handling: return typed Result<T,E> or throw with structured context
- Zod schema for every request body — validate before business logic
`;
}

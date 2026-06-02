/**
 * LLM prompt builder for the context agent.
 * Updates context files (DOMAIN.md, AGENTS.md) when domain changes occur.
 */

import type { ContextSnapshot } from '../types';
import { applyAgentConfig } from './agent-config-helpers';

export function buildContextPrompt(ctx: ContextSnapshot, attempt: number): string {
  const retry = attempt > 0
    ? `\n\nIMPORTANT: Retry attempt ${attempt}. Return pure JSON only.\n`
    : '';

  const designArtifact = ctx.priorArtifacts.find(
    (a) => a.path.startsWith('.gestalt/') && a.path.endsWith('/design-spec.json'),
  );
  const designSpec = designArtifact ? designArtifact.content : '{}';

  const body = `Your job is to update context files to reflect domain model changes.
${retry}

## Current DOMAIN.md

${ctx.domainMd}

## Design specification (new changes)

${designSpec}

## Instructions

Update the context files to reflect the new domain changes.
Return a JSON object listing updated file contents.

{
  "updates": [
    {
      "path": "docs/DOMAIN.md",
      "content": "<full updated DOMAIN.md content>"
    }
  ]
}

Rules:
- Only return files that actually need updating
- Preserve all existing content — only add or update the relevant sections
- Use the same Markdown format and structure as the existing files
- If no updates are needed, return { "updates": [] }
`;
  return applyAgentConfig(body, ctx.agentConfig);
}

/**
 * LLM prompt builder for the design agent.
 * Produces domain model changes, API contracts, and component specs as JSON.
 */

import type { ContextSnapshot } from '../types';
import { applyAgentConfig } from './agent-config-helpers';

export function buildDesignPrompt(ctx: ContextSnapshot, attempt: number): string {
  const retry = attempt > 0
    ? `\n\nIMPORTANT: Retry attempt ${attempt}. Return pure JSON only — no markdown, no preamble.\n`
    : '';

  const intentSpec = ctx.intentSpec;
  const criteria = intentSpec.successCriteria
    .map((c, i) => `${i + 1}. ${c.description}`)
    .join('\n');

  const existingEntities = ctx.domain.entities.map((e) => e.name).join(', ') || 'none';

  const body = `Your job is to produce a design specification from an intent statement.
${retry}

## Project context

Project: ${ctx.harness.name}
Architecture: ${ctx.architecture.style}
Existing entities: ${existingEntities}
Existing modules: ${ctx.architecture.modules.join(', ') || 'none'}

## Intent

"${intentSpec.rawIntent}"

## Success criteria

${criteria}

## Constraints

${intentSpec.constraints.join('\n') || 'None specified'}

## Instructions

Produce a JSON object with this structure. No text outside the JSON.

{
  "domainChanges": [
    {
      "entityName": "<PascalCase entity name>",
      "operation": "create|update",
      "fields": [
        { "name": "<camelCase>", "type": "<TypeScript type>", "required": true }
      ],
      "relationships": [
        { "entity": "<RelatedEntity>", "type": "one-to-one|one-to-many|many-to-many" }
      ]
    }
  ],
  "apiContracts": [
    {
      "method": "GET|POST|PUT|PATCH|DELETE",
      "path": "/api/v1/<resource>",
      "description": "<what this endpoint does>",
      "requestBody": { "<field>": "<type>" },
      "responseBody": { "<field>": "<type>" },
      "authRequired": true,
      "roles": ["admin", "operator"]
    }
  ],
  "componentSpecs": [
    {
      "name": "<ComponentName>",
      "type": "page|component|hook|service",
      "description": "<what it does>",
      "props": { "<prop>": "<type>" }
    }
  ]
}

Rules:
- Only include entities that need to change for this intent
- API paths follow REST conventions: plural nouns, kebab-case
- All API endpoints require auth unless explicitly public
- Component specs only needed if intent affects the UI layer
- If no domain changes are needed, return empty arrays
`;
  return applyAgentConfig(body, ctx.agentConfig);
}

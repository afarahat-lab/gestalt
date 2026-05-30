/**
 * LLM prompt builder for the intent agent.
 * Produces a structured JSON response matching the IntentSpec schema.
 */

import type { ContextSnapshot } from '../types';

/**
 * Builds the intent extraction prompt.
 * On retry attempts, adds explicit guidance about what failed previously.
 * When `clarification` is supplied, the prompt includes the operator's
 * follow-up text verbatim so the LLM can incorporate the missing detail
 * (this is the resume path after a `waiting-for-clarification` pause).
 */
export function buildIntentPrompt(
  ctx: ContextSnapshot,
  attempt: number,
  clarification?: string,
): string {
  const retryGuidance =
    attempt > 0
      ? `\n\nIMPORTANT: This is retry attempt ${attempt}. Your previous response could not be parsed as valid JSON or was missing required fields. Ensure your response is pure JSON with no markdown fences, no preamble, and no trailing text.\n`
      : '';

  const clarificationBlock = clarification?.trim()
    ? `

## Operator clarification

The original intent was too vague to extract success criteria on the
first attempt. The operator has supplied the following clarification —
treat it as the authoritative refinement of the intent:

${clarification.trim()}

When extracting successCriteria, base them on the clarification, not on
the original intent text alone.
`
      : '';

  return `You are the intent agent in the Gestalt platform.
Your job is to parse a human intent statement into a structured IntentSpec JSON object.

${retryGuidance}

## Project context

Project: ${ctx.harness.name}
Architecture style: ${ctx.architecture.style}
Existing domains: ${ctx.domain.entities.map((e) => e.name).join(', ')}
Existing modules: ${ctx.architecture.modules.join(', ')}

## Golden principles (must be reflected in constraints)

${ctx.goldenPrinciples.map((p) => `- ${p.title}: ${p.description}`).join('\n')}

## Intent to parse

"${ctx.intentSpec.rawIntent}"
${clarificationBlock}
## Instructions

Produce a JSON object with this exact structure. Do not include any text outside the JSON.

{
  "rawIntent": "<the original intent text>",
  "scope": {
    "affectedDomains": ["<domain names from the existing domain model that this intent touches>"],
    "affectedLayers": ["<one or more of: domain, api, ui, infra, test, config>"],
    "isBreakingChange": <true if this changes existing contracts or data structures>,
    "estimatedComplexity": "<small|medium|large>"
  },
  "successCriteria": [
    {
      "id": "<sc-001>",
      "description": "<what must be true when this is done>",
      "testable": <true|false>,
      "layer": "<unit|integration|e2e>"
    }
  ],
  "constraints": [
    "<constraints from golden principles and architecture that apply to this intent>"
  ],
  "outOfScope": [
    "<things explicitly NOT included in this intent to prevent scope creep>"
  ],
  "ambiguities": [
    {
      "id": "<amb-001>",
      "description": "<what is unclear>",
      "options": ["<option A>", "<option B>"],
      "impactIfWrong": "<low|medium|high>"
    }
  ]
}

Rules:
- successCriteria should have at least one entry when the intent is concrete
  enough to define one; for purely exploratory intents an empty array is OK
- affectedDomains references domains from the existing domain model. If the
  project is greenfield (no existing domains listed above) or this intent
  introduces a new domain, propose the new domain name(s) here — the
  context-agent will reconcile them with the domain model later
- constraints must include any golden principle that applies to this intent
- If the intent is clear with no ambiguity, return an empty ambiguities array
- Only mark impactIfWrong as "high" if choosing the wrong interpretation would
  produce functionally incorrect or architecturally incompatible code
`;
}

/**
 * Build the Aider message from the cycle's context snapshot (TR_014).
 *
 * The Aider message is intentionally MINIMAL: the task, the success
 * criteria, the project rules, and the architecture context.
 * **No implementation instructions.** Aider decides how — that's the
 * whole point of using it. We provide the "what" and "why"; Aider
 * provides the "how".
 *
 * This is the opposite contract from the Gestalt-native code-agent
 * (which receives a fully spec'd JSON-output prompt with file paths
 * + expected schema). Aider operates on prose tasks and writes
 * files via its own tool loop.
 */

import type { ContextSnapshot, IntentSpec } from '../types';

const MAX_ARCHITECTURE_BYTES = 2000;
const MAX_DESIGN_BYTES = 2000;

export function buildAiderMessage(
  intentSpec: IntentSpec,
  designSpec: string | null,
  snapshot: ContextSnapshot,
): string {
  const codeAgentRules =
    snapshot.harness.agentConfig?.['code-agent']?.rules ?? [];
  const architecture = snapshot.architectureMd ?? '';

  const sections: string[] = ['## Task', intentSpec.rawIntent];

  sections.push('');
  sections.push('## Read PLAN.md first');
  sections.push(
    'PLAN.md at the repository root is the source of truth for what\n' +
      'has been built in prior phases of this feature. Each completed\n' +
      'phase has a "What has been built" subsection listing the exact\n' +
      'files created and the key exports (types, classes, functions)\n' +
      'they provide.\n\n' +
      'Read PLAN.md BEFORE you generate any code. Use the "What has\n' +
      'been built" sections to know which files exist on disk, which\n' +
      'exports are available, and which field names and signatures\n' +
      'to use. Do not invent exports — only reference what PLAN.md\n' +
      'says was built.',
  );

  sections.push('');
  sections.push('## Before generating any code');
  sections.push(
    'Read every existing file in the repository that your generated\n' +
      'code will import from or extend. Confirm the exact field names,\n' +
      'exported types, and function signatures before referencing them.\n' +
      "Do not assume a type's shape — read its definition.",
  );

  if (intentSpec.successCriteria && intentSpec.successCriteria.length > 0) {
    sections.push('');
    sections.push('## Success criteria');
    sections.push(
      intentSpec.successCriteria.map((c) => `- ${c.description}`).join('\n'),
    );
  }

  if (intentSpec.outOfScope && intentSpec.outOfScope.length > 0) {
    sections.push('');
    sections.push('## Out of scope (do NOT touch these)');
    sections.push(intentSpec.outOfScope.map((s) => `- ${s}`).join('\n'));
  }

  if (codeAgentRules.length > 0) {
    sections.push('');
    sections.push('## Project rules');
    sections.push(codeAgentRules.map((r) => `- ${r}`).join('\n'));
  }

  if (architecture.trim().length > 0) {
    sections.push('');
    sections.push('## Project architecture');
    sections.push(architecture.slice(0, MAX_ARCHITECTURE_BYTES));
  }

  if (designSpec && designSpec.trim().length > 0) {
    sections.push('');
    sections.push('## Design context');
    sections.push(designSpec.slice(0, MAX_DESIGN_BYTES));
  }

  sections.push('');
  sections.push('## Important — architecture context is reference only');
  sections.push(
    'The architecture and design context above describes the intended\n' +
      'system design. Many modules and types it mentions DO NOT EXIST\n' +
      'YET in the repository — they are planned for future phases.\n' +
      'Only import from files that actually exist in the repository.\n' +
      'Use your repository map to verify a file exists before importing it.',
  );

  return sections.join('\n').trim();
}

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

  return sections.join('\n').trim();
}

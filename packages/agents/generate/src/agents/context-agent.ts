/**
 * context-agent — generate layer specialist agent.
 * Can skip: Yes — declares SKIPPED if no context changes needed
 * Implementation: Phase 2 (after full architecture walkthrough).
 */

import type { AgentTask, AgentResult } from '../types';

export async function run(
  _task: AgentTask,
  _llmCall: (prompt: string) => Promise<string>,
): Promise<AgentResult> {
  throw new Error('context-agent not yet implemented — pending Phase 2');
}

/**
 * Built-in file tools for agent tool use (ADR-038).
 *
 * All operations are READ-ONLY and execute against a single
 * `projectRoot` directory (the per-cycle clone the orchestrator
 * already creates). Path traversal outside `projectRoot` throws
 * immediately; the orchestrator's clone path is the only filesystem
 * surface an agent can touch.
 *
 * Tool definitions ship verbatim to the LLM as the OpenAI
 * `tools[{ type: 'function', function: {...} }]` request parameter
 * (the wrapping happens in `LLMClient.completeWithTools` so this
 * module stays provider-agnostic).
 */

import { readFile, readdir } from 'fs/promises';
import { join, resolve, relative } from 'path';
import { spawn } from 'child_process';
import type { ToolDefinition, ToolCall, ToolResult } from '../types';

const MAX_FILE_SIZE = 100_000;     // 100 KB — larger files are truncated
const MAX_SEARCH_RESULTS = 20;
const MAX_TREE_DEPTH = 4;

// ─── executeScript safety + size caps ──────────────────────────────────────
//
// executeScript is opt-in per agent via the tools.builtin list. When
// granted, an LLM agent can run arbitrary shell commands in the
// project's cloned work-dir. Three lines of defence:
//
//   1. BLOCKED_PATTERNS — hard platform-level blocklist. Matched on
//      the raw command string before any spawn. Not overridable.
//   2. cwd pinned to projectRoot — the orchestrator's per-cycle
//      clone. Commands can write to this temp dir but cannot reach
//      the host filesystem outside it (sudo / > /etc/ paths are
//      also caught by BLOCKED_PATTERNS as belt-and-braces).
//   3. timeout-killed spawn (default 30s, hard cap 120s) so a
//      runaway command can't hold a worker forever.
//
// The orchestrator already strips secrets from env before invoking
// the agent runner — no separate sanitisation needed here.

const MAX_SCRIPT_STDOUT = 10_000;   // 10 KB — truncated past this
const MAX_SCRIPT_STDERR = 5_000;    // 5 KB
const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;
const MAX_SCRIPT_TIMEOUT_MS = 120_000;

const BLOCKED_PATTERNS: ReadonlyArray<RegExp> = [
  /rm\s+-rf/,
  /\bgit\s+(push|commit|reset|rebase)\b/,
  /curl\s+.*\|\s*(bash|sh)/,
  /wget\s+.*\|\s*(bash|sh)/,
  />\s*\/etc\//,
  /\bsudo\b/,
];

export interface ExecuteScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.git',
  '.gestalt',
  'coverage',
  '.next',
  '.turbo',
]);

export const FILE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'readFile',
    description:
      'Read the contents of a file in the project repository. ' +
      'Use this to read existing files before modifying them, ' +
      'or to understand the current state of the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path to the file relative to the project root ' +
            '(e.g. "src/modules/tasks/service.ts").',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'listDirectory',
    description:
      'List files and directories at a path in the project repository.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Path relative to project root. Use "." for the root.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'searchFiles',
    description:
      'Search for a string or regex pattern across files in the ' +
      'project. Returns up to 20 matching `path:line: line content` ' +
      'entries. Use this to find where something is defined or used.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'String or regex pattern to search for.',
        },
        glob: {
          type: 'string',
          description:
            'Optional file glob to limit the search ' +
            '(default "**/*.{ts,js,json,md,yaml,yml}").',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'getFileTree',
    description:
      'Get a tree view of the project directory structure. ' +
      'Use this first to understand the project layout before ' +
      'reading files.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          description: 'Maximum directory depth (default 3, max 4).',
        },
      },
    },
  },
  {
    name: 'executeScript',
    description:
      'Execute a shell command in the project working directory. ' +
      'Returns stdout, stderr, exit code, and duration. ' +
      'Use this to verify compilation, run tests, check linting, ' +
      'or run any verification that helps enforce the project rules. ' +
      'Decide what commands are appropriate for the project language ' +
      'and stack — do not wait to be told what to run.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in ms. Default 30000. Max 120000.',
        },
      },
      required: ['command'],
    },
  },
];

/**
 * Dispatches a tool call to the matching implementation. Always
 * returns a typed `ToolResult` — failures are surfaced as
 * `isError: true` so the LLM can react instead of seeing a thrown
 * exception that the orchestrator would have to translate.
 */
export async function executeFileTool(
  call: ToolCall,
  projectRoot: string,
): Promise<ToolResult> {
  try {
    const result = await dispatch(call, projectRoot);
    return { toolCallId: call.id, content: result, isError: false };
  } catch (err) {
    return {
      toolCallId: call.id,
      content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

async function dispatch(call: ToolCall, root: string): Promise<string> {
  switch (call.name) {
    case 'readFile':
      return readFileImpl(stringInput(call.input, 'path'), root);
    case 'listDirectory':
      return listDirectoryImpl(stringInput(call.input, 'path'), root);
    case 'searchFiles':
      return searchFilesImpl(
        stringInput(call.input, 'pattern'),
        optionalStringInput(call.input, 'glob'),
        root,
      );
    case 'getFileTree':
      return getFileTreeImpl(
        root,
        Math.min(optionalNumberInput(call.input, 'maxDepth') ?? 3, MAX_TREE_DEPTH),
      );
    case 'executeScript': {
      const command = stringInput(call.input, 'command');
      const timeoutMs = optionalNumberInput(call.input, 'timeoutMs') ?? DEFAULT_SCRIPT_TIMEOUT_MS;
      const result = await executeScript(command, root, timeoutMs);
      return formatExecuteScriptResult(result);
    }
    default:
      throw new Error(`Unknown tool: ${call.name}`);
  }
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`Tool input '${key}' must be a non-empty string`);
  }
  return v;
}

function optionalStringInput(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function optionalNumberInput(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Resolves `inputPath` relative to `root` and rejects anything that
 * escapes the project tree. Returns the absolute path on success.
 */
function safePath(inputPath: string, root: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, inputPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + '/')) {
    throw new Error(`Path traversal blocked: ${inputPath}`);
  }
  return resolved;
}

async function readFileImpl(path: string, root: string): Promise<string> {
  const full = safePath(path, root);
  const content = await readFile(full, 'utf8');
  if (content.length > MAX_FILE_SIZE) {
    return (
      content.slice(0, MAX_FILE_SIZE) +
      `\n\n[File truncated — ${content.length} chars total, showing first ${MAX_FILE_SIZE}]`
    );
  }
  return content;
}

async function listDirectoryImpl(path: string, root: string): Promise<string> {
  const full = safePath(path, root);
  const entries = await readdir(full, { withFileTypes: true });
  const lines = entries
    .filter((e) => !IGNORED_DIRECTORIES.has(e.name))
    .sort((a, b) => {
      // directories first, then files
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`);
  return lines.length === 0 ? '(empty)' : lines.join('\n');
}

async function searchFilesImpl(
  pattern: string,
  glob: string | undefined,
  root: string,
): Promise<string> {
  // globby v14 is ESM-only — dynamic import is mandatory (ADR-038
  // constraint). Static import would break the CJS build.
  const { globby } = await import('globby');
  const files = await globby(glob ?? '**/*.{ts,js,json,md,yaml,yml}', {
    cwd: root,
    gitignore: true,
    dot: false,
    ignore: ['node_modules/**', 'dist/**', '.git/**', '.gestalt/**', 'coverage/**'],
  });

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    // Pattern isn't valid regex — fall back to literal substring match.
    regex = new RegExp(
      pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    );
  }

  const results: string[] = [];
  outer: for (const file of files) {
    try {
      const content = await readFile(join(root, file), 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          if (results.length >= MAX_SEARCH_RESULTS) break outer;
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return results.length > 0 ? results.join('\n') : 'No matches found';
}

async function getFileTreeImpl(root: string, maxDepth: number): Promise<string> {
  const lines: string[] = [];
  await walk(root, root, 0, maxDepth, lines);
  return lines.length === 0 ? '(empty)' : lines.join('\n');
}

async function walk(
  dir: string,
  root: string,
  depth: number,
  maxDepth: number,
  lines: string[],
): Promise<void> {
  if (depth > maxDepth) return;
  const entries = await readdir(dir, { withFileTypes: true });
  // directories first, then files, alphabetical within each group
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const rel = relative(root, join(dir, entry.name));
    void rel; // kept readable for future debugging; indent below carries the path
    const indent = '  '.repeat(depth);
    const glyph = entry.isDirectory() ? 'd' : 'f';
    lines.push(`${indent}${glyph} ${entry.name}`);
    if (entry.isDirectory()) {
      await walk(join(dir, entry.name), root, depth + 1, maxDepth, lines);
    }
  }
}

// ─── executeScript ─────────────────────────────────────────────────────────

/**
 * Execute a shell command in the project work-dir. Returns a
 * structured result with stdout / stderr / exit code / duration.
 *
 * Safety:
 *   - `command` is matched against `BLOCKED_PATTERNS` BEFORE any
 *     spawn. A match returns a synthetic failure result with the
 *     blocklist explanation in stderr; the command never runs.
 *   - The shell is /bin/sh (POSIX), invoked with `-c <command>` so
 *     simple pipelines, redirects, and variable expansion work as
 *     expected without re-implementing a parser.
 *   - cwd is pinned to the resolved `projectRoot`. The orchestrator
 *     already creates this as a per-cycle clone under `/tmp` — the
 *     command can write there, but a `cd` somewhere else just
 *     changes the child shell's cwd, not the host's.
 *   - Timeout-killed (SIGKILL after a 1-second SIGTERM grace). The
 *     `timeoutMs` is clamped to `MAX_SCRIPT_TIMEOUT_MS`.
 *
 * Output is truncated to MAX_SCRIPT_STDOUT / MAX_SCRIPT_STDERR
 * chars so a runaway command can't blow the LLM context.
 */
export async function executeScript(
  command: string,
  workDir: string,
  timeoutMs: number = DEFAULT_SCRIPT_TIMEOUT_MS,
): Promise<ExecuteScriptResult> {
  const effectiveTimeout = Math.min(Math.max(timeoutMs, 1), MAX_SCRIPT_TIMEOUT_MS);

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        stdout: '',
        stderr: `Blocked by platform safety rules (pattern ${pattern}): ${command}`,
        exitCode: 1,
        timedOut: false,
        durationMs: 0,
      };
    }
  }

  const startedAt = Date.now();

  return await new Promise<ExecuteScriptResult>((resolvePromise) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: workDir,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutTruncated) return;
      const remaining = MAX_SCRIPT_STDOUT - stdout.length;
      if (remaining <= 0) {
        stdoutTruncated = true;
        return;
      }
      const text = chunk.toString('utf8');
      stdout += text.length > remaining ? text.slice(0, remaining) : text;
      if (stdout.length >= MAX_SCRIPT_STDOUT) stdoutTruncated = true;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrTruncated) return;
      const remaining = MAX_SCRIPT_STDERR - stderr.length;
      if (remaining <= 0) {
        stderrTruncated = true;
        return;
      }
      const text = chunk.toString('utf8');
      stderr += text.length > remaining ? text.slice(0, remaining) : text;
      if (stderr.length >= MAX_SCRIPT_STDERR) stderrTruncated = true;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // 1-second grace for clean shutdown; SIGKILL after.
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 1000);
    }, effectiveTimeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({
        stdout: stdoutTruncated ? `${stdout}\n[stdout truncated at ${MAX_SCRIPT_STDOUT} chars]` : stdout,
        stderr: `${stderr}${stderr.length > 0 ? '\n' : ''}spawn error: ${err.message}`,
        exitCode: 1,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const finalStdout = stdoutTruncated
        ? `${stdout}\n[stdout truncated at ${MAX_SCRIPT_STDOUT} chars]`
        : stdout;
      const finalStderr = stderrTruncated
        ? `${stderr}\n[stderr truncated at ${MAX_SCRIPT_STDERR} chars]`
        : stderr;
      resolvePromise({
        stdout: finalStdout,
        stderr: timedOut ? `${finalStderr}\n[timed out after ${effectiveTimeout}ms]` : finalStderr,
        exitCode: code ?? (timedOut ? 124 : 1),
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

/**
 * Format an ExecuteScriptResult as the tool-result body fed back to
 * the LLM. Layout is compact + scannable: exit code on the first
 * line, duration on the second, then stdout / stderr blocks.
 */
function formatExecuteScriptResult(r: ExecuteScriptResult): string {
  const parts: string[] = [];
  parts.push(`exitCode: ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}`);
  parts.push(`durationMs: ${r.durationMs}`);
  if (r.stdout.length > 0) {
    parts.push('--- stdout ---');
    parts.push(r.stdout);
  } else {
    parts.push('--- stdout --- (empty)');
  }
  if (r.stderr.length > 0) {
    parts.push('--- stderr ---');
    parts.push(r.stderr);
  } else {
    parts.push('--- stderr --- (empty)');
  }
  return parts.join('\n');
}

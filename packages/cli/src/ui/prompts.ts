/**
 * Terminal UI helpers.
 *
 * Uses chalk for colours, ora for spinners, and readline for prompts.
 * Keeps the CLI feel fast, clear, and informative.
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import * as readline from 'readline';
import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ─── Colours ──────────────────────────────────────────────────────────────────

export const c = {
  title:   (s: string) => chalk.bold.white(s),
  success: (s: string) => chalk.green(s),
  warn:    (s: string) => chalk.yellow(s),
  error:   (s: string) => chalk.red(s),
  info:    (s: string) => chalk.cyan(s),
  dim:     (s: string) => chalk.dim(s),
  bold:    (s: string) => chalk.bold(s),
  agent:   (s: string) => chalk.magenta(s),
  signal:  (s: string, severity: string) => {
    if (severity === 'critical') return chalk.bgRed.white(` ${s} `);
    if (severity === 'high') return chalk.red(s);
    if (severity === 'medium') return chalk.yellow(s);
    return chalk.dim(s);
  },
};

// ─── Dividers ─────────────────────────────────────────────────────────────────

export const divider = () => console.log(chalk.dim('─'.repeat(56)));
export const blank = () => console.log();

// ─── Banner ───────────────────────────────────────────────────────────────────

export function printBanner(): void {
  blank();
  console.log(chalk.bold.white('  Gestalt'));
  console.log(chalk.dim('  Agent-first software development platform'));
  divider();
  blank();
}

// ─── Status badges ────────────────────────────────────────────────────────────

export function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    'pending':                    chalk.dim('○ pending'),
    'generating':                 chalk.cyan('◎ generating'),
    'in-review':                  chalk.yellow('◉ in-review'),
    'approved':                   chalk.green('● approved'),
    'deploying':                  chalk.blue('◎ deploying'),
    'deployed':                   chalk.green('✓ deployed'),
    'failed':                     chalk.red('✗ failed'),
    'escalated':                  chalk.bgRed.white(' ! escalated '),
    'waiting-for-clarification':  chalk.yellow('? needs clarification'),
  };
  return badges[status] ?? chalk.dim(status);
}

export function priorityBadge(priority: string): string {
  const badges: Record<string, string> = {
    'critical': chalk.bgRed.white(' CRITICAL '),
    'high':     chalk.red('HIGH'),
    'normal':   chalk.dim('normal'),
    'low':      chalk.dim('low'),
  };
  return badges[priority] ?? priority;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function createSpinner(text: string): Ora {
  return ora({ text, color: 'cyan' });
}

// ─── Input ────────────────────────────────────────────────────────────────────

export async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${chalk.cyan('?')} ${question} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptSecret(question: string): Promise<string> {
  // Hide input for passwords/API keys
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    process.stdout.write(`${chalk.cyan('?')} ${question} `);

    let input = '';
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const handler = (char: string) => {
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        rl.close();
        resolve(input);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007f') {
        input = input.slice(0, -1);
      } else {
        input += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', handler);
  });
}

/**
 * Buffered line reader. Attaches one `line` listener for the
 * lifetime of the readline interface — that's necessary because
 * readline emits `line` events as soon as bytes arrive, regardless
 * of whether the consumer is currently awaiting. With piped stdin,
 * registering a listener per-prompt would lose every line that
 * arrived between prompts.
 *
 * `next()` returns the head of the buffer if a line is already
 * queued, otherwise it waits for the next `line` event. On EOF it
 * resolves with `null`.
 */
interface BufferedReader {
  next(): Promise<string | null>;
}

function makeBufferedReader(rl: readline.Interface): BufferedReader {
  const queue: string[] = [];
  const waiters: Array<(line: string | null) => void> = [];
  let closed = false;
  rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()!(null);
  });
  return {
    next(): Promise<string | null> {
      if (queue.length) return Promise.resolve(queue.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

/**
 * END-terminated multi-line input. Lines are collected verbatim
 * until the operator types `END` (case-insensitive) on a line by
 * itself, or stdin closes (EOF). Returns the joined body with no
 * trailing newline.
 *
 * Used for description-style fields where the operator wants more
 * than a single line of text. `fieldName` is shown in the header;
 * `hint` is optional context shown above the prompt.
 */
export async function promptMultiline(
  fieldName: string,
  hint?: string,
): Promise<string> {
  console.log(`${chalk.cyan('?')} ${fieldName}`);
  if (hint) console.log(chalk.dim(hint));
  console.log(chalk.dim('  (type END on a new line to finish)'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  const reader = makeBufferedReader(rl);
  const lines: string[] = [];
  while (true) {
    const line = await reader.next();
    if (line === null) break;
    if (line.trim().toUpperCase() === 'END') break;
    lines.push(line);
  }
  rl.close();
  return lines.join('\n').trim();
}

/**
 * Open the operator's `$EDITOR` (or `vi`) to compose a multi-line
 * value. Returns the content with `#`-prefixed comment lines
 * stripped (same convention as Git commit messages).
 *
 * `initial` is written to the temp file so the editor opens
 * pre-populated. Useful for templated prompts that want the
 * operator to fill in placeholders rather than start from blank.
 *
 * Falls back to `promptMultiline` when the editor binary can't
 * launch — operators on minimal images (no `$EDITOR` set, no
 * `vi`) still get a working multi-line capture.
 */
export async function promptWithEditor(
  fieldName: string,
  initial = '',
): Promise<string> {
  const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'vi';
  const dir = mkdtempSync(join(tmpdir(), 'gestalt-prompt-'));
  const slug = fieldName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'value';
  const file = join(dir, `${slug}.txt`);
  const body = initial && initial.length > 0
    ? initial
    : `# Enter ${fieldName} below. Lines starting with '#' are ignored.\n# Save and close the editor when done.\n\n`;
  writeFileSync(file, body, 'utf8');

  const result = spawnSync(editor, [file], { stdio: 'inherit' });
  if (result.error || (typeof result.status === 'number' && result.status !== 0)) {
    console.log(c.warn(`Could not launch ${editor}. Falling back to END-terminated input.`));
    try { unlinkSync(file); } catch { /* best-effort */ }
    return promptMultiline(fieldName);
  }

  const raw = readFileSync(file, 'utf8');
  try { unlinkSync(file); } catch { /* best-effort */ }
  return raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

/**
 * Three-mode description prompt:
 *   (1) single line  (backwards compatible)
 *   (2) multi-line   (END sentinel — works on any TTY, no editor needed)
 *   (3) editor       (opens $EDITOR for full text editing)
 *
 * The default is (1) so existing single-line workflows keep working
 * with one Enter press. Empty input is treated as the default. Any
 * other input falls back to single-line mode.
 *
 * Shares one readline interface across the choice prompt and the
 * subsequent capture so it behaves under piped stdin too (a fresh
 * interface per call drains buffered bytes from the prior one).
 */
export async function promptMultilineDescription(
  fieldName: string,
  hint?: string,
): Promise<string> {
  blank();
  console.log(`${chalk.cyan('?')} ${fieldName}`);
  if (hint) console.log(chalk.dim(hint));
  console.log(chalk.dim('  (1) Single line'));
  console.log(chalk.dim('  (2) Multi-line (END to finish)'));
  console.log(chalk.dim('  (3) Open in $EDITOR'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  const reader = makeBufferedReader(rl);

  process.stdout.write(`${chalk.cyan('?')} Choice [1] `);
  const choice = ((await reader.next()) ?? '').trim() || '1';

  if (choice === '3') {
    rl.close();
    return promptWithEditor(fieldName);
  }

  if (choice === '2') {
    console.log(`${chalk.cyan('?')} ${fieldName}`);
    console.log(chalk.dim('  (type END on a new line to finish)'));
    const lines: string[] = [];
    while (true) {
      const line = await reader.next();
      if (line === null) break;
      if (line.trim().toUpperCase() === 'END') break;
      lines.push(line);
    }
    rl.close();
    return lines.join('\n').trim();
  }

  process.stdout.write(`${chalk.cyan('?')} ${fieldName} `);
  const single = (await reader.next()) ?? '';
  rl.close();
  return single.trim();
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await prompt(`${question} (${hint})`);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

export async function select(
  question: string,
  options: Array<{ label: string; value: string }>,
): Promise<string> {
  console.log(`${chalk.cyan('?')} ${question}`);
  options.forEach((opt, i) => {
    console.log(`  ${chalk.dim(`${i + 1}.`)} ${opt.label}`);
  });

  while (true) {
    const answer = await prompt(`Enter number (1-${options.length})`);
    const index = parseInt(answer, 10) - 1;
    if (index >= 0 && index < options.length) {
      return options[index].value;
    }
    console.log(c.error(`Please enter a number between 1 and ${options.length}`));
  }
}

// ─── Tables ───────────────────────────────────────────────────────────────────

/**
 * ANSI escape regex — matches CSI `m`-terminated SGR sequences
 * (colour / style). Constructed from a String.fromCharCode call so
 * the literal ESC byte (0x1B) doesn't need to live in source text
 * (some tools strip it on save). Captures every common chalk
 * output (`[31m`, `[1m`, `[39m`, `[0m`, etc.).
 */
const ESC = String.fromCharCode(0x1b);
const ANSI_REGEX = new RegExp(ESC + '\\[[0-9;]*m', 'g');

function visualLength(s: string): number {
  return s.replace(ANSI_REGEX, '').length;
}

/** Right-pads `s` to `width` visible columns, ignoring ANSI codes. */
function visualPadEnd(s: string, width: number): string {
  const len = visualLength(s);
  if (len >= width) return s;
  return s + ' '.repeat(width - len);
}

/**
 * Truncates `s` to `width` visible columns while preserving any
 * embedded ANSI escape sequences. If `s` fits, returns it unchanged;
 * otherwise appends an ANSI reset so cut-off colour doesn't bleed
 * into the next column.
 *
 * Plain `.slice(0, width)` is broken for coloured strings — it
 * counts the 4-9 escape bytes (e.g. `[32m` = 5 chars) toward the
 * visible width, so a short value with colour codes can lose its
 * actual visible character entirely. That was the bug behind the
 * report of "first char of name missing": `c.success('*')` is 10
 * raw chars; `slice(0, width - 1)` on a 3-wide column cut to
 * `[32m` plus a broken trailing `[`, dropping the `*` and
 * confusing the terminal's escape parser into consuming the next
 * column's first character.
 */
function visualTruncate(s: string, width: number): string {
  if (visualLength(s) <= width) return s;
  const ansiPattern = new RegExp('^' + ESC + '\\[[0-9;]*m');
  let out = '';
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < width) {
    if (s[i] === ESC && s[i + 1] === '[') {
      const tail = s.slice(i).match(ansiPattern);
      if (tail) {
        out += tail[0];
        i += tail[0].length;
        continue;
      }
    }
    out += s[i];
    visible++;
    i++;
  }
  return out + ESC + '[0m';
}

export function printTable(
  rows: Array<Record<string, string>>,
  columns: Array<{ key: string; header: string; width?: number }>,
): void {
  // Print header (no ANSI on headers — plain padEnd is fine)
  const header = columns
    .map((col) => col.header.padEnd(col.width ?? 20))
    .join('  ');
  console.log(chalk.bold(header));
  divider();

  // Print rows — visual-length-aware truncation + padding so chalk
  // colour codes don't get cut mid-escape (which made the terminal
  // either eat the actual visible character OR leak colour into
  // subsequent columns).
  for (const row of rows) {
    const line = columns
      .map((col) => {
        const width = col.width ?? 20;
        const raw = row[col.key] ?? '';
        return visualPadEnd(visualTruncate(raw, width), width);
      })
      .join('  ');
    console.log(line);
  }
}

// ─── Warning banner ───────────────────────────────────────────────────────────

export function printLocalAuthWarning(): void {
  blank();
  console.log(chalk.bgYellow.black(' ⚠  LOCAL AUTHENTICATION ACTIVE '));
  console.log(chalk.yellow('   This mode is not recommended for production.'));
  console.log(chalk.dim('   Configure a corporate IdP in HARNESS.json to remove this warning.'));
  blank();
}

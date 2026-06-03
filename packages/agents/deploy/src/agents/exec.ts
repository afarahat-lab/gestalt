/**
 * Controlled child-process invocation for package-manager commands
 * called by the deploy / maintenance agents (currently: `pnpm install`
 * after pr-agent writes generated artifacts so the PR carries a
 * `pnpm-lock.yaml` consistent with `package.json`).
 *
 * Uses `spawn` (not `exec`) — no shell, explicit `cmd` + `args`, hard
 * timeout. The ADR-032 prohibition against `child_process.exec('git
 * ...')` applies to Git operations specifically (those must go through
 * `simple-git`); package-manager execution is a separate concern with
 * a different threat model — pnpm is a known tool, the arguments are
 * fixed at the call site, and the working directory is a per-cycle
 * clone the platform created.
 *
 * The helper resolves on exit code 0. Non-zero exit, spawn error, or
 * timeout reject with a human-readable Error. Callers wrap the
 * invocation in their own try/catch so a lockfile-sync failure
 * doesn't block the commit — CI may still pass if the lockfile was
 * already up to date.
 */

import { spawn } from 'child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs `cmd args...` in `cwd` and resolves when the process exits
 * with code 0. The default 2-minute timeout is generous — a typical
 * `pnpm install` takes 10–30 s; we leave headroom for projects with
 * many dependencies and slow registry mirrors.
 */
export function execCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Surface a short tail of stderr — sufficient to debug the
        // common cases (missing binary, registry unreachable, OOM)
        // without spamming the agent log with full pnpm output.
        const tail = stderr.trim().slice(-400);
        reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}${tail ? `: ${tail}` : ''}`));
      }
    });
  });
}

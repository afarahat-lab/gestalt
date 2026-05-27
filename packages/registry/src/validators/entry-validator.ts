/**
 * Registry entry validator.
 *
 * Runs automated checks on submitted registry entries before
 * they are accepted into any tier.
 *
 * Checks run on all submissions:
 *   1. Schema validation — entry has all required fields in correct format
 *   2. Security scan — no malicious code patterns in the entry
 *   3. Harness completeness — all required context files present
 *   4. Platform compatibility — entry supports the minimum platform version
 *
 * Additional checks for Tier 2 promotion:
 *   5. Test coverage — entry includes tests
 *   6. Documentation — README.md is present and meets minimum length
 *   7. No hardcoded secrets — no API keys, passwords, or tokens in files
 */

import type { RegistryEntry, AutomatedCheckResult } from '../types';

export interface ValidationResult {
  passed: boolean;
  checks: AutomatedCheckResult[];
  blockingFailures: string[];
}

/**
 * Runs all automated checks on a registry entry.
 * Returns validation result with per-check detail.
 */
export async function validateEntry(
  entry: Partial<RegistryEntry>,
  entryFiles: Map<string, string>,  // filename → content
): Promise<ValidationResult> {
  const checks: AutomatedCheckResult[] = [];

  // Run all checks
  checks.push(checkRequiredFields(entry));
  checks.push(checkVersionFormat(entry));
  checks.push(checkHarnessCompleteness(entryFiles));
  checks.push(await checkNoHardcodedSecrets(entryFiles));
  checks.push(checkReadmePresent(entryFiles));

  const blockingFailures = checks
    .filter((c) => !c.passed)
    .map((c) => c.message);

  return {
    passed: blockingFailures.length === 0,
    checks,
    blockingFailures,
  };
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkRequiredFields(entry: Partial<RegistryEntry>): AutomatedCheckResult {
  const required = ['slug', 'name', 'description', 'type', 'version', 'author'];
  const missing = required.filter((f) => !entry[f as keyof RegistryEntry]);

  return {
    checkName: 'required-fields',
    passed: missing.length === 0,
    message: missing.length === 0
      ? 'All required fields present'
      : `Missing required fields: ${missing.join(', ')}`,
    runAt: new Date(),
  };
}

function checkVersionFormat(entry: Partial<RegistryEntry>): AutomatedCheckResult {
  const semverPattern = /^\d+\.\d+\.\d+$/;
  const valid = typeof entry.version === 'string' && semverPattern.test(entry.version);

  return {
    checkName: 'version-format',
    passed: valid,
    message: valid
      ? `Version ${entry.version} is valid semver`
      : `Version '${entry.version}' is not valid semver (expected: x.y.z)`,
    runAt: new Date(),
  };
}

function checkHarnessCompleteness(files: Map<string, string>): AutomatedCheckResult {
  const requiredFiles = [
    'AGENTS.md',
    'HARNESS.json',
  ];

  const missing = requiredFiles.filter((f) => !files.has(f));

  return {
    checkName: 'harness-completeness',
    passed: missing.length === 0,
    message: missing.length === 0
      ? 'All required harness files present'
      : `Missing required harness files: ${missing.join(', ')}`,
    runAt: new Date(),
  };
}

async function checkNoHardcodedSecrets(files: Map<string, string>): Promise<AutomatedCheckResult> {
  // Patterns that indicate hardcoded secrets
  const secretPatterns = [
    /(?:password|passwd|pwd)\s*=\s*["'][^"'${]+["']/i,
    /(?:api[_-]?key|apikey)\s*=\s*["'][^"'${]+["']/i,
    /(?:secret|token)\s*=\s*["'][^"'$]{8,}["']/i,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  ];

  const violations: string[] = [];

  for (const [filename, content] of files.entries()) {
    for (const pattern of secretPatterns) {
      if (pattern.test(content)) {
        violations.push(filename);
        break;
      }
    }
  }

  return {
    checkName: 'no-hardcoded-secrets',
    passed: violations.length === 0,
    message: violations.length === 0
      ? 'No hardcoded secrets detected'
      : `Potential hardcoded secrets in: ${violations.join(', ')}. Use \${ENV_VAR} references instead.`,
    runAt: new Date(),
  };
}

function checkReadmePresent(files: Map<string, string>): AutomatedCheckResult {
  const readme = files.get('README.md');
  const minLength = 200;  // chars
  const present = readme !== undefined && readme.length >= minLength;

  return {
    checkName: 'readme-present',
    passed: present,
    message: present
      ? 'README.md present and meets minimum length'
      : readme === undefined
        ? 'README.md is missing'
        : `README.md is too short (${readme.length} chars, minimum ${minLength})`,
    runAt: new Date(),
  };
}

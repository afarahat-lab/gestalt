/**
 * @gestalt/core/secrets/vault
 *
 * AES-256-GCM encryption for the platform secrets store (migration 015).
 * The master key is loaded ONCE at server boot — never read from any
 * route handler. Every encryption uses a fresh 96-bit IV (the
 * GCM-recommended size). The auth tag is persisted alongside the
 * ciphertext so decryption can verify integrity.
 *
 * Master key sources, in order:
 *   1. `GESTALT_MASTER_KEY` env var (base64-encoded 32 bytes)
 *   2. `/etc/gestalt/master.key` (the docker-compose mount point)
 *   3. `<cwd>/master.key` (the dev-mode auto-generated file)
 *
 * In NON-production with no key found, a fresh key is generated and
 * written to `./master.key` with a loud console warning. In production
 * a missing key is a fatal startup error — losing access to encrypted
 * secrets is preferable to silently using a fresh key (which would
 * make every existing secret undecryptable).
 *
 * The key MUST be 32 bytes (256 bits). Loaders verify this and throw
 * if the supplied value decodes to a different length.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;        // AES-256
const IV_BYTES = 12;         // GCM standard 96-bit IV
const AUTH_TAG_BYTES = 16;   // GCM standard 128-bit tag

/**
 * Loads the master key from the documented sources in order.
 * Returns a `Buffer` of exactly KEY_BYTES; throws otherwise.
 */
export async function loadMasterKey(): Promise<Buffer> {
  // 1. Env var — preferred in production where the key lives in a
  //    secret manager and is injected as an env var at start time.
  const envKey = process.env['GESTALT_MASTER_KEY'];
  if (envKey && envKey.trim()) {
    const decoded = Buffer.from(envKey.trim(), 'base64');
    if (decoded.length !== KEY_BYTES) {
      throw new Error(
        `GESTALT_MASTER_KEY decodes to ${decoded.length} bytes; expected ${KEY_BYTES}`,
      );
    }
    return decoded;
  }

  // 2. Mounted file — preferred for docker-compose / Kubernetes
  //    deployments where the key is supplied as a tmpfs-mounted file.
  const candidates = [
    '/etc/gestalt/master.key',
    join(process.cwd(), 'master.key'),
  ];
  for (const path of candidates) {
    try {
      const raw = (await readFile(path, 'utf8')).trim();
      if (!raw) continue;
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length !== KEY_BYTES) {
        throw new Error(
          `Master key at ${path} decodes to ${decoded.length} bytes; expected ${KEY_BYTES}`,
        );
      }
      return decoded;
    } catch (err) {
      // ENOENT and "file empty" both fall through to the next
      // candidate. Length-validation errors above are rethrown so a
      // corrupt key file produces a loud failure instead of being
      // silently replaced.
      if (err instanceof Error && /decodes to/.test(err.message)) throw err;
    }
  }

  // 3. Dev-only auto-generate. In production this branch fails fast
  //    with an actionable error so an operator never accidentally
  //    starts the server with a key that can't decrypt existing
  //    secrets.
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'No master key found. Set the GESTALT_MASTER_KEY env var (base64 of 32 random ' +
      'bytes) or mount a key file at /etc/gestalt/master.key. ' +
      'Losing the master key means all stored secrets become unrecoverable — back it up.',
    );
  }
  const key = randomBytes(KEY_BYTES);
  const { writeFile } = await import('fs/promises');
  await writeFile('./master.key', key.toString('base64') + '\n', { mode: 0o600 });
  console.warn(
    '⚠  Generated a new master.key in the current directory.\n' +
    '   This key encrypts all platform secrets.\n' +
    '   Back it up before adding any secret; set GESTALT_MASTER_KEY in production.',
  );
  return key;
}

/**
 * The persistable shape of an encrypted value — all base64 strings
 * so they can be stored in `TEXT` columns and round-tripped through
 * JSON without binary handling.
 */
export interface EncryptedSecret {
  encrypted: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts `value` under `masterKey`. Always uses a FRESH IV (96 bits
 * of randomness) — never reuses one. The auth tag is returned
 * alongside so `decryptSecret` can verify integrity.
 */
export function encryptSecret(value: string, masterKey: Buffer): EncryptedSecret {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error(`master key must be ${KEY_BYTES} bytes; got ${masterKey.length}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(`GCM auth tag was ${authTag.length} bytes; expected ${AUTH_TAG_BYTES}`);
  }
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypts `secret` under `masterKey`. Throws if the auth tag check
 * fails (which it will for any tampered ciphertext OR a wrong key).
 * The thrown error message INTENTIONALLY does not include the
 * ciphertext or the underlying GCM error detail — only "decryption
 * failed: bad key or corrupt data" so an unauthorised caller can't
 * use error messages as a side channel.
 */
export function decryptSecret(secret: EncryptedSecret, masterKey: Buffer): string {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error(`master key must be ${KEY_BYTES} bytes; got ${masterKey.length}`);
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      masterKey,
      Buffer.from(secret.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.encrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('decryption failed: bad key or corrupt data');
  }
}

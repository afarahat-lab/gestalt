/**
 * Master-key holder — module-scope cache for the AES-256 key loaded
 * once at server boot.
 *
 * Set once in `server.ts` step 1 via `setMasterKey`. Every route
 * handler that needs to encrypt or decrypt a secret calls
 * `getMasterKey()`. The lookup is sync (no `await`) so route
 * handlers don't have to plumb async-ness through their flow.
 *
 * Calling `getMasterKey()` before `setMasterKey()` throws — this is
 * intentional, the server should be fully initialised before any
 * route can run. In practice the auth middleware short-circuits
 * unauthorised requests before any handler would call this; the
 * throw is a defence-in-depth guard.
 */

let _masterKey: Buffer | null = null;

export function setMasterKey(key: Buffer): void {
  _masterKey = key;
}

export function getMasterKey(): Buffer {
  if (!_masterKey) {
    throw new Error(
      'Master key not initialised. setMasterKey must be called at server startup ' +
      'before any vault operation.',
    );
  }
  return _masterKey;
}

/** Test/debug helper — clears the cached key. */
export function _resetMasterKey(): void {
  _masterKey = null;
}

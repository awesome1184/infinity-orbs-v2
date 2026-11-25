import { redis } from './devvit-mock.js';
import { compressStorageString, decompressStorageString } from './storage-compression.js';

const LARGE_VALUE_CHUNK_PREFIX = 'io:large-value-chunk:v1:';
const LARGE_VALUE_CHUNK_CHARS = 64 * 1024;
const LARGE_VALUE_INLINE_CHARS = 192 * 1024;
const LARGE_VALUE_MAX_CHUNKS = 128;
const LARGE_VALUE_MAX_CHARS = LARGE_VALUE_CHUNK_CHARS * LARGE_VALUE_MAX_CHUNKS;
const LARGE_VALUE_RETIRED_TTL_SECONDS = 60;

type LargeValueManifest = {
  __ioLargeValueManifest: 1;
  namespaceHash: string;
  token: string;
  chunkCount: number;
  length: number;
  checksum: string;
};

export type RedisLargeValueWritePlan = {
  storedValue: string;
  chunkKeys: string[];
};

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function checksum(value: string): string {
  return hashText(value);
}

function secureLargeValueToken(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure Redis chunk identifiers are unavailable.');
}

function parseLargeValueManifest(
  namespaceKey: string,
  raw: string | null | undefined,
): LargeValueManifest | null {
  if (typeof raw !== 'string' || !raw.startsWith('{"__ioLargeValueManifest":1')) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const manifest: LargeValueManifest = {
      __ioLargeValueManifest: 1,
      namespaceHash: String(value.namespaceHash ?? ''),
      token: String(value.token ?? ''),
      chunkCount: Number(value.chunkCount),
      length: Number(value.length),
      checksum: String(value.checksum ?? ''),
    };
    if (
      manifest.namespaceHash !== hashText(namespaceKey) ||
      !/^[a-zA-Z0-9-]{8,120}$/.test(manifest.token) ||
      !Number.isSafeInteger(manifest.chunkCount) ||
      manifest.chunkCount < 1 ||
      manifest.chunkCount > LARGE_VALUE_MAX_CHUNKS ||
      !Number.isSafeInteger(manifest.length) ||
      manifest.length <= LARGE_VALUE_INLINE_CHARS ||
      manifest.length > LARGE_VALUE_MAX_CHARS ||
      !/^[a-f0-9]{8}$/.test(manifest.checksum)
    ) {
      throw new Error('Invalid large-value manifest.');
    }
    return manifest;
  } catch (error) {
    console.error('[Redis Large Value] Invalid chunk manifest:', error);
    throw new Error('A large shared-data record could not be read safely.');
  }
}

function chunkKeysFor(namespaceKey: string, manifest: LargeValueManifest): string[] {
  return Array.from(
    { length: manifest.chunkCount },
    (_, index) =>
      LARGE_VALUE_CHUNK_PREFIX +
      manifest.namespaceHash +
      ':' +
      manifest.token +
      ':' +
      String(index).padStart(3, '0'),
  );
}

/**
 * Store large JSON/text values in small immutable records. The caller atomically
 * swaps the small manifest pointer inside its existing WATCH/MULTI transaction.
 * Legacy inline strings remain readable without a migration window.
 */
export async function createRedisLargeValueWritePlan(
  namespaceKey: string,
  serialized: string,
): Promise<RedisLargeValueWritePlan> {
  if (serialized.length > LARGE_VALUE_MAX_CHARS) {
    throw new Error('Shared data exceeds the supported 8 MiB logical size; no changes were written.');
  }
  const storedPayload = compressStorageString(serialized);
  if (storedPayload.length <= LARGE_VALUE_INLINE_CHARS) return { storedValue: storedPayload, chunkKeys: [] };
  if (storedPayload.length > LARGE_VALUE_MAX_CHARS) {
    throw new Error('Shared data exceeds the supported 8 MiB stored size; no changes were written.');
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < storedPayload.length;) {
    let end = Math.min(storedPayload.length, offset + LARGE_VALUE_CHUNK_CHARS);
    if (end < storedPayload.length && storedPayload.charCodeAt(end - 1) >= 0xd800 &&
        storedPayload.charCodeAt(end - 1) <= 0xdbff) end -= 1;
    chunks.push(storedPayload.slice(offset, end));
    offset = end;
  }
  if (chunks.length < 1 || chunks.length > LARGE_VALUE_MAX_CHUNKS) {
    throw new Error('Shared data requires too many Redis records; no changes were written.');
  }
  const token = secureLargeValueToken();
  const namespaceHash = hashText(namespaceKey);
  const manifest: LargeValueManifest = {
    __ioLargeValueManifest: 1, namespaceHash, token,
    chunkCount: chunks.length, length: storedPayload.length, checksum: checksum(storedPayload),
  };
  const chunkKeys = chunkKeysFor(namespaceKey, manifest);
  try {
    for (let offset = 0; offset < chunks.length; offset += 8) {
      await Promise.all(chunks.slice(offset, offset + 8).map((chunk, localIndex) =>
        redis.set(chunkKeys[offset + localIndex], chunk),
      ));
    }
  } catch (error) {
    await discardRedisLargeValueWritePlan({ storedValue: '', chunkKeys });
    throw error;
  }
  return { storedValue: JSON.stringify(manifest), chunkKeys };
}

export async function readRedisLargeValue(
  namespaceKey: string,
  storedValue: unknown,
): Promise<string | null> {
  if (storedValue == null) return null;
  if (typeof storedValue !== 'string') {
    throw new Error('A shared-data record has an unsupported Redis value type.');
  }
  const manifest = parseLargeValueManifest(namespaceKey, storedValue);
  if (!manifest) return decompressStorageString(storedValue);

  const keys = chunkKeysFor(namespaceKey, manifest);
  const chunks: string[] = [];
  for (let offset = 0; offset < keys.length; offset += 8) {
    const values = await redis.mGet(keys.slice(offset, offset + 8));
    if (!Array.isArray(values)) {
      throw new Error('A shared-data chunk batch could not be read.');
    }
    for (const value of values) {
      if (typeof value !== 'string') {
        throw new Error('A shared-data chunk is missing; refusing to overwrite the record.');
      }
      chunks.push(value);
    }
  }

  const joined = chunks.join('');
  if (joined.length !== manifest.length || checksum(joined) !== manifest.checksum) {
    throw new Error('A shared-data record failed its length/checksum validation.');
  }
  return decompressStorageString(joined);
}

/** Keep old chunks readable briefly for requests that fetched the prior pointer. */
export async function retireRedisLargeValue(
  namespaceKey: string,
  previousStoredValue: unknown,
): Promise<void> {
  const manifest = parseLargeValueManifest(
    namespaceKey,
    typeof previousStoredValue === 'string' ? previousStoredValue : null,
  );
  if (!manifest) return;
  const keys = chunkKeysFor(namespaceKey, manifest);
  for (let offset = 0; offset < keys.length; offset += 8) {
    await Promise.all(
      keys.slice(offset, offset + 8).map(async key => {
        try {
          if (typeof redis.expire === 'function') {
            await redis.expire(key, LARGE_VALUE_RETIRED_TTL_SECONDS);
          } else {
            const value = await redis.get(key);
            if (typeof value === 'string') {
              await redis.set(key, value, {
                expiration: new Date(Date.now() + LARGE_VALUE_RETIRED_TTL_SECONDS * 1_000),
              });
            }
          }
        } catch (error) {
          console.warn('[Redis Large Value] Previous chunk could not be retired; its TTL may need cleanup:', error);
        }
      }),
    );
  }
}

/** Remove chunks written for a manifest that lost its WATCH/EXEC race. */
export async function discardRedisLargeValueWritePlan(
  plan: RedisLargeValueWritePlan,
): Promise<void> {
  for (let offset = 0; offset < plan.chunkKeys.length; offset += 8) {
    await Promise.all(
      plan.chunkKeys.slice(offset, offset + 8).map(async key => {
        try {
          await redis.del(key);
        } catch (error) {
          console.warn('[Redis Large Value] Uncommitted chunk could not be removed:', key, error);
        }
      }),
    );
  }
}

import { context, redis } from './devvit-mock.js';

const PLAYER_MUTATION_LOCK_PREFIX = 'io:player-mutation-lock:';
const PLAYER_MUTATION_LOCK_TTL_MS = 90_000;
const PLAYER_MUTATION_LOCK_ATTEMPTS = 360;

// Requests handled by the same runtime instance are serialized locally before
// they ever contend for the distributed Redis lock. Redis still protects
// concurrent requests handled by different server runtimes.
const localMutationTails = new Map<string, Promise<void>>();

function lockUserId(userId?: string): string {
  const id = String(userId ?? context.userId ?? '').trim();
  if (!id) throw new Error('REDDIT_LOGIN_REQUIRED');
  return id;
}

function randomUint32(): number {
  const sample = new Uint32Array(1);
  globalThis.crypto.getRandomValues(sample);
  return sample[0];
}

/**
 * Delete the lease only if it is still ours at commit time. A plain GET
 * followed by DEL is unsafe: the lease can expire and another runtime can
 * acquire the same key between those commands.
 */
async function releaseDistributedLock(lockKey: string, token: string): Promise<void> {
  const txn = await redis.watch(lockKey);
  const currentOwner = await redis.get(lockKey);
  if (currentOwner !== token) {
    await txn.unwatch();
    return;
  }

  await txn.multi();
  await txn.del(lockKey);
  // A null EXEC means the watched key changed; in that case do not retry a
  // blind DEL, because the replacement lease may belong to another runtime.
  await txn.exec();
}

export async function withPlayerMutationLockFor<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const id = lockUserId(userId);

  // Serialize same-player operations in this runtime first. This makes
  // normal click bursts and background mutations deterministic locally.
  const previous = localMutationTails.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  localMutationTails.set(id, tail);

  await previous;

  const lockKey = PLAYER_MUTATION_LOCK_PREFIX + id;
  const token = `lock-${Date.now().toString(36)}-${randomUint32().toString(36)}`;

  try {
    for (let attempt = 0; attempt < PLAYER_MUTATION_LOCK_ATTEMPTS; attempt++) {
      await redis.set(lockKey, token, {
        nx: true,
        expiration: new Date(Date.now() + PLAYER_MUTATION_LOCK_TTL_MS),
      });

      const owner = await redis.get(lockKey);
      if (owner === token) {
        try {
          return await fn();
        } finally {
          await releaseDistributedLock(lockKey, token);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 25));
    }

    throw new Error('Player state is busy. Please retry.');
  } finally {
    release();

    // A newer queued mutation may already have replaced this entry.
    if (localMutationTails.get(id) === tail) {
      localMutationTails.delete(id);
    }
  }
}

export async function withPlayerMutationLock<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return withPlayerMutationLockFor(lockUserId(), fn);
}

import { context, redis } from './devvit-mock.js';

const PLAYER_MUTATION_LOCK_PREFIX = 'io:player-mutation-lock:';
const PLAYER_MUTATION_LOCK_TTL_MS = 90_000;
const PLAYER_MUTATION_LOCK_ATTEMPTS = 360;
const PLAYER_MUTATION_LOCK_RETRY_MS = 25;

export interface PlayerMutationLockTransaction {
  multi(): Promise<unknown>;
  set(key: string, value: string, options?: { expiration?: Date }): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  exec(): Promise<unknown>;
  unwatch(): Promise<unknown>;
}

export interface PlayerMutationLockRedis {
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; expiration?: Date },
  ): Promise<unknown>;
  get(key: string): Promise<string | null | undefined>;
  watch(...keys: string[]): Promise<PlayerMutationLockTransaction>;
}

export interface PlayerMutationLockRuntimeOptions {
  /** Shortened values support deterministic lock-lease regression tests. */
  leaseTtlMs?: number;
  acquisitionAttempts?: number;
  retryDelayMs?: number;
  /** Override the renewal cadence for deterministic lease-renewal tests. */
  renewalIntervalMs?: number;
}

function lockUserId(userId: string | undefined, fallbackUserId: string | undefined): string {
  const id = String(userId ?? fallbackUserId ?? '').trim();
  if (!id) throw new Error('REDDIT_LOGIN_REQUIRED');
  return id;
}

function randomUint32(): number {
  const sample = new Uint32Array(1);
  globalThis.crypto.getRandomValues(sample);
  return sample[0];
}

/**
 * Creates one runtime-local coordinator backed by a shared Redis lease.
 * Multiple runtime instances have separate in-process queues and fencing-token
 * maps, but coordinate ownership using the same Redis client.
 */
export function createPlayerMutationLockRuntime(
  getRedis: () => PlayerMutationLockRedis,
  getContextUserId: () => string | undefined,
  options: PlayerMutationLockRuntimeOptions = {},
) {
  const localMutationTails = new Map<string, Promise<void>>();
  const activeMutationTokens = new Map<string, string>();
  const leaseTtlMs = options.leaseTtlMs ?? PLAYER_MUTATION_LOCK_TTL_MS;
  const acquisitionAttempts = options.acquisitionAttempts ?? PLAYER_MUTATION_LOCK_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? PLAYER_MUTATION_LOCK_RETRY_MS;
  const renewalIntervalMs = options.renewalIntervalMs ?? Math.max(1_000, Math.floor(leaseTtlMs / 3));

  function getActivePlayerMutationLock(
    userId: string,
  ): { key: string; token: string } | null {
    const id = String(userId ?? '').trim();
    if (!id) return null;
    const token = activeMutationTokens.get(id);
    return token ? { key: PLAYER_MUTATION_LOCK_PREFIX + id, token } : null;
  }

  async function renewOwnedLock(
    client: PlayerMutationLockRedis,
    lockKey: string,
    token: string,
  ): Promise<boolean> {
    const txn = await client.watch(lockKey);
    const owner = await client.get(lockKey);
    if (owner !== token) {
      await txn.unwatch();
      return false;
    }

    await txn.multi();
    await txn.set(lockKey, token, {
      expiration: new Date(Date.now() + leaseTtlMs),
    });
    return (await txn.exec()) !== null;
  }

  async function releaseOwnedLock(
    client: PlayerMutationLockRedis,
    lockKey: string,
    token: string,
  ): Promise<void> {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const txn = await client.watch(lockKey);
        const owner = await client.get(lockKey);
        if (owner !== token) {
          await txn.unwatch();
          return;
        }

        await txn.multi();
        await txn.del(lockKey);
        const committed = await txn.exec();
        if (committed !== null) return;
      }
      // Never fall back to an unguarded DEL. If ownership changes repeatedly,
      // the correct behavior is to leave cleanup to the lease expiry.
      console.error('[Player Lock] Could not safely release the lock; lease will expire.');
    } catch (error) {
      console.error('[Player Lock] Could not safely release the lock; lease will expire:', error);
    }
  }

  async function runLocked<T>(
    userId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const id = lockUserId(userId, getContextUserId());

    // Serialize same-player operations handled by this runtime before they
    // contend for Redis. Separate runtimes still coordinate on the lease key.
    const previous = localMutationTails.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    localMutationTails.set(id, tail);

    await previous;

    const lockKey = PLAYER_MUTATION_LOCK_PREFIX + id;
    const token = 'lock-' + Date.now().toString(36) + '-' + randomUint32().toString(36);

    try {
      const client = getRedis();
      for (let attempt = 0; attempt < acquisitionAttempts; attempt++) {
        await client.set(lockKey, token, {
          nx: true,
          expiration: new Date(Date.now() + leaseTtlMs),
        });

        const owner = await client.get(lockKey);
        if (owner === token) {
          activeMutationTokens.set(id, token);
          // Renew only this exact token. Losing the lease never reacquires it
          // under the authority of an already-running callback.
          let renewalInFlight = false;
          const renewalTimer = setInterval(() => {
            if (renewalInFlight) return;
            renewalInFlight = true;
            void renewOwnedLock(client, lockKey, token)
              .then(renewed => {
                if (!renewed) {
                  console.error('[Player Lock] Lease was lost before the callback finished.');
                }
              })
              .catch(error => {
                console.error('[Player Lock] Lease renewal failed; it may expire before the callback finishes:', error);
              })
              .finally(() => {
                renewalInFlight = false;
              });
          }, renewalIntervalMs);

          try {
            return await fn();
          } finally {
            clearInterval(renewalTimer);
            await releaseOwnedLock(client, lockKey, token);
            if (activeMutationTokens.get(id) === token) {
              activeMutationTokens.delete(id);
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
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

  return {
    getActivePlayerMutationLock,
    withPlayerMutationLockFor<T>(userId: string, fn: () => Promise<T>): Promise<T> {
      return runLocked(userId, fn);
    },
    withPlayerMutationLock<T>(fn: () => Promise<T>): Promise<T> {
      return runLocked(undefined, fn);
    },
  };
}

const defaultLockRuntime = createPlayerMutationLockRuntime(
  () => redis,
  () => context.userId == null ? undefined : String(context.userId),
);

export const getActivePlayerMutationLock = defaultLockRuntime.getActivePlayerMutationLock;
export const withPlayerMutationLockFor = defaultLockRuntime.withPlayerMutationLockFor;
export const withPlayerMutationLock = defaultLockRuntime.withPlayerMutationLock;

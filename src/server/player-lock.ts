import { context, redis } from './devvit-mock.js';

const PLAYER_MUTATION_LOCK_PREFIX = 'io:player-mutation-lock:';
const PLAYER_MUTATION_LOCK_TTL_MS = 90_000;
const PLAYER_MUTATION_LOCK_ATTEMPTS = 360;
const PLAYER_MUTATION_LOCK_RETRY_MS = 25;

export interface PlayerMutationLockTransaction {
  multi(): Promise<unknown>;
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
  /** Shortened values are useful for deterministic lock lease regression tests. */
  leaseTtlMs?: number;
  acquisitionAttempts?: number;
  retryDelayMs?: number;
}

function lockUserId(userId: string | undefined, getContextUserId: () => string | undefined): string {
  const id = String(userId ?? getContextUserId() ?? '').trim();
  if (!id) throw new Error('REDDIT_LOGIN_REQUIRED');
  return id;
}

function randomUint32(): number {
  const sample = new Uint32Array(1);
  globalThis.crypto.getRandomValues(sample);
  return sample[0];
}

/**
 * Creates one server-runtime lock coordinator. Separate instances have
 * independent in-process queues, but coordinate through the shared Redis
 * lease. The factory is also a narrow test seam for modeling separate runtimes.
 */
export function createPlayerMutationLockRuntime(
  getRedis: () => PlayerMutationLockRedis,
  getContextUserId: () => string | undefined,
  options: PlayerMutationLockRuntimeOptions = {},
) {
  const localMutationTails = new Map<string, Promise<void>>();
  const leaseTtlMs = options.leaseTtlMs ?? PLAYER_MUTATION_LOCK_TTL_MS;
  const acquisitionAttempts = options.acquisitionAttempts ?? PLAYER_MUTATION_LOCK_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? PLAYER_MUTATION_LOCK_RETRY_MS;

  async function releaseOwnedLease(
    client: PlayerMutationLockRedis,
    lockKey: string,
    token: string,
  ): Promise<void> {
    let txn: PlayerMutationLockTransaction | undefined;
    try {
      // WATCH + MULTI/EXEC makes the owner check and deletion conditional on
      // the key not changing in between. A plain GET followed by DEL can
      // delete a newer holder's lease if this holder's lease expires after GET.
      txn = await client.watch(lockKey);
      const owner = await client.get(lockKey);
      if (owner !== token) {
        await txn.unwatch();
        return;
      }

      await txn.multi();
      await txn.del(lockKey);
      // A null/aborted transaction means the key changed after the ownership
      // read. Leave the new holder's lease untouched.
      await txn.exec();
    } catch (error) {
      // The lease has a finite TTL, so failed cleanup cannot leave a permanent
      // lock. Do not turn an already-committed game action into a false failure
      // that encourages the client to repeat a potentially non-idempotent action.
      try {
        await txn?.unwatch();
      } catch {
        // The transaction may already have been closed by EXEC.
      }
      console.error('[Player Mutation Lock] Lease cleanup failed; relying on expiry:', error);
    }
  }

  async function runLocked<T>(userId: string | undefined, fn: () => Promise<T>): Promise<T> {
    const id = lockUserId(userId, getContextUserId());

    // Requests handled by the same runtime instance are serialized locally
    // before they contend for the distributed Redis lock.
    const previous = localMutationTails.get(id) ?? Promise.resolve();
    let releaseLocal!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseLocal = resolve;
    });
    const tail = previous.then(() => gate);
    localMutationTails.set(id, tail);

    await previous;

    const lockKey = PLAYER_MUTATION_LOCK_PREFIX + id;
    const token = `lock-${Date.now().toString(36)}-${randomUint32().toString(36)}`;

    try {
      const client = getRedis();
      for (let attempt = 0; attempt < acquisitionAttempts; attempt++) {
        await client.set(lockKey, token, {
          nx: true,
          expiration: new Date(Date.now() + leaseTtlMs),
        });

        // SET NX is authoritative for acquisition. Confirming the stored token
        // protects this code from mocks/adapters that report an ambiguous SET.
        const owner = await client.get(lockKey);
        if (owner === token) {
          try {
            return await fn();
          } finally {
            await releaseOwnedLease(client, lockKey, token);
          }
        }

        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }

      throw new Error('Player state is busy. Please retry.');
    } finally {
      // Always drain the local queue, including acquisition timeout, Redis
      // errors, and callback rejection.
      releaseLocal();
      if (localMutationTails.get(id) === tail) {
        localMutationTails.delete(id);
      }
    }
  }

  return {
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

export const withPlayerMutationLockFor = defaultLockRuntime.withPlayerMutationLockFor;
export const withPlayerMutationLock = defaultLockRuntime.withPlayerMutationLock;

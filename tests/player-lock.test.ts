import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPlayerMutationLockRuntime,
  getActivePlayerMutationLock,
  withPlayerMutationLockFor,
  type PlayerMutationLockRedis,
  type PlayerMutationLockRuntimeOptions,
  type PlayerMutationLockTransaction,
} from '../src/server/player-lock.js';
import { redis as mockRedis } from '../src/server/devvit-mock.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Entry = { value: string; expiresAt: number | null };
type StagedCommand =
  | { type: 'set'; key: string; value: string; expiration?: Date }
  | { type: 'del'; key: string };

/**
 * Shared Redis test double. Each lock runtime gets its own local queue but
 * shares these lease values and WATCH revisions, like separate app runtimes.
 */
class SharedLockRedis implements PlayerMutationLockRedis {
  private readonly values = new Map<string, Entry>();
  private readonly revisions = new Map<string, number>();
  beforeGetReturn?: (key: string, value: string | null) => Promise<void>;
  failNextWatch = false;

  private revision(key: string): number {
    return this.revisions.get(key) ?? 0;
  }

  private bump(key: string): void {
    this.revisions.set(key, this.revision(key) + 1);
  }

  private read(key: string): string | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      this.bump(key);
      return undefined;
    }
    return entry.value;
  }

  private write(key: string, value: string, expiration?: Date): void {
    this.values.set(key, {
      value,
      expiresAt: expiration instanceof Date ? expiration.getTime() : null,
    });
    this.bump(key);
  }

  async get(key: string): Promise<string | null> {
    const value = this.read(key) ?? null;
    const hook = this.beforeGetReturn;
    if (hook) {
      this.beforeGetReturn = undefined;
      await hook(key, value);
    }
    return value;
  }

  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; expiration?: Date },
  ): Promise<string | null> {
    const existing = this.read(key);
    if (options?.nx && existing !== undefined) return null;
    this.write(key, value, options?.expiration);
    return 'OK';
  }

  async watch(...keys: string[]): Promise<PlayerMutationLockTransaction> {
    if (this.failNextWatch) {
      this.failNextWatch = false;
      throw new Error('simulated WATCH failure');
    }
    for (const key of keys) this.read(key);
    const snapshot = new Map(keys.map(key => [key, this.revision(key)]));
    const staged: StagedCommand[] = [];
    let watched = true;
    const transaction: PlayerMutationLockTransaction = {
      multi: async () => undefined,
      del: async (...deleteKeys: string[]) => {
        for (const key of deleteKeys) staged.push({ type: 'del', key });
        return 'QUEUED';
      },
      exec: async () => {
        if (watched) {
          for (const key of keys) {
            this.read(key);
            if (this.revision(key) !== snapshot.get(key)) return null;
          }
        }
        for (const command of staged) {
          if (command.type === 'del') this.delete(command.key);
          else this.write(command.key, command.value, command.expiration);
        }
        watched = false;
        return [];
      },
      unwatch: async () => {
        watched = false;
        return undefined;
      },
    };
    return transaction;
  }

  delete(key: string): void {
    if (this.values.delete(key)) this.bump(key);
  }

  /** Simulates a new runtime taking over immediately after an expired lease. */
  async replaceExpiredLease(key: string, newOwner: string): Promise<void> {
    this.delete(key);
    const result = await this.set(key, newOwner, {
      nx: true,
      expiration: new Date(Date.now() + 5_000),
    });
    assert.equal(result, 'OK');
  }
}

function newRuntime(redis: SharedLockRedis, options: PlayerMutationLockRuntimeOptions = {}) {
  return createPlayerMutationLockRuntime(() => redis, () => undefined, {
    leaseTtlMs: 2_000,
    acquisitionAttempts: 100,
    retryDelayMs: 2,
    ...options,
  });
}

test('player mutation lock serializes same-player operations in one runtime', async () => {
  let active = 0;
  let maxActive = 0;
  const order: number[] = [];

  const operation = (id: number) => withPlayerMutationLockFor('lock-test-player', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(id);
    await delay(10);
    active -= 1;
  });

  await Promise.all([operation(1), operation(2), operation(3), operation(4)]);

  assert.equal(maxActive, 1);
  assert.deepEqual(order, [1, 2, 3, 4]);
});

test('player mutation lock releases local queue cleanly after a callback failure', async () => {
  await assert.rejects(
    withPlayerMutationLockFor('lock-test-failure', async () => {
      throw new Error('expected test failure');
    }),
    /expected test failure/,
  );

  let ran = false;
  await withPlayerMutationLockFor('lock-test-failure', async () => {
    ran = true;
  });

  assert.equal(ran, true);
});

test('independent runtime instances serialize same-player mutations through shared Redis', async () => {
  const sharedRedis = new SharedLockRedis();
  const runtimeA = newRuntime(sharedRedis);
  const runtimeB = newRuntime(sharedRedis);
  let active = 0;
  let maxActive = 0;
  let enteredB = false;
  let announceAEntered!: () => void;
  let releaseA!: () => void;
  const aEntered = new Promise<void>(resolve => { announceAEntered = resolve; });
  const aGate = new Promise<void>(resolve => { releaseA = resolve; });

  const first = runtimeA.withPlayerMutationLockFor('cross-runtime-player', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    announceAEntered();
    await aGate;
    active -= 1;
  });
  await aEntered;

  const second = runtimeB.withPlayerMutationLockFor('cross-runtime-player', async () => {
    enteredB = true;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(5);
    active -= 1;
  });

  await delay(20);
  assert.equal(enteredB, false, 'runtime B entered while runtime A held the shared lease');
  releaseA();
  await Promise.all([first, second]);

  assert.equal(enteredB, true);
  assert.equal(maxActive, 1);
});

test('expired lease cleanup cannot delete a new runtime owner acquired between GET and EXEC', async () => {
  const sharedRedis = new SharedLockRedis();
  const runtime = newRuntime(sharedRedis);
  const lockKey = 'io:player-mutation-lock:release-race-player';

  await runtime.withPlayerMutationLockFor('release-race-player', async () => {
    // The acquisition GET has already completed when the callback begins. This
    // hook therefore fires during release, after WATCH snapshots the old owner
    // but before the release transaction executes.
    sharedRedis.beforeGetReturn = async (key, value) => {
      if (key !== lockKey) return;
      assert.ok(value, 'release should initially read its own lease');
      await sharedRedis.replaceExpiredLease(lockKey, 'new-runtime-owner');
    };
  });

  assert.equal(
    await sharedRedis.get(lockKey),
    'new-runtime-owner',
    'old holder removed a lease installed by the new owner',
  );
  sharedRedis.delete(lockKey);
});

test('different player IDs can hold independent critical sections concurrently', async () => {
  const sharedRedis = new SharedLockRedis();
  const runtimeA = newRuntime(sharedRedis);
  const runtimeB = newRuntime(sharedRedis);
  let active = 0;
  let maxActive = 0;
  let release!: () => void;
  let enteredBoth!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const both = new Promise<void>(resolve => { enteredBoth = resolve; });

  const hold = (runtime: ReturnType<typeof newRuntime>, playerId: string) =>
    runtime.withPlayerMutationLockFor(playerId, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (active === 2) enteredBoth();
      await gate;
      active -= 1;
    });

  const first = hold(runtimeA, 'independent-player-a');
  const second = hold(runtimeB, 'independent-player-b');
  await Promise.race([
    both,
    delay(500).then(() => { throw new Error('different players blocked each other'); }),
  ]);
  release();
  await Promise.all([first, second]);

  assert.equal(maxActive, 2);
});

test('acquisition timeout releases local queue state for the next attempt', async () => {
  const sharedRedis = new SharedLockRedis();
  const runtime = newRuntime(sharedRedis, { acquisitionAttempts: 3, retryDelayMs: 1 });
  const lockKey = 'io:player-mutation-lock:timeout-player';
  await sharedRedis.set(lockKey, 'existing-owner', {
    nx: true,
    expiration: new Date(Date.now() + 5_000),
  });

  await assert.rejects(
    runtime.withPlayerMutationLockFor('timeout-player', async () => undefined),
    /Player state is busy\. Please retry\./,
  );

  sharedRedis.delete(lockKey);
  let ran = false;
  await runtime.withPlayerMutationLockFor('timeout-player', async () => {
    ran = true;
  });
  assert.equal(ran, true);
});

test('release failure preserves callback errors and the local queue recovers after lease expiry', async () => {
  const sharedRedis = new SharedLockRedis();
  const runtime = newRuntime(sharedRedis, {
    leaseTtlMs: 35,
    acquisitionAttempts: 100,
    retryDelayMs: 2,
  });
  const originalConsoleError = console.error;
  // The failure is intentional; keep the test output focused on assertions.
  console.error = (...args: unknown[]) => {
    if (args[0] !== '[Player Lock] Could not safely release the lock; lease will expire:') {
      originalConsoleError(...args);
    }
  };

  try {
    await assert.rejects(
      runtime.withPlayerMutationLockFor('release-failure-player', async () => {
        sharedRedis.failNextWatch = true;
        throw new Error('original callback error');
      }),
      /original callback error/,
    );

    let ranAfterExpiry = false;
    await runtime.withPlayerMutationLockFor('release-failure-player', async () => {
      ranAfterExpiry = true;
    });
    assert.equal(ranAfterExpiry, true);
  } finally {
    console.error = originalConsoleError;
  }
});

test('local Redis mock honors SET NX and Date-based expiration', async () => {
  const key = `test:player-lock-options:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 25);
  try {
    assert.equal(await mockRedis.set(key, 'first-owner', { nx: true, expiration: expiresAt }), 'OK');
    assert.equal(await mockRedis.set(key, 'second-owner', { nx: true, expiration: expiresAt }), null);
    assert.equal(await mockRedis.get(key), 'first-owner');
    await delay(40);
    assert.equal(await mockRedis.get(key), null);
    assert.equal(await mockRedis.set(key, 'after-expiry', {
      nx: true,
      expiration: new Date(Date.now() + 1_000),
    }), 'OK');
  } finally {
    await mockRedis.del(key);
  }
});


test('active player lock exposes its fencing token only while ownership is held', async () => {
  const userId = 'lock-fencing-player';
  let token: string | null = null;
  await withPlayerMutationLockFor(userId, async () => {
    const active = getActivePlayerMutationLock(userId);
    assert.ok(active);
    assert.match(active!.key, /lock-fencing-player$/);
    assert.ok(active!.token.length > 0);
    token = active!.token;
    assert.equal(getActivePlayerMutationLock(userId)?.token, token);
  });

  assert.equal(getActivePlayerMutationLock(userId), null);
});


test('active player lease renews before expiry while its callback is still running', async () => {
  const sharedRedis = new SharedLockRedis();
  const options = {
    leaseTtlMs: 60,
    renewalIntervalMs: 25,
    acquisitionAttempts: 200,
    retryDelayMs: 2,
  };
  const runtimeA = newRuntime(sharedRedis, options);
  const runtimeB = newRuntime(sharedRedis, options);
  let active = 0;
  let maxActive = 0;
  let enteredB = false;
  let announceAEntered!: () => void;
  const aEntered = new Promise<void>(resolve => { announceAEntered = resolve; });

  const first = runtimeA.withPlayerMutationLockFor('lease-renewal-player', async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    announceAEntered();
    await delay(110);
    active -= 1;
  });
  await aEntered;

  const second = runtimeB.withPlayerMutationLockFor('lease-renewal-player', async () => {
    enteredB = true;
    active += 1;
    maxActive = Math.max(maxActive, active);
    active -= 1;
  });

  await delay(80);
  assert.equal(enteredB, false, 'another runtime entered after the original lease TTL expired');
  await Promise.all([first, second]);
  assert.equal(enteredB, true);
  assert.equal(maxActive, 1);
});

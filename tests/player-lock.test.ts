import test from 'node:test';
import assert from 'node:assert/strict';

import { withPlayerMutationLockFor } from '../src/server/player-lock.js';
import { redis } from '../src/server/devvit-mock.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

test('player mutation lock releases cleanly after a failed operation', async () => {
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


test('local Redis mock honors NX and expiration options used by the distributed lock', async () => {
  const key = 'io:player-mutation-lock:test-nx-expiry';
  await redis.del(key);
  await redis.set(key, 'first-owner', { nx: true, expiration: new Date(Date.now() + 25) });
  await redis.set(key, 'second-owner', { nx: true, expiration: new Date(Date.now() + 25) });
  assert.equal(await redis.get(key), 'first-owner');

  await delay(35);
  await redis.set(key, 'second-owner', { nx: true, expiration: new Date(Date.now() + 100) });
  assert.equal(await redis.get(key), 'second-owner');
  await redis.del(key);
});

test('player lock does not delete a replacement owner lease during cleanup', async () => {
  const userId = 'lock-test-replacement-owner';
  const key = 'io:player-mutation-lock:' + userId;
  await redis.del(key);

  await withPlayerMutationLockFor(userId, async () => {
    assert.match(String(await redis.get(key)), /^lock-/);
    await redis.set(key, 'replacement-owner', {
      expiration: new Date(Date.now() + 5_000),
    });
  });

  assert.equal(await redis.get(key), 'replacement-owner');
  await redis.del(key);
});

test('player locks for different users do not serialize each other', async () => {
  let active = 0;
  let maxActive = 0;
  const operation = (userId: string) => withPlayerMutationLockFor(userId, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(15);
    active -= 1;
  });

  await Promise.all([
    operation('lock-test-independent-a'),
    operation('lock-test-independent-b'),
  ]);
  assert.equal(maxActive, 2);
});

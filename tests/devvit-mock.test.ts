import test from 'node:test';
import assert from 'node:assert/strict';

import { redis } from '../src/server/devvit-mock.js';

const uniqueKey = (suffix: string) => `test:devvit-mock:${Date.now()}:${Math.random().toString(36).slice(2)}:${suffix}`;

test('mock SET preserves empty strings and distinguishes SET from DEL in transactions', async () => {
  const key = uniqueKey('empty');
  await redis.set(key, '');
  assert.equal(await redis.get(key), '');

  const txn = await redis.watch(key);
  assert.equal(await redis.get(key), '');
  await txn.multi();
  await txn.set(key, '');
  assert.deepEqual(await txn.exec(), []);
  assert.equal(await redis.get(key), '');

  const deleteTxn = await redis.watch(key);
  await deleteTxn.multi();
  await deleteTxn.del(key);
  assert.deepEqual(await deleteTxn.exec(), []);
  assert.equal(await redis.get(key), null);
});

test('mock WATCH detects ABA writes instead of comparing only final values', async () => {
  const key = uniqueKey('aba');
  const otherKey = uniqueKey('other');
  await redis.set(key, 'original');
  const txn = await redis.watch(key);
  await redis.set(key, 'changed');
  await redis.set(key, 'original');

  await txn.multi();
  await txn.set(otherKey, 'must-not-commit');
  assert.equal(await txn.exec(), null);
  assert.equal(await redis.get(otherKey), null);
});

test('mock SET NX and expiration behave like the Redis lock contract', async () => {
  const key = uniqueKey('lease');
  const expiredKey = uniqueKey('expired');
  const first = await redis.set(key, 'owner-a', {
    nx: true,
    expiration: new Date(Date.now() + 60_000),
  });
  const second = await redis.set(key, 'owner-b', { nx: true });
  assert.equal(first, 'OK');
  assert.notEqual(second, 'OK');
  assert.equal(await redis.get(key), 'owner-a');

  await redis.set(expiredKey, 'stale', { expiration: new Date(Date.now() - 1) });
  assert.equal(await redis.get(expiredKey), null);
});

test('mock WATCH supports transactional HDEL and rejects stale delete after a profile refresh', async () => {
  const key = uniqueKey('profile-hdel');
  await redis.hSet(key, { stale: 'expired-profile', keep: 'active-profile' });

  const txn = await redis.watch(key);
  assert.deepEqual(await redis.hGetAll(key), {
    stale: 'expired-profile',
    keep: 'active-profile',
  });
  await txn.multi();
  await txn.hDel(key, 'stale');
  assert.deepEqual(await txn.exec(), []);
  assert.deepEqual(await redis.hGetAll(key), { keep: 'active-profile' });

  const raceTxn = await redis.watch(key);
  // Simulate another Arena open refreshing the same hash after WATCH.
  await redis.hSet(key, { keep: 'refreshed-profile' });
  await raceTxn.multi();
  await raceTxn.hDel(key, 'keep');
  assert.equal(await raceTxn.exec(), null);
  assert.equal(await redis.hGet(key, 'keep'), 'refreshed-profile');
});

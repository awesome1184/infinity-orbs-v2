import test from 'node:test';
import assert from 'node:assert/strict';
import { mGetInChunks, REDIS_MGET_BATCH_SIZE } from '../src/server/redis-batch.js';

test('mGetInChunks preserves order and splits response-size failures', async () => {
  const keys = Array.from({ length: 137 }, (_, index) => `key-${index}`);
  const requestSizes: number[] = [];
  let active = 0;
  let maxActive = 0;

  const values = await mGetInChunks(keys, async chunk => {
    requestSizes.push(chunk.length);
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await Promise.resolve();
      if (chunk.length > 13) {
        throw new Error('app infinity-orbs exceeded max response size limit on method:/devvit.plugin.redis.RedisAPI/MGet');
      }
      return chunk.map(key => `${key}:value`);
    } finally {
      active -= 1;
    }
  });

  assert.deepEqual(values, keys.map(key => `${key}:value`));
  assert.ok(requestSizes.every(size => size <= REDIS_MGET_BATCH_SIZE));
  assert.ok(requestSizes.includes(REDIS_MGET_BATCH_SIZE));
  assert.ok(maxActive <= 4, `observed ${maxActive} concurrent MGet calls`);
});

test('mGetInChunks returns an empty array without calling Redis for empty input', async () => {
  let calls = 0;
  const result = await mGetInChunks([], async keys => {
    calls += 1;
    return keys.map(key => key);
  });

  assert.deepEqual(result, []);
  assert.equal(calls, 0);
});

test('mGetInChunks does not hide non-size-related Redis errors', async () => {
  let calls = 0;
  await assert.rejects(
    () => mGetInChunks(['one', 'two'], async () => {
      calls += 1;
      throw new Error('permission denied');
    }),
    /permission denied/,
  );
  assert.equal(calls, 1);
});

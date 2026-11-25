import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readInBatches } from '../src/server/redis-batches.js';

test('readInBatches preserves key order and bounds request size and concurrency', async () => {
  const keys = Array.from({ length: 137 }, (_, index) => 'key-' + index);
  const batchSizes: number[] = [];
  let active = 0;
  let maxActive = 0;

  const values = await readInBatches(keys, async batchKeys => {
    batchSizes.push(batchKeys.length);
    assert.ok(batchKeys.length <= 16, 'individual MGet responses must stay bounded');
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    const result = batchKeys.map(key => 'value:' + key);
    active -= 1;
    return result;
  }, 16, 4);

  assert.deepEqual(values, keys.map(key => 'value:' + key));
  assert.equal(batchSizes.length, Math.ceil(keys.length / 16));
  assert.ok(maxActive <= 4, 'the helper must limit in-flight batch calls');
  assert.equal(values.length, keys.length);
});

test('readInBatches handles an empty key list without an API call', async () => {
  let calls = 0;
  const values = await readInBatches<string>([], async () => {
    calls += 1;
    return [];
  });
  assert.deepEqual(values, []);
  assert.equal(calls, 0);
});

test('readInBatches rejects a misaligned Redis response', async () => {
  await assert.rejects(
    readInBatches(['a', 'b'], async () => ['only-one']),
    /different number of values than keys/,
  );
});

test('large player, leaderboard, and viewer indexes use bounded reads', () => {
  const game = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  const impressions = readFileSync(resolve(process.cwd(), 'src/server/impressions.ts'), 'utf8');

  assert.match(game, /readInBatches\(userIds\.map\(id => playerKeyFor\(id\)\), keys => redis\.mGet\(keys\)\)/);
  assert.doesNotMatch(game, /redis\.mGet\(userIds\.map\(id => playerKeyFor\(id\)\)\)/);
  assert.match(social, /readInBatches\(userIds\.map\(id => `player:\$\{id\}`\), keys => redis\.mGet\(keys\)\)/);
  assert.match(social, /readInBatches\(userIds\.map\(id => `infinity-orbs:combat:\$\{id\}`\), keys => redis\.mGet\(keys\)\)/);
  assert.match(impressions, /readInBatches\([\s\S]{0,220}VIEWER_RECORD_PREFIX/);
  assert.doesNotMatch(impressions, /redis\.mGet\(userHashes\.map\(userHash => VIEWER_RECORD_PREFIX/);
});

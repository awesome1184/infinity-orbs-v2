import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createAsyncSerialQueue } from '../src/client/async-serial-queue.js';

test('combat request queue runs one request at a time and preserves response order', async () => {
  const queue = createAsyncSerialQueue();
  const order: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });

  const first = queue.enqueue(async () => {
    order.push('first:start');
    markFirstStarted();
    await firstGate;
    order.push('first:end');
    return 'first response';
  });
  const second = queue.enqueue(async () => {
    order.push('second');
    return 'second response';
  });

  assert.equal(queue.pending, 2, 'queued operations must count as pending');
  await firstStarted;
  assert.deepEqual(order, ['first:start'], 'the second operation must wait for the first response');
  assert.equal(queue.pending, 2);

  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first response', 'second response']);
  assert.deepEqual(order, ['first:start', 'first:end', 'second']);
  assert.equal(queue.pending, 0);
});

test('a rejected request does not block later combat actions', async () => {
  const queue = createAsyncSerialQueue();

  await assert.rejects(
    queue.enqueue(() => { throw new Error('simulated request failure'); }),
    /simulated request failure/,
  );
  assert.equal(queue.pending, 0);
  assert.equal(await queue.enqueue(() => 'recovered'), 'recovered');
  assert.equal(queue.pending, 0);
});

test('CombatSection routes state reads, beats, and gear/skill mutations through one queue', async () => {
  const source = await readFile(new URL('../src/client/components/CombatSection.tsx', import.meta.url), 'utf8');

  assert.match(
    source,
    /combatQueue\.enqueue\(async\(\)\s*=>\s*\{\s*const result=await request<CombatSnapshot>\('\/api\/combat\/state'\);/,
    'initial/retry state reads must share the combat queue',
  );
  assert.match(
    source,
    /combatQueue\.enqueue\(async\(\)\s*=>\s*\{\s*\/\/ Read sequence when the beat actually executes[\s\S]*?request<ApiResponse>\('\/api\/combat\/beat'/,
    'beat sequence must be read and posted inside the queue',
  );
  assert.match(
    source,
    /combatQueue\.enqueue\(async\(\)\s*=>\s*\{\s*const result=await request<ApiResponse>\(url,'POST',body\);/,
    'equip and skill-roll mutations must use the same queue',
  );
  assert.match(source, /'\/api\/combat\/equip'/);
  assert.match(source, /'\/api\/combat\/skills\/roll'/);
  assert.match(
    source,
    /combatQueue\.enqueue\(async\(\)\s*=>\s*\{\s*const result=await request<ApiResponse>\('\/api\/combat\/arena\/challenge'/,
    'Arena challenges must not race with PvE snapshot mutations',
  );
});

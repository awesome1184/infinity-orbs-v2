import test from 'node:test';
import assert from 'node:assert/strict';

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

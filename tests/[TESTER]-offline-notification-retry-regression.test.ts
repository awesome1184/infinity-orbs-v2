import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('offline notification retries distinguish pending reservations from confirmed receipts', () => {
  const game = source('src/server/game.ts');

  const sendStart = game.indexOf('async function sendOfflineFullNotification');
  const sendEnd = game.indexOf('function parseOfflineFullJobMarker', sendStart);
  assert.ok(sendStart >= 0 && sendEnd > sendStart, 'offline notification sender must exist');
  const sender = game.slice(sendStart, sendEnd);

  const scheduleStart = game.indexOf('async function scheduleOfflineFullNotification');
  const scheduleEnd = game.indexOf('export async function processOfflineFullNotification', scheduleStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'offline notification scheduler must exist');
  const scheduler = game.slice(scheduleStart, scheduleEnd);

  const workerStart = game.indexOf('export async function processOfflineFullNotification');
  const workerEnd = game.indexOf('export async function settleOffline', workerStart);
  assert.ok(workerStart >= 0 && workerEnd > workerStart, 'offline notification worker must exist');
  const worker = game.slice(workerStart, workerEnd);

  // The worker explicitly retries after a send error. A pending reservation must
  // therefore be distinguishable from a confirmed sent receipt, or that retry
  // is silently defeated before the next provider attempt.
  assert.match(worker, /scheduleOfflineFullNotification\(userId, subredditName, now \+ OFFLINE_FULL_RETRY_MS\)/);

  assert.doesNotMatch(
    sender,
    /if \(await redis\.get\(notificationKey\)\) return false;/,
    'a pending reservation must not be treated as proof that enqueue succeeded',
  );
  assert.doesNotMatch(
    scheduler,
    /if \(await redis\.get\(OFFLINE_FULL_NOTIFICATION_PREFIX \+ userId\)\) return;/,
    'rescheduling must distinguish a confirmed receipt from a pending attempt',
  );
});

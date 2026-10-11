import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('offline notification retries distinguish pending reservations from confirmed receipts', () => {
  const game = source('src/server/game.ts');

  const helperStart = game.indexOf('function offlineNotificationPendingRetryAt(');
  const sendStart = game.indexOf('async function sendOfflineFullNotification');
  const sendEnd = game.indexOf('function parseOfflineFullJobMarker', sendStart);
  assert.ok(helperStart >= 0 && sendStart > helperStart && sendEnd > sendStart, 'pending retry policy and sender must exist');
  const helper = game.slice(helperStart, sendStart);
  const sender = game.slice(sendStart, sendEnd);

  const scheduleStart = game.indexOf('async function scheduleOfflineFullNotification');
  const scheduleEnd = game.indexOf('export async function processOfflineFullNotification', scheduleStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart, 'offline notification scheduler must exist');
  const scheduler = game.slice(scheduleStart, scheduleEnd);

  const workerStart = game.indexOf('export async function processOfflineFullNotification');
  const workerEnd = game.indexOf('export async function settleOffline', workerStart);
  assert.ok(workerStart >= 0 && workerEnd > workerStart, 'offline notification worker must exist');
  const worker = game.slice(workerStart, workerEnd);

  // A durable '1' is the sent receipt; a pending token is only an attempt.
  assert.match(sender, /if \(await redis\.get\(notificationKey\) === '1'\) return false/);
  assert.doesNotMatch(sender, /if \(await redis\.get\(notificationKey\)\) return false/);
  assert.match(sender, /storedReservation !== pendingToken/);
  assert.match(helper, /pendingTtlMs = 7 \* 24 \* 60 \* 60_000/);
  assert.match(helper, /pendingAt \+ pendingTtlMs \+ 60_000/);

  // A normal schedule must respect a pending attempt, but a retry explicitly
  // scheduled beyond its expiry may queue without mistaking it for a sent receipt.
  assert.match(scheduler, /allowPendingReservationRetry = false/);
  assert.match(scheduler, /if \(notificationMarker === '1'\) return/);
  assert.match(scheduler, /if \(notificationMarker && !allowPendingReservationRetry\) return/);
  assert.doesNotMatch(
    scheduler,
    /if \(await redis\.get\(OFFLINE_FULL_NOTIFICATION_PREFIX \+ userId\)\) return/,
    'pending marker must not be treated as a confirmed sent receipt for every retry',
  );

  // Both a false result with a surviving pending reservation and a thrown,
  // ambiguous attempt must schedule recovery after the reservation expiry.
  assert.match(worker, /if \(!sent && cleared\)[\s\S]*?offlineNotificationPendingRetryAt\(notificationMarker\)[\s\S]*?true/);
  assert.match(worker, /markerReadFailed \|\| notificationMarker != null/);
  assert.match(worker, /scheduleOfflineFullNotification\(userId, subredditName, retryAt, hasPendingReservation\)/);
  assert.match(worker, /if \(notificationMarker === '1'\)[\s\S]*?return;/);
});

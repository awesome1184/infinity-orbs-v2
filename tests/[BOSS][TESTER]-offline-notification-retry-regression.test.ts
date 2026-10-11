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
  assert.ok(helperStart >= 0 && sendStart > helperStart && sendEnd > sendStart,
    'pending retry policy and sender must exist');
  const helper = game.slice(helperStart, sendStart);
  const sender = game.slice(sendStart, sendEnd);

  const scheduleStart = game.indexOf('async function scheduleOfflineFullNotification');
  const scheduleEnd = game.indexOf('export async function processOfflineFullNotification', scheduleStart);
  assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart,
    'offline notification scheduler must exist');
  const scheduler = game.slice(scheduleStart, scheduleEnd);

  const workerStart = game.indexOf('export async function processOfflineFullNotification');
  const workerEnd = game.indexOf('export async function settleOffline', workerStart);
  assert.ok(workerStart >= 0 && workerEnd > workerStart,
    'offline notification worker must exist');
  const worker = game.slice(workerStart, workerEnd);

  // A durable '1' is the sent receipt; a pending token is only an attempt.
  assert.match(sender, /if \(existingNotificationMarker === '1'\) return false/);
  assert.doesNotMatch(sender, /if \(await redis\.get\(notificationKey\)\) return false/);
  assert.match(sender, /storedReservation !== pendingToken/);
  assert.match(helper, /pendingTtlMs = 7 \* 24 \* 60 \* 60_000/);
  assert.match(helper, /pendingAt \+ pendingTtlMs \+ 60_000/);
  assert.match(helper, /function isPendingOfflineNotificationMarker\(marker: unknown\)/);
  assert.match(helper, /\^pending:\[0-9a-z\]\+:\.\+\$\/\.test\(marker\)/);

  // A normal schedule respects a pending attempt. An explicit retry is allowed
  // to queue after its lease expiry without confusing it with a sent receipt.
  assert.match(scheduler, /allowPendingReservationRetry = false/);
  assert.match(scheduler, /if \(notificationMarker === '1'\) return/);
  assert.match(
    scheduler,
    /notificationMarker != null && notificationMarker !== '' &&/,
  );
  assert.doesNotMatch(
    scheduler,
    /if \(await redis\.get\(OFFLINE_FULL_NOTIFICATION_PREFIX \+ userId\)\) return/,
    'pending marker must not be treated as a confirmed receipt for every retry',
  );

  // Both a false result with a surviving pending reservation and an ambiguous
  // thrown attempt schedule recovery after the reservation expiry.
  assert.match(
    worker,
    /if \(!sent && cleared\)[\s\S]*?offlineNotificationPendingRetryAt\(notificationMarker\)[\s\S]*?true/,
  );
  assert.match(worker, /markerReadFailed \\|\\| notificationMarker === '' \\|\\| isPendingOfflineNotificationMarker\\(notificationMarker\\)/);
  assert.match(worker, /const retryAt = markerReadFailed \\|\\| notificationMarker === ''[\\s\\S]*?Date\\.now\\(\\) \\+ OFFLINE_FULL_RETRY_MS/);
  assert.match(worker, /else if \\(notificationMarker === ''\\)[\\s\\S]*?Date\\.now\\(\\) \\+ OFFLINE_FULL_RETRY_MS[\\s\\S]*?true/);
  assert.match(worker, /notificationMarker != null && notificationMarker !== '' && !isPendingOfflineNotificationMarker\\(notificationMarker\\)/);
  assert.match(worker, /scheduleOfflineFullNotification\(userId, subredditName, retryAt, hasPendingReservation\)/);
  assert.match(worker, /notificationMarker === '1'[\s\S]*?return;/);
});

test('legacy empty offline-notification markers are deleted before reservation, scheduling, and retry decisions', () => {
  const game = source('src/server/game.ts');
  const clearStart = game.indexOf('async function clearOfflineReminderKeyIfUnchanged');
  const repairStart = game.indexOf('async function readOfflineNotificationMarkerAndRepairLegacyKey');
  const currentUserStart = game.indexOf('function currentUserId', repairStart);
  assert.ok(clearStart >= 0 && repairStart > clearStart && currentUserStart > repairStart);

  const clear = game.slice(clearStart, repairStart);
  assert.match(clear, /await txn\.del\(keyName\)/);
  assert.doesNotMatch(clear, /txn\.set\(keyName,\s*''\)/);

  const repair = game.slice(repairStart, currentUserStart);
  assert.match(repair, /const marker = await redis\.get\(notificationKey\)/);
  assert.match(repair, /if \(marker !== ''\) return marker/);
  assert.match(repair, /clearOfflineReminderKeyIfUnchanged\(notificationKey, ''\)/);
  assert.match(repair, /return await redis\.get\(notificationKey\)/);

  const senderStart = game.indexOf('async function sendOfflineFullNotification');
  const senderEnd = game.indexOf('function parseOfflineFullJobMarker', senderStart);
  const sender = game.slice(senderStart, senderEnd);
  const senderRepair = sender.indexOf('readOfflineNotificationMarkerAndRepairLegacyKey(notificationKey)');
  const senderReceiptGuard = sender.indexOf("if (existingNotificationMarker === '1') return false");
  const senderReservation = sender.indexOf('await redis.set(notificationKey, pendingToken,');
  assert.ok(senderRepair >= 0 && senderReceiptGuard > senderRepair && senderReservation > senderRepair,
    'repair must precede receipt checks and SET NX reservation');

  const scheduleStart = game.indexOf('async function scheduleOfflineFullNotification');
  const scheduleEnd = game.indexOf('export async function processOfflineFullNotification', scheduleStart);
  const scheduler = game.slice(scheduleStart, scheduleEnd);
  const schedulerRepair = scheduler.indexOf('readOfflineNotificationMarkerAndRepairLegacyKey(OFFLINE_FULL_NOTIFICATION_PREFIX + userId)');
  const unknownMarkerGuard = scheduler.indexOf('if (notificationMarker != null &&');
  assert.ok(schedulerRepair >= 0 && unknownMarkerGuard > schedulerRepair,
    'legacy empty-key repair must precede scheduler fail-closed checks');

  const workerStart = game.indexOf('export async function processOfflineFullNotification');
  const workerEnd = game.indexOf('export async function settleOffline', workerStart);
  const worker = game.slice(workerStart, workerEnd);
  assert.equal(
    (worker.match(/readOfflineNotificationMarkerAndRepairLegacyKey\(OFFLINE_FULL_NOTIFICATION_PREFIX \+ userId\)/g) || []).length,
    2,
    'both normal and error recovery paths must repair legacy empty markers',
  );
});

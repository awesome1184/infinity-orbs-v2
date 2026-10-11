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
  assert.match(sender, /if \(existingNotificationMarker === '1'\) return false/);
  assert.doesNotMatch(sender, /if \(await redis\.get\(notificationKey\)\) return false/);
  const repairStart = game.indexOf('async function readOfflineNotificationMarkerAndRepairLegacyKey');
  const repairEnd = game.indexOf('\nfunction currentUserId', repairStart);
  assert.ok(repairStart >= 0 && repairEnd > repairStart, 'legacy marker repair helper must exist');
  const repair = game.slice(repairStart, repairEnd);
  assert.match(repair, /if \(marker !== ''\) return marker/);
  assert.match(repair, /clearOfflineReminderKeyIfUnchanged\(notificationKey, ''\)/);
  assert.match(repair, /return await redis\.get\(notificationKey\)/);
  assert.match(sender, /storedReservation !== pendingToken/);
  assert.match(helper, /pendingTtlMs = 7 \* 24 \* 60 \* 60_000/);
  assert.match(helper, /pendingAt \+ pendingTtlMs \+ 60_000/);
  assert.match(helper, /function isPendingOfflineNotificationMarker\(marker: unknown\)/);
  assert.match(helper, /\^pending:\[0-9a-z\]\+:\.\+\$\/\.test\(marker\)/);

  // A normal schedule must respect a pending attempt, but a retry explicitly
  // scheduled beyond its expiry may queue without mistaking it for a sent receipt.
  assert.match(scheduler, /allowPendingReservationRetry = false/);
  assert.match(scheduler, /if \(notificationMarker === '1'\) return/);
  assert.match(scheduler, /if \(notificationMarker != null && \(!allowPendingReservationRetry \|\| !isPendingOfflineNotificationMarker\(notificationMarker\)\)\) return/);
  assert.doesNotMatch(
    scheduler,
    /if \(await redis\.get\(OFFLINE_FULL_NOTIFICATION_PREFIX \+ userId\)\) return/,
    'pending marker must not be treated as a confirmed sent receipt for every retry',
  );

  // Both a false result with a surviving pending reservation and a thrown,
  // ambiguous attempt must schedule recovery after the reservation expiry.
  assert.match(worker, /if \(!sent && cleared\)[\s\S]*?offlineNotificationPendingRetryAt\(notificationMarker\)[\s\S]*?true/);
  assert.match(worker, /markerReadFailed \|\| isPendingOfflineNotificationMarker\(notificationMarker\)/);
  assert.match(worker, /const retryAt = markerReadFailed\s*\? Date\.now\(\) \+ OFFLINE_FULL_RETRY_MS/);
  assert.match(worker, /notificationMarker != null && !isPendingOfflineNotificationMarker\(notificationMarker\)/);
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
  assert.match(repair, /await clearOfflineReminderKeyIfUnchanged\(notificationKey, ''\)/);

  const senderStart = game.indexOf('async function sendOfflineFullNotification');
  const senderEnd = game.indexOf('function parseOfflineFullJobMarker', senderStart);
  const sender = game.slice(senderStart, senderEnd);
  assert.ok(sender.indexOf('readOfflineNotificationMarkerAndRepairLegacyKey(notificationKey)') <
    sender.indexOf("if (existingNotificationMarker === '1') return false"));
  assert.ok(sender.indexOf('readOfflineNotificationMarkerAndRepairLegacyKey(notificationKey)') <
    sender.indexOf('await redis.set(notificationKey, pendingToken,'));

  const scheduleStart = game.indexOf('async function scheduleOfflineFullNotification');
  const scheduleEnd = game.indexOf('export async function processOfflineFullNotification', scheduleStart);
  const scheduler = game.slice(scheduleStart, scheduleEnd);
  const repairRead = scheduler.indexOf('readOfflineNotificationMarkerAndRepairLegacyKey(OFFLINE_FULL_NOTIFICATION_PREFIX + userId)');
  const unknownMarkerGuard = scheduler.indexOf('if (notificationMarker != null &&');
  assert.ok(repairRead >= 0 && unknownMarkerGuard > repairRead,
    'legacy empty key repair must precede scheduler fail-closed marker checks');

  const workerStart = game.indexOf('export async function processOfflineFullNotification');
  const workerEnd = game.indexOf('export async function settleOffline', workerStart);
  const worker = game.slice(workerStart, workerEnd);
  assert.ok((worker.match(/readOfflineNotificationMarkerAndRepairLegacyKey\(OFFLINE_FULL_NOTIFICATION_PREFIX \+ userId\)/g) || []).length >= 2,
    'both normal and error recovery paths must repair legacy empty markers');
});

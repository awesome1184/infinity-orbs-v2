import test from 'node:test';
import assert from 'node:assert/strict';

import { auditKnownRedisStorage } from '../src/server/redis-storage-audit.js';

import {
  beginServerRequest,
  estimateKnownRedisStorage,
  getServerMonitorSnapshot,
  recordRedisOperation,
  recordUpgradeBatchDiagnostic,
} from '../src/server/server-monitor.js';

test('server monitor turns roll requests into human-readable feed entries', () => {
  const actor = 'ServerMonitorTester' + Date.now().toString(36);
  let finish: (() => void) | undefined;
  let statusCode = 200;

  beginServerRequest(
    'POST',
    '/api/roll',
    actor,
    () => statusCode,
    (event, callback) => {
      assert.equal(event, 'finish');
      finish = callback;
    },
  );
  assert.equal(typeof finish, 'function');
  finish?.();

  const snapshot = getServerMonitorSnapshot();
  const entry = snapshot.events.find(event => event.actor === 'u/' + actor);
  assert.ok(entry);
  assert.match(entry.message, new RegExp('Received orb roll from u/' + actor));
  assert.equal(entry.status, 200);
  assert.ok(snapshot.metrics.requestsLastMinute >= 1);
});

test('server monitor records errors and excludes its own polling endpoint', () => {
  const before = getServerMonitorSnapshot();
  let finish: (() => void) | undefined;
  beginServerRequest('GET', '/api/dev/server-monitor', 'MonitorAdmin', () => 200, (_event, callback) => {
    finish = callback;
  });
  finish?.();
  const after = getServerMonitorSnapshot();
  assert.equal(after.events.length, before.events.length);
  assert.equal(after.metrics.requestsLastMinute, before.metrics.requestsLastMinute);
});

test('Redis instrumentation contributes to a rolling operation-rate metric', () => {
  recordRedisOperation('get');
  recordRedisOperation('hGetAll');
  recordRedisOperation('not-a-redis-command');
  const snapshot = getServerMonitorSnapshot();
  assert.ok(snapshot.metrics.peakRedisOperationsPerSecond >= 2);
  assert.ok(snapshot.metrics.redisCapacityPercent >= 0);
  assert.equal(snapshot.limits.redisCommandsPerSecond, 40_000);
});

test('storage estimate breaks down indexed player, combat, registry, and shared values', async () => {
  const values: Record<string, string> = {
    'player:monitor-test-user': JSON.stringify({ username: 'MonitorTester', coins: 123 }),
    'infinity-orbs:combat:monitor-test-user': JSON.stringify({ depth: 7, inventory: [] }),
    'io:leaderboard': JSON.stringify([{ username: 'MonitorTester', value: 12 }]),
    'io:save-debug:v1': JSON.stringify([]),
  };
  const fakeRedis = {
    hGetAll: async (key: string) => key === 'io:player-registry'
      ? { 'monitor-test-user': JSON.stringify({ username: 'MonitorTester' }) }
      : {},
    mGet: async (keys: string[]) => keys.map(key => values[key] ?? null),
  };

  const estimate = await estimateKnownRedisStorage(fakeRedis);
  assert.equal(estimate.partial, true);
  assert.equal(estimate.playerCount, 1);
  assert.ok(estimate.knownBytes > 0);
  assert.ok(estimate.knownPercent >= 0);
  assert.ok(estimate.groups.some(group => group.label === 'Player saves' && group.records === 1));
  assert.ok(estimate.groups.some(group => group.label === 'Combat saves' && group.records === 1));
  assert.ok(estimate.groups.some(group => group.label === 'Player registry' && group.records === 1));
  assert.match(estimate.note, /Lower-bound estimate/);
});


test('upgrade batch diagnostics distinguish server acceptance, partial purchase, rejection, and client rollback', () => {
  const before = getServerMonitorSnapshot();

  recordUpgradeBatchDiagnostic({
    stage: 'server-accepted',
    username: 'shadow_fen',
    requestId: 'upgrade-diag-accepted-test',
    upgradeIds: ['speed'],
    status: 200,
    durationMs: 8,
    purchasedCount: 1,
  });
  recordUpgradeBatchDiagnostic({
    stage: 'server-partial',
    username: 'shadow_fen',
    requestId: 'upgrade-diag-partial-test',
    upgradeIds: ['speed', 'luck'],
    status: 200,
    durationMs: 11,
    purchasedCount: 1,
    message: 'Need more Coins for luck.',
  });
  recordUpgradeBatchDiagnostic({
    stage: 'server-rejected',
    username: 'shadow_fen',
    requestId: 'upgrade-diag-rejected-test',
    upgradeIds: ['criticalDividend'],
    status: 400,
    durationMs: 3,
    errorCode: 'INVALID_BATCH_IDS',
    message: 'Batch contained an unsupported upgrade.',
  });
  recordUpgradeBatchDiagnostic({
    stage: 'client-rollback',
    username: 'shadow_fen',
    requestId: 'upgrade-diag-rollback-test',
    upgradeIds: ['speed'],
    status: 503,
    durationMs: 3200,
    errorCode: 'PLAYER_MUTATION_QUEUED',
    message: 'Your action is queued and will retry automatically.',
  });

  const after = getServerMonitorSnapshot();
  assert.equal(after.upgradeBatches.serverAttempts - before.upgradeBatches.serverAttempts, 3);
  assert.equal(after.upgradeBatches.serverAccepted - before.upgradeBatches.serverAccepted, 1);
  assert.equal(after.upgradeBatches.serverPartial - before.upgradeBatches.serverPartial, 1);
  assert.equal(after.upgradeBatches.serverRejected - before.upgradeBatches.serverRejected, 1);
  assert.equal(after.upgradeBatches.clientRollbacks - before.upgradeBatches.clientRollbacks, 1);
  assert.ok(after.upgradeBatches.averageServerDurationMs >= 0);

  const partial = after.events.find(event => event.details?.requestId === 'upgrade-diag-partial-test');
  assert.ok(partial);
  assert.equal(partial?.details?.stage, 'server-partial');
  assert.equal(partial?.details?.purchasedCount, 1);
  assert.match(partial?.message ?? '', /Need more Coins for luck/);

  const rejected = after.events.find(event => event.details?.requestId === 'upgrade-diag-rejected-test');
  assert.ok(rejected);
  assert.equal(rejected?.details?.errorCode, 'INVALID_BATCH_IDS');

  const rollback = after.events.find(event => event.details?.requestId === 'upgrade-diag-rollback-test');
  assert.ok(rollback);
  assert.equal(rollback?.details?.stage, 'client-rollback');
});


test('storage estimate includes the payload represented by active chunked player-save manifests', async () => {
  const userId = 'chunked-monitor-user';
  const manifest = JSON.stringify({
    __ioPlayerSaveManifest: 1,
    token: 'playersave-test-token-1234',
    chunkCount: 4,
    length: 256 * 1024,
    checksum: 'deadbeef',
    projection: { username: 'ChunkedTester' },
  });
  const values: Record<string, string> = {
    ['player:' + userId]: manifest,
  };
  const fakeRedis = {
    hGetAll: async (key: string) => key === 'io:player-registry'
      ? { [userId]: JSON.stringify({ username: 'ChunkedTester' }) }
      : {},
    mGet: async (keys: string[]) => keys.map(key => values[key] ?? null),
  };

  const estimate = await estimateKnownRedisStorage(fakeRedis);
  const playerSaves = estimate.groups.find(group => group.label === 'Player saves');
  assert.ok(playerSaves);
  assert.ok(playerSaves.bytes >= 256 * 1024);
  assert.equal(playerSaves.records, 5); // manifest plus four active chunks
  assert.match(estimate.note, /Retired chunk generations/);
});


test('read-only Redis audit reports indexed saves, combat, shared keys, and byte leaders', async () => {
  const userId = 'redis-audit-fixture-user';
  const values: Record<string, string> = {
    ['player:' + userId]: JSON.stringify({
      username: 'AuditFixture',
      coins: 12345,
      saveGeneration: 2,
      collectionStorageVersion: 0,
    }),
    ['infinity-orbs:combat:' + userId]: JSON.stringify({ depth: 17, combatMarks: 9876 }),
    'io:guilds': JSON.stringify([{ id: 'audit-guild', name: 'Audit Guild' }]),
    'io:save-debug:v1': JSON.stringify([{ event: 'save-test' }]),
  };
  const fakeRedis = {
    hGetAll: async (key: string) => key === 'io:player-registry'
      ? { [userId]: JSON.stringify({ username: 'AuditFixture' }) }
      : {},
    get: async (key: string) => values[key] ?? null,
    mGet: async (keys: string[]) => keys.map(key => values[key] ?? null),
    zCard: async (_key: string) => 4,
  };

  const report = await auditKnownRedisStorage(fakeRedis);
  assert.equal(report.indexedPlayersTotal, 1);
  assert.equal(report.indexedPlayersAudited, 1);
  assert.equal(report.playerAuditTruncated, false);
  assert.equal(report.onlinePlayersCurrentCount, 4);
  assert.ok(report.knownIndexedPayloadBytes > 0);
  assert.ok(report.groups.some(group => group.label === 'Player saves' && group.keys === 1));
  assert.ok(report.groups.some(group => group.label === 'Combat saves' && group.keys === 1));
  assert.ok(report.groups.some(group => group.label === 'Guild data' && group.keys === 1));
  assert.ok(report.groups.some(group => group.label === 'Diagnostic logs' && group.keys === 1));
  assert.ok(report.largestKnownValues.length > 0);
  assert.equal(report.platformReportedTotalAvailable, false);
  assert.ok(report.limitations.some(item => /global key scanning/.test(item)));
});

test('read-only Redis audit inspects registered players beyond the former 100-player sample', async () => {
  const userIds = Array.from({ length: 120 }, (_, index) => 'redis-audit-user-' + String(index).padStart(3, '0'));
  const registry = Object.fromEntries(userIds.map(userId => [userId, JSON.stringify({ username: userId })]));
  const values: Record<string, string> = {};
  for (const userId of userIds) {
    values['player:' + userId] = JSON.stringify({ username: userId, saveGeneration: 1, collectionStorageVersion: 0 });
    values['infinity-orbs:combat:' + userId] = JSON.stringify({ depth: 1 });
  }
  const fakeRedis = {
    hGetAll: async (key: string) => key === 'io:player-registry' ? registry : {},
    get: async (key: string) => values[key] ?? null,
    mGet: async (keys: string[]) => keys.map(key => values[key] ?? null),
    zCard: async () => 0,
  };

  const report = await auditKnownRedisStorage(fakeRedis);
  assert.equal(report.indexedPlayersTotal, 120);
  assert.equal(report.indexedPlayersAudited, 120);
  assert.equal(report.playerAuditTruncated, false);
  assert.equal(report.groups.find(group => group.label === 'Player saves')?.keys, 120);
  assert.equal(report.groups.find(group => group.label === 'Combat saves')?.keys, 120);
});

test('read-only Redis audit estimates impression marker counts and payload bytes from viewer rows', async () => {
  const viewerA = 'a'.repeat(64);
  const viewerB = 'b'.repeat(64);
  const postIndex = {
    'main-game:t3_main': JSON.stringify({ postType: 'main-game', postId: 't3_main', lastSeenAt: 1 }),
    'orb-share:t3_share': JSON.stringify({ postType: 'orb-share', postId: 't3_share', lastSeenAt: 1 }),
    'frenzy:t3_frenzy': JSON.stringify({ postType: 'frenzy', postId: 't3_frenzy', lastSeenAt: 1 }),
  };
  const viewerIndex = { [viewerA]: '1', [viewerB]: '1' };
  const viewerRows: Record<string, string> = {
    ['io:impressions:unique-v2:viewer:' + viewerA]: JSON.stringify({
      uniquePostViews: 3,
      byType: { 'main-game': 2, 'orb-share': 1, frenzy: 0 },
    }),
    ['io:impressions:unique-v2:viewer:' + viewerB]: JSON.stringify({
      uniquePostViews: 2,
      byType: { 'main-game': 0, 'orb-share': 0, frenzy: 2 },
    }),
    ['io:impressions:unique-v2:seen-user:' + viewerA]: '1',
    ['io:impressions:unique-v2:seen-user:' + viewerB]: '1',
    ['io:impressions:unique-v2:seen-type-user:main-game:' + viewerA]: '1',
    ['io:impressions:unique-v2:seen-type-user:orb-share:' + viewerA]: '1',
    ['io:impressions:unique-v2:seen-type-user:frenzy:' + viewerB]: '1',
    ['io:impressions:unique-v2:source-eligible-user:orb-share:' + viewerA]: '1',
    ['io:impressions:unique-v2:source-eligible-user:frenzy:' + viewerB]: '1',
  };
  const fakeRedis = {
    hGetAll: async (key: string) => {
      if (key === 'io:impressions:unique-v2:post-index') return postIndex;
      if (key === 'io:impressions:unique-v2:viewer-index') return viewerIndex;
      return {};
    },
    get: async (key: string) => viewerRows[key] ?? null,
    mGet: async (keys: string[]) => keys.map(key => viewerRows[key] ?? null),
    zCard: async () => 0,
  };

  const report = await auditKnownRedisStorage(fakeRedis);
  assert.equal(report.impressionPostIndexFields, 3);
  assert.equal(report.impressionViewerIndexFields, 2);
  assert.equal(report.impressionViewerIndexConfiguredCap, 2_000);
  assert.equal(report.impressionViewerIndexOverCap, 0);
  assert.equal(report.impressionViewerRecordsParsed, 2);
  assert.equal(report.impressionViewerRecordsMissing, 0);
  assert.equal(report.impressionViewerRecordsInvalid, 0);
  assert.equal(report.impressionViewerCountMismatches, 0);
  assert.equal(report.impressionViewerUniquePostViews, 5);
  assert.deepEqual(report.impressionViewerUniquePostViewsByType, {
    'main-game': 2,
    'orb-share': 1,
    frenzy: 2,
  });
  assert.equal(report.impressionSeenPostMarkerEstimatedCount, 5);
  assert.equal(report.impressionSeenUserMarkerEstimatedCount, 2);
  assert.equal(report.impressionSeenTypeMarkerEstimatedCount, 3);
  assert.equal(report.impressionViewerMarkerEstimatedCount, 10);
  assert.equal(report.impressionMarkerKeysAudited, 13);
  assert.equal(report.impressionMarkerKeysPresent, 7);
  assert.ok(report.groups.some(group => group.label === 'Impression unique-user markers' && group.keys === 2));
  assert.ok(report.groups.some(group => group.label === 'Impression unique-type markers' && group.keys === 3));
  assert.ok(report.groups.some(group => group.label === 'Impression source-eligibility markers' && group.keys === 2));
  assert.ok(report.impressionSeenPostMarkerEstimatedBytes > 0);
  assert.ok(report.impressionViewerMarkerEstimatedBytes > report.impressionSeenPostMarkerEstimatedBytes);
});

test('read-only Redis audit discovers legacy-leaderboard-only player saves', async () => {
  const legacyUserId = 'legacy-leaderboard-only-user';
  const values: Record<string, string> = {
    'io:leaderboard': JSON.stringify([{ userId: legacyUserId, username: 'LegacyAccount' }]),
    ['player:' + legacyUserId]: JSON.stringify({ username: 'LegacyAccount', coins: 99 }),
  };
  const fakeRedis = {
    get: async (key: string) => values[key] ?? null,
    hGetAll: async (key: string) => key === 'io:player-registry' ? {} : {},
    mGet: async (keys: string[]) => keys.map(key => values[key] ?? null),
    zCard: async () => 0,
  };

  const report = await auditKnownRedisStorage(fakeRedis);
  assert.equal(report.indexedPlayersTotal, 0);
  assert.equal(report.indexedPlayersIncludingLegacyLeaderboard, 1);
  assert.equal(report.indexedPlayersAudited, 1);
  assert.equal(report.legacyLeaderboardPlayerIds, 1);
  assert.equal(report.legacyLeaderboardIdsMissingRegistry, 1);
  assert.equal(report.groups.find(group => group.label === 'Player saves')?.keys, 1);
});

test('read-only Redis audit finds retired impression namespace and indexed Frenzy metadata', async () => {
  const legacyPostId = 't3_legacyfrenzy123';
  const hour = Math.floor(Date.now() / 3_600_000);
  const day = Math.floor(Date.now() / 86_400_000);
  const values: Record<string, string> = {
    'io:impressions:total': '777',
    ['io:impressions:post:frenzy:' + encodeURIComponent(legacyPostId)]: '12',
    ['io:impressions:hour:' + hour + ':frenzy']: '3',
    ['io:impressions:day:' + day + ':frenzy']: '4',
    ['io:frenzy:post:' + legacyPostId]: JSON.stringify({ ownerId: 'owner', rarity: 12 }),
    ['io:frenzy:claimers:v1:' + encodeURIComponent(legacyPostId)]: JSON.stringify({ count: 2, players: [] }),
  };
  const legacyPostIndex = {
    ['frenzy:' + legacyPostId]: JSON.stringify({
      postType: 'frenzy',
      postId: legacyPostId,
      lastSeenAt: Date.now(),
    }),
  };
  const fakeRedis = {
    get: async (key: string) => values[key] ?? null,
    hGetAll: async (key: string) => key === 'io:impressions:post-index' ? legacyPostIndex : {},
    mGet: async (keys: string[]) => keys.map(key => values[key] ?? null),
    zCard: async () => 0,
  };

  const report = await auditKnownRedisStorage(fakeRedis);
  assert.equal(report.legacyImpressionPostIndexFields, 1);
  assert.equal(report.legacyImpressionPostCountersPresent, 1);
  assert.ok(report.legacyImpressionTimeBucketKeysPresent >= 2);
  assert.ok(report.groups.some(group => group.label === 'Legacy impression analytics' && group.bytes > 0));
  assert.equal(report.indexedPostMetadataKeysPresent, 2);
  assert.ok(report.groups.some(group => group.label === 'Frenzy post records' && group.keys === 1));
  assert.ok(report.groups.some(group => group.label === 'Frenzy claimer projections' && group.keys === 1));
});

test('read-only Redis audit follows retained Global Booster credit operation IDs', async () => {
  const operationId = 'audit-credit-operation-001';
  const recipientId = 'audit-credit-recipient';
  const batchKey = 'io:admin-global-booster-credit-batch:' + operationId;
  const receiptKey = 'io:admin-global-booster-credit-grant:' + operationId + ':' + recipientId;
  const values: Record<string, string> = {
    'io:global-booster-debug-log:v1': JSON.stringify([{
      stage: 'admin:grant-credits',
      operationId,
      affectedUsers: 1,
    }]),
    [batchKey]: JSON.stringify({
      version: 1,
      operationId,
      scope: 'all',
      amount: 10,
      createdAt: Date.now(),
      userIds: [{ userId: recipientId, username: 'Recipient' }],
    }),
    [receiptKey]: JSON.stringify({ amount: 10, before: 0, after: 10, createdAt: Date.now() }),
  };
  const fakeRedis = {
    get: async (key: string) => values[key] ?? null,
    hGetAll: async () => ({}),
    mGet: async (keys: string[]) => keys.map(key => values[key] ?? null),
    zCard: async () => 0,
  };

  const report = await auditKnownRedisStorage(fakeRedis);
  assert.equal(report.adminCreditOperationsFound, 1);
  assert.equal(report.adminCreditOperationsAudited, 1);
  assert.equal(report.adminCreditOperationsSkipped, 0);
  assert.equal(report.adminCreditGrantReceiptsPresent, 1);
  assert.ok(report.groups.some(group => group.label === 'Admin Global Booster credit manifests' && group.keys === 1));
  assert.ok(report.groups.some(group => group.label === 'Admin Global Booster credit receipts' && group.keys === 1));
});


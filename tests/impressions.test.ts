import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  configureDevvitRuntime,
  redis as originalRedis,
  context as originalContext,
  reddit as originalReddit,
} from '../src/server/devvit-mock.js';
import { getImpressionDashboard, recordPostImpression, recordMainGamePostConversion } from '../src/server/impressions.js';

test('post impressions count aggregate metrics without registering online-player activity', async () => {
  const baseRedis = originalRedis;
  const baseContext = originalContext;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const mainPostId = 't3_impression-main-' + suffix;
  const sharePostId = 't3_impression-share-' + suffix;
  const testContext = {
    ...baseContext,
    userId: 'impression-viewer-' + suffix,
    username: 'ImpressionViewer',
    postId: mainPostId,
  };

  configureDevvitRuntime({ redis: baseRedis, context: testContext, reddit: baseReddit });
  try {
    const [before, presenceBefore, registryBefore] = await Promise.all([
      getImpressionDashboard(),
      baseRedis.get('io:online:players'),
      baseRedis.hGetAll('io:player-registry'),
    ]);

    assert.deepEqual(await recordPostImpression('main-game', 'desktop'), { recorded: true });
    configureDevvitRuntime({ redis: baseRedis, context: { ...testContext, postId: sharePostId }, reddit: baseReddit });
    assert.deepEqual(await recordPostImpression('orb-share', 'mobile'), { recorded: true });

    const [after, presenceAfter, registryAfter] = await Promise.all([
      getImpressionDashboard(),
      baseRedis.get('io:online:players'),
      baseRedis.hGetAll('io:player-registry'),
    ]);

    assert.equal(after.total - before.total, 2, 'one unique account view is counted per post');
    assert.equal(after.uniqueUsers - before.uniqueUsers, 1, 'same account deduplicates across posts');
    assert.equal(after.uniqueToday - before.uniqueToday, 1, 'same account deduplicates for the day');
    assert.equal(after.uniqueByType['main-game'] - before.uniqueByType['main-game'], 1);
    assert.equal(after.uniqueByType['orb-share'] - before.uniqueByType['orb-share'], 1);
    assert.equal(after.byType['main-game'] - before.byType['main-game'], 1);
    assert.equal(after.byType['orb-share'] - before.byType['orb-share'], 1);
    assert.equal(after.byDevice.desktop - before.byDevice.desktop, 1);
    assert.equal(after.byDevice.mobile - before.byDevice.mobile, 1);
    assert.ok(after.posts.some(post => post.postId === mainPostId && post.postType === 'main-game' && post.impressions === 1));
    assert.ok(after.posts.some(post => post.postId === sharePostId && post.postType === 'orb-share' && post.impressions === 1));
    const viewer = after.viewers.find(row => row.username === 'ImpressionViewer');
    assert.ok(viewer, 'admin analytics should expose the public username for the account');
    assert.equal(viewer.uniquePostViews, 2, 'per-user view count should count each unique post once');
    assert.equal(viewer.byType['main-game'], 1);
    assert.equal(viewer.byType['orb-share'], 1);
    assert.equal(viewer.byType.frenzy, 0);
    assert.equal('userId' in viewer, false, 'dashboard viewer rows must not expose raw Reddit user IDs');

    assert.equal(presenceAfter, presenceBefore, 'impressions must not touch the online-player sorted set');
    assert.deepEqual(registryAfter, registryBefore, 'impressions must not register player activity');
  } finally {
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('dashboard uses a safe timestamp for malformed time inputs', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  configureDevvitRuntime({ redis: baseRedis, context: { ...baseContext, postId: 't3_invalid-dashboard-time' }, reddit: baseReddit });
  try {
    const dashboard = await getImpressionDashboard(Number.NaN);
    const hugeFiniteDashboard = await getImpressionDashboard(Number.MAX_SAFE_INTEGER);
    assert.ok(Number.isFinite(dashboard.generatedAt));
    assert.ok(dashboard.generatedAt > 0);
    assert.ok(Number.isFinite(new Date(dashboard.generatedAt).getTime()));
    assert.ok(Number.isFinite(new Date(hugeFiniteDashboard.generatedAt).getTime()));
    assert.ok(hugeFiniteDashboard.generatedAt < Number.MAX_SAFE_INTEGER);
    assert.equal(dashboard.last24Hours.length, 24);
    assert.equal(dashboard.last30Days.length, 30);
  } finally {
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('impression dashboard treats malformed aggregate counters as zero', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const key = 'io:impressions:unique-v2:post-views';
  const previous = await baseRedis.get(key);
  configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  try {
    await baseRedis.set(key, '12visits');
    const dashboard = await getImpressionDashboard(Date.UTC(2026, 9, 20));
    assert.equal(dashboard.total, 0);
  } finally {
    if (previous == null) await baseRedis.del(key);
    else await baseRedis.set(key, previous);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('impression recording ignores unreasonably long post identifiers', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  configureDevvitRuntime({ redis: baseRedis, context: { ...baseContext, postId: 'x'.repeat(201) }, reddit: baseReddit });
  try {
    assert.deepEqual(await recordPostImpression('frenzy', 'desktop'), { recorded: false });
  } finally {
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('impression recording rejects unsupported post types and skips missing post context', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, userId: '', username: '', postId: '' },
    reddit: baseReddit,
  });
  try {
    assert.deepEqual(await recordPostImpression('frenzy', 'unknown'), { recorded: false });
    await assert.rejects(recordPostImpression('profile', 'desktop'), /Unsupported impression post type/);
  } finally {
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('client post ID preserves impressions when Devvit server context lacks post ID', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const postId = 't3_impression-contextless-' + suffix;
  configureDevvitRuntime({ redis: baseRedis, context: { ...baseContext, userId: 'impression-contextless-' + suffix, username: 'ContextlessViewer', postId: '' }, reddit: baseReddit });
  try {
    const before = await getImpressionDashboard();
    assert.deepEqual(await recordPostImpression('main-game', 'desktop', postId), { recorded: true });
    const after = await getImpressionDashboard();
    assert.equal(after.total, before.total + 1);
    assert.ok(after.posts.some(post => post.postId === postId && post.postType === 'main-game' && post.impressions === 1));
    const viewer = after.viewers.find(row => row.username === 'ContextlessViewer');
    assert.ok(viewer);
    assert.equal(viewer.uniquePostViews, 1);
  } finally {
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('main game, Orb Share, and Frenzy clients report only coarse aggregate impression fields', () => {
  const splash = readFileSync(resolve(process.cwd(), 'src/client/splash.tsx'), 'utf8');
  const frenzy = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  const reporter = readFileSync(resolve(process.cwd(), 'src/client/impressions.ts'), 'utf8');
  const api = readFileSync(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
  const admin = readFileSync(resolve(process.cwd(), 'src/server/debug.ts'), 'utf8');
  const adminUi = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');

  assert.match(splash, /recordPostImpression\(impressionPostType, context\.postId\)/);
  assert.match(splash, /postData\.type === 'shared-orb' \? 'orb-share' : 'main-game'/);
  assert.match(frenzy, /recordPostImpression\('frenzy', context\.postId\)/);
  assert.match(reporter, /JSON\.stringify\(\{ postType, deviceType: detectDeviceType\(\), postId \}\)/);
  assert.match(reporter, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(reporter, /if \(!response\.ok\)/);
  assert.doesNotMatch(reporter, /username\s*:|userId\s*:|userAgent\s*:/i);
  assert.doesNotMatch(reporter, /username\s*:|userId\s*:|userAgent\s*:/i);
  assert.match(api, /app\.post\('\/api\/impressions'/);
  assert.match(api, /req\.path === '\/impressions'/);
  assert.ok(api.includes("app.post('/api/impressions/conversion'"));
  assert.ok(reporter.includes("fetch('/api/impressions/conversion'"));
  assert.ok(splash.includes('trackMainGameConversion'));
  assert.ok(adminUi.includes('conversionByDevice'));
  assert.match(admin, /debugRouter\.get\('\/impressions'/);
});


test('impression time buckets and per-post counters have bounded retention', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/impressions.ts'), 'utf8');
  assert.match(source, /const postCounterExpiration = new Date\(now \+ 180 \* 86_400_000\)/);
  assert.match(source, /const hourBucketExpiration = new Date\(\(hour \+ 25\) \* 3_600_000\)/);
  assert.match(source, /const dayBucketExpiration = new Date\(\(day \+ 31\) \* 86_400_000\)/);
  assert.match(source, /txn\.set\(keyForPost, String\(nextPost\), \{ expiration: postCounterExpiration \}\)/);
  assert.match(source, /txn\.set\(HOUR_PREFIX \+ hour \+ ':' \+ postType, String\(nextHour\), \{ expiration: hourBucketExpiration \}\)/);
  assert.match(source, /txn\.set\(DAY_PREFIX \+ day \+ ':' \+ postType, String\(nextDay\), \{ expiration: dayBucketExpiration \}\)/);
  assert.match(source, /const postIndexRetentionCutoff = now - 180 \* 86_400_000/);
  assert.match(source, /entry\.invalid \|\| entry\.lastSeenAt < postIndexRetentionCutoff/);
  assert.match(source, /const recentEntries = entries\.filter\(/);
  assert.match(source, /const overflowEntries = recentEntries\.slice\(MAX_INDEXED_POSTS\)/);
  assert.match(source, /\.slice\(0, 250\)/);
});

test('dashboard excludes and cleans expired or corrupt post-index rows during quiet periods', async () => {
  const baseRedis = originalRedis;
  const baseContext = originalContext;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const oldPostId = 't3_stale-impression-index-' + suffix;
  const badPostId = 't3_corrupt-impression-index-' + suffix;
  const indexKey = 'io:impressions:unique-v2:post-index';
  const oldField = 'main-game:' + oldPostId;
  const badField = 'main-game:' + badPostId;
  const oldValue = await baseRedis.hGet(indexKey, oldField);
  const badValue = await baseRedis.hGet(indexKey, badField);
  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, userId: 'impression-index-retention-' + suffix, username: 'ImpressionIndexRetention' },
    reddit: baseReddit,
  });
  try {
    const now = Date.now();
    await baseRedis.hSet(indexKey, {
      [oldField]: JSON.stringify({ postType: 'main-game', postId: oldPostId, lastSeenAt: now - 181 * 86_400_000 }),
      [badField]: '{invalid json',
    });
    const dashboard = await getImpressionDashboard(now);
    assert.equal(dashboard.posts.some(row => row.postId === oldPostId || row.postId === badPostId), false);
    assert.equal(await baseRedis.hGet(indexKey, oldField), undefined);
    assert.equal(await baseRedis.hGet(indexKey, badField), undefined);
  } finally {
    if (oldValue == null) await baseRedis.hDel(indexKey, oldField);
    else await baseRedis.hSet(indexKey, { [oldField]: oldValue });
    if (badValue == null) await baseRedis.hDel(indexKey, badField);
    else await baseRedis.hSet(indexKey, { [badField]: badValue });
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('watched impression-index cleanup does not delete a row refreshed concurrently', async () => {
  const baseRedis = originalRedis;
  const baseContext = originalContext;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const postId = 't3_impression-cleanup-race-' + suffix;
  const indexKey = 'io:impressions:unique-v2:post-index';
  const field = 'main-game:' + postId;
  const previous = await baseRedis.hGet(indexKey, field);
  const cutoff = Date.now() - 181 * 86_400_000;
  let changedAfterWatchedRead = false;
  let armed = false;
  const racingRedis = {
    ...baseRedis,
    watch: async (...keys: string[]) => {
      const txn = await baseRedis.watch(...keys);
      if (keys.includes(indexKey)) armed = true;
      return txn;
    },
    hGetAll: async (key: string) => {
      const snapshot = await baseRedis.hGetAll(key);
      if (key === indexKey && armed && !changedAfterWatchedRead) {
        changedAfterWatchedRead = true;
        await baseRedis.hSet(indexKey, {
          [field]: JSON.stringify({ postType: 'main-game', postId, lastSeenAt: Date.now() }),
        });
      }
      return snapshot;
    },
  };
  configureDevvitRuntime({
    redis: racingRedis,
    context: { ...baseContext, userId: 'impression-cleanup-race-' + suffix, username: 'ImpressionCleanupRace' },
    reddit: baseReddit,
  });
  try {
    await baseRedis.hSet(indexKey, {
      [field]: JSON.stringify({ postType: 'main-game', postId, lastSeenAt: cutoff }),
    });
    await getImpressionDashboard();
    const current = await baseRedis.hGet(indexKey, field);
    assert.ok(current, 'freshened index record must survive stale-snapshot cleanup');
    assert.ok(Number(JSON.parse(String(current)).lastSeenAt) >= Date.now() - 10_000);
    assert.equal(changedAfterWatchedRead, true);
  } finally {
    if (previous == null) await baseRedis.hDel(indexKey, field);
    else await baseRedis.hSet(indexKey, { [field]: previous });
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('concurrent impression bursts count one account/post view', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const postId = 't3_impression-burst-' + suffix;
  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, postId, userId: 'impression-burst-' + suffix, username: 'ImpressionBurst' },
    reddit: baseReddit,
  });
  try {
    const before = await getImpressionDashboard();
    const burstSize = 16;
    const results = await Promise.all(Array.from({ length: burstSize }, () => recordPostImpression('main-game', 'desktop')));
    assert.equal(results.filter(result => result.recorded).length, 1, 'only the first duplicate request should count');
    const after = await getImpressionDashboard();
    assert.equal(after.total - before.total, 1);
    assert.equal(after.uniqueUsers - before.uniqueUsers, 1);
    assert.equal(after.byType['main-game'] - before.byType['main-game'], 1);
    assert.equal(after.byDevice.desktop - before.byDevice.desktop, 1);
    const post = after.posts.find(row => row.postId === postId && row.postType === 'main-game');
    assert.equal(post?.impressions, 1);
  } finally {
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('impression counters commit together instead of leaving partial counts on failure', async () => {
  const baseRedis = originalRedis;
  const baseContext = originalContext;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const postId = 't3_impression-atomic-' + suffix;
  let injected = false;
  const transactionalRedis = {
    ...baseRedis,
    watch: async (...keys: string[]) => {
      const txn = await baseRedis.watch(...keys);
      return {
        ...txn,
        set: async (key: string, value: string, options?: { expiration?: Date }) => {
          if (!injected && key.startsWith('io:impressions:unique-v2:device:')) {
            injected = true;
            throw new Error('simulated queued counter write failure');
          }
          return txn.set(key, value, options);
        },
      };
    },
  };
  configureDevvitRuntime({
    redis: transactionalRedis,
    context: { ...baseContext, postId, userId: 'impression-atomic-' + suffix, username: 'ImpressionAtomic' },
    reddit: baseReddit,
  });
  try {
    const before = await getImpressionDashboard();
    await assert.rejects(recordPostImpression('main-game', 'desktop'), /simulated queued counter write failure/);
    const after = await getImpressionDashboard();
    assert.equal(after.total, before.total, 'global total must stay unchanged if the multi-key commit was never issued');
    assert.equal(after.byType['main-game'], before.byType['main-game']);
    assert.equal(after.byDevice.desktop, before.byDevice.desktop);
    assert.equal(after.posts.some(post => post.postId === postId), false);
  } finally {
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});


test('main-game Play CTA records one unique conversion and attributes the rate to device type', async () => {
  const baseRedis = originalRedis;
  const baseContext = originalContext;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const postId = 't3_main-game-conversion-' + suffix;
  const canonicalPostKey = 'io:global-game-post-id';
  const previousCanonicalPostId = await baseRedis.get(canonicalPostKey);
  const userId = 'main-game-conversion-viewer-' + suffix;

  await baseRedis.set(canonicalPostKey, postId);
  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, userId, username: 'MainGameConversionViewer', postId },
    reddit: baseReddit,
  });

  try {
    const before = await getImpressionDashboard();
    assert.deepEqual(await recordPostImpression('main-game', 'desktop'), { recorded: true });
    assert.deepEqual(await recordMainGamePostConversion(postId, 'desktop'), { recorded: true });
    assert.deepEqual(await recordMainGamePostConversion(postId, 'desktop'), { recorded: false });

    const after = await getImpressionDashboard();
    assert.equal(after.conversion['main-game'].conversions, before.conversion['main-game'].conversions + 1);
    assert.equal(after.conversion['main-game'].eligibleViewers, after.byType['main-game']);
    assert.equal(after.conversionByDevice.desktop.conversions, before.conversionByDevice.desktop.conversions + 1);
    assert.equal(after.conversionByDevice.desktop.eligibleViewers,
      after.byTypeAndDevice['main-game'].desktop);
    assert.ok(after.conversionByDevice.desktop.rate !== null);
    assert.ok(after.conversionByDevice.desktop.rate! >= 0 && after.conversionByDevice.desktop.rate! <= 1);

    const client = readFileSync(resolve(process.cwd(), 'src/client/splash.tsx'), 'utf8');
    const api = readFileSync(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
    assert.match(client, /trackMainGameConversion/);
    assert.match(client, /recordMainGamePostConversion\(context\.postId\)/);
    assert.match(api, /app\.post\('\/api\/impressions\/conversion'/);
  } finally {
    if (previousCanonicalPostId == null) await baseRedis.del(canonicalPostKey);
    else await baseRedis.set(canonicalPostKey, previousCanonicalPostId);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});


test('shadow_fen is excluded from all post impression and main-game conversion tracking', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const types = ['main-game', 'orb-share', 'frenzy'] as const;
  const postIds = types.map(type => 't3_excluded-shadow-fen-' + type + '-' + suffix);
  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, userId: 'excluded-admin-' + suffix, username: 'u/Shadow_Fen', postId: postIds[0] },
    reddit: baseReddit,
  });
  try {
    const before = await getImpressionDashboard();
    for (let index = 0; index < types.length; index += 1) {
      configureDevvitRuntime({
        redis: baseRedis,
        context: { ...baseContext, userId: 'excluded-admin-' + suffix, username: 'u/Shadow_Fen', postId: postIds[index] },
        reddit: baseReddit,
      });
      assert.deepEqual(await recordPostImpression(types[index], 'desktop', postIds[index]), { recorded: false });
    }
    configureDevvitRuntime({
      redis: baseRedis,
      context: { ...baseContext, userId: 'excluded-admin-' + suffix, username: 'u/Shadow_Fen', postId: postIds[0] },
      reddit: baseReddit,
    });
    assert.deepEqual(await recordMainGamePostConversion(postIds[0], 'desktop'), { recorded: false });

    const after = await getImpressionDashboard();
    assert.equal(after.total, before.total);
    assert.equal(after.uniqueUsers, before.uniqueUsers);
    assert.equal(after.uniqueToday, before.uniqueToday);
    assert.deepEqual(after.uniqueByType, before.uniqueByType);
    assert.deepEqual(after.byType, before.byType);
    assert.deepEqual(after.byDevice, before.byDevice);
    assert.deepEqual(after.byTypeAndDevice, before.byTypeAndDevice);
    assert.equal(after.trackedPostCount, before.trackedPostCount);
    assert.equal(after.posts.some(post => postIds.includes(post.postId)), false);
  } finally {
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});


test('impression dashboard hides existing shadow_fen viewer and retention records', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const now = Date.now();
  const day1Start = (Math.floor(now / 86_400_000) - 1) * 86_400_000 + 1_000;
  const viewerIndexKey = 'io:impressions:unique-v2:viewer-index';
  const viewerHash = 'synthetic-shadow-fen-viewer-' + suffix;
  const viewerRecordKey = 'io:impressions:unique-v2:viewer:' + viewerHash;
  const registryKey = 'io:player-registry';
  const registryField = 'synthetic-shadow-fen-retention-' + suffix;
  const previousViewerIndexValue = await baseRedis.hGet(viewerIndexKey, viewerHash);
  const previousViewerRecord = await baseRedis.get(viewerRecordKey);
  const previousRegistryRecord = await baseRedis.hGet(registryKey, registryField);
  configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  try {
    const before = await getImpressionDashboard(now);
    await baseRedis.hSet(viewerIndexKey, { [viewerHash]: '1' });
    await baseRedis.set(viewerRecordKey, JSON.stringify({
      username: 'shadow_fen',
      uniquePostViews: 7,
      byType: { 'main-game': 3, 'orb-share': 2, frenzy: 2 },
      firstSeenAt: day1Start,
      lastSeenAt: now,
    }));
    await baseRedis.hSet(registryKey, {
      [registryField]: JSON.stringify({ username: 'shadow_fen', firstSeenAt: day1Start, lastSeenAt: now }),
    });

    const after = await getImpressionDashboard(now);
    assert.equal(after.viewers.some(row => row.username.toLowerCase() === 'shadow_fen'), false);
    assert.equal(after.newPlayersToday, before.newPlayersToday);
    assert.equal(after.day1Retention.cohortSize, before.day1Retention.cohortSize);
    assert.equal(after.day1Retention.retained, before.day1Retention.retained);
  } finally {
    if (previousViewerIndexValue == null) await baseRedis.hDel(viewerIndexKey, viewerHash);
    else await baseRedis.hSet(viewerIndexKey, { [viewerHash]: previousViewerIndexValue });
    if (previousViewerRecord == null) await baseRedis.del(viewerRecordKey);
    else await baseRedis.set(viewerRecordKey, previousViewerRecord);
    if (previousRegistryRecord == null) await baseRedis.hDel(registryKey, registryField);
    else await baseRedis.hSet(registryKey, { [registryField]: previousRegistryRecord });
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

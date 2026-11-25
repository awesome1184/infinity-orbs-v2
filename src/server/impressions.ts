import { context, redis } from './devvit-mock.js';
import { readInBatches } from './redis-batches.js';

export type ImpressionPostType = 'main-game' | 'orb-share' | 'frenzy';
export type ImpressionDeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

const POST_TYPES: ImpressionPostType[] = ['main-game', 'orb-share', 'frenzy'];
const DEVICE_TYPES: ImpressionDeviceType[] = ['mobile', 'tablet', 'desktop', 'unknown'];
// v2 uses account/post-deduplicated keys; old raw-load totals cannot be migrated into unique views.
const ANALYTICS_PREFIX = 'io:impressions:unique-v2:';
const TOTAL_KEY = ANALYTICS_PREFIX + 'post-views';
const TYPE_PREFIX = ANALYTICS_PREFIX + 'type:';
const DEVICE_PREFIX = ANALYTICS_PREFIX + 'device:';
const POST_PREFIX = ANALYTICS_PREFIX + 'post:';
const POST_INDEX_KEY = ANALYTICS_PREFIX + 'post-index';
const TYPE_DEVICE_PREFIX = ANALYTICS_PREFIX + 'type-device:';
const HOUR_PREFIX = ANALYTICS_PREFIX + 'hour:';
const DAY_PREFIX = ANALYTICS_PREFIX + 'day:';
const INDEX_PRUNE_COUNTER_KEY = ANALYTICS_PREFIX + 'index-prune-counter';
const UNIQUE_USER_COUNT_KEY = ANALYTICS_PREFIX + 'unique-users';
const UNIQUE_TODAY_COUNT_PREFIX = ANALYTICS_PREFIX + 'unique-today:';
const UNIQUE_TYPE_COUNT_PREFIX = ANALYTICS_PREFIX + 'unique-type-count:';
const UNIQUE_POST_MARKER_PREFIX = ANALYTICS_PREFIX + 'seen-post-user:';
const UNIQUE_USER_MARKER_PREFIX = ANALYTICS_PREFIX + 'seen-user:';
const UNIQUE_DAY_MARKER_PREFIX = ANALYTICS_PREFIX + 'seen-day-user:';
const UNIQUE_TYPE_MARKER_PREFIX = ANALYTICS_PREFIX + 'seen-type-user:';
const SOURCE_TYPES: Array<'orb-share' | 'frenzy'> = ['orb-share', 'frenzy'];
const SOURCE_ELIGIBLE_COUNT_PREFIX = ANALYTICS_PREFIX + 'source-eligible-count:';
const SOURCE_ELIGIBLE_MARKER_PREFIX = ANALYTICS_PREFIX + 'source-eligible-user:';
const SOURCE_TOUCH_PREFIX = ANALYTICS_PREFIX + 'source-touch:';
const CONVERSION_COUNT_PREFIX = ANALYTICS_PREFIX + 'conversion-count:';
const CONVERSION_MARKER_PREFIX = ANALYTICS_PREFIX + 'converted-user:';
const CONVERSION_DEVICE_COUNT_PREFIX = ANALYTICS_PREFIX + 'conversion-device-count:';
const MAIN_GAME_POST_CONVERSION_ID = 'main-game-post';
const PLAYER_REGISTRY_KEY = 'io:player-registry';
const GLOBAL_GAME_POST_KEY = 'io:global-game-post-id';
const DAY_MS = 86_400_000;
const ATTRIBUTION_WINDOW_MS = 7 * DAY_MS;
const UNIQUE_DAY_RETENTION_MS = 35 * DAY_MS;
const INDEX_PRUNE_EVERY = 100;
const MAX_INDEXED_POSTS = 2_000;
const MAX_INDEXED_VIEWERS = 2_000;
const VIEWER_INDEX_KEY = ANALYTICS_PREFIX + 'viewer-index';
const VIEWER_RECORD_PREFIX = ANALYTICS_PREFIX + 'viewer:';
const VIEWER_RECORD_RETENTION_MS = 180 * 86_400_000;
const MAX_COUNTER_COMMIT_ATTEMPTS = 24;

function normalizePostType(value: unknown): ImpressionPostType {
  const candidate = String(value ?? '').trim();
  if (!POST_TYPES.includes(candidate as ImpressionPostType)) {
    throw new Error('Unsupported impression post type.');
  }
  return candidate as ImpressionPostType;
}

function normalizeDeviceType(value: unknown): ImpressionDeviceType {
  const candidate = String(value ?? '').trim();
  return DEVICE_TYPES.includes(candidate as ImpressionDeviceType)
    ? candidate as ImpressionDeviceType
    : 'unknown';
}

/** Internal developer traffic must never affect public acquisition/engagement analytics. */
function isExcludedImpressionUsername(value: unknown): boolean {
  return String(value ?? '').trim().replace(/^u\//i, '').toLowerCase() === 'shadow_fen';
}

function normalizeCount(value: unknown): number {
  const raw = value === null || value === undefined || value === '' ? '0' : value;
  const count = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/** Normalize persisted impression counters before exposing or aggregating them. */
export function normalizeImpressionCount(value: unknown): number {
  return normalizeCount(value);
}

function postKey(postType: ImpressionPostType, postId: string): string {
  return POST_PREFIX + postType + ':' + encodeURIComponent(postId);
}

async function readCount(key: string): Promise<number> {
  return normalizeCount(await redis.get(key));
}

async function prunePostIndex(now: number): Promise<void> {
  const postIndexRetentionCutoff = now - 180 * 86_400_000;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(POST_INDEX_KEY);
    let transactionClosed = false;
    try {
      const currentIndex = await redis.hGetAll(POST_INDEX_KEY);
      const entries = Object.entries(currentIndex ?? {}).map(([field, raw]) => {
        try {
          const parsed = JSON.parse(String(raw)) as { postType?: unknown; postId?: unknown; lastSeenAt?: unknown };
          normalizePostType(parsed.postType);
          const postId = String(parsed.postId ?? '').trim();
          const lastSeenAt = Number(parsed.lastSeenAt ?? 0);
          const valid = Boolean(postId) && postId.length <= 200 &&
            Number.isSafeInteger(lastSeenAt) && lastSeenAt >= 0;
          return { field, lastSeenAt: valid ? lastSeenAt : 0, invalid: !valid };
        } catch {
          return { field, lastSeenAt: 0, invalid: true };
        }
      }).sort((a, b) => b.lastSeenAt - a.lastSeenAt);

      const expiredOrInvalid = entries.filter(
        entry => entry.invalid || entry.lastSeenAt < postIndexRetentionCutoff,
      );
      const recentEntries = entries.filter(
        entry => !entry.invalid && entry.lastSeenAt >= postIndexRetentionCutoff,
      );
      const overflowEntries = recentEntries.slice(MAX_INDEXED_POSTS);
      const fieldsToPrune = [...new Set([
        ...expiredOrInvalid,
        ...overflowEntries,
      ].map(entry => entry.field))].slice(0, 250);

      if (fieldsToPrune.length === 0) {
        await txn.unwatch();
        transactionClosed = true;
        return;
      }

      await txn.multi();
      for (const field of fieldsToPrune) await txn.hDel(POST_INDEX_KEY, field);
      const result = await txn.exec();
      transactionClosed = true;
      if (result !== null) return;
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
    }

    // Another view changed the shared hash during the prune. Yield and retry
    // a small, bounded number of times; the next impression/dashboard read can
    // continue cleanup if contention remains high.
    await new Promise(resolve => setTimeout(resolve, Math.min(5 * (attempt + 1), 20)));
  }
  throw new Error('Impression index changed repeatedly; cleanup will retry later.');
}

/**
 * Records unique account/post preview counts using one-way hashed account markers.
 * Raw usernames, raw IDs, and device fingerprints are not stored. This module
 * never adds entries to the player registry or the online-player set.
 */
/** Stable hash for account deduplication; raw Reddit identities never enter analytics keys. */
async function hashUserIdentity(userId: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Secure impression deduplication is unavailable.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeRedditPostId(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return /^t3_/i.test(raw) ? raw : 't3_' + raw;
}

async function isRegisteredFrenzyPost(postId: string): Promise<boolean> {
  const rawId = String(postId ?? '').trim();
  const normalizedId = normalizeRedditPostId(rawId);
  if (!normalizedId) return false;
  const bareId = normalizedId.replace(/^t3_/i, '');
  for (const candidate of [...new Set([rawId, normalizedId, bareId].filter(Boolean))]) {
    if (await redis.get('io:frenzy:post:' + candidate) != null) return true;
  }
  return false;
}

function safeTimestamp(value: unknown): number {
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= 8_640_000_000_000_000
    ? timestamp
    : 0;
}

/** Atomically increments one global counter once for each marker. */
async function incrementCounterOnce(markerKey: string, counterKey: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_COUNTER_COMMIT_ATTEMPTS; attempt += 1) {
    const txn = await redis.watch(markerKey, counterKey);
    let closed = false;
    try {
      if (await redis.get(markerKey) != null) {
        await txn.unwatch();
        closed = true;
        return false;
      }
      const current = normalizeCount(await redis.get(counterKey));
      if (current >= Number.MAX_SAFE_INTEGER) throw new Error('Unique analytics counter exceeded the safe integer limit.');
      await txn.multi();
      await txn.set(markerKey, '1');
      await txn.set(counterKey, String(current + 1));
      const result = await txn.exec();
      closed = true;
      if (result !== null) return true;
    } finally {
      if (!closed) await txn.unwatch().catch(() => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(2 * (attempt + 1), 16)));
  }
  throw new Error('Unique analytics counter changed repeatedly; retry on a later event.');
}

/**
 * Records one unique account/post preview for 180 days. All per-account markers
 * contain a one-way hash, not the raw Reddit ID. This function never registers
 * online-player activity.
 */
function normalizeViewerUsername(value: unknown): string {
  const candidate = String(value ?? '').trim().replace(/^u\//i, '');
  return /^[A-Za-z0-9_-]{1,20}$/.test(candidate) ? candidate : 'Redditor';
}

function normalizeViewerRow(value: unknown): ImpressionViewerRow | null {
  try {
    const row = JSON.parse(String(value ?? 'null')) as Partial<ImpressionViewerRow> | null;
    if (!row || typeof row !== 'object') return null;
    const firstSeenAt = Number(row.firstSeenAt);
    const lastSeenAt = Number(row.lastSeenAt);
    if (!Number.isSafeInteger(firstSeenAt) || firstSeenAt < 0 ||
        !Number.isSafeInteger(lastSeenAt) || lastSeenAt < firstSeenAt) return null;
    const rawByType = row.byType && typeof row.byType === 'object' ? row.byType : {};
    return {
      username: normalizeViewerUsername(row.username),
      uniquePostViews: normalizeCount(row.uniquePostViews),
      byType: {
        'main-game': normalizeCount((rawByType as Record<string, unknown>)['main-game']),
        'orb-share': normalizeCount((rawByType as Record<string, unknown>)['orb-share']),
        frenzy: normalizeCount((rawByType as Record<string, unknown>).frenzy),
      },
      firstSeenAt,
      lastSeenAt,
    };
  } catch {
    return null;
  }
}

/** Increment a user's unique-post view tally after the canonical counters commit. */
async function recordViewerPostView(userHash: string, usernameValue: unknown, postType: ImpressionPostType, now: number): Promise<void> {
  const recordKey = VIEWER_RECORD_PREFIX + userHash;
  const username = normalizeViewerUsername(usernameValue);
  for (let attempt = 0; attempt < MAX_COUNTER_COMMIT_ATTEMPTS; attempt += 1) {
    const txn = await redis.watch(recordKey);
    let transactionClosed = false;
    try {
      const previous = normalizeViewerRow(await redis.get(recordKey));
      const currentCount = previous?.uniquePostViews ?? 0;
      const typeCount = previous?.byType[postType] ?? 0;
      if (currentCount >= Number.MAX_SAFE_INTEGER || typeCount >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Per-user impression counter exceeded the safe integer limit.');
      }
      const next: ImpressionViewerRow = {
        username,
        uniquePostViews: currentCount + 1,
        byType: {
          'main-game': previous?.byType['main-game'] ?? 0,
          'orb-share': previous?.byType['orb-share'] ?? 0,
          frenzy: previous?.byType.frenzy ?? 0,
        },
        firstSeenAt: previous?.firstSeenAt ?? now,
        lastSeenAt: Math.max(previous?.lastSeenAt ?? 0, now),
      };
      next.byType[postType] = typeCount + 1;
      await txn.multi();
      await txn.set(recordKey, JSON.stringify(next), { expiration: new Date(now + VIEWER_RECORD_RETENTION_MS) });
      const result = await txn.exec();
      transactionClosed = true;
      if (result !== null) {
        await redis.hSet(VIEWER_INDEX_KEY, { [userHash]: '1' });
        return;
      }
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(2 * (attempt + 1), 16)));
  }
  throw new Error('Per-user impression stats changed repeatedly; retry on a later event.');
}

/** Keep the admin viewer table bounded and discard index fields whose 180-day rows expired. */
async function pruneViewerIndex(now: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(VIEWER_INDEX_KEY);
    let transactionClosed = false;
    try {
      const index = await redis.hGetAll(VIEWER_INDEX_KEY);
      const userHashes = Object.keys(index ?? {});
      const viewerValues = await readInBatches(
        userHashes.map(userHash => VIEWER_RECORD_PREFIX + userHash),
        keys => redis.mGet(keys),
        64,
        4,
      );
      const rows = userHashes.map((userHash, index) => ({
        userHash,
        row: normalizeViewerRow(viewerValues[index]),
      }));
      const cutoff = now - VIEWER_RECORD_RETENTION_MS;
      const valid = rows
        .filter(entry => entry.row && entry.row.lastSeenAt >= cutoff)
        .sort((a, b) => (b.row?.lastSeenAt ?? 0) - (a.row?.lastSeenAt ?? 0));
      const keep = new Set(valid.slice(0, MAX_INDEXED_VIEWERS).map(entry => entry.userHash));
      const remove = rows.filter(entry => !keep.has(entry.userHash));
      if (remove.length === 0) {
        await txn.unwatch();
        transactionClosed = true;
        return;
      }
      await txn.multi();
      for (const entry of remove) await txn.hDel(VIEWER_INDEX_KEY, entry.userHash);
      const result = await txn.exec();
      transactionClosed = true;
      if (result !== null) return;
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
    }
  }
}

export async function recordPostImpression(
  postTypeValue: unknown,
  deviceTypeValue: unknown,
  postIdValue?: unknown,
): Promise<{ recorded: boolean }> {
  let postType = normalizePostType(postTypeValue);
  const deviceType = normalizeDeviceType(deviceTypeValue);
  // Prefer authenticated Devvit context. Some embedded preview requests omit postId;
  // fall back to the post ID included by our own preview bundle.
  const contextPostId = normalizeRedditPostId(String(context.postId ?? '').trim());
  const suppliedPostId = normalizeRedditPostId(postIdValue);
  const postId = contextPostId || suppliedPostId;
  const contextUserId = String(context.userId ?? '').trim();
  const username = String(context.username ?? '').trim().replace(/^u\//i, '').toLowerCase();
  if (isExcludedImpressionUsername(username)) return { recorded: false };
  const userId = contextUserId && contextUserId !== 'unknown' ? contextUserId : (username ? 'username:' + username : '');

  if (!postId || postId.length > 200 || /[\u0000-\u001f\u007f]/.test(postId) ||
      !userId || userId === 'unknown') {
    return { recorded: false };
  }

  if (await isRegisteredFrenzyPost(postId)) {
    postType = 'frenzy';
  } else {
    const registeredMainPost = normalizeRedditPostId(await redis.get(GLOBAL_GAME_POST_KEY));
    if (registeredMainPost && registeredMainPost === postId) postType = 'main-game';
  }

  const userHash = await hashUserIdentity(userId);
  let existingRegistry: unknown = null;
  try { existingRegistry = await redis.hGet(PLAYER_REGISTRY_KEY, userId); } catch {
    // Registry unavailability only disables acquisition attribution, not analytics.
  }
  const sourceType = SOURCE_TYPES.includes(postType as 'orb-share' | 'frenzy')
    ? postType as 'orb-share' | 'frenzy'
    : null;
  const firstTimeCandidate = existingRegistry == null && sourceType !== null;

  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / DAY_MS);
  const keyForPost = postKey(postType, postId);
  const indexField = postType + ':' + postId;
  const postCounterExpiration = new Date(now + 180 * 86_400_000);
  const hourBucketExpiration = new Date((hour + 25) * 3_600_000);
  const dayBucketExpiration = new Date((day + 31) * 86_400_000);
  const uniqueDayExpiration = new Date((day + Math.ceil(UNIQUE_DAY_RETENTION_MS / DAY_MS)) * DAY_MS);

  const uniquePostMarkerKey = UNIQUE_POST_MARKER_PREFIX + postType + ':' + encodeURIComponent(postId) + ':' + userHash;
  const uniqueUserMarkerKey = UNIQUE_USER_MARKER_PREFIX + userHash;
  const uniqueDayMarkerKey = UNIQUE_DAY_MARKER_PREFIX + day + ':' + userHash;
  const uniqueTypeMarkerKey = UNIQUE_TYPE_MARKER_PREFIX + postType + ':' + userHash;
  const uniqueTodayCountKey = UNIQUE_TODAY_COUNT_PREFIX + day;
  const uniqueTypeCountKey = UNIQUE_TYPE_COUNT_PREFIX + postType;
  const sourceTouchKey = SOURCE_TOUCH_PREFIX + userHash;
  const sourceEligibleMarkerKey = sourceType ? SOURCE_ELIGIBLE_MARKER_PREFIX + sourceType + ':' + userHash : null;
  const sourceEligibleCountKey = sourceType ? SOURCE_ELIGIBLE_COUNT_PREFIX + sourceType : null;

  const counterKeys = [
    TOTAL_KEY, TYPE_PREFIX + postType, DEVICE_PREFIX + deviceType,
    TYPE_DEVICE_PREFIX + postType + ':' + deviceType, keyForPost,
    HOUR_PREFIX + hour + ':' + postType, DAY_PREFIX + day + ':' + postType,
    INDEX_PRUNE_COUNTER_KEY, UNIQUE_USER_COUNT_KEY, uniqueTodayCountKey, uniqueTypeCountKey,
    ...(sourceEligibleCountKey ? [sourceEligibleCountKey] : []),
  ];
  const markerKeys = [
    uniquePostMarkerKey, uniqueUserMarkerKey, uniqueDayMarkerKey, uniqueTypeMarkerKey,
    ...(sourceEligibleMarkerKey ? [sourceEligibleMarkerKey] : []),
  ];
  const watchedKeys = [...new Set([...counterKeys, POST_INDEX_KEY, ...markerKeys])];
  const nextCounter = (raw: unknown): number => {
    const current = normalizeCount(raw);
    if (current >= Number.MAX_SAFE_INTEGER) throw new Error('Impression counter exceeded the safe integer limit.');
    return current + 1;
  };
  let pruneSequence = 0;
  let committed = false;

  for (let attempt = 0; attempt < MAX_COUNTER_COMMIT_ATTEMPTS; attempt += 1) {
    const txn = await redis.watch(...watchedKeys);
    let transactionClosed = false;
    try {
      const counterValues = new Map<string, unknown>();
      await Promise.all(counterKeys.map(async counterKey => {
        counterValues.set(counterKey, await redis.get(counterKey));
      }));
      const markerValues = new Map<string, unknown>();
      await Promise.all(markerKeys.map(async markerKey => {
        markerValues.set(markerKey, await redis.get(markerKey));
      }));

      if (markerValues.get(uniquePostMarkerKey) != null) {
        await txn.unwatch();
        transactionClosed = true;
        // Repeats refresh last-seen and attribution without increasing any view count.
        await redis.set(uniquePostMarkerKey, '1', { expiration: postCounterExpiration });
        await redis.hSet(POST_INDEX_KEY, {
          [indexField]: JSON.stringify({ postType, postId, lastSeenAt: now }),
        });
        if (firstTimeCandidate && sourceType) {
          await redis.set(sourceTouchKey, JSON.stringify({ postType: sourceType, viewedAt: now }), {
            expiration: new Date(now + ATTRIBUTION_WINDOW_MS),
          });
        }
        return { recorded: false };
      }

      const nextTotal = nextCounter(counterValues.get(TOTAL_KEY));
      const nextType = nextCounter(counterValues.get(TYPE_PREFIX + postType));
      const nextDevice = nextCounter(counterValues.get(DEVICE_PREFIX + deviceType));
      const nextTypeDevice = nextCounter(counterValues.get(TYPE_DEVICE_PREFIX + postType + ':' + deviceType));
      const nextPost = nextCounter(counterValues.get(keyForPost));
      const nextHour = nextCounter(counterValues.get(HOUR_PREFIX + hour + ':' + postType));
      const nextDay = nextCounter(counterValues.get(DAY_PREFIX + day + ':' + postType));
      const nextPruneSequence = nextCounter(counterValues.get(INDEX_PRUNE_COUNTER_KEY));
      const newUniqueUser = markerValues.get(uniqueUserMarkerKey) == null;
      const newUniqueDay = markerValues.get(uniqueDayMarkerKey) == null;
      const newUniqueType = markerValues.get(uniqueTypeMarkerKey) == null;
      const newSourceEligible = Boolean(sourceEligibleMarkerKey && sourceEligibleCountKey &&
        markerValues.get(sourceEligibleMarkerKey) == null);
      const nextUniqueUsers = newUniqueUser ? nextCounter(counterValues.get(UNIQUE_USER_COUNT_KEY)) : normalizeCount(counterValues.get(UNIQUE_USER_COUNT_KEY));
      const nextUniqueToday = newUniqueDay ? nextCounter(counterValues.get(uniqueTodayCountKey)) : normalizeCount(counterValues.get(uniqueTodayCountKey));
      const nextUniqueType = newUniqueType ? nextCounter(counterValues.get(uniqueTypeCountKey)) : normalizeCount(counterValues.get(uniqueTypeCountKey));
      const nextEligible = sourceEligibleCountKey
        ? (newSourceEligible ? nextCounter(counterValues.get(sourceEligibleCountKey)) : normalizeCount(counterValues.get(sourceEligibleCountKey)))
        : 0;

      await txn.multi();
      await txn.set(TOTAL_KEY, String(nextTotal));
      await txn.set(TYPE_PREFIX + postType, String(nextType));
      await txn.set(DEVICE_PREFIX + deviceType, String(nextDevice));
      await txn.set(TYPE_DEVICE_PREFIX + postType + ':' + deviceType, String(nextTypeDevice));
      await txn.set(keyForPost, String(nextPost), { expiration: postCounterExpiration });
      await txn.set(HOUR_PREFIX + hour + ':' + postType, String(nextHour), { expiration: hourBucketExpiration });
      await txn.set(DAY_PREFIX + day + ':' + postType, String(nextDay), { expiration: dayBucketExpiration });
      await txn.set(INDEX_PRUNE_COUNTER_KEY, String(nextPruneSequence));
      await txn.set(uniquePostMarkerKey, '1', { expiration: postCounterExpiration });
      if (newUniqueUser) {
        await txn.set(uniqueUserMarkerKey, '1');
        await txn.set(UNIQUE_USER_COUNT_KEY, String(nextUniqueUsers));
      }
      if (newUniqueDay) {
        await txn.set(uniqueDayMarkerKey, '1', { expiration: uniqueDayExpiration });
        await txn.set(uniqueTodayCountKey, String(nextUniqueToday), { expiration: uniqueDayExpiration });
      }
      if (newUniqueType) {
        await txn.set(uniqueTypeMarkerKey, '1');
        await txn.set(uniqueTypeCountKey, String(nextUniqueType));
      }
      if (sourceEligibleMarkerKey && sourceEligibleCountKey && newSourceEligible) {
        await txn.set(sourceEligibleMarkerKey, '1');
        await txn.set(sourceEligibleCountKey, String(nextEligible));
      }
      if (firstTimeCandidate && sourceType) {
        await txn.set(sourceTouchKey, JSON.stringify({ postType: sourceType, viewedAt: now }), {
          expiration: new Date(now + ATTRIBUTION_WINDOW_MS),
        });
      }
      await txn.hSet(POST_INDEX_KEY, {
        [indexField]: JSON.stringify({ postType, postId, lastSeenAt: now }),
      });
      const result = await txn.exec();
      transactionClosed = true;
      if (result !== null) {
        pruneSequence = nextPruneSequence;
        committed = true;
        break;
      }
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(2 * (attempt + 1), 16)));
  }

  if (!committed) throw new Error('Impression counters changed repeatedly. Please retry.');
  try {
    await recordViewerPostView(userHash, context.username, postType, now);
  } catch (error) {
    // Viewer details are an admin-only secondary projection. Never let it turn
    // an already-committed public-post impression into a retryable failure.
    console.error('[Impressions] Per-user viewer stats could not be updated.', error);
  }
  if (pruneSequence % INDEX_PRUNE_EVERY === 0) {
    try { await prunePostIndex(now); } catch (error) {
      console.error('[Impressions] Index pruning failed after impression commit.', error);
    }
    try { await pruneViewerIndex(now); } catch (error) {
      console.error('[Impressions] Viewer-index pruning failed after impression commit.', error);
    }
  }
  return { recorded: true };
}

/** Records an Orb Share/Frenzy -> first-play conversion after the first heartbeat. */
export async function recordPlayerActivityForImpressions(userIdValue: unknown): Promise<void> {
  if (isExcludedImpressionUsername(context.username)) return;
  const userId = String(userIdValue ?? '').trim();
  if (!userId || userId === 'unknown') return;
  const userHash = await hashUserIdentity(userId);
  const sourceTouchKey = SOURCE_TOUCH_PREFIX + userHash;
  const rawTouch = await redis.get(sourceTouchKey);
  if (rawTouch == null) return;

  let touch: { postType?: unknown; viewedAt?: unknown };
  try { touch = JSON.parse(String(rawTouch)) as { postType?: unknown; viewedAt?: unknown }; }
  catch { await redis.del(sourceTouchKey); return; }
  const sourceType = String(touch.postType ?? '');
  const viewedAt = safeTimestamp(touch.viewedAt);
  if (!SOURCE_TYPES.includes(sourceType as 'orb-share' | 'frenzy') || !viewedAt) {
    await redis.del(sourceTouchKey);
    return;
  }

  let rawRegistry: unknown = null;
  try { rawRegistry = await redis.hGet(PLAYER_REGISTRY_KEY, userId); } catch { return; }
  try {
    const entry = JSON.parse(String(rawRegistry ?? 'null')) as { firstSeenAt?: unknown } | null;
    const firstSeenAt = safeTimestamp(entry?.firstSeenAt);
    const now = Date.now();
    if (firstSeenAt >= viewedAt && firstSeenAt - viewedAt <= ATTRIBUTION_WINDOW_MS &&
        now - viewedAt <= ATTRIBUTION_WINDOW_MS) {
      await incrementCounterOnce(CONVERSION_MARKER_PREFIX + userHash, CONVERSION_COUNT_PREFIX + sourceType);
    }
  } finally {
    await redis.del(sourceTouchKey);
  }
}

/**
 * Counts one explicit Play-button conversion from the canonical main-game post.
 * The user is hashed, and each account/post combination counts once for this event.
 */
export async function recordMainGamePostConversion(
  postIdValue: unknown,
  deviceTypeValue: unknown,
): Promise<{ recorded: boolean }> {
  const deviceType = normalizeDeviceType(deviceTypeValue);
  const contextPostId = normalizeRedditPostId(String(context.postId ?? '').trim());
  const suppliedPostId = normalizeRedditPostId(postIdValue);
  if (!suppliedPostId || suppliedPostId.length > 200 || /[\u0000-\u001f\u007f]/.test(suppliedPostId)) {
    return { recorded: false };
  }
  if (contextPostId && contextPostId !== suppliedPostId) return { recorded: false };
  const postId = contextPostId || suppliedPostId;
  const userId = String(context.userId ?? '').trim();
  const username = String(context.username ?? '').trim().replace(/^u\//i, '');
  if (isExcludedImpressionUsername(username)) return { recorded: false };
  const identity = userId && userId !== 'unknown'
    ? userId
    : username ? 'username:' + username.toLowerCase() : '';
  if (!identity || identity === 'unknown') return { recorded: false };

  // Do not misattribute an Orb Share or Frenzy button click to the main-game
  // acquisition funnel. Also reject an old main-post context if the canonical
  // destination has since been replaced.
  if (await isRegisteredFrenzyPost(postId)) return { recorded: false };
  const bareId = postId.replace(/^t3_/i, '');
  for (const candidate of [...new Set([postId, bareId])]) {
    if (await redis.get('io:shared-orb:post:' + candidate) != null) return { recorded: false };
  }
  const registeredMainPost = normalizeRedditPostId(await redis.get(GLOBAL_GAME_POST_KEY));
  if (registeredMainPost && registeredMainPost !== postId) return { recorded: false };

  const userHash = await hashUserIdentity(identity);
  const markerKey = CONVERSION_MARKER_PREFIX + MAIN_GAME_POST_CONVERSION_ID + ':' + encodeURIComponent(postId) + ':' + userHash;
  const countKey = CONVERSION_COUNT_PREFIX + MAIN_GAME_POST_CONVERSION_ID;
  const deviceCountKey = CONVERSION_DEVICE_COUNT_PREFIX + MAIN_GAME_POST_CONVERSION_ID + ':' + deviceType;

  for (let attempt = 0; attempt < MAX_COUNTER_COMMIT_ATTEMPTS; attempt += 1) {
    const txn = await redis.watch(markerKey, countKey, deviceCountKey);
    let transactionClosed = false;
    try {
      if (await redis.get(markerKey) != null) {
        await txn.unwatch();
        transactionClosed = true;
        return { recorded: false };
      }
      const [rawCount, rawDeviceCount] = await Promise.all([
        redis.get(countKey),
        redis.get(deviceCountKey),
      ]);
      const count = normalizeCount(rawCount);
      const deviceCount = normalizeCount(rawDeviceCount);
      if (count >= Number.MAX_SAFE_INTEGER || deviceCount >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Main-game conversion counter exceeded the safe integer limit.');
      }
      await txn.multi();
      await txn.set(markerKey, '1');
      await txn.set(countKey, String(count + 1));
      await txn.set(deviceCountKey, String(deviceCount + 1));
      const result = await txn.exec();
      transactionClosed = true;
      if (result !== null) return { recorded: true };
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(2 * (attempt + 1), 16)));
  }
  throw new Error('Main-game conversion changed repeatedly. Please retry.');
}

export interface ImpressionPostRow {
  postType: ImpressionPostType;
  postId: string;
  impressions: number;
}

/** Public Reddit username plus unique post previews, indexed by a one-way user hash. */
export interface ImpressionViewerRow {
  username: string;
  uniquePostViews: number;
  byType: Record<ImpressionPostType, number>;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface ImpressionTimePoint {
  bucket: string;
  total: number;
  byType: Record<ImpressionPostType, number>;
}

export interface ImpressionRetentionMetric {
  cohortDay: string;
  cohortSize: number;
  retained: number;
  rate: number | null;
}
export interface ImpressionConversionMetric {
  eligibleViewers: number;
  conversions: number;
  rate: number | null;
}
export interface ImpressionDashboard {
  generatedAt: number;
  total: number;
  uniqueUsers: number;
  uniqueToday: number;
  uniqueByType: Record<ImpressionPostType, number>;
  newPlayersToday: number;
  day1Retention: ImpressionRetentionMetric;
  day3Retention: ImpressionRetentionMetric;
  conversion: Record<'main-game' | 'orb-share' | 'frenzy', ImpressionConversionMetric>;
  conversionByDevice: Record<ImpressionDeviceType, ImpressionConversionMetric>;
  /** Highest unique post-view counts; Reddit usernames are shown only in the admin dashboard. */
  viewers: ImpressionViewerRow[];
  trackedPostCount: number;
  byType: Record<ImpressionPostType, number>;
  byDevice: Record<ImpressionDeviceType, number>;
  byTypeAndDevice: Record<ImpressionPostType, Record<ImpressionDeviceType, number>>;
  posts: ImpressionPostRow[];
  last24Hours: ImpressionTimePoint[];
  last30Days: ImpressionTimePoint[];
}

/** Reads aggregate impression metrics for the admin-only dashboard. */
export async function getImpressionDashboard(now = Date.now()): Promise<ImpressionDashboard> {
  const requestedNow = Number(now);
  // Date#toISOString throws outside the ECMAScript time-value range, even for
  // finite numbers. Clamp invalid requests to the current server clock.
  const dashboardNow = Number.isFinite(requestedNow) &&
    requestedNow >= 0 &&
    requestedNow <= 8_640_000_000_000_000
    ? Math.floor(requestedNow)
    : Date.now();
  const currentDay = Math.floor(dashboardNow / DAY_MS);
  const [total, postIndex, uniqueUsers, uniqueToday, playerRegistry, viewerIndex] = await Promise.all([
    readCount(TOTAL_KEY),
    redis.hGetAll(POST_INDEX_KEY),
    readCount(UNIQUE_USER_COUNT_KEY),
    readCount(UNIQUE_TODAY_COUNT_PREFIX + currentDay),
    redis.hGetAll(PLAYER_REGISTRY_KEY),
    redis.hGetAll(VIEWER_INDEX_KEY),
  ]);

  const uniqueByType = Object.fromEntries(await Promise.all(
    POST_TYPES.map(async type => [type, await readCount(UNIQUE_TYPE_COUNT_PREFIX + type)] as const),
  )) as Record<ImpressionPostType, number>;
  const sourceConversionEntries = await Promise.all(SOURCE_TYPES.map(async type => {
    const [eligibleViewers, conversions] = await Promise.all([
      readCount(SOURCE_ELIGIBLE_COUNT_PREFIX + type),
      readCount(CONVERSION_COUNT_PREFIX + type),
    ]);
    return [type, {
      eligibleViewers,
      conversions,
      rate: eligibleViewers > 0 ? Math.min(1, conversions / eligibleViewers) : null,
    }] as const;
  }));
  const [mainGameConversions, mainGameEligibleViews] = await Promise.all([
    readCount(CONVERSION_COUNT_PREFIX + MAIN_GAME_POST_CONVERSION_ID),
    readCount(TYPE_PREFIX + 'main-game'),
  ]);
  const conversion = {
    'main-game': {
      eligibleViewers: mainGameEligibleViews,
      conversions: mainGameConversions,
      rate: mainGameEligibleViews > 0
        ? Math.min(1, mainGameConversions / mainGameEligibleViews)
        : null,
    },
    ...Object.fromEntries(sourceConversionEntries),
  } as Record<'main-game' | 'orb-share' | 'frenzy', ImpressionConversionMetric>;

  let newPlayersToday = 0;
  let day1CohortSize = 0;
  let day1Retained = 0;
  let day3CohortSize = 0;
  let day3Retained = 0;
  const registryEntries = playerRegistry && typeof playerRegistry === 'object' ? Object.values(playerRegistry) : [];
  for (const raw of registryEntries) {
    try {
      const entry = JSON.parse(String(raw)) as { username?: unknown; firstSeenAt?: unknown; lastSeenAt?: unknown };
      if (isExcludedImpressionUsername(entry.username)) continue;
      const firstSeenAt = safeTimestamp(entry.firstSeenAt);
      const lastSeenAt = safeTimestamp(entry.lastSeenAt);
      if (!firstSeenAt || !lastSeenAt) continue;
      const firstDay = Math.floor(firstSeenAt / DAY_MS);
      const lastDay = Math.floor(lastSeenAt / DAY_MS);
      if (firstDay === currentDay) newPlayersToday += 1;
      if (firstDay === currentDay - 1) {
        day1CohortSize += 1;
        if (lastDay === currentDay) day1Retained += 1;
      }
      if (firstDay === currentDay - 3) {
        day3CohortSize += 1;
        if (lastDay === currentDay) day3Retained += 1;
      }
    } catch {
      // Skip corrupt registry entries instead of inventing retention.
    }
  }
  const makeRetention = (cohortDayIndex: number, cohortSize: number, retained: number): ImpressionRetentionMetric => ({
    cohortDay: new Date(cohortDayIndex * DAY_MS).toISOString().slice(0, 10),
    cohortSize,
    retained,
    rate: cohortSize > 0 ? retained / cohortSize : null,
  });
  const day1Retention = makeRetention(currentDay - 1, day1CohortSize, day1Retained);
  const day3Retention = makeRetention(currentDay - 3, day3CohortSize, day3Retained);

  const byType = Object.fromEntries(await Promise.all(
    POST_TYPES.map(async type => [type, await readCount(TYPE_PREFIX + type)] as const),
  )) as Record<ImpressionPostType, number>;

  const byDevice = Object.fromEntries(await Promise.all(
    DEVICE_TYPES.map(async device => [device, await readCount(DEVICE_PREFIX + device)] as const),
  )) as Record<ImpressionDeviceType, number>;

  const typeDeviceEntries = await Promise.all(POST_TYPES.map(async type => {
    const values = await Promise.all(DEVICE_TYPES.map(async device => [
      device,
      await readCount(TYPE_DEVICE_PREFIX + type + ':' + device),
    ] as const));
    return [type, Object.fromEntries(values)] as const;
  }));
  const byTypeAndDevice = Object.fromEntries(typeDeviceEntries) as Record<
    ImpressionPostType,
    Record<ImpressionDeviceType, number>
  >;
  const conversionByDeviceEntries = await Promise.all(DEVICE_TYPES.map(async device => {
    const [eligibleViewers, conversions] = await Promise.all([
      Promise.resolve(byTypeAndDevice['main-game'][device]),
      readCount(CONVERSION_DEVICE_COUNT_PREFIX + MAIN_GAME_POST_CONVERSION_ID + ':' + device),
    ]);
    return [device, {
      eligibleViewers,
      conversions,
      rate: eligibleViewers > 0 ? Math.min(1, conversions / eligibleViewers) : null,
    }] as const;
  }));
  const conversionByDevice = Object.fromEntries(conversionByDeviceEntries) as
    Record<ImpressionDeviceType, ImpressionConversionMetric>;

  // Keep dashboard reads bounded and consistent with the per-post counter TTL.
  // Stale/corrupt rows are excluded immediately and lazily deleted even during
  // quiet periods when no new impression arrives to trigger the periodic sweep.
  const postIndexRetentionCutoff = dashboardNow - 180 * 86_400_000;
  const staleIndexFields: string[] = [];
  const validIndexedPosts = Object.entries(postIndex ?? {}).flatMap(([field, raw]) => {
    try {
      const parsed = JSON.parse(String(raw)) as { postType?: unknown; postId?: unknown; lastSeenAt?: unknown };
      const postType = normalizePostType(parsed.postType);
      const postId = String(parsed.postId ?? '').trim();
      const lastSeenAt = Number(parsed.lastSeenAt ?? 0);
      if (!postId || postId.length > 200 || !Number.isSafeInteger(lastSeenAt) ||
          lastSeenAt < 0 || lastSeenAt < postIndexRetentionCutoff) {
        staleIndexFields.push(field);
        return [];
      }
      return [{ postType, postId, lastSeenAt }];
    } catch {
      staleIndexFields.push(field);
      return [];
    }
  }).sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  // The displayed snapshot filters these rows immediately. Clean the underlying
  // hash through WATCH/MULTI/EXEC so a concurrent fresh impression cannot be lost.
  if (staleIndexFields.length > 0 || validIndexedPosts.length > MAX_INDEXED_POSTS) {
    try {
      await prunePostIndex(dashboardNow);
    } catch (error) {
      console.error('[Impressions] Dashboard index cleanup failed.', error);
    }
  }
  const trackedPostCount = validIndexedPosts.length;
  const indexedPosts = validIndexedPosts.slice(0, 500);

  const rows = await Promise.all(indexedPosts.map(async ({ postType, postId }) => ({
    postType,
    postId,
    impressions: await readCount(postKey(postType, postId)),
  } satisfies ImpressionPostRow)));
  const posts = rows
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 200);

  const readTimePoint = async (bucketNumber: number, prefix: string, label: string): Promise<ImpressionTimePoint> => {
    const pairs = await Promise.all(POST_TYPES.map(async type => [
      type,
      await readCount(prefix + bucketNumber + ':' + type),
    ] as const));
    const values = Object.fromEntries(pairs) as Record<ImpressionPostType, number>;
    return {
      bucket: label,
      total: POST_TYPES.reduce((sum, type) => sum + values[type], 0),
      byType: values,
    };
  };

  const last24Hours = await Promise.all(Array.from({ length: 24 }, (_, index) => {
    const bucket = Math.floor(dashboardNow / 3_600_000) - (23 - index);
    return readTimePoint(bucket, HOUR_PREFIX, new Date(bucket * 3_600_000).toISOString());
  }));

  const last30Days = await Promise.all(Array.from({ length: 30 }, (_, index) => {
    const bucket = Math.floor(dashboardNow / 86_400_000) - (29 - index);
    return readTimePoint(bucket, DAY_PREFIX, new Date(bucket * 86_400_000).toISOString().slice(0, 10));
  }));

  const viewerHashes = Object.keys(viewerIndex ?? {}).slice(0, MAX_INDEXED_VIEWERS);
  const viewerValues = await redis.mGet(viewerHashes.map(userHash => VIEWER_RECORD_PREFIX + userHash));
  const viewerRows = viewerHashes.map((userHash, index) => ({
    userHash,
    row: normalizeViewerRow(viewerValues[index]),
  }));
  const viewers = viewerRows
    .map(entry => entry.row)
    .filter((row): row is ImpressionViewerRow => Boolean(row) &&
      !isExcludedImpressionUsername(row!.username) &&
      row!.lastSeenAt >= dashboardNow - VIEWER_RECORD_RETENTION_MS)
    .sort((a, b) => b.uniquePostViews - a.uniquePostViews || b.lastSeenAt - a.lastSeenAt)
    .slice(0, 100);

  return {
    generatedAt: dashboardNow,
    total,
    uniqueUsers,
    uniqueToday,
    uniqueByType,
    newPlayersToday,
    day1Retention,
    day3Retention,
    conversion,
    conversionByDevice,
    viewers,
    trackedPostCount,
    byType,
    byDevice,
    byTypeAndDevice,
    posts,
    last24Hours,
    last30Days,
  };
}

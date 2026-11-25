import { redis } from './devvit-mock.js';
import { readInBatches } from './redis-batches.js';
import { CODEX_SHARD_COUNT, CODEX_STORAGE_VERSION, codexShardKey, legacyCodexShardKey } from '../shared/collection-storage.js';
import { decompressStorageString } from './storage-compression.js';

type StorageGroup = { label: string; bytes: number; keys: number; records: number };
type PlayerManifest = { token: string; chunkCount: number; length: number };
type LargeManifest = { namespaceHash: string; token: string; chunkCount: number; length: number };

const encoder = new TextEncoder();
const byteLength = (value: string): number => encoder.encode(value).length;
const PLAYER_CHUNK_PREFIX = 'io:player-save-chunk:';
const LARGE_CHUNK_PREFIX = 'io:large-value-chunk:v1:';
const ANALYTICS_PREFIX = 'io:impressions:unique-v2:';
const LEGACY_IMPRESSIONS_PREFIX = 'io:impressions:';
const LEGACY_IMPRESSION_TIME_BUCKET_DAYS = 30;
const MAX_AUDIT_USERS = 2_000;
const MAX_CODEX_AUDIT_USERS = 100;
const MAX_INDEXED_VIEWERS = 2_000;
const IMPRESSION_POST_TYPES = ['main-game', 'orb-share', 'frenzy'] as const;
const IMPRESSION_SOURCE_TYPES = ['orb-share', 'frenzy'] as const;
const ADMIN_CREDIT_BATCH_PREFIX = 'io:admin-global-booster-credit-batch:';
const ADMIN_CREDIT_RECEIPT_PREFIX = 'io:admin-global-booster-credit-grant:';
const MAX_ADMIN_CREDIT_OPERATIONS_AUDITED = 25;
const MAX_PLAYER_CHUNK_PAYLOAD_READ_BYTES = 32 * 1024 * 1024;
const MAX_TOP_VALUES = 25;

function valueBytes(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return byteLength(value);
  try { return byteLength(JSON.stringify(value) ?? String(value)); }
  catch { return byteLength(String(value)); }
}

function auditCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function parsePlayerManifest(value: unknown): PlayerManifest | null {
  if (typeof value !== 'string' || !value.startsWith('{"__ioPlayerSaveManifest":1')) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const token = String(parsed.token ?? '');
    const chunkCount = Number(parsed.chunkCount);
    const length = Number(parsed.length);
    if (!/^[a-zA-Z0-9-]{8,120}$/.test(token) ||
        !Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 128 ||
        !Number.isSafeInteger(length) || length < 1 || length > 8 * 1024 * 1024) return null;
    return { token, chunkCount, length };
  } catch { return null; }
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseLargeManifest(namespaceKey: string, value: unknown): LargeManifest | null {
  if (typeof value !== 'string' || !value.startsWith('{"__ioLargeValueManifest":1')) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const namespaceHash = String(parsed.namespaceHash ?? '');
    const token = String(parsed.token ?? '');
    const chunkCount = Number(parsed.chunkCount);
    const length = Number(parsed.length);
    if (namespaceHash !== hashText(namespaceKey) ||
        !/^[a-zA-Z0-9-]{8,120}$/.test(token) ||
        !Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 128 ||
        !Number.isSafeInteger(length) || length <= 192 * 1024 || length > 8 * 1024 * 1024) return null;
    return { namespaceHash, token, chunkCount, length };
  } catch { return null; }
}

function playerChunkKey(userId: string, token: string, index: number): string {
  return PLAYER_CHUNK_PREFIX + userId + ':' + token + ':' + index;
}

function largeChunkKey(manifest: LargeManifest, index: number): string {
  return LARGE_CHUNK_PREFIX + manifest.namespaceHash + ':' + manifest.token + ':' + String(index).padStart(3, '0');
}

export async function auditKnownRedisStorage(redisClient: any = redis) {
  const groups = new Map<string, StorageGroup>();
  const largest: Array<{ family: string; bytes: number; keyBytes: number; valueBytes: number }> = [];
  const errors: string[] = [];
  const now = Date.now();
  let missingPlayerChunks = 0;
  let playerChunkPayloadBytesEstimated = 0;
  let playerChunkPayloadBytesRead = 0;
  let playerChunkKeysSkipped = 0;
  let missingLargeValueChunks = 0;
  let playerManifestCount = 0;
  let codexUsersAudited = 0;
  let codexUsersEligible = 0;
  let codexUsersSkipped = 0;
  let codexKeysPresent = 0;
  let analyticsPostIndexFields = 0;
  let analyticsViewerIndexFields = 0;
  let legacyImpressionPostIndexFields = 0;
  let legacyImpressionPostCountersPresent = 0;
  let legacyImpressionTimeBucketKeysPresent = 0;
  let legacyLeaderboardPlayerIds = 0;
  let legacyLeaderboardIdsMissingRegistry = 0;
  let indexedPostMetadataKeysPresent = 0;
  let impressionViewerRecordsParsed = 0;
  let impressionViewerRecordsMissing = 0;
  let impressionViewerRecordsInvalid = 0;
  let impressionViewerCountMismatches = 0;
  let impressionMarkerKeysAudited = 0;
  let impressionMarkerKeysPresent = 0;
  let adminCreditOperationsFound = 0;
  let adminCreditOperationsAudited = 0;
  let adminCreditOperationsSkipped = 0;
  let adminCreditGrantReceiptsPresent = 0;
  let impressionViewerUniquePostViews = 0;
  const impressionViewerMarkerProbes: Array<{ family: string; key: string }> = [];
  const impressionViewerUniquePostViewsByType: Record<(typeof IMPRESSION_POST_TYPES)[number], number> = {
    'main-game': 0,
    'orb-share': 0,
    frenzy: 0,
  };
  let impressionSeenUserMarkerEstimatedCount = 0;
  let impressionSeenTypeMarkerEstimatedCount = 0;
  let impressionSeenTypeMarkerEstimatedBytes = 0;
  let impressionSeenPostMarkerEstimatedCount = 0;
  let impressionSeenPostMarkerEstimatedBytes = 0;
  let impressionViewerMarkerEstimatedBytes = 0;

  const add = (family: string, key: string, value: unknown): void => {
    if (value == null) return;
    const group = groups.get(family) ?? { label: family, bytes: 0, keys: 0, records: 0 };
    const keyBytes = byteLength(key);
    const bytes = keyBytes + valueBytes(value);
    group.bytes += bytes;
    group.keys += 1;
    group.records += 1;
    groups.set(family, group);
    largest.push({ family, bytes, keyBytes, valueBytes: bytes - keyBytes });
    if (largest.length > MAX_TOP_VALUES * 3) {
      largest.sort((a, b) => b.bytes - a.bytes);
      largest.length = MAX_TOP_VALUES;
    }
  };

  const addHash = (family: string, key: string, value: unknown): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return;
    const group = groups.get(family) ?? { label: family, bytes: 0, keys: 0, records: 0 };
    let bytes = byteLength(key);
    for (const [field, fieldValue] of entries) bytes += byteLength(field) + valueBytes(fieldValue);
    group.bytes += bytes;
    group.keys += 1;
    group.records += entries.length;
    groups.set(family, group);
    largest.push({ family, bytes, keyBytes: byteLength(key), valueBytes: bytes - byteLength(key) });
    if (largest.length > MAX_TOP_VALUES * 3) {
      largest.sort((a, b) => b.bytes - a.bytes);
      largest.length = MAX_TOP_VALUES;
    }
  };

  const safeMGet = async (keys: string[]): Promise<unknown[]> => {
    if (!keys.length) return [];
    return readInBatches(keys, batch => redisClient.mGet(batch), 12, 3);
  };
  const safeMGetWide = async (keys: string[]): Promise<unknown[]> => {
    if (!keys.length) return [];
    return readInBatches(keys, batch => redisClient.mGet(batch), 64, 4);
  };

  const registryKey = 'io:player-registry';
  let registry: Record<string, unknown> = {};
  try {
    const raw = await redisClient.hGetAll(registryKey);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) registry = raw as Record<string, unknown>;
    addHash('Player registry', registryKey, registry);
  } catch (error) {
    errors.push('Player registry read failed: ' + String(error));
  }

  const allUserIds = Object.keys(registry);
  let legacyLeaderboardRaw: unknown = null;
  const legacyLeaderboardIds: string[] = [];
  try {
    legacyLeaderboardRaw = await redisClient.get('io:leaderboard');
    if (typeof legacyLeaderboardRaw === 'string' && !legacyLeaderboardRaw.startsWith('{"__ioLargeValueManifest":1')) {
      const legacyEntries = JSON.parse(legacyLeaderboardRaw) as unknown;
      if (Array.isArray(legacyEntries)) {
        for (const entry of legacyEntries) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
          const userId = String((entry as Record<string, unknown>).userId ?? '').trim();
          if (userId && !legacyLeaderboardIds.includes(userId)) legacyLeaderboardIds.push(userId);
        }
      }
    }
  } catch (error) {
    errors.push('Legacy leaderboard index read/parse failed: ' + String(error));
  }
  legacyLeaderboardPlayerIds = legacyLeaderboardIds.length;
  legacyLeaderboardIdsMissingRegistry = legacyLeaderboardIds.filter(userId =>
    !Object.prototype.hasOwnProperty.call(registry, userId),
  ).length;
  const allIndexedUserIds = Array.from(new Set([...allUserIds, ...legacyLeaderboardIds]));
  const userIds = allIndexedUserIds.slice(0, MAX_AUDIT_USERS);
  const truncatedUsers = Math.max(0, allIndexedUserIds.length - userIds.length);
  const playerKeys = userIds.map(id => 'player:' + id);
  const combatKeys = userIds.map(id => 'infinity-orbs:combat:' + id);
  const generationKeys = userIds.map(id => 'player-generation:' + id);

  let playerValues: unknown[] = [];
  let combatValues: unknown[] = [];
  let generationValues: unknown[] = [];
  try {
    [playerValues, combatValues, generationValues] = await Promise.all([
      safeMGet(playerKeys),
      safeMGet(combatKeys),
      safeMGet(generationKeys),
    ]);
  } catch (error) {
    errors.push('Indexed player/combat save read failed: ' + String(error));
  }

  const playerStates = new Map<string, { saveGeneration: number; collectionStorageVersion: number; raw: string }>();
  const chunkPlans: Array<{ userId: string; keys: string[]; length: number }> = [];
  for (let index = 0; index < userIds.length; index += 1) {
    const userId = userIds[index];
    const raw = playerValues[index];
    if (typeof raw === 'string') {
      add('Player saves', playerKeys[index], raw);
      const manifest = parsePlayerManifest(raw);
      if (manifest) {
        playerManifestCount += 1;
        chunkPlans.push({
          userId,
          keys: Array.from({ length: manifest.chunkCount }, (_, chunk) => playerChunkKey(userId, manifest.token, chunk)),
          length: manifest.length,
        });
      } else {
        try {
          const parsed = JSON.parse(decompressStorageString(raw)) as Record<string, unknown>;
          playerStates.set(userId, {
            saveGeneration: Math.max(0, Math.floor(Number(parsed.saveGeneration) || 0)),
            collectionStorageVersion: Math.floor(Number(parsed.collectionStorageVersion) || 0),
            raw,
          });
        } catch { /* Report the raw save size even if a legacy save is malformed. */ }
      }
    }
    if (typeof combatValues[index] === 'string') add('Combat saves', combatKeys[index], combatValues[index]);
    if (generationValues[index] != null) add('Player generation markers', generationKeys[index], generationValues[index]);
  }

  const chunkReadPlans: typeof chunkPlans = [];
  let remainingChunkReadBytes = MAX_PLAYER_CHUNK_PAYLOAD_READ_BYTES;
  for (const plan of chunkPlans) {
    playerChunkPayloadBytesEstimated += plan.length;
    if (plan.length <= remainingChunkReadBytes) {
      chunkReadPlans.push(plan);
      remainingChunkReadBytes -= plan.length;
    } else {
      playerChunkKeysSkipped += plan.keys.length;
      const estimated = groups.get('Player save chunks (manifest estimate)') ?? {
        label: 'Player save chunks (manifest estimate)', bytes: 0, keys: 0, records: 0,
      };
      estimated.bytes += plan.length + plan.keys.reduce((total, key) => total + byteLength(key), 0);
      estimated.keys += plan.keys.length;
      estimated.records += plan.keys.length;
      groups.set(estimated.label, estimated);
    }
  }
  const flatPlayerChunkKeys = chunkReadPlans.flatMap(plan => plan.keys);
  if (flatPlayerChunkKeys.length) {
    try {
      const chunkValues = await safeMGet(flatPlayerChunkKeys);
      let offset = 0;
      for (const plan of chunkReadPlans) {
        const chunks = chunkValues.slice(offset, offset + plan.keys.length);
        offset += plan.keys.length;
        let joined = '';
        for (let i = 0; i < plan.keys.length; i += 1) {
          const value = chunks[i];
          if (typeof value !== 'string') {
            missingPlayerChunks += 1;
            continue;
          }
          add('Player save chunks', plan.keys[i], value);
          playerChunkPayloadBytesRead += valueBytes(value);
          joined += value;
        }
        if (chunks.every(value => typeof value === 'string')) {
          try {
            const parsed = JSON.parse(decompressStorageString(joined)) as Record<string, unknown>;
            playerStates.set(plan.userId, {
              saveGeneration: Math.max(0, Math.floor(Number(parsed.saveGeneration) || 0)),
              collectionStorageVersion: Math.floor(Number(parsed.collectionStorageVersion) || 0),
              raw: joined,
            });
          } catch {
            errors.push('A chunked player save could not be parsed for one indexed account.');
          }
        }
      }
    } catch (error) {
      errors.push('Player-save chunk payload read failed: ' + String(error));
    }
  }

  // Codex hashes are generation-scoped. Audit the active generation only;
  // obsolete generations cannot be discovered without a provider key scan.
  const codexEligibleUserIds = userIds.filter(userId => {
    const state = playerStates.get(userId);
    return Boolean(state && state.collectionStorageVersion >= 1);
  });
  codexUsersEligible = codexEligibleUserIds.length;
  const codexAuditUserIds = codexEligibleUserIds.slice(0, MAX_CODEX_AUDIT_USERS);
  codexUsersAudited = codexAuditUserIds.length;
  codexUsersSkipped = Math.max(0, codexUsersEligible - codexUsersAudited);
  const codexRequests = codexAuditUserIds.flatMap(userId => {
    const state = playerStates.get(userId);
    if (!state) return [];
    return Array.from({ length: CODEX_SHARD_COUNT }, (_, shard) => ({
      userId,
      shard,
      key: state.collectionStorageVersion >= CODEX_STORAGE_VERSION
        ? codexShardKey(userId, state.saveGeneration, shard)
        : legacyCodexShardKey(userId, state.saveGeneration, shard),
      label: state.collectionStorageVersion >= CODEX_STORAGE_VERSION ? 'Active Codex shards' : 'Legacy Codex shards',
    }));
  });
  try {
    const codexHashes = await readInBatches(
      codexRequests.map(item => item.key),
      async batch => Promise.all(batch.map(key => redisClient.hGetAll(key))),
      8,
      4,
    );
    for (let index = 0; index < codexRequests.length; index += 1) {
      const value = codexHashes[index];
      if (value && typeof value === 'object' && Object.keys(value).length) {
        codexKeysPresent += 1;
        addHash(codexRequests[index].label, codexRequests[index].key, value);
      }
    }
  } catch (error) {
    errors.push('Active Codex shard audit failed: ' + String(error));
  }

  const sharedStringKeys = [
    'io:leaderboard', 'io:guilds', 'io:community_event', 'io:community_event_tick',
    'io:global-chat:v1', 'io:global-game-post-id',
    'io:game-bans', 'io:ccu:all-time', 'io:follow-prompt-actions:v2', 'io:popup-config:v1',
    'io:developer-announcement', 'io:global-booster-announcement',
    'io:global-boosters:v4', 'io:daily-streak-community',
    'io:leaderboards:cache:v1', 'io:guild-token-reset:v1', 'io:guild-upgrade-reset:v1',
    'io:celestial-alignment:choice-stats:v1',
  ];
  try {
    const sharedValues = await safeMGet(sharedStringKeys);
    for (let i = 0; i < sharedStringKeys.length; i += 1) {
      const key = sharedStringKeys[i];
      const value = sharedValues[i];
      if (typeof value !== 'string') continue;
      add(key === 'io:guilds' ? 'Guild data' : key === 'io:leaderboard' || key === 'io:leaderboards:cache:v1' ? 'Leaderboards' : 'Shared game state', key, value);
      const manifest = parseLargeManifest(key, value);
      if (manifest) {
        const keys = Array.from({ length: manifest.chunkCount }, (_, chunk) => largeChunkKey(manifest, chunk));
        try {
          const chunks = await safeMGet(keys);
          for (let chunk = 0; chunk < keys.length; chunk += 1) {
            if (typeof chunks[chunk] !== 'string') missingLargeValueChunks += 1;
            else add(key === 'io:guilds' ? 'Guild data chunks' : 'Leaderboard chunks', keys[chunk], chunks[chunk]);
          }
        } catch (error) {
          errors.push('Large-value chunk read failed for ' + key + ': ' + String(error));
        }
      }
    }
  } catch (error) {
    errors.push('Shared string-key audit failed: ' + String(error));
  }

  const currentOnlinePlayers = Number(await redisClient.zCard('io:online:players').catch((error: unknown) => {
    errors.push('Online-player sorted-set count failed: ' + String(error));
    return 0;
  })) || 0;

  const hourlyCcuKeys = Array.from({ length: 720 }, (_, index) =>
    'io:ccu:hour:' + String(Math.floor(now / 3_600_000) - index),
  );
  try {
    const hourlyCcuValues = await safeMGet(hourlyCcuKeys);
    for (let i = 0; i < hourlyCcuKeys.length; i += 1) add('CCU history', hourlyCcuKeys[i], hourlyCcuValues[i]);
  } catch (error) {
    errors.push('Hourly CCU history read failed: ' + String(error));
  }

  const hashKeys = [
    ['Guild chat mutes', 'io:guild-chat-mutes:v1'],
    ['Chat reports', 'io:chat-reports:v1'],
    ['Arena profiles', 'infinity-orbs:combat:arena:profiles'],
    ['Impression post index', ANALYTICS_PREFIX + 'post-index'],
    ['Impression viewer index', ANALYTICS_PREFIX + 'viewer-index'],
    ['Legacy impression post index', LEGACY_IMPRESSIONS_PREFIX + 'post-index'],
  ] as const;
  const hashes = await Promise.all(hashKeys.map(async ([family, key]) => {
    try { return { family, key, value: await redisClient.hGetAll(key) }; }
    catch (error) { errors.push(family + ' read failed: ' + String(error)); return { family, key, value: {} }; }
  }));
  const analyticsPostIndex: Array<{ postType: string; postId: string }> = [];
  const legacyImpressionPosts: Array<{ postType: string; postId: string }> = [];
  const analyticsViewerHashes: string[] = [];
  for (const item of hashes) {
    addHash(item.family, item.key, item.value);
    if (item.family === 'Impression post index') {
      for (const raw of Object.values(item.value ?? {})) {
        try {
          const parsed = JSON.parse(String(raw)) as { postType?: unknown; postId?: unknown };
          const postType = String(parsed.postType ?? '');
          const postId = String(parsed.postId ?? '').trim();
          if (['main-game', 'orb-share', 'frenzy'].includes(postType) && postId) analyticsPostIndex.push({ postType, postId });
        } catch { /* malformed index values are counted in the hash payload */ }
      }
    }
    if (item.family === 'Impression viewer index') {
      analyticsViewerHashes.push(...Object.keys(item.value ?? {}).filter(hash => /^[a-f0-9]{64}$/.test(hash)));
    }
    if (item.family === 'Legacy impression post index') {
      for (const raw of Object.values(item.value ?? {})) {
        try {
          const parsed = JSON.parse(String(raw)) as { postType?: unknown; postId?: unknown };
          const postType = String(parsed.postType ?? '');
          const postId = String(parsed.postId ?? '').trim();
          if (['main-game', 'orb-share', 'frenzy'].includes(postType) && postId) {
            legacyImpressionPosts.push({ postType, postId });
          }
        } catch { /* malformed legacy index values are already counted in the hash payload */ }
      }
    }
  }
  analyticsPostIndexFields = analyticsPostIndex.length;
  legacyImpressionPostIndexFields = legacyImpressionPosts.length;
  analyticsViewerIndexFields = analyticsViewerHashes.length;

  const analyticsCounterKeys = [
    ANALYTICS_PREFIX + 'post-views', ANALYTICS_PREFIX + 'unique-users', ANALYTICS_PREFIX + 'index-prune-counter',
    ...['main-game', 'orb-share', 'frenzy'].flatMap(type => [
      ANALYTICS_PREFIX + 'type:' + type,
      ANALYTICS_PREFIX + 'unique-type-count:' + type,
      ANALYTICS_PREFIX + 'conversion-count:' + type,
      ...['mobile', 'tablet', 'desktop', 'unknown'].map(device => ANALYTICS_PREFIX + 'type-device:' + type + ':' + device),
    ]),
    ...['mobile', 'tablet', 'desktop', 'unknown'].map(device => ANALYTICS_PREFIX + 'device:' + device),
    ...['orb-share', 'frenzy'].map(type => ANALYTICS_PREFIX + 'source-eligible-count:' + type),
    ANALYTICS_PREFIX + 'conversion-count:main-game-post',
  ];
  const analyticsTimeKeys: string[] = [];
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  for (let n = 0; n <= 25; n += 1) for (const type of ['main-game', 'orb-share', 'frenzy']) analyticsTimeKeys.push(ANALYTICS_PREFIX + 'hour:' + (hour - n) + ':' + type);
  for (let n = 0; n <= 35; n += 1) {
    for (const type of ['main-game', 'orb-share', 'frenzy']) analyticsTimeKeys.push(ANALYTICS_PREFIX + 'day:' + (day - n) + ':' + type);
    analyticsTimeKeys.push(ANALYTICS_PREFIX + 'unique-today:' + (day - n));
  }
  for (const post of analyticsPostIndex) analyticsCounterKeys.push(ANALYTICS_PREFIX + 'post:' + post.postType + ':' + encodeURIComponent(post.postId));
  const analyticsReadKeys = [...analyticsCounterKeys, ...analyticsTimeKeys];
  const analyticsValues = await safeMGet(analyticsReadKeys);
  for (let i = 0; i < analyticsValues.length; i += 1) {
    add('Impression analytics counters', analyticsReadKeys[i], analyticsValues[i]);
  }

  // The original analytics implementation used the broader io:impressions:
  // namespace. It was superseded by unique-v2, but no migration or namespace
  // purge was part of that change. Probe its known index, aggregate keys, and
  // bounded recent buckets without attempting unsupported global key scans.
  const legacyImpressionCounterKeys = [
    LEGACY_IMPRESSIONS_PREFIX + 'total',
    ...['main-game', 'orb-share', 'frenzy'].map(type => LEGACY_IMPRESSIONS_PREFIX + 'type:' + type),
    ...['mobile', 'tablet', 'desktop', 'unknown'].map(device => LEGACY_IMPRESSIONS_PREFIX + 'device:' + device),
    ...['main-game', 'orb-share', 'frenzy'].flatMap(type =>
      ['mobile', 'tablet', 'desktop', 'unknown'].map(device =>
        LEGACY_IMPRESSIONS_PREFIX + 'type-device:' + type + ':' + device,
      ),
    ),
    ...legacyImpressionPosts.map(post =>
      LEGACY_IMPRESSIONS_PREFIX + 'post:' + post.postType + ':' + encodeURIComponent(post.postId),
    ),
  ];
  const legacyImpressionTimeKeys: string[] = [];
  for (let n = 0; n < LEGACY_IMPRESSION_TIME_BUCKET_DAYS * 24; n += 1) {
    for (const type of IMPRESSION_POST_TYPES) {
      legacyImpressionTimeKeys.push(LEGACY_IMPRESSIONS_PREFIX + 'hour:' + (hour - n) + ':' + type);
    }
  }
  for (let n = 0; n < LEGACY_IMPRESSION_TIME_BUCKET_DAYS; n += 1) {
    for (const type of IMPRESSION_POST_TYPES) {
      legacyImpressionTimeKeys.push(LEGACY_IMPRESSIONS_PREFIX + 'day:' + (day - n) + ':' + type);
    }
  }
  const legacyImpressionReadKeys = [...legacyImpressionCounterKeys, ...legacyImpressionTimeKeys];
  const legacyImpressionValues = await safeMGet(legacyImpressionReadKeys);
  for (let i = 0; i < legacyImpressionValues.length; i += 1) {
    const value = legacyImpressionValues[i];
    if (value != null && i >= 20 && i < legacyImpressionCounterKeys.length) {
      legacyImpressionPostCountersPresent += 1;
    }
    if (value != null && i >= legacyImpressionCounterKeys.length) {
      legacyImpressionTimeBucketKeysPresent += 1;
    }
    add('Legacy impression analytics', legacyImpressionReadKeys[i], value);
  }

  const postIdByteStats = new Map<string, { bytes: number; count: number }>();
  let allIndexedPostIdBytes = 0;
  let allIndexedPostIdCount = 0;
  for (const post of analyticsPostIndex) {
    const type = post.postType as (typeof IMPRESSION_POST_TYPES)[number];
    if (!IMPRESSION_POST_TYPES.includes(type)) continue;
    const encodedIdBytes = byteLength(encodeURIComponent(post.postId));
    const stats = postIdByteStats.get(type) ?? { bytes: 0, count: 0 };
    stats.bytes += encodedIdBytes;
    stats.count += 1;
    postIdByteStats.set(type, stats);
    allIndexedPostIdBytes += encodedIdBytes;
    allIndexedPostIdCount += 1;
  }

  try {
    const viewerKeys = analyticsViewerHashes.map(hash => ANALYTICS_PREFIX + 'viewer:' + hash);
    const viewerValues = await safeMGet(viewerKeys);
    for (let i = 0; i < viewerKeys.length; i += 1) {
      const raw = viewerValues[i];
      add('Impression viewer records', viewerKeys[i], raw);
      if (raw == null) {
        impressionViewerRecordsMissing += 1;
        continue;
      }
      if (typeof raw !== 'string') {
        impressionViewerRecordsInvalid += 1;
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as { uniquePostViews?: unknown; byType?: unknown };
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          impressionViewerRecordsInvalid += 1;
          continue;
        }
        const rawByType = parsed.byType && typeof parsed.byType === 'object' && !Array.isArray(parsed.byType)
          ? parsed.byType as Record<string, unknown>
          : {};
        const byType = {
          'main-game': auditCount(rawByType['main-game']),
          'orb-share': auditCount(rawByType['orb-share']),
          frenzy: auditCount(rawByType.frenzy),
        };
        const uniquePostViews = auditCount(parsed.uniquePostViews);
        const byTypeTotal = IMPRESSION_POST_TYPES.reduce((total, type) => total + byType[type], 0);
        impressionViewerRecordsParsed += 1;
        impressionViewerUniquePostViews += uniquePostViews;
        if (byTypeTotal !== uniquePostViews) impressionViewerCountMismatches += 1;
        impressionViewerMarkerProbes.push({
          family: 'Impression unique-user markers',
          key: ANALYTICS_PREFIX + 'seen-user:' + analyticsViewerHashes[i],
        });
        impressionViewerMarkerProbes.push({
          family: 'Impression source-touch markers',
          key: ANALYTICS_PREFIX + 'source-touch:' + analyticsViewerHashes[i],
        });
        impressionViewerMarkerProbes.push({
          family: 'Impression conversion markers',
          key: ANALYTICS_PREFIX + 'converted-user:' + analyticsViewerHashes[i],
        });
        for (const sourceType of IMPRESSION_SOURCE_TYPES) {
          impressionViewerMarkerProbes.push({
            family: 'Impression source-eligibility markers',
            key: ANALYTICS_PREFIX + 'source-eligible-user:' + sourceType + ':' + analyticsViewerHashes[i],
          });
        }
        for (const type of IMPRESSION_POST_TYPES) {
          impressionViewerUniquePostViewsByType[type] += byType[type];
          if (byType[type] > 0) {
            impressionSeenTypeMarkerEstimatedCount += 1;
            impressionSeenTypeMarkerEstimatedBytes +=
              byteLength(ANALYTICS_PREFIX + 'seen-type-user:' + type + ':') + 64 + 1;
            impressionViewerMarkerProbes.push({
              family: 'Impression unique-type markers',
              key: ANALYTICS_PREFIX + 'seen-type-user:' + type + ':' + analyticsViewerHashes[i],
            });
          }
        }
      } catch {
        impressionViewerRecordsInvalid += 1;
      }
    }
  } catch (error) {
    errors.push('Impression viewer-record audit failed: ' + String(error));
  }

  impressionSeenUserMarkerEstimatedCount = impressionViewerRecordsParsed;
  // Probe the durable/no-TTL marker families whose user hashes are discoverable
  // through the viewer index. These are actual key reads, not inferred counts.
  const uniqueViewerMarkerProbes = new Map(
    impressionViewerMarkerProbes.map(item => [item.key, item.family]),
  );
  const viewerMarkerKeys = [...uniqueViewerMarkerProbes.keys()];
  impressionMarkerKeysAudited += viewerMarkerKeys.length;
  try {
    const markerValues = await safeMGetWide(viewerMarkerKeys);
    for (let i = 0; i < viewerMarkerKeys.length; i += 1) {
      if (markerValues[i] != null) impressionMarkerKeysPresent += 1;
      add(uniqueViewerMarkerProbes.get(viewerMarkerKeys[i]) ?? 'Impression viewer markers', viewerMarkerKeys[i], markerValues[i]);
    }
  } catch (error) {
    errors.push('Indexed impression-marker audit failed: ' + String(error));
  }
  impressionSeenPostMarkerEstimatedCount = IMPRESSION_POST_TYPES.reduce(
    (total, type) => total + impressionViewerUniquePostViewsByType[type],
    0,
  );
  for (const type of IMPRESSION_POST_TYPES) {
    const markerCount = impressionViewerUniquePostViewsByType[type];
    if (markerCount <= 0) continue;
    const stats = postIdByteStats.get(type);
    const averagePostIdBytes = stats?.count
      ? stats.bytes / stats.count
      : allIndexedPostIdCount > 0
        ? allIndexedPostIdBytes / allIndexedPostIdCount
        : 0;
    const markerKeyBytes =
      byteLength(ANALYTICS_PREFIX + 'seen-post-user:' + type + ':') +
      Math.ceil(averagePostIdBytes) +
      byteLength(':' + '0'.repeat(64));
    impressionSeenPostMarkerEstimatedBytes += markerCount * (markerKeyBytes + 1);
  }
  const seenUserMarkerBytes = byteLength(ANALYTICS_PREFIX + 'seen-user:') + 64 + 1;
  impressionViewerMarkerEstimatedBytes =
    impressionSeenPostMarkerEstimatedBytes +
    impressionViewerRecordsParsed * seenUserMarkerBytes +
    impressionSeenTypeMarkerEstimatedBytes;

  // Look up durable post metadata for both current and retired indexed posts.
  // Per-viewer claim receipts still cannot be enumerated without a global scan.
  const indexedPostsForMetadata = new Map<string, { postType: string; postId: string }>();
  for (const post of [...analyticsPostIndex, ...legacyImpressionPosts]) {
    indexedPostsForMetadata.set(post.postType + ':' + post.postId, post);
  }
  const indexedPostMetadata: Array<{ family: string; key: string }> = [];
  for (const post of indexedPostsForMetadata.values()) {
    const bareId = post.postId.replace(/^t3_/i, '');
    const normalizedId = /^t3_/i.test(post.postId) ? post.postId : 't3_' + post.postId;
    if (post.postType === 'orb-share') {
      indexedPostMetadata.push({
        family: 'Shared Orb post markers',
        key: 'io:shared-orb:post:' + normalizedId,
      });
    }
    if (post.postType === 'frenzy') {
      for (const id of [...new Set([post.postId, bareId, normalizedId])]) {
        indexedPostMetadata.push({ family: 'Frenzy post records', key: 'io:frenzy:post:' + id });
      }
      for (const id of [...new Set([post.postId, bareId])]) {
        indexedPostMetadata.push({ family: 'Frenzy claimer projections', key: 'io:frenzy:claimers:v1:' + encodeURIComponent(id) });
      }
    }
  }
  const metadataByKey = new Map(indexedPostMetadata.map(item => [item.key, item.family]));
  const metadataKeys = [...metadataByKey.keys()];
  const metadataValues = await safeMGet(metadataKeys);
  for (let i = 0; i < metadataKeys.length; i += 1) {
    const value = metadataValues[i];
    if (value != null) indexedPostMetadataKeysPresent += 1;
    add(metadataByKey.get(metadataKeys[i]) ?? 'Indexed post metadata', metadataKeys[i], value);
  }

  const diagnosticSharedKeys = [
    'io:save-debug:v1', 'io:payment-debug-log:v1',
    'io:global-booster-debug-log:v1', 'io:global-booster-activation-log:v1',
  ];
  const diagnosticValues = await safeMGet(diagnosticSharedKeys);
  for (let i = 0; i < diagnosticSharedKeys.length; i += 1) add('Diagnostic logs', diagnosticSharedKeys[i], diagnosticValues[i]);

  // Global Booster credit batches leave permanent manifests and per-player
  // idempotency receipts. Their operation IDs are not stored in a separate
  // index, but the bounded debug log can recover recent IDs when it is present.
  const boosterLogRaw = diagnosticValues[2];
  let boosterOperationIds: string[] = [];
  if (typeof boosterLogRaw === 'string') {
    try {
      const entries = JSON.parse(boosterLogRaw) as unknown;
      if (Array.isArray(entries)) {
        boosterOperationIds = [...new Set(entries
          .filter((entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry) &&
            entry.stage === 'admin:grant-credits' &&
            typeof entry.operationId === 'string' && entry.operationId.trim().length > 0,
          )
          .map(entry => String(entry.operationId).trim()))];
      }
    } catch {
      errors.push('Global Booster debug log could not be parsed for batch operation IDs.');
    }
  }
  adminCreditOperationsFound = boosterOperationIds.length;
  const auditedBoosterOperationIds = boosterOperationIds.slice(-MAX_ADMIN_CREDIT_OPERATIONS_AUDITED);
  adminCreditOperationsAudited = auditedBoosterOperationIds.length;
  adminCreditOperationsSkipped = Math.max(0, adminCreditOperationsFound - adminCreditOperationsAudited);
  const boosterManifestKeys = auditedBoosterOperationIds.map(
    operationId => ADMIN_CREDIT_BATCH_PREFIX + encodeURIComponent(operationId),
  );
  try {
    const boosterManifestValues = await safeMGetWide(boosterManifestKeys);
    const receiptProbes: string[] = [];
    for (let i = 0; i < boosterManifestKeys.length; i += 1) {
      const manifestKey = boosterManifestKeys[i];
      const storedValue = boosterManifestValues[i];
      add('Admin Global Booster credit manifests', manifestKey, storedValue);
      if (typeof storedValue !== 'string') continue;
      let decodedManifest = storedValue;
      const largeManifest = parseLargeManifest(manifestKey, storedValue);
      if (largeManifest) {
        const chunkKeys = Array.from(
          { length: largeManifest.chunkCount },
          (_, index) => largeChunkKey(largeManifest, index),
        );
        const chunkValues = await safeMGetWide(chunkKeys);
        let joined = '';
        let complete = true;
        for (let chunk = 0; chunk < chunkKeys.length; chunk += 1) {
          if (typeof chunkValues[chunk] !== 'string') {
            complete = false;
            missingLargeValueChunks += 1;
            continue;
          }
          add('Admin Global Booster credit manifest chunks', chunkKeys[chunk], chunkValues[chunk]);
          joined += chunkValues[chunk] as string;
        }
        if (!complete || joined.length !== largeManifest.length) {
          errors.push('A Global Booster credit manifest has missing or incomplete chunks.');
          continue;
        }
        decodedManifest = joined;
      }
      try {
        const manifest = JSON.parse(decodedManifest) as { userIds?: unknown };
        if (!Array.isArray(manifest.userIds)) continue;
        for (const player of manifest.userIds) {
          if (!player || typeof player !== 'object' || Array.isArray(player)) continue;
          const userId = String((player as Record<string, unknown>).userId ?? '').trim();
          if (!userId) continue;
          receiptProbes.push(
            ADMIN_CREDIT_RECEIPT_PREFIX +
            encodeURIComponent(auditedBoosterOperationIds[i]) + ':' +
            encodeURIComponent(userId),
          );
        }
      } catch {
        errors.push('A Global Booster credit batch manifest could not be parsed.');
      }
    }
    const uniqueReceiptKeys = [...new Set(receiptProbes)];
    const receiptValues = await safeMGetWide(uniqueReceiptKeys);
    for (let i = 0; i < uniqueReceiptKeys.length; i += 1) {
      if (receiptValues[i] != null) adminCreditGrantReceiptsPresent += 1;
      add('Admin Global Booster credit receipts', uniqueReceiptKeys[i], receiptValues[i]);
    }
  } catch (error) {
    errors.push('Global Booster batch manifest/receipt audit failed: ' + String(error));
  }

  // Per-player operational and diagnostic keys reachable through the registry.
  const perPlayerKeys = userIds.flatMap(userId => [
    ['Diagnostic logs', 'io:player-spy:v1:' + userId],
    ['Temporary player state', 'io:offline-full-notified:' + userId],
    ['Temporary player state', 'io:offline-full-job:' + userId],
    ['Temporary player state', 'io:player-flair:' + userId],
    ['Temporary player state', 'io:roll-ticket:' + userId],
    ['Follow prompt records', 'io:follow-prompt-subscribed:v2:' + userId],
    ['Follow prompt records', 'io:follow-prompt-reward:v1:' + userId],
    ['Temporary player state', 'io:fake-ccu:' + userId],
    ['Temporary player state', 'infinity-orbs:first-roll-tutorial:' + userId],
  ] as const);
  const perPlayerValues = await safeMGet(perPlayerKeys.map(item => item[1]));
  for (let i = 0; i < perPlayerKeys.length; i += 1) add(perPlayerKeys[i][0], perPlayerKeys[i][1], perPlayerValues[i]);

  const popupKeys = ['notification', 'frenzy', 'joinSubreddit'].flatMap(popup =>
    ['shown', 'accepted', 'dismissed'].map(event => 'io:popup-stats:v1:' + popup + ':' + event));
  const popupValues = await safeMGet(popupKeys);
  for (let i = 0; i < popupKeys.length; i += 1) add('Popup statistics', popupKeys[i], popupValues[i]);

  const orderedGroups = [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  largest.sort((a, b) => b.bytes - a.bytes);
  return {
    generatedAt: new Date().toISOString(),
    installationStorageLimitBytes: 100_000_000,
    platformReportedTotalAvailable: false,
    knownIndexedPayloadBytes: orderedGroups.reduce((total, group) => total + group.bytes, 0),
    knownIndexedKeys: orderedGroups.reduce((total, group) => total + group.keys, 0),
    knownRecords: orderedGroups.reduce((total, group) => total + group.records, 0),
    indexedPlayersTotal: allUserIds.length,
    indexedPlayersIncludingLegacyLeaderboard: allIndexedUserIds.length,
    indexedPlayersAudited: userIds.length,
    legacyLeaderboardPlayerIds,
    legacyLeaderboardIdsMissingRegistry,
    onlinePlayersCurrentCount: currentOnlinePlayers,
    playerAuditTruncated: truncatedUsers > 0,
    playerManifestCount,
    playerChunkPayloadBytesEstimated,
    playerChunkPayloadBytesRead,
    playerChunkKeysSkipped,
    activeCodexUsersEligible: codexUsersEligible,
    activeCodexUsersAudited: codexUsersAudited,
    activeCodexUsersSkipped: codexUsersSkipped,
    activeCodexShardKeysPresent: codexKeysPresent,
    missingPlayerSaveChunks: missingPlayerChunks,
    missingLargeValueChunks,
    impressionPostIndexFields: analyticsPostIndexFields,
    impressionViewerIndexFields: analyticsViewerIndexFields,
    legacyImpressionPostIndexFields,
    legacyImpressionPostCountersPresent,
    legacyImpressionTimeBucketKeysPresent,
    legacyImpressionTimeBucketDaysAudited: LEGACY_IMPRESSION_TIME_BUCKET_DAYS,
    indexedPostMetadataKeysPresent,
    impressionMarkerKeysAudited,
    impressionMarkerKeysPresent,
    adminCreditOperationsFound,
    adminCreditOperationsAudited,
    adminCreditOperationsSkipped,
    adminCreditGrantReceiptsPresent,
    impressionViewerIndexConfiguredCap: MAX_INDEXED_VIEWERS,
    impressionViewerIndexOverCap: Math.max(0, analyticsViewerIndexFields - MAX_INDEXED_VIEWERS),
    impressionViewerRecordsParsed,
    impressionViewerRecordsMissing,
    impressionViewerRecordsInvalid,
    impressionViewerCountMismatches,
    impressionViewerUniquePostViews,
    impressionViewerUniquePostViewsByType,
    impressionSeenPostMarkerEstimatedCount,
    impressionSeenPostMarkerEstimatedBytes,
    impressionSeenUserMarkerEstimatedCount,
    impressionSeenTypeMarkerEstimatedCount,
    impressionViewerMarkerEstimatedCount: impressionSeenPostMarkerEstimatedCount + impressionSeenUserMarkerEstimatedCount + impressionSeenTypeMarkerEstimatedCount,
    impressionSeenTypeMarkerEstimatedBytes,
    impressionViewerMarkerEstimatedBytes,
    groups: orderedGroups,
    largestKnownValues: largest.slice(0, MAX_TOP_VALUES),
    limitations: [
      'This is a payload-size estimate from known/indexed keys, not Redis MEMORY USAGE or the platform quota meter.',
      'Devvit does not expose global key scanning; retired player-save generations, old Codex generations, unindexed large-value chunks, and orphaned keys cannot be enumerated.',
      'Player accounts are enumerated from the player registry plus user IDs in the legacy leaderboard; other unknown or orphaned player IDs cannot be discovered.',
      'The retired io:impressions: namespace is probed through its exact post-index key, derived post counters, aggregate counters, and a rolling ' + LEGACY_IMPRESSION_TIME_BUCKET_DAYS + '-day time-bucket window. Unindexed legacy keys or buckets older than that window may remain invisible.',
      'Indexed Shared Orb/Frenzy post metadata is probed where IDs are present in current or legacy impression indexes. Per-viewer Frenzy claim receipts and other user/post combinations cannot be exhaustively enumerated.',
      'Indexed impression marker reads cover seen-user, seen-type-user, source-eligibility, source-touch, and generic conversion keys for viewer hashes in the current viewer index. Per-post seen markers, day markers, and markers for viewers absent from that index remain incomplete.',
      'Global Booster batch manifests and grant receipts are recovered from at most ' + MAX_ADMIN_CREDIT_OPERATIONS_AUDITED + ' operation IDs retained in the bounded debug log. If the log was cleared or an operation aged out, its unindexed manifest and receipts remain undiscoverable.',
      'Only the first ' + MAX_AUDIT_USERS + ' indexed players are inspected per audit to keep the request bounded.',
      'Active Codex shard checks are capped at ' + MAX_CODEX_AUDIT_USERS + ' eligible player accounts; active Codex users beyond that cap are reported as skipped.',
      'Player-save chunk payload reads are capped at ' + MAX_PLAYER_CHUNK_PAYLOAD_READ_BYTES + ' bytes per audit; skipped chunk payload sizes are estimated from manifests.',
      'Impression marker estimates cover seen-post-user, seen-user, and seen-type-user keys inferred from indexed viewer rows. Seen-post-user totals are cumulative and can overstate live keys because those keys expire after 180 days; per-day, source-eligibility, source-touch, and conversion markers are not inferred.',
      'Impression seen-post-user byte estimates use average encoded post-ID lengths from the current post index and include key/value payload bytes only, not Redis metadata or allocator overhead.',
      'Redis key metadata, hash-table overhead, allocator overhead, and provider accounting are not included.',
    ],
    errors,
  };
}

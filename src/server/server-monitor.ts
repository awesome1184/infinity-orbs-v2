/**
 * Low-overhead, process-local server monitoring for the admin console.
 *
 * Request events stay in memory rather than writing one permanent Redis record
 * per gameplay action. Metrics are process-local because Devvit does not expose
 * a universal HTTP requests-per-second quota or a Redis memory-usage command.
 */
export type ServerMonitorEvent = {
  id: number;
  timestamp: number;
  severity: 'info' | 'warn' | 'error';
  actor: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  message: string;
  details?: Record<string, unknown>;
};

type SecondBucket = {
  second: number;
  requests: number;
  redisOperations: number;
  completed: number;
  latencyMsTotal: number;
  clientErrors: number;
  serverErrors: number;
};

const REDIS_COMMANDS_PER_SECOND_LIMIT = 40_000;
const REDIS_STORAGE_LIMIT_BYTES = 100_000_000;
const BUCKET_COUNT = 120;
const EVENT_LIMIT = 250;
const buckets: SecondBucket[] = Array.from({ length: BUCKET_COUNT }, () => ({
  second: -1,
  requests: 0,
  redisOperations: 0,
  completed: 0,
  latencyMsTotal: 0,
  clientErrors: 0,
  serverErrors: 0,
}));
const events: ServerMonitorEvent[] = [];
let nextEventId = 1;
let activeRequests = 0;

const upgradeBatchCounters = {
  serverAttempts: 0,
  serverAccepted: 0,
  serverPartial: 0,
  serverRejected: 0,
  clientRollbacks: 0,
  serverDurationMsTotal: 0,
  serverDurationSamples: 0,
  lastFailureAt: 0,
};

function bucketFor(second: number): SecondBucket {
  const index = ((second % BUCKET_COUNT) + BUCKET_COUNT) % BUCKET_COUNT;
  let bucket = buckets[index];
  if (bucket.second !== second) {
    bucket = {
      second,
      requests: 0,
      redisOperations: 0,
      completed: 0,
      latencyMsTotal: 0,
      clientErrors: 0,
      serverErrors: 0,
    };
    buckets[index] = bucket;
  }
  return bucket;
}

function pushEvent(event: Omit<ServerMonitorEvent, 'id'>): void {
  events.push({ ...event, id: nextEventId++ });
  if (events.length > EVENT_LIMIT) events.splice(0, events.length - EVENT_LIMIT);
}

function normalizedActor(value: unknown): string {
  let username = String(value ?? '').trim();
  if (username.toLowerCase().startsWith('/u/')) username = username.slice(3);
  else if (username.toLowerCase().startsWith('u/')) username = username.slice(2);
  while (username.startsWith('/')) username = username.slice(1);
  return username ? 'u/' + username.slice(0, 100) : 'an unknown user';
}

/**
 * Capture purchase outcomes without adding a Redis write to the hot path.
 * The bounded event ring and counters live only for this server process.
 */
export function recordUpgradeBatchDiagnostic(input: {
  stage: 'server-accepted' | 'server-partial' | 'server-rejected' | 'client-rollback';
  username?: unknown;
  requestId?: unknown;
  upgradeIds?: unknown;
  status?: unknown;
  durationMs?: unknown;
  errorCode?: unknown;
  message?: unknown;
  clientStateRevision?: unknown;
  serverStateRevision?: unknown;
  purchasedCount?: unknown;
}): void {
  const timestamp = Date.now();
  const stage = input.stage;
  const actor = normalizedActor(input.username);
  const requestId = String(input.requestId ?? '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
  const upgradeIds = Array.isArray(input.upgradeIds)
    ? input.upgradeIds.filter((id): id is string => typeof id === 'string').slice(0, 100).map(id => id.slice(0, 48))
    : [];
  const status = Math.max(0, Math.min(599, Math.floor(Number(input.status) || 0)));
  const durationMs = Math.max(0, Math.min(120_000, Number(input.durationMs) || 0));
  const errorCode = String(input.errorCode ?? '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 80);
  const reason = String(input.message ?? '').replace(/\s+/g, ' ').slice(0, 180);
  const clientStateRevision = Number.isSafeInteger(input.clientStateRevision) ? Number(input.clientStateRevision) : null;
  const serverStateRevision = Number.isSafeInteger(input.serverStateRevision) ? Number(input.serverStateRevision) : null;
  const purchasedCount = Number.isSafeInteger(input.purchasedCount) ? Math.max(0, Number(input.purchasedCount)) : null;

  if (stage === 'server-accepted' || stage === 'server-partial' || stage === 'server-rejected') {
    upgradeBatchCounters.serverAttempts += 1;
    upgradeBatchCounters.serverDurationMsTotal += durationMs;
    upgradeBatchCounters.serverDurationSamples += 1;
    if (stage === 'server-accepted') upgradeBatchCounters.serverAccepted += 1;
    else if (stage === 'server-partial') {
      upgradeBatchCounters.serverPartial += 1;
      upgradeBatchCounters.lastFailureAt = timestamp;
    } else {
      upgradeBatchCounters.serverRejected += 1;
      upgradeBatchCounters.lastFailureAt = timestamp;
    }
  } else {
    upgradeBatchCounters.clientRollbacks += 1;
    upgradeBatchCounters.lastFailureAt = timestamp;
  }

  const stageLabel = stage === 'server-accepted'
    ? 'accepted'
    : stage === 'server-partial'
      ? 'partially accepted'
      : stage === 'server-rejected'
        ? 'rejected'
        : 'client rolled back';
  const severity: ServerMonitorEvent['severity'] = stage === 'server-accepted'
    ? 'info'
    : status >= 500 || status === 0
      ? 'error'
      : 'warn';
  const detailParts = [
    requestId ? 'ID ' + requestId : '',
    errorCode ? 'code ' + errorCode : '',
    reason ? 'reason ' + reason : '',
  ].filter(Boolean);
  pushEvent({
    timestamp,
    severity,
    actor,
    method: 'POST',
    path: stage === 'client-rollback' ? '/api/diagnostics/upgrade-rollback' : '/api/upgrade/batch',
    status,
    durationMs,
    message: 'Upgrade batch ' + stageLabel + ' · ' + actor +
      ' · ' + upgradeIds.length + ' requested · HTTP ' + status + ' · ' + durationMs + ' ms' +
      (purchasedCount === null ? '' : ' · ' + purchasedCount + ' purchased') +
      (detailParts.length ? ' · ' + detailParts.join(' · ') : ''),
    details: {
      stage,
      ...(requestId ? { requestId } : {}),
      upgradeIds,
      requestedCount: upgradeIds.length,
      ...(purchasedCount === null ? {} : { purchasedCount }),
      ...(errorCode ? { errorCode } : {}),
      ...(reason ? { reason } : {}),
      ...(clientStateRevision === null ? {} : { clientStateRevision }),
      ...(serverStateRevision === null ? {} : { serverStateRevision }),
    },
  });
}

function humanizePath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? 'request';
  return last
    .split('-')
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function actionLabel(method: string, path: string): string | null {
  if (method === 'POST' && path === '/api/roll') return 'Received orb roll';
  if (method === 'POST' && path === '/api/combat/beat') return 'Received combat beat';
  if (method === 'POST' && path.startsWith('/api/combat/')) return 'Received combat action · ' + humanizePath(path);
  if (method === 'POST' && path.startsWith('/api/frenzy/')) return 'Processed Orb Frenzy action';
  if (method === 'POST' && path === '/api/share') return 'Created an orb share';
  if (method === 'POST' && path === '/api/chat') return 'Received Global Chat message';
  if (method === 'POST' && path === '/api/guilds/chat') return 'Received Guild Chat message';
  if (method === 'POST' && path === '/api/feedback') return 'Received player feedback';
  if (method === 'POST' && path.startsWith('/api/dev/')) return 'Processed admin action · ' + humanizePath(path);
  if (method === 'POST') return 'Processed ' + humanizePath(path);
  if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return 'Processed ' + method + ' ' + humanizePath(path);
  }
  return null;
}

function isMonitorEndpoint(path: string): boolean {
  return path === '/api/dev/server-monitor' || path.startsWith('/api/dev/server-monitor/');
}

/** Call when an HTTP request starts. The returned request is accounted for on finish. */
export function beginServerRequest(
  methodValue: unknown,
  pathValue: unknown,
  username: unknown,
  getStatusCode: () => number,
  onFinish: (event: 'finish', callback: () => void) => unknown,
): void {
  const method = String(methodValue ?? 'GET').toUpperCase();
  const path = String(pathValue ?? '/').split('?')[0] || '/';
  if (isMonitorEndpoint(path)) return;

  const startedAt = Date.now();
  bucketFor(Math.floor(startedAt / 1000)).requests += 1;
  activeRequests += 1;
  const actor = normalizedActor(username);

  onFinish('finish', () => {
    const finishedAt = Date.now();
    const durationMs = Math.max(0, finishedAt - startedAt);
    const status = Math.max(0, Math.floor(Number(getStatusCode()) || 0));
    const bucket = bucketFor(Math.floor(finishedAt / 1000));
    bucket.completed += 1;
    bucket.latencyMsTotal += durationMs;
    if (status >= 400 && status < 500) bucket.clientErrors += 1;
    if (status >= 500) bucket.serverErrors += 1;
    activeRequests = Math.max(0, activeRequests - 1);

    const label = actionLabel(method, path);
    // Normal successful GET polling is intentionally quiet. Failed reads still
    // appear in the feed, as do all state-changing requests.
    if (!label && status < 400) return;
    const severity: ServerMonitorEvent['severity'] = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const message = label
      ? label + ' from ' + actor
      : 'Request failed for ' + actor + ' · ' + method + ' ' + path;
    pushEvent({
      timestamp: finishedAt,
      severity,
      actor,
      method,
      path,
      status,
      durationMs,
      message: message + ' · HTTP ' + status + ' · ' + durationMs + ' ms',
    });
  });
}

const REDIS_OPERATION_NAMES = new Set([
  'get', 'set', 'del', 'exists', 'type', 'expire', 'ttl', 'incr', 'decr',
  'hGet', 'hSet', 'hGetAll', 'hDel', 'hExists', 'hLen', 'hKeys', 'hVals',
  'mGet', 'mSet', 'zAdd', 'zCard', 'zCount', 'zRange', 'zRem',
  'zRemRangeByScore', 'zScore', 'zRank', 'zRevRange', 'zRevRank',
  'watch', 'unwatch', 'multi', 'exec', 'discard', 'bitfield',
]);

export function recordRedisOperation(name: string): void {
  if (!REDIS_OPERATION_NAMES.has(name)) return;
  bucketFor(Math.floor(Date.now() / 1000)).redisOperations += 1;
}

/**
 * Wraps the Redis client and transaction object so supported calls are counted.
 * This measures app-issued operations; transaction batching and provider internals
 * mean the resulting capacity percentage is an operational estimate, not a
 * provider-side telemetry reading.
 */
export function instrumentRedisClient<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property) {
      const name = String(property);
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') return value;
      if (!REDIS_OPERATION_NAMES.has(name)) return value.bind(target);
      return (...args: unknown[]) => {
        recordRedisOperation(name);
        const result = Reflect.apply(value, target, args);
        if (name !== 'watch') return result;
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          return (result as Promise<unknown>).then(transaction => {
            return transaction && typeof transaction === 'object'
              ? instrumentRedisClient(transaction as object)
              : transaction;
          });
        }
        return result && typeof result === 'object'
          ? instrumentRedisClient(result as object)
          : result;
      };
    },
  });
}

function sumSince(nowSecond: number, seconds: number, field: 'requests' | 'redisOperations' | 'completed' | 'latencyMsTotal' | 'clientErrors' | 'serverErrors'): number {
  let total = 0;
  for (let second = nowSecond - seconds + 1; second <= nowSecond; second += 1) {
    const bucket = buckets[((second % BUCKET_COUNT) + BUCKET_COUNT) % BUCKET_COUNT];
    if (bucket.second === second) total += bucket[field];
  }
  return total;
}

function peakPerSecond(nowSecond: number, field: 'requests' | 'redisOperations'): number {
  let peak = 0;
  for (let second = nowSecond - 59; second <= nowSecond; second += 1) {
    const bucket = buckets[((second % BUCKET_COUNT) + BUCKET_COUNT) % BUCKET_COUNT];
    if (bucket.second === second) peak = Math.max(peak, bucket[field]);
  }
  return peak;
}

export function getServerMonitorSnapshot(now = Date.now()) {
  const nowSecond = Math.floor(now / 1000);
  const requests10s = sumSince(nowSecond, 10, 'requests');
  const redisOperations10s = sumSince(nowSecond, 10, 'redisOperations');
  const completed60s = sumSince(nowSecond, 60, 'completed');
  const latencyMs60s = sumSince(nowSecond, 60, 'latencyMsTotal');
  const redisOperationsPerSecond = redisOperations10s / 10;
  return {
    generatedAt: now,
    scope: 'This server process',
    metrics: {
      requestsLastMinute: sumSince(nowSecond, 60, 'requests'),
      requestsPerSecond: requests10s / 10,
      peakRequestsPerSecond: peakPerSecond(nowSecond, 'requests'),
      activeRequests,
      averageLatencyMs: completed60s > 0 ? latencyMs60s / completed60s : 0,
      clientErrorsLastMinute: sumSince(nowSecond, 60, 'clientErrors'),
      serverErrorsLastMinute: sumSince(nowSecond, 60, 'serverErrors'),
      redisOperationsPerSecond,
      peakRedisOperationsPerSecond: peakPerSecond(nowSecond, 'redisOperations'),
      redisCapacityPercent: redisOperationsPerSecond / REDIS_COMMANDS_PER_SECOND_LIMIT * 100,
    },
    limits: {
      redisCommandsPerSecond: REDIS_COMMANDS_PER_SECOND_LIMIT,
      redisStorageBytes: REDIS_STORAGE_LIMIT_BYTES,
      httpRequestsPerSecond: null,
    },
    upgradeBatches: {
      serverAttempts: upgradeBatchCounters.serverAttempts,
      serverAccepted: upgradeBatchCounters.serverAccepted,
      serverPartial: upgradeBatchCounters.serverPartial,
      serverRejected: upgradeBatchCounters.serverRejected,
      clientRollbacks: upgradeBatchCounters.clientRollbacks,
      averageServerDurationMs: upgradeBatchCounters.serverDurationSamples > 0
        ? upgradeBatchCounters.serverDurationMsTotal / upgradeBatchCounters.serverDurationSamples
        : 0,
      lastFailureAt: upgradeBatchCounters.lastFailureAt || null,
    },
    events: events.slice(-150),
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function storedValueBytes(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'string') return byteLength(value);
  try {
    return byteLength(JSON.stringify(value) ?? String(value));
  } catch {
    return byteLength(String(value));
  }
}

async function getValues(redis: any, keys: string[]): Promise<Array<unknown>> {
  const values: unknown[] = [];
  for (let offset = 0; offset < keys.length; offset += 20) {
    const chunk = keys.slice(offset, offset + 20);
    const result = await redis.mGet(chunk);
    if (!Array.isArray(result) || result.length !== chunk.length) {
      throw new Error('Redis MGet returned an incomplete storage-estimate batch.');
    }
    values.push(...result);
  }
  return values;
}

type StorageGroup = { label: string; bytes: number; keys: number; records: number };

function addStoredGroup(groups: StorageGroup[], label: string, keys: string[], values: unknown[]): void {
  let bytes = 0;
  let presentKeys = 0;
  for (let i = 0; i < keys.length; i += 1) {
    const value = values[i];
    if (value == null) continue;
    presentKeys += 1;
    bytes += byteLength(keys[i]) + storedValueBytes(value);
  }
  groups.push({ label, bytes, keys: presentKeys, records: presentKeys });
}

/**
 * Estimate only app-owned values that can be reached from known indexes and
 * fixed keys. Devvit does not expose a keyspace scan or server-side MEMORY USAGE,
 * so this is explicitly a lower-bound payload estimate, not exact Redis usage.
 */
type PlayerSaveStorageManifest = {
  token: string;
  chunkCount: number;
  length: number;
};

function parsePlayerSaveStorageManifest(value: unknown): PlayerSaveStorageManifest | null {
  if (typeof value !== 'string' || !value.startsWith('{"__ioPlayerSaveManifest":1')) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const token = String(parsed.token ?? '');
    const chunkCount = Number(parsed.chunkCount);
    const length = Number(parsed.length);
    if (
      !/^[a-zA-Z0-9-]{8,120}$/.test(token) ||
      !Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 128 ||
      !Number.isSafeInteger(length) || length < 1 || length > 8 * 1024 * 1024
    ) return null;
    return { token, chunkCount, length };
  } catch {
    return null;
  }
}

export async function estimateKnownRedisStorage(redis: any) {
  const generatedAt = Date.now();
  const errors: string[] = [];
  const groups: StorageGroup[] = [];
  const registryKey = 'io:player-registry';
  let registry: Record<string, unknown> = {};

  try {
    const raw = await redis.hGetAll(registryKey);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) registry = raw as Record<string, unknown>;
    else errors.push('The player registry returned an unexpected shape.');
  } catch (error) {
    errors.push('Could not read the player registry: ' + (error instanceof Error ? error.message : String(error)));
  }

  let registryBytes = byteLength(registryKey);
  for (const [userId, value] of Object.entries(registry)) {
    registryBytes += byteLength(userId) + storedValueBytes(value);
  }
  groups.push({
    label: 'Player registry',
    bytes: Object.keys(registry).length > 0 ? registryBytes : 0,
    keys: Object.keys(registry).length > 0 ? 1 : 0,
    records: Object.keys(registry).length,
  });

  const userIds = Object.keys(registry);
  let playerSaveBytes = 0;
  let playerSaveRecords = 0;
  let combatSaveBytes = 0;
  let combatSaveRecords = 0;
  try {
    const lookupKeys = userIds.flatMap(userId => [
      'player:' + userId,
      'infinity-orbs:combat:' + userId,
    ]);
    const values = await getValues(redis, lookupKeys);
    for (let i = 0; i < userIds.length; i += 1) {
      const playerKey = lookupKeys[i * 2];
      const combatKey = lookupKeys[i * 2 + 1];
      const playerValue = values[i * 2];
      const combatValue = values[i * 2 + 1];
      if (playerValue != null) {
        playerSaveBytes += byteLength(playerKey) + storedValueBytes(playerValue);
        playerSaveRecords += 1;
        const manifest = parsePlayerSaveStorageManifest(playerValue);
        if (manifest) {
          // The manifest is only a tiny pointer. Include the current logical
          // payload and the known chunk-key overhead in the Player saves group.
          // The payload length is the serializer's character count, so this is
          // an estimate rather than a byte-perfect Redis memory measurement.
          playerSaveBytes += manifest.length;
          for (let chunk = 0; chunk < manifest.chunkCount; chunk += 1) {
            playerSaveBytes += byteLength(
              'io:player-save-chunk:' + userIds[i] + ':' + manifest.token + ':' + chunk,
            );
          }
          playerSaveRecords += manifest.chunkCount;
        }
      }
      if (combatValue != null) {
        combatSaveBytes += byteLength(combatKey) + storedValueBytes(combatValue);
        combatSaveRecords += 1;
      }
    }
  } catch (error) {
    errors.push('Could not read all indexed player/combat saves: ' + (error instanceof Error ? error.message : String(error)));
  }
  groups.push({ label: 'Player saves', bytes: playerSaveBytes, keys: playerSaveRecords, records: playerSaveRecords });
  groups.push({ label: 'Combat saves', bytes: combatSaveBytes, keys: combatSaveRecords, records: combatSaveRecords });

  const sharedKeys = [
    'io:leaderboard',
    'io:guilds',
    'io:community_event',
    'io:community_event_tick',
    'io:global-chat:v1',
    'io:global-game-post-id',
    'io:chat-reports:v1',
    'io:game-bans',
    'io:online:players',
    'io:ccu:all-time',
    'io:developer-announcement',
    'io:global-booster-announcement',
    'io:global-boosters:v4',
    'io:daily-streak-community',
  ];
  const diagnosticKeys = [
    'io:save-debug:v1',
    'io:payment-debug-log:v1',
    'io:global-booster-debug-log:v1',
    'io:global-booster-activation-log:v1',
    'io:impressions:unique-v2:post-views',
    'io:impressions:unique-v2:post-index',
    'io:impressions:unique-v2:viewer-index',
    'infinity-orbs:combat:arena:profiles',
  ];

  try {
    const values = await getValues(redis, sharedKeys);
    addStoredGroup(groups, 'Shared game state', sharedKeys, values);
  } catch (error) {
    errors.push('Could not read all shared-state keys: ' + (error instanceof Error ? error.message : String(error)));
    groups.push({ label: 'Shared game state', bytes: 0, keys: 0, records: 0 });
  }
  try {
    const values = await getValues(redis, diagnosticKeys);
    addStoredGroup(groups, 'Diagnostics & analytics', diagnosticKeys, values);
  } catch (error) {
    errors.push('Could not read all diagnostic keys: ' + (error instanceof Error ? error.message : String(error)));
    groups.push({ label: 'Diagnostics & analytics', bytes: 0, keys: 0, records: 0 });
  }

  const knownBytes = groups.reduce((total, group) => total + group.bytes, 0);
  groups.sort((a, b) => b.bytes - a.bytes);
  return {
    generatedAt,
    storageLimitBytes: REDIS_STORAGE_LIMIT_BYTES,
    knownBytes,
    knownPercent: knownBytes / REDIS_STORAGE_LIMIT_BYTES * 100,
    playerCount: userIds.length,
    keysCounted: groups.reduce((total, group) => total + group.keys, 0),
    recordsCounted: groups.reduce((total, group) => total + group.records, 0),
    groups,
    partial: true,
    note: 'Lower-bound estimate of indexed player/combat saves, including active chunked player-save payload sizes from their manifests, the player registry, and selected shared/log keys. Retired chunk generations, Codex shard hashes, unindexed per-player keys, per-user impression markers, Redis metadata, and provider overhead are not included; this is not the platform-reported total.',
    errors,
  };
}

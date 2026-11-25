import { redis, context, reddit, scheduler } from './devvit-mock.js';
import { getPostFlairOptions } from './post-flair.js';
import { parseGameBanRegistry, parseGameBanStatus, type GameBanRecord, type GameBanStatus } from './game-ban-registry.js';
import { readInBatches } from './redis-batches.js';
import { createRedisLargeValueWritePlan, retireRedisLargeValue, discardRedisLargeValueWritePlan } from './redis-large-values.js';
import { compressStorageString, decompressStorageString } from './storage-compression.js';
import { CODEX_MIGRATION_BATCH_SIZE, CODEX_SHARD_COUNT, CODEX_STORAGE_VERSION, codexShardKey, legacyCodexShardKey, groupCodexFields, normalizeCodexCollection } from '../shared/collection-storage.js';
import { getActivePlayerMutationLock, withPlayerMutationLock, withPlayerMutationLockFor } from './player-lock.js';
import * as notificationsModule from '@devvit/notifications';
import {
  accrueRiftDimensionalInterest,
  getRiftChallengeDefinition,
  normalizeRiftTemporalDragMultiplier,
  riftEchoChamberChance,
  riftFractureCascadeDuration,
  riftFractureCascadeMultiplier,
  riftOverkillRewardMultiplier,
  riftProbabilityDebtMultiplier,
  riftRatePerHour,
  riftSingularityFocusMultiplier,
  riftTemporalArbitrageMultiplier,
  riftMutationPenaltyFactor,
  riftMutationDurationRolls,
  riftObjectiveProgress,
  RIFT_MUTATIONS,
  type RiftChallengeArchive,
  type RiftChallengeMainProgress,
} from '../shared/rift-challenges.js';

const notifications = (notificationsModule as any).notifications;
import { APP_VERSION } from '../shared/version.js';
import { GLOBAL_FEATURES, type GlobalFeatureId, type ParsedAdminCliCommand } from '../shared/admin-cli.js';
import { normalizeLastRollTimestamp } from '../shared/auto-roll-timing.js';
import {
  DEFAULT_LIVE_BALANCE_CONFIG,
  LIVE_BALANCE_SETTINGS,
  getLiveBalanceSetting,
  normalizeLiveBalanceConfig,
  validateLiveBalanceValue,
  type LiveBalanceConfig,
} from '../shared/live-balance.js';
import { createRollBatchPlan, effectiveWeightAtSample, virtualRollOffsetAtSample, sampleBinomialCount, getRarityBounds, MAX_SIMULATED_ROLLS_PER_REQUEST, MAX_EFFECTIVE_ROLLS_PER_BATCH, MAX_SIMULATED_OFFLINE_ROLLS_PER_BATCH, MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH, MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH } from '../shared/roll-batching.js';
import { createRollRandomSource } from '../shared/roll-rng.js';
import { buildGuildUserFlair, countGuildTaskRareOrbs } from '../shared/social.js';
import { combatRuneBonuses, combatRuneLuckMultiplier, combatRuneMajorAbilityEffects, combatTotalBossesBeaten, combatBossLuckBonus, combatOrbDamageMultiplier } from '../shared/combat.js';
import {
  createInitialState,
  type PlayerState,
  type PopupConfig,
  type GamePopupId,
  type GamePopupEvent,
  type PopupStats,
  DEFAULT_POPUP_CONFIG,
  type QuestItem,
  type RollResponse,
  type UpgradeId,
  type PrestigeUpgradeId,
  type Orb,
  AUTO_UNLOCK_COST,
  AUTO_BUYER_COIN_RESERVE,
  SHARD_SYNTHESIS_COST,
  ROLL_SHARD_PROC_CHANCE_CAP,
  roundShardAmount,
  resolveShardPityReward,
  PRESTIGE_UPGRADES,
  cooldownMs,
  cooldownReclaimerEnergyPerActivationMs,
  grantCooldownReclaimerTimeEnergy,
  timeEnergyActivationsAvailable,
  TIME_ENERGY_MAX_MS,
  CELESTIAL_ALIGNMENT_MIN_INTERVAL_MS,
  CELESTIAL_ALIGNMENT_MAX_INTERVAL_MS,
  CELESTIAL_ALIGNMENT_DURATION_MS,
  CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS,
  CELESTIAL_ALIGNMENT_CHOICE_GRACE_MS,
  type CelestialAlignmentChoice,
  type CelestialAlignmentInstance,
  normalizeCelestialAlignmentInstances,
  activeCelestialAlignmentInstances,
  celestialAlignmentStackCount,
  rollsPerActivation,
  luckMultiplier,
  upgradeCost,
  upgradeUnlockLevel,
  prestigeUpgradeCost,
  calculatePrestigeDust,
  addCollectionValue,
  normalizeCoinAmount,
  addCoinAmount,
  offlineRollCap,
  getOrbInfo,
  formatRarity,
  createInitialDailyQuests,
  createInitialWeeklyQuests,
  rollContinuum,
  coinsForRarity,
  orbFingersMultiplier,
  criticalDividendMultiplier,
  offlineFoundryMultiplier,
  MAX_OFFLINE_ROLLS,
  OFFLINE_TICK_MS,
  calculateCosmicDust,
  effectiveOfflineTickMs,
  critMultiplier,
  calculateLevelFromXp,
  applyLevelProgress,
  totalXpRequiredBeforeLevel,
  type MasterySkillId,
  type PremiumBoosterId,
  type AutomationId,
  type PaymentReceipt,
  type GlobalBoosterId,
  type GlobalBoosterSnapshot,

  GLOBAL_BOOSTERS,
  createInitialGlobalBoosters,
  decayGlobalBoosterState,
  activateGlobalBoosterStack,
  globalBoosterCritChanceBonus,
  guildComboCritChanceBonus,
  frenzyOrbCountForRarity,
  frenzyClaimCountForRarity,
  grantFrenzyOwnerShards,
  FRENZY_OWNER_SHARD_REWARD,
  FRENZY_CLAIMS_PER_DAY,
  frenzyClaimsUsedToday,
  frenzyClaimsRemainingToday,
  frenzyCooldownRemaining,
  frenzyClaimCooldownRemaining,
  frenzyPostExpiresAt,
  isFrenzyPostExpired,

  PREMIUM_BOOSTERS,
  AUTOMATIONS,
  PURCHASE_PACKS,
  grantFreeShards,
  grantRollShards,
  spendShards,
  resetFreeShardBudgetIfNeeded,
  weekKey,
  isPremiumBoosterActive,
  normalizeActiveBoosters,
  normalizeAutomations,
  MASTERY_SKILLS,
  masterySkillCost,
  getLevelBenefits,
  estimateQuestCoinsPerMinute,
  levelAdjustedXpReward,
  highestCodexChain,
  recordRollingSessionActivity,
  nextCodexChainRarity,
  chainPatcherShardCost,
  CHAIN_PATCHER_COOLDOWN_MS,
  codexDevotionLuckPercent,
  altarCoinDevotionChancePercent,
  altarCoinFloor,
  MAX_ORB_RARITY,
  MAX_PLAYER_LEVEL,
  LEVEL_EXPANSION_START,
} from '../shared/game.js';
import {
  recordLeaderboard,
  getPlayerGuildContext,
  withGuildDataMutationLock,
  prepareGuildRollEffects,
  prepareCommunityRolls,
  getCommunityEvent,
  getDailyStreakCommunity,
  prepareDailyStreakCommunityProgress,
} from './social.js';

/** Use non-guessable identifiers for leases, reservations, and idempotency receipts. */
function createSecureId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure identifier generation is unavailable.');
}

function secureServerToken(prefix: string): string {
  return prefix + '-' + createSecureId();
}



interface SaveExtraWrite {
  key: string;
  expectedValue: string | null;
  nextValue: string;
  conflictMessage?: string;
  /** Optional absolute Redis expiry for durable side receipts. */
  expiration?: Date;
  // Optional projections must never prevent the primary player mutation from saving.
  optional?: boolean;
  /** Optional follow-up when an ancillary Guild write conflicts with the player save. */
  onConflict?: () => void | Promise<void>;
}

type SavePostCommitAction = () => Promise<void>;

const playerGuildScopes = new WeakMap<PlayerState, string | null>();
const pendingSaveExtraWrites = new WeakMap<PlayerState, SaveExtraWrite[]>();
const pendingSavePostCommitActions = new WeakMap<PlayerState, SavePostCommitAction[]>();
const pendingCodexRarityWrites = new WeakMap<PlayerState, Set<string>>();

function getPendingSaveExtraWrite(s: PlayerState, keyName: string): SaveExtraWrite | undefined {
  return pendingSaveExtraWrites.get(s)?.find(item => item.key === keyName);
}

function stageSaveExtraWrite(s: PlayerState, write: SaveExtraWrite): void {
  const existing = pendingSaveExtraWrites.get(s) ?? [];
  const index = existing.findIndex(item => item.key === write.key);
  if (index < 0) {
    pendingSaveExtraWrites.set(s, [...existing, write]);
    return;
  }
  const previous = existing[index];
  if (previous.expectedValue !== write.expectedValue) {
    throw new Error(`Conflicting staged versions for ${write.key}.`);
  }
  const merged = [...existing];
  const previousConflictHandler = previous.onConflict;
  const nextConflictHandler = write.onConflict;
  merged[index] = {
    ...write,
    expectedValue: previous.expectedValue,
    ...(previousConflictHandler || nextConflictHandler
      ? {
          onConflict: async () => {
            await previousConflictHandler?.();
            await nextConflictHandler?.();
          },
        }
      : {}),
  };
  pendingSaveExtraWrites.set(s, merged);
}

function stageSavePostCommitAction(s: PlayerState, action: SavePostCommitAction): void {
  const existing = pendingSavePostCommitActions.get(s) ?? [];
  pendingSavePostCommitActions.set(s, [...existing, action]);
}

async function clearOfflineReminderKeyIfUnchanged(
  keyName: string,
  expectedValue: unknown,
): Promise<boolean> {
  if (expectedValue == null) return false;
  const expected = String(expectedValue);
  const isNotificationMarker = keyName.startsWith(OFFLINE_FULL_NOTIFICATION_PREFIX);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(keyName);
    const current = await redis.get(keyName);
    if (current == null || String(current) !== expected) {
      await txn.unwatch();
      return false;
    }

    if (isNotificationMarker) {
      const marker = String(current);
      const now = Date.now();
      const phase = parseOfflineFullNotificationAttemptMarker(marker);
      const legacyPendingStartedAt = offlineLegacyPendingMarkerStartedAt(marker, now);
      const sendingLeaseExpired =
        phase?.phase === 'sending' &&
        now - phase.startedAt >= OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS + 60_000;
      const legacyPendingLeaseExpired =
        legacyPendingStartedAt !== null &&
        now - legacyPendingStartedAt >= OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS + 60_000;

      // A claim can cancel a pre-send reservation: the sender must still win
      // the exact-token CAS before calling the provider. Do not remove a sending
      // or legacy pending marker during its ambiguity lease, or a later call
      // could duplicate a notification that was already accepted externally.
      if (
        marker !== '' &&
        marker !== '1' &&
        phase?.phase !== 'reserved' &&
        !sendingLeaseExpired &&
        !legacyPendingLeaseExpired
      ) {
        await txn.unwatch();
        return false;
      }
    }

    await txn.multi();
    // Delete the key. An empty-valued Redis key still blocks SET NX.
    await txn.del(keyName);
    if (await txn.exec() !== null) return true;
  }
  return false;
}

function currentUserId(): string {
  const userId = String(context.userId ?? '').trim();
  if (!userId) throw new Error('REDDIT_LOGIN_REQUIRED');
  return userId;
}

// Multi-player mutations acquire every player/post lock in the same sorted
// order. This avoids reciprocal Frenzy claims deadlocking while ensuring an
// owner reward and claimant save cannot race each other's state revisions.
async function withPlayerMutationLocksFor<T>(
  userIds: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const orderedIds = Array.from(
    new Set(userIds.map(id => String(id ?? '').trim()).filter(Boolean)),
  ).sort();

  const acquire = (index: number): Promise<T> => {
    if (index >= orderedIds.length) return fn();
    return withPlayerMutationLockFor(orderedIds[index], () => acquire(index + 1));
  };
  return acquire(0);
}

const key = () => `player:${currentUserId()}`;

export function markCodexRarityWrite(state: PlayerState, rarityKey: string): void {
  const pending = pendingCodexRarityWrites.get(state) ?? new Set<string>();
  pending.add(rarityKey);
  pendingCodexRarityWrites.set(state, pending);
}

async function readCodexShardsFromKeys(
  userId: string,
  generation: number,
  keyForShard: (id: string, gen: number, shard: number) => string,
): Promise<Record<string, number>> {
  const records = await Promise.all(
    Array.from({ length: CODEX_SHARD_COUNT }, (_, shard) => redis.hGetAll(keyForShard(userId, generation, shard))),
  );
  const rawCollection: Record<string, number> = {};
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    for (const [rarityKey, rawCount] of Object.entries(record as Record<string, unknown>)) {
      const rarity = Number(rarityKey);
      const count = Number(rawCount);
      if ((rarityKey !== 'Infinity' && (!Number.isFinite(rarity) || !Number.isInteger(rarity) || rarity < 2)) ||
          !Number.isSafeInteger(count) || count < 0) continue;
      rawCollection[rarityKey] = Math.min(Number.MAX_SAFE_INTEGER, (rawCollection[rarityKey] ?? 0) + count);
    }
  }
  return normalizeCodexCollection(rawCollection);
}

async function readCodexShards(userId: string, generation: number): Promise<Record<string, number>> {
  return readCodexShardsFromKeys(userId, generation, codexShardKey);
}

async function readLegacyCodexShards(userId: string, generation: number): Promise<Record<string, number>> {
  return readCodexShardsFromKeys(userId, generation, legacyCodexShardKey);
}

async function deleteLegacyCodexShards(userId: string, generation: number): Promise<void> {
  try {
    await Promise.all(Array.from({ length: CODEX_SHARD_COUNT }, (_, shard) =>
      redis.del(legacyCodexShardKey(userId, generation, shard)),
    ));
  } catch (error) {
    console.warn('[Codex] Legacy shard cleanup will retry on a later load.', error);
  }
}

async function migrateLegacyCodex(
  userId: string,
  generation: number,
  collection: Record<string, number>,
): Promise<void> {
  const normalizedCollection = normalizeCodexCollection(collection);
  // v1 remains authoritative until the v2 player-save pointer commits. HSET is
  // idempotent, so an interrupted migration is safe to retry.
  const queued: Array<{ key: string; fields: Record<string, string> }> = [];
  for (const { shard, fields } of groupCodexFields(Object.entries(normalizedCollection))) {
    const entries = Object.entries(fields);
    for (let offset = 0; offset < entries.length; offset += CODEX_MIGRATION_BATCH_SIZE) {
      queued.push({
        key: codexShardKey(userId, generation, shard),
        fields: Object.fromEntries(entries.slice(offset, offset + CODEX_MIGRATION_BATCH_SIZE)),
      });
    }
  }
  for (let offset = 0; offset < queued.length; offset += 4) {
    await Promise.all(queued.slice(offset, offset + 4).map(write => redis.hSet(write.key, write.fields)));
  }
  const verified = await readCodexShards(userId, generation);
  const expected = JSON.stringify(Object.entries(normalizedCollection).sort(([a], [b]) => a.localeCompare(b)));
  const actual = JSON.stringify(Object.entries(verified).sort(([a], [b]) => a.localeCompare(b)));
  if (expected !== actual) throw new Error('Codex migration verification failed; the previous Codex was retained.');
}

async function ensureCodexStorageVersion(userId: string, generation: number, state: PlayerState): Promise<void> {
  if (state.collectionStorageVersion === CODEX_STORAGE_VERSION) return;
  let sourceCollection: Record<string, number>;
  if (state.collectionStorageVersion === 1) {
    sourceCollection = await readLegacyCodexShards(userId, generation);
    if (Object.keys(sourceCollection).length === 0 && isValidCollection(state.collection)) {
      sourceCollection = normalizeCodexCollection(state.collection);
    }
  } else {
    sourceCollection = normalizeCodexCollection(isValidCollection(state.collection) ? state.collection : {});
  }
  await migrateLegacyCodex(userId, generation, sourceCollection);
  state.collection = normalizeCodexCollection(sourceCollection);
  state.collectionStorageVersion = CODEX_STORAGE_VERSION;
}

const NON_PERSISTED_PLAYER_FIELDS = new Set([
  'collection', 'codexChain', 'codexDevotionLuckPercent', 'guildPerks', 'guildCombo',
  'globalBoosters', 'dailyStreakCommunity', 'onlinePlayers', 'riftChallengeFirstClear',
]);

function serializePlayerStateForRedis(state: PlayerState): string {
  const persistedState = state.collectionStorageVersion === CODEX_STORAGE_VERSION
    ? Object.fromEntries(Object.entries(state).filter(([field]) => !NON_PERSISTED_PLAYER_FIELDS.has(field)))
    : state;
  return JSON.stringify(persistedState);
}

const PLAYER_SAVE_CHUNK_PREFIX = 'io:player-save-chunk:';
const PLAYER_SAVE_CHUNK_CHARS = 64 * 1024;
const PLAYER_SAVE_INLINE_CHARS = 192 * 1024;
const PLAYER_SAVE_MAX_CHUNKS = 128;
const PLAYER_SAVE_MAX_CHARS = PLAYER_SAVE_CHUNK_CHARS * PLAYER_SAVE_MAX_CHUNKS;
type PlayerSaveManifest = {
  __ioPlayerSaveManifest: 1;
  token: string;
  chunkCount: number;
  length: number;
  checksum: string;
  projection: {
    username?: string; lastSeenAt?: number; level?: number; xp?: number;
    totalRolls?: number; highestRarity?: number; coins?: number; shards?: number;
  };
};
export type PlayerSaveWritePlan = { storedValue: string; chunkKeys: string[] };

function playerSaveChecksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function parsePlayerSaveManifest(raw: string | null | undefined): PlayerSaveManifest | null {
  if (typeof raw !== 'string' || !raw.startsWith('{"__ioPlayerSaveManifest":1')) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const projection = value.projection && typeof value.projection === 'object' && !Array.isArray(value.projection)
      ? value.projection as PlayerSaveManifest['projection'] : {};
    const token = String(value.token ?? '');
    const chunkCount = Number(value.chunkCount);
    const length = Number(value.length);
    const checksum = String(value.checksum ?? '');
    if (!/^[a-zA-Z0-9-]{8,120}$/.test(token) ||
        !Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > PLAYER_SAVE_MAX_CHUNKS ||
        !Number.isSafeInteger(length) || length < 1 || length > PLAYER_SAVE_MAX_CHARS ||
        !/^[a-f0-9]{8}$/.test(checksum)) throw new Error('Invalid player-save manifest.');
    return { __ioPlayerSaveManifest: 1, token, chunkCount, length, checksum, projection };
  } catch (error) {
    console.error('[Player Save] Invalid chunk manifest:', error);
    throw new Error('Your Infinity Orbs save index could not be read safely.');
  }
}
function playerSaveChunkKey(userId: string, token: string, index: number): string {
  return PLAYER_SAVE_CHUNK_PREFIX + userId + ':' + token + ':' + index;
}
async function readStoredPlayerSave(userId: string, storedValue: string | null | undefined): Promise<string | null> {
  if (storedValue == null) return null;
  const manifest = parsePlayerSaveManifest(storedValue);
  if (!manifest) return decompressStorageString(storedValue);
  const keys = Array.from({ length: manifest.chunkCount }, (_, index) => playerSaveChunkKey(userId, manifest.token, index));
  const chunks: string[] = [];
  for (let offset = 0; offset < keys.length; offset += 8) {
    const batch = await redis.mGet(keys.slice(offset, offset + 8));
    if (batch.length !== Math.min(8, keys.length - offset) || batch.some(value => typeof value !== 'string')) {
      throw new Error('Your Infinity Orbs save is missing a data chunk. No changes were applied.');
    }
    chunks.push(...batch as string[]);
  }
  const joined = chunks.join('');
  if (joined.length !== manifest.length || playerSaveChecksum(joined) !== manifest.checksum) {
    throw new Error('Your Infinity Orbs save failed its integrity check. No changes were applied.');
  }
  return decompressStorageString(joined);
}

async function createPlayerSaveWritePlan(userId: string, serialized: string): Promise<PlayerSaveWritePlan> {
  if (serialized.length > PLAYER_SAVE_MAX_CHARS) {
    throw new Error('Player save exceeds the supported 8 MiB logical size. No changes were written.');
  }
  const storedPayload = compressStorageString(serialized);
  if (storedPayload.length <= PLAYER_SAVE_INLINE_CHARS) return { storedValue: storedPayload, chunkKeys: [] };
  if (storedPayload.length > PLAYER_SAVE_MAX_CHARS) {
    throw new Error('Player save exceeds the supported 8 MiB stored size. No changes were written.');
  }
  const token = secureServerToken('playersave');
  const chunks: string[] = [];
  for (let offset = 0; offset < storedPayload.length;) {
    let end = Math.min(storedPayload.length, offset + PLAYER_SAVE_CHUNK_CHARS);
    if (end < storedPayload.length && storedPayload.charCodeAt(end - 1) >= 0xd800 && storedPayload.charCodeAt(end - 1) <= 0xdbff) end -= 1;
    chunks.push(storedPayload.slice(offset, end));
    offset = end;
  }
  if (chunks.length > PLAYER_SAVE_MAX_CHUNKS) throw new Error('Player save requires too many Redis records. No changes were written.');
  const chunkKeys = chunks.map((_, index) => playerSaveChunkKey(userId, token, index));
  let written = 0;
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      await redis.set(chunkKeys[index], chunks[index]);
      written += 1;
    }
  } catch (error) {
    for (const keyName of chunkKeys.slice(0, written)) await redis.del(keyName).catch(() => undefined);
    throw error;
  }
  let projection: PlayerSaveManifest['projection'] = {};
  try {
    const state = JSON.parse(serialized) as Partial<PlayerState>;
    projection = {
      ...(typeof state.username === 'string' ? { username: state.username.slice(0, 100) } : {}),
      ...(Number.isFinite(state.lastSeenAt) ? { lastSeenAt: Number(state.lastSeenAt) } : {}),
      ...(Number.isFinite(state.level) ? { level: Number(state.level) } : {}),
      ...(Number.isFinite(state.xp) ? { xp: Number(state.xp) } : {}),
      ...(Number.isFinite(state.totalRolls) ? { totalRolls: Number(state.totalRolls) } : {}),
      ...(Number.isFinite(state.highestRarity) ? { highestRarity: Number(state.highestRarity) } : {}),
      ...(Number.isFinite(state.coins) ? { coins: Number(state.coins) } : {}),
      ...(Number.isFinite(state.shards) ? { shards: Number(state.shards) } : {}),
    };
  } catch { /* chunks remain authoritative; projection only feeds admin lists */ }
  const manifest: PlayerSaveManifest = {
    __ioPlayerSaveManifest: 1, token, chunkCount: chunks.length,
    length: storedPayload.length, checksum: playerSaveChecksum(storedPayload), projection,
  };
  return { storedValue: JSON.stringify(manifest), chunkKeys };
}
export async function discardPlayerSaveWritePlan(plan: PlayerSaveWritePlan): Promise<void> {
  for (const keyName of plan.chunkKeys) await redis.del(keyName).catch(() => undefined);
}
// Requests have a 30-second platform ceiling. Retain old immutable chunks for
// twice that window so a request that already read the prior manifest can finish.
const PLAYER_SAVE_RETIRED_CHUNK_TTL_SECONDS = 60;
export async function cleanupPreviousPlayerSave(userId: string, previousRaw: string | null | undefined): Promise<void> {
  const previous = parsePlayerSaveManifest(previousRaw);
  if (!previous) return;
  const keys = Array.from(
    { length: previous.chunkCount },
    (_, index) => playerSaveChunkKey(userId, previous.token, index),
  );
  // EXPIRE changes only key metadata; do not GET and rewrite every old 64 KiB
  // chunk on each player save.
  for (let offset = 0; offset < keys.length; offset += 8) {
    await Promise.all(keys.slice(offset, offset + 8).map(async keyName => {
      try {
        await redis.expire(keyName, PLAYER_SAVE_RETIRED_CHUNK_TTL_SECONDS);
      } catch (error) {
        console.warn('[Player Save] Previous chunk could not be retired; it remains readable:', keyName, error);
      }
    }));
  }
}
export async function readPlayerSaveForUser(userId: string, storedValue: string | null | undefined): Promise<string | null> {
  return readStoredPlayerSave(userId, storedValue);
}

export async function createPlayerSaveWritePlanForUser(userId: string, state: PlayerState): Promise<PlayerSaveWritePlan> {
  return createPlayerSaveWritePlan(userId, serializePlayerStateForRedis(state));
}

function playerSaveProjection(raw: string | null | undefined): Partial<PlayerState> | null {
  if (raw == null) return null;
  const manifest = parsePlayerSaveManifest(raw);
  return manifest ? manifest.projection as Partial<PlayerState> : parseStoredJson<Partial<PlayerState>>(decompressStorageString(raw));
}
const GAME_BANS_KEY = 'io:game-bans';
const ONLINE_PLAYERS_KEY = 'io:online:players';
const CCU_HOURLY_PREFIX = 'io:ccu:hour:';
const CCU_ALL_TIME_KEY = 'io:ccu:all-time';
const FAKE_CCU_KEY_PREFIX = 'io:fake-ccu:';
const SAVE_GENERATION_KEY_PREFIX = 'player-generation:';
const PLAYER_REGISTRY_KEY = 'io:player-registry';
const DEVELOPER_ANNOUNCEMENT_KEY = 'io:developer-announcement';
const GLOBAL_MENU_CONTROL_KEY = 'io:global-menu-control:v1';
const GLOBAL_FEATURE_CONTROL_KEY_PREFIX = 'io:global-feature-control:v1:';
const LIVE_BALANCE_CONFIG_KEY = 'io:live-balance-config:v1';
const GLOBAL_BOOSTER_ANNOUNCEMENT_KEY = 'io:global-booster-announcement';
const OFFLINE_FULL_NOTIFICATION_PREFIX = 'io:offline-full-notified:';
const NOTIFICATION_PREFERENCES_PREFIX = 'io:notification-preferences:v1:';
const NOTIFICATION_DAILY_SEND_PREFIX = 'io:notification-daily-sends:v1:';
const NOTIFICATION_PENDING_UPDATE_HASH = 'io:notification-pending-game-updates:v1';
const NOTIFICATION_PENDING_UPDATE_JOB_KEY = 'io:notification-pending-game-updates-job:v1';
const NOTIFICATION_DAILY_SEND_LIMIT = 2;
const NOTIFICATION_PENDING_UPDATE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const NOTIFICATION_PENDING_UPDATE_BATCH_SIZE = 200;
const OFFLINE_FULL_JOB_PREFIX = 'io:offline-full-job:';
const OFFLINE_FULL_RETRY_MS = 5 * 60_000;
const OFFLINE_FULL_RESERVATION_TTL_MS = 60_000;
const OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS = 7 * 24 * 60 * 60_000;
const PLAYER_FLAIR_KEY_PREFIX = 'io:player-flair:';
const GUILD_FLAIR_NAMES_KEY = 'io:guild-flair-names:v1';
const ROLL_TICKET_KEY_PREFIX = 'io:roll-ticket:';
const ROLL_TICKET_COUNT = 50;
const ROLL_TICKET_TTL_MS = 10 * 60_000;
const PLAYER_SPY_LOG_KEY_PREFIX = 'io:player-spy:v1:';
const PLAYER_SPY_LOG_LIMIT = 40;
const DIAGNOSTIC_LOG_MAX_BYTES = 64_000;
const DIAGNOSTIC_LOG_TTL_MS = 14 * 24 * 60 * 60_000;
const FOLLOW_SUBSCRIBED_KEY_PREFIX = 'io:follow-prompt-subscribed:v2:';
const FOLLOW_REWARD_KEY_PREFIX = 'io:follow-prompt-reward:v1:';
const FOLLOW_ACTION_COUNT_KEY = 'io:follow-prompt-actions:v2';
const FOLLOW_REWARD_ROLLS = 100;
const POPUP_CONFIG_KEY = 'io:popup-config:v1';
const POPUP_STATS_KEY_PREFIX = 'io:popup-stats:v1:';
const POPUP_IDS: GamePopupId[] = ['notification', 'frenzy', 'frenzyShard', 'joinSubreddit'];
const POPUP_EVENTS: GamePopupEvent[] = ['shown', 'accepted', 'dismissed'];
const FOLLOW_TARGET_SUBREDDIT = 'infinityorbs';

const SAVE_DEBUG_LOG_KEY = 'io:save-debug:v1';
const SAVE_DEBUG_LOG_LIMIT = 40;

export interface SaveDebugLog {
  timestamp: number;
  event: string;
  userId: string;
  username: string;
  details: Record<string, unknown>;
}

function compactSaveState(s: PlayerState | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  return {
    stateRevision: Number(s.stateRevision ?? 0),
    saveGeneration: Number(s.saveGeneration ?? 0),
    level: Number(s.level ?? 1),
    coins: Number(s.coins ?? 0),
    shards: Number(s.shards ?? 0),
    totalRolls: Number(s.totalRolls ?? 0),
    highestRarity: Number(s.highestRarity ?? 0),
    manualRolls: Number(s.manualRolls ?? 0),
    upgrades: { ...(s.upgrades ?? {}) },
  };
}

function saveCaller(): string {
  return (new Error().stack ?? '')
    .split('\n')
    .slice(2, 7)
    .map(line => line.trim())
    .join('\n');
}

function saveStatesMatchIgnoringRevision(a: PlayerState, b: PlayerState): boolean {
  const normalize = (state: PlayerState): string => {
    const copy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete copy.stateRevision;
    for (const field of NON_PERSISTED_PLAYER_FIELDS) delete copy[field];
    return JSON.stringify(copy);
  };
  return normalize(a) === normalize(b);
}

async function appendSaveDebugLog(
  event: string,
  details: Record<string, unknown> = {},
  userId = currentUserId(),
): Promise<void> {
  const id = String(userId ?? '').trim();
  if (!id) return;

  const entry: SaveDebugLog = {
    timestamp: Date.now(),
    event,
    userId: id,
    username: String(context.username ?? ''),
    details,
  };

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const txn = await redis.watch(SAVE_DEBUG_LOG_KEY);
      const raw = await redis.get(SAVE_DEBUG_LOG_KEY);
      let entries: SaveDebugLog[] = [];

      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            entries = parsed.filter(
              (item): item is SaveDebugLog =>
                Boolean(item) &&
                typeof item === 'object' &&
                !Array.isArray(item) &&
                typeof (item as Record<string, unknown>).event === 'string',
            );
          }
        } catch {
          entries = [];
        }
      }

      entries.push(entry);
      while (entries.length > 0 && (entries.length > SAVE_DEBUG_LOG_LIMIT || JSON.stringify(entries).length > DIAGNOSTIC_LOG_MAX_BYTES)) entries.shift();

      await txn.multi();
      await txn.set(SAVE_DEBUG_LOG_KEY, JSON.stringify(entries), { expiration: new Date(Date.now() + DIAGNOSTIC_LOG_TTL_MS) });
      const committed = await txn.exec();
      if (committed !== null) return;
    }
  } catch (error) {
    console.error('[Save Debug] Could not persist save diagnostic:', error);
  }
}

export async function getSaveDebugLogs(
  userId?: string,
  limit = SAVE_DEBUG_LOG_LIMIT,
): Promise<SaveDebugLog[]> {
  const raw = await redis.get(SAVE_DEBUG_LOG_KEY);
  if (typeof raw !== 'string' || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalizedUserId = String(userId ?? '').trim();
    const entries = parsed.filter(
      (item): item is SaveDebugLog =>
        Boolean(item) &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).event === 'string' &&
        (!normalizedUserId || String((item as SaveDebugLog).userId ?? '') === normalizedUserId),
    );
    const safeLimit = Math.max(1, Math.min(SAVE_DEBUG_LOG_LIMIT, Math.floor(Number(limit) || SAVE_DEBUG_LOG_LIMIT)));
    return entries.slice(-safeLimit);
  } catch {
    return [];
  }
}

export async function clearSaveDebugLogs(): Promise<void> {
  await redis.del(SAVE_DEBUG_LOG_KEY);
}

export interface PlayerSpyLog {
  timestamp: number;
  event: string;
  details: Record<string, unknown>;
}

function playerSpyKey(userId: string): string {
  return PLAYER_SPY_LOG_KEY_PREFIX + userId;
}

function playerSpySnapshot(s: PlayerState): Record<string, unknown> {
  return {
    level: s.level,
    xp: s.xp,
    coins: s.coins,
    shards: s.shards,
    cosmicDust: s.cosmicDust,
    totalRolls: s.totalRolls,
    totalCrits: s.totalCrits ?? 0,
    highestRarity: s.highestRarity,
    collectionValue: s.collectionValue,
    lifetimeCoins: s.lifetimeCoins ?? 0,
    lifetimeShards: s.lifetimeShards ?? 0,
    offlineRolls: s.offlineRolls,
    rollsSinceBest: s.rollsSinceBest ?? 0,
    prestigeCount: s.prestigeCount ?? 0,
    masteryPoints: s.masteryPoints ?? 0,
    manualRolls: s.manualRolls ?? 0,
    upgrades: { ...s.upgrades },
    prestigeUpgrades: { ...s.prestigeUpgrades },
    masterySkills: { ...s.masterySkills },
    activeBoosters: { ...s.activeBoosters },
    automations: { ...s.automations },
  };
}

export async function appendPlayerSpyLog(
  event: string,
  details: Record<string, unknown> = {},
  userId = currentUserId(),
): Promise<void> {
  const id = String(userId ?? '').trim();
  if (!id) return;

  const entry: PlayerSpyLog = {
    timestamp: Date.now(),
    event,
    details,
  };

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const logKey = playerSpyKey(id);
      const txn = await redis.watch(logKey);
      const raw = await redis.get(logKey);
      let entries: PlayerSpyLog[] = [];

      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            entries = parsed.filter(
              (item): item is PlayerSpyLog =>
                Boolean(item) &&
                typeof item === 'object' &&
                !Array.isArray(item) &&
                typeof (item as Record<string, unknown>).event === 'string',
            );
          }
        } catch {
          entries = [];
        }
      }

      entries.push(entry);
      while (entries.length > 0 && (entries.length > PLAYER_SPY_LOG_LIMIT || JSON.stringify(entries).length > DIAGNOSTIC_LOG_MAX_BYTES)) entries.shift();

      await txn.multi();
      await txn.set(logKey, JSON.stringify(entries), { expiration: new Date(Date.now() + DIAGNOSTIC_LOG_TTL_MS) });
      const committed = await txn.exec();
      if (committed !== null) return;
    }
  } catch (error) {
    console.error('[Player Spy] Could not persist log:', error);
  }
}

export async function getPlayerSpyLogs(
  userId: string,
  limit = PLAYER_SPY_LOG_LIMIT,
): Promise<PlayerSpyLog[]> {
  const id = String(userId ?? '').trim();
  if (!id) return [];
  const raw = await redis.get(playerSpyKey(id));
  if (typeof raw !== 'string' || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(
      (item): item is PlayerSpyLog =>
        Boolean(item) &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).event === 'string',
    );
    const safeLimit = Math.max(1, Math.min(PLAYER_SPY_LOG_LIMIT, Math.floor(Number(limit) || PLAYER_SPY_LOG_LIMIT)));
    return entries.slice(-safeLimit);
  } catch {
    return [];
  }
}

export async function clearPlayerSpyLogs(userId: string): Promise<void> {
  const id = String(userId ?? '').trim();
  if (!id) return;
  await redis.del(playerSpyKey(id));
}

const PAYMENT_DEBUG_LOG_KEY = 'io:payment-debug-log:v1';
const PAYMENT_DEBUG_LOG_LIMIT = 40;

export async function appendPaymentDebugLog(stage: string, details: Record<string, unknown> = {}): Promise<void> {
  const entry = {
    at: new Date().toISOString(),
    timestamp: Date.now(),
    stage,
    ...details,
  };

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const txn = await redis.watch(PAYMENT_DEBUG_LOG_KEY);
      const raw = await redis.get(PAYMENT_DEBUG_LOG_KEY);
      let entries: Array<Record<string, unknown>> = [];

      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            entries = parsed.filter(
              (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === 'object' && !Array.isArray(item),
            );
          }
        } catch {
          entries = [];
        }
      }

      entries.push(entry);
      while (entries.length > 0 && (entries.length > PAYMENT_DEBUG_LOG_LIMIT || JSON.stringify(entries).length > DIAGNOSTIC_LOG_MAX_BYTES)) entries.shift();

      await txn.multi();
      await txn.set(PAYMENT_DEBUG_LOG_KEY, JSON.stringify(entries), { expiration: new Date(Date.now() + DIAGNOSTIC_LOG_TTL_MS) });
      const committed = await txn.exec();
      if (committed !== null) return;
    }
  } catch (error) {
    console.error('[Payments] Could not persist payment debug log:', error);
  }
}

export async function getPaymentDebugLogs(limit = PAYMENT_DEBUG_LOG_LIMIT): Promise<Array<Record<string, unknown>>> {
  const raw = await redis.get(PAYMENT_DEBUG_LOG_KEY);
  if (typeof raw !== 'string' || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
    return entries.slice(-Math.max(1, Math.min(PAYMENT_DEBUG_LOG_LIMIT, Math.floor(limit))));
  } catch {
    return [];
  }
}

export async function clearPaymentDebugLogs(): Promise<void> {
  // DEL is allowed during Redis storage-quota enforcement; SET is not.
  await redis.del(PAYMENT_DEBUG_LOG_KEY);
}

const GLOBAL_BOOSTERS_KEY = 'io:global-boosters:v4';
const GLOBAL_BOOSTER_DEBUG_LOG_KEY = 'io:global-booster-debug-log:v1';
const GLOBAL_BOOSTER_DEBUG_LOG_LIMIT = 40;

function summarizeGlobalBoosterRaw(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  return raw.length > 12000 ? raw.slice(0, 12000) + '…[truncated]' : raw;
}

export async function appendGlobalBoosterDebugLog(
  stage: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const entry = {
    at: new Date().toISOString(),
    timestamp: Date.now(),
    stage,
    ...details,
  };

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const txn = await redis.watch(GLOBAL_BOOSTER_DEBUG_LOG_KEY);
      const raw = await redis.get(GLOBAL_BOOSTER_DEBUG_LOG_KEY);
      let entries: Array<Record<string, unknown>> = [];

      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            entries = parsed.filter(
              (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === 'object' && !Array.isArray(item),
            );
          }
        } catch {
          entries = [];
        }
      }

      entries.push(entry);
      while (entries.length > 0 && (entries.length > GLOBAL_BOOSTER_DEBUG_LOG_LIMIT || JSON.stringify(entries).length > DIAGNOSTIC_LOG_MAX_BYTES)) entries.shift();

      await txn.multi();
      await txn.set(GLOBAL_BOOSTER_DEBUG_LOG_KEY, JSON.stringify(entries), { expiration: new Date(Date.now() + DIAGNOSTIC_LOG_TTL_MS) });
      const committed = await txn.exec();
      if (committed !== null) return;
    }
  } catch (error) {
    console.error('[Global Boosters] Could not persist debug log:', error);
  }
}

export async function getGlobalBoosterDebugLogs(
  limit = GLOBAL_BOOSTER_DEBUG_LOG_LIMIT,
): Promise<Array<Record<string, unknown>>> {
  const raw = await redis.get(GLOBAL_BOOSTER_DEBUG_LOG_KEY);
  if (typeof raw !== 'string' || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
    return entries.slice(-Math.max(
      1,
      Math.min(GLOBAL_BOOSTER_DEBUG_LOG_LIMIT, Math.floor(limit)),
    ));
  } catch {
    return [];
  }
}

export async function clearGlobalBoosterDebugLogs(): Promise<void> {
  // DEL is allowed during Redis storage-quota enforcement; SET is not.
  await redis.del(GLOBAL_BOOSTER_DEBUG_LOG_KEY);
}

const GLOBAL_BOOSTER_ACTIVATION_LOG_KEY = 'io:global-booster-activation-log:v1';
const GLOBAL_BOOSTER_ACTIVATION_LOG_LIMIT = 40;

export interface GlobalBoosterActivationLogEntry {
  timestamp: number;
  userId: string;
  username: string;
  boosterId: GlobalBoosterId;
  boosterName: string;
  usedCredit: boolean;
  tier: number;
  endsAt: number;
}

export async function appendGlobalBoosterActivationLog(
  entry: GlobalBoosterActivationLogEntry,
): Promise<void> {
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const txn = await redis.watch(GLOBAL_BOOSTER_ACTIVATION_LOG_KEY);
      const raw = await redis.get(GLOBAL_BOOSTER_ACTIVATION_LOG_KEY);
      let entries: GlobalBoosterActivationLogEntry[] = [];

      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            entries = parsed.filter(
              (item): item is GlobalBoosterActivationLogEntry =>
                Boolean(item) &&
                typeof item === 'object' &&
                !Array.isArray(item) &&
                Number.isFinite(Number((item as Record<string, unknown>).timestamp)) &&
                typeof (item as Record<string, unknown>).boosterId === 'string',
            );
          }
        } catch {
          entries = [];
        }
      }

      entries.push(entry);
      while (entries.length > 0 && (entries.length > GLOBAL_BOOSTER_ACTIVATION_LOG_LIMIT || JSON.stringify(entries).length > DIAGNOSTIC_LOG_MAX_BYTES)) entries.shift();

      await txn.multi();
      await txn.set(GLOBAL_BOOSTER_ACTIVATION_LOG_KEY, JSON.stringify(entries), { expiration: new Date(Date.now() + DIAGNOSTIC_LOG_TTL_MS) });
      const committed = await txn.exec();
      if (committed !== null) return;
    }
  } catch (error) {
    console.error('[Global Boosters] Could not persist activation log:', error);
  }
}

export async function getGlobalBoosterActivationLog(limit = 100): Promise<GlobalBoosterActivationLogEntry[]> {
  const safeLimit = Math.max(1, Math.min(GLOBAL_BOOSTER_ACTIVATION_LOG_LIMIT, Math.floor(Number(limit) || 100)));
  const raw = await redis.get(GLOBAL_BOOSTER_ACTIVATION_LOG_KEY);
  if (typeof raw !== 'string' || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(
      (item): item is GlobalBoosterActivationLogEntry =>
        Boolean(item) &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        Number.isFinite(Number((item as Record<string, unknown>).timestamp)) &&
        typeof (item as Record<string, unknown>).boosterId === 'string',
    );
    return entries.slice(-safeLimit).reverse();
  } catch {
    return [];
  }
}

export async function clearGlobalBoosterActivationLog(): Promise<void> {
  // DEL is allowed during Redis storage-quota enforcement; SET is not.
  await redis.del(GLOBAL_BOOSTER_ACTIVATION_LOG_KEY);
}

/**
 * Emergency cleanup for diagnostic history only. Uses DEL (quota-safe) and
 * the existing player registry to remove per-player Player Spy traces.
 * Player saves, combat saves, Codex shards, and progression are never touched.
 */
export async function clearAllDiagnosticLogs(): Promise<{
  sharedLogKeysDeleted: number;
  playerSpyLogsDeleted: number;
}> {
  const sharedLogKeys = [
    SAVE_DEBUG_LOG_KEY,
    PAYMENT_DEBUG_LOG_KEY,
    GLOBAL_BOOSTER_DEBUG_LOG_KEY,
    GLOBAL_BOOSTER_ACTIVATION_LOG_KEY,
  ];
  const sharedDeleteResults = await Promise.all(sharedLogKeys.map(keyName => redis.del(keyName)));
  let playerSpyLogsDeleted = 0;

  // Redis does not support global key scans. The player registry is our known
  // index for the per-user Player Spy log keys, so delete only those exact keys.
  const userIds = await redis.hKeys(PLAYER_REGISTRY_KEY);
  for (let offset = 0; offset < userIds.length; offset += 25) {
    const deleteResults = await Promise.all(
      userIds.slice(offset, offset + 25).map(userId => redis.del(playerSpyKey(userId))),
    );
    playerSpyLogsDeleted += deleteResults.filter(Boolean).length;
  }

  return {
    sharedLogKeysDeleted: sharedDeleteResults.filter(Boolean).length,
    playerSpyLogsDeleted,
  };
}
export interface DeveloperAnnouncement {
  message: string;
  updatedAt: number;
  updatedBy: string;
}
export const DEFAULT_DEVELOPER_ANNOUNCEMENT = '';

export interface GlobalMenuControl {
  enabled: boolean;
  reason: string;
  updatedAt: number;
  updatedBy: string;
}

const DEFAULT_GLOBAL_MENU_CONTROL: GlobalMenuControl = {
  enabled: true,
  reason: '',
  updatedAt: 0,
  updatedBy: '',
};

export async function getGlobalMenuControl(): Promise<GlobalMenuControl> {
  const raw = await redis.get(GLOBAL_MENU_CONTROL_KEY);
  if (!raw) return { ...DEFAULT_GLOBAL_MENU_CONTROL };
  const parsed = parseStoredJson<Partial<GlobalMenuControl>>(raw);
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_GLOBAL_MENU_CONTROL };
  return {
    enabled: parsed.enabled !== false,
    reason: String(parsed.reason ?? '').slice(0, 300),
    updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Math.max(0, Number(parsed.updatedAt)) : 0,
    updatedBy: String(parsed.updatedBy ?? '').slice(0, 100),
  };
}

export async function setGlobalMenuControl(
  enabled: boolean,
  reason: string,
  updatedBy: string,
): Promise<GlobalMenuControl> {
  const next: GlobalMenuControl = {
    enabled: enabled === true,
    reason: enabled === true
      ? ''
      : String(reason ?? '').trim().slice(0, 300) || 'The developer has disabled the menus.',
    updatedAt: Date.now(),
    updatedBy: String(updatedBy ?? context.username ?? 'Developer').slice(0, 100),
  };
  await redis.set(GLOBAL_MENU_CONTROL_KEY, JSON.stringify(next));
  return next;
}


export interface GlobalFeatureControl {
  feature: GlobalFeatureId;
  enabled: boolean;
  reason: string;
  updatedAt: number;
  updatedBy: string;
}

export async function getGlobalFeatureControl(feature: GlobalFeatureId): Promise<GlobalFeatureControl> {
  const definition = GLOBAL_FEATURES.find(item => item.id === feature);
  if (!definition) throw new Error('Unknown global feature control.');
  const fallback: GlobalFeatureControl = { feature, enabled: true, reason: '', updatedAt: 0, updatedBy: '' };
  const raw = await redis.get(GLOBAL_FEATURE_CONTROL_KEY_PREFIX + feature);
  if (!raw) return fallback;
  const parsed = parseStoredJson<Partial<GlobalFeatureControl>>(raw);
  if (!parsed || typeof parsed !== 'object') return fallback;
  return {
    feature,
    enabled: parsed.enabled !== false,
    reason: String(parsed.reason ?? '').slice(0, 300),
    updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Math.max(0, Number(parsed.updatedAt)) : 0,
    updatedBy: String(parsed.updatedBy ?? '').slice(0, 100),
  };
}

export async function getGlobalFeatureControls(): Promise<Record<GlobalFeatureId, GlobalFeatureControl>> {
  const controls = await Promise.all(GLOBAL_FEATURES.map(item => getGlobalFeatureControl(item.id)));
  return Object.fromEntries(controls.map(control => [control.feature, control])) as Record<GlobalFeatureId, GlobalFeatureControl>;
}

export async function setGlobalFeatureControl(
  feature: GlobalFeatureId,
  enabled: boolean,
  reason: string,
  updatedBy: string,
): Promise<GlobalFeatureControl> {
  const definition = GLOBAL_FEATURES.find(item => item.id === feature);
  if (!definition) throw new Error('Unknown global feature control.');
  const next: GlobalFeatureControl = {
    feature,
    enabled: enabled === true,
    reason: enabled === true
      ? ''
      : String(reason ?? '').trim().slice(0, 300) || 'The developer has disabled ' + definition.label.toLowerCase() + '.',
    updatedAt: Date.now(),
    updatedBy: String(updatedBy ?? context.username ?? 'Developer').slice(0, 100),
  };
  await redis.set(GLOBAL_FEATURE_CONTROL_KEY_PREFIX + feature, JSON.stringify(next));
  return next;
}


export interface LiveBalanceHistoryEntry {
  revision: number;
  action: 'set' | 'reset' | 'reset-all' | 'rollback';
  key: string | null;
  before: LiveBalanceConfig;
  after: LiveBalanceConfig;
  updatedAt: number;
  updatedBy: string;
  rollbackOf?: number;
}

export interface LiveBalanceState {
  revision: number;
  values: LiveBalanceConfig;
  history: LiveBalanceHistoryEntry[];
}

export interface LiveBalanceSnapshot {
  revision: number;
  values: LiveBalanceConfig;
  updatedAt: number;
  updatedBy: string;
}

const LIVE_BALANCE_HISTORY_LIMIT = 30;

function normalizeLiveBalanceHistory(value: unknown): LiveBalanceHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-LIVE_BALANCE_HISTORY_LIMIT).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    const revision = Number(entry.revision);
    const action = entry.action;
    const updatedAt = Number(entry.updatedAt);
    if (
      !Number.isSafeInteger(revision) || revision < 1 ||
      !['set', 'reset', 'reset-all', 'rollback'].includes(String(action)) ||
      !Number.isFinite(updatedAt) || updatedAt < 0
    ) return [];
    return [{
      revision,
      action: action as LiveBalanceHistoryEntry['action'],
      key: typeof entry.key === 'string' ? entry.key.slice(0, 100) : null,
      before: normalizeLiveBalanceConfig(entry.before),
      after: normalizeLiveBalanceConfig(entry.after),
      updatedAt,
      updatedBy: String(entry.updatedBy ?? '').slice(0, 100),
      ...(Number.isSafeInteger(Number(entry.rollbackOf)) && Number(entry.rollbackOf) > 0
        ? { rollbackOf: Number(entry.rollbackOf) }
        : {}),
    }];
  });
}

function normalizeLiveBalanceState(value: unknown): LiveBalanceState {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const revision = Number(candidate.revision);
  return {
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    values: normalizeLiveBalanceConfig(candidate.values),
    history: normalizeLiveBalanceHistory(candidate.history),
  };
}

export async function getLiveBalanceState(): Promise<LiveBalanceState> {
  const raw = await redis.get(LIVE_BALANCE_CONFIG_KEY);
  return normalizeLiveBalanceState(parseStoredJson<unknown>(raw));
}

export async function getLiveBalanceConfig(): Promise<LiveBalanceConfig> {
  return (await getLiveBalanceState()).values;
}

export async function getLiveBalanceSnapshot(): Promise<LiveBalanceSnapshot> {
  const state = await getLiveBalanceState();
  const latest = state.history[state.history.length - 1];
  return {
    revision: state.revision,
    values: state.values,
    updatedAt: latest?.updatedAt ?? 0,
    updatedBy: latest?.updatedBy ?? '',
  };
}

async function mutateLiveBalanceState(
  action: LiveBalanceHistoryEntry['action'],
  key: string | null,
  updatedBy: string,
  transform: (current: LiveBalanceConfig, history: LiveBalanceHistoryEntry[]) => LiveBalanceConfig,
  rollbackOf?: number,
): Promise<{ state: LiveBalanceState; changed: boolean }> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const txn = await redis.watch(LIVE_BALANCE_CONFIG_KEY);
    let transactionClosed = false;
    try {
      const raw = await redis.get(LIVE_BALANCE_CONFIG_KEY);
      const current = normalizeLiveBalanceState(parseStoredJson<unknown>(raw));
      const nextValues = normalizeLiveBalanceConfig(transform(current.values, current.history));
      const before = current.values;
      if (LIVE_BALANCE_SETTINGS.every(setting => before[setting.key] === nextValues[setting.key])) {
        await txn.unwatch();
        transactionClosed = true;
        return { state: current, changed: false };
      }
      if (current.revision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Live balance revision limit reached. No change was applied.');
      }
      const nextRevision = current.revision + 1;
      const entry: LiveBalanceHistoryEntry = {
        revision: nextRevision,
        action,
        key,
        before: { ...before },
        after: { ...nextValues },
        updatedAt: Date.now(),
        updatedBy: String(updatedBy || context.username || 'Developer').slice(0, 100),
        ...(rollbackOf ? { rollbackOf } : {}),
      };
      const nextState: LiveBalanceState = {
        revision: nextRevision,
        values: nextValues,
        history: [...current.history, entry].slice(-LIVE_BALANCE_HISTORY_LIMIT),
      };
      await txn.multi();
      await txn.set(LIVE_BALANCE_CONFIG_KEY, JSON.stringify(nextState));
      const committed = await txn.exec();
      transactionClosed = true;
      if (committed !== null) return { state: nextState, changed: true };
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
    }
  }
  throw new Error('Live balance configuration changed repeatedly. No update was committed; retry the command.');
}

export async function executeLiveBalanceCommand(
  command: Extract<ParsedAdminCliCommand, { kind: 'balance' }>,
  updatedBy = context.username ?? 'Developer',
): Promise<Record<string, unknown>> {
  const state = await getLiveBalanceState();
  if (command.action === 'list') {
    return {
      action: 'list',
      revision: state.revision,
      settings: LIVE_BALANCE_SETTINGS.map(setting => ({
        ...setting,
        value: state.values[setting.key],
        isDefault: state.values[setting.key] === setting.defaultValue,
      })),
    };
  }
  if (command.action === 'history') {
    return {
      action: 'history',
      revision: state.revision,
      history: state.history.map(entry => ({
        revision: entry.revision,
        action: entry.action,
        key: entry.key,
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy,
        rollbackOf: entry.rollbackOf ?? null,
      })),
    };
  }
  if (command.action === 'get' || command.action === 'preview') {
    const setting = getLiveBalanceSetting(command.key);
    if (!setting) throw new Error('Unknown balance setting "' + command.key + '".');
    return {
      action: command.action,
      revision: state.revision,
      setting: {
        ...setting,
        value: state.values[setting.key],
        ...(command.action === 'preview'
          ? {
              proposedValue: validateLiveBalanceValue(setting.key, command.value),
              changed: state.values[setting.key] !== command.value,
            }
          : {}),
      },
    };
  }
  if (command.action === 'set') {
    const value = validateLiveBalanceValue(command.key, command.value);
    const result = await mutateLiveBalanceState('set', command.key, updatedBy, current => ({
      ...current,
      [command.key]: value,
    }));
    return {
      action: 'set',
      changed: result.changed,
      revision: result.state.revision,
      key: command.key,
      previousValue: state.values[command.key as keyof LiveBalanceConfig],
      value: result.state.values[command.key as keyof LiveBalanceConfig],
      updatedAt: result.state.history[result.state.history.length - 1]?.updatedAt ?? 0,
    };
  }
  if (command.action === 'reset') {
    const setting = getLiveBalanceSetting(command.key);
    if (!setting) throw new Error('Unknown balance setting "' + command.key + '".');
    const result = await mutateLiveBalanceState('reset', setting.key, updatedBy, current => ({
      ...current,
      [setting.key]: setting.defaultValue,
    }));
    return {
      action: 'reset',
      changed: result.changed,
      revision: result.state.revision,
      key: setting.key,
      value: result.state.values[setting.key],
    };
  }
  if (command.action === 'reset-all') {
    const result = await mutateLiveBalanceState('reset-all', null, updatedBy, () => ({
      ...DEFAULT_LIVE_BALANCE_CONFIG,
    }));
    return {
      action: 'reset-all',
      changed: result.changed,
      revision: result.state.revision,
      values: result.state.values,
    };
  }
  if (command.action === 'rollback') {
    const target = state.history.find(entry => entry.revision === command.revision);
    if (!target) throw new Error('Balance revision ' + command.revision + ' is not in the retained history.');
    const result = await mutateLiveBalanceState('rollback', null, updatedBy, () => ({
      ...target.before,
    }), command.revision);
    return {
      action: 'rollback',
      changed: result.changed,
      revision: result.state.revision,
      rolledBackRevision: command.revision,
      values: result.state.values,
    };
  }
  throw new Error('Unsupported balance command.');
}

export async function getDeveloperAnnouncement(): Promise<DeveloperAnnouncement> {
  const raw = await redis.get(DEVELOPER_ANNOUNCEMENT_KEY);
  if (!raw) {
    return { message: DEFAULT_DEVELOPER_ANNOUNCEMENT, updatedAt: 0, updatedBy: '' };
  }

  const parsed = parseStoredJson<Partial<DeveloperAnnouncement>>(raw);
  if (!parsed) {
    return { message: DEFAULT_DEVELOPER_ANNOUNCEMENT, updatedAt: 0, updatedBy: '' };
  }

  return {
    message: String(parsed.message ?? DEFAULT_DEVELOPER_ANNOUNCEMENT).slice(0, 1200),
    updatedAt: Number(parsed.updatedAt ?? 0) || 0,
    updatedBy: String(parsed.updatedBy ?? '').slice(0, 100),
  };
}

export async function setDeveloperAnnouncement(message: string, updatedBy: string): Promise<DeveloperAnnouncement> {
  const next: DeveloperAnnouncement = {
    message: String(message ?? '').trim().slice(0, 1200),
    updatedAt: Date.now(),
    updatedBy: String(updatedBy ?? context.username ?? 'Developer').slice(0, 100),
  };
  await redis.set(DEVELOPER_ANNOUNCEMENT_KEY, JSON.stringify(next));
  return next;
}


function saveGenerationKeyFor(userId: string): string {
  return SAVE_GENERATION_KEY_PREFIX + userId;
}

function parseStoredJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(decompressStorageString(raw)) as T;
  } catch {
    return null;
  }
}

interface FrenzyPostRecord {
  ownerId: string;
  ownerUsername: string;
  rarity: number;
  isInfinity?: boolean;
  subredditName: string;
  adminTest?: boolean;
  inGame?: boolean;
  createdAt: number;
  expiresAt?: number;
  consumedAt?: number | null;
  consumedBy?: string;
}

/** Validate stored Frenzy metadata before it can authorize a preview or award. */
function parseFrenzyPostRecord(raw: unknown): FrenzyPostRecord | null {
  const record = parseStoredJson<Record<string, any>>(raw);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const now = Date.now();
  if (typeof record.ownerId !== 'string' || !record.ownerId.trim()) return null;
  if (typeof record.ownerUsername !== 'string' || !record.ownerUsername.trim()) return null;
  if (typeof record.subredditName !== 'string' || !record.subredditName.trim()) return null;
  if (!Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || record.createdAt > now) return null;
  if (!Number.isInteger(record.rarity) || record.rarity < 2 || record.rarity > MAX_ORB_RARITY) return null;
  if (record.isInfinity !== undefined && typeof record.isInfinity !== 'boolean') return null;
  if (record.isInfinity === true && record.rarity !== MAX_ORB_RARITY) return null;
  if (record.expiresAt !== undefined &&
      (!Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.createdAt)) return null;
  if (record.adminTest !== undefined && typeof record.adminTest !== 'boolean') return null;
  if (record.inGame !== undefined && typeof record.inGame !== 'boolean') return null;
  if (record.consumedAt !== undefined && record.consumedAt !== null &&
      (!Number.isSafeInteger(record.consumedAt) || record.consumedAt < 0)) return null;
  if (record.consumedBy !== undefined && typeof record.consumedBy !== 'string') return null;
  return record as FrenzyPostRecord;
}

function isFrenzyPostRecordExpired(post: Pick<FrenzyPostRecord, 'createdAt' | 'expiresAt'>, now = Date.now()): boolean {
  const expiresAt = post.expiresAt ?? frenzyPostExpiresAt(post.createdAt);
  return !Number.isSafeInteger(expiresAt) || expiresAt <= now;
}

async function ensureRedisStringKey(keyName: string, fallback: string): Promise<void> {
  const existing = await redis.get(keyName);
  if (existing == null) {
    // Another request may initialize this key after our GET. NX prevents this
    // fallback write from overwriting a real value created in that interval.
    await redis.set(keyName, fallback, { nx: true });
  }
}


async function readGameBans(): Promise<Record<string, GameBanRecord>> {
  return parseGameBanRegistry(await redis.get(GAME_BANS_KEY));
}

async function mutateGameBans<T>(
  update: (bans: Record<string, GameBanRecord>) => { changed: boolean; result: T },
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const txn = await redis.watch(GAME_BANS_KEY);
    const raw = await redis.get(GAME_BANS_KEY);
    let bans: Record<string, GameBanRecord>;
    try {
      // Only a truly absent key is an empty registry. A present empty string,
      // malformed JSON, or malformed row must fail closed instead of clearing
      // bans or letting the request proceed as if every user were unbanned.
      bans = parseGameBanRegistry(raw);
    } catch (error) {
      await txn.unwatch();
      throw error;
    }

    const outcome = update(bans);
    if (!outcome.changed) {
      await txn.unwatch();
      return outcome.result;
    }

    await txn.multi();
    await txn.set(GAME_BANS_KEY, JSON.stringify(bans));
    const committed = await txn.exec();
    if (committed !== null) return outcome.result;
  }

  throw new Error('Game ban list changed too frequently. Please retry.');
}

export async function getGameBanStatus(userId = context.userId ?? ''): Promise<GameBanStatus | null> {
  if (!userId) return null;
  // Ban verification is on the hot path for every gameplay request. Keep it a
  // single Redis read; a WATCH/MULTI transaction is only needed when an admin
  // actually changes or lists the registry.
  const raw = await redis.get(GAME_BANS_KEY);
  return parseGameBanStatus(raw, userId);
}

export async function listGameBans(): Promise<GameBanRecord[]> {
  const now = Date.now();
  return mutateGameBans(bans => {
    let changed = false;
    const active: GameBanRecord[] = [];

    for (const [userId, ban] of Object.entries(bans)) {
      if (ban.bannedUntil !== null && ban.bannedUntil <= now) {
        delete bans[userId];
        changed = true;
        continue;
      }
      active.push(ban);
    }

    return {
      changed,
      result: active.sort((a, b) => b.bannedAt - a.bannedAt),
    };
  });
}

export async function banGameUser(options: {
  userId: string;
  username: string;
  durationDays?: number;
  reason?: string;
  bannedBy?: string;
}): Promise<GameBanStatus> {
  const userId = String(options.userId ?? '').trim();
  const username = String(options.username ?? '').trim().replace(/^u\//i, '');
  if (!userId || !username) {
    throw new Error('A valid game user ID and Reddit username are required.');
  }

  let durationDays: number | null = null;
  if (options.durationDays != null) {
    const requestedDays = Number(options.durationDays);
    const maximumDateMs = 8_640_000_000_000_000;
    const now = Date.now();
    const maximumDays = Math.floor((maximumDateMs - now) / 86_400_000);
    if (
      !Number.isSafeInteger(requestedDays) ||
      requestedDays < 1 ||
      requestedDays > maximumDays
    ) {
      throw new Error('Ban duration must be a positive, safely representable number of days.');
    }
    durationDays = requestedDays;
  }

  const bannedAt = Date.now();
  const bannedUntil = durationDays === null ? null : bannedAt + durationDays * 86_400_000;
  if (
    bannedUntil !== null &&
    (!Number.isSafeInteger(bannedUntil) || bannedUntil <= bannedAt || bannedUntil > 8_640_000_000_000_000)
  ) {
    throw new Error('Ban expiry is outside the supported date range.');
  }
  const ban: GameBanRecord = {
    userId,
    username,
    bannedAt,
    bannedUntil,
    reason: String(options.reason ?? 'Game moderation action').slice(0, 300),
    bannedBy: String(options.bannedBy ?? context.username ?? 'Admin').slice(0, 100),
  };
  return mutateGameBans(bans => {
    bans[userId] = ban;
    return { changed: true, result: { ...ban, active: true } };
  });
}

export async function unbanGameUser(userId: string): Promise<boolean> {
  return mutateGameBans(bans => {
    if (!bans[userId]) return { changed: false, result: false };
    delete bans[userId];
    return { changed: true, result: true };
  });
}
const ONLINE_WINDOW_MS = 3 * 60_000;
const PLAYER_ACTIVE_WINDOW_MS = 90_000;

async function updateCcuPeak(keyName: string, ccu: number): Promise<void> {
  const candidate = Math.max(0, Math.floor(Number(ccu) || 0));
  for (let attempt = 0; attempt < 8; attempt++) {
    const txn = await redis.watch(keyName);
    const current = Math.max(
      0,
      Number.parseInt(String(await redis.get(keyName) ?? '0'), 10) || 0,
    );
    if (candidate <= current) {
      await txn.unwatch();
      return;
    }

    await txn.multi();
    await txn.set(keyName, String(candidate));
    const committed = await txn.exec();
    if (committed !== null) return;
  }

  throw new Error('CCU peak changed too frequently to update safely.');
}

async function recordCcuPeak(ccu: number, now: number): Promise<void> {
  const hour = Math.floor(now / 3_600_000);
  const hourKey = CCU_HOURLY_PREFIX + String(hour);

  // WATCH keeps these values monotonic. Plain GET-then-SET let an older,
  // lower concurrent sample overwrite a peak that had just been recorded.
  await updateCcuPeak(hourKey, ccu);
  await updateCcuPeak(CCU_ALL_TIME_KEY, ccu);
}

async function readOnlinePresenceCount(now = Date.now()): Promise<number> {
  // Polling only prunes stale IDs. It doesn't keep every polling tab marked online.
  await redis.zRemRangeByScore(ONLINE_PLAYERS_KEY, 0, now - ONLINE_WINDOW_MS);
  const ccu = Math.max(0, await redis.zCard(ONLINE_PLAYERS_KEY));
  void recordCcuPeak(ccu, now).catch(error => {
    console.error('Failed to record CCU peak:', error);
  });
  return ccu;
}

async function touchOnlinePresence(): Promise<number> {
  const userId = String(context.userId ?? '').trim();
  if (!userId) return readOnlinePresenceCount();
  const now = Date.now();
  await redis.zAdd(ONLINE_PLAYERS_KEY, { member: userId, score: now });
  return readOnlinePresenceCount(now);
}

export async function getOnlinePlayers(): Promise<number> {
  return readOnlinePresenceCount();
}

export async function sendPushNotificationTest(): Promise<void> {
  const userId = currentUserId();
  if (!(await notifications.isOptedIn(userId))) {
    throw new Error('Enable at least one Infinity Orbs notification type first, then run the push test.');
  }
  const slot = await reserveNotificationDailySendSlot(userId);
  if (!slot.allowed) {
    throw new Error('This account has already received two push notifications today. The test can be sent after the next UTC day begins.');
  }
  const subredditName = String(context.subredditName ?? '').trim();
  await notifications.enqueue({
    title: 'Infinity Orbs Test',
    body: 'Push notifications are working.',
    recipients: [{
      userId,
      ...(subredditName ? { link: `https://reddit.com/r/${subredditName}` } : {}),
    }],
  });
}


async function markNotificationAttributionPending(
  userId: string,
  source: NotificationAttributionSource,
  sentAt = Date.now(),
): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  return withPlayerMutationLockFor(`activity:${id}`, async () => {
    const raw = await redis.hGet(PLAYER_REGISTRY_KEY, id);
    if (typeof raw !== 'string' || !raw) return false;
    const now = Date.now();
    let entry: Partial<PlayerRegistryEntry>;
    try {
      entry = parsePlayerRegistryEntryForMutation(raw, now);
    } catch (error) {
      console.warn('[Notification Attribution] Skipped malformed player registry entry.', error);
      return false;
    }
    const lastSeenAt = validPastTimestamp(entry.lastSeenAt, now);
    if (lastSeenAt >= sentAt - PLAYER_ACTIVE_WINDOW_MS || lastSeenAt >= sentAt) return false;
    const previousPendingAt = validPastTimestamp(entry.notificationPendingAt, now);
    if (previousPendingAt > sentAt) return false;
    await redis.hSet(PLAYER_REGISTRY_KEY, {
      [id]: JSON.stringify({
        ...entry,
        username: String(entry.username ?? '').trim().slice(0, 100),
        firstSeenAt: validPastTimestamp(entry.firstSeenAt, now),
        lastSeenAt,
        notificationPendingSource: source,
        notificationPendingAt: sentAt,
      } satisfies PlayerRegistryEntry),
    });
    return true;
  });
}

export interface NotificationPreferences {
  updates: boolean;
  offlineOrbs: boolean;
}

export interface NotificationPreferenceState {
  enabled: boolean;
  preferences: NotificationPreferences;
}

function notificationPreferencesKey(userId: string): string {
  return NOTIFICATION_PREFERENCES_PREFIX + userId;
}

function parseNotificationPreferences(
  raw: unknown,
  fallback: NotificationPreferences = { updates: true, offlineOrbs: true },
): NotificationPreferences {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return { ...fallback }; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  const record = value as Record<string, unknown>;
  return {
    updates: typeof record.updates === 'boolean' ? record.updates : fallback.updates,
    offlineOrbs: typeof record.offlineOrbs === 'boolean' ? record.offlineOrbs : fallback.offlineOrbs,
  };
}

async function readStoredNotificationPreferences(
  userId: string,
  fallback: NotificationPreferences = { updates: true, offlineOrbs: true },
): Promise<NotificationPreferences> {
  return parseNotificationPreferences(await redis.get(notificationPreferencesKey(userId)), fallback);
}

async function filterNotificationRecipients(
  userIds: string[],
  type: keyof NotificationPreferences,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const stored = await readInBatches(
    userIds.map(notificationPreferencesKey),
    keys => redis.mGet(keys),
  );
  return userIds.filter((userId, index) =>
    parseNotificationPreferences(stored[index], { updates: true, offlineOrbs: true })[type],
  );
}

async function isNotificationPreferenceEnabled(
  userId: string,
  type: keyof NotificationPreferences,
): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id || !(await notifications.isOptedIn(id))) return false;
  const preferences = await readStoredNotificationPreferences(id, { updates: true, offlineOrbs: true });
  return preferences[type];
}

export async function getNotificationPreferences(userId = currentUserId()): Promise<NotificationPreferenceState> {
  const id = String(userId ?? '').trim();
  if (!id) return { enabled: false, preferences: { updates: false, offlineOrbs: false } };
  const enabled = await notifications.isOptedIn(id);
  const preferences = enabled
    ? await readStoredNotificationPreferences(id, { updates: true, offlineOrbs: true })
    : { updates: false, offlineOrbs: false };
  return { enabled, preferences };
}

export async function setNotificationPreferences(input: {
  updates?: unknown;
  offlineOrbs?: unknown;
}): Promise<NotificationPreferenceState> {
  const userId = currentUserId();
  if (!userId) throw new Error('Could not identify your Reddit account.');

  const current = await getNotificationPreferences(userId);
  const preferences: NotificationPreferences = {
    updates: input.updates === undefined ? current.preferences.updates : input.updates === true,
    offlineOrbs: input.offlineOrbs === undefined ? current.preferences.offlineOrbs : input.offlineOrbs === true,
  };
  const shouldBeEnabled = preferences.updates || preferences.offlineOrbs;
  const wasEnabled = await notifications.isOptedIn(userId);

  if (shouldBeEnabled && !wasEnabled) await notifications.optInCurrentUser();
  if (!shouldBeEnabled && wasEnabled) await notifications.optOutCurrentUser();

  const enabled = await notifications.isOptedIn(userId);
  if (shouldBeEnabled && !enabled) {
    throw new Error('Reddit did not confirm notification opt-in. Please try again.');
  }

  await redis.set(notificationPreferencesKey(userId), JSON.stringify(preferences));
  return {
    enabled,
    preferences: enabled ? preferences : { updates: false, offlineOrbs: false },
  };
}

function notificationDailyWindow(now = Date.now()): { day: string; resetsAt: number } {
  const date = new Date(now);
  const resetsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return { day: date.toISOString().slice(0, 10), resetsAt };
}

function notificationDailySendKey(userId: string, day: string): string {
  return NOTIFICATION_DAILY_SEND_PREFIX + day + ':' + userId;
}

/**
 * Reserve one of the two daily Reddit push slots before calling the provider.
 * A per-user mutation lock serializes Offline Orbs and Game Update sends so
 * the two notification types share the same installation-level daily budget.
 */
async function reserveNotificationDailySendSlot(
  userId: string,
  now = Date.now(),
): Promise<{ allowed: boolean; count: number; resetsAt: number }> {
  const id = String(userId ?? '').trim();
  if (!id) return { allowed: false, count: NOTIFICATION_DAILY_SEND_LIMIT, resetsAt: notificationDailyWindow(now).resetsAt };
  return withPlayerMutationLockFor(`notification-daily-budget:${id}`, async () => {
    const { day, resetsAt } = notificationDailyWindow(now);
    const key = notificationDailySendKey(id, day);
    const current = Number(await redis.get(key) ?? 0);
    const count = Number.isSafeInteger(current) && current > 0 ? current : 0;
    if (count >= NOTIFICATION_DAILY_SEND_LIMIT) {
      return { allowed: false, count, resetsAt };
    }
    await redis.set(key, String(count + 1), { expiration: new Date(resetsAt + 2 * 24 * 60 * 60_000) });
    return { allowed: true, count: count + 1, resetsAt };
  });
}

function isNotificationDailyLimitError(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const response = record.response && typeof record.response === 'object'
    ? record.response as Record<string, unknown>
    : {};
  const status = Number(record.status ?? record.statusCode ?? response.status ?? 0);
  const detail = [
    error instanceof Error ? error.message : String(error ?? ''),
    String(record.code ?? ''),
    String(record.name ?? ''),
  ].join(' ');
  return status === 429 || /\\b429\\b|rate.?limit|daily.{0,40}(limit|quota)|notification.{0,50}(limit|quota)|maximum.{0,30}(notification|push)/i.test(detail);
}

async function markNotificationDailyLimitReached(userId: string, now = Date.now()): Promise<void> {
  const id = String(userId ?? '').trim();
  if (!id) return;
  await withPlayerMutationLockFor(`notification-daily-budget:${id}`, async () => {
    const { day, resetsAt } = notificationDailyWindow(now);
    await redis.set(
      notificationDailySendKey(id, day),
      String(NOTIFICATION_DAILY_SEND_LIMIT),
      { expiration: new Date(resetsAt + 2 * 24 * 60 * 60_000) },
    );
  });
}


interface PendingGameUpdate {
  campaignId: string;
  title: string;
  body: string;
  link: string;
  queuedAt: number;
}

function parsePendingGameUpdates(raw: unknown, now = Date.now()): PendingGameUpdate[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingGameUpdate =>
      !!item &&
      typeof item === 'object' &&
      typeof item.campaignId === 'string' &&
      typeof item.title === 'string' &&
      typeof item.body === 'string' &&
      typeof item.link === 'string' &&
      Number.isSafeInteger(item.queuedAt) &&
      item.queuedAt > 0 &&
      item.queuedAt >= now - NOTIFICATION_PENDING_UPDATE_MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}

async function queueGameUpdateForUser(userId: string, item: PendingGameUpdate): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  const added = await withPlayerMutationLockFor(`notification-update-queue:${id}`, async () => {
    const current = parsePendingGameUpdates(await redis.hGet(NOTIFICATION_PENDING_UPDATE_HASH, id));
    if (current.some(entry => entry.campaignId === item.campaignId)) return false;
    current.push(item);
    await redis.hSet(NOTIFICATION_PENDING_UPDATE_HASH, { [id]: JSON.stringify(current) });
    return true;
  });
  if (added) await schedulePendingGameUpdateDrain(nextUtcNotificationDay());
  return added;
}

function nextUtcNotificationDay(now = Date.now()): number {
  return notificationDailyWindow(now).resetsAt + 1_000;
}

async function deletePendingGameUpdateJobMarkerIfUnchanged(expected: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(NOTIFICATION_PENDING_UPDATE_JOB_KEY);
    const current = await redis.get(NOTIFICATION_PENDING_UPDATE_JOB_KEY);
    if (current == null || String(current) !== expected) {
      await txn.unwatch();
      return false;
    }
    await txn.multi();
    await txn.del(NOTIFICATION_PENDING_UPDATE_JOB_KEY);
    if (await txn.exec() !== null) return true;
  }
  return false;
}

async function schedulePendingGameUpdateDrain(
  runAt = nextUtcNotificationDay(),
  cursor = '',
): Promise<void> {
  const existing = await redis.get(NOTIFICATION_PENDING_UPDATE_JOB_KEY);
  if (existing) return;

  const safeRunAt = Math.max(Date.now() + 1_000, runAt);
  const token = secureServerToken('update-queue');
  const reservation = JSON.stringify({ token, runAt: safeRunAt, cursor });
  const reserved = await redis.set(NOTIFICATION_PENDING_UPDATE_JOB_KEY, reservation, {
    nx: true,
    expiration: new Date(safeRunAt + 7 * 24 * 60 * 60_000),
  });
  if (reserved !== 'OK') return;

  try {
    await scheduler.runJob({
      name: 'pending-game-update-drain',
      data: { token, cursor },
      runAt: new Date(safeRunAt),
    });
  } catch (error) {
    await deletePendingGameUpdateJobMarkerIfUnchanged(reservation).catch(() => false);
    throw error;
  }
}

export async function processPendingGameUpdateQueue(input: {
  token: unknown;
  cursor: unknown;
}): Promise<void> {
  const token = String(input.token ?? '').trim();
  const cursor = String(input.cursor ?? '');
  if (!token) return;
  const markerRaw = await redis.get(NOTIFICATION_PENDING_UPDATE_JOB_KEY);
  if (typeof markerRaw !== 'string') return;
  let marker: { token?: string; cursor?: string };
  try { marker = JSON.parse(markerRaw); } catch { return; }
  if (marker.token !== token || String(marker.cursor ?? '') !== cursor) return;

  const allQueued = await redis.hGetAll(NOTIFICATION_PENDING_UPDATE_HASH);
  const orderedIds = Object.keys(allQueued)
    .filter(id => id && id > cursor)
    .sort()
    .slice(0, NOTIFICATION_PENDING_UPDATE_BATCH_SIZE);
  const processedAt = Date.now();

  for (const userId of orderedIds) {
    await withPlayerMutationLockFor(`notification-update-queue:${userId}`, async () => {
      const items = parsePendingGameUpdates(await redis.hGet(NOTIFICATION_PENDING_UPDATE_HASH, userId), processedAt);
      if (items.length === 0) {
        await redis.hDel(NOTIFICATION_PENDING_UPDATE_HASH, userId);
        return;
      }
      if (
        !(await notifications.isOptedIn(userId)) ||
        !(await isNotificationPreferenceEnabled(userId, 'updates'))
      ) {
        await redis.hDel(NOTIFICATION_PENDING_UPDATE_HASH, userId);
        return;
      }

      const remaining: PendingGameUpdate[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const slot = await reserveNotificationDailySendSlot(userId);
        if (!slot.allowed) {
          remaining.push(...items.slice(index));
          break;
        }
        try {
          await notifications.enqueue({
            title: item.title,
            body: item.body,
            recipients: [{ userId, link: item.link }],
          });
          await markNotificationAttributionPending(userId, 'manual', Date.now()).catch(error => {
            console.warn('[Notification Broadcast] Could not record queued update attribution.', error);
          });
        } catch (error) {
          if (isNotificationDailyLimitError(error)) {
            await markNotificationDailyLimitReached(userId);
          }
          // Keep a failed or ambiguous item for the next daily window. The
          // reserved slot stays consumed to avoid exceeding Reddit's limit.
          console.warn('[Notification Broadcast] Queued update send failed; retaining it for retry.', userId, error);
          remaining.push(...items.slice(index));
          break;
        }
      }

      if (remaining.length > 0) {
        await redis.hSet(NOTIFICATION_PENDING_UPDATE_HASH, { [userId]: JSON.stringify(remaining) });
      } else {
        await redis.hDel(NOTIFICATION_PENDING_UPDATE_HASH, userId);
      }
    });
  }

  await deletePendingGameUpdateJobMarkerIfUnchanged(markerRaw);
  const pendingAfter = await redis.hGetAll(NOTIFICATION_PENDING_UPDATE_HASH);
  const remainingIds = Object.keys(pendingAfter).sort();
  if (remainingIds.length === 0) return;

  const hasMoreAfterPage = orderedIds.length === NOTIFICATION_PENDING_UPDATE_BATCH_SIZE &&
    remainingIds.some(id => id > (orderedIds[orderedIds.length - 1] ?? cursor));
  if (hasMoreAfterPage) {
    await schedulePendingGameUpdateDrain(Date.now() + 65_000, orderedIds[orderedIds.length - 1] ?? cursor);
  } else {
    // All currently queued players have been checked. Any remaining entries
    // have exhausted today's allowance, so resume immediately after UTC day reset.
    await schedulePendingGameUpdateDrain(nextUtcNotificationDay(), '');
  }
}


export async function getNotificationStats(): Promise<{
  optedInPlayers: number;
  updatesEnabledPlayers: number;
  offlineOrbsEnabledPlayers: number;
  totalPlayers: number;
  percentage: number;
  updatesPercentage: number;
  offlineOrbsPercentage: number;
}> {
  const registry = await redis.hGetAll(PLAYER_REGISTRY_KEY);
  const seenCursors = new Set<string>();
  const seenUsers = new Set<string>();
  let cursor = '';
  let updatesEnabledPlayers = 0;
  let offlineOrbsEnabledPlayers = 0;

  for (let pageIndex = 0; pageIndex < 10_000; pageIndex += 1) {
    const page = await notifications.listOptedInUsers({
      ...(cursor ? { after: cursor } : {}),
      limit: 1_000,
    }) as { userIds?: unknown; next?: unknown };
    const ids = Array.isArray(page?.userIds)
      ? Array.from(new Set(page.userIds.filter((id): id is string =>
          typeof id === 'string' && id.trim().length > 0 && !seenUsers.has(id),
        )))
      : [];
    for (const id of ids) seenUsers.add(id);

    const stored = await readInBatches(
      ids.map(notificationPreferencesKey),
      keys => redis.mGet(keys),
    );
    for (let index = 0; index < ids.length; index += 1) {
      const preferences = parseNotificationPreferences(stored[index], { updates: true, offlineOrbs: true });
      if (preferences.updates) updatesEnabledPlayers += 1;
      if (preferences.offlineOrbs) offlineOrbsEnabledPlayers += 1;
    }

    const next = typeof page?.next === 'string' ? page.next.trim() : '';
    if (!next || next === cursor || seenCursors.has(next)) break;
    seenCursors.add(next);
    cursor = next;
  }

  const optedInPlayers = seenUsers.size;
  const registeredPlayers = registry && typeof registry === 'object'
    ? Object.keys(registry as Record<string, unknown>).length
    : 0;
  const totalPlayers = Math.max(registeredPlayers, optedInPlayers);
  return {
    optedInPlayers,
    updatesEnabledPlayers,
    offlineOrbsEnabledPlayers,
    totalPlayers,
    percentage: totalPlayers > 0 ? Math.min(100, optedInPlayers / totalPlayers * 100) : 0,
    updatesPercentage: totalPlayers > 0 ? Math.min(100, updatesEnabledPlayers / totalPlayers * 100) : 0,
    offlineOrbsPercentage: totalPlayers > 0 ? Math.min(100, offlineOrbsEnabledPlayers / totalPlayers * 100) : 0,
  };
}

interface ManualPushBroadcastState {
  campaignId: string;
  title: string;
  body: string;
  link: string;
  status: 'queued' | 'sending' | 'complete' | 'failed';
  cursor: string;
  sent: number;
  queued: number;
  attributionTracked: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

const GAME_UPDATE_NOTIFICATION_TITLE = 'Infinity Orbs Update';
const GAME_UPDATE_NOTIFICATION_BODY = "A new update is live! Jump back in and see what's changed.";

function manualPushBroadcastKey(campaignId: string): string {
  return NOTIFICATION_BROADCAST_PREFIX + campaignId;
}

export async function startManualPushNotificationCampaign(): Promise<{ campaignId: string; status: 'queued' }> {
  // Game Update is a fixed, pre-approved copy preset rather than a custom composer.
  const title = GAME_UPDATE_NOTIFICATION_TITLE;
  const body = GAME_UPDATE_NOTIFICATION_BODY;
  const subredditName = String(context.subredditName ?? '').trim();
  const storedPostId = String(await redis.get('io:global-game-post-id') ?? '').trim();
  const postId = storedPostId.replace(/^t3_/, '');
  const link = storedPostId && subredditName
    ? `https://reddit.com/r/${subredditName}/comments/${postId}`
    : subredditName
      ? `https://reddit.com/r/${subredditName}`
      : '';
  if (!link) throw new Error('Could not determine an Infinity Orbs notification destination.');

  const campaignId = secureServerToken('push-broadcast');
  const now = Date.now();
  const state: ManualPushBroadcastState = {
    campaignId,
    title,
    body,
    link,
    status: 'queued',
    cursor: '',
    sent: 0,
    queued: 0,
    attributionTracked: 0,
    createdAt: now,
    updatedAt: now,
  };
  const keyName = manualPushBroadcastKey(campaignId);
  await redis.set(keyName, JSON.stringify(state), {
    expiration: new Date(now + 7 * 24 * 60 * 60_000),
  });
  try {
    await scheduler.runJob({
      name: 'manual-push-broadcast',
      data: { campaignId, cursor: '' },
      runAt: new Date(now + 1_000),
    });
  } catch (error) {
    await redis.del(keyName).catch(() => false);
    throw error;
  }
  return { campaignId, status: 'queued' };
}

export async function processManualPushNotificationCampaign(input: {
  campaignId: unknown;
  cursor: unknown;
}): Promise<void> {
  const campaignId = String(input.campaignId ?? '').trim();
  if (!/^push-broadcast-[a-f0-9-]{16,100}$/i.test(campaignId)) return;
  const keyName = manualPushBroadcastKey(campaignId);
  const raw = await redis.get(keyName);
  if (typeof raw !== 'string') return;
  let state: ManualPushBroadcastState;
  try {
    state = JSON.parse(raw) as ManualPushBroadcastState;
  } catch {
    console.error('[Notification Broadcast] Campaign state is malformed:', campaignId);
    return;
  }
  if (!state || state.campaignId !== campaignId || state.status === 'complete' || state.status === 'failed') return;

  const requestedCursor = String(input.cursor ?? '');
  if (requestedCursor !== String(state.cursor ?? '')) return;
  const pageLockKey = keyName + ':page:' + (requestedCursor ? encodeURIComponent(requestedCursor).slice(0, 160) : 'first');
  const lockResult = await redis.set(pageLockKey, '1', {
    nx: true,
    expiration: new Date(Date.now() + 10 * 60_000),
  });
  if (lockResult !== 'OK') return;

  state.status = 'sending';
  state.updatedAt = Date.now();
  await redis.set(keyName, JSON.stringify(state), { expiration: new Date(Date.now() + 7 * 24 * 60 * 60_000) });

  try {
    const page = await notifications.listOptedInUsers({
      ...(requestedCursor ? { after: requestedCursor } : {}),
      limit: NOTIFICATION_BROADCAST_BATCH_SIZE,
    }) as { userIds?: unknown; next?: unknown };
    const userIds = Array.isArray(page?.userIds)
      ? Array.from(new Set(page.userIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
      : [];
    const updateRecipients = await filterNotificationRecipients(userIds, 'updates');
    const immediateRecipients: string[] = [];
    const queuedAt = Date.now();
    for (const userId of updateRecipients) {
      const slot = await reserveNotificationDailySendSlot(userId);
      if (slot.allowed) {
        immediateRecipients.push(userId);
      } else {
        const added = await queueGameUpdateForUser(userId, {
          campaignId,
          title: state.title,
          body: state.body,
          link: state.link,
          queuedAt,
        });
        if (added) state.queued += 1;
      }
    }

    if (immediateRecipients.length > 0) {
      const recipients = immediateRecipients.map(userId => ({ userId, link: state.link }));
      let delivered: string[] = [];
      try {
        await notifications.enqueue({
          title: state.title,
          body: state.body,
          recipients,
        });
        delivered = immediateRecipients;
      } catch (bulkError) {
        // A prior-version send may not exist in our local daily counter. Fall
        // back to one recipient at a time so one Reddit rate-limit rejection
        // does not prevent the rest of this campaign from being delivered.
        console.warn('[Notification Broadcast] Bulk send failed; retrying recipients individually.', bulkError);
        for (const userId of immediateRecipients) {
          try {
            await notifications.enqueue({
              title: state.title,
              body: state.body,
              recipients: [{ userId, link: state.link }],
            });
            delivered.push(userId);
          } catch (error) {
            if (!isNotificationDailyLimitError(error)) throw error;
            await markNotificationDailyLimitReached(userId);
            const added = await queueGameUpdateForUser(userId, {
              campaignId,
              title: state.title,
              body: state.body,
              link: state.link,
              queuedAt,
            });
            if (added) state.queued += 1;
            console.warn('[Notification Broadcast] Recipient deferred to the next daily window.', userId, error);
          }
        }
      }

      state.sent += delivered.length;
      const sentAt = Date.now();
      for (let offset = 0; offset < delivered.length; offset += 20) {
        const batch = delivered.slice(offset, offset + 20);
        const outcomes = await Promise.allSettled(
          batch.map(userId => markNotificationAttributionPending(userId, 'manual', sentAt)),
        );
        state.attributionTracked += outcomes.filter(outcome => outcome.status === 'fulfilled' && outcome.value).length;
      }
    }

    if (state.queued > 0) {
      await schedulePendingGameUpdateDrain(nextUtcNotificationDay());
    }

    const next = typeof page?.next === 'string' ? page.next.trim() : '';
    state.cursor = next;
    state.updatedAt = Date.now();
    state.status = next ? 'queued' : 'complete';
    await redis.set(keyName, JSON.stringify(state), { expiration: new Date(Date.now() + 7 * 24 * 60 * 60_000) });

    if (next) {
      await scheduler.runJob({
        name: 'manual-push-broadcast',
        data: { campaignId, cursor: next },
        runAt: new Date(Date.now() + NOTIFICATION_BROADCAST_BATCH_DELAY_MS),
      });
    } else {
      console.log('[Notification Broadcast] Completed:', {
        campaignId,
        sent: state.sent,
        attributionTracked: state.attributionTracked,
      });
    }
  } catch (error) {
    state.status = 'failed';
    state.error = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
    state.updatedAt = Date.now();
    await redis.set(keyName, JSON.stringify(state), { expiration: new Date(Date.now() + 7 * 24 * 60 * 60_000) });
    console.error('[Notification Broadcast] Batch failed; campaign stopped to avoid duplicate sends.', campaignId, error);
  }
}

export async function getManualPushNotificationCampaign(campaignId: unknown): Promise<ManualPushBroadcastState | null> {
  const id = String(campaignId ?? '').trim();
  if (!/^push-broadcast-[a-f0-9-]{16,100}$/i.test(id)) return null;
  const raw = await redis.get(manualPushBroadcastKey(id));
  if (typeof raw !== 'string') return null;
  try {
    const state = JSON.parse(raw) as ManualPushBroadcastState;
    return state && state.campaignId === id ? state : null;
  } catch {
    return null;
  }
}

export async function getNotificationState(userId = currentUserId()): Promise<boolean> {
  return (await getNotificationPreferences(userId)).enabled;
}

export async function setNotificationState(enabled: boolean): Promise<boolean> {
  return (await setNotificationPreferences({ updates: enabled, offlineOrbs: enabled })).enabled;
}

function normalizePopupConfig(value: unknown): PopupConfig {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  return {
    notification: typeof record.notification === 'boolean' ? record.notification : DEFAULT_POPUP_CONFIG.notification,
    frenzy: typeof record.frenzy === 'boolean' ? record.frenzy : DEFAULT_POPUP_CONFIG.frenzy,
    frenzyShard: typeof record.frenzyShard === 'boolean' ? record.frenzyShard : DEFAULT_POPUP_CONFIG.frenzyShard,
    joinSubreddit: typeof record.joinSubreddit === 'boolean' ? record.joinSubreddit : DEFAULT_POPUP_CONFIG.joinSubreddit,
  };
}

export async function getPopupConfig(): Promise<PopupConfig> {
  return normalizePopupConfig(await redis.get(POPUP_CONFIG_KEY));
}

export async function setPopupConfig(patch: Partial<PopupConfig>): Promise<PopupConfig> {
  const current = await getPopupConfig();
  const next: PopupConfig = { ...current };
  for (const id of POPUP_IDS) if (typeof patch[id] === 'boolean') next[id] = patch[id] as boolean;
  await redis.set(POPUP_CONFIG_KEY, JSON.stringify(next));
  return next;
}

export async function recordPopupEvent(
  popupValue: unknown,
  eventValue: unknown,
): Promise<{ popup: GamePopupId; event: GamePopupEvent; recorded: boolean; excluded?: boolean }> {
  const popup = String(popupValue ?? '') as GamePopupId;
  const event = String(eventValue ?? '') as GamePopupEvent;
  if (!POPUP_IDS.includes(popup) || !POPUP_EVENTS.includes(event)) throw new Error('INVALID_POPUP_EVENT');

  // Count real popup interactions for every account, including the developer account.
  // Admin preview controls return before calling trackPopupEvent, so preview-only
  // interactions remain excluded without suppressing real gameplay telemetry.
  await redis.incrBy(POPUP_STATS_KEY_PREFIX + popup + ':' + event, 1);
  return { popup, event, recorded: true };
}

export async function getPopupStats(): Promise<PopupStats> {
  const readCount = async (popup: GamePopupId, event: GamePopupEvent): Promise<number> => {
    const raw = await redis.get(POPUP_STATS_KEY_PREFIX + popup + ':' + event);
    const count = Number.parseInt(String(raw ?? '0'), 10);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
  };
  const stats = {} as PopupStats;
  for (const popup of POPUP_IDS) {
    const [shown, accepted, dismissed] = await Promise.all([
      readCount(popup, 'shown'), readCount(popup, 'accepted'), readCount(popup, 'dismissed'),
    ]);
    stats[popup] = { shown, accepted, dismissed, acceptanceRate: shown > 0 ? Math.round((accepted / shown) * 1000) / 10 : 0 };
  }
  return stats;
}

export async function getFakeCcuBonus(userId = currentUserId()): Promise<number> {
  const id = String(userId ?? '').trim();
  if (!id) return 0;
  const raw = await redis.get(FAKE_CCU_KEY_PREFIX + id);
  return Math.max(0, Math.min(1_000_000, Math.floor(Number(raw ?? 0) || 0)));
}

export async function setFakeCcuBonus(bonus: number, userId = currentUserId()): Promise<number> {
  const safeBonus = Math.max(0, Math.min(1_000_000, Math.floor(Number(bonus) || 0)));
  const id = String(userId ?? '').trim();
  if (!id) throw new Error('Reddit account identity is unavailable.');
  await redis.set(FAKE_CCU_KEY_PREFIX + id, String(safeBonus));
  return safeBonus;
}

export async function getCcuPeaks(): Promise<{
  current: number;
  last24Hours: number;
  last7Days: number;
  last30Days: number;
  allTime: number;
  fakeCcuBonus: number;
  effectiveLuckCcu: number;
}> {
  const now = Date.now();
  const current = await touchOnlinePresence();
  const currentHour = Math.floor(now / 3_600_000);
  const hourlyKeys = Array.from({ length: 720 }, (_, index) => CCU_HOURLY_PREFIX + String(currentHour - index));
  const values = await Promise.all(hourlyKeys.map(async key => {
    const raw = await redis.get(key);
    return Math.max(0, Number.parseInt(String(raw ?? '0'), 10) || 0);
  }));

  const maxIn = (hours: number) => Math.max(current, ...values.slice(0, hours), 0);
  const allTimeRaw = await redis.get(CCU_ALL_TIME_KEY);
  const fakeCcuBonus = await getFakeCcuBonus();
  return {
    current,
    last24Hours: maxIn(24),
    last7Days: maxIn(24 * 7),
    last30Days: maxIn(24 * 30),
    allTime: Math.max(0, Number.parseInt(String(allTimeRaw ?? '0'), 10) || 0, current),
    fakeCcuBonus,
    effectiveLuckCcu: current + fakeCcuBonus,
  };
}

const FRENZY_POST_PREFIX = 'io:frenzy:post:';
const FRENZY_CLAIM_RECEIPT_PREFIX = 'io:frenzy:claim-receipt:';
const FRENZY_POST_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const FRENZY_HANDOFF_PREFIX = 'io:frenzy:handoff:';
const FRENZY_HANDOFF_TTL_MS = 60_000;
const FRENZY_CLAIM_PROGRESS_PREFIX = 'io:frenzy:claim-progress:';
const FRENZY_CLAIM_PROGRESS_TTL_MS = 3 * 60_000;
const TIME_ENERGY_ROLL_PROGRESS_PREFIX = 'io:time-energy:roll-progress:';
const TIME_ENERGY_ROLL_PROGRESS_TTL_MS = 3 * 60_000;
const FRENZY_THANK_YOU_PREFIX = 'io:frenzy:thank-you:';
const FRENZY_CLAIMERS_PREFIX = 'io:frenzy:claimers:v1:';
const FRENZY_CLAIMER_PROJECTION_RECEIPT_PREFIX = 'io:frenzy:claimer-projection-receipt:v1:';

function frenzyClaimersKey(postId: string): string {
  return FRENZY_CLAIMERS_PREFIX + encodeURIComponent(postId);
}

interface FrenzyClaimersRecord {
  count: number;
  players: Array<{ userId: string; username: string; claimedAt: number }>;
}

function parseFrenzyClaimersRecord(raw: string | null): FrenzyClaimersRecord {
  if (!raw) return { count: 0, players: [] };
  try {
    const value = JSON.parse(raw) as Partial<FrenzyClaimersRecord>;
    const players = Array.isArray(value.players)
      ? value.players.filter(player =>
          player && typeof player.userId === 'string' &&
          typeof player.username === 'string' &&
          Number.isSafeInteger(player.claimedAt) && player.claimedAt > 0,
        ).slice(0, 5)
      : [];
    const count = Number(value.count);
    return {
      count: Number.isSafeInteger(count) && count >= players.length ? count : players.length,
      players,
    };
  } catch {
    return { count: 0, players: [] };
  }
}

function frenzyClaimerProjectionReceiptKey(postId: string, userId: string): string {
  return FRENZY_CLAIMER_PROJECTION_RECEIPT_PREFIX +
    encodeURIComponent(postId) + ':' + encodeURIComponent(userId);
}

/**
 * Claim activity is a display projection, not part of reward settlement.
 * Update it after the durable player receipt/rewards commit, retrying concurrent
 * claimers with WATCH/EXEC. A per-claim projection receipt prevents double counts.
 */
async function recordFrenzyClaimer(
  postId: string,
  userId: string,
  username: string,
  claimedAt: number,
  expiresAt: Date,
): Promise<void> {
  const claimersKey = frenzyClaimersKey(postId);
  const projectionReceiptKey = frenzyClaimerProjectionReceiptKey(postId, userId);
  const maxAttempts = 24;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let txn: Awaited<ReturnType<typeof redis.watch>> | null = null;
    let transactionClosed = false;
    try {
      txn = await redis.watch(claimersKey, projectionReceiptKey);
      const [previousRaw, projectionReceipt] = await Promise.all([
        redis.get(claimersKey),
        redis.get(projectionReceiptKey),
      ]);
      if (projectionReceipt != null) {
        await txn.unwatch();
        transactionClosed = true;
        return;
      }

      const previous = parseFrenzyClaimersRecord(previousRaw);
      const next: FrenzyClaimersRecord = {
        count: previous.count + 1,
        players: [
          { userId, username, claimedAt },
          ...previous.players.filter(player => player.userId !== userId),
        ].slice(0, 5),
      };

      await txn.multi();
      await txn.set(claimersKey, JSON.stringify(next), { expiration: expiresAt });
      await txn.set(projectionReceiptKey, '1', { expiration: expiresAt });
      const committed = await txn.exec();
      transactionClosed = true;
      if (committed !== null) return;
    } catch (error) {
      lastError = error;
    } finally {
      if (txn && !transactionClosed) {
        await txn.unwatch().catch(() => undefined);
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, Math.min(10 * (attempt + 1), 100)));
    }
  }

  console.warn(
    '[Frenzy Claim] Reward was saved, but the live claim activity projection could not be updated.',
    lastError,
  );
}

function frenzyHandoffKey(userId: string): string {
  return FRENZY_HANDOFF_PREFIX + userId;
}

function frenzyClaimProgressKey(userId: string): string {
  return FRENZY_CLAIM_PROGRESS_PREFIX + encodeURIComponent(userId);
}

interface FrenzyClaimProgressRecord {
  postId: string;
  attemptId: string;
  processed: number;
  total: number;
  updatedAt: number;
  completed: boolean;
}

async function writeFrenzyClaimProgress(
  userId: string,
  postId: string,
  attemptId: string,
  total: number,
  processed: number,
  completed = false,
): Promise<void> {
  try {
    const now = Date.now();
    const safeTotal = Math.max(0, Math.floor(total));
    const safeProcessed = Math.max(0, Math.min(safeTotal, Math.floor(processed)));
    const record: FrenzyClaimProgressRecord = {
      postId,
      attemptId,
      processed: safeProcessed,
      total: safeTotal,
      updatedAt: now,
      completed,
    };
    await redis.set(
      frenzyClaimProgressKey(userId),
      JSON.stringify(record),
      { expiration: new Date(now + FRENZY_CLAIM_PROGRESS_TTL_MS) },
    );
  } catch (error) {
    // Progress is display-only; never let a status write cancel a valid reward.
    console.error('[Frenzy Claim] Could not update live progress; reward processing continues.', error);
  }
}

interface TimeEnergyRollProgressRecord {
  attemptId: string;
  processed: number;
  total: number;
  updatedAt: number;
  completed: boolean;
}

function timeEnergyRollProgressKey(userId: string): string {
  return TIME_ENERGY_ROLL_PROGRESS_PREFIX + encodeURIComponent(userId);
}

async function writeTimeEnergyRollProgress(
  userId: string,
  attemptId: string,
  total: number,
  processed: number,
  completed = false,
): Promise<void> {
  try {
    const now = Date.now();
    const safeTotal = Math.max(0, Math.floor(total));
    const safeProcessed = Math.max(0, Math.min(safeTotal, Math.floor(processed)));
    const record: TimeEnergyRollProgressRecord = {
      attemptId,
      processed: safeProcessed,
      total: safeTotal,
      updatedAt: now,
      completed,
    };
    await redis.set(
      timeEnergyRollProgressKey(userId),
      JSON.stringify(record),
      { expiration: new Date(now + TIME_ENERGY_ROLL_PROGRESS_TTL_MS) },
    );
  } catch (error) {
    // Progress is display-only; never let it interrupt an otherwise valid roll.
    console.error('[Time Energy] Could not update live roll progress; rolling continues.', error);
  }
}

export async function getTimeEnergyRollProgress(): Promise<{
  attemptId: string | null;
  updatedAt: number | null;
  active: boolean;
  processed: number;
  total: number;
  percent: number;
  completed: boolean;
}> {
  const raw = await redis.get(timeEnergyRollProgressKey(currentUserId()));
  const progress = parseStoredJson<TimeEnergyRollProgressRecord>(raw);
  if (
    !progress ||
    typeof progress.attemptId !== 'string' ||
    !Number.isSafeInteger(progress.processed) ||
    !Number.isSafeInteger(progress.total) ||
    progress.processed < 0 ||
    progress.total < 0 ||
    progress.processed > progress.total ||
    !Number.isSafeInteger(progress.updatedAt) ||
    progress.updatedAt < 0
  ) {
    return { attemptId: null, updatedAt: null, active: false, processed: 0, total: 0, percent: 0, completed: false };
  }
  const completed = progress.completed === true;
  const processed = Math.min(progress.total, progress.processed);
  const percent = completed
    ? 100
    : progress.total > 0
      ? Math.min(95, Math.floor((processed / progress.total) * 95))
      : 0;
  const active = !completed && Date.now() - progress.updatedAt <= TIME_ENERGY_ROLL_PROGRESS_TTL_MS;
  return { attemptId: progress.attemptId, updatedAt: progress.updatedAt, active, processed, total: progress.total, percent, completed };
}

function frenzyClaimReceiptKey(postId: string, userId: string): string {
  return FRENZY_CLAIM_RECEIPT_PREFIX + encodeURIComponent(postId) + ':' + encodeURIComponent(userId);
}

function isFrenzyTestAdmin(username?: string): boolean {
  const candidate = String(username ?? context.username ?? '')
    .trim()
    .replace(/^u\//i, '')
    .toLowerCase();
  return candidate === 'shadow_fen';
}

async function deleteFrenzyHandoffIfUnchanged(keyName: string, expectedValue: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const txn = await redis.watch(keyName);
    try {
      const current = await redis.get(keyName);
      if (current == null || String(current) !== expectedValue) {
        await txn.unwatch();
        return false;
      }
      await txn.multi();
      await txn.del(keyName);
      if (await txn.exec() !== null) return true;
    } catch (error) {
      await txn.unwatch().catch(() => undefined);
      throw error;
    }
  }
  return false;
}

async function readFrenzyHandoff(userId: string): Promise<{ postId: string; expiresAt: number } | null> {
  const raw = await redis.get(frenzyHandoffKey(userId));
  const data = parseStoredJson<{ postId?: string; expiresAt?: number }>(raw);
  const postId = typeof data?.postId === 'string' ? data.postId.trim() : '';
  const expiresAt = data?.expiresAt;
  // This record authorizes the post-to-game claim handoff. Do not coerce strings,
  // fractions, or unsafe integers into a valid future timestamp.
  if (
    !postId ||
    typeof expiresAt !== 'number' ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    if (raw != null) await deleteFrenzyHandoffIfUnchanged(frenzyHandoffKey(userId), String(raw));
    return null;
  }
  return { postId, expiresAt };
}

export async function armOrbFrenzyClaim(): Promise<{ armed: true; postId: string }> {
  const postId = String(context.postId ?? '').trim();
  if (!postId) throw new Error('This is not an Orb Frenzy post.');

  return withPlayerMutationLock(async () => {
    const viewerId = currentUserId();
    const raw = await redis.get(FRENZY_POST_PREFIX + postId);
    if (!raw) throw new Error('This is not an Orb Frenzy post.');
    const data = parseFrenzyPostRecord(raw);
    if (!data || data.inGame !== true) throw new Error('This is not an Orb Frenzy post.');

    const s = await settleOffline(await loadRaw());
    const now = Date.now();
    if (isFrenzyPostRecordExpired(data, now)) throw new Error('This Frenzy has expired.');
    const claimsUsedToday = frenzyClaimsUsedToday(s.lastFrenzyClaimDate, s.frenzyClaimsToday, now);
    const isOwner = data.ownerId === viewerId;
    const selfClaimTest =
      isOwner &&
      data.adminTest === true &&
      isFrenzyTestAdmin(s.username);

    if (isOwner && !selfClaimTest) throw new Error('You cannot claim your own Orb Frenzy.');
    if (claimsUsedToday >= FRENZY_CLAIMS_PER_DAY && !selfClaimTest) {
      throw new Error('You have used all ' + FRENZY_CLAIMS_PER_DAY + ' Frenzy claims available today.');
    }

    const handoffExpiresAt = Date.now() + FRENZY_HANDOFF_TTL_MS;
    await redis.set(frenzyHandoffKey(viewerId), JSON.stringify({
      postId,
      expiresAt: handoffExpiresAt,
    }), { expiration: new Date(handoffExpiresAt) });
    return { armed: true, postId };
  });
}

export async function getOrbFrenzyHandoff(): Promise<{ armed: boolean; postId?: string }> {
  const handoff = await readFrenzyHandoff(currentUserId());
  return handoff ? { armed: true, postId: handoff.postId } : { armed: false };
}

function queueFrenzyShardPopup(state: PlayerState, amount: number): void {
  const granted = Math.max(0, Math.floor(Number(amount) || 0));
  if (granted <= 0) return;
  const previous = state.frenzyShardPopupPending;
  state.frenzyShardPopupPending = {
    amount: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number(previous?.amount) || 0) + granted),
    eventCount: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(previous?.eventCount) || 0)) + 1),
    lastRewardAt: Date.now(),
  };
}

export async function prepareFrenzyOwnerRewardWrites(
  ownerId: string,
  amount = FRENZY_OWNER_SHARD_REWARD,
  queuePopup = true,
): Promise<{ granted: number; writes: SaveExtraWrite[] }> {
  const safeOwnerId = String(ownerId ?? '').trim();
  if (!safeOwnerId || safeOwnerId === 'unknown') {
    throw new Error('Frenzy owner identity is missing; the claim was not consumed.');
  }

  const ownerKey = playerKeyFor(safeOwnerId);
  const ownerGenerationKey = saveGenerationKeyFor(safeOwnerId);
  const [raw, generationRaw, registryRaw] = await Promise.all([
    redis.get(ownerKey),
    redis.get(ownerGenerationKey),
    redis.hGet(PLAYER_REGISTRY_KEY, safeOwnerId),
  ]);
  if (raw == null) throw new Error('Frenzy owner save was not found.');
  const ownerSave = await readStoredPlayerSave(safeOwnerId, raw);
  const ownerState = ownerSave == null ? null : parsePlayerStateValue(ownerSave);
  if (!ownerState) throw new Error('Frenzy owner save could not be read safely.');

  const generationText = generationRaw == null ? '0' : String(generationRaw);
  const generation = Number.parseInt(generationText, 10);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error('Frenzy owner save generation could not be read safely.');
  }
  const ownerGeneration = Math.max(0, Math.floor(Number(ownerState.saveGeneration ?? 0)) || 0);
  if (ownerGeneration !== generation) {
    throw new Error('Frenzy owner save changed generation; the claim was not consumed.');
  }

  const granted = grantFrenzyOwnerShards(ownerState, amount);
  if (queuePopup) queueFrenzyShardPopup(ownerState, granted);
  const currentRevision = Math.max(0, Math.floor(Number(ownerState.stateRevision ?? 0)) || 0);
  if (currentRevision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Frenzy owner save revision is exhausted; the claim was not consumed.');
  }
  const nextState = {
    ...ownerState,
    saveGeneration: generation,
    stateRevision: currentRevision + 1,
  };

  // These side writes join the claimant save transaction. The post, claimant
  // reward, owner Shards, and both generation guards either all commit or none do.
  return {
    granted,
    writes: [
      {
        key: ownerGenerationKey,
        expectedValue: generationRaw == null ? null : String(generationRaw),
        nextValue: generationText,
        conflictMessage: 'Frenzy owner save generation changed. Please retry.',
      },
      {
        key: ownerKey,
        expectedValue: String(raw),
        nextValue: JSON.stringify(nextState),
        conflictMessage: 'Frenzy owner save changed. Please retry.',
      },
    ],
  };
}


function parseGlobalBoosterSnapshot(
  raw: unknown,
  now: number,
): GlobalBoosterSnapshot | null {
  if (raw == null) return null;

  let parsed: unknown = raw;
  for (let depth = 0; depth < 12; depth++) {
    if (typeof parsed === 'string') {
      const text = parsed.trim();
      if (!text) return null;
      try {
        parsed = JSON.parse(text);
      } catch {
        return null;
      }
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;

    const isValidBoosterState = (value: unknown, id: GlobalBoosterId): value is GlobalBoosterSnapshot[GlobalBoosterId] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const state = value as Record<string, unknown>;
      if (
        !Number.isSafeInteger(state.tier) || Number(state.tier) < 0 ||
        (id === 'speed' && Number(state.tier) > 10) ||
        !Number.isSafeInteger(state.activationProgress) ||
        Number(state.activationProgress) < 0 ||
        Number(state.activationProgress) >= 4 ||
        !Number.isSafeInteger(state.endsAt) || Number(state.endsAt) < 0
      ) return false;

      if (state.lastTickAt != null) {
        if (
          !Number.isSafeInteger(state.lastTickAt) ||
          Number(state.lastTickAt) < 0 ||
          Number(state.lastTickAt) > now + 60_000
        ) return false;
      }
      return true;
    };

    if (
      isValidBoosterState(record.luck, 'luck') &&
      isValidBoosterState(record.speed, 'speed') &&
      isValidBoosterState(record.crit, 'crit')
    ) {
      return {
        luck: decayGlobalBoosterState(record.luck, now),
        speed: decayGlobalBoosterState(record.speed, now),
        crit: decayGlobalBoosterState(record.crit, now),
      };
    }

    let nested = false;
    for (const wrapperKey of ['value', 'state', 'data', 'payload', 'result']) {
      if (!(wrapperKey in record)) continue;
      parsed = record[wrapperKey];
      nested = true;
      break;
    }
    if (!nested) return null;
  }

  return null;
}

export async function getGlobalBoosters(): Promise<GlobalBoosterSnapshot> {
  const now = Date.now();
  const raw = await redis.get(GLOBAL_BOOSTERS_KEY);
  const snapshot = parseGlobalBoosterSnapshot(raw, now);

  if (!snapshot) {
    await appendGlobalBoosterDebugLog('read:missing-or-invalid', {
      key: GLOBAL_BOOSTERS_KEY,
      rawType: typeof raw,
      rawIsNull: raw == null,
      rawValue: summarizeGlobalBoosterRaw(raw),
    });
    return createInitialGlobalBoosters(now);
  }

  snapshot.speed.tier = Math.min(10, Math.max(0, Math.floor(Number(snapshot.speed.tier) || 0)));
  if (snapshot.speed.tier >= 10) snapshot.speed.activationProgress = 0;
  return snapshot;
}

async function prepareGlobalBoosterActivation(id: GlobalBoosterId): Promise<{
  snapshot: GlobalBoosterSnapshot;
  expectedValue: string | null;
  nextValue: string;
}> {
  const now = Date.now();
  const raw = await redis.get(GLOBAL_BOOSTERS_KEY);
  const current = raw == null
    ? createInitialGlobalBoosters(now)
    : parseGlobalBoosterSnapshot(raw, now);
  if (!current) {
    throw new Error('Global Booster data is corrupted; refusing to overwrite it.');
  }

  const before = current[id];
  const after = activateGlobalBoosterStack(
    before,
    now,
    id === 'speed' ? 10 : Number.MAX_SAFE_INTEGER,
  );
  const snapshot: GlobalBoosterSnapshot = { ...current, [id]: after };
  await appendGlobalBoosterDebugLog('activate:state-computed', {
    id,
    before,
    after,
    note: 'Pending atomic player/global save; no global write has occurred yet.',
  });

  return {
    snapshot,
    expectedValue: raw == null ? null : String(raw),
    nextValue: JSON.stringify(snapshot),
  };
}
export async function setGlobalBoosterDebugState(
  id: GlobalBoosterId,
  tier: number,
  minutes: number,
): Promise<{ tier: number; activationProgress: number; endsAt: number }> {
  if (!Object.prototype.hasOwnProperty.call(GLOBAL_BOOSTERS, id)) {
    throw new Error('Unknown Global Booster.');
  }
  if (!Number.isSafeInteger(tier) || tier < 0 || tier > 1_000_000) {
    throw new Error('Global Booster tier must be a finite integer between 0 and 1000000.');
  }
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 10_080) {
    throw new Error('Global Booster duration must be between 1 minute and 7 days.');
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const now = Date.now();
    const txn = await redis.watch(GLOBAL_BOOSTERS_KEY);
    const raw = await redis.get(GLOBAL_BOOSTERS_KEY);
    const snapshot = raw == null
      ? createInitialGlobalBoosters(now)
      : parseGlobalBoosterSnapshot(raw, now);
    if (!snapshot) {
      await txn.unwatch();
      throw new Error('Global Booster data is corrupted; refusing to overwrite it.');
    }

    const previous = snapshot[id];
    const cappedTier = id === 'speed' ? Math.min(10, tier) : tier;
    const next = {
      tier: cappedTier,
      activationProgress: 0,
      endsAt: cappedTier === 0 ? 0 : now + minutes * 60_000,
    };
    snapshot[id] = next;

    await txn.multi();
    await txn.set(GLOBAL_BOOSTERS_KEY, JSON.stringify(snapshot));
    const committed = await txn.exec();
    if (committed !== null) {
      await appendGlobalBoosterDebugLog('admin:set', {
        id,
        previous,
        next,
        minutes,
        key: GLOBAL_BOOSTERS_KEY,
      });
      return next;
    }
  }

  throw new Error('Global Boosters changed while applying the admin update. Please retry.');
}
function playerKeyFor(userId: string): string {
  return `player:${userId}`;
}

const PLAYTIME_ACTIVE_GAP_MS = 5 * 60_000;
const NOTIFICATION_ATTRIBUTION_TTL_MS = 7 * 24 * 60 * 60_000;
const NOTIFICATION_BROADCAST_PREFIX = 'io:notification-broadcast:v1:';
const NOTIFICATION_BROADCAST_BATCH_SIZE = 200;
const NOTIFICATION_BROADCAST_BATCH_DELAY_MS = 1_500;
type NotificationAttributionSource = 'offline-full' | 'manual';

function validPastTimestamp(value: unknown, now: number): number {
  const timestamp = Number(value);
  // Registry timestamps originate on the server. Future/malformed values are
  // not evidence of activity and must never pin a user as active indefinitely.
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > now) return 0;
  return timestamp;
}

interface PlayerRegistryEntry {
  username: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastLoginAt?: number;
  lastActivityAt?: number;
  playtimeMs?: number;
  clientVersion?: string;
  clientVersionAt?: number;
  notificationPendingSource?: NotificationAttributionSource;
  notificationPendingAt?: number;
  lastSessionNotificationSource?: NotificationAttributionSource;
  lastSessionNotificationAt?: number;
}

function parsePlayerRegistryEntryForMutation(raw: unknown, now: number): Partial<PlayerRegistryEntry> {
  const invalid = () => new Error('Player activity registry entry is malformed; refusing to overwrite it.');
  const parsed = parseStoredJson<unknown>(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();

  const record = parsed as Record<string, unknown>;
  const validTimestamp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= now;
  if (!validTimestamp(record.firstSeenAt) || !validTimestamp(record.lastSeenAt)) throw invalid();
  for (const field of ['lastLoginAt', 'lastActivityAt'] as const) {
    if (record[field] !== undefined && !validTimestamp(record[field])) throw invalid();
  }
  if (
    record.playtimeMs !== undefined &&
    (typeof record.playtimeMs !== 'number' ||
      !Number.isSafeInteger(record.playtimeMs) ||
      record.playtimeMs < 0)
  ) {
    throw invalid();
  }
  if (record.username !== undefined && typeof record.username !== 'string') throw invalid();
  for (const field of ['notificationPendingAt', 'lastSessionNotificationAt'] as const) {
    if (record[field] !== undefined && !validTimestamp(record[field])) throw invalid();
  }
  for (const field of ['notificationPendingSource', 'lastSessionNotificationSource'] as const) {
    if (record[field] !== undefined && record[field] !== 'offline-full' && record[field] !== 'manual') {
      throw invalid();
    }
  }

  return record as Partial<PlayerRegistryEntry>;
}

async function touchPlayerActivity(
  userId: string,
  username: string,
  now = Date.now(),
  reportedClientVersion?: string,
): Promise<number> {
  const lockIdentity = `activity:${userId}`;
  return withPlayerMutationLockFor(lockIdentity, async () => {
    const activityNow = Math.max(now, Date.now());
    const activeLock = getActivePlayerMutationLock(lockIdentity);
    if (!activeLock) throw new Error('PLAYER_MUTATION_LEASE_LOST');

    // This lease serializes activity updates for this user across runtimes.
    // Watch only the per-user lease, not the shared registry hash: HSET changes
    // one field atomically, so unrelated players must not invalidate this write.
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const txn = await redis.watch(activeLock.key);
      let transactionClosed = false;
      try {
      if (await redis.get(activeLock.key) !== activeLock.token) {
        await txn.unwatch();
        throw new Error('PLAYER_MUTATION_LEASE_LOST');
      }

      const existingRaw = await redis.hGet(PLAYER_REGISTRY_KEY, userId);
      let existing: Partial<PlayerRegistryEntry> | null = null;
      let firstSeenAt = activityNow;
      let lastLoginAt = activityNow;
      let playtimeMs = 0;
      let previousActivityAt = 0;
      let newSession = true;
      if (existingRaw != null) {
        try {
          existing = parsePlayerRegistryEntryForMutation(existingRaw, activityNow);
        } catch (error) {
          // Preserve malformed registry values for diagnosis/repair. The old
          // fallback silently replaced firstSeenAt/playtimeMs with fresh zeros.
          await txn.unwatch();
          throw error;
        }
        firstSeenAt = existing.firstSeenAt!;
        previousActivityAt = Math.max(
          validPastTimestamp(existing.lastActivityAt, activityNow),
          validPastTimestamp(existing.lastSeenAt, activityNow),
        );
        newSession = previousActivityAt <= 0 ||
          activityNow - previousActivityAt > PLAYTIME_ACTIVE_GAP_MS;
        const previousPlaytimeMs = existing.playtimeMs ?? 0;
        const activityDelta = previousActivityAt > 0
          ? Math.min(PLAYTIME_ACTIVE_GAP_MS, Math.max(0, activityNow - previousActivityAt))
          : 0;
        playtimeMs = Math.min(Number.MAX_SAFE_INTEGER, previousPlaytimeMs + activityDelta);
        const existingLastLoginAt = validPastTimestamp(existing.lastLoginAt, activityNow);
        if (!newSession && existingLastLoginAt > 0) {
          lastLoginAt = existingLastLoginAt;
        }
      }

      const pendingAt = validPastTimestamp(existing?.notificationPendingAt, activityNow);
      const pendingSource = existing?.notificationPendingSource === 'offline-full' ||
        existing?.notificationPendingSource === 'manual'
        ? existing.notificationPendingSource
        : undefined;
      const returnedAfterPush = Boolean(
        pendingSource &&
        pendingAt > previousActivityAt &&
        pendingAt <= activityNow &&
        activityNow - pendingAt <= NOTIFICATION_ATTRIBUTION_TTL_MS
      );
      if (returnedAfterPush) lastLoginAt = activityNow;
      const lastSessionNotificationSource = returnedAfterPush
        ? pendingSource
        : newSession
          ? undefined
          : existing?.lastSessionNotificationSource;
      const lastSessionNotificationAt = returnedAfterPush
        ? pendingAt
        : newSession
          ? undefined
          : validPastTimestamp(existing?.lastSessionNotificationAt, activityNow);
      const keepPendingNotification = !returnedAfterPush &&
        Boolean(pendingSource) &&
        pendingAt > 0 &&
        activityNow - pendingAt <= NOTIFICATION_ATTRIBUTION_TTL_MS;

      const clientVersion =
        reportedClientVersion ??
        (typeof existing?.clientVersion === 'string' ? existing.clientVersion.slice(0, 32) : undefined);
      const clientVersionAt = reportedClientVersion !== undefined
        ? activityNow
        : validPastTimestamp(existing?.clientVersionAt, activityNow);
      const next = JSON.stringify({
        username: String(username).trim().slice(0, 100),
        firstSeenAt,
        lastSeenAt: activityNow,
        lastLoginAt,
        lastActivityAt: activityNow,
        playtimeMs,
        ...(clientVersion ? { clientVersion } : {}),
        ...(clientVersionAt > 0 ? { clientVersionAt } : {}),
        ...(keepPendingNotification ? {
          notificationPendingSource: pendingSource,
          notificationPendingAt: pendingAt,
        } : {}),
        ...(lastSessionNotificationSource && lastSessionNotificationAt ? {
          lastSessionNotificationSource,
          lastSessionNotificationAt,
        } : {}),
      } satisfies PlayerRegistryEntry);
      await txn.multi();
      await txn.hSet(PLAYER_REGISTRY_KEY, { [userId]: next });
      const committed = await txn.exec();
      transactionClosed = true;
      if (committed !== null) return playtimeMs;
      } finally {
        if (!transactionClosed) {
          await txn.unwatch().catch(() => undefined);
        }
      }
    }
    throw new Error('Player activity changed repeatedly while recording playtime. Please retry.');
  });
}

async function registerPlayer(userId: string, username: string): Promise<void> {
  await touchPlayerActivity(userId, username);
}

const FIRST_ROLL_TUTORIAL_KEY_PREFIX = 'infinity-orbs:first-roll-tutorial:';

/** Tutorial completion follows the Reddit account across sessions and devices. */
export async function hasCompletedFirstRollTutorial(): Promise<boolean> {
  const userId = currentUserId();
  return (await redis.get(FIRST_ROLL_TUTORIAL_KEY_PREFIX + userId)) === '1';
}

export async function markFirstRollTutorialSeen(): Promise<void> {
  const userId = currentUserId();
  await redis.set(FIRST_ROLL_TUTORIAL_KEY_PREFIX + userId, '1');
}

export async function recordPlayerHeartbeat(reportedVersion?: unknown): Promise<{
  playtimeMs: number;
  onlinePlayers: number;
  clientVersion: string;
  isLatestVersion: boolean;
}> {
  const userId = currentUserId();
  const username = String(context.username ?? `reddit-user-${userId.slice(-8)}`);
  // A cached client that doesn't send a version must not retain an old "latest" badge.
  const clientVersion = typeof reportedVersion === 'string' &&
    /^[0-9A-Za-z.+-]{1,32}$/.test(reportedVersion)
    ? reportedVersion
    : 'unknown';
  const playtimeMs = await touchPlayerActivity(userId, username, Date.now(), clientVersion);
  const onlinePlayers = await touchOnlinePresence();
  return { playtimeMs, onlinePlayers, clientVersion, isLatestVersion: clientVersion === APP_VERSION };
}

export interface PlayerListEntry {
  userId: string;
  username: string;
  firstSeenAt: number;
  lastSeenAt: number;
  active: boolean;
  level: number;
  xp: number;
  playtimeMs: number;
  /** Live duration of the current online session; zero when the player is inactive. */
  currentSessionMs: number;
  totalRolls: number;
  highestRarity: number;
  coins: number;
  shards: number;
  clientVersion: string | null;
  isLatestVersion: boolean;
  lastSessionNotificationSource?: NotificationAttributionSource;
  lastSessionNotificationAt?: number;
  /** True when this entry was recovered from the legacy leaderboard index. */
  registryRecovered?: boolean;
  /** Old leaderboard-only entry with no account ID; safe to display but never target for admin actions. */
  legacyOnly?: boolean;
}

export async function listPlayers(): Promise<PlayerListEntry[]> {
  const rawRegistry = await redis.hGetAll(PLAYER_REGISTRY_KEY);
  const records = rawRegistry && typeof rawRegistry === 'object' ? rawRegistry as Record<string, string> : {};

  // The player registry is the primary index. The legacy leaderboard is a
  // second, older index of players who have shared an Orb. If the registry
  // loses individual fields (or is unexpectedly empty), use those IDs as a
  // recovery source rather than silently rendering an entirely empty list.
  const legacyRaw = await redis.get('io:leaderboard');
  const parsedLegacy = parseStoredJson<unknown>(legacyRaw);
  const legacyById = new Map<string, { username?: unknown; playtimeMs?: unknown }>();
  const legacyWithoutId: Array<Record<string, unknown>> = [];
  if (Array.isArray(parsedLegacy)) {
    for (const value of parsedLegacy) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const userId = typeof entry.userId === 'string' ? entry.userId.trim() : '';
      if (userId) {
        legacyById.set(userId, {
          username: entry.username,
          playtimeMs: entry.playtimeMs,
        });
      } else if (typeof entry.username === 'string' && entry.username.trim()) {
        // Legacy entries without IDs can be shown transparently, but are never
        // treated as real account IDs or included in moderation/action targets.
        legacyWithoutId.push(entry);
      }
    }
  }

  const userIds = Array.from(new Set([...Object.keys(records), ...legacyById.keys()]));
  if (userIds.length === 0 && legacyWithoutId.length === 0) return [];

  const missingRegistryCount = userIds.filter(userId =>
    !Object.prototype.hasOwnProperty.call(records, userId),
  ).length;
  if (missingRegistryCount > 0) {
    console.warn(
      '[Player List] Recovering ' + missingRegistryCount +
      ' account IDs from the legacy leaderboard because the player registry is missing entries.',
    );
  }

  const now = Date.now();
  const saves = await readInBatches(userIds.map(id => playerKeyFor(id)), keys => redis.mGet(keys));
  const players = userIds.map((userId, index): PlayerListEntry | null => {
    const hasRegistryEntry = Object.prototype.hasOwnProperty.call(records, userId);
    const registry = parseStoredJson<Partial<PlayerRegistryEntry>>(records[userId]) ?? {};
    const legacy = legacyById.get(userId);
    const storedSave = saves[index];
    const save = playerSaveProjection(typeof storedSave === 'string' ? storedSave : null);

    // Do not resurrect a wiped account from a stale leaderboard projection.
    // Registry-backed accounts remain visible as before; fallback-only entries
    // require a real durable player save.
    if (!hasRegistryEntry && !save) return null;

    const lastSeenAt = Math.max(
      validPastTimestamp(registry.lastSeenAt, now),
      validPastTimestamp(save?.lastSeenAt, now),
    );
    const onlineSessionStartedAt = validPastTimestamp(registry.lastLoginAt, now);
    const currentSessionMs =
      lastSeenAt >= now - PLAYER_ACTIVE_WINDOW_MS && onlineSessionStartedAt > 0
        ? Math.max(0, now - onlineSessionStartedAt)
        : 0;
    return {
      userId,
      registryRecovered: !hasRegistryEntry,
      username: String(registry.username ?? save?.username ?? legacy?.username ?? ('user-' + userId.slice(-8))).trim().slice(0, 100),
      firstSeenAt: validPastTimestamp(registry.firstSeenAt, now),
      lastSeenAt,
      active: lastSeenAt >= now - PLAYER_ACTIVE_WINDOW_MS,
      level: Math.max(1, Number(save?.level ?? 1) || 1),
      xp: Math.max(0, Number(save?.xp ?? 0) || 0),
      playtimeMs: Math.max(0, Number(registry.playtimeMs ?? legacy?.playtimeMs ?? 0) || 0),
      currentSessionMs,
      totalRolls: Math.max(0, Number(save?.totalRolls ?? 0) || 0),
      highestRarity: Math.max(0, Number(save?.highestRarity ?? 0) || 0),
      coins: Math.max(0, Number(save?.coins ?? 0) || 0),
      shards: Math.max(0, Number(save?.shards ?? 0) || 0),
      clientVersion: typeof registry.clientVersion === 'string' &&
        /^[0-9A-Za-z.+-]{1,32}$/.test(registry.clientVersion)
        ? registry.clientVersion
        : null,
      isLatestVersion: typeof registry.clientVersion === 'string' &&
        registry.clientVersion === APP_VERSION &&
        validPastTimestamp(registry.clientVersionAt, now) > now - 45_000,
      ...(registry.lastSessionNotificationSource === 'offline-full' || registry.lastSessionNotificationSource === 'manual'
        ? { lastSessionNotificationSource: registry.lastSessionNotificationSource }
        : {}),
      ...(validPastTimestamp(registry.lastSessionNotificationAt, now) > 0
        ? { lastSessionNotificationAt: validPastTimestamp(registry.lastSessionNotificationAt, now) }
        : {}),
    } satisfies PlayerListEntry;
  });
  const visiblePlayers = players.filter((player): player is PlayerListEntry => player !== null);
  const knownNames = new Set(visiblePlayers.map(player =>
    player.username.trim().replace(/^u\//i, '').toLowerCase(),
  ));
  const legacyOnlyPlayers: PlayerListEntry[] = legacyWithoutId
    .filter(entry => {
      const username = String(entry.username ?? '').trim().replace(/^u\//i, '').slice(0, 100);
      const normalized = username.toLowerCase();
      if (!normalized || knownNames.has(normalized)) return false;
      knownNames.add(normalized);
      return true;
    })
    .map(entry => ({
      userId: '',
      username: String(entry.username ?? '').trim().replace(/^u\//i, '').slice(0, 100),
      firstSeenAt: 0,
      lastSeenAt: 0,
      active: false,
      level: Math.max(1, Number(entry.level ?? 1) || 1),
      xp: 0,
      playtimeMs: Math.max(0, Number(entry.playtimeMs ?? 0) || 0),
      currentSessionMs: 0,
      totalRolls: Math.max(0, Number(entry.totalRolls ?? 0) || 0),
      highestRarity: Math.max(0, Number(entry.highestRarity ?? 0) || 0),
      coins: 0,
      shards: 0,
      clientVersion: null,
      isLatestVersion: false,
      legacyOnly: true,
    }));
  visiblePlayers.push(...legacyOnlyPlayers);
  visiblePlayers.sort((a, b) => Number(b.active) - Number(a.active) || b.lastSeenAt - a.lastSeenAt || a.username.localeCompare(b.username));
  return visiblePlayers;
}

export async function getPlayerActivityStats(now = Date.now()): Promise<{
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
}> {
  const rawRegistry = await redis.hGetAll(PLAYER_REGISTRY_KEY);
  const records = rawRegistry && typeof rawRegistry === 'object' ? rawRegistry as Record<string, string> : {};
  const cutoff24h = now - 24 * 60 * 60_000;
  const cutoff7d = now - 7 * 24 * 60 * 60_000;
  const cutoff30d = now - 30 * 24 * 60 * 60_000;

  let dailyActiveUsers = 0;
  let weeklyActiveUsers = 0;
  let monthlyActiveUsers = 0;

  for (const raw of Object.values(records)) {
    const entry = parseStoredJson<Partial<PlayerRegistryEntry>>(raw) ?? {};
    const lastSeenAt = Math.max(
      validPastTimestamp(entry.lastSeenAt, now),
      validPastTimestamp(entry.lastActivityAt, now),
    );
    if (lastSeenAt >= cutoff24h) dailyActiveUsers += 1;
    if (lastSeenAt >= cutoff7d) weeklyActiveUsers += 1;
    if (lastSeenAt >= cutoff30d) monthlyActiveUsers += 1;
  }

  return { dailyActiveUsers, weeklyActiveUsers, monthlyActiveUsers };
}

function paymentGoodsForSku(sku: string) {
  const pack = PURCHASE_PACKS.find(p => p.sku === sku);
  if (!pack) throw new Error('Unknown purchase product.');
  return pack;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isValidCollection(value: unknown): value is Record<string, number> {
  if (!isRecordObject(value)) return false;
  return Object.entries(value).every(([rarity, count]) => {
    const numericRarity = Number(rarity);
    return (rarity === 'Infinity' || (Number.isFinite(numericRarity) &&
      Number.isInteger(numericRarity) && numericRarity >= 2)) &&
      Number.isSafeInteger(count) && Number(count) >= 0;
  });
}

function normalizePlayerStreak(
  value: unknown,
  fallback: PlayerState['streak'],
): PlayerState['streak'] {
  const candidate = isRecordObject(value) ? { ...fallback, ...value } : fallback;
  return (
    Number.isSafeInteger(candidate.count) && Number(candidate.count) >= 0 &&
    typeof candidate.lastClaimDate === 'string' &&
    Number.isSafeInteger(candidate.longestStreak) && Number(candidate.longestStreak) >= 0
  ) ? candidate as PlayerState['streak'] : fallback;
}

function normalizeLevelRecord<T extends object>(
  value: unknown,
  defaults: T,
  limits: Record<string, number>,
): T {
  const normalized: Record<string, unknown> = Object.fromEntries(Object.entries(defaults));
  if (isRecordObject(value)) {
    for (const key of Object.keys(normalized)) {
      const candidate = value[key];
      if (
        typeof candidate === 'number' &&
        Number.isSafeInteger(candidate) &&
        candidate >= 0
      ) {
        const limit = Number.isSafeInteger(limits[key]) && limits[key] >= 0
          ? limits[key]
          : 100;
        normalized[key] = Math.min(candidate, limit);
      }
    }
  }
  return normalized as T;
}

function buildStandardUpgradeLimits(): Record<string, number> {
  const defaults = createInitialState().upgrades;
  const limits: Record<string, number> = {};
  for (const id of Object.keys(defaults) as UpgradeId[]) {
    if (id === 'auto') {
      limits[id] = 1;
      continue;
    }
    let level = 0;
    // Coin amounts intentionally support finite JS Numbers beyond the safe-integer
    // range. That boundary limits consecutive integer precision, not the maximum
    // spendable balance or purchase cost. Stop only when the cost overflows or
    // an upgrade's own cap makes upgradeCost return Infinity.
    while (Number.isFinite(upgradeCost(id, level))) {
      level += 1;
    }
    limits[id] = level;
  }
  return limits;
}

const STANDARD_UPGRADE_LEVEL_LIMITS = buildStandardUpgradeLimits();
const PRESTIGE_UPGRADE_LEVEL_LIMITS = Object.fromEntries(
  Object.entries(PRESTIGE_UPGRADES).map(([id, info]) => [id, info.maxLevel]),
) as Record<PrestigeUpgradeId, number>;
const MASTERY_SKILL_LEVEL_LIMITS = Object.fromEntries(
  Object.entries(MASTERY_SKILLS).map(([id, info]) => [id, info.maxLevel]),
) as Record<MasterySkillId, number>;

function normalizeCombatAutoScrapSettings(value: unknown, fallback: { enabled: boolean; maxQuality: number } = { enabled:false, maxQuality:20 }): { enabled:boolean; maxQuality:number } {
  if(!value||typeof value!=='object'||Array.isArray(value))return {...fallback};
  const raw=value as Record<string,unknown>,quality=Number(raw.maxQuality);
  return {enabled:raw.enabled===true,maxQuality:Number.isFinite(quality)?Math.round(Math.max(0,Math.min(100,quality))*100)/100:fallback.maxQuality};
}

function isValidQuestList(value: unknown): value is QuestItem[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const quest = item as Record<string, unknown>;
    const optionalRewardIsValid = (field: string) =>
      quest[field] === undefined ||
      quest[field] === null ||
      (typeof quest[field] === 'number' &&
        Number.isSafeInteger(quest[field]) &&
        Number(quest[field]) >= 0);
    return (
      typeof quest.id === 'string' && quest.id.length > 0 &&
      typeof quest.title === 'string' &&
      typeof quest.desc === 'string' &&
      Number.isSafeInteger(quest.target) && Number(quest.target) > 0 &&
      Number.isSafeInteger(quest.progress) && Number(quest.progress) >= 0 &&
      typeof quest.rewardCoins === 'number' && Number.isFinite(quest.rewardCoins) && Number.isInteger(quest.rewardCoins) && quest.rewardCoins >= 0 &&
      typeof quest.claimed === 'boolean' &&
      (quest.unlocked === undefined || typeof quest.unlocked === 'boolean') &&
      optionalRewardIsValid('rewardShards') &&
      optionalRewardIsValid('rewardTokens') &&
      optionalRewardIsValid('rewardXp')
    );
  });
}

function parsePlayerStateValue(value: unknown, depth = 0): PlayerState | null {
  if (depth > 6 || value == null) return null;

  if (typeof value === 'string') {
    const parsed = parseStoredJson<unknown>(value);
    if (parsed === null) return null;
    return parsePlayerStateValue(parsed, depth + 1);
  }

  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  // A real PlayerState has these required top-level fields. Do not mistake a
  // Redis/proxy wrapper such as { value: '...' } for the save itself. Presence
  // alone is not enough: coercion of a malformed wallet can turn arithmetic into
  // NaN, which JSON.stringify silently persists as null.
  if ('coins' in record && 'shards' in record && 'totalRolls' in record) {
    const validCoreState =
      typeof record.coins === 'number' &&
      Number.isFinite(record.coins) &&
      record.coins >= 0 &&
      typeof record.shards === 'number' &&
      Number.isFinite(record.shards) &&
      record.shards >= 0 &&
      record.shards <= Number.MAX_SAFE_INTEGER &&
      Number.isSafeInteger(record.totalRolls) &&
      Number(record.totalRolls) >= 0 &&
      (
        record.stateRevision == null ||
        (Number.isSafeInteger(record.stateRevision) && Number(record.stateRevision) >= 0)
      );
    if (!validCoreState) return null;
    // A corrupt offline vault is recoverable progress data, not a reason to brick
    // the whole account save. Normalize it before any caller can process a batch.
    const normalizedWalletShards = roundShardAmount(record.shards);
    const normalizedRecord = {
      ...record,
      shards: normalizedWalletShards,
      lifetimeShards: roundShardAmount(record.lifetimeShards ?? normalizedWalletShards),
      freeShardsEarnedToday: roundShardAmount(record.freeShardsEarnedToday ?? 0),
      shardPityRolls: 0,
      purchasedShards: Math.min(
        normalizeSafeInteger(record.purchasedShards, 0),
        normalizedWalletShards,
      ),
      offlineRolls: Math.min(
        MAX_OFFLINE_ROLLS,
        finiteNonNegativeInteger(record.offlineRolls, 0),
      ),
    };
    return normalizedRecord as unknown as PlayerState;
  }

  for (const key of ['value', 'state', 'player', 'data', 'payload', 'result']) {
    if (!(key in record)) continue;
    const nested = parsePlayerStateValue(record[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

function parsePaymentPlayerState(raw: unknown): PlayerState {
  // Payment fulfillment must tolerate the same Redis representations that the
  // normal loader can encounter, including nested wrappers and double-encoded
  // JSON strings from older saves or migration layers.
  let parsed: unknown = raw;

  for (let depth = 0; depth < 12; depth++) {
    if (typeof parsed === 'string') {
      const decoded = parseStoredJson<unknown>(parsed);
      if (decoded === null) break;
      parsed = decoded;
      continue;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) break;

    const record = parsed as Record<string, unknown>;
    // A wrapper can contain incidental familiar keys alongside a nested save.
    // Only validate a record as a PlayerState when all required core fields exist.
    const looksLikePlayerState =
      'coins' in record &&
      'shards' in record &&
      'totalRolls' in record;

    if (looksLikePlayerState) {
      const validatedState = parsePlayerStateValue(record);
      if (!validatedState) {
        throw new Error('Saved player data could not be read; the purchase was not applied.');
      }
      const base = createInitialState();
      const upgrades = record.upgrades && typeof record.upgrades === 'object' && !Array.isArray(record.upgrades)
        ? record.upgrades as Record<string, unknown>
        : {};
      const prestigeUpgrades = record.prestigeUpgrades && typeof record.prestigeUpgrades === 'object' && !Array.isArray(record.prestigeUpgrades)
        ? record.prestigeUpgrades as Record<string, unknown>
        : {};
      const normalizedWalletShards = roundShardAmount(record.shards);
      const normalizedPurchasedShards = Math.min(
        normalizeSafeInteger(record.purchasedShards, base.purchasedShards ?? 0),
        Math.floor(normalizedWalletShards),
      );
      const normalizedGlobalBoosterCredits = normalizeSafeInteger(
        record.globalBoosterCredits,
        base.globalBoosterCredits ?? 0,
      );

      return {
        ...base,
        ...validatedState,
        shards: normalizedWalletShards,
        shardPityRolls: 0,
        purchasedShards: normalizedPurchasedShards,
        purchasedShardLots: normalizeEntitlementLots(
          record.purchasedShardLots,
          normalizedPurchasedShards,
          true,
        ),
        globalBoosterCredits: normalizedGlobalBoosterCredits,
        globalBoosterCreditLots: normalizeEntitlementLots(
          record.globalBoosterCreditLots,
          normalizedGlobalBoosterCredits,
        ),
        upgrades: { ...base.upgrades, ...upgrades },
        prestigeUpgrades: { ...base.prestigeUpgrades, ...prestigeUpgrades },
        collection: (record.collection && typeof record.collection === 'object' && !Array.isArray(record.collection))
          ? record.collection as Record<string, number>
          : base.collection,
        claimedAchievements: Array.isArray(record.claimedAchievements)
          ? record.claimedAchievements as string[]
          : base.claimedAchievements,
        activeCosmetic: 'default',
        unlockedCosmetics: ['default'],
        dailyQuests: Array.isArray(record.dailyQuests)
          ? record.dailyQuests as PlayerState['dailyQuests']
          : base.dailyQuests,
        weeklyQuests: Array.isArray(record.weeklyQuests)
          ? record.weeklyQuests as PlayerState['weeklyQuests']
          : base.weeklyQuests,
        paymentReceipts: record.paymentReceipts && typeof record.paymentReceipts === 'object' && !Array.isArray(record.paymentReceipts)
          ? record.paymentReceipts as PlayerState['paymentReceipts']
          : {},
      };
    }

    let nestedFound = false;
    for (const key of ['value', 'state', 'player', 'data', 'payload', 'result']) {
      if (!(key in record)) continue;
      parsed = record[key];
      nestedFound = true;
      break;
    }
    if (!nestedFound) break;
  }

  throw new Error('Saved player data could not be read; the purchase was not applied.');
}

export async function hasReadablePlayerSave(userId: string): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  try {
    const storedRaw = await redis.get(playerKeyFor(id));
    const raw = await readStoredPlayerSave(id, storedRaw);
    return raw !== null && parsePaymentPlayerState(raw) !== null;
  } catch {
    return false;
  }
}

export async function grantPurchasedPack(userId: string, sku: string, orderId: string): Promise<boolean> {
return withPlayerMutationLockFor(userId, async () => {
  const pack = paymentGoodsForSku(sku);
  const pkey = playerKeyFor(userId);
  const generationKey = saveGenerationKeyFor(userId);
  await appendPaymentDebugLog('grant:start', {
    userId,
    sku,
    orderId,
    playerKey: pkey,
    generationKey,
    packShards: pack.shards,
  });
  await ensureRedisStringKey(generationKey, '0');

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(pkey, generationKey);
    const generationRaw = await redis.get(generationKey);
    const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
    const storedRaw = await redis.get(pkey);
    const raw = await readStoredPlayerSave(userId, storedRaw);
    await appendPaymentDebugLog('grant:redis-read', {
      userId,
      sku,
      orderId,
      attempt,
      rawType: typeof raw,
      rawIsNull: raw == null,
      rawLength: typeof raw === 'string' ? raw.length : null,
      rawPreview: typeof raw === 'string' ? raw.slice(0, 2000) : raw,
      generation,
      generationRaw,
    });

    let state: PlayerState;
    if (raw == null) {
      state = createInitialState();
      state.username = 'reddit-user-' + userId.slice(-8);
      state.saveGeneration = generation;
    } else {
      let stored: PlayerState;
      try {
        stored = parsePaymentPlayerState(raw);
        await appendPaymentDebugLog('grant:parsed-save', {
          userId,
          sku,
          orderId,
          attempt,
          storedCoins: stored.coins,
          storedShards: stored.shards,
          storedTotalRolls: stored.totalRolls,
          storedSaveGeneration: stored.saveGeneration ?? null,
          hasPaymentReceipts: Boolean(stored.paymentReceipts),
          paymentReceiptCount: stored.paymentReceipts ? Object.keys(stored.paymentReceipts).length : 0,
        });
      } catch (error) {
        await appendPaymentDebugLog('grant:parse-failed', {
          userId,
          sku,
          orderId,
          attempt,
          playerKey: pkey,
          rawType: typeof raw,
          rawIsNull: raw == null,
          rawLength: typeof raw === 'string' ? raw.length : null,
          rawPreview: typeof raw === 'string' ? raw.slice(0, 12000) : raw,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      const storedGeneration = Math.max(0, Math.floor(Number(stored.saveGeneration ?? 0)));

      // A generation mismatch means an admin wipe happened after this save was
      // created. Never resurrect that old save just because a payment arrived.
      // Start from the current generation and then apply the paid entitlement.
      if (storedGeneration !== generation) {
        state = createInitialState();
        state.username = stored.username ?? ('reddit-user-' + userId.slice(-8));
        state.saveGeneration = generation;
      } else {
        state = stored;
        state.saveGeneration = generation;
        state.username = state.username ?? ('reddit-user-' + userId.slice(-8));
      }
    }

    await ensureCodexStorageVersion(userId, generation, state);
    await appendPaymentDebugLog('grant:state-selected', {
      userId,
      sku,
      orderId,
      attempt,
      stateSaveGeneration: state.saveGeneration ?? null,
      stateCoins: state.coins,
      stateShards: state.shards,
    });

    state.paymentReceipts = state.paymentReceipts ?? {};
    const existingReceipt = state.paymentReceipts[orderId];
    if (
      existingReceipt === 'fulfilled' ||
      (existingReceipt && typeof existingReceipt === 'object' && existingReceipt.status === 'fulfilled')
    ) {
      await appendPaymentDebugLog('grant:already-fulfilled', { userId, sku, orderId, attempt });
      await txn.unwatch();
      return false;
    }
    if (
      existingReceipt === 'refunded' ||
      (existingReceipt && typeof existingReceipt === 'object' && existingReceipt.status === 'refunded')
    ) {
      await appendPaymentDebugLog('grant:already-refunded', { userId, sku, orderId, attempt });
      await txn.unwatch();
      return false;
    }

    const currentShardBalance = roundShardAmount(state.shards);
    const currentBoosterCreditBalance = normalizeSafeInteger(state.globalBoosterCredits, 0);
    if (pack.shards > Number.MAX_SAFE_INTEGER - currentShardBalance) {
      await txn.unwatch();
      throw new Error('Shard balance has reached its supported storage limit; spend Shards before reconciling this purchase.');
    }
    if (pack.globalBoosterCredits > Number.MAX_SAFE_INTEGER - currentBoosterCreditBalance) {
      await txn.unwatch();
      throw new Error('Global Booster credit balance has reached its supported storage limit; use credits before reconciling this purchase.');
    }

    // Refuse before touching entitlement lots or the receipt: revisions must never wrap.
    const currentRevision = normalizeSafeInteger(state.stateRevision, 0);
    if (currentRevision >= Number.MAX_SAFE_INTEGER) {
      await txn.unwatch();
      throw new Error('Player state revision is exhausted; no purchase was applied.');
    }

    const existingPurchasedShards = Math.min(
      normalizeSafeInteger(state.purchasedShards, 0),
      Math.floor(currentShardBalance),
    );
    state.purchasedShards = existingPurchasedShards;
    state.shards = currentShardBalance;
    state.globalBoosterCredits = currentBoosterCreditBalance;
    state.purchasedShardLots = normalizeEntitlementLots(
      state.purchasedShardLots,
      existingPurchasedShards,
      true,
    );
    state.purchasedShardLots[orderId] =
      normalizeSafeInteger(state.purchasedShardLots[orderId], 0) + pack.shards;

    const existingCredits = normalizeSafeInteger(state.globalBoosterCredits, 0);
    state.globalBoosterCredits = existingCredits;
    state.globalBoosterCreditLots = normalizeEntitlementLots(
      state.globalBoosterCreditLots,
      existingCredits,
    );
    state.globalBoosterCreditLots[orderId] =
      normalizeSafeInteger(state.globalBoosterCreditLots[orderId], 0) + pack.globalBoosterCredits;

    state.stateRevision = currentRevision + 1;
    state.shards = roundShardAmount(currentShardBalance + pack.shards);
    state.purchasedShards = existingPurchasedShards + pack.shards;
    // Lifetime Shards are telemetry, not a spendable balance. Saturate the
    // counter rather than allowing an unsafe integer into persisted state.
    const lifetimeShards = roundShardAmount(state.lifetimeShards ?? currentShardBalance);
    state.lifetimeShards = roundShardAmount(Math.min(Number.MAX_SAFE_INTEGER, lifetimeShards + pack.shards));
    state.globalBoosterCredits = currentBoosterCreditBalance + pack.globalBoosterCredits;
    const receipt: PaymentReceipt = {
      status: 'fulfilled',
      shards: pack.shards,
      globalBoosterCredits: pack.globalBoosterCredits,
    };
    state.paymentReceipts[orderId] = receipt;

    await appendPaymentDebugLog('grant:about-to-write', {
      userId,
      sku,
      orderId,
      attempt,
      nextShards: state.shards,
      purchasedShards: state.purchasedShards,
      lifetimeShards: state.lifetimeShards,
    });

    let writePlan: PlayerSaveWritePlan | null = null;
    let writeCommitted = false;
    try {
      writePlan = await createPlayerSaveWritePlan(userId, serializePlayerStateForRedis(state));
      await txn.multi();
      await txn.set(pkey, writePlan.storedValue);
      const committed = await txn.exec();
      if (committed !== null) {
        writeCommitted = true;
        await cleanupPreviousPlayerSave(userId, storedRaw);
        if (state.collectionStorageVersion === CODEX_STORAGE_VERSION) await deleteLegacyCodexShards(userId, generation);
        await appendPaymentDebugLog('grant:success', {
        userId,
        sku,
        orderId,
        attempt,
        committed: true,
      });
        return true;
      }
    } finally {
      if (!writeCommitted) {
        await txn.unwatch().catch(() => undefined);
        if (writePlan) await discardPlayerSaveWritePlan(writePlan);
      }
    }

    await appendPaymentDebugLog('grant:write-conflict', {
      userId, sku, orderId, attempt,
    });
  }

  await appendPaymentDebugLog('grant:exhausted', { userId, sku, orderId });
  throw new Error('Could not safely fulfill the purchase. Please retry.');
  });
}

export async function refundPurchasedPack(userId: string, sku: string, orderId: string): Promise<void> {
  return withPlayerMutationLockFor(userId, async () => {
    const pack = paymentGoodsForSku(sku);
    const pkey = playerKeyFor(userId);
    const generationKey = saveGenerationKeyFor(userId);
    await ensureRedisStringKey(generationKey, '0');

    for (let attempt = 0; attempt < 6; attempt++) {
      const txn = await redis.watch(pkey, generationKey);
      const generationRaw = await redis.get(generationKey);
      const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
      const storedRaw = await redis.get(pkey);
      const raw = await readStoredPlayerSave(userId, storedRaw);
      if (raw == null) {
        await txn.unwatch();
        return;
      }
      const state = parsePaymentPlayerState(raw);
      const stateGeneration = Math.max(0, Math.floor(Number(state.saveGeneration ?? 0)) || 0);
      if (stateGeneration !== generation) {
        await txn.unwatch();
        throw new Error('The payment arrived for an invalidated player save. Please reconcile the purchase again.');
      }
      await ensureCodexStorageVersion(userId, generation, state);

      state.paymentReceipts = state.paymentReceipts ?? {};
      const receipt = state.paymentReceipts[orderId];
      if (!receipt) {
        await txn.unwatch();
        return;
      }
      const isFulfilled =
        receipt === 'fulfilled' ||
        (typeof receipt === 'object' && receipt.status === 'fulfilled');
      if (!isFulfilled) {
        await txn.unwatch();
        return;
      }

      const grantedShards = typeof receipt === 'string'
        ? pack.shards
        : normalizeSafeInteger(receipt.shards, pack.shards);
      state.purchasedShardLots = normalizeEntitlementLots(
        state.purchasedShardLots,
        state.purchasedShards,
        true,
      );
      const orderShardLot = normalizeSafeInteger(state.purchasedShardLots[orderId], 0);
      const legacyShardPool = typeof receipt === 'string'
        ? normalizeSafeInteger(state.purchasedShardLots.legacy, 0)
        : 0;
      const shardLotKey = orderShardLot > 0 ? orderId : 'legacy';
      const refundableShards = Math.min(
        grantedShards,
        orderShardLot > 0 ? orderShardLot : legacyShardPool,
        normalizeSafeInteger(state.purchasedShards, 0),
        normalizeSafeInteger(state.shards, 0),
      );
      if (refundableShards > 0) {
        state.shards = Math.max(0, (state.shards ?? 0) - refundableShards);
        state.purchasedShards = Math.max(0, (state.purchasedShards ?? 0) - refundableShards);
        state.purchasedShardLots[shardLotKey] =
          Math.max(0, normalizeSafeInteger(state.purchasedShardLots[shardLotKey], 0) - refundableShards);
        if (state.purchasedShardLots[shardLotKey] <= 0) delete state.purchasedShardLots[shardLotKey];
      }

      const grantedCredits = typeof receipt === 'string'
        ? pack.globalBoosterCredits
        : normalizeSafeInteger(receipt.globalBoosterCredits, pack.globalBoosterCredits);
      state.globalBoosterCreditLots = normalizeEntitlementLots(
        state.globalBoosterCreditLots,
        state.globalBoosterCredits,
      );
      const orderCreditLot = normalizeSafeInteger(state.globalBoosterCreditLots[orderId], 0);
      const legacyCreditPool = typeof receipt === 'string'
        ? normalizeSafeInteger(state.globalBoosterCreditLots.legacy, 0)
        : 0;
      const creditLotKey = orderCreditLot > 0 ? orderId : 'legacy';
      const refundableCredits = Math.min(
        grantedCredits,
        orderCreditLot > 0 ? orderCreditLot : legacyCreditPool,
        normalizeSafeInteger(state.globalBoosterCredits, 0),
      );
      if (refundableCredits > 0) {
        state.globalBoosterCredits = Math.max(0, (state.globalBoosterCredits ?? 0) - refundableCredits);
        state.globalBoosterCreditLots[creditLotKey] =
          Math.max(0, normalizeSafeInteger(state.globalBoosterCreditLots[creditLotKey], 0) - refundableCredits);
        if (state.globalBoosterCreditLots[creditLotKey] <= 0) delete state.globalBoosterCreditLots[creditLotKey];
      }

      const currentRevision = normalizeSafeInteger(state.stateRevision, 0);
      if (currentRevision >= Number.MAX_SAFE_INTEGER) {
        await txn.unwatch();
        throw new Error('Player state revision is exhausted; no refund was applied.');
      }
      state.saveGeneration = generation;
      state.stateRevision = currentRevision + 1;
      state.paymentReceipts[orderId] = {
        status: 'refunded',
        shards: grantedShards,
        globalBoosterCredits: grantedCredits,
      };

      let writePlan: PlayerSaveWritePlan | null = null;
      let writeCommitted = false;
      try {
        writePlan = await createPlayerSaveWritePlan(userId, serializePlayerStateForRedis(state));
        await txn.multi();
        await txn.set(pkey, writePlan.storedValue);
        const committed = await txn.exec();
        if (committed !== null) {
          writeCommitted = true;
          await cleanupPreviousPlayerSave(userId, storedRaw);
          if (state.collectionStorageVersion === CODEX_STORAGE_VERSION) await deleteLegacyCodexShards(userId, generation);
          return;
        }
      } finally {
        if (!writeCommitted) {
          await txn.unwatch().catch(() => undefined);
          if (writePlan) await discardPlayerSaveWritePlan(writePlan);
        }
      }
    }

    throw new Error('Could not safely process the refund.');
  });
}
const RIFT_ARCHIVE_KEY_PREFIX = 'io:rift-challenge:v1:';

interface ActiveRiftRunContext {
  runId: string;
  challengeId: string;
  targetRarity: number;
  baseCooldownMs: number;
  riftLuckPerkLevel: number;
  riftSpeedPerkLevel: number;
  temporalDragMultiplier: number;
  temporalArbitrageLevel: number;
  temporalCompressionLevel: number;
  probabilityDebtLevel: number;
  fractureCascadeLevel: number;
  echoChamberLevel: number;
  singularityFocusLevel: number;
  bossResonanceLevel: number;
  masteryBridgeLevel: number;
  runeReconnectionLevel: number;
  automationOverrideLevel: number;
  chronoEngineLevel: number;
  combatIntegrationLevel: number;
  initialCalibrationLevel: number;
  earlyAuthorizationLevel: number;
  riftConditioningLevel: number;
  riftConditioningCompletions: number;
  fortuneReservoirLevel: number;
  criticalConversionLevel: number;
  fractureRecyclingLevel: number;
  emergencyProtocolLevel: number;
  milestoneAmplifierLevel: number;
  anomalyHarvestingLevel: number;
  anomalyForecasterLevel: number;
  mutationStabilizerLevel: number;
  mutationAmplifierLevel: number;
  mutationExtractionLevel: number;
  anomalyPersistenceLevel: number;
  activeMutation: { id: string; startedAtRoll: number; endsAtRoll: number } | null;
  emergencyProtocolUntilRoll: number;
  emergencyProtocolCharges: number;
  challengeCoinMultiplier: number;
  upgradeLevels: { fortune: number; speed: number; prosperity: number; critical: number };
  gameState: PlayerState;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readActiveRiftRun(userId: string): Promise<ActiveRiftRunContext | null> {
  const raw = await redis.get(RIFT_ARCHIVE_KEY_PREFIX + userId);
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const archive = JSON.parse(raw) as Record<string, unknown>;
    const run = isPlainRecord(archive.activeRun) ? archive.activeRun : null;
    if (!run || run.status !== 'active' || typeof run.runId !== 'string') return null;
    const challenge = getRiftChallengeDefinition(run.challengeId);
    if (!challenge) return null;
    const levels = isPlainRecord(run.upgradeLevels) ? run.upgradeLevels : {};
    let gameState: PlayerState;
    if (isPlainRecord(run.gameState)) {
      gameState = run.gameState as unknown as PlayerState;
    } else {
      // Migrate an in-progress legacy challenge without importing any main-save variables.
      gameState = createInitialState(safeNonNegativeTimestamp(run.startedAt) || Date.now());
      gameState.username = String(context.username ?? '').slice(0, 100) || undefined;
      gameState.coins = Math.max(50, Number(run.coins) || 0);
      gameState.lifetimeCoins = gameState.coins;
      gameState.totalRolls = safeNonNegativeInteger(run.totalRolls);
      gameState.highestRarity = Math.max(0, Number(run.bestRarity) || 0);
      gameState.saveGeneration = 0;
      gameState.stateRevision = 0;
    }
    const riftPerks = isPlainRecord(archive.riftPerkLevels) ? archive.riftPerkLevels : {};
    if (safeNonNegativeInteger(riftPerks.automationOverride) > 0) {
      gameState.upgrades = { ...gameState.upgrades, auto: Math.max(1, gameState.upgrades?.auto ?? 0) };
      gameState.manualRolls = Math.max(3, gameState.manualRolls ?? 0);
    }
    if (safeNonNegativeInteger(riftPerks.chronoEngine) > 0) {
      gameState.masterySkills = {
        ...gameState.masterySkills,
        cooldownReclaimer: Math.max(1, gameState.masterySkills?.cooldownReclaimer ?? 0),
      };
    }
    const runId = run.runId.slice(0, 120);
    const codexOwnerId = riftCodexOwnerId(userId, runId);
    const inlineCollection = isValidCollection(gameState.collection)
      ? normalizeCodexCollection(gameState.collection)
      : {};
    const storedCollection = await readCodexShards(codexOwnerId, 0);
    if (Object.keys(storedCollection).length === 0 && Object.keys(inlineCollection).length > 0) {
      await migrateLegacyCodex(codexOwnerId, 0, inlineCollection);
      gameState.collection = inlineCollection;
    } else {
      gameState.collection = storedCollection;
    }
    gameState.collectionStorageVersion = CODEX_STORAGE_VERSION;
    return {
      runId,
      challengeId: challenge.id,
      targetRarity: challenge.targetRarity,
      baseCooldownMs: challenge.baseCooldownMs,
      riftLuckPerkLevel: safeNonNegativeInteger(riftPerks.riftLuck),
      riftSpeedPerkLevel: safeNonNegativeInteger(riftPerks.riftSpeed),
      temporalDragMultiplier: normalizeRiftTemporalDragMultiplier(run.temporalDragMultiplier),
      temporalArbitrageLevel: safeNonNegativeInteger(riftPerks.temporalArbitrage),
      temporalCompressionLevel: safeNonNegativeInteger(riftPerks.temporalCompression),
      probabilityDebtLevel: safeNonNegativeInteger(riftPerks.probabilityDebt),
      fractureCascadeLevel: safeNonNegativeInteger(riftPerks.fractureCascade),
      echoChamberLevel: safeNonNegativeInteger(riftPerks.echoChamber),
      singularityFocusLevel: safeNonNegativeInteger(riftPerks.singularityFocus),
      bossResonanceLevel: safeNonNegativeInteger(riftPerks.bossResonance),
      masteryBridgeLevel: safeNonNegativeInteger(riftPerks.masteryBridge),
      runeReconnectionLevel: safeNonNegativeInteger(riftPerks.runeReconnection),
      automationOverrideLevel: safeNonNegativeInteger(riftPerks.automationOverride),
      chronoEngineLevel: safeNonNegativeInteger(riftPerks.chronoEngine),
      combatIntegrationLevel: safeNonNegativeInteger(riftPerks.combatIntegration),
      initialCalibrationLevel: safeNonNegativeInteger(riftPerks.initialCalibration),
      earlyAuthorizationLevel: safeNonNegativeInteger(riftPerks.earlyAuthorization),
      riftConditioningLevel: safeNonNegativeInteger(riftPerks.riftConditioning),
      riftConditioningCompletions: Array.isArray(archive.completedChallengeIds) ? archive.completedChallengeIds.length : 0,
      fortuneReservoirLevel: safeNonNegativeInteger(riftPerks.fortuneReservoir),
      criticalConversionLevel: safeNonNegativeInteger(riftPerks.criticalConversion),
      fractureRecyclingLevel: safeNonNegativeInteger(riftPerks.fractureRecycling),
      emergencyProtocolLevel: safeNonNegativeInteger(riftPerks.emergencyProtocol),
      milestoneAmplifierLevel: safeNonNegativeInteger(riftPerks.milestoneAmplifier),
      anomalyHarvestingLevel: safeNonNegativeInteger(riftPerks.anomalyHarvesting),
      anomalyForecasterLevel: safeNonNegativeInteger(riftPerks.anomalyForecaster),
      mutationStabilizerLevel: safeNonNegativeInteger(riftPerks.mutationStabilizer),
      mutationAmplifierLevel: safeNonNegativeInteger(riftPerks.mutationAmplifier),
      mutationExtractionLevel: safeNonNegativeInteger(riftPerks.mutationExtraction),
      anomalyPersistenceLevel: safeNonNegativeInteger(riftPerks.anomalyPersistence),
      activeMutation: isPlainRecord(run.activeMutation) && typeof run.activeMutation.id === 'string' &&
        Number.isSafeInteger(run.activeMutation.startedAtRoll) && Number.isSafeInteger(run.activeMutation.endsAtRoll)
        ? {
            id: run.activeMutation.id.slice(0, 60),
            startedAtRoll: safeNonNegativeInteger(run.activeMutation.startedAtRoll),
            endsAtRoll: safeNonNegativeInteger(run.activeMutation.endsAtRoll),
          }
        : null,
      emergencyProtocolUntilRoll: safeNonNegativeInteger(run.emergencyProtocolUntilRoll),
      emergencyProtocolCharges: Math.max(
        0,
        safeNonNegativeInteger(riftPerks.emergencyProtocol) +
          safeNonNegativeInteger(riftPerks.advancedDeployment) -
          safeNonNegativeInteger(run.emergencyProtocolsUsed),
      ),
      challengeCoinMultiplier: challenge.coinMultiplier,
      upgradeLevels: {
        fortune: safeNonNegativeInteger(levels.fortune),
        speed: safeNonNegativeInteger(levels.speed),
        prosperity: safeNonNegativeInteger(levels.prosperity),
        critical: safeNonNegativeInteger(levels.critical),
      },
      gameState,
    };
  } catch (error) {
    console.error('[Rift Save] Could not read the active Rift archive.', error);
    throw new Error('Your active Rift save could not be read safely. Your main save has not been changed.');
  }
}

function riftCodexOwnerId(userId: string, runId: string): string {
  return userId + ':rift:' + runId;
}

function safeNonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(0, number) : 0;
}

function safeNonNegativeTimestamp(value: unknown): number {
  return safeNonNegativeInteger(value);
}

function advanceStoredRiftProgress(archive: Record<string, unknown>, now: number): void {
  const completed = Array.isArray(archive.completedChallengeIds)
    ? archive.completedChallengeIds.filter((id): id is string => typeof id === 'string')
    : [];
  const levels = isPlainRecord(archive.riftPerkLevels) ? archive.riftPerkLevels : {};
  const rate = riftRatePerHour(completed, levels as never);
  const last = archive.riftLastAccruedAt == null ? now : safeNonNegativeInteger(archive.riftLastAccruedAt);
  const progress = Number(archive.riftProgress);
  const accrued = Math.max(0, Number.isFinite(progress) ? progress : 0) + Math.max(0, now - last) / 3_600_000 * rate;
  const whole = Math.floor(accrued);
  const points = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(archive.riftPoints) + whole);
  const earned = Math.max(0, points - safeNonNegativeInteger(archive.riftPoints));
  archive.riftPoints = points;
  archive.totalRiftPointsEarned = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(archive.totalRiftPointsEarned) + earned);
  archive.riftProgress = points >= Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, accrued - whole);
  archive.riftRatePerHour = rate;
  archive.riftLastAccruedAt = now;
}

function serializeRiftPlayerState(state: PlayerState, revision: number): PlayerState {
  const stored: Record<string, unknown> = { ...state, stateRevision: revision, saveGeneration: 0 };
  delete stored.collection;
  delete stored.riftSession;
  delete stored.riftRunComplete;
  delete stored.riftChallengeFirstClear;
  delete stored.frenzyShardPopupPending;
  delete stored.riftSaveContext;
  delete stored.gameBan;
  delete stored.onlinePlayers;
  delete stored.guildPerks;
  delete stored.guildCombo;
  delete stored.globalBoosters;
  delete stored.dailyStreakCommunity;
  delete stored.codexChain;
  delete stored.codexDevotionLuckPercent;
  return JSON.parse(JSON.stringify(stored)) as PlayerState;
}

export async function deleteRiftCodexForRun(runId: string): Promise<void> {
  const ownerId = riftCodexOwnerId(currentUserId(), String(runId ?? '').slice(0, 120));
  await Promise.all(Array.from({ length: CODEX_SHARD_COUNT }, (_, shard) =>
    redis.del(codexShardKey(ownerId, 0, shard)),
  ));
}

async function saveActiveRiftPlayerState(
  state: PlayerState,
  allExtraWrites: SaveExtraWrite[],
): Promise<void> {
  const session = state.riftSession;
  if (!session) throw new Error('RIFT_SESSION_MISSING');
  if (session.challengeId === 'first-spark') {
    state.shards = 0;
    state.lifetimeShards = 0;
    state.freeShardsEarnedToday = 0;
    state.shardPityRolls = 0;
  }
  const userId = currentUserId();
  const expectedTicketKey = rollTicketKey(userId, session.runId);
  const ticketWrites = allExtraWrites.filter(write => write.key === expectedTicketKey);
  const unsupportedRequiredWrites = allExtraWrites.filter(write => write.key !== expectedTicketKey && !write.optional);
  if (ticketWrites.length > 1 || unsupportedRequiredWrites.length > 0) {
    throw new Error('This shared-account reward is unavailable while an isolated Rift challenge is active.');
  }

  state.codexChain = highestCodexChain(state.collection);
  state.codexDevotionLuckPercent = codexDevotionLuckPercent(
    state.masterySkills?.celestialSurge ?? 0,
    state.codexChain,
  );
  const keyName = RIFT_ARCHIVE_KEY_PREFIX + userId;
  const codexOwnerId = riftCodexOwnerId(userId, session.runId);
  const dirtyCodexKeys = pendingCodexRarityWrites.get(state) ?? new Set<string>();
  const codexWrites = state.collectionStorageVersion === CODEX_STORAGE_VERSION && dirtyCodexKeys.size > 0
    ? groupCodexFields(Array.from(dirtyCodexKeys, rarityKey => [rarityKey, Number(state.collection?.[rarityKey] ?? 0)] as const))
    : [];
  const codexWriteKeys = codexWrites.map(write => codexShardKey(codexOwnerId, 0, write.shard));
  const now = Date.now();
  await touchPlayerActivity(userId, String(state.username ?? context.username ?? userId));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const txn = await redis.watch(keyName, ...ticketWrites.map(write => write.key), ...codexWriteKeys);
    let transactionClosed = false;
    try {
      const [raw, ...ticketRawValues] = await Promise.all([
        redis.get(keyName),
        ...ticketWrites.map(write => redis.get(write.key)),
      ]);
      if (typeof raw !== 'string' || !raw) {
        await txn.unwatch();
        transactionClosed = true;
        throw new Error('RIFT_RUN_ENDED');
      }
      const archive = JSON.parse(raw) as Record<string, unknown>;
      const run = isPlainRecord(archive.activeRun) ? archive.activeRun : null;
      if (!run || run.status !== 'active' || run.runId !== session.runId) {
        await txn.unwatch();
        transactionClosed = true;
        throw new Error('RIFT_RUN_ENDED');
      }
      const challenge = getRiftChallengeDefinition(run.challengeId);
      if (!challenge || challenge.id !== session.challengeId) {
        await txn.unwatch();
        transactionClosed = true;
        throw new Error('RIFT_RUN_MISMATCH');
      }

      for (let index = 0; index < ticketWrites.length; index += 1) {
        const actual = ticketRawValues[index] == null ? null : String(ticketRawValues[index]);
        if (actual !== ticketWrites[index].expectedValue) {
          await txn.unwatch();
          transactionClosed = true;
          throw new Error('Roll ticket changed before the Rift save. Please refresh and try again.');
        }
      }
      const latestGameState = isPlainRecord(run.gameState)
        ? run.gameState as unknown as PlayerState
        : null;
      const latestRevision = safeNonNegativeInteger(latestGameState?.stateRevision);
      const expectedRevision = safeNonNegativeInteger(state.stateRevision);
      if (latestGameState && latestRevision !== expectedRevision) {
        await txn.unwatch();
        transactionClosed = true;
        throw new Error('Rift player state changed in another tab. Refresh before continuing.');
      }
      const nextRevision = latestRevision + 1;
      if (!Number.isSafeInteger(nextRevision)) {
        await txn.unwatch();
        transactionClosed = true;
        throw new Error('Rift player save reached its revision limit.');
      }

      const riftPerkLevels = isPlainRecord(archive.riftPerkLevels) ? archive.riftPerkLevels : {};
      const interest = accrueRiftDimensionalInterest(
        state.coins,
        state.lifetimeCoins ?? state.coins,
        run.lastInterestAt,
        run.startedAt,
        safeNonNegativeInteger(riftPerkLevels.dimensionalInterest),
        now,
      );
      state.coins = interest.coins;
      state.lifetimeCoins = interest.lifetimeCoins;
      run.lastInterestAt = interest.lastInterestAt;
      const storedState = serializeRiftPlayerState(state, nextRevision);
      run.gameState = storedState;
      run.coins = storedState.coins;
      run.totalRolls = storedState.totalRolls;
      const riftBestRarity = Math.max(2, Number(storedState.highestRarity) || 2);
      run.bestRarity = riftBestRarity;
      run.updatedAt = now;
      archive.version = 3;
      advanceStoredRiftProgress(archive, now);

      const mutationLevels = isPlainRecord(archive.riftPerkLevels) ? archive.riftPerkLevels : {};
      const awardMutationCompletion = () => {
        run.completedMutations = safeNonNegativeInteger(run.completedMutations) + 1;
        const baseMutationReward = 1 +
          safeNonNegativeInteger(mutationLevels.mutationExtraction);
        const mutationMultiplier = run.activeMutation?.id === 'nullification' ? 2 : 1;
        const mutationReward = Math.min(Number.MAX_SAFE_INTEGER, baseMutationReward * mutationMultiplier);
        archive.riftPoints = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(archive.riftPoints) + mutationReward);
        archive.totalRiftPointsEarned = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(archive.totalRiftPointsEarned) + mutationReward);
        run.activeMutation = null;
      };
      if (run.activeMutation && storedState.totalRolls >= safeNonNegativeInteger(run.activeMutation.endsAtRoll)) {
        awardMutationCompletion();
      }

      const objectiveProgress = riftObjectiveProgress(riftBestRarity, challenge.targetRarity);
      const lastMutationRoll = safeNonNegativeInteger(run.lastMutationRoll);
      const mutationReady = storedState.totalRolls >= 20 &&
        objectiveProgress >= 0.25 &&
        (lastMutationRoll === 0 || storedState.totalRolls - lastMutationRoll >= 40);
      if (!run.activeMutation && (!Array.isArray(run.pendingMutationChoices) || run.pendingMutationChoices.length === 0) &&
          mutationReady && riftBestRarity < challenge.targetRarity) {
        const shuffled = RIFT_MUTATIONS.map(mutation => mutation.id);
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
          const random = new Uint32Array(1);
          globalThis.crypto.getRandomValues(random);
          const swapIndex = random[0] % (index + 1);
          [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }
        const choiceCount = safeNonNegativeInteger(mutationLevels.anomalyForecaster) > 0 ? 3 : 1;
        run.pendingMutationChoices = shuffled.slice(0, choiceCount);
        run.lastMutationRoll = storedState.totalRolls;
      }

      let completed = false;
      let firstClear = false;
      if (riftBestRarity >= challenge.targetRarity) {
        completed = true;
        if (run.activeMutation) awardMutationCompletion();
        run.pendingMutationChoices = [];
        run.status = 'completed';
        run.completedAt = now;
        archive.totalCompletedRuns = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(archive.totalCompletedRuns) + 1);
        const completedIds = Array.isArray(archive.completedChallengeIds)
          ? archive.completedChallengeIds.filter((id): id is string => typeof id === 'string')
          : [];
        firstClear = !completedIds.includes(challenge.id);
        if (firstClear) completedIds.push(challenge.id);
        archive.completedChallengeIds = completedIds;
        archive.riftPlayerProgress = {
          level: Math.max(1, safeNonNegativeInteger(storedState.level)),
          totalRolls: safeNonNegativeInteger(storedState.totalRolls),
          totalCrits: safeNonNegativeInteger(storedState.totalCrits),
          highestRarity: Math.max(2, Number(storedState.highestRarity) || 2),
          masteryPoints: safeNonNegativeInteger(storedState.masteryPoints),
        } satisfies RiftChallengeMainProgress;
        const baseReward = firstClear ? challenge.firstClearPoints : challenge.repeatClearPoints;
        const rewardMultiplier = riftOverkillRewardMultiplier(
          riftBestRarity,
          challenge.targetRarity,
          safeNonNegativeInteger(riftPerkLevels.overkill),
        );
        const reward = Math.min(Number.MAX_SAFE_INTEGER, Math.round(baseReward * rewardMultiplier));
        archive.riftPoints = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(archive.riftPoints) + reward);
        archive.totalRiftPointsEarned = Math.min(Number.MAX_SAFE_INTEGER, safeNonNegativeInteger(archive.totalRiftPointsEarned) + reward);
        const bestByChallenge = isPlainRecord(archive.bestRarityByChallenge) ? archive.bestRarityByChallenge : {};
        bestByChallenge[challenge.id] = Math.max(Number(bestByChallenge[challenge.id]) || 0, riftBestRarity);
        archive.bestRarityByChallenge = bestByChallenge;
        archive.riftRatePerHour = riftRatePerHour(completedIds, (isPlainRecord(archive.riftPerkLevels) ? archive.riftPerkLevels : {}) as never);
      }

      await txn.multi();
      await txn.set(keyName, JSON.stringify(archive));
      for (let index = 0; index < codexWrites.length; index += 1) {
        await txn.hSet(codexWriteKeys[index], codexWrites[index].fields);
      }
      for (const write of ticketWrites) {
        if (write.expiration) await txn.set(write.key, write.nextValue, { expiration: write.expiration });
        else await txn.set(write.key, write.nextValue);
      }
      const committed = await txn.exec();
      transactionClosed = true;
      if (committed !== null) {
        state.stateRevision = nextRevision;
        state.saveGeneration = 0;
        pendingSaveExtraWrites.delete(state);
        pendingCodexRarityWrites.delete(state);
        pendingSavePostCommitActions.delete(state);
        state.riftSaveContext = 'rift:' + session.runId;
        if (completed) {
          state.riftRunComplete = true;
          if (firstClear) {
            state.riftChallengeFirstClear = {
              challengeId: challenge.id,
              challengeName: challenge.name,
              runId: session.runId,
              completedAt: now,
              ownerId: userId,
              ownerUsername: String(context.username ?? state.username ?? 'Redditor').trim().replace(/^u[/]/i, '').slice(0, 32) || 'Redditor',
            };
          }
          delete state.riftSession;
          void deleteRiftCodexForRun(session.runId).catch(error => {
            console.error('[Rift Save] Completed challenge Codex cleanup failed:', error);
          });
        }
        return;
      }
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
    }
  }
  throw new Error('Rift save changed too frequently. Please retry.');
}

export async function loadRaw(options: { registerActivity?: boolean; persistMigrations?: boolean; source?: 'active' | 'main' } = {}): Promise<PlayerState> {
  const userId = currentUserId();
  const activeRiftRun = options.source === 'main' ? null : await readActiveRiftRun(userId);
  const isRiftSave = activeRiftRun !== null;
  const playerKey = key();
  const generationKey = saveGenerationKeyFor(userId);
  const generationRaw = isRiftSave ? '0' : await redis.get(generationKey);
  const generation = isRiftSave
    ? safeNonNegativeInteger(activeRiftRun.gameState.saveGeneration)
    : Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
  const storedRaw = isRiftSave ? null : await redis.get(playerKey);
  const raw = isRiftSave ? activeRiftRun.gameState : await readStoredPlayerSave(userId, storedRaw);
  const username = context.username ?? `reddit-user-${userId.slice(-8)}`;
  // Passive post previews may read player-specific eligibility without registering
  // an activity visit. Normal gameplay reads preserve the default registration.
  if (options.registerActivity !== false) await registerPlayer(userId, username);
  const [guildContext, globalBoosters, dailyStreakCommunity] = await Promise.all([
    getPlayerGuildContext(username, userId).catch(error => {
      console.error('[Guild] Context read failed; using zeroed modifiers until Guild data is repaired.', error);
      return {
        guildId: null,
        perks: {
          luckRank: 0, speedRank: 0, vaultRank: 0, shardRank: 0, critRank: 0,
          coinRank: 0, memberCapacityRank: 0, tokenYieldRank: 0, taskBountyRank: 0,
          comboRank: 0,
        },
        combo: createInitialState().guildCombo!,
      };
    }),
    getGlobalBoosters(),
    getDailyStreakCommunity().catch(error => {
      console.error('[Daily Streak] Shared event read failed; using display-only defaults.', error);
      return createInitialState().dailyStreakCommunity!;
    }),
  ]);
  const { perks, combo: guildCombo, guildId } = guildContext;


  if (raw == null) {
    const s = createInitialState();
    s.username = username;
    s.saveGeneration = generation;
    // Even an unsaved/brand-new account must participate in the same
    // monotonic client/server revision contract as a persisted account.
    s.stateRevision = 0;
    s.collectionStorageVersion = CODEX_STORAGE_VERSION;
    s.guildPerks = perks;
    s.guildCombo = guildCombo;
    s.globalBoosters = globalBoosters;
    s.dailyStreakCommunity = dailyStreakCommunity;
    playerGuildScopes.set(s, guildId);

    return s;
  }

  const parsed = parsePlayerStateValue(raw);
  if (!parsed) {
    throw new Error('Your Infinity Orbs save data could not be read. The stored save is not valid player data.');
  }

  // A wipe increments the generation before deleting the save. Any old request
  // that races the wipe can still write bytes, but those bytes are now invalid
  // and are discarded instead of resurrecting the old account.
  if ((parsed.saveGeneration ?? 0) !== generation) {
    const fresh = createInitialState();
    fresh.username = username;
    fresh.saveGeneration = generation;
    fresh.stateRevision = 0;
    fresh.collectionStorageVersion = CODEX_STORAGE_VERSION;
    fresh.guildPerks = perks;
    fresh.guildCombo = guildCombo;
    fresh.globalBoosters = globalBoosters;
    fresh.dailyStreakCommunity = dailyStreakCommunity;
    playerGuildScopes.set(fresh, guildId);

    return fresh;
  }

  const base = createInitialState();
  const storedCodexVersion = Number(parsed.collectionStorageVersion ?? 0);
  const needsCodexMigration = !isRiftSave && storedCodexVersion !== CODEX_STORAGE_VERSION;
  let restoredCollection: Record<string, number>;
  if (isRiftSave) {
    // Rift collections are stored inline in the challenge save, not in the
    // user's main Codex shard namespace.
    restoredCollection = normalizeCodexCollection(isValidCollection(parsed.collection) ? parsed.collection : {});
  } else if (storedCodexVersion === CODEX_STORAGE_VERSION) {
    restoredCollection = await readCodexShards(userId, generation);
    await deleteLegacyCodexShards(userId, generation);
  } else if (storedCodexVersion === 1) {
    restoredCollection = await readLegacyCodexShards(userId, generation);
    if (Object.keys(restoredCollection).length === 0 && isValidCollection(parsed.collection)) {
      restoredCollection = normalizeCodexCollection(parsed.collection);
    }
    await migrateLegacyCodex(userId, generation, restoredCollection);
  } else {
    restoredCollection = normalizeCodexCollection(isValidCollection(parsed.collection) ? parsed.collection : base.collection);
    await migrateLegacyCodex(userId, generation, restoredCollection);
  }
  const cleanParsed = { ...(parsed as PlayerState & Record<string, unknown>) };
  const normalizedPurchasedShards = Math.min(
    normalizeSafeInteger(parsed.purchasedShards, base.purchasedShards ?? 0),
    normalizeSafeInteger(Math.floor(Number(parsed.shards)), base.shards),
  );
  const normalizedGlobalBoosterCredits = normalizeSafeInteger(
    parsed.globalBoosterCredits,
    base.globalBoosterCredits ?? 0,
  );
  const normalizedPurchasedShardLots = normalizeEntitlementLots(
    parsed.purchasedShardLots,
    normalizedPurchasedShards,
    true,
  );
  const normalizedGlobalBoosterCreditLots = normalizeEntitlementLots(
    parsed.globalBoosterCreditLots,
    normalizedGlobalBoosterCredits,
  );
  const normalizedManualRolls = Math.min(
    10,
    finiteNonNegativeInteger(
      parsed.manualRolls ?? Math.min(Number(parsed.totalRolls ?? 0), 10),
      0,
    ),
  );
  const normalizedUpgrades = normalizeLevelRecord(
    parsed.upgrades,
    base.upgrades,
    STANDARD_UPGRADE_LEVEL_LIMITS,
  );
  // Auto Roll is free and unlocks automatically at 3 manual roll activations.
  normalizedUpgrades.auto = normalizedManualRolls >= 3 ? 1 : 0;
  const normalizedPrestigeUpgrades = normalizeLevelRecord(
    parsed.prestigeUpgrades,
    base.prestigeUpgrades,
    PRESTIGE_UPGRADE_LEVEL_LIMITS,
  );
  const normalizedMasterySkills = normalizeLevelRecord(
    parsed.masterySkills,
    base.masterySkills!,
    MASTERY_SKILL_LEVEL_LIMITS,
  );

  const parsedLevel = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(Number(parsed.level ?? 1) || 1)));
  const parsedXp = Math.max(0, Number(parsed.xp ?? 0) || 0);
  const calculatedLevel = calculateLevelFromXp(parsedXp).level;
  const storedLevelXpFloor = Number(parsed.levelXpFloor);
  let levelXpFloor = Number.isFinite(storedLevelXpFloor)
    ? Math.max(0, Math.min(parsedXp, storedLevelXpFloor))
    : parsedLevel > calculatedLevel
      ? parsedXp
      : totalXpRequiredBeforeLevel(parsedLevel);
  let restoredLevel = parsedLevel;

  // Existing Level 1,000 accounts could keep earning XP while the old cap was
  // active. Convert that banked XP into the new Paragon levels without granting
  // a second set of Mastery Points for levels that were previously capped.
  if (parsedLevel === LEVEL_EXPANSION_START) {
    const xpDerivedLevel = calculateLevelFromXp(parsedXp).level;
    if (xpDerivedLevel > LEVEL_EXPANSION_START) {
      restoredLevel = xpDerivedLevel;
      levelXpFloor = totalXpRequiredBeforeLevel(restoredLevel);
    }
  }

  const restored: PlayerState = {
    ...base,
    ...cleanParsed,
    coins: normalizeCoinAmount(parsed.coins),
    lifetimeCoins: normalizeCoinAmount(parsed.lifetimeCoins ?? parsed.coins),
    offlineRolls: Math.min(MAX_OFFLINE_ROLLS, finiteNonNegativeInteger(parsed.offlineRolls, base.offlineRolls)),
    purchasedShards: normalizedPurchasedShards,
    purchasedShardLots: normalizedPurchasedShardLots,
    globalBoosterCredits: normalizedGlobalBoosterCredits,
    globalBoosterCreditLots: normalizedGlobalBoosterCreditLots,
    activeBoosters: normalizeActiveBoosters(parsed.activeBoosters),
    automations: normalizeAutomations(parsed.automations),
    turboRollUntil: normalizeSafeInteger(parsed.turboRollUntil, base.turboRollUntil),
    lastFrenzyAt: normalizeCooldownTimestamp(parsed.lastFrenzyAt, base.lastFrenzyAt ?? 0),
    lastFrenzyClaimAt: normalizeCooldownTimestamp(parsed.lastFrenzyClaimAt, base.lastFrenzyClaimAt ?? 0),
    frenzyClaimsToday: (() => {
      const rawCount = Number(parsed.frenzyClaimsToday);
      if (Number.isSafeInteger(rawCount) && rawCount >= 0) return Math.min(FRENZY_CLAIMS_PER_DAY, rawCount);
      return String(parsed.lastFrenzyClaimDate ?? '') === new Date().toISOString().slice(0, 10) ? 1 : 0;
    })(),
    pendingFrenzyOfflineClaimCount: finiteNonNegativeInteger(parsed.pendingFrenzyOfflineClaimCount, 0),
    pendingFrenzyOfflineShards: finiteNonNegativeInteger(parsed.pendingFrenzyOfflineShards, 0),
    timeEnergy: Math.min(TIME_ENERGY_MAX_MS, finiteNonNegativeInteger(parsed.timeEnergy, base.timeEnergy ?? 0)),
    alignmentNextAt: finiteNonNegativeInteger(parsed.alignmentNextAt, base.alignmentNextAt ?? 0),
    alignmentPendingAt: finiteNonNegativeInteger(parsed.alignmentPendingAt, base.alignmentPendingAt ?? 0),
    alignmentPendingForced: parsed.alignmentPendingForced === true,
    alignmentActiveInstances: normalizeCelestialAlignmentInstances(parsed.alignmentActiveInstances, parsed.alignmentActiveChoice, parsed.alignmentActiveUntil),
    alignmentActiveUntil: finiteNonNegativeInteger(parsed.alignmentActiveUntil, base.alignmentActiveUntil ?? 0),
    alignmentActiveChoice: ['starseeker', 'goldenOrbit', 'clockwork'].includes(String(parsed.alignmentActiveChoice))
      ? parsed.alignmentActiveChoice as CelestialAlignmentChoice : null,
    lastShareAt: normalizeCooldownTimestamp(parsed.lastShareAt, base.lastShareAt ?? 0),
    lastRollAt: normalizeLastRollTimestamp(parsed.lastRollAt),
    level: restoredLevel,
    xp: finiteNonNegativeInteger(parsedXp, base.xp),
    levelXpFloor,
    upgrades: normalizedUpgrades,
    manualRolls: normalizedManualRolls,
    cosmicDust: finiteNonNegativeInteger(parsed.cosmicDust, base.cosmicDust),
    masteryPoints: finiteNonNegativeInteger(parsed.masteryPoints, base.masteryPoints ?? 0),
    totalCrits: finiteNonNegativeInteger(parsed.totalCrits, base.totalCrits),
    lifetimeShards: roundShardAmount(parsed.lifetimeShards ?? base.lifetimeShards),
    rollsSinceBest: finiteNonNegativeInteger(parsed.rollsSinceBest, base.rollsSinceBest),
    aftershockRecord: finiteNonNegativeInteger(parsed.aftershockRecord, base.aftershockRecord ?? 0),
    rollingSessionStartedAt: finiteNonNegativeInteger(parsed.rollingSessionStartedAt, base.rollingSessionStartedAt ?? 0),
    rollingSessionLastRollAt: finiteNonNegativeInteger(parsed.rollingSessionLastRollAt, base.rollingSessionLastRollAt ?? 0),
    longestRollingSessionMs: finiteNonNegativeInteger(parsed.longestRollingSessionMs, base.longestRollingSessionMs ?? 0),
    highestDryStreak: finiteNonNegativeInteger(parsed.highestDryStreak, base.highestDryStreak ?? 0),
    freeRolls: finiteNonNegativeInteger(parsed.freeRolls, base.freeRolls ?? 0),
    shardPityRolls: 0,
    currentRunRolls: finiteNonNegativeInteger(parsed.currentRunRolls, base.currentRunRolls ?? 0),
    prestigeCount: finiteNonNegativeInteger(parsed.prestigeCount, base.prestigeCount),
    collectionValue: finiteNonNegativeNumber(parsed.collectionValue, base.collectionValue),
    lifetimeCollectionValue: finiteNonNegativeNumber(parsed.lifetimeCollectionValue, base.lifetimeCollectionValue),
    highestRarity: finiteNonNegativeNumber(parsed.highestRarity, base.highestRarity),
    highestRarityIsInfinity: parsed.highestRarityIsInfinity === true,
    saveGeneration: generation,
    // Legacy saves predate stateRevision. Normalize them to revision zero so
    // delayed reads cannot bypass the client's stale-snapshot rejection.
    stateRevision: Math.max(0, Math.floor(Number(parsed.stateRevision ?? 0)) || 0),
    username,
    prestigeUpgrades: normalizedPrestigeUpgrades,
    combatAutoScrap: normalizeCombatAutoScrapSettings(parsed.combatAutoScrap, base.combatAutoScrap),
    // Malformed nested save shapes are optional progress data, not a reason to poison gameplay math.
    collection: restoredCollection,
    collectionStorageVersion: CODEX_STORAGE_VERSION,
    claimedAchievements: isStringList(parsed.claimedAchievements) ? parsed.claimedAchievements : base.claimedAchievements,
    streak: normalizePlayerStreak(parsed.streak, base.streak),
    // Corrupt quest entries must not make every later roll throw while advancing progress.
    dailyQuests: isValidQuestList(parsed.dailyQuests) ? parsed.dailyQuests : base.dailyQuests,
    weeklyQuests: isValidQuestList(parsed.weeklyQuests) ? parsed.weeklyQuests : base.weeklyQuests,
    // Cosmetics were removed from the game. Keep legacy save compatibility but
    // force every returning account onto the single default appearance.
    activeCosmetic: 'default',
    unlockedCosmetics: ['default'],
    sacrifices: {
      coinsSacrificed: finiteNonNegativeInteger(parsed.sacrifices?.coinsSacrificed, base.sacrifices!.coinsSacrificed),
      shardsSacrificed: finiteNonNegativeInteger(parsed.sacrifices?.shardsSacrificed, base.sacrifices!.shardsSacrificed),
      altarLevel: finiteNonNegativeInteger(parsed.sacrifices?.altarLevel, base.sacrifices!.altarLevel),
      luckSurgeUntil: finiteNonNegativeInteger(parsed.sacrifices?.luckSurgeUntil, base.sacrifices!.luckSurgeUntil),
      altarPity: finiteNonNegativeInteger(parsed.sacrifices?.altarPity, base.sacrifices!.altarPity ?? 0),
      altarInsuranceCredit: normalizeCoinAmount(parsed.sacrifices?.altarInsuranceCredit ?? 0),
    },
    masterySkills: normalizedMasterySkills,
    guildPerks: perks,
    guildCombo,
    globalBoosters: activeRiftRun ? createInitialState().globalBoosters : globalBoosters,
    dailyStreakCommunity: activeRiftRun ? createInitialState().dailyStreakCommunity : dailyStreakCommunity,
  };
  // Cosmic Dust has no gameplay wallet cap. Parser normalization still
  // enforces the safe-integer storage boundary for the Number-based save.
  playerGuildScopes.set(restored, guildId);
  if (activeRiftRun) {
    const isolatedDefaults = createInitialState();
    restored.guildPerks = isolatedDefaults.guildPerks;
    restored.guildCombo = isolatedDefaults.guildCombo;
    restored.riftSaveContext = 'rift:' + activeRiftRun.runId;
    restored.riftSession = {
      runId: activeRiftRun.runId,
      challengeId: activeRiftRun.challengeId,
      targetRarity: activeRiftRun.targetRarity,
      baseCooldownMs: activeRiftRun.baseCooldownMs,
      riftLuckPerkLevel: activeRiftRun.riftLuckPerkLevel,
      riftSpeedPerkLevel: activeRiftRun.riftSpeedPerkLevel,
      temporalDragMultiplier: activeRiftRun.temporalDragMultiplier,
      temporalArbitrageLevel: activeRiftRun.temporalArbitrageLevel,
      temporalCompressionLevel: activeRiftRun.temporalCompressionLevel,
      probabilityDebtLevel: activeRiftRun.probabilityDebtLevel,
      fractureCascadeLevel: activeRiftRun.fractureCascadeLevel,
      echoChamberLevel: activeRiftRun.echoChamberLevel,
      singularityFocusLevel: activeRiftRun.singularityFocusLevel,
      bossResonanceLevel: activeRiftRun.bossResonanceLevel,
      masteryBridgeLevel: activeRiftRun.masteryBridgeLevel,
      runeReconnectionLevel: activeRiftRun.runeReconnectionLevel,
      automationOverrideLevel: activeRiftRun.automationOverrideLevel,
      chronoEngineLevel: activeRiftRun.chronoEngineLevel,
      combatIntegrationLevel: activeRiftRun.combatIntegrationLevel,
      initialCalibrationLevel: activeRiftRun.initialCalibrationLevel,
      earlyAuthorizationLevel: activeRiftRun.earlyAuthorizationLevel,
      riftConditioningLevel: activeRiftRun.riftConditioningLevel,
      fortuneReservoirLevel: activeRiftRun.fortuneReservoirLevel,
      criticalConversionLevel: activeRiftRun.criticalConversionLevel,
      fractureRecyclingLevel: activeRiftRun.fractureRecyclingLevel,
      emergencyProtocolLevel: activeRiftRun.emergencyProtocolLevel,
      milestoneAmplifierLevel: activeRiftRun.milestoneAmplifierLevel,
      anomalyHarvestingLevel: activeRiftRun.anomalyHarvestingLevel,
      anomalyForecasterLevel: activeRiftRun.anomalyForecasterLevel,
      mutationStabilizerLevel: activeRiftRun.mutationStabilizerLevel,
      mutationAmplifierLevel: activeRiftRun.mutationAmplifierLevel,
      mutationExtractionLevel: activeRiftRun.mutationExtractionLevel,
      anomalyPersistenceLevel: activeRiftRun.anomalyPersistenceLevel,
      activeMutation: activeRiftRun.activeMutation,
      emergencyProtocolUntilRoll: activeRiftRun.emergencyProtocolUntilRoll,
      emergencyProtocolCharges: activeRiftRun.emergencyProtocolCharges,
      riftConditioningCompletions: activeRiftRun.riftConditioningCompletions,
      challengeCoinMultiplier: activeRiftRun.challengeCoinMultiplier,
      upgradeLevels: { ...activeRiftRun.upgradeLevels },
    };
  }
  // Persist one-time migrations rather than only changing the read view.
  const levelExpansionMigration = restoredLevel > parsedLevel;
  if (options.persistMigrations !== false && (levelExpansionMigration || needsCodexMigration)) {
    try {
      await save(restored);
    } catch (error) {
      if (levelExpansionMigration) {
        console.error('[Level] Paragon XP migration will retry on the next load.', error);
      } else {
        console.error('[Codex] Sharded collection migration will retry on the next load.', error);
      }
    }
  }
  return restored;
}

function applyXp(s: PlayerState, amount: number): void {
  s.xp += levelAdjustedXpReward(s.level || 1, amount);
  applyLevelProgress(s);
}

function applyQuestReward(s: PlayerState, quest: { rewardCoins: number; rewardShards?: number; rewardTokens?: number; rewardXp?: number; claimed: boolean }): { rewardCoins: number; rewardShards: number; rewardTokens: number } {
  quest.claimed = true;
  s.questsCompleted = (s.questsCompleted ?? 0) + 1;
  addCoins(s, quest.rewardCoins);
  const rewardShards = grantFreeShards(s, quest.rewardShards ?? 0);
  applyXp(s, quest.rewardXp ?? 0);
  return {
    rewardCoins: quest.rewardCoins,
    rewardShards,
    rewardTokens: 0,
  };
}

async function claimDailyStreakFromState(s: PlayerState): Promise<{ rewardCoins: number; rewardShards: number; rewardFreeRolls: number; day: number; community: import('../shared/game.js').DailyStreakCommunityEvent }> {
  const today = new Date().toISOString().slice(0, 10);
  if (s.streak.lastClaimDate === today) throw new Error('Already claimed daily reward for today.');

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const previousCount = s.streak.count;
  const previousLongest = s.streak.longestStreak;
  if (
    !Number.isSafeInteger(previousCount) || previousCount < 0 ||
    !Number.isSafeInteger(previousLongest) || previousLongest < 0
  ) {
    throw new Error('Saved Daily Streak data is invalid; no reward was granted.');
  }
  const nextStreakCount = s.streak.lastClaimDate === yesterday ? previousCount + 1 : 1;
  if (!Number.isSafeInteger(nextStreakCount)) {
    throw new Error('Daily Streak count reached its supported limit; no reward was granted.');
  }

  // Prepare/validate shared community progress only for the main account.
  // The Rift carries its own player streak but never writes to the shared event.
  let communityEvent = s.dailyStreakCommunity ?? createInitialState().dailyStreakCommunity!;
  if (!s.riftSession) {
    const communityUpdate = await prepareDailyStreakCommunityProgress(nextStreakCount);
    stageSaveExtraWrite(s, {
      key: communityUpdate.key,
      expectedValue: communityUpdate.expectedValue,
      nextValue: communityUpdate.nextValue,
      conflictMessage: 'Daily Streak community progress changed while claiming. Please retry.',
    });
    communityEvent = communityUpdate.event;
  }

  const day = ((nextStreakCount - 1) % 7) + 1;
  const rewardCoins = day * 100;
  const rewardShards = grantFreeShards(s, day === 7 ? 5 : day === 3 ? 1 : 0);
  const rewardFreeRolls = day * 5;

  s.streak.count = nextStreakCount;
  s.streak.longestStreak = Math.max(previousLongest, nextStreakCount);
  s.streak.lastClaimDate = today;
  s.freeRolls = (s.freeRolls ?? 0) + rewardFreeRolls;
  addCoins(s, rewardCoins);
  s.dailyStreakCommunity = communityEvent;
  return { rewardCoins, rewardShards, rewardFreeRolls, day, community: s.dailyStreakCommunity };
}

async function claimCommunityRewardFromState(s: PlayerState): Promise<{ rewardCoins: number; rewardXp: number; nextClaimAt: number; tier: number }> {
  const event = await getCommunityEvent();
  const completedTier = Math.max(
    0,
    Math.floor(Number(event.completedTier ?? Math.max(0, (event.tier ?? 1) - 1)) || 0),
  );
  const claimedTier = Math.max(0, Math.floor(Number(s.communityRewardClaimedTier ?? 0) || 0));
  const tier = claimedTier + 1;

  if (tier > completedTier) {
    return { rewardCoins: 0, rewardXp: 0, nextClaimAt: 0, tier: completedTier };
  }

  const rewardCoins = Math.round(1_000 * tier + 250 * (s.level || 1));
  const rewardXp = 75 * tier;
  s.communityRewardClaimedTier = tier;
  addCoins(s, rewardCoins);
  applyXp(s, rewardXp);
  return { rewardCoins, rewardXp, nextClaimAt: 0, tier };
}

async function processAutomation(s: PlayerState, options: { skipAutoOfflineClaim?: boolean; skipOfflineNotifications?: boolean; skipAutoStreakClaim?: boolean; skipAutoQuestClaim?: boolean; skipAutoCommunityClaim?: boolean } = {}): Promise<void> {
  if (!options.skipAutoStreakClaim && s.automations?.autoStreakClaim === true) {
    const today = new Date().toISOString().slice(0, 10);
    if (s.streak.lastClaimDate !== today) {
      try {
        await claimDailyStreakFromState(s);
      } catch (error) {
        // Auto-claim is optional automation. A bad shared streak event or
        // failed prepare must not prevent unrelated rolls/upgrades, and the
        // claim prepares before changing the local player state.
        console.error('[Automation] Auto-Streak claim failed; continuing without its reward.', error);
      }
    }
  }

  if (!options.skipAutoQuestClaim && s.automations?.autoQuestClaim === true) {
    const quests = [...s.dailyQuests, ...s.weeklyQuests]
      .filter(q => q.unlocked !== false && !q.claimed && q.progress >= q.target)
      .slice(0, 25);
    for (const q of quests) {
      applyQuestReward(s, q);
    }
  }

  if (!options.skipAutoCommunityClaim && s.automations?.autoCommunityClaim === true) {
    try {
      // Community rewards are optional automation. Corrupt or expired shared
      // event data must not prevent a manual roll, upgrade, or other mutation.
      // The claim reads/validates the event before changing the player state.
      await claimCommunityRewardFromState(s);
    } catch (error) {
      console.error('[Automation] Auto-Community claim failed; continuing without its reward.', error);
    }
  }

  if (!options.skipAutoOfflineClaim && s.automations?.autoOfflineClaim === true && s.offlineRolls > 0) {
    if (!Number.isSafeInteger(s.offlineRolls) || s.offlineRolls < 0) {
      throw new Error('Saved offline roll count is invalid; no rolls were claimed.');
    }
    const batches = Math.min(offlineRollCap(s), s.offlineRolls);
    const liveBalance = await getLiveBalanceConfig();
    const reclaimedPerActivation = cooldownReclaimerEnergyPerActivationMs(s, false, liveBalance);
    s.offlineRolls = 0;
    if (batches > 0) {
      await applyRolls(s, batches, undefined, 'offline');
      grantCooldownReclaimerTimeEnergy(s, batches, reclaimedPerActivation);
    }
    s.lastRollAt = Date.now();

    // Do not clear reminders before the player reward save commits. If save()
    // fails, the old marker/job must remain so the next request can recover.
    // Clearing is compare-and-set after commit, then we re-arm the next reminder.
    const userId = currentUserId();
    const subredditName = String(context.subredditName ?? '').trim();
    const notificationKey = OFFLINE_FULL_NOTIFICATION_PREFIX + userId;
    const jobKey = OFFLINE_FULL_JOB_PREFIX + userId;
    const [notificationValue, jobValue] = await Promise.all([
      redis.get(notificationKey),
      redis.get(jobKey),
    ]);
    stageSavePostCommitAction(s, async () => {
      await Promise.all([
        clearOfflineReminderKeyIfUnchanged(notificationKey, notificationValue),
        clearOfflineReminderKeyIfUnchanged(jobKey, jobValue),
      ]);
      if (subredditName) {
        const cap = offlineRollCap(s);
        const liveBalance = await getLiveBalanceConfig();
        const tickMs = Math.max(1_000, effectiveOfflineTickMs(s) / liveBalance['offline.generationMultiplier']);
        await scheduleOfflineFullNotification(
          userId,
          subredditName,
          Date.now() + Math.max(1_000, (cap - s.offlineRolls) * tickMs),
        );
      }
    });
  }

  if (s.automations?.autoUpgrade === true) {
    const reserveCoins = s.prestigeUpgrades?.autoBuyer ? AUTO_BUYER_COIN_RESERVE : 0;
    autoBuyCheapest(s, reserveCoins);
  }
}

function flairTextColorForBackground(backgroundColor: string): 'dark' | 'light' {
  const match = String(backgroundColor ?? '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return 'light';

  const hex = match[1];
  const srgb = [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = srgb.map(channel =>
    channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const lightContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.05;
  return lightContrast >= darkContrast ? 'light' : 'dark';
}

async function syncRarityFlair(
  s: PlayerState,
  targetUserId = currentUserId(),
  targetUsername?: string,
  forceRefresh = false,
): Promise<void> {
  const userId = String(targetUserId ?? '').trim();
  const subredditName = String(context.subredditName ?? '').trim();
  if (!userId || !subredditName) return;

  // Keep Reddit flair updates outside the authoritative player-save transaction.
  // The separate lock and post-write recheck prevent stale saves overwriting newer flair.
  await withPlayerMutationLockFor('flair:' + userId, async () => {
    const flairKey = PLAYER_FLAIR_KEY_PREFIX + userId;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const storedRaw = await redis.get(playerKeyFor(userId));
      const raw = await readStoredPlayerSave(userId, storedRaw);
      const latest = raw == null ? null : parsePlayerStateValue(raw);
      const source = latest ?? s;
      const username = String(targetUsername ?? (
        userId === currentUserId() ? context.username : source.username
      ) ?? '').trim();
      if (!username) return;

      const highestRarity = Math.max(2, Math.floor(Number(source.highestRarity ?? 2) || 2));
      const orbInfo = getOrbInfo(highestRarity, source.highestRarityIsInfinity === true);
      const current = await redis.get(flairKey);
      let cached: { orbTier?: string; guildName?: string } | null = null;
      if (typeof current === 'string') {
        try { cached = JSON.parse(current) as { orbTier?: string; guildName?: string }; } catch { cached = null; }
      }

      // Normal saves only need to revisit Reddit when the best tier changes.
      // Guild create/join/leave/kick explicitly force a membership refresh.
      if (!forceRefresh && cached?.orbTier === orbInfo.tier && typeof cached.guildName === 'string') return;

      const guildName = String(await redis.hGet(GUILD_FLAIR_NAMES_KEY, userId) ?? '');
      const flairText = buildGuildUserFlair(guildName, orbInfo.tier);
      const backgroundColor = orbInfo.color;
      const textColor = flairTextColorForBackground(backgroundColor);
      const flairState = JSON.stringify({
        text: flairText,
        orbTier: orbInfo.tier,
        guildName,
        backgroundColor,
        textColor,
      });
      if (String(current ?? '') !== flairState) {
        await reddit.setUserFlair({
          subredditName,
          username,
          text: flairText,
          backgroundColor,
          textColor,
        });
      }

      // A newer player save or guild membership change may have committed while
      // Reddit was processing the update. Recheck both sources before caching.
      const afterStoredRaw = await redis.get(playerKeyFor(userId));
      const afterRaw = await readStoredPlayerSave(userId, afterStoredRaw);
      const after = afterRaw == null ? null : parsePlayerStateValue(afterRaw);
      const afterRarity = Math.max(2, Math.floor(Number(after?.highestRarity ?? source.highestRarity ?? 2) || 2));
      const afterOrb = getOrbInfo(afterRarity, (after?.highestRarityIsInfinity ?? source.highestRarityIsInfinity) === true);
      const afterGuildName = String(await redis.hGet(GUILD_FLAIR_NAMES_KEY, userId) ?? '');
      const afterText = buildGuildUserFlair(afterGuildName, afterOrb.tier);
      const afterState = JSON.stringify({
        text: afterText,
        orbTier: afterOrb.tier,
        guildName: afterGuildName,
        backgroundColor: afterOrb.color,
        textColor: flairTextColorForBackground(afterOrb.color),
      });
      if (afterState === flairState) {
        await redis.set(flairKey, flairState);
        return;
      }
    }

    console.error('[Rarity Flair] Player rarity or guild membership kept changing during flair sync; leaving cache untouched.');
  }).catch(error => {
    console.error('[Rarity Flair] Failed to update user flair:', error);
  });
}

/** Force a flair refresh after the current player changes guild membership. */
export async function syncCurrentPlayerRarityFlair(): Promise<void> {
  const state = await loadRaw();
  await syncRarityFlair(state, currentUserId(), String(context.username ?? state.username ?? ''), true);
}

/** Force a flair refresh for a player removed by another guild member. */
export async function syncPlayerRarityFlair(userId: string, username: string): Promise<void> {
  const cleanUserId = String(userId ?? '').trim();
  if (!cleanUserId) return;
  const storedRaw = await redis.get(playerKeyFor(cleanUserId));
  const raw = await readStoredPlayerSave(cleanUserId, storedRaw);
  if (raw == null) return;
  const state = parsePlayerStateValue(raw);
  await syncRarityFlair(state, cleanUserId, String(username ?? state.username ?? '').trim(), true);
}

export async function getGlobalBoosterAnnouncement(): Promise<{
  id: GlobalBoosterId;
  name: string;
  username: string;
  activatedAt: number;
} | null> {
  try {
    const raw = await redis.get(GLOBAL_BOOSTER_ANNOUNCEMENT_KEY);
    if (!raw || typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw) as Partial<{
      id: GlobalBoosterId;
      name: string;
      username: string;
      activatedAt: number;
    }>;
    const activatedAt = Number(parsed.activatedAt ?? 0);
    if (!parsed.id || !GLOBAL_BOOSTERS[parsed.id] || !Number.isFinite(activatedAt)) return null;
    if (Date.now() - activatedAt > 10_000) return null;
    return {
      id: parsed.id,
      name: String(parsed.name ?? GLOBAL_BOOSTERS[parsed.id].name),
      username: String(parsed.username ?? 'Redditor'),
      activatedAt,
    };
  } catch {
    return null;
  }
}

interface RollTicket {
  id: string;
  nextIndex: number;
  expiresAt: number;
  /** Server-generated seeds are exposed intentionally for instant client previews. */
  seeds: string[];
}

const ROLL_PREDICTION_COUNT = 5;

function rollTicketKey(userId = currentUserId(), riftRunId?: string): string {
  return riftRunId
    ? ROLL_TICKET_KEY_PREFIX + userId + ':rift:' + riftRunId
    : ROLL_TICKET_KEY_PREFIX + userId;
}

function randomUint32(): number {
  const sample = new Uint32Array(1);
  globalThis.crypto.getRandomValues(sample);
  return sample[0];
}

function createRollSeed(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function validRollSeeds(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length === ROLL_TICKET_COUNT &&
    value.every(seed => typeof seed === 'string' && /^[a-f0-9]{64}$/i.test(seed));
}

async function createRollTicketPreviews(
  state: PlayerState,
  ticket: RollTicket,
): Promise<Array<{ index: number; orb: Orb }>> {
  // Auto-claims can change the stats used by a roll. Keep the seed available,
  // but omit the instant Orb reveal when an automatic reward claim is enabled.
  const automations = state.automations ?? {};
  if (
    automations.autoStreakClaim === true ||
    automations.autoQuestClaim === true ||
    automations.autoCommunityClaim === true ||
    automations.autoOfflineClaim === true
  ) return [];

  const previewState = JSON.parse(JSON.stringify(state)) as PlayerState;
  await settleOffline(previewState, { previewOnly: true });
  const previews: Array<{ index: number; orb: Orb }> = [];
  const end = Math.min(ROLL_TICKET_COUNT, ticket.nextIndex + ROLL_PREDICTION_COUNT);

  for (let index = ticket.nextIndex; index < end; index += 1) {
    const random = createRollRandomSource(ticket.seeds[index]);
    const result = await applyRolls(
      previewState,
      1,
      undefined,
      'online',
      undefined,
      random.next,
      false,
      undefined,
      random.nextRarity,
      true,
    );
    previews.push({ index, orb: result.bestOrb });

    // Match the outer roll mutation before forecasting the next ticket index.
    const now = Date.now();
    previewState.lastRollAt = now;
    previewState.lastSeenAt = now;
    previewState.manualRolls = Math.min(10, (previewState.manualRolls ?? 0) + 1);
    if (previewState.manualRolls >= 3) previewState.upgrades.auto = 1;
  }
  return previews;
}

export async function getRollTicket(): Promise<{
  ticketId: string;
  nextIndex: number;
  rollsRemaining: number;
  expiresAt: number;
  seeds: string[];
  predictionBaseRevision: number;
  predictionStartIndex: number;
  predictions: Array<{ index: number; orb: Orb }>;
}> {
  // Keep the shared player lock limited to ticket allocation and the state
  // snapshot. Preview simulation is presentation-only and must never hold up
  // real rolls, upgrades, or other player mutations.
  const prepared = await withPlayerMutationLock(async () => {
    const state = await loadRaw();
    const ticketKey = rollTicketKey(currentUserId(), state.riftSession?.runId);
    const now = Date.now();

    for (let attempt = 0; attempt < 4; attempt++) {
      const txn = await redis.watch(ticketKey);
      let transactionClosed = false;
      try {
        const raw = await redis.get(ticketKey);
        const current = parseStoredJson<RollTicket>(raw);
        const validIndex = current &&
          Number.isSafeInteger(current.nextIndex) &&
          current.nextIndex >= 0 &&
          current.nextIndex <= ROLL_TICKET_COUNT;
        const seeds = validRollSeeds(current?.seeds)
          ? current.seeds
          : Array.from({ length: ROLL_TICKET_COUNT }, () => createRollSeed());

        // Never discard unconsumed revealed outcomes just because a ticket aged
        // out. Rotate its opaque ticket ID, but retain both the index and seeds.
        const reusable = Boolean(
          current &&
          typeof current.id === 'string' &&
          current.id.length > 0 &&
          current.id.length <= 128 &&
          validIndex &&
          current.nextIndex < ROLL_TICKET_COUNT,
        );
        const ticket: RollTicket = reusable && current
          ? {
              id: current.expiresAt > now ? current.id : `rt-${now.toString(36)}-${randomUint32().toString(36)}`,
              nextIndex: current.nextIndex,
              expiresAt: current.expiresAt > now ? current.expiresAt : now + ROLL_TICKET_TTL_MS,
              seeds,
            }
          : {
              id: `rt-${now.toString(36)}-${randomUint32().toString(36)}`,
              nextIndex: 0,
              expiresAt: now + ROLL_TICKET_TTL_MS,
              seeds: Array.from({ length: ROLL_TICKET_COUNT }, () => createRollSeed()),
            };

        const currentRawMatches = current &&
          ticket.id === current.id &&
          ticket.expiresAt === current.expiresAt &&
          validRollSeeds(current.seeds);
        if (currentRawMatches) {
          await txn.unwatch();
          transactionClosed = true;
        } else {
          await txn.multi();
          await txn.set(ticketKey, JSON.stringify(ticket));
          const committed = await txn.exec();
          transactionClosed = true;
          if (committed === null) continue;
        }

        return { ticket, state };
      } finally {
        if (!transactionClosed) await txn.unwatch().catch(() => undefined);
      }
    }

    throw new Error('Could not create a roll prediction ticket. Please retry.');
  });

  // A preview is only an instant-reveal optimization. The seed/ticket remains
  // usable without it, so preview failures must not block manual or Auto Rolls.
  let predictions: Array<{ index: number; orb: Orb }> = [];
  try {
    predictions = await createRollTicketPreviews(prepared.state, prepared.ticket);
  } catch (error) {
    console.error('[Roll Ticket] Preview generation failed; continuing without instant preview.', error);
  }

  const { ticket, state } = prepared;
  return {
    ticketId: ticket.id,
    nextIndex: ticket.nextIndex,
    rollsRemaining: ROLL_TICKET_COUNT - ticket.nextIndex,
    expiresAt: ticket.expiresAt,
    seeds: ticket.seeds.slice(ticket.nextIndex, ticket.nextIndex + ROLL_PREDICTION_COUNT),
    predictionBaseRevision: Math.max(0, Math.floor(Number(state.stateRevision ?? 0)) || 0),
    predictionStartIndex: ticket.nextIndex,
    predictions,
  };
}
async function loadRollTicketForUse(
  ticketId: string,
  ticketIndex: number,
  requestedSeed?: string,
  riftRunId?: string,
): Promise<{ ticket: RollTicket; raw: string }> {
  const raw = await redis.get(rollTicketKey(currentUserId(), riftRunId));
  const ticket = parseStoredJson<RollTicket>(raw);

  if (!raw || !ticket) throw new Error('Roll prediction ticket is unavailable. Refresh the game.');
  if (
    typeof ticket.id !== 'string' || !ticket.id ||
    !Number.isSafeInteger(ticket.nextIndex) ||
    !Number.isSafeInteger(ticket.expiresAt) ||
    !validRollSeeds(ticket.seeds)
  ) {
    throw new Error('Roll prediction ticket data is corrupted. Refresh the game.');
  }
  if (ticket.id !== ticketId) throw new Error('Roll prediction ticket is stale. Refresh the game.');
  if (ticket.expiresAt <= Date.now()) throw new Error('Roll prediction ticket expired. Refresh the game.');
  if (ticketIndex !== ticket.nextIndex) throw new Error('Roll prediction ticket is out of order. Refresh the game.');
  if (ticketIndex < 0 || ticketIndex >= ROLL_TICKET_COUNT) {
    throw new Error('Roll prediction ticket is exhausted. Refresh the game.');
  }
  if (requestedSeed !== ticket.seeds[ticketIndex]) {
    throw new Error('Roll prediction seed does not match the active ticket.');
  }

  return { ticket, raw };
}

async function commitOptionalSaveProjection(write: SaveExtraWrite): Promise<void> {
  const txn = await redis.watch(write.key);
  let transactionClosed = false;
  let writePlan: Awaited<ReturnType<typeof createRedisLargeValueWritePlan>> | null = null;
  let writeCommitted = false;
  try {
    const current = await redis.get(write.key);
    const actual = current == null ? null : String(current);
    if (actual !== write.expectedValue) {
      await txn.unwatch();
      transactionClosed = true;
      console.error('[Player Save] Optional projection changed; skipped without affecting player state.', write.key);
      return;
    }

    // Guild state is the only potentially large side projection. Keep its
    // legacy inline format readable while new large values use small chunks.
    writePlan = write.key === 'io:guilds'
      ? await createRedisLargeValueWritePlan(write.key, write.nextValue)
      : { storedValue: write.nextValue, chunkKeys: [] };

    await txn.multi();
    if (write.expiration) {
      await txn.set(write.key, writePlan.storedValue, { expiration: write.expiration });
    } else {
      await txn.set(write.key, writePlan.storedValue);
    }
    const committed = await txn.exec();
    transactionClosed = true;
    if (committed !== null) {
      writeCommitted = true;
      await retireRedisLargeValue(write.key, current);
    } else {
      console.error('[Player Save] Optional projection conflicted at commit; skipped without affecting player state.', write.key);
    }
  } finally {
    if (!transactionClosed) {
      await txn.unwatch().catch(() => undefined);
    }
    if (writePlan && !writeCommitted) {
      await discardRedisLargeValueWritePlan(writePlan);
    }
  }
}

export async function save(
  s: PlayerState,
  extraWrite?: SaveExtraWrite | SaveExtraWrite[],
) {
  const userId = currentUserId();
  // Keep the persisted lifetime counter inside the same safe-integer range enforced
  // by the player parser and every roll writer. Reject before any side writes.
  if (
    !Number.isSafeInteger(s.totalRolls) ||
    s.totalRolls < 0 ||
    s.totalRolls > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('Player lifetime roll counter is invalid; no changes were saved.');
  }
  if (
    typeof s.shards !== 'number' || !Number.isFinite(s.shards) || s.shards < 0 || s.shards > Number.MAX_SAFE_INTEGER ||
    Math.abs(s.shards * 1_000 - Math.round(s.shards * 1_000)) >= 1e-6 ||
    (s.lifetimeShards != null && (typeof s.lifetimeShards !== 'number' || !Number.isFinite(s.lifetimeShards) || s.lifetimeShards < 0 || s.lifetimeShards > Number.MAX_SAFE_INTEGER))
  ) {
    throw new Error('Player Shard balance is invalid; no changes were saved.');
  }
  s.shards = roundShardAmount(s.shards);
  s.lifetimeShards = roundShardAmount(s.lifetimeShards ?? s.shards);
  s.freeShardsEarnedToday = roundShardAmount(s.freeShardsEarnedToday ?? 0);
  if (
    !Number.isFinite(s.coins) || s.coins < 0 ||
    (s.lifetimeCoins != null && (!Number.isFinite(s.lifetimeCoins) || s.lifetimeCoins < 0))
  ) {
    throw new Error('Player Coin balance is invalid; no changes were saved.');
  }
  s.coins = normalizeCoinAmount(s.coins);
  s.lifetimeCoins = normalizeCoinAmount(s.lifetimeCoins ?? s.coins);
  const explicitWrites = extraWrite
    ? Array.isArray(extraWrite) ? extraWrite : [extraWrite]
    : [];
  const allExtraWrites = [
    ...(pendingSaveExtraWrites.get(s) ?? []),
    ...explicitWrites,
  ];
  if (s.riftSession) {
    await saveActiveRiftPlayerState(s, allExtraWrites);
    return;
  }
  // Optional side projections (for example shared World Event progress) are
  // best-effort. Keeping them out of the player transaction prevents unrelated
  // players from invalidating a critical balance/progression save.
  const extraWrites = allExtraWrites.filter(write => !write.optional);
  const optionalWrites = allExtraWrites.filter(write => write.optional);
  const writeKeys = allExtraWrites.map(write => write.key);
  if (
    new Set(writeKeys).size !== writeKeys.length ||
    writeKeys.includes(key()) ||
    writeKeys.includes(saveGenerationKeyFor(userId)) ||
    allExtraWrites.some(write =>
      write.expiration !== undefined &&
      (!(write.expiration instanceof Date) || !Number.isFinite(write.expiration.getTime()) || write.expiration.getTime() <= Date.now())
    )
  ) {
    throw new Error('Invalid or duplicate extra writes in player save.');
  }
  s.codexChain = highestCodexChain(s.collection);
  s.codexDevotionLuckPercent = codexDevotionLuckPercent(
    s.masterySkills?.celestialSurge ?? 0,
    s.codexChain,
  );
  const playerKey = key();
  const generationKey = saveGenerationKeyFor(userId);
  await ensureRedisStringKey(generationKey, '0');

  let expectedRevision = Math.max(0, Math.floor(Number(s.stateRevision ?? 0)) || 0);

  // Lifetime playtime lives outside the save so resets/wipes cannot erase it.
  // Every saved action also refreshes the activity clock.
  await touchPlayerActivity(
    userId,
    String(s.username ?? context.username ?? `reddit-user-${userId.slice(-8)}`),
  );

  for (let attempt = 0; attempt < 6; attempt++) {
    // A lease is not a fence by itself: if a callback outlives its TTL, a
    // newer runtime can acquire the lock while the old callback is still live.
    // Watch every currently-held participant lock alongside the player and
    // side-write keys so a stale lease cannot commit after ownership changes.
    const mutationUserIds = new Set<string>([userId]);
    for (const write of extraWrites) {
      if (write.key.startsWith('player:')) {
        const sideUserId = write.key.slice('player:'.length).trim();
        if (sideUserId) mutationUserIds.add(sideUserId);
      }
    }
    const activeLocks = [...mutationUserIds]
      .map(id => getActivePlayerMutationLock(id))
      .filter((item): item is { key: string; token: string } => item !== null);
    const stateGenerationForCodex = Math.max(0, Math.floor(Number(s.saveGeneration ?? 0)));
    const dirtyCodexKeys = pendingCodexRarityWrites.get(s) ?? new Set<string>();
    const codexWrites = s.collectionStorageVersion === CODEX_STORAGE_VERSION && dirtyCodexKeys.size > 0
      ? groupCodexFields(Array.from(dirtyCodexKeys, rarityKey => [rarityKey, Number(s.collection?.[rarityKey] ?? 0)] as const))
      : [];
    const codexWriteKeys = codexWrites.map(write => codexShardKey(userId, stateGenerationForCodex, write.shard));
    const watchedKeys = [...new Set([
      playerKey,
      generationKey,
      ...extraWrites.map(write => write.key),
      ...activeLocks.map(item => item.key),
      ...codexWriteKeys,
    ])];
    const txn = await redis.watch(...watchedKeys);
    let transactionClosed = false;
    let writePlan: PlayerSaveWritePlan | null = null;
    let saveCommitted = false;
    const extraWritePlans = new Map<string, Awaited<ReturnType<typeof createRedisLargeValueWritePlan>>>();
    try {
    // Devvit's TxClient is a command builder after WATCH/MULTI. Reads must use
    // the Redis client itself, while WATCH keeps these keys protected until EXEC.
    for (const activeLock of activeLocks) {
      const actualToken = await redis.get(activeLock.key);
      if (actualToken !== activeLock.token) {
        await txn.unwatch();
        throw new Error('PLAYER_MUTATION_LEASE_LOST');
      }
    }
    const latestRaw = await redis.get(playerKey);
    const latestPlayerRaw = await readStoredPlayerSave(userId, latestRaw);
    const generationRaw = await redis.get(generationKey);
    const extraRaws = await Promise.all(extraWrites.map(write => redis.get(write.key)));

    let droppedConflictingProjection = false;
    for (let index = 0; index < extraWrites.length; index += 1) {
      const write = extraWrites[index];
      const actual = extraRaws[index] == null ? null : String(extraRaws[index]);
      if (actual !== write.expectedValue) {
        await txn.unwatch();
        if (write.onConflict) {
          await write.onConflict();
          extraWrites.splice(index, 1);
          const pending = pendingSaveExtraWrites.get(s) ?? [];
          const remaining = pending.filter(item => item.key !== write.key);
          if (remaining.length) pendingSaveExtraWrites.set(s, remaining);
          else pendingSaveExtraWrites.delete(s);
          console.warn('[Guild] Shared data changed during a roll; refunded withheld Coins and skipped only the Guild projection.');
          droppedConflictingProjection = true;
          break;
        }
        throw new Error(write.conflictMessage ?? 'Shared state changed before the player save. Please retry.');
      }
    }
    if (droppedConflictingProjection) continue;

    const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
    const stateGeneration = Math.max(0, Math.floor(Number(s.saveGeneration ?? 0)));

    if (stateGeneration !== generation) {
      await appendSaveDebugLog('generation-mismatch', {
        expectedGeneration: stateGeneration,
        storedGeneration: generation,
        expectedRevision,
        storedState: latestRaw == null ? null : compactSaveState(parsePlayerStateValue(latestRaw)),
        incomingState: compactSaveState(s),
        caller: saveCaller(),
      }, userId);
      // This request began before an admin wipe. Adopt the post-wipe state
      // for any caller that catches the error, but do not report a successful
      // mutation whose rewards/receipt/ticket were never committed.
      const currentStoredRaw = await redis.get(playerKey);
      const currentRaw = await readStoredPlayerSave(userId, currentStoredRaw);
      const current = parseStoredJson<PlayerState>(currentRaw);
      const currentGeneration = current
        ? Math.max(0, Math.floor(Number(current.saveGeneration ?? -1)))
        : -1;
      const fresh = current && currentGeneration === generation
        ? current
        : createInitialState();
      fresh.username = fresh.username ?? context.username ?? undefined;
      fresh.saveGeneration = generation;
      Object.assign(s, fresh);
      pendingSaveExtraWrites.delete(s);
      pendingSavePostCommitActions.delete(s);
      await txn.unwatch();
      throw new Error('PLAYER_STATE_INVALIDATED_BY_WIPE');
    }

    const latest = latestPlayerRaw == null ? null : parsePlayerStateValue(latestPlayerRaw);
    const latestRevision = Math.max(0, Math.floor(Number(latest?.stateRevision ?? 0)) || 0);
    const saveKeyMissing = latestRaw == null;

    // A missing player key is a recoverable first-save/persistence hole, not a
    // stale-write conflict. The generation key is still watched above, so a
    // concurrent write or account wipe aborts this transaction safely.
    if (!saveKeyMissing && !latest) {
      await appendSaveDebugLog('unreadable-save', {
        attempt: attempt + 1,
        expectedRevision,
        generation,
        stateGeneration,
        rawLength: typeof latestRaw === 'string' ? latestRaw.length : null,
        rawPreview: typeof latestRaw === 'string' ? latestRaw.slice(0, 1000) : latestRaw,
        caller: saveCaller(),
      }, userId);
      await txn.unwatch();
      throw new Error('Your Infinity Orbs save data could not be read safely. No changes were written.');
    }

    if (!saveKeyMissing && latestRevision !== expectedRevision) {
      // A duplicate/read-only caller may race another save without changing
      // any actual player data. Treat that case as an idempotent save instead
      // of surfacing a false conflict to the player.
      if (latest && saveStatesMatchIgnoringRevision(latest, s)) {
        expectedRevision = latestRevision;
        s.stateRevision = latestRevision;
      } else {
        await appendSaveDebugLog('revision-conflict', {
          attempt: attempt + 1,
          expectedRevision,
          latestRevision,
          generation,
          stateGeneration,
          storedState: latest ? compactSaveState(latest) : null,
          incomingState: compactSaveState(s),
          caller: saveCaller(),
        }, userId);
        await txn.unwatch();
        throw new Error('Player state changed while saving. Please retry.');
      }
    }

    if (saveKeyMissing && expectedRevision > 0) {
      await appendSaveDebugLog('missing-save-recovery', {
        attempt: attempt + 1,
        expectedRevision,
        generation,
        stateGeneration,
        storedState: null,
        incomingState: compactSaveState(s),
        caller: saveCaller(),
      }, userId);
    }

    const nextState = { ...s, saveGeneration: generation, stateRevision: expectedRevision + 1 };
    writePlan = await createPlayerSaveWritePlan(userId, serializePlayerStateForRedis(nextState));
    for (const write of extraWrites) {
      if (write.key === 'io:guilds') {
        extraWritePlans.set(
          write.key,
          await createRedisLargeValueWritePlan(write.key, write.nextValue),
        );
      }
    }
    await txn.multi();
    await txn.set(playerKey, writePlan.storedValue);
    for (let index = 0; index < codexWrites.length; index += 1) {
      await txn.hSet(codexWriteKeys[index], codexWrites[index].fields);
    }
    for (const write of extraWrites) {
      const nextValue = extraWritePlans.get(write.key)?.storedValue ?? write.nextValue;
      if (write.expiration) {
        await txn.set(write.key, nextValue, { expiration: write.expiration });
      } else {
        await txn.set(write.key, nextValue);
      }
    }
    const committed = await txn.exec();
    transactionClosed = true;
    if (committed !== null) {
      saveCommitted = true;
      await cleanupPreviousPlayerSave(userId, latestRaw);
      if (latest?.collectionStorageVersion === 1) await deleteLegacyCodexShards(userId, generation);
      for (let index = 0; index < extraWrites.length; index += 1) {
        const write = extraWrites[index];
        if (extraWritePlans.has(write.key)) {
          await retireRedisLargeValue(write.key, extraRaws[index]);
        }
      }
      pendingSaveExtraWrites.delete(s);
      pendingCodexRarityWrites.delete(s);
      Object.assign(s, nextState);

      // Optional projections are deliberately outside the authoritative player
      // transaction. They can lag briefly or be skipped on conflicts, but they
      // can never invalidate a committed balance/progression update.
      for (const write of optionalWrites) {
        void commitOptionalSaveProjection(write).catch(error => {
          console.error('[Player Save] Optional post-commit projection failed:', write.key, error);
        });
      }

      // Run deferred external side effects only after the durable player state
      // has committed. Failures are logged and do not turn a successful reward
      // grant into an apparent failed mutation that a client may retry.
      const postCommitActions = pendingSavePostCommitActions.get(s) ?? [];
      pendingSavePostCommitActions.delete(s);
      for (const action of postCommitActions) {
        try {
          await action();
        } catch (error) {
          console.error('[Player Save] Post-commit side effect failed:', error);
        }
      }

      // Flair is cosmetic and must never hold the gameplay request hostage.
      void syncRarityFlair(s).catch(error => {
        console.error('[Rarity Flair] Background update failed:', error);
      });
      return;
    }

    await appendSaveDebugLog('transaction-conflict', {
      attempt: attempt + 1,
      expectedRevision,
      latestRevision,
      generation,
      stateGeneration,
      incomingState: compactSaveState(s),
      caller: saveCaller(),
    }, userId);
    } finally {
      // WATCH must be released even when a Redis read, validation, queued write,
      // or EXEC throws. This is deliberately best-effort after explicit UNWATCH.
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
      if (writePlan && !saveCommitted) await discardPlayerSaveWritePlan(writePlan);
      if (!saveCommitted) {
        for (const plan of extraWritePlans.values()) {
          await discardRedisLargeValueWritePlan(plan);
        }
      }
    }
  }

  throw new Error('Could not safely save player data. Please retry.');
}

function serverRandom(): number {
  // Use 64 bits of entropy for ordinary probability checks.
  const sample = new BigUint64Array(1);
  globalThis.crypto.getRandomValues(sample);
  const denominator = 18_446_744_073_709_551_616;
  const value = Number(sample[0]) / denominator;
  if (value >= 1) return 0.9999999999999999;
  return Math.max(Number.MIN_VALUE, value);
}

/**
 * Produces a uniform [0, 1) sample with 1,088 random bits for the inverse-CDF
 * rarity roll. More than 1,074 bits keeps sampling resolution finer than the
 * smallest positive Number step, so the extreme rarity tail is not quantized
 * into just one or two probability outcomes near the finite Number ceiling.
 * Retain the leading 53 mantissa bits and the sampled exponent when converting.
 */
function serverRarityRandom(): number {
  const words = new Uint32Array(34);
  globalThis.crypto.getRandomValues(words);
  let sample = 0n;
  for (const word of words) sample = (sample << 32n) | BigInt(word);
  if (sample === 0n) return Number.MIN_VALUE;

  const bitLength = sample.toString(2).length;
  const mantissaBits = Math.min(53, bitLength);
  const leadingBits = sample >> BigInt(bitLength - mantissaBits);
  const mantissa = Number(leadingBits) / Math.pow(2, mantissaBits);
  const value = mantissa * Math.pow(2, bitLength - 1088);
  return Number.isFinite(value)
    ? Math.min(1 - Number.EPSILON, Math.max(Number.MIN_VALUE, value))
    : Number.MIN_VALUE;
}

function finiteNonNegativeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function finiteNonNegativeInteger(value: unknown, fallback = 0): number {
  const safeFallback = Number.isFinite(fallback)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(fallback)))
    : 0;
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(n)))
    : safeFallback;
}

function normalizeSafeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function normalizeCooldownTimestamp(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  // A present but malformed cooldown marker fails closed for one full cooldown.
  return Date.now();
}

function normalizeEntitlementLots(
  value: unknown,
  totalValue: unknown,
  fillLegacyRemainder = false,
): Record<string, number> {
  const total = normalizeSafeInteger(totalValue, 0);
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return total > 0 ? { legacy: total } : {};
  }

  const source = value as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  let remaining = total;
  for (const [lotId, rawAmount] of Object.entries(source)) {
    if (!lotId || lotId.length > 512 || typeof rawAmount !== 'number' ||
        !Number.isSafeInteger(rawAmount) || rawAmount < 0) {
      continue;
    }
    const amount = Math.min(rawAmount, remaining);
    if (amount > 0) normalized[lotId] = amount;
    remaining -= amount;
    if (remaining <= 0) break;
  }
  if (fillLegacyRemainder && remaining > 0) {
    normalized.legacy = Math.min(Number.MAX_SAFE_INTEGER, (normalized.legacy ?? 0) + remaining);
  }
  return normalized;
}
function addCoins(s: PlayerState, amount: number): number {
  if (!Number.isFinite(s.coins) || s.coins < 0) {
    throw new Error('Saved Coin balance is invalid; no reward was applied.');
  }
  if (
    s.lifetimeCoins != null &&
    (!Number.isFinite(s.lifetimeCoins) || s.lifetimeCoins < 0)
  ) {
    throw new Error('Saved lifetime Coin total is invalid; no reward was applied.');
  }
  const currentCoins = normalizeCoinAmount(s.coins);
  const requestedGain = normalizeCoinAmount(amount);
  const gain = Math.min(requestedGain, Number.MAX_VALUE - currentCoins);
  s.coins = addCoinAmount(currentCoins, gain);
  const lifetimeCoins = normalizeCoinAmount(s.lifetimeCoins ?? currentCoins);
  s.lifetimeCoins = addCoinAmount(lifetimeCoins, gain);
  return gain;
}


function advanceQuestProgress(s: PlayerState, type: 'roll' | 'rare' | 'value' | 'unique' | 'social' | 'share', amount: number) {
  for (const q of s.dailyQuests) {
    if (q.claimed) continue;
    if (type === 'roll' && q.id.includes('rolls')) q.progress = Math.min(q.target, q.progress + amount);
    if (type === 'rare' && q.id.includes('rare') && amount >= Math.max(2, Math.floor(Number(q.minRarity ?? 100) || 100))) q.progress = Math.min(q.target, q.progress + 1);
    if (type === 'unique' && q.id.includes('unique')) q.progress = Math.min(q.target, q.progress + Math.max(0, amount));
    if (type === 'social' && q.id.includes('social')) q.progress = Math.min(q.target, q.progress + 1);
  }
  for (const q of s.weeklyQuests) {
    if (type === 'rare') {
      const shareQuest = s.weeklyQuests.find(weekly => weekly.id === 'weekly-share');
      const unlockRarity = Math.max(2, Math.floor(Number(shareQuest?.unlockRarity ?? 100) || 100));
      if (shareQuest && amount >= unlockRarity) shareQuest.unlocked = true;
    }
    if (q.unlocked === false) continue;
    if (q.claimed) continue;
    if (type === 'roll' && q.id.includes('grind')) q.progress = Math.min(q.target, q.progress + amount);
    if (type === 'rare' && q.id.includes('epic') && amount >= Math.max(2, Math.floor(Number(q.minRarity ?? 1000) || 1000))) q.progress = Math.min(q.target, q.progress + 1);
    if (type === 'value' && q.id.includes('guild')) q.progress = Math.min(q.target, q.progress + amount);
    // Only a genuine server-created share advances the share quest.
    if (type === 'share' && q.id.includes('share')) q.progress = Math.min(q.target, q.progress + 1);
  }
}

function checkPeriodicResets(s: PlayerState, now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  const coinsPerMinute = estimateQuestCoinsPerMinute(s);
  if (s.lastDailyReset !== today) {
    s.dailyQuests = createInitialDailyQuests(s.highestRarity, coinsPerMinute);
    s.lastDailyReset = today;
  }
  const currentWeek = weekKey(now);
  const lastWeek = s.lastWeeklyReset ? weekKey(new Date(s.lastWeeklyReset).getTime()) : -1;
  if (currentWeek !== lastWeek) {
    s.weeklyQuests = createInitialWeeklyQuests(s.highestRarity, coinsPerMinute);
    s.lastWeeklyReset = today;
    // Community rewards are weekly. A new week starts the claim ladder over at Tier 1.
    s.communityRewardClaimedTier = 0;
  }
}

function effectiveRollCritChance(
  s: PlayerState,
  globalBoosters: GlobalBoosterSnapshot | null | undefined = s.globalBoosters,
): number {
  return Math.min(
    0.40,
    (s.upgrades.critChance ?? 0) * 0.03 +
    (s.masterySkills?.critMastery ?? 0) * 0.03 +
    (s.guildPerks?.critRank ?? 0) * 0.015 +
    globalBoosterCritChanceBonus(globalBoosters?.crit) +
    guildComboCritChanceBonus(s.guildCombo) +
    (s.riftSession?.upgradeLevels.critical ?? 0) * 0.015,
  );
}

async function readRiftMainGameMultipliers(userId: string): Promise<{ luckMultiplier: number; coinMultiplier: number; xpMultiplier: number }> {
  const fallback = { luckMultiplier: 1, coinMultiplier: 1, xpMultiplier: 1 };
  // These cross-game perks intentionally do not bypass challenge-specific
  // Sealed Progression modifiers. Rift-only perks remain active in a run.
  if (!userId) return fallback;
  try {
    const raw = await redis.get('io:rift-challenge:v1:' + userId);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { riftPerkLevels?: Record<string, unknown> };
    const levels = parsed?.riftPerkLevels && typeof parsed.riftPerkLevels === 'object'
      ? parsed.riftPerkLevels
      : {};
    const level = (id: string) => {
      const value = Number(levels[id]);
      return Number.isFinite(value) ? Math.max(0, Math.min(10, Math.floor(value))) : 0;
    };
    return {
      luckMultiplier: 1 + level('mainLuck') * 0.02,
      coinMultiplier: 1 + level('mainCoins') * 0.05,
      xpMultiplier: 1 + level('mainXp') * 0.05,
    };
  } catch (error) {
    // Rift progression is an optional bonus. A damaged side record must never block a normal roll.
    console.error('[Rift Perks] Could not read main-game bonuses; rolling without them.', error);
    return fallback;
  }
}

export async function applyRolls(
  s: PlayerState,
  activationCount = 1,
  forcedRarity?: number,
  source: 'online' | 'offline' | 'frenzy' = 'online',
  rollCountOverride?: number,
  randomOverride?: () => number,
  exactRarity = false,
  onProgress?: (processedCount: number) => Promise<void> | void,
  rarityRandomOverride?: () => number,
  previewOnly = false,
): Promise<{ bestOrb: Orb; batch: Orb[]; totalVal: number; coinsGained: number; shardsGained: number; xpGained: number; rollCount: number }> {
  let bestRarity = 0;
  let bestIsCrit = false;
  let bestIsNew = false;
  let bestIsInfinity = false;
  let bestRewardRarity = 0;
  let totalVal = 0;
  let coinsGained = 0;
  let shardsGained = 0;
  let xpGained = 0;
  let uniqueGained = 0;
  const batch: Orb[] = [];
  const rarities: number[] = [];
  const rarityWeights: number[] = [];
  let extraCoinsEstimate = 0;
  let lowRarityCoinsEstimate = 0;
  let rollCount = rollCountOverride ?? (rollsPerActivation(s) * activationCount);
  const liveBalance = await getLiveBalanceConfig();
  const now = Date.now();
  const spyUserId = currentUserId();
  const riftMultipliers = s.riftSession
    ? { luckMultiplier: 1, coinMultiplier: 1, xpMultiplier: 1 }
    : await readRiftMainGameMultipliers(spyUserId);
  const spyBefore = {
    totalRolls: s.totalRolls,
    totalCrits: s.totalCrits ?? 0,
    coins: s.coins,
    shards: s.shards,
    xp: s.xp,
    level: s.level,
    highestRarity: s.highestRarity,
  };
  const requestedRollCount = rollCount;
  // Freeze the lifetime counter for this batch. s.totalRolls increments inside
  // the loop, so using its live value plus i double-counts the current batch.
  const lifetimeRollsBeforeBatch = s.totalRolls;
  const rng = randomOverride ?? serverRandom;
  const rarityRng = rarityRandomOverride ?? randomOverride ?? serverRarityRandom;

  // Astral Magnetism proc: chance for multi-rolls to pull 2 bonus orbs
  const magnetLevel = s.prestigeUpgrades?.stellarMagnet ?? 0;
  if (source !== 'frenzy' && rollCount > 1 && magnetLevel > 0 && rng() < 0.10 * magnetLevel) {
    rollCount += 2;
  }
  const baseBatchRollCount = rollCount;
  // Keep the first three lifetime Orbs exact for the new-player guarantee.
  const protectedOpeningCount = forcedRarity == null
    ? Math.max(0, Math.min(baseBatchRollCount, 3 - lifetimeRollsBeforeBatch))
    : 0;
  const maxSimulatedRolls = source === 'frenzy'
    ? MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH
    : source === 'offline'
      ? MAX_SIMULATED_OFFLINE_ROLLS_PER_BATCH
      : MAX_SIMULATED_ROLLS_PER_REQUEST;
  const batchPlan = createRollBatchPlan(
    baseBatchRollCount,
    protectedOpeningCount,
    forcedRarity == null,
    maxSimulatedRolls,
  );
  let simulationLoopCount = batchPlan.simulatedBaseCount;
  let processedEffectiveRolls = 0;

  // The player-state parser rejects unsafe lifetime roll counters. Refuse an
  // invalid or overflowing batch before shared reads or per-orb mutations.
  if (
    !Number.isSafeInteger(s.totalRolls) ||
    s.totalRolls < 0 ||
    !Number.isSafeInteger(rollCount) ||
    rollCount < 0 ||
    rollCount > Number.MAX_SAFE_INTEGER - s.totalRolls
  ) {
    throw new Error('Roll counter would exceed the safe integer range; no rolls were processed.');
  }
  const maxSupportedRollCount = source === 'offline'
    ? offlineRollCap(s) * rollsPerActivation(s) + 2
    : source === 'frenzy'
      ? MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH
      : MAX_EFFECTIVE_ROLLS_PER_BATCH;
  if (!Number.isSafeInteger(maxSupportedRollCount) || rollCount > maxSupportedRollCount) {
    throw new Error('Roll batch exceeds the supported processing cap; no rolls were processed.');
  }

  // These reads are independent. Keep them parallel so a roll does not spend
  // several sequential Redis round trips before it can even start rolling.
  const [freshGlobalBoosters, worldEvent, fakeCcuBonus, combatStateRaw] = await Promise.all([
    s.riftSession ? Promise.resolve(createInitialState().globalBoosters!) : getGlobalBoosters(),
    (s.riftSession ? Promise.resolve(null) : getCommunityEvent()).catch(error => {
      // The shared World Event is a bonus/progress feature, not a prerequisite
      // for ordinary roll rewards. Keep corrupted/unavailable event data intact,
      // but don't brick a player's roll because an admin-maintained side record
      // could not be read.
      console.error('[Community Event] Read failed; rolling without the event bonus.', error);
      return null;
    }),
    s.riftSession ? Promise.resolve(0) : getFakeCcuBonus(),
    ((!s.riftSession ||
      (s.riftSession.bossResonanceLevel ?? 0) > 0 ||
      (s.riftSession.runeReconnectionLevel ?? 0) > 0 ||
      (s.riftSession.combatIntegrationLevel ?? 0) > 0)
      ? redis.get('infinity-orbs:combat:' + spyUserId)
      : Promise.resolve(null)).catch((error: unknown) => {
      // Combat progression is an optional cross-mode bonus. A transient failure
      // to read it must never prevent a normal orb roll.
      console.error('[Undercrypt Resonance] Read failed; rolling without the bonus.', error);
      return null;
    }),
  ]);
  s.globalBoosters = freshGlobalBoosters;
  const globalBoosters = s.globalBoosters;
  const communityLuck = s.riftSession ? 1 : (worldEvent?.buffMultiplier ?? 1);
  let combatBossesBeaten = 0;
  let runeBonuses = combatRuneBonuses([], []);
  let runeAbilityEffects = combatRuneMajorAbilityEffects([], []);
  let combatFocusRarity = 2;
  if (typeof combatStateRaw === 'string') {
    try {
      const parsed = JSON.parse(combatStateRaw) as {
        bestDepth?: unknown; depth?: unknown; dungeonId?: unknown; depthCapCleared?: unknown;
        dungeonBestDepths?: unknown; dungeonBossesBeaten?: unknown; runes?: unknown;
        equippedRunes?: unknown; orbFocusRarity?: unknown;
      };
      combatBossesBeaten = combatTotalBossesBeaten(parsed);
      const fullRuneBonuses = combatRuneBonuses(parsed?.runes, parsed?.equippedRunes);
      const runeShare = s.riftSession
        ? Math.max(0, Math.min(1, (s.riftSession.runeReconnectionLevel ?? 0) / 10))
        : 1;
      runeBonuses = {
        luckPct: fullRuneBonuses.luckPct * runeShare,
        coinGainPct: fullRuneBonuses.coinGainPct * runeShare,
        shardChancePct: fullRuneBonuses.shardChancePct * runeShare,
        xpGainPct: fullRuneBonuses.xpGainPct * runeShare,
      };
      const fullRuneEffects = combatRuneMajorAbilityEffects(parsed?.runes, parsed?.equippedRunes);
      runeAbilityEffects = Object.fromEntries(
        Object.entries(fullRuneEffects).map(([key, value]) => {
          const neutralValue = key.endsWith('BonusRolls') || key.endsWith('BonusShards') ? 1 : 0;
          return [key, neutralValue + (Number(value) - neutralValue) * runeShare];
        }),
      ) as typeof runeAbilityEffects;
      if (s.riftSession && (s.riftSession.combatIntegrationLevel ?? 0) > 0) {
        const focus = Number(parsed.orbFocusRarity);
        const normalizedFocus = Number.isFinite(focus) ? Math.max(2, focus) : 2;
        const focusShare = Math.max(0, Math.min(1, (s.riftSession.combatIntegrationLevel ?? 0) / 10));
        combatFocusRarity = 2 + (combatOrbDamageMultiplier(normalizedFocus) - 1) * 10 * focusShare;
      }
    } catch {
      // Ignore invalid optional combat state and preserve ordinary orb luck.
    }
  }
  const bossLuckBonus = combatBossLuckBonus(combatBossesBeaten) *
    (s.riftSession ? Math.max(0, Math.min(1, (s.riftSession.bossResonanceLevel ?? 0) / 10)) : 1);

  // Fake CCU is an admin testing offset applied only to this player's luck calculation.
  // The underlying CCU metric and historical peaks always remain based on real players.
  const luckCcu = s.riftSession
    ? 1
    : Math.max(1, Math.floor((s.onlinePlayers ?? 1) + fakeCcuBonus));
  const luckState = s.riftSession
    ? { ...s, onlinePlayers: 1 }
    : luckCcu === (s.onlinePlayers ?? 1) ? s : { ...s, onlinePlayers: luckCcu };
  // Community and boss-clear Luck are additive sources. Boss clears stack only with
  // themselves (1.01^n), and their bonus is added to ordinary Luck rather than multiplying it.
  // Rune Luck remains an explicit rarity multiplier, separate from Starseeker.
  const mutation = s.riftSession?.activeMutation;
  const mutationActive = Boolean(mutation && s.totalRolls < mutation.endsAtRoll);
  const mutationPenalty = riftMutationPenaltyFactor(
    s.riftSession?.mutationStabilizerLevel ?? 0,
    s.riftSession?.mutationAmplifierLevel ?? 0,
  );
  const mutationBenefit = 1 + (s.riftSession?.mutationAmplifierLevel ?? 0) * 0.05;
  let mutationLuckMultiplier = 1;
  let mutationCoinMultiplier = 1;
  let mutationCritChanceBonus = 0;
  if (mutationActive && mutation) {
    switch (mutation.id) {
      case 'temporal-collapse':
        mutationLuckMultiplier = 1 + 0.15 * mutationBenefit;
        mutationCoinMultiplier = 1 + (0.75 - 1) * mutationPenalty;
        break;
      case 'gravitational-surge':
        mutationLuckMultiplier = 1 + 0.45 * mutationBenefit;
        mutationCoinMultiplier = 1 + (0.70 - 1) * mutationPenalty;
        break;
      case 'unstable-economy':
        mutationCoinMultiplier = Math.floor(s.totalRolls / 5) % 2 === 0
          ? 1 + (0.55 - 1) * mutationPenalty
          : 1 + (1.85 - 1) * mutationBenefit;
        break;
      case 'critical-instability':
        mutationLuckMultiplier = 1 + (0.85 - 1) * mutationPenalty;
        mutationCritChanceBonus = 0.08 * mutationBenefit;
        break;
      case 'nullification':
        mutationLuckMultiplier = 0.5;
        mutationCoinMultiplier = 1.5 * mutationBenefit;
        break;
    }
  }
  const objectiveProgress = s.riftSession
    ? riftObjectiveProgress(Number(s.highestRarity) || 2, s.riftSession.targetRarity)
    : 0;
  const milestoneCount = objectiveProgress >= 0.90 ? 4 : objectiveProgress >= 0.75 ? 3 :
    objectiveProgress >= 0.50 ? 2 : objectiveProgress >= 0.25 ? 1 : 0;
  const calibrationLuck = 1 + (s.riftSession?.initialCalibrationLevel ?? 0) * 0.02;
  const conditioningLuck = 1 + Math.min(0.30,
    (s.riftSession?.riftConditioningCompletions ?? 0) *
    (s.riftSession?.riftConditioningLevel ?? 0) * 0.01);
  const reservoirLevel = s.riftSession?.fortuneReservoirLevel ?? 0;
  const reservoirLuck = reservoirLevel > 0 && (s.totalRolls % 50) < 5 ? 1 + reservoirLevel * 0.10 : 1;
  const criticalConversionLuck = 1 + Math.min(1,
    Math.floor((s.totalCrits ?? 0) / 5) * (s.riftSession?.criticalConversionLevel ?? 0) * 0.01);
  const milestoneLuck = 1 + milestoneCount * (s.riftSession?.milestoneAmplifierLevel ?? 0) * 0.05;
  const emergencyLuck = (s.riftSession?.emergencyProtocolUntilRoll ?? 0) > s.totalRolls ? 1.5 : 1;
  const nullificationScale = mutationActive && mutation?.id === 'nullification'
    ? 1 - 0.5 * mutationPenalty
    : 1;
  const challengeLuckMultiplier =
    (1 + (s.riftSession?.upgradeLevels.fortune ?? 0) * 0.12) *
    (1 + (s.riftSession?.riftLuckPerkLevel ?? 0) * 0.05) *
    riftTemporalArbitrageMultiplier(s.riftSession?.temporalDragMultiplier ?? 1, s.riftSession?.temporalArbitrageLevel ?? 0) *
    calibrationLuck * conditioningLuck * reservoirLuck * criticalConversionLuck * milestoneLuck *
    emergencyLuck * nullificationScale;
  const baseLuckCandidate = (luckMultiplier(luckState) + Math.max(0, communityLuck - 1) + bossLuckBonus) *
    riftMultipliers.luckMultiplier * challengeLuckMultiplier * mutationLuckMultiplier;
  const baseLuck = Number.isFinite(baseLuckCandidate) ? Math.max(1, baseLuckCandidate) : Number.MAX_VALUE;
  const rawRuneLuckMultiplier = combatRuneLuckMultiplier(runeBonuses.luckPct);
  const starseekerStacks = celestialAlignmentStackCount(s.alignmentActiveInstances, 'starseeker');
  const starseekerExponent = Math.pow(1.05, starseekerStacks);
  const alignedLuckCandidate = starseekerStacks > 0
    ? Math.pow(baseLuck, starseekerExponent)
    : baseLuck;
  const alignedBaseLuck = Number.isFinite(alignedLuckCandidate)
    ? Math.max(1, alignedLuckCandidate)
    : Number.MAX_VALUE;
  const runeLuckMultiplier = rawRuneLuckMultiplier;

  // Apex Fortune Mastery: chance on multi-roll to double the luck of that activation
  const apexChance = Math.min(0.45, (s.masterySkills?.apexFortune ?? 0) * 0.03);
  const isApex = rollCount > 1 && rng() < apexChance;
  const effectiveLuck = isApex ? Math.min(Number.MAX_VALUE, alignedBaseLuck * 2) : alignedBaseLuck;

  const cm = critMultiplier(s);
  const levelBenefits = getLevelBenefits(s.level || 1);
  const valueMul =
    1 +
    (s.upgrades.valueBonus ?? 0) * 0.10 +
    (s.prestigeUpgrades?.cosmicValuation ?? 0) * 0.05;

  const effectiveCritChance = Math.max(0, Math.min(0.95,
    effectiveRollCritChance(s, globalBoosters) + mutationCritChanceBonus,
  ));
  // Rune bonus rolls are bounded per activation and never exceed the existing server batch cap.
  const runeBonusRollBudget = source === 'frenzy'
    ? 0
    : Math.max(0, Math.min(
      50,
      maxSupportedRollCount - baseBatchRollCount,
      Number.MAX_SAFE_INTEGER - s.totalRolls - baseBatchRollCount,
    ));
  let runeBonusRollsUsed = 0;
  const runeBonusRollSpecs: { minRarity?: number; echoDepth?: number; echoOnly?: boolean; skipAllProcs?: boolean; exactRarity?: number; isInfinityOrb?: boolean }[] = [];
  const addRuneBonusRolls = (
    requestedCount: number,
    spec: { minRarity?: number; echoDepth?: number; echoOnly?: boolean; skipAllProcs?: boolean; exactRarity?: number; isInfinityOrb?: boolean },
  ): number => {
    const requested = Number.isFinite(requestedCount) ? Math.max(0, Math.floor(requestedCount)) : 0;
    const count = Math.min(requested, runeBonusRollBudget - runeBonusRollsUsed);
    for (let j = 0; j < count; j++) runeBonusRollSpecs.push({ ...spec });
    rollCount += count;
    simulationLoopCount += count;
    runeBonusRollsUsed += count;
    return count;
  };
  const echoChance = Math.min(.45, runeAbilityEffects.echoChamberPct / 100);
  const discoveryOracleChance = Math.min(.20, runeAbilityEffects.discoveryOraclePct / 500);
  const maxEchoChain = runeAbilityEffects.echoChamberMaxChain;
  const paradoxChance = Math.min(.50, runeAbilityEffects.paradoxEnginePct / 100);
  const eventHorizonRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.eventHorizonPct / 100);
  const shardConstellationThreshold = Math.max(100, Math.floor(200 / (1 + runeAbilityEffects.shardConstellationPct / 100)));
  const temporalMomentumPerRoll = runeAbilityEffects.temporalLoopMomentumPerRoll;
  const prismaticForkChance = Math.min(.45, runeAbilityEffects.prismaticForkPct / 100);
  const prismaticForkRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.prismaticForkPct / 100);
  const criticalConvergenceChance = Math.min(.35, runeAbilityEffects.criticalConvergencePct / 100);
  const criticalConvergenceRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.criticalConvergencePct / 100);
  const rarityLadderRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.rarityLadderPct / 100);
  const stellarDividendInterval = Math.max(20, Math.floor(100 / (1 + runeAbilityEffects.stellarDividendPct / 100)));
  const shardJackpotChance = Math.min(.005, runeAbilityEffects.shardJackpotPct / 20000);
  const milestoneRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.milestoneEnginePct / 100);
  let paradoxTriggered = false;
  let constellationTriggered = false;
  let temporalLoopTriggered = false;
  let stellarDividendTriggered = false;
  let rarityLadderTriggered = false;
  let discoveryOracleTriggered = false;
  let criticalRollsInBatch = 0;
  let previousBatchRarity = 0;
  let risingRarityChain = 0;
  const validCharge = (value: unknown) => Number.isFinite(Number(value)) ? Math.min(1_000_000, Math.max(0, Number(value))) : 0;
  s.runeConstellationCharge = validCharge(s.runeConstellationCharge);
  s.runeTemporalMomentum = validCharge(s.runeTemporalMomentum);

  for (let i = 0; i < simulationLoopCount; i++) {
    const isBaseSample = i < batchPlan.simulatedBaseCount;
    const sampleWeight = isBaseSample ? effectiveWeightAtSample(batchPlan, i) : 1;
    const virtualRollOffset = isBaseSample
      ? virtualRollOffsetAtSample(batchPlan, i)
      : baseBatchRollCount + (i - batchPlan.simulatedBaseCount);
    const currentRuneSpec = isBaseSample ? undefined : runeBonusRollSpecs[i - batchPlan.simulatedBaseCount];
    const echoDepth = currentRuneSpec?.echoDepth ?? 0;
    const suppressOtherRuneProcs = currentRuneSpec?.skipAllProcs === true || currentRuneSpec?.echoOnly === true;
    // Main-game onboarding only: the third Orb in a normal account is guaranteed
    // to land in the 1/101 through 1/120 range. Rift runs deliberately skip it.
    const isGuaranteedThirdBall = !s.riftSession && forcedRarity == null && lifetimeRollsBeforeBatch + virtualRollOffset === 2;

    // Chain Patcher guarantees the exact requested rarity, not a critical multiplier.
    const isExactRiftEcho = Number.isFinite(Number(currentRuneSpec?.exactRarity)) && Number(currentRuneSpec?.exactRarity) >= 2;
    const critEligible = !isGuaranteedThirdBall && !isExactRiftEcho && !(exactRarity && forcedRarity != null && i === 0);
    const critCountInGroup = critEligible
      ? sampleBinomialCount(sampleWeight, effectiveCritChance, rng)
      : 0;
    criticalRollsInBatch = Math.min(Number.MAX_SAFE_INTEGER, criticalRollsInBatch + critCountInGroup);
    const isCompressedGroup = sampleWeight > 1;
    let supernovaCountInGroup = 0;
    if (critCountInGroup > 0) {
      s.totalCrits = Math.min(Number.MAX_SAFE_INTEGER, (s.totalCrits ?? 0) + critCountInGroup);
      const supernovaLevel = s.prestigeUpgrades?.supernova ?? 0;
      const supernovaChance = Math.max(0, Math.min(1, supernovaLevel * 0.10));
      supernovaCountInGroup = supernovaLevel > 0
        ? sampleBinomialCount(critCountInGroup, supernovaChance, rng)
        : 0;
    }
    const groupCriticalCount = critCountInGroup;
    const groupSupernovaCount = supernovaCountInGroup;
    const normalCriticalGroupCount = groupCriticalCount - groupSupernovaCount;
    const ordinaryGroupCount = sampleWeight - groupCriticalCount;
    // For a Pareto-like rarity tail, each category contributes in proportion
    // to its count times its rarity multiplier. Use that mixture for both the
    // maximum's scale and the chance that a critical category produced it.
    const criticalMultiplier = Math.max(1, Number(cm) || 1);
    const supernovaMultiplier = criticalMultiplier * 5;
    const ordinaryTailWeight = ordinaryGroupCount;
    const criticalTailWeight = normalCriticalGroupCount * criticalMultiplier;
    const supernovaTailWeight = groupSupernovaCount * supernovaMultiplier;
    const totalTailWeight = Math.max(1, ordinaryTailWeight + criticalTailWeight + supernovaTailWeight);
    const averageGroupMultiplier = Math.max(1, totalTailWeight / sampleWeight);
    const topCategorySample = isCompressedGroup ? rng() * totalTailWeight : totalTailWeight;
    const isSupernova = isCompressedGroup
      ? topCategorySample < supernovaTailWeight
      : groupSupernovaCount > 0;
    const isCrit = isCompressedGroup
      ? isSupernova || topCategorySample < supernovaTailWeight + criticalTailWeight
      : groupCriticalCount > 0;

    // Player level scales rarity linearly; effective Luck applies a separate
    // diminishing-return factor to the continuous roll distribution.
    // The third lifetime Orb overrides the random result with a guaranteed beginner drop.
    const minimumRarity = 2 + (s.prestigeUpgrades?.luckyFloor ?? 0);
    const groupDryStreakBeforeSample = Math.max(0, Math.floor(Number(s.rollsSinceBest ?? 0) || 0));
    // Estimate where the representative maximum lands within a compressed group.
    const groupDryStreakAtMaximum = groupDryStreakBeforeSample + Math.floor((sampleWeight - 1) / 2);
    const riftDebtMultiplier = s.riftSession
      ? riftProbabilityDebtMultiplier(groupDryStreakAtMaximum, s.riftSession.probabilityDebtLevel)
      : 1;
    const riftCascadeActive = s.riftSession && (s.riftFractureCascadeRollsRemaining ?? 0) > 0;
    const riftCascadeMultiplier = riftCascadeActive
      ? riftFractureCascadeMultiplier(s.riftSession?.fractureCascadeLevel ?? 0)
      : 1;
    const riftSingularityMultiplier = s.riftSession
      ? riftSingularityFocusMultiplier(s.highestRarity, s.riftSession.targetRarity, s.riftSession.singularityFocusLevel)
      : 1;
    const riftSampleLuck = Math.min(Number.MAX_VALUE,
      effectiveLuck * riftDebtMultiplier * riftCascadeMultiplier * riftSingularityMultiplier);
    const beginnerRarity = 101 + Math.floor(rng() * 20);
    const runeRarityFloor = Math.max(
      minimumRarity,
      currentRuneSpec?.minRarity ?? minimumRarity,
      s.riftSession ? combatFocusRarity : minimumRarity,
    );
    let isInfinityOrb = false;
    let rolledRarity: number;
    let criticalMultiplierAppliedBeforeFloor = false;
    if (isExactRiftEcho) {
      rolledRarity = Math.max(minimumRarity, Math.min(MAX_ORB_RARITY, Math.floor(Number(currentRuneSpec?.exactRarity) || 2)));
      isInfinityOrb = currentRuneSpec?.isInfinityOrb === true;
      criticalMultiplierAppliedBeforeFloor = true;
    } else if (isGuaranteedThirdBall) {
      rolledRarity = beginnerRarity;
    } else if (forcedRarity && i === 0) {
      rolledRarity = forcedRarity;
    } else {
      // Each representative sample stands for the maximum of sampleWeight
      // effective rolls. Square the combined sample scale because Luck's
      // rarity contribution is square-rooted in the shared rarity function.
      const sampleScale = sampleWeight * averageGroupMultiplier;
      const sampleLuck = Math.min(Number.MAX_VALUE, riftSampleLuck * sampleScale * sampleScale);
      const maxCategoryMultiplier = isCompressedGroup
        ? Math.max(ordinaryGroupCount > 0 ? 1 : 0, normalCriticalGroupCount > 0 ? criticalMultiplier : 0, groupSupernovaCount > 0 ? supernovaMultiplier : 0)
        : averageGroupMultiplier;
      const rarityMultiplier = runeLuckMultiplier;
      const rarityFloor = runeRarityFloor * maxCategoryMultiplier;
      const rawRolledRarity = rollContinuum(
        sampleLuck,
        rarityRng,
        rarityMultiplier,
        rarityFloor,
        Math.max(1, Math.floor(Number(s.level) || 1)),
      );
      isInfinityOrb = !Number.isFinite(rawRolledRarity) || rawRolledRarity > MAX_ORB_RARITY;
      rolledRarity = Math.max(rarityFloor, Math.min(MAX_ORB_RARITY,
        Number.isFinite(rawRolledRarity) ? rawRolledRarity : MAX_ORB_RARITY));
      // The group-level max scale already includes its sampled critical mix.
      criticalMultiplierAppliedBeforeFloor = true;
    }
    const baseRarity = isExactRiftEcho
      ? rolledRarity
      : exactRarity && forcedRarity != null && i === 0
        ? forcedRarity
        : Math.max(minimumRarity, isGuaranteedThirdBall ? rolledRarity : runeRarityFloor, rolledRarity);
    const rawCritRarity = isCrit && !criticalMultiplierAppliedBeforeFloor
      ? Math.round(baseRarity * (isSupernova ? supernovaMultiplier : criticalMultiplier))
      : baseRarity;
    if (isCrit && (!Number.isFinite(rawCritRarity) || rawCritRarity > MAX_ORB_RARITY)) isInfinityOrb = true;
    const rarity = isCrit
      ? Math.min(MAX_ORB_RARITY, Number.isFinite(rawCritRarity) ? rawCritRarity : MAX_ORB_RARITY)
      : baseRarity;
    // Aggregate payouts need representative *individual* rolls, not the
    // weighted group maximum divided by its scale. The latter has a max-biased
    // distribution and would understate the sum of 500,000 individual rewards.
    const rewardRarity = sampleWeight > 1
      ? rollContinuum(
        riftSampleLuck,
        rng,
        runeLuckMultiplier,
        runeRarityFloor,
        Math.max(1, Math.floor(Number(s.level) || 1)),
      )
      : rarity;
    const finalVal = Math.min(MAX_ORB_RARITY, Math.round(rarity * valueMul));
    const baseFinalVal = Math.min(MAX_ORB_RARITY, Math.round(rewardRarity * valueMul));
    const hasDistinctGroupMaximum = isInfinityOrb || rarity !== rewardRarity;
    // Split the effective batch by its sampled normal-critical-supernova mix.
    // The weighted-Luck maximum is used for the best Orb; aggregate rewards
    // remain weighted across the full effective count.
    const criticalRewardRarity = sampleWeight === 1
      ? rarity
      : normalCriticalGroupCount > 0
        ? rollContinuum(
          riftSampleLuck,
          rng,
          runeLuckMultiplier * criticalMultiplier,
          runeRarityFloor * criticalMultiplier,
          Math.max(1, Math.floor(Number(s.level) || 1)),
        )
        : rewardRarity;
    const supernovaRewardRarity = sampleWeight === 1
      ? rarity
      : groupSupernovaCount > 0
        ? rollContinuum(
          riftSampleLuck,
          rng,
          runeLuckMultiplier * supernovaMultiplier,
          runeRarityFloor * supernovaMultiplier,
          Math.max(1, Math.floor(Number(s.level) || 1)),
        )
        : rewardRarity;
    const criticalFinalVal = Math.min(MAX_ORB_RARITY, Math.round(criticalRewardRarity * valueMul));
    const supernovaFinalVal = Math.min(MAX_ORB_RARITY, Math.round(supernovaRewardRarity * valueMul));
    const topRarityKey = isInfinityOrb ? 'Infinity' : String(rarity);
    const topBaseRewardRarity = sampleWeight > 1
      ? isSupernova
        ? supernovaRewardRarity
        : isCrit
          ? criticalRewardRarity
          : rewardRarity
      : rewardRarity;
    const topBaseRewardKey = String(topBaseRewardRarity);
    const groupRarityCounts = new Map<string, number>();
    const addGroupRarity = (key: string, count: number) => {
      if (count <= 0) return;
      groupRarityCounts.set(key, (groupRarityCounts.get(key) ?? 0) + count);
    };
    addGroupRarity(String(rewardRarity), ordinaryGroupCount);
    addGroupRarity(String(criticalRewardRarity), normalCriticalGroupCount);
    addGroupRarity(String(supernovaRewardRarity), groupSupernovaCount);
    // Replace the representative maximum in the Codex with its actual rarity;
    // it remains part of the weighted payout totals above, not an extra Orb.
    if (hasDistinctGroupMaximum) {
      const baselineCount = groupRarityCounts.get(topBaseRewardKey) ?? 0;
      if (baselineCount > 0) groupRarityCounts.set(topBaseRewardKey, baselineCount - 1);
      if ((groupRarityCounts.get(topBaseRewardKey) ?? 0) <= 0) groupRarityCounts.delete(topBaseRewardKey);
      addGroupRarity(topRarityKey, 1);
    }
    const newlyDiscoveredGroupRarities = [...groupRarityCounts.keys()].filter(key => !s.collection[key]);
    const newDiscoveryOrbCount = newlyDiscoveredGroupRarities.reduce(
      (count, key) => count + (groupRarityCounts.get(key) ?? 0),
      0,
    );
    const isNew = newlyDiscoveredGroupRarities.includes(topRarityKey);
    const groupNewRarity = newDiscoveryOrbCount > 0;
    for (const [key, count] of groupRarityCounts) {
      s.collection[key] = (s.collection[key] ?? 0) + count;
      markCodexRarityWrite(s, key);
    }
    const topBaseFinalValue = isSupernova
      ? supernovaFinalVal
      : isCrit
        ? criticalFinalVal
        : baseFinalVal;
    const weightedFinalValue = Math.min(
      Number.MAX_VALUE,
      baseFinalVal * ordinaryGroupCount +
        criticalFinalVal * normalCriticalGroupCount +
        supernovaFinalVal * groupSupernovaCount -
        topBaseFinalValue + finalVal,
    );

    totalVal = Math.min(Number.MAX_VALUE, totalVal + weightedFinalValue);
    for (const [key, count] of groupRarityCounts) {
      const rarityValue = key === 'Infinity' ? MAX_ORB_RARITY : Number(key);
      if (Number.isFinite(rarityValue) && count > 0) {
        rarities.push(rarityValue);
        rarityWeights.push(count);
      }
    }
    s.totalRolls += sampleWeight;
    s.currentRunRolls = (s.currentRunRolls ?? 0) + sampleWeight;
    s.collectionValue = addCollectionValue(s.collectionValue, weightedFinalValue);
    s.lifetimeCollectionValue = addCollectionValue(s.lifetimeCollectionValue, weightedFinalValue);

    uniqueGained += newlyDiscoveredGroupRarities.length;
    const extraCoinsForBaseOrbs = Math.max(1, Math.round(coinsForRarity(rewardRarity) * 0.20));
    extraCoinsEstimate = addCoinAmount(
      extraCoinsEstimate,
      normalizeCoinAmount(extraCoinsForBaseOrbs * ordinaryGroupCount),
    );
    if (normalCriticalGroupCount > 0) {
      const extraCoinsForCriticalOrbs = Math.max(1, Math.round(coinsForRarity(criticalRewardRarity) * 0.20));
      extraCoinsEstimate = addCoinAmount(
        extraCoinsEstimate,
        normalizeCoinAmount(extraCoinsForCriticalOrbs * normalCriticalGroupCount),
      );
    }
    if (groupSupernovaCount > 0) {
      const extraCoinsForSupernovaOrbs = Math.max(1, Math.round(coinsForRarity(supernovaRewardRarity) * 0.20));
      extraCoinsEstimate = addCoinAmount(
        extraCoinsEstimate,
        normalizeCoinAmount(extraCoinsForSupernovaOrbs * groupSupernovaCount),
      );
    }
    if (ordinaryGroupCount > 0 && rewardRarity < 100) {
      const lowCoinsForBaseOrbs = Math.max(1, Math.round(coinsForRarity(rewardRarity)));
      lowRarityCoinsEstimate = addCoinAmount(
        lowRarityCoinsEstimate,
        normalizeCoinAmount(lowCoinsForBaseOrbs * ordinaryGroupCount),
      );
    }
    if (normalCriticalGroupCount > 0 && criticalRewardRarity < 100) {
      const lowCoinsForCriticalOrbs = Math.max(1, Math.round(coinsForRarity(criticalRewardRarity)));
      lowRarityCoinsEstimate = addCoinAmount(
        lowRarityCoinsEstimate,
        normalizeCoinAmount(lowCoinsForCriticalOrbs * normalCriticalGroupCount),
      );
    }
    if (groupSupernovaCount > 0 && supernovaRewardRarity < 100) {
      const lowCoinsForSupernovaOrbs = Math.max(1, Math.round(coinsForRarity(supernovaRewardRarity)));
      lowRarityCoinsEstimate = addCoinAmount(
        lowRarityCoinsEstimate,
        normalizeCoinAmount(lowCoinsForSupernovaOrbs * groupSupernovaCount),
      );
    }
    const lowCoinsForMaximumBaseline = topBaseRewardRarity < 100
      ? Math.max(1, Math.round(coinsForRarity(topBaseRewardRarity)))
      : 0;
    const lowCoinsForActualMaximum = rarity < 100
      ? Math.max(1, Math.round(coinsForRarity(rarity)))
      : 0;
    lowRarityCoinsEstimate = Math.max(
      0,
      lowRarityCoinsEstimate - lowCoinsForMaximumBaseline + lowCoinsForActualMaximum,
    );
    const totalRollsBeforeSample = s.totalRolls - sampleWeight;
    const previousAllTimeRarity = s.highestRarity;
    const groupDryStreakAverage = groupDryStreakBeforeSample + (sampleWeight + 1) / 2;
    const isNewRarityRecord = rarity > previousAllTimeRarity || (isInfinityOrb && !s.highestRarityIsInfinity);
    const dryStreakForBatchProcs = isNewRarityRecord
      ? Math.floor((sampleWeight - 1) / 2)
      : Math.floor(groupDryStreakAverage);
    if (isNewRarityRecord) {
      // The rolls since the previous record become an Aftershock candidate
      // only when a strictly rarer all-time orb finally appears.
      if (s.highestRarity > 0) {
        s.aftershockRecord = Math.max(
          Math.max(0, Math.floor(Number(s.aftershockRecord ?? 0) || 0)),
          groupDryStreakAtMaximum,
        );
        s.highestDryStreak = Math.max(s.highestDryStreak ?? 0, groupDryStreakAtMaximum);
      }
      s.highestRarity = rarity;
      s.highestRarityIsInfinity = isInfinityOrb;
      s.rollsSinceBest = Math.floor((sampleWeight - 1) / 2);
    } else {
      s.rollsSinceBest = groupDryStreakBeforeSample + sampleWeight;
      s.highestDryStreak = Math.max(s.highestDryStreak ?? 0, s.rollsSinceBest);
    }

    // A record starts a new Fracture Cascade; a non-record group consumes its remaining charge.
    if (s.riftSession && s.riftSession.fractureCascadeLevel > 0) {
      const duration = riftFractureCascadeDuration(s.riftSession.fractureCascadeLevel);
      if (isNewRarityRecord) {
        s.riftFractureCascadeRollsRemaining = Math.max(0, duration - Math.floor((sampleWeight - 1) / 2));
      } else {
        s.riftFractureCascadeRollsRemaining = Math.max(0,
          (s.riftFractureCascadeRollsRemaining ?? 0) - sampleWeight);
      }
    }

    // Rift Echo Chamber adds separate, exact copies of the sampled Orb. Echo rolls cannot recurse.
    const riftEchoChance = riftEchoChamberChance(s.riftSession?.echoChamberLevel ?? 0);
    if (s.riftSession && !suppressOtherRuneProcs && riftEchoChance > 0) {
      const riftEchoCount = sampleBinomialCount(sampleWeight, riftEchoChance, rng);
      if (riftEchoCount > 0) {
        // For a compressed multi-roll group, rewardRarity is sampled from an individual Orb;
        // copying it avoids cloning the group's maximum dozens of times.
        const echoSourceRarity = sampleWeight > 1 ? rewardRarity : rarity;
        const echoIsInfinityOrb = !Number.isFinite(echoSourceRarity) || echoSourceRarity > MAX_ORB_RARITY;
        const echoRarity = Math.max(minimumRarity, Math.min(MAX_ORB_RARITY,
          Number.isFinite(echoSourceRarity) ? echoSourceRarity : MAX_ORB_RARITY));
        addRuneBonusRolls(riftEchoCount, { exactRarity: echoRarity, isInfinityOrb: echoIsInfinityOrb, skipAllProcs: true });
      }
    }

    // Discovery Oracle rewards a new-to-this-player rarity at most once per activation.
    const groupDiscoveryChance = newDiscoveryOrbCount > 0
      ? 1 - Math.pow(1 - discoveryOracleChance, newDiscoveryOrbCount)
      : 0;
    if (groupNewRarity && !discoveryOracleTriggered && !suppressOtherRuneProcs && groupDiscoveryChance > 0 && rng() < groupDiscoveryChance) {
      addRuneBonusRolls(runeAbilityEffects.discoveryOracleBonusRolls, { minRarity: Math.max(2, rarity), skipAllProcs: true });
      discoveryOracleTriggered = true;
    }
    // Event Horizon fires only on genuine all-time records and its generated burst cannot recurse.
    if (isNewRarityRecord && !suppressOtherRuneProcs && runeAbilityEffects.eventHorizonPct > 0) {
      const floor = Math.min(MAX_ORB_RARITY, Math.max(rarity + 1, Math.ceil(rarity * eventHorizonRarityMultiplier)));
      addRuneBonusRolls(runeAbilityEffects.eventHorizonBonusRolls, { minRarity: floor, skipAllProcs: true });
    }
    // Milestone Engine has a small bonus-Shard chance and a tightly bounded roll burst.
    if (isNewRarityRecord && previousAllTimeRarity > 0 && !suppressOtherRuneProcs && runeAbilityEffects.milestoneEnginePct > 0) {
      const decadesCrossed = Math.min(5, Math.max(0, Math.floor(Math.log10(rarity)) - Math.floor(Math.log10(previousAllTimeRarity))));
      if (decadesCrossed > 0) {
        const milestoneShardChance = Math.min(.0025, runeAbilityEffects.milestoneEnginePct / 40000);
        if (rng() < milestoneShardChance) {
          shardsGained = Math.min(Number.MAX_SAFE_INTEGER, shardsGained + 1);
        }
        const floor = Math.min(MAX_ORB_RARITY, Math.max(rarity + 1, Math.ceil(rarity * milestoneRarityMultiplier)));
        addRuneBonusRolls(Math.min(2, runeAbilityEffects.milestoneEngineBonusRolls), { minRarity: floor, skipAllProcs: true });
      }
    }
    // Critical Convergence converts a critical hit into a chance for a non-recursive, rarity-floored bonus.
    const normalConvergenceCount = !suppressOtherRuneProcs && normalCriticalGroupCount > 0
      ? sampleBinomialCount(normalCriticalGroupCount, criticalConvergenceChance, rng)
      : 0;
    const supernovaConvergenceCount = !suppressOtherRuneProcs && groupSupernovaCount > 0
      ? sampleBinomialCount(groupSupernovaCount, criticalConvergenceChance, rng)
      : 0;
    if (normalConvergenceCount > 0) {
      const floor = Math.min(
        MAX_ORB_RARITY,
        Math.max(criticalRewardRarity, Math.ceil(criticalRewardRarity * criticalConvergenceRarityMultiplier)),
      );
      addRuneBonusRolls(runeAbilityEffects.criticalConvergenceBonusRolls * normalConvergenceCount, { minRarity: floor, skipAllProcs: true });
    }
    if (supernovaConvergenceCount > 0) {
      const floor = Math.min(
        MAX_ORB_RARITY,
        Math.max(supernovaRewardRarity, Math.ceil(supernovaRewardRarity * criticalConvergenceRarityMultiplier)),
      );
      addRuneBonusRolls(runeAbilityEffects.criticalConvergenceBonusRolls * supernovaConvergenceCount, { minRarity: floor, skipAllProcs: true });
    }
    // Three strictly rising results in the same activation trigger Rarity Ladder once.
    risingRarityChain = rarity > previousBatchRarity ? risingRarityChain + 1 : 1;
    previousBatchRarity = rarity;
    if (!rarityLadderTriggered && !suppressOtherRuneProcs && risingRarityChain >= 3 && runeAbilityEffects.rarityLadderPct > 0) {
      const floor = Math.min(MAX_ORB_RARITY, Math.max(rarity + 1, Math.ceil(rarity * rarityLadderRarityMultiplier)));
      addRuneBonusRolls(runeAbilityEffects.rarityLadderBonusRolls, { minRarity: floor, skipAllProcs: true });
      rarityLadderTriggered = true;
    }
    // Stellar Dividend pays once per activation when a processed roll hits its lifetime milestone.
    if (!stellarDividendTriggered && !suppressOtherRuneProcs && runeAbilityEffects.stellarDividendPct > 0 &&
        Math.floor(s.totalRolls / stellarDividendInterval) > Math.floor(totalRollsBeforeSample / stellarDividendInterval)) {
      addRuneBonusRolls(runeAbilityEffects.stellarDividendBonusRolls, { skipAllProcs: true });
      stellarDividendTriggered = true;
    }
    // Paradox Engine gets one proc check per multi-roll activation.
    if (i === 0 && baseBatchRollCount > 1 && paradoxChance > 0 && rng() < paradoxChance) {
      addRuneBonusRolls(runeAbilityEffects.paradoxEngineBonusRolls, { skipAllProcs: true });
    }
    // Echo Chamber can echo normal rolls and its own echoes; each link has half the chance of the previous link.
    const perOrbEchoChance = echoChance * Math.pow(.5, echoDepth);
    const echoCount = !currentRuneSpec?.skipAllProcs && echoDepth < maxEchoChain
      ? sampleBinomialCount(sampleWeight, perOrbEchoChance, rng)
      : 0;
    if (echoCount > 0) {
      addRuneBonusRolls(echoCount, { echoDepth: echoDepth + 1, echoOnly: true });
    }
    // Prismatic Fork only samples effective Orbs whose category rarity is rare-or-better.
    const ordinaryForkCount = !suppressOtherRuneProcs && rewardRarity >= 1_000
      ? sampleBinomialCount(ordinaryGroupCount, prismaticForkChance, rng)
      : 0;
    const criticalForkCount = !suppressOtherRuneProcs && criticalRewardRarity >= 1_000
      ? sampleBinomialCount(normalCriticalGroupCount, prismaticForkChance, rng)
      : 0;
    const supernovaForkCount = !suppressOtherRuneProcs && supernovaRewardRarity >= 1_000
      ? sampleBinomialCount(groupSupernovaCount, prismaticForkChance, rng)
      : 0;
    if (ordinaryForkCount > 0) {
      const floor = Math.min(MAX_ORB_RARITY, Math.max(rewardRarity + 1, Math.ceil(rewardRarity * prismaticForkRarityMultiplier)));
      addRuneBonusRolls(ordinaryForkCount, { minRarity: floor, skipAllProcs: true });
    }
    if (criticalForkCount > 0) {
      const floor = Math.min(MAX_ORB_RARITY, Math.max(criticalRewardRarity + 1, Math.ceil(criticalRewardRarity * prismaticForkRarityMultiplier)));
      addRuneBonusRolls(criticalForkCount, { minRarity: floor, skipAllProcs: true });
    }
    if (supernovaForkCount > 0) {
      const floor = Math.min(MAX_ORB_RARITY, Math.max(supernovaRewardRarity + 1, Math.ceil(supernovaRewardRarity * prismaticForkRarityMultiplier)));
      addRuneBonusRolls(supernovaForkCount, { minRarity: floor, skipAllProcs: true });
    }

    if (rarity > bestRarity || (isInfinityOrb && !bestIsInfinity)) {
      bestRarity = rarity;
      bestRewardRarity = topBaseRewardRarity;
      bestIsCrit = isCrit;
      bestIsNew = isNew;
      bestIsInfinity = isInfinityOrb;
    } else if (rarity === bestRarity) {
      bestRewardRarity = Math.max(bestRewardRarity, topBaseRewardRarity);
      if (isCrit) bestIsCrit = true;
      bestIsNew = bestIsNew || isNew;
      bestIsInfinity = bestIsInfinity || isInfinityOrb;
    }

    const xpBonusMul =
      (1 + (s.upgrades.xpBonus ?? 0) * 0.20) *
      levelBenefits.xpMultiplier *
      (1 + runeBonuses.xpGainPct / 100) *
      riftMultipliers.xpMultiplier;
    const xpForBaseOrb = Math.round(Math.min(300, 12 + Math.floor(Math.log10(rewardRarity + 1) * 12)) * xpBonusMul);
    const xpForCriticalOrb = Math.round(Math.min(300, 12 + Math.floor(Math.log10(criticalRewardRarity + 1) * 12)) * xpBonusMul);
    const xpForSupernovaOrb = Math.round(Math.min(300, 12 + Math.floor(Math.log10(supernovaRewardRarity + 1) * 12)) * xpBonusMul);
    const xpForTopBaseline = Math.round(
      Math.min(300, 12 + Math.floor(Math.log10(topBaseRewardRarity + 1) * 12)) * xpBonusMul,
    );
    const xpForGroupMaximum = Math.round(
      Math.min(300, 12 + Math.floor(Math.log10(rarity + 1) * 12)) * xpBonusMul,
    );
    const earnedXp = Math.min(
      Number.MAX_SAFE_INTEGER,
      xpForBaseOrb * ordinaryGroupCount +
        xpForCriticalOrb * normalCriticalGroupCount +
        xpForSupernovaOrb * groupSupernovaCount -
        xpForTopBaseline + xpForGroupMaximum,
    );
    const balancedEarnedXp = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.round(earnedXp * liveBalance['rewards.xpMultiplier']),
    );

    // High rarity is not a guaranteed Shard source. All repeatable Orb earnings are proc-based.
    let earnedShards = 0;
    const shardDropsDisabled = s.riftSession?.challengeId === 'first-spark';
    const shardTitheChance = Math.min(0.000125, Math.max(0, runeAbilityEffects.shardTithePerRoll) * 0.5);
    // Dry-Streak Refinery converts its former fractional drip into a reduced chance for one whole Shard.
    const dryRefineryChance = Math.min(0.000125, Math.floor(Math.max(0, dryStreakForBatchProcs) / 100) * Math.max(0, runeAbilityEffects.dryStreakRefineryRate) * 0.5);

    // Shard Chance upgrade + Mastery + Guild perk proc
    const shardProcChance = Math.min(
      ROLL_SHARD_PROC_CHANCE_CAP,
      ((s.upgrades.shardChance ?? 0) * 0.0015 +
      (s.masterySkills?.shardAttunement ?? 0) * 0.001 +
      (s.guildPerks?.shardRank ?? 0) * 0.0005 +
      (s.prestigeUpgrades?.shardResonator ?? 0) * 0.0025 +
      levelBenefits.shardChance +
      Math.min(100, runeBonuses.shardChancePct) / 100) * 0.025 *
      liveBalance['rewards.shardChanceMultiplier']
    );
    if (sampleWeight > 1) {
      const combinedShardChance = 1 -
        (1 - (suppressOtherRuneProcs ? 0 : shardTitheChance)) *
        (1 - (suppressOtherRuneProcs ? 0 : dryRefineryChance)) *
        (1 - shardProcChance);
      const baseShardCount = sampleBinomialCount(sampleWeight, combinedShardChance, rng);
      s.shardPityRolls = 0;
      const jackpotCount = !suppressOtherRuneProcs && shardJackpotChance > 0
        ? sampleBinomialCount(baseShardCount, shardJackpotChance, rng)
        : 0;
      const jackpotExtra = Math.max(0, Math.min(1, Math.round(1 + runeAbilityEffects.shardJackpotExtraMultiplier) - 1));
      earnedShards = baseShardCount + jackpotCount * jackpotExtra;
    } else {
      if (!suppressOtherRuneProcs && shardTitheChance > 0 && rng() < shardTitheChance) earnedShards += 1;
      if (!suppressOtherRuneProcs && dryRefineryChance > 0 && rng() < dryRefineryChance) earnedShards += 1;
      const shardProcTriggered = rng() < shardProcChance;
      earnedShards += resolveShardPityReward(s, shardProcTriggered);
      // Multiple low-probability effects cannot stack into a large per-Orb payout.
      // Jackpot is the one exception: a successful proc may turn one Shard into two.
      earnedShards = Math.min(1, earnedShards);
      if (earnedShards > 0 && !suppressOtherRuneProcs && shardJackpotChance > 0 && rng() < shardJackpotChance) {
        earnedShards = Math.min(2, Math.round(earnedShards * (1 + runeAbilityEffects.shardJackpotExtraMultiplier)));
      }
    }

    if (shardDropsDisabled) earnedShards = 0;
    shardsGained = Math.min(Number.MAX_SAFE_INTEGER, shardsGained + earnedShards);
    xpGained = Math.min(Number.MAX_SAFE_INTEGER, xpGained + balancedEarnedXp);

    // Shard Constellation retains charge between activations and pays only once per activation.
    if (runeAbilityEffects.shardConstellationPct > 0) {
      s.runeConstellationCharge = Math.min(1_000_000, validCharge(s.runeConstellationCharge) + earnedShards);
      if (source !== 'frenzy' && !constellationTriggered && !suppressOtherRuneProcs && s.runeConstellationCharge >= shardConstellationThreshold) {
        s.runeConstellationCharge -= shardConstellationThreshold;
        shardsGained = Math.min(Number.MAX_SAFE_INTEGER, shardsGained + runeAbilityEffects.shardConstellationBonusShards);
        addRuneBonusRolls(runeAbilityEffects.shardConstellationBonusRolls, { skipAllProcs: true });
        constellationTriggered = true;
      }
    }

    // Temporal Loop charges on every real roll, then releases a bounded bonus batch.
    if (temporalMomentumPerRoll > 0) {
      const dryStreakMomentum = Math.min(5, Math.log2(Math.max(1, dryStreakForBatchProcs + 1)) * .25);
      s.runeTemporalMomentum = Math.min(
        1_000_000,
        validCharge(s.runeTemporalMomentum) + sampleWeight * (temporalMomentumPerRoll + dryStreakMomentum),
      );
      if (source !== 'frenzy' && !temporalLoopTriggered && !suppressOtherRuneProcs && s.runeTemporalMomentum >= 100) {
        s.runeTemporalMomentum -= 100;
        addRuneBonusRolls(runeAbilityEffects.temporalLoopBonusRolls, { skipAllProcs: true });
        temporalLoopTriggered = true;
      }
    }

    const orbInfo = getOrbInfo(rarity, isInfinityOrb);
    if (batch.length < 50) {
      batch.push({
        rarity,
        rolledAt: now,
        tier: orbInfo.tier,
        name: orbInfo.name,
        isInfinity: isInfinityOrb,
        isNew,
        isCrit,
      });
    }

    processedEffectiveRolls += sampleWeight;
    if (onProgress && ((i + 1) % 100 === 0 || i + 1 === simulationLoopCount)) {
      await onProgress(processedEffectiveRolls);
    }
  }
  if (onProgress && processedEffectiveRolls > 0) {
    await onProgress(processedEffectiveRolls);
  }

  // Balanced Gold progression: top rolled Orb pays 100%; every other effective
  // Orb contributes 20% of its base-equivalent coin value.
  const topCoins = Math.round(coinsForRarity(bestRarity));
  const topExtraCoins = Math.max(1, Math.round(coinsForRarity(bestRewardRarity) * 0.20));
  const extraCoins = Math.max(0, extraCoinsEstimate - topExtraCoins);
  coinsGained = addCoinAmount(topCoins, extraCoins);

  // Level passives and other coin modifiers stack multiplicatively by source.
  const goldenOrbitStacks = celestialAlignmentStackCount(s.alignmentActiveInstances, 'goldenOrbit');
  const coinBonusMul =
    Math.pow(1.5, goldenOrbitStacks) *
    levelBenefits.coinsMultiplier *
    (1 + (s.upgrades.coinBonus ?? 0) * 0.15) *
    orbFingersMultiplier(s) *
    criticalDividendMultiplier(s, criticalRollsInBatch / Math.max(1, rollCount)) *
    (1 + (s.masterySkills?.prosperity ?? 0) * 0.12) *
    (1 + (s.guildPerks?.coinRank ?? 0) * 0.10) *
    (1 + runeBonuses.coinGainPct / 100) *
    (1 + (s.riftSession?.upgradeLevels.prosperity ?? 0) * 0.20) *
    (s.riftSession
      ? 1 + Math.min(2, Math.max(0, Math.log10(Math.max(1, bestRarity / s.riftSession.targetRarity))) *
        (s.riftSession.fractureRecyclingLevel ?? 0) * 0.05)
      : 1) *
    (mutationActive ? 1 + (s.riftSession?.anomalyHarvestingLevel ?? 0) * 0.05 : 1) *
    mutationCoinMultiplier;
  coinsGained = normalizeCoinAmount(Math.round(coinsGained * coinBonusMul));

  const lowRarityCoins = lowRarityCoinsEstimate;

  // Singularity Filter: +25% only to Common/Uncommon coin yield.
  const hasFilter = (s.prestigeUpgrades?.autoFilter ?? 0) > 0;
  if (hasFilter && lowRarityCoins > 0) {
    coinsGained = addCoinAmount(coinsGained, Math.round(lowRarityCoins * 0.25));
  }

  // Alchemical Transmutation: bonus low-rarity Coins and a small whole-Shard proc per Orb.
  const transLevel = s.prestigeUpgrades?.transmutation ?? 0;
  if (transLevel > 0) {
    coinsGained = addCoinAmount(coinsGained, Math.round(lowRarityCoins * (transLevel * 0.15)));
    shardsGained = Math.min(
      Number.MAX_SAFE_INTEGER,
      shardsGained + sampleBinomialCount(rollCount, Math.min(1, 0.00025 * transLevel), rng),
    );
  }

  // Offline Foundry is a separate Coin bonus that never affects live rolls or Frenzy.
  if (source === 'offline') {
    coinsGained = normalizeCoinAmount(Math.round(coinsGained * offlineFoundryMultiplier(s)));
  }

  // Offline Fortune only modifies rewards generated from the offline vault.
  if (source === 'offline' && (s.prestigeUpgrades?.offlineFortune ?? 0) > 0) {
    coinsGained = Math.round(coinsGained * (1 + (s.prestigeUpgrades.offlineFortune * 0.25)));
  }

  // Offline Overdrive was intended to improve offline rewards, not online rolls.
  if (source === 'offline' && (s.prestigeUpgrades?.offlineOverdrive ?? 0) > 0) {
    coinsGained = Math.round(coinsGained * (1 + (s.prestigeUpgrades.offlineOverdrive * 0.50)));
  }

  // Persistent Rift perks multiply the complete Coin payout, including filtered and transmuted bonuses.
  coinsGained = normalizeCoinAmount(Math.round(
    coinsGained * riftMultipliers.coinMultiplier * (s.riftSession?.challengeCoinMultiplier ?? 1),
  ));
  coinsGained = normalizeCoinAmount(coinsGained);
  if (!previewOnly && !s.riftSession) {
    const pendingGuildWrite = getPendingSaveExtraWrite(s, 'io:guilds');
    const rareOrbCount = countGuildTaskRareOrbs(rarities, rarityWeights);
    let guildEffects: Awaited<ReturnType<typeof prepareGuildRollEffects>>;
    try {
      guildEffects = await prepareGuildRollEffects(totalVal, rollCount, bestRarity, pendingGuildWrite, rareOrbCount);
    } catch (error) {
      // Guild task progress is an optional projection, not a dependency for a valid roll.
      console.error('[Guild] Could not prepare task progress; the player roll will still complete.', error);
      guildEffects = {};
    }
    if (guildEffects.extraWrite) {
      stageSaveExtraWrite(s, guildEffects.extraWrite);
    }
  
  }
  coinsGained = addCoins(s, coinsGained);
  shardsGained = grantRollShards(s, shardsGained);

  // Ascension increases XP by 10× while preserving the existing level logic.
  const effectiveXpGained = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.round(isPremiumBoosterActive(s, 'ascension') ? xpGained * 10 : xpGained),
  );
  s.xp += effectiveXpGained;
  xpGained = effectiveXpGained;

  // Rich EXP Level Progression. Normal roll activations deliberately advance
  // at most one level at a time, while applyXp/quest rewards can catch up safely.
  applyLevelProgress(s, 1);

  // Count only successfully processed online roll batches as an active session;
  // offline-vault rolls don't fabricate a continuous play session.
  if ((source === 'online' || source === 'frenzy') && rollCount > 0) recordRollingSessionActivity(s, now);

  // Coin earnings and lifetime totals saturate only at the largest finite Number.

  // Celestial Auto-Buyer Prestige Upgrade: auto-buy cheapest affordable upgrade
  const autoBuyerLevel = s.prestigeUpgrades?.autoBuyer ?? 0;
  if (autoBuyerLevel > 0 && s.coins > AUTO_BUYER_COIN_RESERVE) {
    autoBuyCheapest(s, AUTO_BUYER_COIN_RESERVE);
  }

  advanceQuestProgress(s, 'roll', rollCount);
  if (bestRarity >= 100) advanceQuestProgress(s, 'rare', bestRarity);
  advanceQuestProgress(s, 'value', totalVal);
  advanceQuestProgress(s, 'unique', uniqueGained);

  if (!previewOnly && !s.riftSession) {
    const pendingCommunityWrite = getPendingSaveExtraWrite(s, 'io:community_event');
    try {
      const communityUpdate = await prepareCommunityRolls(rollCount, pendingCommunityWrite);
      stageSaveExtraWrite(s, {
        key: communityUpdate.key,
        expectedValue: communityUpdate.expectedValue,
        nextValue: communityUpdate.nextValue,
        conflictMessage: 'Community event changed before the roll saved. Please retry.',
        optional: true,
      });
    } catch (error) {
      // The World Event projection is best-effort. A corrupt shared event must
      // never cause the primary player roll rewards to be discarded. Do not stage
      // a replacement or clear the raw event: repair remains explicit/admin-only.
      console.error('[Community Event] Progress not recorded for this roll; preserving shared data.', error);
    }
  
  
  }
  const bestInfo = getOrbInfo(bestRarity, bestIsInfinity);
  const bestOrb: Orb = {
    rarity: bestRarity,
    rolledAt: now,
    tier: bestInfo.tier,
    name: bestInfo.name,
    isInfinity: bestIsInfinity,
    isNew: bestIsNew,
    isCrit: bestIsCrit,
  };

  // Scan the sample list iteratively; spreading tens of thousands of values into Math.min/max can overflow the runtime call stack.
  const rarityBounds = getRarityBounds(rarities);

  if (!previewOnly) {
    await appendPlayerSpyLog('roll', {
      source,
      forcedRarity: forcedRarity ?? null,
      requestedRollCount,
      processedRollCount: rollCount,
      activationCount,
      rarityMin: rarityBounds.min,
      rarityMax: rarityBounds.max,
      rarityAverage: rarities.length
        ? Math.round(rarities.reduce((sum, rarity, index) => sum + rarity * rarityWeights[index], 0) / rarityWeights.reduce((sum, weight) => sum + weight, 0))
        : 0,
      rarityHistogram: {
        '2-9': rarities.reduce((sum, r, index) => sum + (r < 10 ? rarityWeights[index] : 0), 0),
        '10-99': rarities.reduce((sum, r, index) => sum + (r >= 10 && r < 100 ? rarityWeights[index] : 0), 0),
        '100-999': rarities.reduce((sum, r, index) => sum + (r >= 100 && r < 1_000 ? rarityWeights[index] : 0), 0),
        '1k-9.9k': rarities.reduce((sum, r, index) => sum + (r >= 1_000 && r < 10_000 ? rarityWeights[index] : 0), 0),
        '10k-99.9k': rarities.reduce((sum, r, index) => sum + (r >= 10_000 && r < 100_000 ? rarityWeights[index] : 0), 0),
        '100k-999.9k': rarities.reduce((sum, r, index) => sum + (r >= 100_000 && r < 1_000_000 ? rarityWeights[index] : 0), 0),
        '1m-9.9m': rarities.reduce((sum, r, index) => sum + (r >= 1_000_000 && r < 10_000_000 ? rarityWeights[index] : 0), 0),
        '10m+': rarities.reduce((sum, r, index) => sum + (r >= 10_000_000 ? rarityWeights[index] : 0), 0),
      },
      sampleRarities: rarities.slice(0, 50),
      coinsPerRoll: rollCount > 0 ? Math.round(coinsGained / rollCount) : 0,
      xpPerRoll: rollCount > 0 ? Math.round(xpGained / rollCount) : 0,
      shardsPerRoll: rollCount > 0 ? Number((shardsGained / rollCount).toFixed(4)) : 0,
      bestRarity,
      criticalRolls: Math.max(0, (s.totalCrits ?? 0) - spyBefore.totalCrits),
      uniqueGained,
      coinsGained,
      shardsGained,
      xpGained,
      onlineCcu: s.onlinePlayers ?? 1,
      fakeCcuBonus,
      luckMultiplier: Math.min(Number.MAX_VALUE, effectiveLuck * batchPlan.compressionWeight * batchPlan.compressionWeight),
      compressionWeight: batchPlan.compressionWeight,
      simulatedRollCount: simulationLoopCount,
      communityLuck,
      critChance: effectiveCritChance,
      critMultiplier: cm,
      codexCollectionKeys: Object.keys(s.collection || {}).length,
      codexProgress: Math.max(0, Math.floor(Math.log2(Object.keys(s.collection || {}).length + 1))),
      masteryCelestialSurge: s.masterySkills?.celestialSurge ?? 0,
      globalBoosters,
      level: s.level,
      before: spyBefore,
      after: {
        totalRolls: s.totalRolls,
        totalCrits: s.totalCrits ?? 0,
        coins: s.coins,
        shards: s.shards,
        xp: s.xp,
        level: s.level,
        highestRarity: s.highestRarity,
      },
      userId: spyUserId,
    }, spyUserId).catch(error => {
      console.error('[Player Spy] Background roll log failed:', error);
    });
  }

  return { bestOrb, batch, totalVal, coinsGained, shardsGained, xpGained, rollCount };
}

async function commitOfflineNotificationMarkerIfUnchanged(
  keyName: string,
  ownedToken: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(keyName);
    try {
      const current = await redis.get(keyName);
      if (current == null || String(current) !== ownedToken) {
        await txn.unwatch();
        return false;
      }
      await txn.multi();
      await txn.set(keyName, '1');
      if (await txn.exec() !== null) return true;
    } catch (error) {
      await txn.unwatch().catch(() => undefined);
      throw error;
    }
  }
  return false;
}

function parseOfflineFullNotificationAttemptMarker(
  raw: unknown,
): { phase: 'reserved' | 'sending'; startedAt: number } | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^(reserved-v2|sending-v2):([0-9a-z]+):([a-z0-9-]+)$/);
  if (!match) return null;
  const startedAt = Number.parseInt(match[2], 36);
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) return null;
  return {
    phase: match[1] === 'reserved-v2' ? 'reserved' : 'sending',
    startedAt,
  };
}

async function deleteOfflineFullNotificationMarkerIfUnchanged(
  keyName: string,
  expectedValue: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(keyName);
    let current: string | null;
    try {
      current = await redis.get(keyName);
    } catch (error) {
      await txn.unwatch().catch(() => undefined);
      throw error;
    }
    if (current == null || String(current) !== expectedValue) {
      await txn.unwatch();
      return false;
    }

    await txn.multi();
    await txn.del(keyName);
    if (await txn.exec() !== null) return true;
  }
  return false;
}

async function readOfflineNotificationMarkerAndRepairLegacyKey(
  notificationKey: string,
): Promise<string | null> {
  const marker = await redis.get(notificationKey);
  if (marker !== '') return marker;

  // Older versions wrote an empty marker instead of deleting the key. Remove
  // that tombstone under compare-and-delete so it cannot block a later SET NX.
  await deleteOfflineFullNotificationMarkerIfUnchanged(notificationKey, '');
  return await redis.get(notificationKey);
}

async function claimOfflineFullNotificationSendingIfUnchanged(
  keyName: string,
  reservedToken: string,
  sendingToken: string,
  expiresAt: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(keyName);
    try {
      const current = await redis.get(keyName);
      if (current == null || String(current) !== reservedToken) {
        await txn.unwatch();
        return false;
      }
      await txn.multi();
      await txn.set(keyName, sendingToken, { expiration: new Date(expiresAt) });
      if (await txn.exec() !== null) return true;
    } catch (error) {
      await txn.unwatch().catch(() => undefined);
      throw error;
    }
  }
  return false;
}

async function sendOfflineFullNotification(userId: string, subredditName: string): Promise<boolean> {
  const notificationKey = OFFLINE_FULL_NOTIFICATION_PREFIX + userId;

  // Only a v2 "reserved" marker proves the provider has not been called yet.
  // It can be reclaimed after its short lease. Legacy pending markers and v2
  // "sending" markers are ambiguous, so fail closed to avoid duplicate alerts.
  let reservationAvailable = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await redis.get(notificationKey);
    if (existing == null) {
      reservationAvailable = true;
      break;
    }

    const parsed = parseOfflineFullNotificationAttemptMarker(existing);
    const now = Date.now();
    const legacyPendingStartedAt = offlineLegacyPendingMarkerStartedAt(existing, now);
    const staleReservedMarker =
      parsed?.phase === 'reserved' &&
      now - parsed.startedAt >= OFFLINE_FULL_RESERVATION_TTL_MS;
    const staleSendingMarker =
      parsed?.phase === 'sending' &&
      now - parsed.startedAt >= OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS + 60_000;
    const staleLegacyPendingMarker =
      legacyPendingStartedAt !== null &&
      now - legacyPendingStartedAt >= OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS + 60_000;
    if (existing === '' || staleReservedMarker || staleSendingMarker || staleLegacyPendingMarker) {
      // Empty values are legacy tombstones. A reserved-v2 marker is safe to reclaim
      // because provider I/O is gated by the CAS transition to sending-v2. Sending
      // and legacy pending markers are kept through the seven-day ambiguity window,
      // then reclaimed under the explicit retry-after-lease policy.
      await deleteOfflineFullNotificationMarkerIfUnchanged(notificationKey, existing);
      continue;
    }
    if (parsed?.phase === 'reserved') {
      // Keep the scheduler retry path alive while the other request is still
      // preparing. Returning false would clear the only job without a retry.
      throw new Error('Offline notification reservation is still being prepared; retry later.');
    }
    return false;
  }
  if (!reservationAvailable) {
    throw new Error('Offline notification reservation is changing repeatedly; retry later.');
  }

  if (!(await isNotificationPreferenceEnabled(userId, 'offlineOrbs'))) return false;

  // Reserve briefly before the external call. If SET or its verification GET
  // has an ambiguous failure, no provider call occurs, and a later job can
  // reclaim this reserved-v2 marker after the lease expires.
  const attemptNow = Date.now();
  const nonce = secureServerToken('offline-notification');
  const reservationStamp = attemptNow.toString(36);
  const reservedToken = `reserved-v2:${reservationStamp}:${nonce}`;
  const sendingToken = `sending-v2:${reservationStamp}:${nonce}`;
  let reservationWriteFailed = false;
  let reservationWriteError: unknown;
  try {
    await redis.set(notificationKey, reservedToken, {
      nx: true,
      expiration: new Date(attemptNow + OFFLINE_FULL_RESERVATION_TTL_MS),
    });
  } catch (error) {
    reservationWriteFailed = true;
    reservationWriteError = error;
  }

  let storedReservation: string | null;
  try {
    storedReservation = await redis.get(notificationKey);
  } catch (readError) {
    if (reservationWriteFailed) {
      console.error('[Offline Notification] Could not verify an ambiguous reservation write.', readError);
      throw reservationWriteError;
    }
    throw readError;
  }
  if (storedReservation !== reservedToken) {
    if (reservationWriteFailed && storedReservation == null) throw reservationWriteError;
    const competingReservation = parseOfflineFullNotificationAttemptMarker(storedReservation);
    if (storedReservation === '' || competingReservation?.phase === 'reserved') {
      throw new Error('Another offline notification reservation is being prepared; retry later.');
    }
    return false;
  }
  if (reservationWriteFailed) {
    console.warn('[Offline Notification] Reserved token was confirmed after an ambiguous Redis SET failure; continuing.', reservationWriteError);
  }

  // Move from "reserved" to "sending" atomically before provider I/O. Recovery
  // may reclaim only reserved-v2; sending-v2 remains held if enqueue or its
  // receipt write has an ambiguous outcome, preserving at-most-once delivery.
  const sendingClaimed = await claimOfflineFullNotificationSendingIfUnchanged(
    notificationKey,
    reservedToken,
    sendingToken,
    attemptNow + OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS,
  );
  if (!sendingClaimed) {
    throw new Error('Offline notification reservation changed before sending; retry later.');
  }

  const dailySlot = await reserveNotificationDailySendSlot(userId);
  if (!dailySlot.allowed) {
    // No provider call was made, so release the in-flight notification marker.
    await deleteOfflineFullNotificationMarkerIfUnchanged(notificationKey, sendingToken);
    return false;
  }

  try {
    await notifications.enqueue({
      title: 'Infinity Orbs',
      body: 'your offline orbs are full, make sure to collect them! ',
      recipients: [{
        userId,
        link: `https://reddit.com/r/${subredditName}`,
      }],
    });
  } catch (error) {
    if (isNotificationDailyLimitError(error)) {
      await markNotificationDailyLimitReached(userId);
      await deleteOfflineFullNotificationMarkerIfUnchanged(notificationKey, sendingToken);
      return false;
    }
    throw error;
  }
  try {
    await markNotificationAttributionPending(userId, 'offline-full', Date.now());
  } catch (error) {
    console.warn('[Offline Notification] Could not record return-session attribution.', error);
  }

  // Compare-and-set prevents a concurrent offline-roll claim from clearing the
  // sending marker and then having this request resurrect a stale receipt.
  const receiptCommitted = await commitOfflineNotificationMarkerIfUnchanged(notificationKey, sendingToken);
  if (!receiptCommitted) {
    // The provider call succeeded, but we could not confirm the durable receipt.
    // Do not report a confirmed send; the worker will preserve/recheck the
    // sending lease and retry only after its ambiguity window has elapsed.
    const currentMarker = await redis.get(notificationKey);
    if (currentMarker !== '1') {
      console.error('[Offline Notification] Provider accepted the attempt but the sent receipt could not be confirmed.');
      return false;
    }
  }
  return true;
}

function offlineLegacyPendingMarkerStartedAt(marker: unknown, now = Date.now()): number | null {
  const pendingMatch = typeof marker === 'string'
    ? /^pending:([0-9a-z]+):/.exec(marker)
    : null;
  const parsedAt = pendingMatch ? Number.parseInt(pendingMatch[1], 36) : NaN;
  return Number.isSafeInteger(parsedAt) && parsedAt > 0 && parsedAt <= now + 60_000
    ? parsedAt
    : null;
}

function offlineNotificationPendingRetryAt(marker: unknown, now = Date.now()): number {
  const parsed = parseOfflineFullNotificationAttemptMarker(marker);
  if (parsed?.phase === 'reserved') {
    return Math.max(now + 1_000, parsed.startedAt + OFFLINE_FULL_RESERVATION_TTL_MS + 1_000);
  }
  if (parsed?.phase === 'sending') {
    return Math.max(now + 1_000, parsed.startedAt + OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS + 60_000);
  }

  // Older versions used pending:<time>:<nonce> with a seven-day expiry. Keep
  // those ambiguous attempts fail-closed, then retry once their lease elapses.
  const pendingAt = offlineLegacyPendingMarkerStartedAt(marker, now) ?? now;
  return Math.max(now + 1_000, pendingAt + OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS + 60_000);
}

function isRetryableOfflineFullNotificationMarker(marker: unknown): marker is string {
  return parseOfflineFullNotificationAttemptMarker(marker) !== null ||
    (typeof marker === 'string' && /^pending:[0-9a-z]+:.+$/.test(marker));
}

function parseOfflineFullJobMarker(
  raw: unknown,
): { token: string; legacy: boolean } | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      typeof parsed.token === 'string' && parsed.token.length > 0
    ) {
      return { token: parsed.token, legacy: false };
    }
  } catch {
    // Older jobs stored only the scheduler's job ID. Keep a constrained
    // compatibility path for them; all newly created jobs carry a token.
  }
  return { token: raw, legacy: true };
}

async function replaceOfflineFullJobMarkerIfUnchanged(
  keyName: string,
  expectedValue: string,
  nextValue: string,
  expiresAt: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(keyName);
    const current = await redis.get(keyName);
    if (current == null || String(current) !== expectedValue) {
      await txn.unwatch();
      return false;
    }
    await txn.multi();
    await txn.set(keyName, nextValue, { expiration: new Date(expiresAt) });
    if (await txn.exec() !== null) return true;
  }
  return false;
}

async function scheduleOfflineFullNotification(
  userId: string,
  subredditName: string,
  runAt: number,
  allowReservationRetry = false,
): Promise<void> {
  if (!subredditName || !userId) return;
  const notificationKey = OFFLINE_FULL_NOTIFICATION_PREFIX + userId;
  let notificationMarker = await redis.get(notificationKey);
  if (notificationMarker === '') {
    // Recover empty-string tombstones written by older compare-and-clear code.
    await deleteOfflineFullNotificationMarkerIfUnchanged(notificationKey, '');
    notificationMarker = await redis.get(notificationKey);
  }
  if (notificationMarker === '1') return;
  let effectiveRunAt = Number(runAt);
  if (notificationMarker != null) {
    if (!allowReservationRetry || !isRetryableOfflineFullNotificationMarker(notificationMarker)) return;
    // If a competing request advanced reserved -> sending after the caller chose
    // its retry time, honor the longer sending lease rather than polling it early.
    effectiveRunAt = Math.max(
      Number.isFinite(effectiveRunAt) ? effectiveRunAt : Date.now() + OFFLINE_FULL_RETRY_MS,
      offlineNotificationPendingRetryAt(notificationMarker),
    );
  }
  if (!(await isNotificationPreferenceEnabled(userId, 'offlineOrbs'))) return;

  const jobKey = OFFLINE_FULL_JOB_PREFIX + userId;
  const now = Date.now();
  const maxDateMs = 8_640_000_000_000_000;
  const requestedRunAt = effectiveRunAt;
  const safeRunAt = Math.min(
    maxDateMs - 1,
    Math.max(now + 1_000, Number.isFinite(requestedRunAt) ? requestedRunAt : now + 1_000),
  );
  const expiresAt = Math.max(now + 60_000, Math.min(maxDateMs - 1, safeRunAt + OFFLINE_FULL_RETRY_MS * 2));
  const token = secureServerToken('offline-job');
  const reservation = JSON.stringify({ token, jobId: null, runAt: safeRunAt });

  // Reserve before making the scheduler call. Two overlapping requests can no
  // longer each create a live scheduler job for the same player.
  let reserved = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(jobKey);
    const existing = await redis.get(jobKey);
    if (existing) {
      await txn.unwatch();
      return;
    }
    await txn.multi();
    await txn.set(jobKey, reservation, { expiration: new Date(expiresAt) });
    if (await txn.exec() !== null) {
      reserved = true;
      break;
    }
  }
  if (!reserved) throw new Error('Offline reminder scheduling changed repeatedly. Please retry.');

  try {
    const jobId = await scheduler.runJob({
      name: 'offline-orbs-full',
      data: { userId, subredditName, jobToken: token },
      runAt: new Date(safeRunAt),
    });
    const scheduled = JSON.stringify({ token, jobId: String(jobId), runAt: safeRunAt });
    // If this reservation was superseded while runJob was in flight, do not
    // overwrite the newer marker. The orphaned job will no-op on token mismatch.
    await replaceOfflineFullJobMarkerIfUnchanged(jobKey, reservation, scheduled, expiresAt);
  } catch (error) {
    await clearOfflineReminderKeyIfUnchanged(jobKey, reservation).catch(() => false);
    throw error;
  }
}

export async function processOfflineFullNotification(
  userId: string,
  subredditName: string,
  jobToken?: string,
): Promise<void> {
  return withPlayerMutationLockFor(`offline-notification:${userId}`, async () => {
  const jobKey = OFFLINE_FULL_JOB_PREFIX + userId;
  const jobRaw = await redis.get(jobKey);
  const marker = parseOfflineFullJobMarker(jobRaw);
  if (!marker) return;

  // Token-bearing jobs must still own the exact current reservation. A delayed
  // worker from an older schedule cannot consume or delete a newer reminder.
  if (jobToken) {
    if (marker.legacy || marker.token !== jobToken) return;
  } else if (!marker.legacy) {
    // A pre-deployment job does not know the new token, so it must not handle
    // a reservation created by this version.
    return;
  }
  const expectedJobValue = String(jobRaw);

  const storedRaw = await redis.get('player:' + userId);
  const raw = await readStoredPlayerSave(userId, storedRaw);
  if (!raw) {
    await clearOfflineReminderKeyIfUnchanged(jobKey, expectedJobValue);
    return;
  }

  // Use the same strict parser as player mutations. Parsing JSON alone would
  // accept structurally invalid saves and could send a full-roll alert from
  // malformed counters or timestamps. Preserve the job so repair/retry remains possible.
  const s = parsePlayerStateValue(raw);
  if (!s) {
    console.error('[Offline Notification] Player save is malformed; preserving the job marker.');
    return;
  }

  const cap = offlineRollCap(s);
  const now = Date.now();
  const liveBalance = await getLiveBalanceConfig();
  const tickMs = Math.max(1_000, effectiveOfflineTickMs(s) / liveBalance['offline.generationMultiplier']);
  const lastSeenAt = s.lastSeenAt || now;
  const elapsed = Math.max(0, now - lastSeenAt);
  const earned = Math.floor(elapsed / tickMs);
  const currentOfflineRolls = Math.min(cap, (s.offlineRolls || 0) + earned);

  if (currentOfflineRolls < cap) {
    const fullAt = now + Math.max(1_000, (cap - currentOfflineRolls) * tickMs);
    const cleared = await clearOfflineReminderKeyIfUnchanged(jobKey, expectedJobValue);
    if (cleared) await scheduleOfflineFullNotification(userId, subredditName, fullAt);
    return;
  }

  const notificationKey = OFFLINE_FULL_NOTIFICATION_PREFIX + userId;
  try {
    const sent = await sendOfflineFullNotification(userId, subredditName);
    const cleared = await clearOfflineReminderKeyIfUnchanged(jobKey, expectedJobValue);
    if (!sent && cleared) {
      const notificationMarker = await redis.get(notificationKey);
      if (notificationMarker === null && await isNotificationPreferenceEnabled(userId, 'offlineOrbs')) {
        // Reddit's daily quota was already used. Re-attempt just after the UTC day resets.
        await scheduleOfflineFullNotification(userId, subredditName, nextUtcNotificationDay());
      } else if (notificationMarker === '') {
        // An older clear path may have left an empty-valued key that still blocks SET NX.
        await scheduleOfflineFullNotification(userId, subredditName, Date.now() + OFFLINE_FULL_RETRY_MS);
      } else if (isRetryableOfflineFullNotificationMarker(notificationMarker)) {
        await scheduleOfflineFullNotification(
          userId,
          subredditName,
          offlineNotificationPendingRetryAt(notificationMarker),
          true,
        );
      }
    }
  } catch (error) {
    console.error('Failed to send scheduled offline-orbs-full notification:', error);
    let notificationMarker: string | null = null;
    let markerReadFailed = false;
    try {
      notificationMarker = await redis.get(notificationKey);
    } catch (markerReadError) {
      // A failed verification read is unknown, not proof the reservation is absent.
      markerReadFailed = true;
      console.error('[Offline Notification] Could not inspect the attempt marker before retry scheduling.', markerReadError);
    }

    const retryableMarker = isRetryableOfflineFullNotificationMarker(notificationMarker);
    if (
      notificationMarker === '1' ||
      (notificationMarker != null && notificationMarker !== '' && !retryableMarker)
    ) {
      // Unknown marker formats fail closed just like a durable receipt.
      await clearOfflineReminderKeyIfUnchanged(jobKey, expectedJobValue);
      return;
    }

    const allowReservationRetry = markerReadFailed || retryableMarker;
    const retryAt = markerReadFailed
      ? Date.now() + OFFLINE_FULL_RETRY_MS
      : retryableMarker
        ? offlineNotificationPendingRetryAt(notificationMarker)
        : Date.now() + OFFLINE_FULL_RETRY_MS;
    const cleared = await clearOfflineReminderKeyIfUnchanged(jobKey, expectedJobValue);
    if (cleared) {
      await scheduleOfflineFullNotification(
        userId,
        subredditName,
        retryAt,
        allowReservationRetry,
      );
    }
  }
  });
}

function rescaleQuestList(
  existing: PlayerState['dailyQuests'],
  scaled: PlayerState['dailyQuests'],
  highestRarity: number,
): PlayerState['dailyQuests'] {
  const previous = new Map(existing.map(quest => [quest.id, quest]));
  return scaled.map(quest => {
    const old = previous.get(quest.id);
    const unlockedByRarity = quest.unlockRarity != null && highestRarity >= quest.unlockRarity;
    return {
      ...quest,
      progress: Math.max(0, Number.isFinite(Number(old?.progress)) ? Math.floor(Number(old?.progress)) : 0),
      claimed: old?.claimed === true,
      ...(quest.unlocked === false
        ? { unlocked: old?.unlocked === true || unlockedByRarity }
        : old?.unlocked === undefined ? {} : { unlocked: old.unlocked }),
    };
  });
}

function rescaleQuestsForHighestRarity(s: PlayerState): void {
  const highest = Math.max(2, Number(s.highestRarity) || 2);
  const coinsPerMinute = estimateQuestCoinsPerMinute(s);
  s.dailyQuests = rescaleQuestList(s.dailyQuests ?? [], createInitialDailyQuests(highest, coinsPerMinute), highest);
  s.weeklyQuests = rescaleQuestList(s.weeklyQuests ?? [], createInitialWeeklyQuests(highest, coinsPerMinute), highest);
}

export async function settleOffline(s: PlayerState, options: { skipAutoOfflineClaim?: boolean; skipOfflineNotifications?: boolean; skipAutoStreakClaim?: boolean; skipAutoQuestClaim?: boolean; skipAutoCommunityClaim?: boolean; previewOnly?: boolean } = {}): Promise<PlayerState> {
  const now = Date.now();
  checkPeriodicResets(s, now);
  rescaleQuestsForHighestRarity(s);
  resetFreeShardBudgetIfNeeded(s, now);
  // Mutations settle the active player's state; read-only paths must not call this.
  s.onlinePlayers = await touchOnlinePresence();
  s.globalBoosters = s.riftSession
    ? createInitialState().globalBoosters
    : await getGlobalBoosters();

  // First Spark explicitly disables offline progression and every automation.
  // Resetting the local vault also clears any legacy migrated backlog.
  if (s.riftSession?.challengeId === 'first-spark') {
    s.offlineRolls = 0;
    s.autoRollEnabled = false;
    s.lastSeenAt = now;
    return s;
  }

  // Old saves may outlive a lower current vault cap after prestige/upgrades change.
  // Normalize before looking at lastSeenAt, so a recent/future timestamp cannot
  // skip the cap and feed an oversized persisted batch into Auto-Claim.
  const offlineCap = offlineRollCap(s);
  const savedOfflineRolls = finiteNonNegativeInteger(s.offlineRolls ?? 0, 0);
  if (savedOfflineRolls > offlineCap) {
    console.warn('[Offline Rolls] Clamping saved vault to the current cap.', {
      savedOfflineRolls,
      offlineCap,
    });
  }
  s.offlineRolls = Math.min(offlineCap, savedOfflineRolls);

  const liveBalance = await getLiveBalanceConfig();
  const tickMs = Math.max(1_000, effectiveOfflineTickMs(s) / liveBalance['offline.generationMultiplier']);
  const diff = now - (s.lastSeenAt || now);
  if (diff >= tickMs) {
    const earned = Math.floor(diff / tickMs);
    const cap = offlineRollCap(s);
    const offlineBefore = s.offlineRolls || 0;
    const offlineAfter = Math.min(cap, offlineBefore + earned);
    s.offlineRolls = offlineAfter;
    if (!options.previewOnly) {
      await appendPlayerSpyLog('offline-accrual', {
        elapsedMs: diff,
        earnedTicks: earned,
        tickMs,
        cap,
        offlineRollsBefore: offlineBefore,
        offlineRollsAfter: offlineAfter,
        wastedTicksFromCap: Math.max(0, offlineBefore + earned - offlineAfter),
        snapshot: playerSpySnapshot(s),
      });
    }
  }

  s.lastSeenAt = now;

  // Process automation after newly earned offline rolls have been added.
  await processAutomation(s, options.previewOnly
    ? {
        ...options,
        skipAutoOfflineClaim: true,
        skipAutoStreakClaim: true,
        skipAutoQuestClaim: true,
        skipAutoCommunityClaim: true,
      }
    : options);

  const cap = offlineRollCap(s);
  const userId = String(context.userId ?? '').trim();
  const subredditName = String(context.subredditName ?? '').trim();
  if (!options.previewOnly && !options.skipOfflineNotifications && userId && subredditName && s.offlineRolls >= cap) {
    try {
      await withPlayerMutationLockFor(`offline-notification:${userId}`, async () => {
        const sent = await sendOfflineFullNotification(userId, subredditName);
        const notificationKey = OFFLINE_FULL_NOTIFICATION_PREFIX + userId;
        const notificationMarker = await readOfflineNotificationMarkerAndRepairLegacyKey(notificationKey);
        const jobKey = OFFLINE_FULL_JOB_PREFIX + userId;
        const currentJob = await redis.get(jobKey);
        const clearCurrentJob = async () => {
          if (currentJob != null) await clearOfflineReminderKeyIfUnchanged(jobKey, currentJob);
        };

        if (sent || notificationMarker === '1') {
          await clearCurrentJob();
          return;
        }

        if (notificationMarker != null && !isRetryableOfflineFullNotificationMarker(notificationMarker)) {
          // Unknown marker formats fail closed. Do not delete a job whose retry
          // could still be needed to reconcile this marker.
          return;
        }

        if (notificationMarker == null && !(await isNotificationPreferenceEnabled(userId, 'offlineOrbs'))) {
          await clearCurrentJob();
          return;
        }

        if (notificationMarker == null) {
          // The provider was not called because the shared daily notification budget is full.
          await clearCurrentJob();
          await scheduleOfflineFullNotification(userId, subredditName, nextUtcNotificationDay());
          return;
        }

        if (isRetryableOfflineFullNotificationMarker(notificationMarker)) {
          // Keep any existing job: when it runs, the worker will move it beyond
          // the active reservation lease. If no job exists, restore one now.
          if (currentJob === '') await clearOfflineReminderKeyIfUnchanged(jobKey, currentJob);
          if (!currentJob) {
            await scheduleOfflineFullNotification(
              userId,
              subredditName,
              offlineNotificationPendingRetryAt(notificationMarker),
              true,
            );
          }
          return;
        }

        // No marker but still opted in means the receipt outcome could not be
        // confirmed after the provider call. Wait out the full ambiguity lease
        // rather than immediately risking a duplicate notification.
        if (currentJob != null) await clearCurrentJob();
        await scheduleOfflineFullNotification(
          userId,
          subredditName,
          Date.now() + OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS + 60_000,
        );
      });
    } catch (error) {
      console.error('Failed to send offline-orbs-full notification:', error);
      try {
        const notificationKey = OFFLINE_FULL_NOTIFICATION_PREFIX + userId;
        const notificationMarker = await readOfflineNotificationMarkerAndRepairLegacyKey(notificationKey);
        const jobKey = OFFLINE_FULL_JOB_PREFIX + userId;
        const currentJob = await redis.get(jobKey);

        if (notificationMarker === '1') {
          if (currentJob != null) await clearOfflineReminderKeyIfUnchanged(jobKey, currentJob);
        } else if (
          !(notificationMarker != null && !isRetryableOfflineFullNotificationMarker(notificationMarker)) &&
          !(currentJob && currentJob !== '')
        ) {
          if (currentJob === '') await clearOfflineReminderKeyIfUnchanged(jobKey, currentJob);
          const markerIsRetryable = isRetryableOfflineFullNotificationMarker(notificationMarker);
          const retryAt = markerIsRetryable
            ? offlineNotificationPendingRetryAt(notificationMarker)
            : Date.now() + OFFLINE_FULL_RETRY_MS;
          await scheduleOfflineFullNotification(
            userId,
            subredditName,
            retryAt,
            markerIsRetryable,
          );
        } else {
          // Unknown markers fail closed. Existing jobs are preserved so their
          // worker can perform the same marker-aware recovery when it runs.
        }
      } catch (recoveryError) {
        console.error('[Offline Notification] Could not restore a retry after direct-send failure:', recoveryError);
      }
    }
  } else if (!options.previewOnly && !options.skipOfflineNotifications && userId && subredditName) {
    try {
      await scheduleOfflineFullNotification(
        userId,
        subredditName,
        now + Math.max(1_000, (cap - s.offlineRolls) * tickMs),
      );
    } catch (error) {
      console.error('Failed to schedule offline-orbs-full notification:', error);
    }
  }

  return s;
}

export interface CollectionPageItem {
  rarity: number;
  count: number;
  isInfinity?: boolean;
}

export async function getCollectionPage(options: {
  offset?: number;
  limit?: number;
  tier?: string;
  sort?: 'rarity_desc' | 'rarity_asc' | 'count';
} = {}): Promise<{
  items: CollectionPageItem[];
  total: number;
  offset: number;
  limit: number;
}> {
  const s = await loadRaw({ registerActivity: false });
  const offset = Math.max(0, Math.floor(Number(options.offset ?? 0)));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit ?? 60))));
  const sort = options.sort ?? 'rarity_desc';
  const tier = String(options.tier ?? 'all');

  let entries = Object.entries(s.collection ?? {})
    .map(([rarityStr, count]) => {
      const isInfinity = rarityStr === 'Infinity';
      return {
        rarity: isInfinity ? MAX_ORB_RARITY : Number(rarityStr),
        count: Number(count),
        ...(isInfinity ? { isInfinity: true } : {}),
      };
    })
    .filter(item => Number.isFinite(item.rarity) && item.count > 0);

  if (tier !== 'all') {
    entries = entries.filter(item => getOrbInfo(item.rarity, item.isInfinity).tier === tier);
  }

  entries.sort((a, b) => {
    if (sort === 'rarity_asc') return a.rarity - b.rarity || Number(a.isInfinity) - Number(b.isInfinity);
    if (sort === 'count') return b.count - a.count || b.rarity - a.rarity || Number(b.isInfinity) - Number(a.isInfinity);
    return b.rarity - a.rarity || Number(b.isInfinity) - Number(a.isInfinity);
  });

  return {
    items: entries.slice(offset, offset + limit),
    total: entries.length,
    offset,
    limit,
  };
}

export async function getState(options: { registerActivity?: boolean } = {}): Promise<PlayerState> {
  // Callers that only need a snapshot can opt out. The /api/me route and
  // pre-Play UI reads must not turn a preview into an active session.
  const s = await loadRaw({ registerActivity: options.registerActivity });
  const now = Date.now();

  // Recompute Codex projections from the authoritative collection on every read.
  // This prevents the displayed devotion chain from lagging behind newly collected rarities.
  s.codexChain = highestCodexChain(s.collection);
  s.codexDevotionLuckPercent = codexDevotionLuckPercent(
    s.masterySkills?.celestialSurge ?? 0,
    s.codexChain,
  );

  // These are presentation-only projections. They are intentionally not saved.
  // The next real mutation settles and persists the authoritative state.
  checkPeriodicResets(s, now);
  rescaleQuestsForHighestRarity(s);
  resetFreeShardBudgetIfNeeded(s, now);
  s.onlinePlayers = options.registerActivity === false
    ? await getOnlinePlayers()
    : await touchOnlinePresence();
  s.globalBoosters = await getGlobalBoosters();

  // Show currently accumulated offline rolls without consuming/persisting them.
  const liveBalance = await getLiveBalanceConfig();
  const tickMs = Math.max(1_000, effectiveOfflineTickMs(s) / liveBalance['offline.generationMultiplier']);
  const diff = now - (s.lastSeenAt || now);
  if (diff >= tickMs) {
    const earned = Math.floor(diff / tickMs);
    s.offlineRolls = Math.min(
      offlineRollCap(s),
      (s.offlineRolls || 0) + earned,
    );
  }
  s.lastSeenAt = now;

  return s;
}

/**
 * Buy one Chain Patcher charge. The target and Shard cost are recomputed from
 * the server-owned Codex while holding the same player mutation lock as rolls.
 * The pending charge is cleared only after a successful, exact one-orb roll.
 */
export async function buyChainPatcher(): Promise<{
  state: PlayerState;
  targetRarity: number;
  shardsSpent: number;
  cooldownUntil: number;
}> {
  return withPlayerMutationLock(async () => {
    const s = await settleOffline(await loadRaw());
    const now = Date.now();
    const cooldownUntil = Math.max(0, Math.floor(Number(s.chainPatcherCooldownUntil ?? 0) || 0));
    if (cooldownUntil > now) {
      const remaining = cooldownUntil - now;
      throw new Error('Chain Patcher is on cooldown for ' + Math.ceil(remaining / 3_600_000) + ' more hour(s).');
    }
    const pending = Math.floor(Number(s.chainPatcherNextRarity ?? 0) || 0);
    if (s.adminGuaranteedRollQueued === true) {
      throw new Error('A guaranteed admin roll is already queued. Use it before buying another Chain Patcher charge.');
    }
    if (pending >= 2 && pending <= MAX_ORB_RARITY) {
      throw new Error('Your Chain Patcher is already charged. Roll once to use it before buying another.');
    }

    const targetRarity = nextCodexChainRarity(s.collection);
    if (targetRarity == null) {
      throw new Error('Your Codex chain cannot be extended further.');
    }
    const shardsSpent = chainPatcherShardCost(targetRarity);
    if (!Number.isSafeInteger(shardsSpent)) {
      throw new Error('That Chain Patcher target costs more Shards than the game can safely store.');
    }
    spendShards(s, shardsSpent);
    s.chainPatcherNextRarity = targetRarity;
    s.chainPatcherCooldownUntil = now + CHAIN_PATCHER_COOLDOWN_MS;
    // Make the guaranteed single manual roll deliberate rather than letting an
    // already-running auto loop consume the charge before the player sees it.
    s.autoRollEnabled = false;
    await save(s);
    return { state: s, targetRarity, shardsSpent, cooldownUntil: s.chainPatcherCooldownUntil };
  });
}

export async function getMe(): Promise<PlayerState> {
  const ban = await getGameBanStatus();
  const s = ban
    ? await loadRaw({ registerActivity: false })
    : await getState({ registerActivity: false });
  if (ban) {
    s.gameBan = {
      active: true,
      bannedAt: ban.bannedAt,
      bannedUntil: ban.bannedUntil,
      reason: ban.reason,
    };
  } else {
    delete s.gameBan;
  }
  // Refresh the Reddit flair on game entry so existing members receive the
  // guild label even before their next roll/save.
  if (!s.riftSession) void syncRarityFlair(s);
  return s;
}

export async function checkOffline(): Promise<PlayerState> {
  const s = await loadRaw();
  return settleOffline(s);
}

/** Acknowledge the persisted Frenzy owner reward notice without changing its already-committed Shard reward. */
export async function acknowledgeFrenzyShardPopup(): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
    const state = await loadRaw({ source: 'main' });
    if (!state.frenzyShardPopupPending) return state;
    delete state.frenzyShardPopupPending;
    await save(state);
    return state;
  });
}

export async function setAutoRollEnabled(enabled: boolean): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  if (enabled && s.riftSession?.challengeId === 'first-spark' &&
      (s.riftSession.automationOverrideLevel ?? 0) <= 0) {
    throw new Error('Auto Roll is disabled in The First Spark until Automation Override is unlocked.');
  }
  if ((s.upgrades.auto ?? 0) <= 0) {
    s.autoRollEnabled = false;
    await save(s);
    throw new Error('Auto Roll is not unlocked yet.');
  }

  if (enabled) {
    if (s.adminGuaranteedRollQueued === true) {
      throw new Error('Use the queued guaranteed manual roll before re-enabling Auto Roll.');
    }
    const pendingPatcherRarity = Number(s.chainPatcherNextRarity ?? 0);
    if (pendingPatcherRarity !== 0) {
      throw new Error(Number.isSafeInteger(pendingPatcherRarity) &&
        pendingPatcherRarity >= 2 && pendingPatcherRarity <= MAX_ORB_RARITY
        ? 'Use the charged Chain Patcher with one manual roll before re-enabling Auto Roll.'
        : 'Chain Patcher save data is invalid; repair it before enabling Auto Roll.');
    }
  }

  s.autoRollEnabled = Boolean(enabled);
  await save(s);
  return s;

  });}

export async function roll(
  isAuto = false,
  ticketId?: string,
  ticketIndex?: number,
  useAllFreeRolls = false,
  useTimeEnergy = false,
  ticketSeed?: string,
  progressAttemptId?: string,
): Promise<RollResponse> {
  const safeProgressAttemptId = typeof progressAttemptId === 'string' &&
    progressAttemptId.length > 0 && progressAttemptId.length <= 128
    ? progressAttemptId
    : null;
  return withPlayerMutationLock(async () => {
    let ticketUse:
      | { ticket: RollTicket; raw: string; index: number; nextValue: string }
      | undefined;

    const loadedState = await loadRaw();
    if (ticketId != null || ticketIndex != null) {
      const requestedTicketIndex = Number(ticketIndex);
      if (!ticketId || !Number.isSafeInteger(requestedTicketIndex)) {
        throw new Error('Invalid roll prediction ticket.');
      }
      const loaded = await loadRollTicketForUse(ticketId, requestedTicketIndex, ticketSeed, loadedState.riftSession?.runId);
      const nextTicket: RollTicket = {
        ...loaded.ticket,
        nextIndex: loaded.ticket.nextIndex + 1,
      };
      ticketUse = {
        ticket: loaded.ticket,
        raw: loaded.raw,
        index: requestedTicketIndex,
        nextValue: JSON.stringify(nextTicket),
      };
    }

    const ticketRandom = ticketUse
      ? createRollRandomSource(ticketUse.ticket.seeds[ticketUse.index])
      : null;
    const performRoll = async () => {
      const s = await settleOffline(loadedState);
    if (isAuto && s.riftSession?.challengeId === 'first-spark' &&
        (s.riftSession.automationOverrideLevel ?? 0) <= 0) {
      throw new Error('Auto Roll is disabled in The First Spark until Automation Override is unlocked.');
    }
    if (isAuto && (s.upgrades.auto ?? 0) <= 0) {
      throw new Error('Auto Roll is not unlocked yet.');
    }
    // Reject already-queued auto ticks after a purchase or player opt-out turns
    // Auto Roll off. In particular, this keeps an in-flight tick from consuming
    // a newly purchased Chain Patcher before the player can trigger it manually.
    if (isAuto && s.autoRollEnabled !== true) {
      throw new Error('Auto Roll is disabled.');
    }

    const now = Date.now();
    const rawPatcherRarity = Number(s.chainPatcherNextRarity ?? 0);
    if (
      !Number.isSafeInteger(rawPatcherRarity) ||
      rawPatcherRarity < 0 ||
      rawPatcherRarity > MAX_ORB_RARITY ||
      (rawPatcherRarity > 0 && rawPatcherRarity < 2)
    ) {
      throw new Error('Chain Patcher save data is invalid; no roll was processed.');
    }
    const usingChainPatcher = rawPatcherRarity >= 2;
    if (s.adminGuaranteedRollQueued === true && !usingChainPatcher) {
      throw new Error('Guaranteed admin roll state is missing its exact rarity target; no roll was processed.');
    }
    if (isAuto && usingChainPatcher) {
      throw new Error('Chain Patcher charge must be used by a manual roll. Auto Roll remains paused.');
    }
    const availableFreeRolls = Math.max(0, Math.floor(Number(s.freeRolls ?? 0) || 0));
    // A charged Chain Patcher must resolve as one deliberate, exact orb. It
    // does not consume or batch any accumulated Free Rolls.
    const liveBalance = await getLiveBalanceConfig();
    const cd = cooldownMs(s, isAuto, liveBalance);
    const reclaimedPerActivation = cooldownReclaimerEnergyPerActivationMs(s, isAuto, liveBalance);
    if (useTimeEnergy && (isAuto || usingChainPatcher)) {
      throw new Error('Time Energy can only power a manual, non-patched activation.');
    }
    if (useTimeEnergy && (s.masterySkills?.cooldownReclaimer ?? 0) <= 0) {
      throw new Error('Cooldown Reclaimer Mastery is required.');
    }
    const timeEnergyActivations = timeEnergyActivationsAvailable(s.timeEnergy ?? 0, cd);
    if (useTimeEnergy && timeEnergyActivations < 1) {
      throw new Error(`You need at least ${cd.toLocaleString()}ms of Time Energy for one instant roll. You currently have ${Math.max(0, s.timeEnergy ?? 0).toLocaleString()}ms.`);
    }
    const usingTimeEnergy = useTimeEnergy === true;
    const usingFreeRoll = !usingTimeEnergy && !usingChainPatcher && !isAuto && availableFreeRolls > 0;
    if (!usingFreeRoll && !usingTimeEnergy && s.lastRollAt !== null && now - s.lastRollAt < cd) {
      throw new Error(`Cooldown: ${((cd - now + s.lastRollAt) / 1000).toFixed(1)}s`);
    }

    // Time Energy buys as many complete activations as the current cooldown can fund.
    // Any partial remainder stays banked.
    const freeRollActivations = usingTimeEnergy
      ? timeEnergyActivations
      : usingFreeRoll
      ? (useAllFreeRolls ? availableFreeRolls : 1)
      : 1;
    if (usingFreeRoll && freeRollActivations > 5_000) {
      throw new Error('You have too many stored Free Rolls for one batch (maximum 5,000). No rolls were spent.');
    }
    if (usingTimeEnergy) s.timeEnergy = Math.max(0, (s.timeEnergy ?? 0) - (cd * freeRollActivations));
    if (usingFreeRoll) s.freeRolls = availableFreeRolls - freeRollActivations;
    const activations = usingChainPatcher ? 1 : freeRollActivations;

    // Bound each allocation/iteration by actual orb count, not just button
    // activations. All chunks mutate the same in-memory state and are committed
    // together, so a failure cannot spend Free Rolls without saving their rolls.
    let bestOrb: Orb | null = null;
    const batch: Orb[] = [];
    let totalVal = 0;
    let coinsGained = 0;
    let shardsGained = 0;
    let xpGained = 0;
    let rollCount = 0;
    let remainingActivations = activations;
    const ballsPerActivation = Math.max(1, rollsPerActivation(s));
    const timeEnergyProgressUserId = usingTimeEnergy && safeProgressAttemptId && !s.riftSession ? currentUserId() : '';
    const timeEnergyProgressTotal = freeRollActivations * ballsPerActivation;
    let lastTimeEnergyProgressWriteAt = 0;
    if (timeEnergyProgressUserId && safeProgressAttemptId) {
      await writeTimeEnergyRollProgress(timeEnergyProgressUserId, safeProgressAttemptId, timeEnergyProgressTotal, 0, false);
    }
    // Reserve two slots for Astral Magnetism's possible bonus Orbs.
    const maxActivationsPerChunk = Math.max(
      1,
      Math.floor((MAX_EFFECTIVE_ROLLS_PER_BATCH - 2) / ballsPerActivation),
    );
    while (remainingActivations > 0) {
      const chunkActivations = Math.min(remainingActivations, maxActivationsPerChunk);
      const progressOffset = rollCount;
      const onTimeEnergyProgress = timeEnergyProgressUserId && safeProgressAttemptId
        ? async (chunkProcessed: number) => {
            const absoluteProcessed = Math.min(
              timeEnergyProgressTotal,
              progressOffset + Math.max(0, Math.floor(Number(chunkProcessed) || 0)),
            );
            const nowForProgress = Date.now();
            if (absoluteProcessed >= timeEnergyProgressTotal || nowForProgress - lastTimeEnergyProgressWriteAt >= 250) {
              lastTimeEnergyProgressWriteAt = nowForProgress;
              await writeTimeEnergyRollProgress(
                timeEnergyProgressUserId,
                safeProgressAttemptId,
                timeEnergyProgressTotal,
                absoluteProcessed,
                false,
              );
            }
          }
        : undefined;
      const result = await applyRolls(
        s,
        chunkActivations,
        usingChainPatcher ? rawPatcherRarity : undefined,
        'online',
        usingChainPatcher ? 1 : undefined,
        ticketRandom ? ticketRandom.next : undefined,
        usingChainPatcher,
        onTimeEnergyProgress,
        ticketRandom ? ticketRandom.nextRarity : undefined,
      );
      if (!bestOrb || result.bestOrb.rarity > bestOrb.rarity) bestOrb = result.bestOrb;
      batch.push(...result.batch.slice(-200));
      if (batch.length > 200) batch.splice(0, batch.length - 200);
      totalVal = addCollectionValue(totalVal, result.totalVal);
      coinsGained = addCoinAmount(coinsGained, result.coinsGained);
      shardsGained = Math.min(Number.MAX_SAFE_INTEGER, shardsGained + result.shardsGained);
      xpGained = Math.min(Number.MAX_SAFE_INTEGER, xpGained + result.xpGained);
      rollCount = Math.min(Number.MAX_SAFE_INTEGER, rollCount + result.rollCount);
      if (timeEnergyProgressUserId && safeProgressAttemptId) {
        await writeTimeEnergyRollProgress(
          timeEnergyProgressUserId,
          safeProgressAttemptId,
          timeEnergyProgressTotal,
          Math.min(timeEnergyProgressTotal, rollCount),
          false,
        );
      }
      remainingActivations -= chunkActivations;
    }
    if (!bestOrb) throw new Error('No rolls were processed.');

    if (usingChainPatcher) {
      s.chainPatcherNextRarity = 0;
      s.adminGuaranteedRollQueued = false;
    }

    if (!isAuto) {
      s.manualRolls = Math.min(10, (s.manualRolls ?? 0) + freeRollActivations);
      if (s.manualRolls >= 3) s.upgrades.auto = 1;
    }

    s.lastRollAt = now;
    s.lastSeenAt = now;
    if (!usingTimeEnergy && !usingFreeRoll && !usingChainPatcher) {
      const reclaimed = reclaimedPerActivation * activations;
      s.timeEnergy = Math.min(TIME_ENERGY_MAX_MS, Math.max(0, (s.timeEnergy ?? 0) + reclaimed));
    }

    await save(
      s,
      ticketUse
        ? {
            key: rollTicketKey(currentUserId(), s.riftSession?.runId),
            expectedValue: ticketUse.raw,
            nextValue: ticketUse.nextValue,
          }
        : undefined,
    );
    if (timeEnergyProgressUserId && safeProgressAttemptId) {
      // Mark complete only after the player save (and roll-ticket update) commits.
      await writeTimeEnergyRollProgress(
        timeEnergyProgressUserId,
        safeProgressAttemptId,
        timeEnergyProgressTotal,
        timeEnergyProgressTotal,
        true,
      );
    }

    if (!s.riftSession) {
      void recordLeaderboard(s).catch(error => {
        console.error('[Leaderboard] Background update failed:', error);
      });
    }
    void appendPlayerSpyLog('roll-activation', {
      mode: isAuto ? 'auto' : 'manual',
      processedRolls: rollCount,
      bestRarity: bestOrb.rarity,
      coinsGained,
      shardsGained,
      xpGained,
    }).catch(error => {
      console.error('[Player Spy] Background activation log failed:', error);
    });

    return {
      orb: bestOrb,
      batch,
      totalValueGained: totalVal,
      totalRollValue: totalVal,
      coinsGained,
      shardsGained,
      xpGained,
      state: s,
      rollsRemainingUntilNext: cd,
      rollsProcessed: rollCount,
      dramaticReveal: bestOrb.rarity >= 100,
    };
      };
      return playerGuildScopes.get(loadedState)
        ? withGuildDataMutationLock(performRoll)
        : performRoll();
  });
}
export async function subscribeToSubredditForReward(): Promise<{
  subredditName: string;
  recordedAction: boolean;
  totalSubscribers: number | null;
}> {
  return withPlayerMutationLock(async () => {
    const userId = currentUserId();
    const actionKey = FOLLOW_SUBSCRIBED_KEY_PREFIX + userId;
    const alreadyRecorded = Boolean(await redis.get(actionKey));

    await reddit.subscribeToCurrentSubreddit();

    let recordedAction = false;
    if (!alreadyRecorded) {
      await redis.set(actionKey, String(Date.now()));
      await redis.incrBy(FOLLOW_ACTION_COUNT_KEY, 1);
      recordedAction = true;
    }

    let totalSubscribers: number | null = null;
    try {
      const info = await reddit.getSubredditInfoByName(FOLLOW_TARGET_SUBREDDIT);
      const count = Number(info?.subscribersCount);
      totalSubscribers = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;
    } catch (error) {
      console.error('[Follow Reward] Could not read subreddit subscriber count:', error);
    }

    return {
      subredditName: String(context.subredditName ?? FOLLOW_TARGET_SUBREDDIT),
      recordedAction,
      totalSubscribers,
    };
  });
}

export async function getFollowRewardStats(): Promise<{
  followActions: number;
  totalSubscribers: number | null;
  subredditName: string;
}> {
  const rawCount = await redis.get(FOLLOW_ACTION_COUNT_KEY);
  const followActions = Math.max(0, Number.parseInt(String(rawCount ?? '0'), 10) || 0);
  let totalSubscribers: number | null = null;
  try {
    const info = await reddit.getSubredditInfoByName(FOLLOW_TARGET_SUBREDDIT);
    const count = Number(info?.subscribersCount);
    totalSubscribers = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;
  } catch (error) {
    console.error('[Follow Reward] Could not read subreddit subscriber count:', error);
  }
  return {
    followActions,
    totalSubscribers,
    subredditName: FOLLOW_TARGET_SUBREDDIT,
  };
}

export async function subscribeToSubredditFromPrompt(): Promise<{
  subredditName: string;
  recordedAction: boolean;
}> {
  return withPlayerMutationLock(async () => {
    const userId = currentUserId();
    await reddit.subscribeToCurrentSubreddit();

    const userKey = FOLLOW_SUBSCRIBED_KEY_PREFIX + userId;
    const alreadyRecorded = Boolean(await redis.get(userKey));
    if (!alreadyRecorded) {
      await redis.set(userKey, String(Date.now()));
      await redis.incrBy(FOLLOW_ACTION_COUNT_KEY, 1);
    }

    return {
      subredditName: String(context.subredditName ?? ''),
      recordedAction: !alreadyRecorded,
    };
  });
}

export async function getFollowPromptStats(): Promise<{
  recordedFollowActions: number;
  totalSubscribers: number | null;
  targetSubreddit: string;
}> {
  const rawCount = await redis.get(FOLLOW_ACTION_COUNT_KEY);
  const recordedFollowActions = Math.max(
    0,
    Number.parseInt(String(rawCount ?? '0'), 10) || 0,
  );

  let totalSubscribers: number | null = null;
  try {
    const info = await reddit.getSubredditInfoByName(FOLLOW_TARGET_SUBREDDIT);
    const count = Number(info?.subscribersCount);
    totalSubscribers = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;
  } catch (error) {
    console.error('[Follow Prompt] Could not read subreddit subscriber count:', error);
  }

  return {
    recordedFollowActions,
    totalSubscribers,
    targetSubreddit: FOLLOW_TARGET_SUBREDDIT,
  };
}

export async function getFollowRewardStatus(): Promise<{ claimed: boolean; subredditName: string }> {
  const userId = currentUserId();
  const claimed = Boolean(userId && await redis.get(FOLLOW_REWARD_KEY_PREFIX + userId));
  return { claimed, subredditName: String(context.subredditName ?? FOLLOW_TARGET_SUBREDDIT).replace(/^r\//i, '') };
}

export async function claimFollowReward(): Promise<{
  state: PlayerState;
  rollsGranted: number;
  freeRollsAdded: number;
  totalFreeRolls: number;
  bestRarity: number;
  coinsGained: number;
  shardsGained: number;
  xpGained: number;
}> {
  return withPlayerMutationLock(async () => {
    const userId = currentUserId();
    const subscribedKey = FOLLOW_SUBSCRIBED_KEY_PREFIX + userId;
    const rewardKey = FOLLOW_REWARD_KEY_PREFIX + userId;
    if (await redis.get(rewardKey)) throw new Error('FOLLOW_REWARD_ALREADY_CLAIMED');

    const s = await settleOffline(await loadRaw());
    if (s.riftSession) throw new Error('Follow rewards are tied to your main account and cannot be claimed inside a Rift run.');
    const effectiveLevel = Math.max(1, Math.floor(Number(s.level) || 1), calculateLevelFromXp(Number(s.xp) || 0).level);
    if (effectiveLevel < 5) throw new Error('FOLLOW_REWARD_LEVEL_REQUIRED');

    // An explicit Join button click subscribes the player to the current subreddit.
    await reddit.subscribeToCurrentSubreddit();

    let actionCountRecorded = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const txn = await redis.watch(subscribedKey, FOLLOW_ACTION_COUNT_KEY);
      const existingMarker = await redis.get(subscribedKey);
      if (existingMarker) {
        await txn.unwatch();
        actionCountRecorded = true;
        break;
      }
      const rawCount = await redis.get(FOLLOW_ACTION_COUNT_KEY);
      const currentCount = rawCount == null ? 0 : Number(rawCount);
      if (!Number.isSafeInteger(currentCount) || currentCount < 0 || currentCount >= Number.MAX_SAFE_INTEGER) {
        await txn.unwatch();
        throw new Error('Follow-action counter is corrupted or exhausted; the count was not changed.');
      }
      await txn.multi();
      await txn.set(subscribedKey, String(Date.now()));
      await txn.set(FOLLOW_ACTION_COUNT_KEY, String(currentCount + 1));
      if (await txn.exec() !== null) { actionCountRecorded = true; break; }
    }
    if (!actionCountRecorded) throw new Error('Follow-action count changed repeatedly. Please retry.');

    const existingFreeRolls = Math.max(0, Math.floor(Number(s.freeRolls) || 0));
    if (!Number.isSafeInteger(existingFreeRolls) || existingFreeRolls > Number.MAX_SAFE_INTEGER - FOLLOW_REWARD_ROLLS) {
      throw new Error('Saved Free Roll balance cannot safely accept the reward.');
    }
    s.freeRolls = existingFreeRolls + FOLLOW_REWARD_ROLLS;
    s.lastSeenAt = Date.now();

    const rewardMarker = secureServerToken('follow-reward');
    await save(s, {
      key: rewardKey,
      expectedValue: null,
      nextValue: rewardMarker,
      conflictMessage: 'FOLLOW_REWARD_ALREADY_CLAIMED',
    });
    if (await redis.get(rewardKey) !== rewardMarker) throw new Error('FOLLOW_REWARD_SAVE_INVALIDATED');

    void recordLeaderboard(s).catch(error => console.error('[Follow Reward] Leaderboard projection failed after reward commit:', error));
    void appendPlayerSpyLog('follow-reward-claim', {
      rollsGranted: FOLLOW_REWARD_ROLLS,
      totalFreeRolls: s.freeRolls,
      subredditName: String(context.subredditName ?? FOLLOW_TARGET_SUBREDDIT),
    }).catch(error => console.error('[Follow Reward] Spy log failed:', error));

    return {
      state: s,
      rollsGranted: FOLLOW_REWARD_ROLLS,
      freeRollsAdded: FOLLOW_REWARD_ROLLS,
      totalFreeRolls: s.freeRolls,
      bestRarity: s.highestRarity ?? 0,
      coinsGained: 0,
      shardsGained: 0,
      xpGained: 0,
    };
  });
}

export async function claimOffline(): Promise<RollResponse> {
  return withPlayerMutationLock(async () => {
  const notificationLock = `offline-notification:${currentUserId()}`;
  // Serialize the manual claim against scheduled/request-triggered notification
  // workers. Otherwise a worker can enqueue a stale "rolls are full" alert
  // after this claim has saved and cleared the reminder.
  return withPlayerMutationLockFor(notificationLock, async () => {
  // The manual button owns this claim path. Do not let Auto Offline Claim
  // consume the rolls before this handler can build and save the response, and
  // don't send or schedule a full-roll notification for rolls being claimed now.
  const s = await settleOffline(await loadRaw(), {
    skipAutoOfflineClaim: true,
    skipOfflineNotifications: true,
  });
  if (s.riftSession?.challengeId === 'first-spark') {
    throw new Error('Offline rolls are disabled in The First Spark.');
  }
  if (!Number.isSafeInteger(s.offlineRolls) || s.offlineRolls < 0) {
    throw new Error('Saved offline roll count is invalid; no rolls were claimed.');
  }
  const offlineCap = offlineRollCap(s);
  const batches = Math.min(offlineCap, s.offlineRolls);
  if (batches <= 0) throw new Error('No offline rolls waiting.');
  const liveBalance = await getLiveBalanceConfig();
  const reclaimedPerActivation = cooldownReclaimerEnergyPerActivationMs(s, false, liveBalance);
  s.offlineRolls = 0;
  const { bestOrb, batch, totalVal, coinsGained, shardsGained, xpGained, rollCount } = await applyRolls(s, batches, undefined, 'offline');
  grantCooldownReclaimerTimeEnergy(s, batches, reclaimedPerActivation);
  const now = Date.now();
  s.lastRollAt = now;
  s.lastSeenAt = now;
  const notificationKey = OFFLINE_FULL_NOTIFICATION_PREFIX + currentUserId();
  const jobKey = OFFLINE_FULL_JOB_PREFIX + currentUserId();
  const [previousNotification, previousJob] = await Promise.all([
    redis.get(notificationKey),
    redis.get(jobKey),
  ]);
  await save(s);
  // Clear only the reminder state observed before this claim. A newer reminder
  // installed by a post-commit automation action must not be deleted.
  await Promise.all([
    clearOfflineReminderKeyIfUnchanged(notificationKey, previousNotification),
    clearOfflineReminderKeyIfUnchanged(jobKey, previousJob),
  ]).catch(error => {
    console.error('[Offline Claim] Reminder cleanup failed after save:', error);
  });
  if (!s.riftSession) {
    await recordLeaderboard(s).catch(error => {
      console.error('[Leaderboard] Offline-claim projection failed after save:', error);
    });
  }

  return {
    orb: bestOrb,
    batch,
    totalValueGained: totalVal,
    totalRollValue: totalVal,
    coinsGained,
    shardsGained,
    xpGained,
    state: s,
    rollsRemainingUntilNext: cooldownMs(s, false, liveBalance),
    rollsProcessed: rollCount,
    dramaticReveal: bestOrb.rarity >= 100,
  };

  });
  });
}

export async function buyUpgrade(id: UpgradeId): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const level = s.upgrades[id] ?? 0;
  const requiredPlayerLevel = upgradeUnlockLevel(id);
  if (s.level < requiredPlayerLevel) {
    throw new Error(`Unlocks at Level ${requiredPlayerLevel}.`);
  }

  // Auto Roll is free and unlocks once the player has at least 3 manual rolls.
  if (id === 'auto') {
    if ((s.manualRolls ?? 0) < 3) {
      throw new Error(`Auto Roll unlocks after 3 manual rolls (${s.manualRolls ?? 0}/3).`);
    }
    s.upgrades.auto = 1;
    await save(s);
    return s;
  }

  const cost = upgradeCost(id, level);
  if (!Number.isFinite(cost)) {
    throw new Error(`${id === 'speed' ? 'Roll Speed' : 'This upgrade'} is already at its maximum level.`);
  }
  if (s.coins < cost) {
    throw new Error(`Need ${cost.toLocaleString()} Coins.`);
  }
  s.coins -= cost;
  s.upgrades[id] = (s.upgrades[id] ?? 0) + 1;
  await save(s);
  await appendPlayerSpyLog('upgrade-purchase', {
    upgrade: id,
    levelBefore: level,
    levelAfter: s.upgrades[id],
    cost,
    snapshot: playerSpySnapshot(s),
  });
  return s;
  });
}

export async function buyUpgradeBatch(ids: UpgradeId[]): Promise<{
  state: PlayerState;
  purchased: Array<{ id: UpgradeId; cost: number; level: number }>;
  totalSpent: number;
  stoppedReason?: string;
}> {
  return withPlayerMutationLock(async () => {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) {
      throw new Error('Upgrade batch must contain 1 to 100 purchases.');
    }
    const validIds: UpgradeId[] = [
      'speed', 'multi', 'clusterRoll', 'auto', 'luck', 'coinBonus',
      'shardChance', 'xpBonus', 'critChance', 'critPower', 'offlineRate', 'valueBonus',
      'offlineFoundry', 'orbFingers', 'criticalDividend',
    ];
    if (!ids.every(id => validIds.includes(id))) throw new Error('Upgrade batch contains an unknown upgrade.');

    const s = await settleOffline(await loadRaw());
    const purchased: Array<{ id: UpgradeId; cost: number; level: number }> = [];
    let totalSpent = 0;
    let stoppedReason: string | undefined;

    for (const id of ids) {
      const level = s.upgrades[id] ?? 0;
      const requiredPlayerLevel = upgradeUnlockLevel(id);
      if (s.level < requiredPlayerLevel) {
        stoppedReason = `${id} unlocks at Level ${requiredPlayerLevel}.`;
        break;
      }
      if (id === 'auto') {
        if ((s.manualRolls ?? 0) < 3) {
          stoppedReason = `Auto Roll unlocks after 3 manual rolls (${s.manualRolls ?? 0}/3).`;
          break;
        }
        if (level > 0) {
          stoppedReason = 'Auto Roll is already unlocked.';
          break;
        }
        s.upgrades.auto = 1;
        purchased.push({ id, cost: 0, level: 1 });
        continue;
      }

      const cost = upgradeCost(id, level);
      if (!Number.isFinite(cost)) {
        stoppedReason = `${id === 'speed' ? 'Roll Speed' : id === 'offlineRate' ? 'Offline Generation Speed' : 'This upgrade'} is already at its maximum level.`;
        break;
      }
      if (s.coins < cost) {
        stoppedReason = `Need ${cost.toLocaleString()} Coins for ${id}.`;
        break;
      }

      s.coins -= cost;
      s.upgrades[id] = level + 1;
      totalSpent += cost;
      purchased.push({ id, cost, level: level + 1 });
    }

    if (purchased.length > 0) {
      await save(s);
      for (const entry of purchased) {
        void appendPlayerSpyLog('upgrade-purchase', {
          upgrade: entry.id,
          levelAfter: entry.level,
          cost: entry.cost,
          batchSize: purchased.length,
          snapshot: playerSpySnapshot(s),
        }).catch(error => console.error('[Player Spy] Upgrade batch log failed:', error));
      }
    }

    return { state: s, purchased, totalSpent, ...(stoppedReason ? { stoppedReason } : {}) };
  });
}

export function autoBuyCheapest(s: PlayerState, reserveCoins = 0): boolean {
  const reserve = Math.max(0, Math.floor(Number.isFinite(reserveCoins) ? reserveCoins : 0));
  const spendableCoins = Math.max(0, s.coins - reserve);
  const upgradeIds: UpgradeId[] = [
    'speed', 'multi', 'luck', 'coinBonus', 'auto',
    'xpBonus', 'shardChance', 'critChance', 'valueBonus', 'critPower', 'offlineRate',
    'offlineFoundry', 'orbFingers', 'criticalDividend', 'clusterRoll'
  ];
  let bestId: UpgradeId | null = null;
  let lowestCost = Infinity;

  for (const id of upgradeIds) {
    if (id === 'auto' || s.level < upgradeUnlockLevel(id)) continue;
    const lvl = s.upgrades[id] ?? 0;
    const cost = upgradeCost(id, lvl);
    if (cost <= spendableCoins && cost < lowestCost) {
      lowestCost = cost;
      bestId = id;
    }
  }

  if (bestId && Number.isFinite(lowestCost) && s.coins - lowestCost >= reserve) {
    s.coins -= lowestCost;
    s.upgrades[bestId] = (s.upgrades[bestId] ?? 0) + 1;
    return true;
  }
  return false;
}

export async function buyAllUpgrades(): Promise<{ state: PlayerState; totalSpent: number; upgradedCount: number }> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const upgradeIds: UpgradeId[] = [
    'speed', 'multi', 'luck', 'coinBonus', 'auto',
    'xpBonus', 'shardChance', 'critChance', 'valueBonus', 'critPower', 'offlineRate',
    'offlineFoundry', 'orbFingers', 'criticalDividend', 'clusterRoll'
  ];

  let totalSpent = 0;
  let upgradedCount = 0;
  const MAX_PURCHASES_PER_REQUEST = 5_000;

  // Sweep one level across every affordable upgrade, then repeat until no upgrade
  // can be bought. This makes the button genuinely "Upgrade All" rather than
  // "buy the cheapest thing until the wallet is empty."
  let changed = true;
  while (changed && upgradedCount < MAX_PURCHASES_PER_REQUEST) {
    changed = false;

    for (const id of upgradeIds) {
      if (upgradedCount >= MAX_PURCHASES_PER_REQUEST) break;

      const level = s.upgrades[id] ?? 0;
      if (s.level < upgradeUnlockLevel(id)) continue;
      const cost = upgradeCost(id, level);

      if (id === 'auto') continue;

      if (!Number.isFinite(cost) || cost > s.coins) continue;

      s.coins -= cost;
      s.upgrades[id] = level + 1;
      totalSpent += cost;
      upgradedCount++;
      changed = true;
    }
  }

  if (upgradedCount > 0) {
    await save(s);
  }

  return { state: s, totalSpent, upgradedCount };
  });
}

export async function claimDailyStreak(): Promise<{ state: PlayerState; rewardCoins: number; rewardShards: number; rewardFreeRolls: number; day: number; community: import('../shared/game.js').DailyStreakCommunityEvent }> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw(), { skipAutoStreakClaim: true });
  const result = await claimDailyStreakFromState(s);
  await save(s);
  await appendPlayerSpyLog('daily-streak-claim', {
    day: result.day,
    rewardCoins: result.rewardCoins,
    rewardShards: result.rewardShards,
    snapshot: playerSpySnapshot(s),
  });
  return { state: s, ...result };

  });}

export async function claimQuest(type: 'daily' | 'weekly', id: string): Promise<{ state: PlayerState; rewardCoins: number; rewardShards: number; rewardTokens: number }> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw(), { skipAutoQuestClaim: true });
  const list = type === 'daily' ? s.dailyQuests : s.weeklyQuests;
  const quest = list.find(q => q.id === id);
  if (!quest) throw new Error('Quest not found.');
  if (quest.unlocked === false) throw new Error('Quest is not unlocked yet.');
  if (quest.claimed) throw new Error('Quest already claimed.');
  if (quest.progress < quest.target) throw new Error('Quest requirement not met.');

  const reward = applyQuestReward(s, quest);

  await save(s);
  await appendPlayerSpyLog('quest-claim', {
    type,
    questId: id,
    rewardCoins: reward.rewardCoins,
    rewardShards: reward.rewardShards,
    rewardTokens: reward.rewardTokens,
    snapshot: playerSpySnapshot(s),
  });
  return {
    state: s,
    rewardCoins: reward.rewardCoins,
    rewardShards: reward.rewardShards,
    rewardTokens: reward.rewardTokens,
  };

  });}

export async function prestige(): Promise<{ state: PlayerState; cosmicDustEarned: number; dustGained: number }> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const dustEarned = calculateCosmicDust(s);
  if (dustEarned <= 0 || (s.collectionValue ?? 0) < 1_000_000) {
    throw new Error('Requires at least 1,000,000 Collection Value in current run.');
  }

  s.cosmicDust = (s.cosmicDust ?? 0) + dustEarned;
  s.prestigeCount = (s.prestigeCount ?? 0) + 1;
  s.masteryPoints = (s.masteryPoints ?? 0) + 3;

  // Cosmic Inheritance only controls coin retention. Shards always survive prestige.
  const inheritanceLevel = s.prestigeUpgrades?.cosmicInheritance ?? 0;
  const keepPct = Math.min(0.50, inheritanceLevel * 0.10);
  const keptCoins = Math.max(50, Math.floor(s.coins * keepPct));
  const keptShards = Math.max(0, Math.floor(Number(s.shards ?? 0) || 0));

  // Reset current-run collection value, coins, and base upgrades while preserving Shards.
  s.collectionValue = 0;
  s.coins = keptCoins;
  s.shards = keptShards;
  s.upgrades = createInitialState().upgrades;
  s.offlineRolls = 0;
  s.rollsSinceBest = 0;
  s.currentRunRolls = 0;
  s.lastRollAt = null;

  if (!s.claimedAchievements.includes('first-prestige')) {
    s.claimedAchievements.push('first-prestige');
  }

  await save(s);
  await appendPlayerSpyLog('prestige', {
    cosmicDustEarned: dustEarned,
    prestigeCount: s.prestigeCount,
    snapshot: playerSpySnapshot(s),
  });
  return { state: s, cosmicDustEarned: dustEarned, dustGained: dustEarned };

  });}

export async function buyPrestigeUpgrade(id: PrestigeUpgradeId): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const info = PRESTIGE_UPGRADES[id];
  if (!info) throw new Error('Unknown prestige upgrade.');
  if (!s.prestigeUpgrades) {
    s.prestigeUpgrades = createInitialState().prestigeUpgrades;
  }
  const current = s.prestigeUpgrades[id] ?? 0;
  if (
    typeof current !== 'number' ||
    !Number.isSafeInteger(current) ||
    current < 0 ||
    current > info.maxLevel
  ) {
    throw new Error('Saved prestige upgrade level is invalid; no purchase was made.');
  }
  if (current >= info.maxLevel) {
    throw new Error(`Upgrade ${info.name} is already at max level (${info.maxLevel}).`);
  }

  const cosmicDust = s.cosmicDust;
  if (
    typeof cosmicDust !== 'number' ||
    !Number.isSafeInteger(cosmicDust) ||
    cosmicDust < 0
  ) {
    throw new Error('Saved Cosmic Dust balance is invalid; no purchase was made.');
  }

  const cost = prestigeUpgradeCost(id, current);
  if (!Number.isSafeInteger(cost) || cost < 0) {
    throw new Error('Prestige upgrade cost is invalid; no purchase was made.');
  }
  if (cosmicDust < cost) {
    throw new Error(`Need ${cost} Cosmic Dust.`);
  }

  s.cosmicDust = cosmicDust - cost;
  s.prestigeUpgrades[id] = current + 1;
  await save(s);
  await appendPlayerSpyLog('prestige-upgrade-purchase', {
    upgrade: id,
    levelBefore: current,
    levelAfter: s.prestigeUpgrades[id],
    cost,
    snapshot: playerSpySnapshot(s),
  });
  return s;

  });}

export async function updateCombatAutoScrapSettings(enabledValue: unknown, maxQualityValue: unknown): Promise<PlayerState['combatAutoScrap']> {
  return withPlayerMutationLock(async () => {
    const s = await settleOffline(await loadRaw());
    if ((s.prestigeUpgrades?.autoScrap ?? 0) < 1) throw new Error('Auto Scrap Prestige upgrade is required.');
    const numericQuality = Number(maxQualityValue);
    if (!Number.isFinite(numericQuality) || numericQuality < 0 || numericQuality > 100) throw new Error('Auto Scrap quality threshold must be between 0 and 100.');
    const settings = { enabled: enabledValue === true, maxQuality: Math.round(numericQuality * 100) / 100 };
    s.combatAutoScrap = settings;
    await save(s);
    return settings;
  });
}

export async function sacrificeToAltar(coins: number, shards: number): Promise<{
  state: PlayerState;
  altarLeveledUp: boolean;
  luckSurgeExtended: boolean;
  altarBreakthroughChance: number;
  altarPity: number;
}> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const numCoins = normalizeCoinAmount(coins);
  const numShards = finiteNonNegativeInteger(shards);

  const currentAltarLevel = Math.max(0, Math.floor(Number(s.sacrifices?.altarLevel ?? 0) || 0));
  const currentCoinFloor = altarCoinFloor(currentAltarLevel);
  if (s.coins < numCoins) throw new Error('Not enough Coins to sacrifice.');
  if ((s.shards ?? 0) < numShards) throw new Error('Not enough Shards to sacrifice.');

  if (!s.sacrifices) {
    s.sacrifices = {
      coinsSacrificed: 0,
      shardsSacrificed: 0,
      altarLevel: 0,
      luckSurgeUntil: 0,
      altarPity: 0,
      altarInsuranceCredit: 0,
    };
  }

  const sacrifices = s.sacrifices;
  const prevAltarLevel = sacrifices.altarLevel ?? 0;
  const previousPity = sacrifices.altarPity ?? 0;
  const insuranceLevel = Math.max(0, Math.min(10, Math.floor(Number(s.masterySkills?.altarInsurance ?? 0) || 0)));
  const previousInsuranceCredit = insuranceLevel > 0
    ? normalizeCoinAmount(sacrifices.altarInsuranceCredit ?? 0)
    : 0;
  const effectiveCoinOffering = normalizeCoinAmount(numCoins + previousInsuranceCredit);
  const hasCoinBreakthroughAttempt = effectiveCoinOffering >= currentCoinFloor && effectiveCoinOffering > 0;

  if (numCoins > 0 && !hasCoinBreakthroughAttempt) {
    throw new Error(`Coin offerings plus Altar Insurance credit require at least ${currentCoinFloor.toLocaleString()} effective Coins at Altar Lvl ${currentAltarLevel}.`);
  }
  if (numCoins === 0 && numShards <= 0 && !hasCoinBreakthroughAttempt) {
    throw new Error(`Sacrifice at least ${currentCoinFloor.toLocaleString()} effective Coins or 1 Shard.`);
  }

  s.coins -= numCoins;
  if (numShards > 0) spendShards(s, numShards);

  sacrifices.coinsSacrificed = (sacrifices.coinsSacrificed ?? 0) + numCoins;
  sacrifices.shardsSacrificed = (sacrifices.shardsSacrificed ?? 0) + numShards;

  // Coins now create a probabilistic Devotion Breakthrough. The offering
  // size raises the chance and failed attempts build pity. This roll only
  // happens when coins are actually offered.
  let altarBreakthroughChance = 0;
  let altarLeveledUp = false;
  if (hasCoinBreakthroughAttempt) {
    altarBreakthroughChance = altarCoinDevotionChancePercent(
      effectiveCoinOffering,
      previousPity,
      prevAltarLevel,
    );
    altarLeveledUp = serverRandom() * 100 < altarBreakthroughChance;

    if (altarLeveledUp) {
      sacrifices.altarLevel = prevAltarLevel + 1;
      sacrifices.altarPity = 0;
      sacrifices.altarInsuranceCredit = 0;
      s.masteryPoints = (s.masteryPoints ?? 0) + 1;
    } else {
      sacrifices.altarPity = previousPity + 1;
      sacrifices.altarInsuranceCredit = insuranceLevel > 0
        ? normalizeCoinAmount(Math.floor(effectiveCoinOffering * insuranceLevel * 0.05))
        : 0;
    }
  }

  // Shards retain their separate deterministic Luck Surge behavior.
  let luckSurgeExtended = false;
  if (numShards > 0) {
    const surgeDurationMs = numShards * 15 * 60 * 1000;
    sacrifices.luckSurgeUntil = Math.max(Date.now(), sacrifices.luckSurgeUntil ?? 0) + surgeDurationMs;
    luckSurgeExtended = true;
  }

  const altarPity = sacrifices.altarPity ?? 0;

  await save(s);
  await appendPlayerSpyLog('altar-sacrifice', {
    coinsSacrificed: numCoins,
    shardsSacrificed: numShards,
    altarLeveledUp,
    altarBreakthroughChance,
    altarPity,
    altarInsuranceCredit: sacrifices.altarInsuranceCredit ?? 0,
    effectiveCoinOffering: hasCoinBreakthroughAttempt ? effectiveCoinOffering : 0,
    luckSurgeExtended,
    altarLevel: sacrifices.altarLevel,
    snapshot: playerSpySnapshot(s),
  });

  return {
    state: s,
    altarLeveledUp,
    luckSurgeExtended,
    altarBreakthroughChance,
    altarPity,
    altarInsuranceCredit: sacrifices.altarInsuranceCredit ?? 0,
  };

  });}

export async function upgradeMasterySkill(skillId: MasterySkillId): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  if (
    typeof skillId !== 'string' ||
    !Object.prototype.hasOwnProperty.call(MASTERY_SKILLS, skillId)
  ) {
    throw new Error('Unknown mastery skill.');
  }
  const skill = MASTERY_SKILLS[skillId];

  if (!s.masterySkills) {
    s.masterySkills = {
      continuumLuck: 0,
      prosperity: 0,
      shardAttunement: 0,
      critMastery: 0,
      aftershock: 0,
      chronoFlow: 0,
      infiniteVault: 0,
      cosmicAttunement: 0,
      celestialSurge: 0,
      pityAccelerant: 0,
      apexFortune: 0,
      celestialVolley: 0,
      cooldownReclaimer: 0,
      altarInsurance: 0,
      constellationAtlas: 0,
      celestialAlignment: 0,
    };
  }

  const currentLevel = s.masterySkills[skillId] ?? 0;
  if (currentLevel >= skill.maxLevel) {
    throw new Error(`Mastery skill ${skill.name} is already at max level (${skill.maxLevel}).`);
  }

  const cost = masterySkillCost(skillId, currentLevel);
  if ((s.masteryPoints ?? 0) < cost) {
    throw new Error(`Requires ${cost} Mastery Points.`);
  }

  s.masteryPoints = (s.masteryPoints ?? 0) - cost;
  s.masterySkills[skillId] = currentLevel + 1;
  if (skillId === 'celestialAlignment' && currentLevel === 0) {
    s.alignmentPendingAt = 0;
    s.alignmentPendingForced = false;
    s.alignmentNextAt = nextCelestialAlignmentAt(Date.now());
  }
  await save(s);
  await appendPlayerSpyLog('mastery-upgrade-purchase', {
    skillId,
    levelBefore: currentLevel,
    levelAfter: s.masterySkills[skillId],
    cost,
    snapshot: playerSpySnapshot(s),
  });
  return s;

  });}

const CELESTIAL_ALIGNMENT_CHOICE_STATS_KEY = 'io:celestial-alignment:choice-stats:v1';
const CELESTIAL_ALIGNMENT_CHOICES = ['starseeker', 'goldenOrbit', 'clockwork'] as const;
type CelestialAlignmentChoiceStatsRecord = {
  total: number;
  choices: Record<CelestialAlignmentChoice, number>;
  recent: Array<{ username: string; choice: CelestialAlignmentChoice; chosenAt: number; adminTest: boolean }>;
};

function parseCelestialAlignmentChoiceStats(raw: string | null): CelestialAlignmentChoiceStatsRecord {
  const empty: CelestialAlignmentChoiceStatsRecord = {
    total: 0,
    choices: { starseeker: 0, goldenOrbit: 0, clockwork: 0 },
    recent: [],
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sourceChoices = parsed.choices && typeof parsed.choices === 'object' ? parsed.choices as Record<string, unknown> : {};
    const choices = {
      starseeker: finiteNonNegativeInteger(sourceChoices.starseeker, 0),
      goldenOrbit: finiteNonNegativeInteger(sourceChoices.goldenOrbit, 0),
      clockwork: finiteNonNegativeInteger(sourceChoices.clockwork, 0),
    };
    const total = choices.starseeker + choices.goldenOrbit + choices.clockwork;
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent.filter((entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry) &&
          typeof (entry as Record<string, unknown>).username === 'string' &&
          CELESTIAL_ALIGNMENT_CHOICES.includes((entry as Record<string, unknown>).choice as CelestialAlignmentChoice) &&
          Number.isSafeInteger((entry as Record<string, unknown>).chosenAt) &&
          Number((entry as Record<string, unknown>).chosenAt) > 0,
        ).slice(0, 25).map(entry => ({
          username: String(entry.username).replace(/^u\//i, '').slice(0, 32) || 'Redditor',
          choice: entry.choice as CelestialAlignmentChoice,
          chosenAt: Number(entry.chosenAt),
          adminTest: entry.adminTest === true,
        }))
      : [];
    return { total, choices, recent };
  } catch {
    return empty;
  }
}

export async function getCelestialAlignmentChoiceStats(): Promise<CelestialAlignmentChoiceStatsRecord> {
  return parseCelestialAlignmentChoiceStats(await redis.get(CELESTIAL_ALIGNMENT_CHOICE_STATS_KEY));
}

/**
 * Shared Alignment analytics are a projection of an already-saved player choice.
 * Retry WATCH conflicts against the newest value and make the write idempotent
 * for this event. A stats failure is logged, never returned as a failed choice.
 */
async function recordCelestialAlignmentChoiceStats(
  choice: CelestialAlignmentChoice,
  username: string,
  chosenAt: number,
  adminTest: boolean,
): Promise<void> {
  const normalizedUsername = username.replace(/^u\//i, '').slice(0, 32) || 'Redditor';
  const maxAttempts = 16;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let txn: Awaited<ReturnType<typeof redis.watch>> | null = null;
    let transactionClosed = false;
    try {
      txn = await redis.watch(CELESTIAL_ALIGNMENT_CHOICE_STATS_KEY);
      const previousRaw = await redis.get(CELESTIAL_ALIGNMENT_CHOICE_STATS_KEY);
      const previous = parseCelestialAlignmentChoiceStats(previousRaw);

      // Protect against an uncertain EXEC result being retried after it committed.
      const alreadyRecorded = previous.recent.some(entry =>
        entry.username.toLowerCase() === normalizedUsername.toLowerCase() &&
        entry.choice === choice &&
        entry.chosenAt === chosenAt &&
        entry.adminTest === adminTest
      );
      if (alreadyRecorded) {
        await txn.unwatch();
        transactionClosed = true;
        return;
      }

      const next: CelestialAlignmentChoiceStatsRecord = {
        total: previous.total + 1,
        choices: { ...previous.choices, [choice]: previous.choices[choice] + 1 },
        recent: [
          { username: normalizedUsername, choice, chosenAt, adminTest },
          ...previous.recent.filter(entry =>
            !(entry.username.toLowerCase() === normalizedUsername.toLowerCase() && entry.chosenAt === chosenAt)
          ),
        ].slice(0, 25),
      };

      await txn.multi();
      await txn.set(CELESTIAL_ALIGNMENT_CHOICE_STATS_KEY, JSON.stringify(next));
      const committed = await txn.exec();
      transactionClosed = true;
      if (committed !== null) return;
    } catch (error) {
      lastError = error;
    } finally {
      if (txn && !transactionClosed) {
        await txn.unwatch().catch(() => undefined);
      }
    }

    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, Math.min(10 * (attempt + 1), 100)));
    }
  }

  console.warn(
    '[Celestial Alignment] Player choice was saved, but shared choice statistics could not be updated.',
    lastError,
  );
}

export async function forceCelestialAlignmentPromptForCurrentUser(): Promise<{ queued: true; username: string; pendingAt: number }> {
  return withPlayerMutationLock(async () => {
    const s = await loadRaw();
    const pendingAt = Date.now();
    s.alignmentPendingAt = pendingAt;
    s.alignmentPendingForced = true;
    s.alignmentNextAt = 0;
    await save(s);
    return { queued: true, username: String(s.username ?? context.username ?? 'admin').replace(/^u\//i, ''), pendingAt };
  });
}

function nextCelestialAlignmentAt(now: number): number {
  const sample = Math.max(0, Math.min(1, serverRandom()));
  const interval = CELESTIAL_ALIGNMENT_MIN_INTERVAL_MS +
    Math.round(sample * (CELESTIAL_ALIGNMENT_MAX_INTERVAL_MS - CELESTIAL_ALIGNMENT_MIN_INTERVAL_MS));
  return now + interval;
}

export async function getCelestialAlignmentStatus(): Promise<{
  unlocked: boolean; pending: boolean; pendingAt: number;
  activeChoice: CelestialAlignmentChoice | null; activeUntil: number;
  activeInstances: CelestialAlignmentInstance[]; nextAt: number;
}> {
  return withPlayerMutationLock(async () => {
    const s = await loadRaw();
    const hasMastery = (s.masterySkills?.celestialAlignment ?? 0) > 0;
    const now = Date.now();
    const activeInstances = activeCelestialAlignmentInstances(s.alignmentActiveInstances, now);
    let changed = activeInstances.length !== (s.alignmentActiveInstances ?? []).length;
    if (changed) s.alignmentActiveInstances = activeInstances;

    // Pending choices are short-lived offers, not persistent windows. Expire
    // them on the server as well as in the client so stale tabs cannot claim one.
    const pendingAt = Math.max(0, Math.floor(Number(s.alignmentPendingAt ?? 0) || 0));
    if (pendingAt > 0 && now >= pendingAt + CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS + CELESTIAL_ALIGNMENT_CHOICE_GRACE_MS) {
      s.alignmentPendingAt = 0;
      s.alignmentPendingForced = false;
      s.alignmentNextAt = hasMastery ? nextCelestialAlignmentAt(now) : 0;
      changed = true;
    }
    const forcedPending = s.alignmentPendingForced === true && (s.alignmentPendingAt ?? 0) > 0;
    const latest = activeInstances[activeInstances.length - 1] ?? null;

    if (!hasMastery && !forcedPending) {
      if (s.alignmentActiveChoice !== (latest?.choice ?? null) || s.alignmentActiveUntil !== (latest?.expiresAt ?? 0)) {
        s.alignmentActiveChoice = latest?.choice ?? null;
        s.alignmentActiveUntil = latest?.expiresAt ?? 0;
        changed = true;
      }
      if (changed) await save(s);
      return {
        unlocked: false, pending: false, pendingAt: 0,
        activeChoice: latest?.choice ?? null, activeUntil: latest?.expiresAt ?? 0,
        activeInstances, nextAt: 0,
      };
    }

    if (s.alignmentActiveChoice !== (latest?.choice ?? null) || s.alignmentActiveUntil !== (latest?.expiresAt ?? 0)) {
      s.alignmentActiveChoice = latest?.choice ?? null;
      s.alignmentActiveUntil = latest?.expiresAt ?? 0;
      changed = true;
    }
    if (!(s.alignmentPendingAt ?? 0) && !(s.alignmentNextAt ?? 0)) {
      s.alignmentNextAt = nextCelestialAlignmentAt(now);
      changed = true;
    }
    if (!(s.alignmentPendingAt ?? 0) && (s.alignmentNextAt ?? 0) > 0 && (s.alignmentNextAt ?? 0) <= now) {
      s.alignmentPendingAt = now;
      s.alignmentPendingForced = false;
      s.alignmentNextAt = 0;
      changed = true;
    }
    if (changed) await save(s);
    return {
      unlocked: true,
      pending: (s.alignmentPendingAt ?? 0) > 0 &&
        now < Number(s.alignmentPendingAt) + CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS,
      pendingAt: (s.alignmentPendingAt ?? 0) > 0 &&
        now < Number(s.alignmentPendingAt) + CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS
        ? Number(s.alignmentPendingAt) : 0,
      activeChoice: latest?.choice ?? null,
      activeUntil: latest?.expiresAt ?? 0,
      activeInstances,
      nextAt: s.alignmentNextAt ?? 0,
    };
  });
}

export async function chooseCelestialAlignment(
  choice: CelestialAlignmentChoice,
): Promise<{
  state: PlayerState; activeChoice: CelestialAlignmentChoice; activeUntil: number;
  activeInstances: CelestialAlignmentInstance[]; nextAt: number;
}> {
  const choiceQueuedAt = Date.now();
  return withPlayerMutationLock(async () => {
    if (!['starseeker', 'goldenOrbit', 'clockwork'].includes(choice)) throw new Error('Choose a valid Celestial Alignment effect.');
    const s = await loadRaw();
    const hasMastery = (s.masterySkills?.celestialAlignment ?? 0) > 0;
    const wasAdminTest = s.alignmentPendingForced === true;
    if (!hasMastery && !wasAdminTest) throw new Error('Celestial Alignment Mastery is required.');
    const pendingAt = Number(s.alignmentPendingAt ?? 0);
    if (!(pendingAt > 0)) throw new Error('There is no Alignment choice waiting.');
    const now = Date.now();
    if (
      choiceQueuedAt >= pendingAt + CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS ||
      now >= pendingAt + CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS + CELESTIAL_ALIGNMENT_CHOICE_GRACE_MS
    ) {
      throw new Error('The Alignment choice window expired. The next event will arrive later.');
    }

    const activeInstances = activeCelestialAlignmentInstances(s.alignmentActiveInstances, now);
    const instance: CelestialAlignmentInstance = {
      id: secureServerToken('alignment'), choice, activatedAt: now,
      expiresAt: now + CELESTIAL_ALIGNMENT_DURATION_MS,
    };
    const nextInstances = [...activeInstances, instance].slice(-100);
    s.alignmentActiveInstances = nextInstances;
    s.alignmentActiveChoice = instance.choice;
    s.alignmentActiveUntil = instance.expiresAt;
    s.alignmentPendingAt = 0;
    s.alignmentPendingForced = false;
    s.alignmentNextAt = hasMastery ? nextCelestialAlignmentAt(now) : 0;
    const username = String(context.username ?? s.username ?? 'Redditor').trim().replace(/^u\//i, '').slice(0, 32) || 'Redditor';
    stageSavePostCommitAction(s, async () => {
      await recordCelestialAlignmentChoiceStats(choice, username, now, wasAdminTest);
    });
    await save(s);
    return {
      state: s, activeChoice: instance.choice, activeUntil: instance.expiresAt,
      activeInstances: nextInstances, nextAt: s.alignmentNextAt,
    };
  });
}

export async function synthesizeDust(): Promise<{ state: PlayerState; dustEarned: number }> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  if ((s.prestigeUpgrades?.shardSynthesis ?? 0) < 1) {
    throw new Error('Astral Forge prestige upgrade is required to synthesize Cosmic Dust.');
  }
  const currentDust = s.cosmicDust ?? 0;
  if (!Number.isSafeInteger(currentDust) || currentDust < 0 || currentDust >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Cosmic Dust has reached the maximum safely stored balance; no Shards were spent.');
  }
  if ((s.shards ?? 0) < SHARD_SYNTHESIS_COST) {
    throw new Error(`Synthesizing requires at least ${SHARD_SYNTHESIS_COST} Shards.`);
  }

  spendShards(s, SHARD_SYNTHESIS_COST);
  s.cosmicDust = currentDust + 1;
  await save(s);
  await appendPlayerSpyLog('dust-synthesis', {
    shardsSpent: SHARD_SYNTHESIS_COST,
    dustEarned: 1,
    snapshot: playerSpySnapshot(s),
  });
  return { state: s, dustEarned: 1 };

  });}

export async function buyCosmetic(_id: string): Promise<PlayerState> {
  // Legacy endpoint is retained only to give old clients a clear response. Cosmetics
  // were removed from gameplay; no currency can be spent through this endpoint.
  throw new Error('Cosmetics are disabled in Infinity Orbs. No currency was spent.');
}

async function claimWorldBoosterActivation(
  s: PlayerState,
  id: GlobalBoosterId,
  useCredit: boolean,
): Promise<{
  state: PlayerState;
  snapshot: GlobalBoosterSnapshot;
  usedCredit: boolean;
  announcement: {
    id: GlobalBoosterId;
    name: string;
    username: string;
    activatedAt: number;
  };
}> {
  const cost = GLOBAL_BOOSTERS[id].costShards;
  const userId = currentUserId();
  const previousShards = s.shards;
  const previousPurchasedShards = s.purchasedShards;
  const previousPurchasedShardLots = s.purchasedShardLots ? { ...s.purchasedShardLots } : undefined;
  const previousGlobalBoosterCredits = s.globalBoosterCredits;
  const previousGlobalBoosterCreditLots = s.globalBoosterCreditLots
    ? { ...s.globalBoosterCreditLots }
    : undefined;

  await appendGlobalBoosterDebugLog('player:activation-start', {
    userId,
    username: context.username ?? null,
    id,
    useCredit,
    costShards: cost,
    currentShards: s.shards,
    currentCredits: s.globalBoosterCredits ?? 0,
    playerGlobalState: s.globalBoosters ?? null,
  });

  if (useCredit) {
    const creditBalance = s.globalBoosterCredits;
    if (!Number.isSafeInteger(creditBalance) || (creditBalance as number) < 0) {
      throw new Error('Saved Global Booster credit balance is invalid; no activation was used.');
    }
    if ((creditBalance as number) <= 0) {
      throw new Error('No free Global Booster activations remain.');
    }
    const lots = normalizeEntitlementLots(
      s.globalBoosterCreditLots,
      creditBalance,
    );
    let remaining = 1;
    for (const orderId of Object.keys(lots)) {
      if (remaining <= 0) break;
      const lot = normalizeSafeInteger(lots[orderId], 0);
      const used = Math.min(lot, remaining);
      if (used > 0) {
        lots[orderId] = lot - used;
        remaining -= used;
        if (lots[orderId] <= 0) delete lots[orderId];
      }
    }
    s.globalBoosterCreditLots = lots;
    // Any untracked remainder is a non-purchased credit (for example an admin
    // grant); consuming it does not alter a purchase's refundable lot.
    s.globalBoosterCredits = (creditBalance as number) - 1;
  } else {
    if ((s.shards ?? 0) < cost) throw new Error('Not enough Shards for this Global Booster.');
    spendShards(s, cost);
  }

  let snapshot: GlobalBoosterSnapshot;
  try {
    const prepared = await prepareGlobalBoosterActivation(id);
    snapshot = prepared.snapshot;
    s.globalBoosters = snapshot;

    await appendGlobalBoosterDebugLog('player:before-atomic-save', {
      userId,
      id,
      useCredit,
      shards: s.shards,
      credits: s.globalBoosterCredits ?? 0,
      snapshot,
    });

    // Player currency and the shared Booster stack commit together under one
    // WATCH/MULTI/EXEC. A failed player save can no longer leave a free Booster,
    // and a conflicting Booster write cannot charge the player.
    await save(s, {
      key: GLOBAL_BOOSTERS_KEY,
      expectedValue: prepared.expectedValue,
      nextValue: prepared.nextValue,
      conflictMessage: 'Global Booster changed before your activation committed. Please retry.',
    });
  } catch (error) {
    // Nothing should have committed if the atomic save failed. Restore all
    // currency provenance as well as the visible balances; the persisted save
    // remains authoritative until the atomic transaction succeeds.
    s.shards = previousShards;
    s.purchasedShards = previousPurchasedShards;
    s.purchasedShardLots = previousPurchasedShardLots;
    s.globalBoosterCredits = previousGlobalBoosterCredits;
    s.globalBoosterCreditLots = previousGlobalBoosterCreditLots;
    await appendGlobalBoosterDebugLog('player:activation-failed-before-commit', {
      userId,
      id,
      useCredit,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
    }).catch(logError => {
      console.error('[Global Booster] Failure log failed:', logError);
    });
    throw error;
  }

  // From this point onward the player charge and the Booster activation are
  // durable. Logging/announcement failures must not turn a committed action
  // into an apparent failure that can be retried for a second activation.
  const activatedAt = Date.now();
  const activatedBy = String(context.username ?? s.username ?? 'Redditor').trim() || 'Redditor';
  const announcement = {
    id,
    name: GLOBAL_BOOSTERS[id].name,
    username: activatedBy,
    activatedAt,
  };
  try {
    await appendGlobalBoosterDebugLog('player:activation-success', {
      userId,
      id,
      useCredit,
      snapshot,
      shardsAfter: s.shards,
      creditsAfter: s.globalBoosterCredits ?? 0,
    });
    await appendGlobalBoosterActivationLog({
      timestamp: activatedAt,
      userId,
      username: activatedBy,
      boosterId: id,
      boosterName: GLOBAL_BOOSTERS[id].name,
      usedCredit: useCredit,
      tier: Number(snapshot[id].tier ?? 0),
      endsAt: Number(snapshot[id].endsAt ?? 0),
    });
    await redis.set(GLOBAL_BOOSTER_ANNOUNCEMENT_KEY, JSON.stringify(announcement));
  } catch (error) {
    console.error('[Global Booster] Activation committed, but announcement/audit projection failed:', error);
  }

  return { state: s, snapshot, usedCredit: useCredit, announcement };
}
export async function activateGlobalBooster(
  id: GlobalBoosterId,
  useCredit = false,
): Promise<{
  state: PlayerState;
  snapshot: GlobalBoosterSnapshot;
  usedCredit: boolean;
  announcement: {
    id: GlobalBoosterId;
    name: string;
    username: string;
    activatedAt: number;
  };
}> {
  return withPlayerMutationLock(async () => {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(GLOBAL_BOOSTERS, id)) {
    throw new Error('Unknown Global Booster.');
  }

  const userId = currentUserId();
  await appendGlobalBoosterDebugLog('player:request', {
    userId,
    username: context.username ?? null,
    id,
    useCredit,
  });

  const s = await settleOffline(await loadRaw());
  if (s.riftSession) {
    throw new Error('Global Boosters are outside this isolated Rift run.');
  }

  await appendGlobalBoosterDebugLog('player:loaded-state', {
    userId,
    id,
    useCredit,
    shards: s.shards,
    credits: s.globalBoosterCredits ?? 0,
    globalBoosters: s.globalBoosters ?? null,
  });

  return claimWorldBoosterActivation(s, id, useCredit);

  });}

export async function activatePremiumBooster(id: PremiumBoosterId): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const info = PREMIUM_BOOSTERS[id];
  if (!info) throw new Error('Unknown premium booster.');
  if (!s.activeBoosters) s.activeBoosters = {};
  if ((s.shards ?? 0) < info.costShards) {
    throw new Error(info.name + ' requires ' + info.costShards + ' Shards.');
  }

  const now = Date.now();
  spendShards(s, info.costShards);
  s.activeBoosters[id] = Math.max(now, s.activeBoosters[id] ?? 0) + info.durationMs;
  await save(s);
  await appendPlayerSpyLog('premium-booster-activation', {
    booster: id,
    costShards: info.costShards,
    durationMs: info.durationMs,
    activeUntil: s.activeBoosters[id],
    snapshot: playerSpySnapshot(s),
  });
  return s;

  });}

export async function buyAutomation(id: AutomationId): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  if (s.riftSession?.challengeId === 'first-spark') {
    throw new Error('Automation is disabled in The First Spark.');
  }
  const info = AUTOMATIONS[id];
  if (!info) throw new Error('Unknown automation.');
  if (s.automations?.[id]) throw new Error(info.name + ' is already unlocked.');
  if ((s.shards ?? 0) < info.costShards) {
    throw new Error(info.name + ' requires ' + info.costShards + ' Shards.');
  }

  spendShards(s, info.costShards);
  s.automations = { ...(s.automations ?? {}), [id]: true };
  await save(s);
  await appendPlayerSpyLog('automation-purchase', {
    automation: id,
    costShards: info.costShards,
    snapshot: playerSpySnapshot(s),
  });
  return s;

  });}

export async function claimCommunityReward(): Promise<{ state: PlayerState; rewardCoins: number; rewardXp: number; nextClaimAt: number; tier: number }> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw(), { skipAutoCommunityClaim: true });
  const result = await claimCommunityRewardFromState(s);
  if (result.rewardCoins <= 0) throw new Error('No new Community Reward is available.');
  await save(s);
  await appendPlayerSpyLog('community-reward-claim', {
    rewardCoins: result.rewardCoins,
    rewardXp: result.rewardXp,
    tier: result.tier,
    snapshot: playerSpySnapshot(s),
  });
  return { state: s, ...result };

  });}

type FrenzyPostSubmission = {
  runAs: 'USER';
  subredditName: string;
  title: string;
  flairId?: string;
  entry: 'frenzy';
  userGeneratedContent: { text: string };
};

/** Shared payload builder for the live Frenzy publisher and local Pages preview. */
async function buildFrenzyPostSubmission(
  ownerUsername: string,
  subredditName: string,
  rarity: number,
  isInfinity: boolean,
): Promise<FrenzyPostSubmission> {
  const rarityText = `1/${formatRarity(rarity, isInfinity)}`;
  const body =
    `u/${ownerUsername} got a ${rarityText} Orb in their Frenzy.\n\n` +
    `Click below to claim it! You can only claim one every 23 hours.\n\n` +
    `When someone claims your Frenzy, you receive +${FRENZY_OWNER_SHARD_REWARD} Shards. ` +
    `This owner reward is granted separately from roll-earned Shards.\n\n` +
    `If you claim this Frenzy, please consider upvoting the post to thank its owner.`;
  return {
    runAs: 'USER',
    subredditName,
    title: `u/${ownerUsername} got a ${rarityText} Orb in their Frenzy`,
    ...(await getPostFlairOptions(subredditName, 'frenzy')),
    entry: 'frenzy',
    userGeneratedContent: { text: body },
  };
}

export async function startOrbFrenzy(options: {
  bypassDailyLimit?: boolean;
  forcedRarity?: number;
  adminTest?: boolean;
} = {}): Promise<RollResponse & { postId: string; url: string; rarity: number }> {
  return withPlayerMutationLock(async () => {
    const loadedState = await loadRaw();
    if (loadedState.riftSession) throw new Error('Frenzy publishing is unavailable inside an isolated Rift run.');
    const performFrenzyStart = async () => {
      const s = await settleOffline(loadedState);
    const now = Date.now();
    const postCooldown = frenzyCooldownRemaining(s.lastFrenzyAt, now);
    const today = new Date(now).toISOString().slice(0, 10);
    if (!options.bypassDailyLimit && postCooldown > 0) {
      throw new Error('Orb Frenzy is on cooldown for ' + Math.ceil(postCooldown / 1000) + ' more seconds.');
    }

    const forcedRarity = options.forcedRarity == null
      ? undefined
      : Math.max(2, Math.floor(Number(options.forcedRarity)));
    const liveBalance = await getLiveBalanceConfig();
    const reclaimedPerActivation = cooldownReclaimerEnergyPerActivationMs(s, false, liveBalance);
    const result = await applyRolls(s, 1, forcedRarity, 'online', 1);

    const subredditName = String(context.subredditName ?? '').trim();
    if (!subredditName) throw new Error('Subreddit context is unavailable.');

    const ownerUsername = String(context.username ?? s.username ?? 'Redditor')
      .trim()
      .replace(/^u\//i, '') || 'Redditor';
    const rarity = result.bestOrb.rarity;
    const isInfinity = result.bestOrb.isInfinity === true;
    const createdAt = Date.now();
    const expiresAt = frenzyPostExpiresAt(createdAt);
    const postSubmission = await buildFrenzyPostSubmission(ownerUsername, subredditName, rarity, isInfinity);
    const post = await reddit.submitCustomPost(postSubmission);
    const postId = String(post?.id ?? '').trim();
    if (!postId) throw new Error('Could not create the Frenzy post.');

    const adminTest = options.adminTest === true || isFrenzyTestAdmin(s.username) || isFrenzyTestAdmin(ownerUsername);
    const frenzyPostValue = JSON.stringify({
      ownerId: currentUserId(),
      ownerUsername,
      rarity,
      isInfinity,
      subredditName,
      adminTest,
      inGame: true,
      createdAt,
      expiresAt,
      consumedAt: null,
    });

    s.manualRolls = Math.min(10, (s.manualRolls ?? 0) + 1);
    if (s.manualRolls >= 3) s.upgrades.auto = 1;
    s.lastFrenzyDate = today;
    s.lastFrenzyAt = createdAt;
    s.lastRollAt = Date.now();
    s.lastSeenAt = Date.now();
    grantCooldownReclaimerTimeEnergy(s, 1, reclaimedPerActivation);
    // Do not publish a claimable post record unless the owner's roll rewards,
    // cooldown, Guild/community effects and post receipt all commit together.
    const frenzyPostKey = FRENZY_POST_PREFIX + postId;
    const frenzySaveGeneration = Math.max(0, Math.floor(Number(s.saveGeneration ?? 0)));
    const frenzySaveRevision = Math.max(0, Math.floor(Number(s.stateRevision ?? 0)) || 0);
    const frenzyReceiptWrite: SaveExtraWrite = {
      key: frenzyPostKey,
      expectedValue: null,
      nextValue: frenzyPostValue,
      expiration: new Date(expiresAt + FRENZY_POST_RECEIPT_RETENTION_MS),
      conflictMessage: 'Frenzy post ID is already registered; no player state was saved.',
    };
    // Set only after a successful read proves the atomic receipt is absent. This
    // gates compensating deletion if every safe save attempt fails.
    let confirmedUncommittedPost = false;
    try {
      await save(s, frenzyReceiptWrite);
    } catch (saveError) {
      // The post already exists at this point. Redis can return an ambiguous
      // transaction error even when EXEC committed, so the receipt itself is the
      // commit proof: player state and receipt were written in one transaction.
      try {
        const persistedReceipt = await redis.get(frenzyPostKey);
        if (persistedReceipt != null && String(persistedReceipt) !== frenzyPostValue) {
          // A different receipt means another post operation owns this key;
          // never retry an already-conflicted receipt against a foreign value.
          throw saveError;
        }
        if (persistedReceipt != null && String(persistedReceipt) === frenzyPostValue) {
          // Mirror save()'s normal post-commit bookkeeping, because its EXEC
          // response was ambiguous even though the atomic receipt proves commit.
          pendingSaveExtraWrites.delete(s);
          s.saveGeneration = frenzySaveGeneration;
          s.stateRevision = frenzySaveRevision + 1;
          const postCommitActions = pendingSavePostCommitActions.get(s) ?? [];
          pendingSavePostCommitActions.delete(s);
          for (const action of postCommitActions) {
            try {
              await action();
            } catch (error) {
              console.error('[Player Save] Reconciled post-commit action failed:', error);
            }
          }
          void syncRarityFlair(s).catch(error => {
            console.error('[Rarity Flair] Background update failed after Frenzy save reconciliation:', error);
          });
        } else {
          // A successful read confirms no atomic player-state/post receipt commit.
          // If the safe retry also fails, this post has no valid game record and
          // must be compensated instead of remaining as an unclaimable public post.
          confirmedUncommittedPost = true;
          // Retry the identical mutation only if the player's generation and
          // revision have not moved. Never rebase rewards or roll state onto a
          // newer save, and never retry after a wipe.
          const playerRaw = await redis.get(key());
          const decodedPlayerRaw = playerRaw == null ? null : await readStoredPlayerSave(currentUserId(), playerRaw);
          const persistedPlayer = decodedPlayerRaw == null ? null : parsePlayerStateValue(decodedPlayerRaw);
          const generationRaw = await redis.get(saveGenerationKeyFor(currentUserId()));
          const currentGeneration = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
          const currentRevision = playerRaw == null
            ? 0
            : persistedPlayer
              ? Math.max(0, Math.floor(Number(persistedPlayer.stateRevision ?? 0)) || 0)
              : -1;
          const activeLock = getActivePlayerMutationLock(currentUserId());
          if (
            currentGeneration !== frenzySaveGeneration ||
            currentRevision !== frenzySaveRevision ||
            !activeLock ||
            await redis.get(activeLock.key) !== activeLock.token
          ) {
            throw saveError;
          }
          await save(s, frenzyReceiptWrite);
          confirmedUncommittedPost = false;
        }
      } catch (recoveryError) {
        if (confirmedUncommittedPost) {
          try {
            // Recheck receipt immediately before compensation: a retry may have
            // committed despite throwing, in which case deleting the public post
            // would break a valid game transaction.
            const finalReceipt = await redis.get(frenzyPostKey);
            if (finalReceipt == null) {
              const postDeleter = post as unknown as { delete?: () => Promise<void> };
              if (typeof postDeleter.delete !== 'function') {
                throw new Error('Reddit post object does not expose delete(); manual cleanup may be required.');
              }
              await postDeleter.delete();
              console.error('[Frenzy Start] Deleted a public post whose player state/receipt could not be committed.', {
                postId,
                userId: currentUserId(),
              });
            }
          } catch (cleanupError) {
            console.error('[Frenzy Start] Could not delete uncommitted public post; manual cleanup may be required.', {
              postId,
              userId: currentUserId(),
              cleanupError,
            });
          }
        }
        if (recoveryError !== saveError) {
          console.error('[Frenzy Start] Could not reconcile post/save outcome:', recoveryError);
        }
        throw saveError;
      }
    }
    await appendPlayerSpyLog('frenzy-start', {
      rarity,
      postId,
      forcedRarity: forcedRarity ?? null,
      adminTest,
      snapshot: playerSpySnapshot(s),
    });

    return {
      state: s,
      postId,
      rarity,
      url: `https://reddit.com/r/${subredditName}/comments/${postId}`,
      orb: result.bestOrb,
      batch: result.batch,
      totalValueGained: result.totalVal,
      totalRollValue: result.totalVal,
      coinsGained: result.coinsGained,
      shardsGained: result.shardsGained,
      xpGained: result.xpGained,
      rollsRemainingUntilNext: cooldownMs(s, false, liveBalance),
      rollsProcessed: result.rollCount,
      dramaticReveal: rarity >= 100,
    };
      };
      // Creating the Reddit post is an external request that may take time.
      // Do not hold the shared Guild lock across it; save() will safely skip a
      // conflicting Guild projection without rolling back the player's reward.
      return performFrenzyStart();
  });
}

/**
 * Create a synthetic Frenzy post in the Pages Redis mock. The stored record and
 * preview payload match the real publisher; only the external Reddit submission is skipped.
 */
export async function createFrenzySimulatorPost(requestedRarity: unknown): Promise<{
  postId: string;
  title: string;
  body: string;
  subredditName: string;
  ownerUsername: string;
  runAs: 'USER';
  entry: 'frenzy';
  flairId: string | null;
  rarity: number;
  isInfinity: boolean;
  createdAt: number;
  expiresAt: number;
}> {
  const ownerId = currentUserId();
  if (!ownerId.startsWith('github-pages-test-')) {
    throw new Error('The Reddit post simulator is only available in the GitHub Pages test build.');
  }
  const rawRarity = Number(requestedRarity);
  if (!Number.isFinite(rawRarity) || !Number.isInteger(rawRarity) || rawRarity < 2) {
    throw new Error('Enter a valid Orb rarity of at least 2.');
  }

  return withPlayerMutationLock(async () => {
    const rarity = Math.min(MAX_ORB_RARITY, rawRarity);
    const isInfinity = rarity >= MAX_ORB_RARITY;
    const state = await loadRaw({ registerActivity: false });
    const ownerUsername = String(context.username ?? state.username ?? 'Redditor')
      .trim()
      .replace(/^u\//i, '') || 'Redditor';
    const subredditName = String(context.subredditName ?? 'infinityorbs').trim() || 'infinityorbs';
    const createdAt = Date.now();
    const expiresAt = frenzyPostExpiresAt(createdAt);
    const submission = await buildFrenzyPostSubmission(ownerUsername, subredditName, rarity, isInfinity);
    const postId = 't3_pages_preview-' + createSecureId();
    const record: FrenzyPostRecord = {
      ownerId,
      ownerUsername,
      rarity,
      isInfinity,
      subredditName,
      adminTest: true,
      inGame: true,
      createdAt,
      expiresAt,
      consumedAt: null,
    };
    await redis.set(
      FRENZY_POST_PREFIX + postId,
      JSON.stringify(record),
      { expiration: new Date(expiresAt + FRENZY_POST_RECEIPT_RETENTION_MS) },
    );

    return {
      postId,
      title: submission.title,
      body: submission.userGeneratedContent.text,
      subredditName: submission.subredditName,
      ownerUsername,
      runAs: submission.runAs,
      entry: submission.entry,
      flairId: submission.flairId ?? null,
      rarity,
      isInfinity,
      createdAt,
      expiresAt,
    };
  });
}

export async function getOrbFrenzyInfo(options: { postId?: string; allowAdminTestOwner?: boolean } = {}): Promise<{
  rarity: number;
  isInfinity: boolean;
  ownerUsername: string;
  createdAt: number;
  expiresAt: number;
  expired: boolean;
  consumed: boolean;
  claimedToday: boolean;
  claimsRemainingToday: number;
  claimLimitPerDay: number;
  claimCooldownRemainingMs: number;
  claimCooldownEndsAt: number;
  isOwner: boolean;
  baseOrbCount: number;
  multiRolls: number;
  rewardOrbCount: number;
  frenzyVolleyBonus: boolean;
  canClaim: boolean;
  selfClaimTest: boolean;
  postId: string;
  claimCount: number;
  recentClaimers: Array<{ username: string; claimedAt: number }>;
  inGame?: boolean;
}> {
  const requestedPostId = String(options.postId ?? '').trim();
  if (requestedPostId && options.allowAdminTestOwner !== true) {
    throw new Error('Explicit Frenzy post previews are admin-only.');
  }
  const contextPostId = requestedPostId || String(context.postId ?? '').trim();
  const viewerId = currentUserId();
  const contextPostRaw = contextPostId
    ? await redis.get(FRENZY_POST_PREFIX + contextPostId)
    : null;
  const contextPostData = parseFrenzyPostRecord(contextPostRaw);
  // Explicit Pages preview IDs bypass Reddit post context and stale handoffs.
  const handoff = contextPostData || requestedPostId ? null : await readFrenzyHandoff(viewerId);
  const postId = contextPostData ? contextPostId : handoff?.postId ?? contextPostId;
  if (!postId) throw new Error('This is not an Orb Frenzy post.');

  const raw = contextPostData ? contextPostRaw : await redis.get(FRENZY_POST_PREFIX + postId);
  if (!raw) throw new Error('Orb Frenzy post data was not found.');

  const data = contextPostData ?? parseFrenzyPostRecord(raw);
  if (!data) throw new Error('Orb Frenzy data is corrupted.');

  const now = Date.now();
  const expiresAt = Number(data.expiresAt ?? frenzyPostExpiresAt(data.createdAt));
  const expired = isFrenzyPostRecordExpired(data, now);
  const claimers = parseFrenzyClaimersRecord(await redis.get(frenzyClaimersKey(postId)));
  const claimedReceipt = await redis.get(frenzyClaimReceiptKey(postId, viewerId));
  const alreadyClaimedByViewer = claimedReceipt != null || data.consumedBy === viewerId;
  // Preview rendering must not invoke the ordinary player-state read, which touches online presence.
  const s = await loadRaw({ registerActivity: false });
  const claimsRemainingToday = frenzyClaimsRemainingToday(s.lastFrenzyClaimDate, s.frenzyClaimsToday, now);
  const claimedToday = claimsRemainingToday <= 0;
  const isOwner = data.ownerId === currentUserId();
  const selfClaimTest =
    isOwner &&
    data.adminTest === true &&
    (isFrenzyTestAdmin(s.username) || options.allowAdminTestOwner === true);

  const baseOrbCount = frenzyOrbCountForRarity(data.rarity);
  const multiRolls = rollsPerActivation(s);
  const rewardOrbCount = frenzyClaimCountForRarity(
    data.rarity,
    multiRolls,
    s.prestigeUpgrades?.frenzyVolley ?? 0,
  );

  return {
    rarity: data.rarity,
    isInfinity: data.isInfinity === true,
    baseOrbCount,
    multiRolls,
    rewardOrbCount,
    frenzyVolleyBonus: (s.prestigeUpgrades?.frenzyVolley ?? 0) > 0,
    ownerUsername: data.ownerUsername,
    createdAt: data.createdAt,
    expiresAt,
    expired,
    // Legacy consumedAt marked a post globally. New claims are shared by every player;
    // only this viewer's durable receipt (or legacy consumedBy) marks it claimed to them.
    consumed: alreadyClaimedByViewer,
    claimedToday,
    claimsRemainingToday,
    claimLimitPerDay: FRENZY_CLAIMS_PER_DAY,
    claimCooldownRemainingMs: 0,
    claimCooldownEndsAt: 0,
    isOwner,
    canClaim: !expired && !alreadyClaimedByViewer && (claimsRemainingToday > 0 || selfClaimTest) && (!isOwner || selfClaimTest),
    selfClaimTest,
    postId,
    claimCount: claimers.count,
    recentClaimers: claimers.players.map(({ username, claimedAt }) => ({ username, claimedAt })),
    inGame: data.inGame === true,
  };
}

export async function getOrbFrenzyClaimProgress(): Promise<{
  postId: string | null;
  attemptId: string | null;
  updatedAt: number | null;
  active: boolean;
  processed: number;
  total: number;
  percent: number;
  completed: boolean;
}> {
  const raw = await redis.get(frenzyClaimProgressKey(currentUserId()));
  const progress = parseStoredJson<FrenzyClaimProgressRecord>(raw);
  if (
    !progress ||
    typeof progress.postId !== 'string' ||
    !Number.isSafeInteger(progress.processed) ||
    !Number.isSafeInteger(progress.total) ||
    progress.processed < 0 ||
    progress.total < 0 ||
    progress.processed > progress.total ||
    !Number.isSafeInteger(progress.updatedAt) ||
    progress.updatedAt < 0
  ) {
    return { postId: null, attemptId: null, updatedAt: null, active: false, processed: 0, total: 0, percent: 0, completed: false };
  }
  const completed = progress.completed === true;
  const processed = Math.min(progress.total, progress.processed);
  const percent = completed
    ? 100
    : progress.total > 0
      ? Math.min(95, Math.floor((processed / progress.total) * 95))
      : 0;
  const active = !completed && Date.now() - progress.updatedAt <= FRENZY_CLAIM_PROGRESS_TTL_MS;
  return { postId: progress.postId, attemptId: progress.attemptId, updatedAt: progress.updatedAt, active, processed, total: progress.total, percent, completed };
}

export async function claimOrbFrenzy(options: {
  allowAdminTestOwner?: boolean;
  postId?: string;
  attemptId?: string;
} = {}): Promise<RollResponse> {
  if (options.postId && options.allowAdminTestOwner !== true) {
    throw new Error('Explicit Frenzy post targeting is admin-only.');
  }

  const claimantId = currentUserId();
  const attemptId = String(options.attemptId ?? '').trim() || `claim-${Date.now().toString(36)}`;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(attemptId)) {
    throw new Error('Invalid Frenzy claim attempt.');
  }
  const contextPostId = String(context.postId ?? '').trim();
  const contextPostRaw = !options.postId && contextPostId
    ? await redis.get(FRENZY_POST_PREFIX + contextPostId)
    : null;
  const contextPostData = parseFrenzyPostRecord(contextPostRaw);
  const isDirectFrenzyPost = contextPostData !== null;
  // A claim clicked on a Frenzy post belongs to that post. A stale handoff may
  // only be used from the main game, where there is no current Frenzy record.
  const handoff = options.postId || isDirectFrenzyPost ? null : await readFrenzyHandoff(claimantId);
  const postId = options.postId ?? (isDirectFrenzyPost ? contextPostId : handoff?.postId ?? contextPostId);
  if (!postId) throw new Error('This is not an Orb Frenzy post.');

  const postKey = FRENZY_POST_PREFIX + postId;
  const initialRaw = await redis.get(postKey);
  if (!initialRaw) throw new Error('Orb Frenzy post data was not found.');
  const initialData = parseFrenzyPostRecord(initialRaw);
  const lockedOwnerId = String(initialData?.ownerId ?? '').trim();
  if (!lockedOwnerId) throw new Error('Orb Frenzy data is corrupted.');

  // One stable lock order covers claimant state, owner state, and this post.
  // The post lock prevents duplicate side effects before the atomic save guard;
  // the owner lock prevents a reward writer from invalidating an in-flight owner save.
  const postLockId = `__frenzy-post__:${postId}`;
  const lockIds = lockedOwnerId === claimantId
    ? [claimantId, postLockId]
    : [claimantId, lockedOwnerId, postLockId];

  return withPlayerMutationLocksFor(lockIds, async () => {
  const raw = await redis.get(postKey);
  if (!raw) throw new Error('Orb Frenzy post data was not found.');

  const data = parseFrenzyPostRecord(raw);
  if (!data) throw new Error('Orb Frenzy data is corrupted.');
  if (String(data.ownerId ?? '').trim() !== lockedOwnerId) {
    throw new Error('Frenzy ownership changed. Please reopen the post.');
  }
  if (handoff && handoff.expiresAt <= Date.now()) {
    throw new Error('This Frenzy handoff expired. Please reopen the post.');
  }
  const claimReceiptKey = frenzyClaimReceiptKey(postId, claimantId);
  const existingClaimReceipt = await redis.get(claimReceiptKey);
  if (existingClaimReceipt != null || data.consumedBy === claimantId) {
    throw new Error('You have already claimed this Orb Frenzy.');
  }

  const isOwner = data.ownerId === claimantId;

  const now = Date.now();
  const createdAt = Number(data.createdAt ?? 0);
  if (isFrenzyPostRecordExpired(data, now)) throw new Error('This Frenzy has expired.');
  const loadedState = await loadRaw();
  const performClaim = async () => {
  const s = await settleOffline(loadedState);
  const claimsUsedToday = frenzyClaimsUsedToday(s.lastFrenzyClaimDate, s.frenzyClaimsToday, now);
  const ownerSelfClaimAllowed =
    isOwner &&
    data.adminTest === true &&
    (isFrenzyTestAdmin(s.username) || options.allowAdminTestOwner === true);

  if (isOwner && !ownerSelfClaimAllowed) {
    throw new Error('You cannot claim your own Orb Frenzy.');
  }

  const selfClaimTest = isOwner && ownerSelfClaimAllowed;
  if (claimsUsedToday >= FRENZY_CLAIMS_PER_DAY && !selfClaimTest) {
    throw new Error('You have used all ' + FRENZY_CLAIMS_PER_DAY + ' Frenzy claims available today.');
  }

  const frenzyRollsPerActivation = rollsPerActivation(s);
  const liveBalance = await getLiveBalanceConfig();
  const reclaimedPerActivation = cooldownReclaimerEnergyPerActivationMs(s, false, liveBalance);
  const count = frenzyClaimCountForRarity(
    data.rarity,
    frenzyRollsPerActivation,
    s.prestigeUpgrades?.frenzyVolley ?? 0,
  );
  // Frenzy's payout is expressed as Orb count. Convert it back to completed
  // activations so Multiball doesn't multiply Time Energy per Orb.
  const frenzyActivations = Math.floor(count / Math.max(1, frenzyRollsPerActivation));

  // The post's Orb determines payout size only, never a guaranteed result rarity.
  if (
    !Number.isSafeInteger(s.totalRolls) ||
    s.totalRolls < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > Number.MAX_SAFE_INTEGER - s.totalRolls
  ) {
    throw new Error('Frenzy roll counter would exceed the safe integer range; claim was not processed.');
  }

  let bestOrb: Orb | null = null;
  const visibleBatch: Orb[] = [];
  let finalValue = 0;
  let coinsGained = 0;
  let shardsGained = 0;
  let xpGained = 0;
  let processedCount = 0;
  let remainingCount = count;
  await writeFrenzyClaimProgress(claimantId, postId, attemptId, count, 0, false);

  // Work in at most 500,000 effective-Orb batches. applyRolls compresses each
  // batch to at most 50,000 representative samples and reports exact weighted progress.
  let lastProgressWriteAt = 0;
  while (remainingCount > 0) {
    const chunkCount = Math.min(MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH, remainingCount);
    const result = await applyRolls(
      s,
      1,
      undefined,
      'frenzy',
      chunkCount,
      undefined,
      false,
      async chunkProcessed => {
        const absoluteProcessed = Math.min(count, processedCount + chunkProcessed);
        const nowForProgress = Date.now();
        if (absoluteProcessed >= count || nowForProgress - lastProgressWriteAt >= 100) {
          lastProgressWriteAt = nowForProgress;
          await writeFrenzyClaimProgress(claimantId, postId, attemptId, count, absoluteProcessed, false);
        }
      },
    );
    const candidate = result.bestOrb;
    if (
      !bestOrb ||
      (candidate.isInfinity && !bestOrb.isInfinity) ||
      (Boolean(candidate.isInfinity) === Boolean(bestOrb.isInfinity) && candidate.rarity > bestOrb.rarity)
    ) {
      bestOrb = candidate;
    }
    if (visibleBatch.length < 8) {
      visibleBatch.push(...result.batch.slice(0, 8 - visibleBatch.length));
    }
    finalValue = addCollectionValue(finalValue, result.totalVal);
    coinsGained = addCoinAmount(coinsGained, result.coinsGained);
    shardsGained = Math.min(Number.MAX_SAFE_INTEGER, shardsGained + result.shardsGained);
    xpGained = Math.min(Number.MAX_SAFE_INTEGER, xpGained + result.xpGained);
    processedCount = Math.min(Number.MAX_SAFE_INTEGER, processedCount + result.rollCount);
    remainingCount -= chunkCount;
    await writeFrenzyClaimProgress(claimantId, postId, attemptId, count, processedCount, false);
  }

  if (!bestOrb || processedCount !== count) {
    throw new Error('Frenzy roll batch could not be completed exactly; claim was not saved.');
  }

  grantCooldownReclaimerTimeEnergy(s, frenzyActivations, reclaimedPerActivation);
  s.lastFrenzyClaimDate = new Date(now).toISOString().slice(0, 10);
  s.frenzyClaimsToday = selfClaimTest ? claimsUsedToday : Math.min(FRENZY_CLAIMS_PER_DAY, claimsUsedToday + 1);
  s.lastFrenzyClaimAt = now;

  let ownerRewardShards = 0;
  let ownerRewardWrites: SaveExtraWrite[] = [];
  if (isOwner) {
    ownerRewardShards = grantFrenzyOwnerShards(s, FRENZY_OWNER_SHARD_REWARD);
    queueFrenzyShardPopup(s, ownerRewardShards);
  } else {
    const ownerReward = await prepareFrenzyOwnerRewardWrites(
      data.ownerId,
      FRENZY_OWNER_SHARD_REWARD,
    );
    ownerRewardShards = ownerReward.granted;
    ownerRewardWrites = ownerReward.writes;
  }

  // Write a distinct idempotency receipt for this claimant. The post itself remains
  // unchanged, so any number of other players can claim it while each player can
  // only claim it once. WATCH/EXEC verifies the post didn't change during rewards.
  const claimantUsername = String(context.username ?? s.username ?? 'Redditor')
    .trim()
    .replace(/^u\//i, '')
    .slice(0, 32) || 'Redditor';
  const claimProjectionExpiresAt = new Date(
    frenzyPostExpiresAt(createdAt) + FRENZY_POST_RECEIPT_RETENTION_MS,
  );
  // This runs only after the atomic claimant receipt, reward, and owner reward save.
  // Claim activity can lag briefly, but it can never invalidate a successful claim.
  stageSavePostCommitAction(s, async () => {
    await recordFrenzyClaimer(
      postId,
      claimantId,
      claimantUsername,
      now,
      claimProjectionExpiresAt,
    );
  });

  await save(s, [
    {
      key: claimReceiptKey,
      expectedValue: null,
      nextValue: JSON.stringify({ postId, claimantId, claimedAt: now }),
      expiration: new Date(frenzyPostExpiresAt(createdAt) + FRENZY_POST_RECEIPT_RETENTION_MS),
      conflictMessage: 'You have already claimed this Orb Frenzy.',
    },
    {
      key: FRENZY_POST_PREFIX + postId,
      expectedValue: raw,
      nextValue: raw,
      expiration: new Date(frenzyPostExpiresAt(createdAt) + FRENZY_POST_RECEIPT_RETENTION_MS),
      conflictMessage: 'This Frenzy changed before your claim could be committed.',
    },
    ...ownerRewardWrites,
  ]);
  // save() returns only after the claimant receipt, claimant reward, and owner
  // reward writes commit atomically.
  // Handoff cleanup is temporary metadata (60-second TTL), not part of claim
  // settlement. Its failure must not turn a committed claim into an API error.
  if (handoff && handoff.postId === postId) {
    await redis.del(frenzyHandoffKey(claimantId)).catch((error: unknown) => {
      console.error('[Frenzy Claim] Handoff cleanup failed after durable claim:', error);
    });
  }
  await writeFrenzyClaimProgress(claimantId, postId, attemptId, count, processedCount, true);

  return {
    orb: bestOrb,
    batch: visibleBatch,
    totalValueGained: finalValue,
    totalRollValue: finalValue,
    coinsGained,
    shardsGained: shardsGained + (isOwner ? ownerRewardShards : 0),
    xpGained,
    state: s,
    rollsRemainingUntilNext: cooldownMs(s, false, liveBalance),
    dramaticReveal: bestOrb.rarity >= 100,
    frenzyCount: processedCount,
  };

  };
  return playerGuildScopes.get(loadedState)
    ? withGuildDataMutationLock(performClaim)
    : performClaim();
  });
}


export async function acknowledgeFrenzyOfflineReward(): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
    const s = await loadRaw();
    s.pendingFrenzyOfflineClaimCount = 0;
    s.pendingFrenzyOfflineShards = 0;
    await save(s);
    return s;
  });
}

export async function postFrenzyThankYouComment(
  text: string,
  requestedPostId: string,
): Promise<{ success: true; commentId: string; alreadyDone?: boolean }> {
  const claimantId = currentUserId();
  if (!claimantId || claimantId === 'unknown') throw new Error('Your Reddit identity is unavailable.');
  const postId = String(requestedPostId ?? '').trim();
  if (!postId) throw new Error('The claimed Frenzy post ID is missing.');

  const messageText = String(text ?? '').trim();
  if (!messageText) throw new Error('Write a thank-you comment first.');
  if (messageText.length > 500) throw new Error('Thank-you comments must be 500 characters or fewer.');

  const postRaw = await redis.get(FRENZY_POST_PREFIX + postId);
  const postData = parseStoredJson<{
    ownerId?: string;
    ownerUsername?: string;
    rarity?: number;
    createdAt?: number;
    consumedAt?: number | null;
    consumedBy?: string;
  }>(postRaw);
  const claimReceipt = await redis.get(frenzyClaimReceiptKey(postId, claimantId));
  const legacyClaimedByThisUser = postData?.consumedAt != null && postData.consumedBy === claimantId;
  if (!postData || (claimReceipt == null && !legacyClaimedByThisUser) || !postData.ownerUsername) {
    throw new Error('You can only leave a thank-you comment after you claim this Frenzy.');
  }

  const receiptKey = FRENZY_THANK_YOU_PREFIX + encodeURIComponent(postId) + ':' + encodeURIComponent(claimantId);
  const expiresAt = frenzyPostExpiresAt(Number(postData.createdAt ?? 0)) + FRENZY_POST_RECEIPT_RETENTION_MS;
  const expiration = new Date(expiresAt);
  if (!Number.isFinite(expiration.getTime()) || expiration.getTime() <= Date.now()) {
    throw new Error('The thank-you comment window has expired.');
  }

  const existingRaw = await redis.get(receiptKey);
  if (existingRaw) {
    const existing = parseStoredJson<{ status?: string; commentId?: string }>(existingRaw);
    if (existing?.status === 'posted' && existing.commentId) {
      return { success: true, commentId: existing.commentId, alreadyDone: true };
    }
    throw new Error('A thank-you comment was already attempted. Check the Frenzy post before trying again.');
  }

  const reservation = 'pending-' + secureServerToken('frenzy-thank-you');
  await redis.set(receiptKey, reservation, { nx: true, expiration });
  if (await redis.get(receiptKey) !== reservation) {
    throw new Error('A thank-you comment was already attempted. Check the Frenzy post before trying again.');
  }

  // This runs only after a separate, explicit click in the UI. It is never
  // merged with claiming the Frenzy, and Reddit attributes it to the player.
  const redditPostId = /^t3_/i.test(postId) ? postId : 't3_' + postId;
  const comment = await reddit.submitComment({
    id: redditPostId,
    text: messageText,
    runAs: 'USER',
  });
  const commentId = String(comment?.id ?? '').trim();
  if (!commentId) {
    throw new Error('Reddit did not return a comment ID. Check the Frenzy post before retrying.');
  }

  await redis.set(receiptKey, JSON.stringify({
    status: 'posted',
    commentId,
    postedAt: Date.now(),
  }), { expiration });
  return { success: true, commentId };
}


function sampleBinomial(n: number, p: number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (n < 2_000) {
    let count = 0;
    for (let i = 0; i < n; i++) if (serverRandom() < p) count++;
    return count;
  }
  const mean = n * p;
  const variance = n * p * (1 - p);
  const standardDeviation = Math.sqrt(variance);
  const u1 = Math.max(1e-12, serverRandom());
  const u2 = serverRandom();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(n, Math.round(mean + standardDeviation * gaussian)));
}

export async function activateTurbo(): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const costShards = 50;
  if (s.shards < costShards) {
    throw new Error('Turbo Roll requires 50 Shards.');
  }
  spendShards(s, costShards);
  const durationMs = (s.prestigeUpgrades?.chronoOverdrive ?? 0) > 0 ? 60 * 60 * 1000 : 30 * 60 * 1000;
  s.turboRollUntil = Math.max(Date.now(), s.turboRollUntil ?? 0) + durationMs;
  await save(s);
  return s;

  });}

export async function recordSocialVisit(s: PlayerState) {
  const today = new Date().toISOString().slice(0, 10);
  if (s.socialActivityDate === today) return;
  s.socialActivityDate = today;
  advanceQuestProgress(s, 'social', 1);
  await save(s);
}

function assertShareCooldownAvailable(s: PlayerState, now: number): void {
  if (
    s.lastShareAt != null &&
    (!Number.isSafeInteger(s.lastShareAt) || s.lastShareAt < 0)
  ) {
    throw new Error('Saved share cooldown timestamp is invalid; refresh before sharing again.');
  }
  if (s.lastShareAt != null && now - s.lastShareAt < 30_000) {
    throw new Error('Please wait before sharing another orb.');
  }
}

/**
 * Reserve the 30-second share cooldown before creating the irreversible Reddit
 * post. If Reddit accepts a post but the request response is lost, a retry is
 * blocked by this durable timestamp instead of publishing a duplicate.
 */
export async function reserveShareCooldown(s: PlayerState): Promise<void> {
  const now = Date.now();
  assertShareCooldownAvailable(s, now);
  s.lastShareAt = now;
  await save(s);
}

/** Record quest progress after the external share succeeds. */
export async function recordShareQuestProgress(s: PlayerState): Promise<void> {
  advanceQuestProgress(s, 'share', 1);
  await save(s);
  if (!s.riftSession) void recordLeaderboard(s).catch(error => {
    console.error('[Leaderboard] Share update failed:', error);
  });
}

// Retained for compatibility with any non-route caller that needs a single
// player-state mutation rather than the two-phase external-share sequence.
export async function recordShareAction(s: PlayerState) {
  const now = Date.now();
  assertShareCooldownAvailable(s, now);
  s.lastShareAt = now;
  advanceQuestProgress(s, 'share', 1);
  await save(s);
  if (!s.riftSession) void recordLeaderboard(s).catch(error => {
    console.error('[Leaderboard] Share update failed:', error);
  });
}
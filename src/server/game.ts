import { redis, context, reddit } from './devvit-mock.js';
import { getActivePlayerMutationLock, withPlayerMutationLock, withPlayerMutationLockFor } from './player-lock.js';
import * as notificationsModule from '@devvit/notifications';

const notifications = (notificationsModule as any).notifications;
import { APP_VERSION } from '../shared/version.js';
import { combatRuneBonuses, combatRuneLuckMultiplier, combatRuneMajorAbilityEffects, undercryptOrbLuckMultiplier } from '../shared/combat.js';
import {
  createInitialState,
  type PlayerState,
  type QuestItem,
  type RollResponse,
  type UpgradeId,
  type PrestigeUpgradeId,
  type Orb,
  AUTO_UNLOCK_COST,
  AUTO_BUYER_COIN_RESERVE,
  SHARD_SYNTHESIS_COST,
  roundShardAmount,
  resolveShardPityReward,
  SHARD_PITY_ROLLS_TO_REWARD,
  PRESTIGE_UPGRADES,
  cooldownMs,
  rollsPerActivation,
  luckMultiplier,
  upgradeCost,
  prestigeUpgradeCost,
  calculatePrestigeDust,
  addCollectionValue,
  offlineRollCap,
  getOrbInfo,
  formatRarity,
  createInitialDailyQuests,
  createInitialWeeklyQuests,
  rollContinuum,
  coinsForRarity,
  MAX_OFFLINE_ROLLS,
  OFFLINE_TICK_MS,
  calculateCosmicDust,
  MAX_COSMIC_DUST,
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
  frenzyClaimCountForRarity,
  grantFrenzyOwnerShards,
  FRENZY_OWNER_SHARD_REWARD,
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
  highestCodexChain,
  recordRollingSessionActivity,
  nextCodexChainRarity,
  chainPatcherShardCost,
  CHAIN_PATCHER_COOLDOWN_MS,
  codexDevotionLuckPercent,
  altarCoinDevotionChancePercent,
  altarCoinFloor,
  MAX_ORB_RARITY,
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
  /** For a Guild write conflict, refund withheld tax and skip only the Guild projection. */
  onConflict?: () => void | Promise<void>;
}

type SavePostCommitAction = () => Promise<void>;

const playerGuildScopes = new WeakMap<PlayerState, string | null>();
const pendingSaveExtraWrites = new WeakMap<PlayerState, SaveExtraWrite[]>();
const pendingSavePostCommitActions = new WeakMap<PlayerState, SavePostCommitAction[]>();

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
const GAME_BANS_KEY = 'io:game-bans';
const ONLINE_PLAYERS_KEY = 'io:online:players';
const CCU_HOURLY_PREFIX = 'io:ccu:hour:';
const CCU_ALL_TIME_KEY = 'io:ccu:all-time';
const FAKE_CCU_KEY_PREFIX = 'io:fake-ccu:';
const SAVE_GENERATION_KEY_PREFIX = 'player-generation:';
const PLAYER_REGISTRY_KEY = 'io:player-registry';
const DEVELOPER_ANNOUNCEMENT_KEY = 'io:developer-announcement';
const GLOBAL_BOOSTER_ANNOUNCEMENT_KEY = 'io:global-booster-announcement';
const OFFLINE_FULL_NOTIFICATION_PREFIX = 'io:offline-full-notified:';
const OFFLINE_FULL_JOB_PREFIX = 'io:offline-full-job:';
const OFFLINE_FULL_RETRY_MS = 5 * 60_000;
const OFFLINE_FULL_RESERVATION_TTL_MS = 60_000;
const OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS = 7 * 24 * 60 * 60_000;
const PLAYER_FLAIR_KEY_PREFIX = 'io:player-flair:';
const ROLL_TICKET_KEY_PREFIX = 'io:roll-ticket:';
const ROLL_TICKET_COUNT = 30;
const ROLL_TICKET_TTL_MS = 10 * 60_000;
const PLAYER_SPY_LOG_KEY_PREFIX = 'io:player-spy:v1:';
const PLAYER_SPY_LOG_LIMIT = 500;
const FOLLOW_SUBSCRIBED_KEY_PREFIX = 'io:follow-prompt-subscribed:v2:';
const FOLLOW_REWARD_KEY_PREFIX = 'io:follow-prompt-reward:v1:';
const FOLLOW_ACTION_COUNT_KEY = 'io:follow-prompt-actions:v2';
const FOLLOW_REWARD_ROLLS = 200;
const FOLLOW_TARGET_SUBREDDIT = 'infinityorbs';

const SAVE_DEBUG_LOG_KEY = 'io:save-debug:v1';
const SAVE_DEBUG_LOG_LIMIT = 500;

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
      if (entries.length > SAVE_DEBUG_LOG_LIMIT) {
        entries = entries.slice(-SAVE_DEBUG_LOG_LIMIT);
      }

      await txn.multi();
      await txn.set(SAVE_DEBUG_LOG_KEY, JSON.stringify(entries));
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
      if (entries.length > PLAYER_SPY_LOG_LIMIT) {
        entries = entries.slice(-PLAYER_SPY_LOG_LIMIT);
      }

      await txn.multi();
      await txn.set(logKey, JSON.stringify(entries));
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
const PAYMENT_DEBUG_LOG_LIMIT = 200;

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
      if (entries.length > PAYMENT_DEBUG_LOG_LIMIT) {
        entries = entries.slice(-PAYMENT_DEBUG_LOG_LIMIT);
      }

      await txn.multi();
      await txn.set(PAYMENT_DEBUG_LOG_KEY, JSON.stringify(entries));
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
  await redis.set(PAYMENT_DEBUG_LOG_KEY, JSON.stringify([]));
}

const GLOBAL_BOOSTERS_KEY = 'io:global-boosters:v4';
const GLOBAL_BOOSTER_DEBUG_LOG_KEY = 'io:global-booster-debug-log:v1';
const GLOBAL_BOOSTER_DEBUG_LOG_LIMIT = 300;

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
      if (entries.length > GLOBAL_BOOSTER_DEBUG_LOG_LIMIT) {
        entries = entries.slice(-GLOBAL_BOOSTER_DEBUG_LOG_LIMIT);
      }

      await txn.multi();
      await txn.set(GLOBAL_BOOSTER_DEBUG_LOG_KEY, JSON.stringify(entries));
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
  await redis.set(GLOBAL_BOOSTER_DEBUG_LOG_KEY, JSON.stringify([]));
}

const GLOBAL_BOOSTER_ACTIVATION_LOG_KEY = 'io:global-booster-activation-log:v1';
const GLOBAL_BOOSTER_ACTIVATION_LOG_LIMIT = 500;

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
      if (entries.length > GLOBAL_BOOSTER_ACTIVATION_LOG_LIMIT) {
        entries = entries.slice(-GLOBAL_BOOSTER_ACTIVATION_LOG_LIMIT);
      }

      await txn.multi();
      await txn.set(GLOBAL_BOOSTER_ACTIVATION_LOG_KEY, JSON.stringify(entries));
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
  await redis.set(GLOBAL_BOOSTER_ACTIVATION_LOG_KEY, JSON.stringify([]));
}
export interface DeveloperAnnouncement {
  message: string;
  updatedAt: number;
  updatedBy: string;
}
export const DEFAULT_DEVELOPER_ANNOUNCEMENT = '';

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

export interface GameBanRecord {
  userId: string;
  username: string;
  bannedAt: number;
  bannedUntil: number | null;
  reason: string;
  bannedBy: string;
}

export interface GameBanStatus extends GameBanRecord {
  active: true;
}

function parseStoredJson<T>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
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

function parseGameBanRegistry(raw: unknown): Record<string, GameBanRecord> {
  if (raw == null) return Object.create(null) as Record<string, GameBanRecord>;
  const parsed = parseStoredJson<unknown>(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Game ban list could not be read safely. No changes were applied.');
  }

  const bans = Object.create(null) as Record<string, GameBanRecord>;
  for (const [keyName, value] of Object.entries(parsed)) {
    if (
      !keyName ||
      !value || typeof value !== 'object' || Array.isArray(value) ||
      typeof (value as any).userId !== 'string' ||
      (value as any).userId.trim() !== keyName ||
      typeof (value as any).username !== 'string' ||
      !(value as any).username.trim() ||
      !Number.isSafeInteger((value as any).bannedAt) ||
      Number((value as any).bannedAt) < 0 ||
      !(
        (value as any).bannedUntil === null ||
        (
          Number.isSafeInteger((value as any).bannedUntil) &&
          Number((value as any).bannedUntil) > Number((value as any).bannedAt)
        )
      ) ||
      typeof (value as any).reason !== 'string' ||
      typeof (value as any).bannedBy !== 'string'
    ) {
      throw new Error('Game ban list contains a malformed record. No changes were applied.');
    }
    bans[keyName] = value as GameBanRecord;
  }
  return bans;
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
  const now = Date.now();
  return mutateGameBans(bans => {
    const ban = bans[userId];
    if (!ban) return { changed: false, result: null };
    if (ban.bannedUntil !== null && ban.bannedUntil <= now) {
      delete bans[userId];
      return { changed: true, result: null };
    }
    return { changed: false, result: { ...ban, active: true } };
  });
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
    throw new Error('Enable Reddit notifications first, then run the push test.');
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

export async function getNotificationState(userId = currentUserId()): Promise<boolean> {
  const id = String(userId ?? '').trim();
  if (!id) return false;
  return notifications.isOptedIn(id);
}

export async function setNotificationState(enabled: boolean): Promise<boolean> {
  if (enabled) {
    await notifications.optInCurrentUser();
  } else {
    await notifications.optOutCurrentUser();
  }
  return notifications.isOptedIn(currentUserId());
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
const FRENZY_THANK_YOU_PREFIX = 'io:frenzy:thank-you:';

function frenzyHandoffKey(userId: string): string {
  return FRENZY_HANDOFF_PREFIX + userId;
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
    const raw = await redis.get(FRENZY_POST_PREFIX + postId);
    if (!raw) throw new Error('This is not an Orb Frenzy post.');
    const data = parseFrenzyPostRecord(raw);
    if (!data || data.inGame !== true) throw new Error('This is not an Orb Frenzy post.');

    const s = await settleOffline(await loadRaw());
    const now = Date.now();
    if (isFrenzyPostRecordExpired(data, now)) throw new Error('This Frenzy has expired.');
    const claimCooldown = frenzyClaimCooldownRemaining(s.lastFrenzyClaimAt, now);
    const isOwner = data.ownerId === currentUserId();
    const selfClaimTest =
      isOwner &&
      data.adminTest === true &&
      isFrenzyTestAdmin(s.username);

    if (isOwner && !selfClaimTest) throw new Error('You cannot claim your own Orb Frenzy.');
    if (claimCooldown > 0 && !selfClaimTest) {
      throw new Error('Frenzy claim is on cooldown for ' + Math.ceil(claimCooldown / 1000) + ' more seconds.');
    }

    const handoffExpiresAt = Date.now() + FRENZY_HANDOFF_TTL_MS;
    await redis.set(frenzyHandoffKey(currentUserId()), JSON.stringify({
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

async function prepareFrenzyOwnerRewardWrites(
  ownerId: string,
  amount = FRENZY_OWNER_SHARD_REWARD,
): Promise<{ granted: number; writes: SaveExtraWrite[] }> {
  const safeOwnerId = String(ownerId ?? '').trim();
  if (!safeOwnerId || safeOwnerId === 'unknown') {
    throw new Error('Frenzy owner identity is missing; the claim was not consumed.');
  }

  const ownerKey = playerKeyFor(safeOwnerId);
  const ownerGenerationKey = saveGenerationKeyFor(safeOwnerId);
  const [raw, generationRaw] = await Promise.all([
    redis.get(ownerKey),
    redis.get(ownerGenerationKey),
  ]);
  if (raw == null) throw new Error('Frenzy owner save was not found.');
  const ownerState = parsePlayerStateValue(raw);
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
        const previousActivityAt = Math.max(
          validPastTimestamp(existing.lastActivityAt, activityNow),
          validPastTimestamp(existing.lastSeenAt, activityNow),
        );
        const previousPlaytimeMs = existing.playtimeMs ?? 0;
        const activityDelta = previousActivityAt > 0
          ? Math.min(PLAYTIME_ACTIVE_GAP_MS, Math.max(0, activityNow - previousActivityAt))
          : 0;
        playtimeMs = Math.min(Number.MAX_SAFE_INTEGER, previousPlaytimeMs + activityDelta);
        const existingLastLoginAt = validPastTimestamp(existing.lastLoginAt, activityNow);
        if (
          previousActivityAt > 0 &&
          activityNow - previousActivityAt <= PLAYTIME_ACTIVE_GAP_MS &&
          existingLastLoginAt > 0
        ) {
          lastLoginAt = existingLastLoginAt;
        }
      }

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
}

export async function listPlayers(): Promise<PlayerListEntry[]> {
  const rawRegistry = await redis.hGetAll(PLAYER_REGISTRY_KEY);
  const records = rawRegistry && typeof rawRegistry === 'object' ? rawRegistry as Record<string, string> : {};
  const userIds = Object.keys(records);
  if (userIds.length === 0) return [];

  const now = Date.now();
  const saves = await redis.mGet(userIds.map(id => playerKeyFor(id)));
  const players = userIds.map((userId, index) => {
    const registry = parseStoredJson<Partial<PlayerRegistryEntry>>(records[userId]) ?? {};
    const save = saves[index] ? parseStoredJson<Partial<PlayerState>>(saves[index]) : null;
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
      username: String(registry.username ?? save?.username ?? ('user-' + userId.slice(-8))).trim().slice(0, 100),
      firstSeenAt: validPastTimestamp(registry.firstSeenAt, now),
      lastSeenAt,
      active: lastSeenAt >= now - PLAYER_ACTIVE_WINDOW_MS,
      level: Math.max(1, Number(save?.level ?? 1) || 1),
      xp: Math.max(0, Number(save?.xp ?? 0) || 0),
      playtimeMs: Math.max(0, Number(registry.playtimeMs ?? 0) || 0),
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
    } satisfies PlayerListEntry;
  });
  players.sort((a, b) => Number(b.active) - Number(a.active) || b.lastSeenAt - a.lastSeenAt || a.username.localeCompare(b.username));
  return players;
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
    return Number.isFinite(numericRarity) &&
      Number.isInteger(numericRarity) && numericRarity >= 2 &&
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
    while (level < 256) {
      const cost = upgradeCost(id, level);
      if (!Number.isFinite(cost) || cost > Number.MAX_SAFE_INTEGER) break;
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
      Number.isSafeInteger(quest.rewardCoins) && Number(quest.rewardCoins) >= 0 &&
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
      Math.abs(record.shards * 1_000 - Math.round(record.shards * 1_000)) < 1e-6 &&
      Number.isSafeInteger(record.totalRolls) &&
      Number(record.totalRolls) >= 0 &&
      (
        record.stateRevision == null ||
        (Number.isSafeInteger(record.stateRevision) && Number(record.stateRevision) >= 0)
      );
    if (!validCoreState) return null;
    // A corrupt offline vault is recoverable progress data, not a reason to brick
    // the whole account save. Normalize it before any caller can process a batch.
    const normalizedRecord = {
      ...record,
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
        shardPityRolls: Math.min(SHARD_PITY_ROLLS_TO_REWARD - 1, finiteNonNegativeInteger(record.shardPityRolls, 0)),
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
    return parsePaymentPlayerState(await redis.get(playerKeyFor(id))) !== null;
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
    const raw = await redis.get(pkey);
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

    await txn.multi();
    await txn.set(pkey, JSON.stringify(state));
    const committed = await txn.exec();
    if (committed !== null) {
      await appendPaymentDebugLog('grant:success', {
        userId,
        sku,
        orderId,
        attempt,
        committed: true,
      });
      return true;
    }

    await appendPaymentDebugLog('grant:write-conflict', {
      userId,
      sku,
      orderId,
      attempt,
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
      const raw = await redis.get(pkey);
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

      await txn.multi();
      await txn.set(pkey, JSON.stringify(state));
      const committed = await txn.exec();
      if (committed !== null) return;
    }

    throw new Error('Could not safely process the refund.');
  });
}
export async function loadRaw(options: { registerActivity?: boolean } = {}): Promise<PlayerState> {
  const userId = currentUserId();
  const playerKey = key();
  const generationKey = saveGenerationKeyFor(userId);
  const generationRaw = await redis.get(generationKey);
  const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
  const raw = await redis.get(playerKey);
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
          comboRank: 0, guildXpRank: 0,
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
    fresh.guildPerks = perks;
    fresh.guildCombo = guildCombo;
    fresh.globalBoosters = globalBoosters;
    fresh.dailyStreakCommunity = dailyStreakCommunity;
    playerGuildScopes.set(fresh, guildId);

    return fresh;
  }

  const base = createInitialState();
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

  const parsedLevel = Math.max(1, Math.min(1000, Math.floor(Number(parsed.level ?? 1) || 1)));
  const parsedXp = Math.max(0, Number(parsed.xp ?? 0) || 0);
  const calculatedLevel = calculateLevelFromXp(parsedXp).level;
  const storedLevelXpFloor = Number(parsed.levelXpFloor);
  const levelXpFloor = Number.isFinite(storedLevelXpFloor)
    ? Math.max(0, Math.min(parsedXp, storedLevelXpFloor))
    : parsedLevel > calculatedLevel
      ? parsedXp
      : totalXpRequiredBeforeLevel(parsedLevel);

  const restored: PlayerState = {
    ...base,
    ...cleanParsed,
    coins: finiteNonNegativeInteger(parsed.coins),
    lifetimeCoins: finiteNonNegativeInteger(parsed.lifetimeCoins ?? parsed.coins),
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
    lastShareAt: normalizeCooldownTimestamp(parsed.lastShareAt, base.lastShareAt ?? 0),
    level: parsedLevel,
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
    shardPityRolls: Math.min(SHARD_PITY_ROLLS_TO_REWARD - 1, finiteNonNegativeInteger(parsed.shardPityRolls, 0)),
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
    collection: isValidCollection(parsed.collection) ? parsed.collection : base.collection,
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
    },
    masterySkills: normalizedMasterySkills,
    guildPerks: perks,
    guildCombo,
    globalBoosters,
    dailyStreakCommunity,
  };
  // Cosmic Dust has a lower game-specific cap than the shared safe-integer guard.
  restored.cosmicDust = Math.min(MAX_COSMIC_DUST, restored.cosmicDust);
  playerGuildScopes.set(restored, guildId);
  // One-time migration: persist the new hard cap instead of only clamping its read view.
  if (finiteNonNegativeInteger(parsed.cosmicDust, base.cosmicDust) > MAX_COSMIC_DUST) {
    try {
      await save(restored);
    } catch (error) {
      console.error('[Prestige] Cosmic Dust cap migration will retry on next load.', error);
    }
  }
  return restored;
}

function applyXp(s: PlayerState, amount: number): void {
  s.xp += Math.max(0, Math.floor(amount));
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

  // Prepare/validate the shared event before touching player rewards. If this
  // separate shared record is corrupt or out of range, the attempt must leave
  // the local streak, Shards, Coins and free rolls untouched.
  const communityUpdate = await prepareDailyStreakCommunityProgress(nextStreakCount);
  stageSaveExtraWrite(s, {
    key: communityUpdate.key,
    expectedValue: communityUpdate.expectedValue,
    nextValue: communityUpdate.nextValue,
    conflictMessage: 'Daily Streak community progress changed while claiming. Please retry.',
  });

  const day = ((nextStreakCount - 1) % 7) + 1;
  const rewardCoins = day * 100;
  const rewardShards = grantFreeShards(s, day === 7 ? 5 : day === 3 ? 1 : 0);
  const rewardFreeRolls = day * 5;

  s.streak.count = nextStreakCount;
  s.streak.longestStreak = Math.max(previousLongest, nextStreakCount);
  s.streak.lastClaimDate = today;
  s.freeRolls = (s.freeRolls ?? 0) + rewardFreeRolls;
  addCoins(s, rewardCoins);
  s.dailyStreakCommunity = communityUpdate.event;
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
    s.offlineRolls = 0;
    if (batches > 0) await applyRolls(s, batches, undefined, 'offline');
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
        const tickMs = effectiveOfflineTickMs(s);
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

async function syncRarityFlair(s: PlayerState): Promise<void> {
  const userId = currentUserId();
  const subredditName = String(context.subredditName ?? '').trim();
  if (!userId || !subredditName) return;

  // Saves schedule this as best-effort post-commit work. Serialize the external
  // flair side effect separately from the player lock, then base every write on
  // the newest durable state rather than whichever save happened to finish last.
  await withPlayerMutationLockFor('flair:' + userId, async () => {
    const flairKey = PLAYER_FLAIR_KEY_PREFIX + userId;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const raw = await redis.get(playerKeyFor(userId));
      const latest = raw == null ? null : parsePlayerStateValue(raw);
      const source = latest ?? s;
      const username = String(context.username ?? source.username ?? '').trim();
      if (!username) return;

      const highestRarity = Math.max(2, Math.floor(Number(source.highestRarity ?? 2) || 2));
      const orbInfo = getOrbInfo(highestRarity, source.highestRarityIsInfinity === true);
      const flairText = orbInfo.tier;
      const backgroundColor = orbInfo.color;
      const textColor = flairTextColorForBackground(backgroundColor);
      const flairState = JSON.stringify({ text: flairText, backgroundColor, textColor });
      const current = await redis.get(flairKey);
      if (String(current ?? '') === flairState) return;

      await reddit.setUserFlair({
        subredditName,
        username,
        text: flairText,
        backgroundColor,
        textColor,
      });

      // A newer save may have committed while Reddit was processing the update.
      // Re-read before caching; if it changed, retry under the same flair lock.
      const afterRaw = await redis.get(playerKeyFor(userId));
      const after = afterRaw == null ? null : parsePlayerStateValue(afterRaw);
      const afterRarity = Math.max(2, Math.floor(Number(after?.highestRarity ?? source.highestRarity ?? 2) || 2));
      const afterOrb = getOrbInfo(afterRarity, (after?.highestRarityIsInfinity ?? source.highestRarityIsInfinity) === true);
      const afterState = JSON.stringify({
        text: afterOrb.tier,
        backgroundColor: afterOrb.color,
        textColor: flairTextColorForBackground(afterOrb.color),
      });
      if (afterState === flairState) {
        await redis.set(flairKey, flairState);
        return;
      }
    }

    // Do not cache a stale result. A later committed save will retry the sync.
    console.error('[Rarity Flair] Player rarity kept changing during flair sync; leaving cache untouched.');
  }).catch(error => {
    console.error('[Rarity Flair] Failed to update user flair:', error);
  });
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
}

function rollTicketKey(userId = currentUserId()): string {
  return ROLL_TICKET_KEY_PREFIX + userId;
}

function randomUint32(): number {
  const sample = new Uint32Array(1);
  globalThis.crypto.getRandomValues(sample);
  return sample[0];
}

export async function getRollTicket(): Promise<{
  ticketId: string;
  nextIndex: number;
  rollsRemaining: number;
  expiresAt: number;
}> {
  const ticketKey = rollTicketKey();
  const now = Date.now();

  for (let attempt = 0; attempt < 4; attempt++) {
    const txn = await redis.watch(ticketKey);
    let transactionClosed = false;
    try {
    const raw = await redis.get(ticketKey);
    const current = parseStoredJson<RollTicket>(raw);

    if (
      current &&
      typeof current.id === 'string' &&
      current.id.length > 0 &&
      current.id.length <= 128 &&
      Number.isSafeInteger(current.nextIndex) &&
      current.nextIndex >= 0 &&
      current.nextIndex < ROLL_TICKET_COUNT &&
      Number.isSafeInteger(current.expiresAt) &&
      current.expiresAt > now
    ) {
      await txn.unwatch();
      transactionClosed = true;
      return {
        ticketId: current.id,
        nextIndex: current.nextIndex,
        rollsRemaining: ROLL_TICKET_COUNT - current.nextIndex,
        expiresAt: current.expiresAt,
      };
    }

    const ticket: RollTicket = {
      id: `rt-${now.toString(36)}-${randomUint32().toString(36)}`,
      nextIndex: 0,
      expiresAt: now + ROLL_TICKET_TTL_MS,
    };

    await txn.multi();
    await txn.set(ticketKey, JSON.stringify(ticket));
    const committed = await txn.exec();
    transactionClosed = true;
    if (committed !== null) {
      return {
        ticketId: ticket.id,
        nextIndex: 0,
        rollsRemaining: ROLL_TICKET_COUNT,
        expiresAt: ticket.expiresAt,
      };
    }
    } finally {
      if (!transactionClosed) {
        await txn.unwatch().catch(() => undefined);
      }
    }
  }

  throw new Error('Could not create a roll prediction ticket. Please retry.');
}

async function loadRollTicketForUse(
  ticketId: string,
  ticketIndex: number,
): Promise<{ ticket: RollTicket; raw: string }> {
  const raw = await redis.get(rollTicketKey());
  const ticket = parseStoredJson<RollTicket>(raw);

  if (!raw || !ticket) throw new Error('Roll prediction ticket is unavailable. Refresh the game.');
  if (
    typeof ticket.id !== 'string' || !ticket.id ||
    !Number.isSafeInteger(ticket.nextIndex) ||
    !Number.isSafeInteger(ticket.expiresAt)
  ) {
    throw new Error('Roll prediction ticket data is corrupted. Refresh the game.');
  }
  if (ticket.id !== ticketId) throw new Error('Roll prediction ticket is stale. Refresh the game.');
  if (ticket.expiresAt <= Date.now()) throw new Error('Roll prediction ticket expired. Refresh the game.');
  if (ticketIndex !== ticket.nextIndex) throw new Error('Roll prediction ticket is out of order. Refresh the game.');
  if (ticketIndex < 0 || ticketIndex >= ROLL_TICKET_COUNT) {
    throw new Error('Roll prediction ticket is exhausted. Refresh the game.');
  }

  return { ticket, raw };
}

async function commitOptionalSaveProjection(write: SaveExtraWrite): Promise<void> {
  const txn = await redis.watch(write.key);
  let transactionClosed = false;
  try {
    const current = await redis.get(write.key);
    const actual = current == null ? null : String(current);
    if (actual !== write.expectedValue) {
      await txn.unwatch();
      transactionClosed = true;
      console.error('[Player Save] Optional projection changed; skipped without affecting player state.', write.key);
      return;
    }

    await txn.multi();
    if (write.expiration) {
      await txn.set(write.key, write.nextValue, { expiration: write.expiration });
    } else {
      await txn.set(write.key, write.nextValue);
    }
    const committed = await txn.exec();
    transactionClosed = true;
    if (committed === null) {
      console.error('[Player Save] Optional projection conflicted at commit; skipped without affecting player state.', write.key);
    }
  } finally {
    if (!transactionClosed) {
      await txn.unwatch().catch(() => undefined);
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
  s.coins = finiteNonNegativeInteger(s.coins);
  s.lifetimeCoins = finiteNonNegativeInteger(s.lifetimeCoins ?? s.coins);
  const explicitWrites = extraWrite
    ? Array.isArray(extraWrite) ? extraWrite : [extraWrite]
    : [];
  const allExtraWrites = [
    ...(pendingSaveExtraWrites.get(s) ?? []),
    ...explicitWrites,
  ];
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
    const watchedKeys = [...new Set([
      playerKey,
      generationKey,
      ...extraWrites.map(write => write.key),
      ...activeLocks.map(item => item.key),
    ])];
    const txn = await redis.watch(...watchedKeys);
    let transactionClosed = false;
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
      const currentRaw = await redis.get(playerKey);
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

    const latest = latestRaw == null ? null : parsePlayerStateValue(latestRaw);
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
    await txn.multi();
    await txn.set(playerKey, JSON.stringify(nextState));
    for (const write of extraWrites) {
      if (write.expiration) {
        await txn.set(write.key, write.nextValue, { expiration: write.expiration });
      } else {
        await txn.set(write.key, write.nextValue);
      }
    }
    const committed = await txn.exec();
    transactionClosed = true;
    if (committed !== null) {
      pendingSaveExtraWrites.delete(s);
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
      if (!transactionClosed) {
        await txn.unwatch().catch(() => undefined);
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
  const currentCoins = finiteNonNegativeInteger(s.coins);
  const requestedGain = finiteNonNegativeInteger(amount);
  const gain = Math.min(requestedGain, Number.MAX_SAFE_INTEGER - currentCoins);
  s.coins = currentCoins + gain;
  const lifetimeCoins = finiteNonNegativeInteger(s.lifetimeCoins ?? currentCoins);
  s.lifetimeCoins = Math.min(Number.MAX_SAFE_INTEGER, lifetimeCoins + gain);
  return gain;
}


function advanceQuestProgress(s: PlayerState, type: 'roll' | 'rare' | 'value' | 'unique' | 'social' | 'share', amount: number) {
  for (const q of s.dailyQuests) {
    if (q.claimed) continue;
    if (type === 'roll' && q.id.includes('rolls')) q.progress = Math.min(q.target, q.progress + amount);
    if (type === 'rare' && q.id.includes('rare') && amount >= 100) q.progress = Math.min(q.target, q.progress + 1);
    if (type === 'unique' && q.id.includes('unique')) q.progress = Math.min(q.target, q.progress + Math.max(0, amount));
    if (type === 'social' && q.id.includes('social')) q.progress = Math.min(q.target, q.progress + 1);
  }
  for (const q of s.weeklyQuests) {
    if (type === 'rare' && amount >= 100) {
      const shareQuest = s.weeklyQuests.find(weekly => weekly.id === 'weekly-share');
      if (shareQuest) shareQuest.unlocked = true;
    }
    if (q.unlocked === false) continue;
    if (q.claimed) continue;
    if (type === 'roll' && q.id.includes('grind')) q.progress = Math.min(q.target, q.progress + amount);
    if (type === 'rare' && q.id.includes('epic') && amount >= 1000) q.progress = Math.min(q.target, q.progress + 1);
    if (type === 'value' && q.id.includes('guild')) q.progress = Math.min(q.target, q.progress + amount);
    // Only a genuine server-created share advances the share quest.
    if (type === 'share' && q.id.includes('share')) q.progress = Math.min(q.target, q.progress + 1);
  }
}

function checkPeriodicResets(s: PlayerState, now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (s.lastDailyReset !== today) {
    s.dailyQuests = createInitialDailyQuests();
    s.lastDailyReset = today;
  }
  const currentWeek = weekKey(now);
  const lastWeek = s.lastWeeklyReset ? weekKey(new Date(s.lastWeeklyReset).getTime()) : -1;
  if (currentWeek !== lastWeek) {
    s.weeklyQuests = createInitialWeeklyQuests();
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
    guildComboCritChanceBonus(s.guildCombo),
  );
}

export async function applyRolls(
  s: PlayerState,
  activationCount = 1,
  forcedRarity?: number,
  source: 'online' | 'offline' = 'online',
  rollCountOverride?: number,
  randomOverride?: () => number,
  exactRarity = false,
): Promise<{ bestOrb: Orb; batch: Orb[]; totalVal: number; coinsGained: number; shardsGained: number; xpGained: number; rollCount: number }> {
  let bestRarity = 0;
  let bestIsCrit = false;
  let bestIsNew = false;
  let bestIsInfinity = false;
  let totalVal = 0;
  let coinsGained = 0;
  let shardsGained = 0;
  let xpGained = 0;
  let uniqueGained = 0;
  const batch: Orb[] = [];
  const rarities: number[] = [];
  let rollCount = rollCountOverride ?? (rollsPerActivation(s) * activationCount);
  const now = Date.now();
  const spyUserId = currentUserId();
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

  // Astral Magnetism proc: chance for multi-rolls to pull 2 bonus orbs
  const magnetLevel = s.prestigeUpgrades?.stellarMagnet ?? 0;
  if (rollCount > 1 && magnetLevel > 0 && rng() < 0.10 * magnetLevel) {
    rollCount += 2;
  }
  const baseBatchRollCount = rollCount;

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
  const maxSupportedRollCount = offlineRollCap(s) * rollsPerActivation(s) + 2;
  if (!Number.isSafeInteger(maxSupportedRollCount) || rollCount > maxSupportedRollCount) {
    throw new Error('Roll batch exceeds the supported processing cap; no rolls were processed.');
  }

  // These reads are independent. Keep them parallel so a roll does not spend
  // several sequential Redis round trips before it can even start rolling.
  const [freshGlobalBoosters, worldEvent, fakeCcuBonus, combatStateRaw] = await Promise.all([
    getGlobalBoosters(),
    getCommunityEvent().catch(error => {
      // The shared World Event is a bonus/progress feature, not a prerequisite
      // for ordinary roll rewards. Keep corrupted/unavailable event data intact,
      // but don't brick a player's roll because an admin-maintained side record
      // could not be read.
      console.error('[Community Event] Read failed; rolling without the event bonus.', error);
      return null;
    }),
    getFakeCcuBonus(),
    redis.get('infinity-orbs:combat:' + spyUserId).catch((error: unknown) => {
      // Combat progression is an optional cross-mode bonus. A transient failure
      // to read it must never prevent a normal orb roll.
      console.error('[Undercrypt Resonance] Read failed; rolling without the bonus.', error);
      return null;
    }),
  ]);
  s.globalBoosters = freshGlobalBoosters;
  const globalBoosters = s.globalBoosters;
  const communityLuck = worldEvent?.buffMultiplier ?? 1;
  let combatBestDepth = 1;
  let runeBonuses = combatRuneBonuses([], []);
  let runeAbilityEffects = combatRuneMajorAbilityEffects([], []);
  if (typeof combatStateRaw === 'string') {
    try {
      const parsed = JSON.parse(combatStateRaw) as { bestDepth?: unknown; dungeonId?: unknown; dungeonBestDepths?: { undercrypt?: unknown }; runes?: unknown; equippedRunes?: unknown };
      const savedUndercryptDepth = Number(parsed?.dungeonBestDepths?.undercrypt);
      const legacyBestDepth = Number(parsed?.bestDepth);
      if (Number.isSafeInteger(savedUndercryptDepth) && savedUndercryptDepth > 0) {
        combatBestDepth = savedUndercryptDepth;
      } else if (
        parsed?.dungeonId === 'undercrypt' ||
        parsed?.dungeonId == null
      ) {
        // Legacy saves without dungeonId/dungeonBestDepths represented Undercrypt progress
        // using bestDepth. Accept only a safe positive integer; malformed JSON stays neutral.
        combatBestDepth = Number.isSafeInteger(legacyBestDepth) && legacyBestDepth > 0
          ? legacyBestDepth
          : 1;
      } else {
        combatBestDepth = 1;
      }
      runeBonuses = combatRuneBonuses(parsed?.runes, parsed?.equippedRunes);
      runeAbilityEffects = combatRuneMajorAbilityEffects(parsed?.runes, parsed?.equippedRunes);
    } catch {
      // Ignore invalid optional combat state and preserve ordinary orb luck.
    }
  }
  const undercryptLuck = undercryptOrbLuckMultiplier(combatBestDepth);

  // Fake CCU is an admin testing offset applied only to this player's luck calculation.
  // The underlying CCU metric and historical peaks always remain based on real players.
  const luckCcu = Math.max(1, Math.floor((s.onlinePlayers ?? 1) + fakeCcuBonus));
  const luckState = luckCcu === (s.onlinePlayers ?? 1) ? s : { ...s, onlinePlayers: luckCcu };
  // Community Luck is another additive source, kept transient rather than persisted.
  // Cleared Crypt Wardens permanently improve main-game orb Luck without
  // touching the core player save: 1% per boss, capped at a 25% multiplier.
  // Ordinary game Luck continues to use the normal distribution curve. Rune Luck is an explicit
  // rarity multiplier so a 10x Rune really does multiply the rolled rarity by about 10.
  const baseLuckCandidate = (luckMultiplier(luckState) + Math.max(0, communityLuck - 1)) * undercryptLuck;
  const baseLuck = Number.isFinite(baseLuckCandidate) ? Math.max(1, baseLuckCandidate) : Number.MAX_VALUE;
  const runeLuckMultiplier = combatRuneLuckMultiplier(runeBonuses.luckPct);

  // Apex Fortune Mastery: chance on multi-roll to double the luck of that activation
  const apexChance = Math.min(0.45, (s.masterySkills?.apexFortune ?? 0) * 0.03);
  const isApex = rollCount > 1 && rng() < apexChance;
  const effectiveLuck = isApex ? Math.min(Number.MAX_VALUE, baseLuck * 2) : baseLuck;

  const cm = critMultiplier(s);
  const levelBenefits = getLevelBenefits(s.level || 1);
  const valueMul =
    1 +
    (s.upgrades.valueBonus ?? 0) * 0.10 +
    (s.prestigeUpgrades?.cosmicValuation ?? 0) * 0.05;

  const effectiveCritChance = effectiveRollCritChance(s, globalBoosters);
  // Rune bonus rolls are bounded per activation and never exceed the existing server batch cap.
  const runeBonusRollBudget = Math.max(0, Math.min(
    50,
    maxSupportedRollCount - baseBatchRollCount,
    Number.MAX_SAFE_INTEGER - s.totalRolls - baseBatchRollCount,
  ));
  let runeBonusRollsUsed = 0;
  const runeBonusRollSpecs: { minRarity?: number; echoDepth?: number; echoOnly?: boolean; skipAllProcs?: boolean }[] = [];
  const addRuneBonusRolls = (
    requestedCount: number,
    spec: { minRarity?: number; echoDepth?: number; echoOnly?: boolean; skipAllProcs?: boolean },
  ): number => {
    const requested = Number.isFinite(requestedCount) ? Math.max(0, Math.floor(requestedCount)) : 0;
    const count = Math.min(requested, runeBonusRollBudget - runeBonusRollsUsed);
    for (let j = 0; j < count; j++) runeBonusRollSpecs.push({ ...spec });
    rollCount += count;
    runeBonusRollsUsed += count;
    return count;
  };
  const echoChance = Math.min(.45, runeAbilityEffects.echoChamberPct / 100);
  const discoveryOracleChance = Math.min(.20, runeAbilityEffects.discoveryOraclePct / 500);
  const maxEchoChain = runeAbilityEffects.echoChamberMaxChain;
  const paradoxChance = Math.min(.50, runeAbilityEffects.paradoxEnginePct / 100);
  const eventHorizonRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.eventHorizonPct / 100);
  const shardConstellationThreshold = Math.max(3, Math.floor(12 / (1 + runeAbilityEffects.shardConstellationPct / 100)));
  const temporalMomentumPerRoll = runeAbilityEffects.temporalLoopMomentumPerRoll;
  const prismaticForkChance = Math.min(.45, runeAbilityEffects.prismaticForkPct / 100);
  const prismaticForkRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.prismaticForkPct / 100);
  const criticalConvergenceChance = Math.min(.35, runeAbilityEffects.criticalConvergencePct / 100);
  const criticalConvergenceRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.criticalConvergencePct / 100);
  const rarityLadderRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.rarityLadderPct / 100);
  const stellarDividendInterval = Math.max(20, Math.floor(100 / (1 + runeAbilityEffects.stellarDividendPct / 100)));
  const shardJackpotChance = Math.min(.50, runeAbilityEffects.shardJackpotPct / 100);
  const milestoneRarityMultiplier = 1 + Math.min(2, runeAbilityEffects.milestoneEnginePct / 100);
  let paradoxTriggered = false;
  let constellationTriggered = false;
  let temporalLoopTriggered = false;
  let stellarDividendTriggered = false;
  let rarityLadderTriggered = false;
  let discoveryOracleTriggered = false;
  let previousBatchRarity = 0;
  let risingRarityChain = 0;
  const validCharge = (value: unknown) => Number.isFinite(Number(value)) ? Math.min(1_000_000, Math.max(0, Number(value))) : 0;
  s.runeConstellationCharge = validCharge(s.runeConstellationCharge);
  s.runeTemporalMomentum = validCharge(s.runeTemporalMomentum);

  for (let i = 0; i < rollCount; i++) {
    const currentRuneSpec = i >= baseBatchRollCount ? runeBonusRollSpecs[i - baseBatchRollCount] : undefined;
    const echoDepth = currentRuneSpec?.echoDepth ?? 0;
    const suppressOtherRuneProcs = currentRuneSpec?.skipAllProcs === true || currentRuneSpec?.echoOnly === true;
    // New-player hype: the third Orb this account ever rolls is guaranteed
    // to land in the 1/101 through 1/120 range. It cannot crit upward, so the
    // guarantee is the exact advertised range.
    const isGuaranteedThirdBall = forcedRarity == null && lifetimeRollsBeforeBatch + i === 2;

    // Chain Patcher guarantees the exact requested rarity, not a critical multiplier.
    const isCrit = !isGuaranteedThirdBall &&
      !(exactRarity && forcedRarity != null && i === 0) &&
      rng() < effectiveCritChance;
    let effectiveCm = cm;
    if (isCrit) {
      s.totalCrits = (s.totalCrits ?? 0) + 1;
      const supernovaLevel = s.prestigeUpgrades?.supernova ?? 0;
      if (supernovaLevel > 0 && rng() < supernovaLevel * 0.10) {
        effectiveCm = cm * 5; // Supernova multiplies the full normal critical strength by 5.
      }
    }

    // Continuum RNG generation with effective luck. Luck reshapes the tail;
    // it does not multiply the final rarity directly.
    // The third lifetime Orb overrides the random result with a guaranteed beginner drop.
    const minimumRarity = 2 + (s.prestigeUpgrades?.luckyFloor ?? 0);
    const beginnerRarity = 101 + Math.floor(rng() * 20);
    const runeRarityFloor = Math.max(minimumRarity, currentRuneSpec?.minRarity ?? minimumRarity);
    let isInfinityOrb = false;
    let rolledRarity: number;
    if (isGuaranteedThirdBall) {
      rolledRarity = beginnerRarity;
    } else if (forcedRarity && i === 0) {
      rolledRarity = forcedRarity;
    } else {
      const rawRolledRarity = Math.round(rollContinuum(effectiveLuck, randomOverride ?? serverRarityRandom) * runeLuckMultiplier);
      isInfinityOrb = !Number.isFinite(rawRolledRarity) || rawRolledRarity > MAX_ORB_RARITY;
      rolledRarity = Math.max(runeRarityFloor, Math.min(MAX_ORB_RARITY,
        Number.isFinite(rawRolledRarity) ? rawRolledRarity : MAX_ORB_RARITY));
    }
    const baseRarity = exactRarity && forcedRarity != null && i === 0
      ? forcedRarity
      : Math.max(minimumRarity, isGuaranteedThirdBall ? rolledRarity : runeRarityFloor, rolledRarity);
    const rawCritRarity = isCrit ? Math.round(baseRarity * effectiveCm) : baseRarity;
    if (isCrit && (!Number.isFinite(rawCritRarity) || rawCritRarity > MAX_ORB_RARITY)) isInfinityOrb = true;
    const rarity = isCrit
      ? Math.min(MAX_ORB_RARITY, Number.isFinite(rawCritRarity) ? rawCritRarity : MAX_ORB_RARITY)
      : baseRarity;
    const finalVal = Math.min(MAX_ORB_RARITY, Math.round(rarity * valueMul));
    const rarityKey = isInfinityOrb ? 'Infinity' : String(rarity);
    const isNew = !s.collection[rarityKey];

    totalVal = Math.min(Number.MAX_VALUE, totalVal + finalVal);
    rarities.push(rarity);
    s.totalRolls++;
    s.currentRunRolls = (s.currentRunRolls ?? 0) + 1;
    s.collectionValue = addCollectionValue(s.collectionValue, finalVal);
    s.lifetimeCollectionValue = addCollectionValue(s.lifetimeCollectionValue, finalVal);

    if (isNew) uniqueGained++;
    s.collection[rarityKey] = (s.collection[rarityKey] ?? 0) + 1;

    const previousAllTimeRarity = s.highestRarity;
    const isNewRarityRecord = rarity > previousAllTimeRarity || (isInfinityOrb && !s.highestRarityIsInfinity);
    if (isNewRarityRecord) {
      // The rolls since the previous record become an Aftershock candidate
      // only when a strictly rarer all-time orb finally appears.
      if (s.highestRarity > 0) {
        const previousDryRolls = Math.max(0, Math.floor(Number(s.rollsSinceBest ?? 0) || 0));
        s.aftershockRecord = Math.max(
          Math.max(0, Math.floor(Number(s.aftershockRecord ?? 0) || 0)),
          previousDryRolls,
        );
      }
      s.highestRarity = rarity;
      s.highestRarityIsInfinity = isInfinityOrb;
      s.rollsSinceBest = 0;
    } else {
      s.rollsSinceBest = (s.rollsSinceBest ?? 0) + 1;
      s.highestDryStreak = Math.max(s.highestDryStreak ?? 0, s.rollsSinceBest);
    }

    // Discovery Oracle rewards a new-to-this-player rarity at most once per activation.
    if (isNew && !discoveryOracleTriggered && !suppressOtherRuneProcs && discoveryOracleChance > 0 && rng() < discoveryOracleChance) {
      addRuneBonusRolls(runeAbilityEffects.discoveryOracleBonusRolls, { minRarity: Math.max(2, rarity), skipAllProcs: true });
      discoveryOracleTriggered = true;
    }
    // Event Horizon fires only on genuine all-time records and its generated burst cannot recurse.
    if (isNewRarityRecord && !suppressOtherRuneProcs && runeAbilityEffects.eventHorizonPct > 0) {
      const floor = Math.min(MAX_ORB_RARITY, Math.max(rarity + 1, Math.ceil(rarity * eventHorizonRarityMultiplier)));
      addRuneBonusRolls(runeAbilityEffects.eventHorizonBonusRolls, { minRarity: floor, skipAllProcs: true });
    }
    // Milestone Engine pays for each new order-of-magnitude reached by the all-time record.
    if (isNewRarityRecord && previousAllTimeRarity > 0 && !suppressOtherRuneProcs && runeAbilityEffects.milestoneEnginePct > 0) {
      const decadesCrossed = Math.min(5, Math.max(0, Math.floor(Math.log10(rarity)) - Math.floor(Math.log10(previousAllTimeRarity))));
      if (decadesCrossed > 0) {
        shardsGained = Math.min(Number.MAX_SAFE_INTEGER, shardsGained + runeAbilityEffects.milestoneEngineBonusShards * decadesCrossed);
        const floor = Math.min(MAX_ORB_RARITY, Math.max(rarity + 1, Math.ceil(rarity * milestoneRarityMultiplier)));
        addRuneBonusRolls(runeAbilityEffects.milestoneEngineBonusRolls * decadesCrossed, { minRarity: floor, skipAllProcs: true });
      }
    }
    // Critical Convergence converts a critical hit into a chance for a non-recursive, rarity-floored bonus.
    if (isCrit && !suppressOtherRuneProcs && criticalConvergenceChance > 0 && rng() < criticalConvergenceChance) {
      const floor = Math.min(MAX_ORB_RARITY, Math.max(rarity, Math.ceil(rarity * criticalConvergenceRarityMultiplier)));
      addRuneBonusRolls(runeAbilityEffects.criticalConvergenceBonusRolls, { minRarity: floor, skipAllProcs: true });
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
    if (!stellarDividendTriggered && !suppressOtherRuneProcs && runeAbilityEffects.stellarDividendPct > 0 && s.totalRolls % stellarDividendInterval === 0) {
      addRuneBonusRolls(runeAbilityEffects.stellarDividendBonusRolls, { skipAllProcs: true });
      stellarDividendTriggered = true;
    }
    // Paradox Engine gets one proc check per multi-roll activation.
    if (i === 0 && baseBatchRollCount > 1 && paradoxChance > 0 && rng() < paradoxChance) {
      addRuneBonusRolls(runeAbilityEffects.paradoxEngineBonusRolls, { skipAllProcs: true });
    }
    // Echo Chamber can echo normal rolls and its own echoes; each link has half the chance of the previous link.
    if (!currentRuneSpec?.skipAllProcs && echoChance > 0 && echoDepth < maxEchoChain &&
        rng() < echoChance * Math.pow(.5, echoDepth)) {
      addRuneBonusRolls(1, { echoDepth: echoDepth + 1, echoOnly: true });
    }
    // Prismatic Fork is limited to rare-or-better rolls, and its bonus roll cannot fork again.
    if (!suppressOtherRuneProcs && rarity >= 1_000 && prismaticForkChance > 0 && rng() < prismaticForkChance) {
      const floor = Math.min(MAX_ORB_RARITY, Math.max(rarity + 1, Math.ceil(rarity * prismaticForkRarityMultiplier)));
      addRuneBonusRolls(1, { minRarity: floor, skipAllProcs: true });
    }

    if (rarity > bestRarity || (isInfinityOrb && !bestIsInfinity)) {
      bestRarity = rarity;
      bestIsCrit = isCrit;
      bestIsNew = isNew;
      bestIsInfinity = isInfinityOrb;
    } else if (rarity === bestRarity) {
      if (isCrit) bestIsCrit = true;
      bestIsNew = bestIsNew || isNew;
      bestIsInfinity = bestIsInfinity || isInfinityOrb;
    }

    const xpBonusMul =
      (1 + (s.upgrades.xpBonus ?? 0) * 0.20) *
      levelBenefits.xpMultiplier *
      (1 + runeBonuses.xpGainPct / 100);
    const earnedXp = Math.min(Number.MAX_SAFE_INTEGER, Math.round(Math.min(300, 12 + Math.floor(Math.log10(rarity + 1) * 12)) * xpBonusMul));

    // Shards bonus for rare orbs (1,000+)
    // Fractional baseline drip keeps ordinary play productive without flooding the wallet.
    let earnedShards = 0.001 + runeAbilityEffects.shardTithePerRoll;
    if (rarity >= 1_000_000) earnedShards += 0.25;
    else if (rarity >= 100_000) earnedShards += 0.05;
    else if (rarity >= 10_000) earnedShards += 0.01;
    else if (rarity >= 1_000) earnedShards += 0.005;
    // Long dry streaks gradually improve Shard drip; a rarity record resets this pressure.
    earnedShards += Math.min(0.005, Math.floor(Math.max(0, s.rollsSinceBest ?? 0) / 100) * runeAbilityEffects.dryStreakRefineryRate);

    // Shard Chance upgrade + Mastery + Guild perk proc
    const shardProcChance = Math.min(
      1,
      (s.upgrades.shardChance ?? 0) * 0.0015 +
      (s.masterySkills?.shardAttunement ?? 0) * 0.001 +
      (s.guildPerks?.shardRank ?? 0) * 0.0005 +
      (s.prestigeUpgrades?.shardResonator ?? 0) * 0.0025 +
      levelBenefits.shardChance +
      Math.min(100, runeBonuses.shardChancePct) / 100
    );
    const shardProcTriggered = rng() < shardProcChance;
    earnedShards += resolveShardPityReward(s, shardProcTriggered);
    // Shard Jackpot multiplies the full payout, including fractional drip, instead of forcing a whole-Shard minimum.
    if (earnedShards > 0 && !suppressOtherRuneProcs && shardJackpotChance > 0 && rng() < shardJackpotChance) {
      earnedShards = Math.round(earnedShards * (1 + runeAbilityEffects.shardJackpotExtraMultiplier) * 1_000) / 1_000;
    }

    shardsGained = Math.round((shardsGained + earnedShards) * 1_000) / 1_000;
    xpGained += earnedXp;

    // Shard Constellation retains charge between activations and pays only once per activation.
    if (runeAbilityEffects.shardConstellationPct > 0) {
      s.runeConstellationCharge = Math.min(1_000_000, validCharge(s.runeConstellationCharge) + earnedShards);
      if (!constellationTriggered && !suppressOtherRuneProcs && s.runeConstellationCharge >= shardConstellationThreshold) {
        s.runeConstellationCharge -= shardConstellationThreshold;
        shardsGained = Math.min(Number.MAX_SAFE_INTEGER, shardsGained + runeAbilityEffects.shardConstellationBonusShards);
        addRuneBonusRolls(runeAbilityEffects.shardConstellationBonusRolls, { skipAllProcs: true });
        constellationTriggered = true;
      }
    }

    // Temporal Loop charges on every real roll, then releases a bounded bonus batch.
    if (temporalMomentumPerRoll > 0) {
      const dryStreakMomentum = Math.min(5, Math.log2(Math.max(1, s.rollsSinceBest + 1)) * .25);
      s.runeTemporalMomentum = Math.min(1_000_000, validCharge(s.runeTemporalMomentum) + temporalMomentumPerRoll + dryStreakMomentum);
      if (!temporalLoopTriggered && !suppressOtherRuneProcs && s.runeTemporalMomentum >= 100) {
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
  }

  // Balanced Gold progression: top rolled orb gives 100% coins; extra orbs in multi-roll give 20% bonus coins
  rarities.sort((a, b) => b - a);
  const topCoins = Math.round(coinsForRarity(rarities[0]));
  const extraCoins = rarities.slice(1).reduce((acc, r) => acc + Math.max(1, Math.round(coinsForRarity(r) * 0.20)), 0);
  coinsGained = topCoins + extraCoins;

  // Level passives and other coin modifiers stack multiplicatively by source.
  const coinBonusMul =
    levelBenefits.coinsMultiplier *
    (1 + (s.upgrades.coinBonus ?? 0) * 0.15) *
    (1 + (s.masterySkills?.prosperity ?? 0) * 0.12) *
    (1 + (s.guildPerks?.coinRank ?? 0) * 0.10) *
    (1 + runeBonuses.coinGainPct / 100);
  coinsGained = Math.min(Number.MAX_SAFE_INTEGER, Math.round(coinsGained * coinBonusMul));

  const lowRarityCoins = rarities
    .filter(r => r < 100)
    .reduce((sum, r) => sum + Math.max(1, Math.round(coinsForRarity(r))), 0);

  // Singularity Filter: +25% only to Common/Uncommon coin yield.
  const hasFilter = (s.prestigeUpgrades?.autoFilter ?? 0) > 0;
  if (hasFilter && lowRarityCoins > 0) {
    coinsGained += Math.round(lowRarityCoins * 0.25);
  }

  // Alchemical Transmutation: bonus low-rarity coins & shard procs only.
  const transLevel = s.prestigeUpgrades?.transmutation ?? 0;
  if (transLevel > 0) {
    coinsGained += Math.round(lowRarityCoins * (transLevel * 0.15));
    for (let i = 0; i < rollCount; i++) {
      if (rng() < 0.01 * transLevel) {
        shardsGained += 0.001;
      }
    }
  }

  // Offline Fortune only modifies rewards generated from the offline vault.
  if (source === 'offline' && (s.prestigeUpgrades?.offlineFortune ?? 0) > 0) {
    coinsGained = Math.round(coinsGained * (1 + (s.prestigeUpgrades.offlineFortune * 0.25)));
  }

  // Offline Overdrive was intended to improve offline rewards, not online rolls.
  if (source === 'offline' && (s.prestigeUpgrades?.offlineOverdrive ?? 0) > 0) {
    coinsGained = Math.round(coinsGained * (1 + (s.prestigeUpgrades.offlineOverdrive * 0.50)));
  }

  const pendingGuildWrite = getPendingSaveExtraWrite(s, 'io:guilds');
  let guildEffects: Awaited<ReturnType<typeof prepareGuildRollEffects>>;
  try {
    guildEffects = await prepareGuildRollEffects(
      coinsGained,
      totalVal,
      rollCount,
      bestRarity,
      pendingGuildWrite,
    );
  } catch (error) {
    // Guild taxes and contribution are optional projections, not a dependency
    // for paying out a valid roll. Preserve corrupt shared Guild data, skip its
    // effects for this batch, and allow the player's durable roll to complete.
    console.error('[Guild] Could not prepare roll effects; skipping Guild tax/contribution for this batch.', error);
    guildEffects = { taxedCoins: 0 };
  }
  if (guildEffects.extraWrite) {
    stageSaveExtraWrite(s, {
      ...guildEffects.extraWrite,
      onConflict: () => {
        if (guildEffects.taxedCoins > 0) addCoins(s, guildEffects.taxedCoins);
      },
    });
  }
  coinsGained = Math.max(0, coinsGained - guildEffects.taxedCoins);
  coinsGained = addCoins(s, coinsGained);
  shardsGained = grantRollShards(s, shardsGained);

  // Ascension increases XP by 10× while preserving the existing level logic.
  const effectiveXpGained = isPremiumBoosterActive(s, 'ascension') ? xpGained * 10 : xpGained;
  s.xp += effectiveXpGained;
  xpGained = effectiveXpGained;

  // Rich EXP Level Progression. Normal roll activations deliberately advance
  // at most one level at a time, while applyXp/quest rewards can catch up safely.
  applyLevelProgress(s, 1);

  // Count only successfully processed online roll batches as an active session;
  // offline-vault rolls don't fabricate a continuous play session.
  if (source === 'online' && rollCount > 0) recordRollingSessionActivity(s, now);

  // Coin earnings and their lifetime statistic are capped independently at the safe-integer ceiling.

  // Celestial Auto-Buyer Prestige Upgrade: auto-buy cheapest affordable upgrade
  const autoBuyerLevel = s.prestigeUpgrades?.autoBuyer ?? 0;
  if (autoBuyerLevel > 0 && s.coins > AUTO_BUYER_COIN_RESERVE) {
    autoBuyCheapest(s, AUTO_BUYER_COIN_RESERVE);
  }

  advanceQuestProgress(s, 'roll', rollCount);
  if (bestRarity >= 100) advanceQuestProgress(s, 'rare', bestRarity);
  advanceQuestProgress(s, 'value', totalVal);
  advanceQuestProgress(s, 'unique', uniqueGained);

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

  await appendPlayerSpyLog('roll', {
    source,
    forcedRarity: forcedRarity ?? null,
    requestedRollCount,
    processedRollCount: rollCount,
    activationCount,
    rarityMin: rarities.length ? Math.min(...rarities) : 0,
    rarityMax: rarities.length ? Math.max(...rarities) : 0,
    rarityAverage: rarities.length
      ? Math.round(rarities.reduce((sum, rarity) => sum + rarity, 0) / rarities.length)
      : 0,
    rarityHistogram: {
      '2-9': rarities.filter(r => r < 10).length,
      '10-99': rarities.filter(r => r >= 10 && r < 100).length,
      '100-999': rarities.filter(r => r >= 100 && r < 1_000).length,
      '1k-9.9k': rarities.filter(r => r >= 1_000 && r < 10_000).length,
      '10k-99.9k': rarities.filter(r => r >= 10_000 && r < 100_000).length,
      '100k-999.9k': rarities.filter(r => r >= 100_000 && r < 1_000_000).length,
      '1m-9.9m': rarities.filter(r => r >= 1_000_000 && r < 10_000_000).length,
      '10m+': rarities.filter(r => r >= 10_000_000).length,
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
    luckMultiplier: effectiveLuck,
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

  if (!(await notifications.isOptedIn(userId))) return false;

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

  await notifications.enqueue({
    title: 'Infinity Orbs',
    body: 'your offline orbs are full, make sure to collect them! ',
    recipients: [{
      userId,
      link: `https://reddit.com/r/${subredditName}`,
    }],
  });

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
  if (!(await notifications.isOptedIn(userId))) return;

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
    const jobId = await context.scheduler.runJob({
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

  const raw = await redis.get('player:' + userId);
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
  const tickMs = effectiveOfflineTickMs(s);
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
      if (notificationMarker === '') {
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

export async function settleOffline(s: PlayerState, options: { skipAutoOfflineClaim?: boolean; skipOfflineNotifications?: boolean; skipAutoStreakClaim?: boolean; skipAutoQuestClaim?: boolean; skipAutoCommunityClaim?: boolean } = {}): Promise<PlayerState> {
  const now = Date.now();
  checkPeriodicResets(s, now);
  resetFreeShardBudgetIfNeeded(s, now);
  // Mutations settle the active player's state; read-only paths must not call this.
  s.onlinePlayers = await touchOnlinePresence();
  s.globalBoosters = await getGlobalBoosters();

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

  const tickMs = effectiveOfflineTickMs(s);
  const diff = now - (s.lastSeenAt || now);
  if (diff >= tickMs) {
    const earned = Math.floor(diff / tickMs);
    const cap = offlineRollCap(s);
    const offlineBefore = s.offlineRolls || 0;
    const offlineAfter = Math.min(cap, offlineBefore + earned);
    s.offlineRolls = offlineAfter;
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

  s.lastSeenAt = now;

  // Process automation after newly earned offline rolls have been added.
  await processAutomation(s, options);

  const cap = offlineRollCap(s);
  const userId = String(context.userId ?? '').trim();
  const subredditName = String(context.subredditName ?? '').trim();
  if (!options.skipOfflineNotifications && userId && subredditName && s.offlineRolls >= cap) {
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

        if (notificationMarker == null && !(await notifications.isOptedIn(userId))) {
          await clearCurrentJob();
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
  } else if (!options.skipOfflineNotifications && userId && subredditName) {
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
  resetFreeShardBudgetIfNeeded(s, now);
  s.onlinePlayers = options.registerActivity === false
    ? await getOnlinePlayers()
    : await touchOnlinePresence();
  s.globalBoosters = await getGlobalBoosters();

  // Show currently accumulated offline rolls without consuming/persisting them.
  const tickMs = effectiveOfflineTickMs(s);
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
  return s;
}

export async function checkOffline(): Promise<PlayerState> {
  const s = await loadRaw();
  return settleOffline(s);
}

export async function setAutoRollEnabled(enabled: boolean): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  if ((s.upgrades.auto ?? 0) <= 0) {
    s.autoRollEnabled = false;
    await save(s);
    throw new Error('Auto Roll is not unlocked yet.');
  }

  if (enabled) {
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
): Promise<RollResponse> {
  return withPlayerMutationLock(async () => {
    let ticketUse:
      | { ticket: RollTicket; raw: string; index: number; nextValue: string }
      | undefined;

    if (ticketId != null || ticketIndex != null) {
      const requestedTicketIndex = Number(ticketIndex);
      if (!ticketId || !Number.isSafeInteger(requestedTicketIndex)) {
        throw new Error('Invalid roll prediction ticket.');
      }
      const loaded = await loadRollTicketForUse(ticketId, requestedTicketIndex);
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

    const loadedState = await loadRaw();
    const performRoll = async () => {
      const s = await settleOffline(loadedState);
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
    if (isAuto && usingChainPatcher) {
      throw new Error('Chain Patcher charge must be used by a manual roll. Auto Roll remains paused.');
    }
    const availableFreeRolls = Math.max(0, Math.floor(Number(s.freeRolls ?? 0) || 0));
    // A charged Chain Patcher must resolve as one deliberate, exact orb. It
    // does not consume or batch any accumulated Free Rolls.
    const usingFreeRoll = !usingChainPatcher && !isAuto && availableFreeRolls > 0;
    const cd = cooldownMs(s, isAuto);
    if (!usingFreeRoll && s.lastRollAt !== null && now - s.lastRollAt < cd) {
      throw new Error(`Cooldown: ${((cd - now + s.lastRollAt) / 1000).toFixed(1)}s`);
    }

    // A Chain Patcher charge always takes priority over Free Rolls. Otherwise
    // only an explicit manual "Roll All" request spends the full saved balance.
    const freeRollActivations = usingFreeRoll
      ? (useAllFreeRolls ? availableFreeRolls : 1)
      : 1;
    if (usingFreeRoll && freeRollActivations > 5_000) {
      throw new Error('You have too many stored Free Rolls for one batch (maximum 5,000). No rolls were spent.');
    }
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
    const maxActivationsPerChunk = Math.max(
      1,
      Math.min(offlineRollCap(s), Math.floor(5_000 / ballsPerActivation)),
    );
    while (remainingActivations > 0) {
      const chunkActivations = Math.min(remainingActivations, maxActivationsPerChunk);
      const result = await applyRolls(
        s,
        chunkActivations,
        usingChainPatcher ? rawPatcherRarity : undefined,
        'online',
        usingChainPatcher ? 1 : undefined,
        undefined,
        usingChainPatcher,
      );
      if (!bestOrb || result.bestOrb.rarity > bestOrb.rarity) bestOrb = result.bestOrb;
      batch.push(...result.batch.slice(-200));
      if (batch.length > 200) batch.splice(0, batch.length - 200);
      totalVal = Math.min(Number.MAX_SAFE_INTEGER, totalVal + result.totalVal);
      coinsGained = Math.min(Number.MAX_SAFE_INTEGER, coinsGained + result.coinsGained);
      shardsGained = Math.min(Number.MAX_SAFE_INTEGER, shardsGained + result.shardsGained);
      xpGained = Math.min(Number.MAX_SAFE_INTEGER, xpGained + result.xpGained);
      rollCount = Math.min(Number.MAX_SAFE_INTEGER, rollCount + result.rollCount);
      remainingActivations -= chunkActivations;
    }
    if (!bestOrb) throw new Error('No rolls were processed.');

    if (usingChainPatcher) s.chainPatcherNextRarity = 0;

    if (!isAuto) {
      s.manualRolls = Math.min(10, (s.manualRolls ?? 0) + freeRollActivations);
      if (s.manualRolls >= 3) s.upgrades.auto = 1;
    }

    s.lastRollAt = now;
    s.lastSeenAt = now;

    await save(
      s,
      ticketUse
        ? {
            key: rollTicketKey(),
            expectedValue: ticketUse.raw,
            nextValue: ticketUse.nextValue,
          }
        : undefined,
    );

    void recordLeaderboard(s).catch(error => {
      console.error('[Leaderboard] Background update failed:', error);
    });
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
      await redis.incr(FOLLOW_ACTION_COUNT_KEY);
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
      await redis.incr(FOLLOW_ACTION_COUNT_KEY);
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

export async function claimFollowReward(): Promise<{
  state: PlayerState;
  rollsGranted: number;
  bestRarity: number;
  coinsGained: number;
  shardsGained: number;
  xpGained: number;
}> {
  return withPlayerMutationLock(async () => {
    const userId = currentUserId();
    const subscribedKey = FOLLOW_SUBSCRIBED_KEY_PREFIX + userId;
    const rewardKey = FOLLOW_REWARD_KEY_PREFIX + userId;

    if (await redis.get(rewardKey)) {
      throw new Error('FOLLOW_REWARD_ALREADY_CLAIMED');
    }

    // Explicit Reddit user action: the click that hits this endpoint subscribes
    // the current user to the subreddit where the game is installed.
    await reddit.subscribeToCurrentSubreddit();

    // The per-user marker and global aggregate are one idempotent update.
    // Separate SET then INCR could leave a permanent undercount if the second
    // command failed after the marker had already made retries skip the count.
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
      if (await txn.exec() !== null) {
        actionCountRecorded = true;
        break;
      }
    }
    if (!actionCountRecorded) {
      throw new Error('Follow-action count changed repeatedly. Please retry.');
    }

    const s = await settleOffline(await loadRaw());
    const result = await applyRolls(s, 1, undefined, 'online', FOLLOW_REWARD_ROLLS);

    // 200 real server-side rolls, counted as one reward activation for
    // manual-roll progression and Auto Roll unlocking.
    s.manualRolls = Math.min(10, (s.manualRolls ?? 0) + 1);
    if (s.manualRolls >= 3) s.upgrades.auto = 1;
    s.lastRollAt = Date.now();
    s.lastSeenAt = Date.now();

    // Commit the 200-roll reward and its idempotency marker in the same
    // WATCH/MULTI/EXEC transaction. A marker write failure must never allow a
    // retry to grant the reward a second time.
    const rewardMarker = secureServerToken('follow-reward');
    await save(s, {
      key: rewardKey,
      expectedValue: null,
      nextValue: rewardMarker,
      conflictMessage: 'FOLLOW_REWARD_ALREADY_CLAIMED',
    });
    // save() deliberately discards mutations invalidated by an admin wipe.
    // Ensure that path did not report success without committing the marker.
    if (await redis.get(rewardKey) !== rewardMarker) {
      throw new Error('FOLLOW_REWARD_SAVE_INVALIDATED');
    }
    // The reward and its idempotency marker are already committed. The
    // leaderboard is only a projection; its failure must not make the API
    // report a failed claim that cannot be retried by the user.
    void recordLeaderboard(s).catch(error => {
      console.error('[Follow Reward] Leaderboard projection failed after reward commit:', error);
    });
    void appendPlayerSpyLog('follow-reward-claim', {
      rollsGranted: FOLLOW_REWARD_ROLLS,
      bestRarity: result.bestOrb.rarity,
      coinsGained: result.coinsGained,
      shardsGained: result.shardsGained,
      xpGained: result.xpGained,
    }).catch(error => console.error('[Follow Reward] Spy log failed:', error));

    return {
      state: s,
      rollsGranted: FOLLOW_REWARD_ROLLS,
      bestRarity: result.bestOrb.rarity,
      coinsGained: result.coinsGained,
      shardsGained: result.shardsGained,
      xpGained: result.xpGained,
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
  if (!Number.isSafeInteger(s.offlineRolls) || s.offlineRolls < 0) {
    throw new Error('Saved offline roll count is invalid; no rolls were claimed.');
  }
  const offlineCap = offlineRollCap(s);
  const batches = Math.min(offlineCap, s.offlineRolls);
  if (batches <= 0) throw new Error('No offline rolls waiting.');
  s.offlineRolls = 0;
  const { bestOrb, batch, totalVal, coinsGained, shardsGained, xpGained, rollCount } = await applyRolls(s, batches, undefined, 'offline');
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
  await recordLeaderboard(s).catch(error => {
    console.error('[Leaderboard] Offline-claim projection failed after save:', error);
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
    rollsRemainingUntilNext: cooldownMs(s),
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
    ];
    if (!ids.every(id => validIds.includes(id))) throw new Error('Upgrade batch contains an unknown upgrade.');

    const s = await settleOffline(await loadRaw());
    const purchased: Array<{ id: UpgradeId; cost: number; level: number }> = [];
    let totalSpent = 0;
    let stoppedReason: string | undefined;

    for (const id of ids) {
      const level = s.upgrades[id] ?? 0;
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
    'speed', 'multi', 'clusterRoll', 'auto', 'luck', 'coinBonus',
    'shardChance', 'xpBonus', 'critChance', 'critPower', 'offlineRate', 'valueBonus'
  ];
  let bestId: UpgradeId | null = null;
  let lowestCost = Infinity;

  for (const id of upgradeIds) {
    if (id === 'auto') continue;
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
    'speed', 'multi', 'clusterRoll', 'auto', 'luck', 'coinBonus',
    'shardChance', 'xpBonus', 'critChance', 'critPower', 'offlineRate', 'valueBonus'
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
      let cost = upgradeCost(id, level);

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

  s.cosmicDust = Math.min(MAX_COSMIC_DUST, (s.cosmicDust ?? 0) + dustEarned);
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
  const numCoins = finiteNonNegativeInteger(coins);
  const numShards = finiteNonNegativeInteger(shards);

  const currentAltarLevel = Math.max(0, Math.floor(Number(s.sacrifices?.altarLevel ?? 0) || 0));
  const currentCoinFloor = altarCoinFloor(currentAltarLevel);
  if (numCoins > 0 && numCoins < currentCoinFloor) {
    throw new Error(`Coin offerings require at least ${currentCoinFloor.toLocaleString()} Coins at Altar Lvl ${currentAltarLevel}.`);
  }
  if (numCoins === 0 && numShards <= 0) {
    throw new Error(`Sacrifice at least ${currentCoinFloor.toLocaleString()} Coins or 1 Shard.`);
  }
  if (s.coins < numCoins) throw new Error('Not enough Coins to sacrifice.');
  if ((s.shards ?? 0) < numShards) throw new Error('Not enough Shards to sacrifice.');

  if (!s.sacrifices) {
    s.sacrifices = {
      coinsSacrificed: 0,
      shardsSacrificed: 0,
      altarLevel: 0,
      luckSurgeUntil: 0,
      altarPity: 0,
    };
  }

  const sacrifices = s.sacrifices;
  const prevAltarLevel = sacrifices.altarLevel ?? 0;
  const previousPity = sacrifices.altarPity ?? 0;

  s.coins -= numCoins;
  if (numShards > 0) spendShards(s, numShards);

  sacrifices.coinsSacrificed = (sacrifices.coinsSacrificed ?? 0) + numCoins;
  sacrifices.shardsSacrificed = (sacrifices.shardsSacrificed ?? 0) + numShards;

  // Coins now create a probabilistic Devotion Breakthrough. The offering
  // size raises the chance and failed attempts build pity. This roll only
  // happens when coins are actually offered.
  let altarBreakthroughChance = 0;
  let altarLeveledUp = false;
  if (numCoins > 0) {
    altarBreakthroughChance = altarCoinDevotionChancePercent(
      numCoins,
      previousPity,
      prevAltarLevel,
    );
    altarLeveledUp = serverRandom() * 100 < altarBreakthroughChance;

    if (altarLeveledUp) {
      sacrifices.altarLevel = prevAltarLevel + 1;
      sacrifices.altarPity = 0;
      s.masteryPoints = (s.masteryPoints ?? 0) + 1;
    } else {
      sacrifices.altarPity = previousPity + 1;
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

export async function synthesizeDust(): Promise<{ state: PlayerState; dustEarned: number }> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  if ((s.prestigeUpgrades?.shardSynthesis ?? 0) < 1) {
    throw new Error('Astral Forge prestige upgrade is required to synthesize Cosmic Dust.');
  }
  if ((s.cosmicDust ?? 0) >= MAX_COSMIC_DUST) {
    throw new Error(`Cosmic Dust is capped at ${MAX_COSMIC_DUST}; no Shards were spent.`);
  }
  if ((s.shards ?? 0) < SHARD_SYNTHESIS_COST) {
    throw new Error(`Synthesizing requires at least ${SHARD_SYNTHESIS_COST} Shards.`);
  }

  spendShards(s, SHARD_SYNTHESIS_COST);
  s.cosmicDust = Math.min(MAX_COSMIC_DUST, (s.cosmicDust ?? 0) + 1);
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

export async function startOrbFrenzy(options: {
  bypassDailyLimit?: boolean;
  forcedRarity?: number;
  adminTest?: boolean;
} = {}): Promise<RollResponse & { postId: string; url: string; rarity: number }> {
  return withPlayerMutationLock(async () => {
    const loadedState = await loadRaw();
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
    const postText =
      `u/${ownerUsername} got a 1/${formatRarity(rarity, isInfinity)} Orb in their Frenzy.\n\n` +
      `Click below to claim it! You can only claim one every 23 hours.\n\n` +
      `When someone claims your Frenzy, you receive +${FRENZY_OWNER_SHARD_REWARD} Shards. ` +
      `This owner reward is granted separately from roll-earned Shards.\n\n` +
      `If you claim this Frenzy, please consider upvoting the post to thank its owner.`;
    const post = await reddit.submitCustomPost({
      runAs: 'USER',
      subredditName,
      title: `u/${ownerUsername} got a 1/${formatRarity(rarity, isInfinity)} Orb in their Frenzy`,
      flairText: 'frenzy',
      entry: 'frenzy',
      userGeneratedContent: { text: postText },
    });
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
          const persistedPlayer = playerRaw == null ? null : parsePlayerStateValue(playerRaw);
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
      rollsRemainingUntilNext: cooldownMs(s),
      rollsProcessed: result.rollCount,
      dramaticReveal: rarity >= 100,
    };
      };
      // Creating the Reddit post is an external request that may take time.
      // Do not hold the shared Guild lock across it; save() will safely skip a
      // conflicting Guild projection and refund any withheld tax if needed.
      return performFrenzyStart();
  });
}

export async function getOrbFrenzyInfo(): Promise<{
  rarity: number;
  isInfinity: boolean;
  ownerUsername: string;
  createdAt: number;
  expiresAt: number;
  expired: boolean;
  consumed: boolean;
  claimedToday: boolean;
  claimCooldownRemainingMs: number;
  claimCooldownEndsAt: number;
  isOwner: boolean;
  canClaim: boolean;
  selfClaimTest: boolean;
  postId: string;
  inGame?: boolean;
}> {
  const postId = context.postId;
  if (!postId) throw new Error('This is not an Orb Frenzy post.');

  const raw = await redis.get(FRENZY_POST_PREFIX + postId);
  if (!raw) throw new Error('Orb Frenzy post data was not found.');

  const data = parseFrenzyPostRecord(raw);
  if (!data) throw new Error('Orb Frenzy data is corrupted.');

  const now = Date.now();
  const expiresAt = Number(data.expiresAt ?? frenzyPostExpiresAt(data.createdAt));
  const expired = isFrenzyPostRecordExpired(data, now);
  const viewerId = currentUserId();
  const claimedReceipt = await redis.get(frenzyClaimReceiptKey(postId, viewerId));
  const alreadyClaimedByViewer = claimedReceipt != null || data.consumedBy === viewerId;
  // Preview rendering must not invoke the ordinary player-state read, which touches online presence.
  const s = await loadRaw({ registerActivity: false });
  const claimCooldownRemainingMs = frenzyClaimCooldownRemaining(s.lastFrenzyClaimAt, now);
  const claimCooldownEndsAt = claimCooldownRemainingMs > 0 ? now + claimCooldownRemainingMs : 0;
  const claimedToday = claimCooldownRemainingMs > 0;
  const isOwner = data.ownerId === currentUserId();
  const selfClaimTest =
    isOwner &&
    data.adminTest === true &&
    isFrenzyTestAdmin(s.username);

  return {
    rarity: data.rarity,
    isInfinity: data.isInfinity === true,
    ownerUsername: data.ownerUsername,
    createdAt: data.createdAt,
    expiresAt,
    expired,
    // Legacy consumedAt marked a post globally. New claims are shared by every player;
    // only this viewer's durable receipt (or legacy consumedBy) marks it claimed to them.
    consumed: alreadyClaimedByViewer,
    claimedToday,
    claimCooldownRemainingMs,
    claimCooldownEndsAt,
    isOwner,
    canClaim: !expired && !alreadyClaimedByViewer && (claimCooldownRemainingMs <= 0 || selfClaimTest) && (!isOwner || selfClaimTest),
    selfClaimTest,
    postId,
    inGame: data.inGame === true,
  };
}

export async function claimOrbFrenzy(options: {
  allowAdminTestOwner?: boolean;
  postId?: string;
} = {}): Promise<RollResponse> {
  if (options.postId && options.allowAdminTestOwner !== true) {
    throw new Error('Explicit Frenzy post targeting is admin-only.');
  }

  const claimantId = currentUserId();
  const handoff = options.postId ? null : await readFrenzyHandoff(claimantId);
  const postId = options.postId ?? handoff?.postId ?? context.postId;
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
  const claimCooldown = frenzyClaimCooldownRemaining(s.lastFrenzyClaimAt, now);
  const ownerSelfClaimAllowed =
    isOwner &&
    data.adminTest === true &&
    (isFrenzyTestAdmin(s.username) || options.allowAdminTestOwner === true);

  if (isOwner && !ownerSelfClaimAllowed) {
    throw new Error('You cannot claim your own Orb Frenzy.');
  }

  const selfClaimTest = isOwner && ownerSelfClaimAllowed;
  if (claimCooldown > 0 && !selfClaimTest) {
    throw new Error('Frenzy claim is on cooldown for ' + Math.ceil(claimCooldown / 1000) + ' more seconds.');
  }

  const count = frenzyClaimCountForRarity(
    data.rarity,
    rollsPerActivation(s),
    s.prestigeUpgrades?.frenzyVolley ?? 0,
  );

  // This path writes totalRolls directly instead of going through applyRolls().
  // Reject an overflowing batch before reward mutation, shared Guild/community
  // staging, Shard grants, or marking the Frenzy post consumed.
  if (
    !Number.isSafeInteger(s.totalRolls) ||
    s.totalRolls < 0 ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > Number.MAX_SAFE_INTEGER - s.totalRolls
  ) {
    throw new Error('Frenzy roll counter would exceed the safe integer range; claim was not processed.');
  }

  const critChance = effectiveRollCritChance(s, s.globalBoosters);
  const critCount = sampleBinomial(count, critChance);

  const supernovaLevel = s.prestigeUpgrades?.supernova ?? 0;
  const supernovaCount = supernovaLevel > 0
    ? sampleBinomial(critCount, Math.min(1, supernovaLevel * 0.10))
    : 0;

  const normalCritCount = Math.max(0, critCount - supernovaCount);
  const baseIsInfinity = data.isInfinity === true;
  const rawNormalCritRarity = Math.round(data.rarity * critMultiplier(s));
  const rawSupernovaRarity = Math.round(data.rarity * critMultiplier(s) * 5);
  const normalCritIsInfinity = baseIsInfinity || !Number.isFinite(rawNormalCritRarity) || rawNormalCritRarity > MAX_ORB_RARITY;
  const supernovaIsInfinity = baseIsInfinity || !Number.isFinite(rawSupernovaRarity) || rawSupernovaRarity > MAX_ORB_RARITY;
  const normalCritRarity = Math.min(MAX_ORB_RARITY, Number.isFinite(rawNormalCritRarity) ? rawNormalCritRarity : MAX_ORB_RARITY);
  const supernovaRarity = Math.min(MAX_ORB_RARITY, Number.isFinite(rawSupernovaRarity) ? rawSupernovaRarity : MAX_ORB_RARITY);

  const groups = [
    { count: count - critCount, rarity: data.rarity, isInfinity: baseIsInfinity, isCrit: false },
    { count: normalCritCount, rarity: normalCritRarity, isInfinity: normalCritIsInfinity, isCrit: true },
    { count: supernovaCount, rarity: supernovaRarity, isInfinity: supernovaIsInfinity, isCrit: true },
  ].filter(group => group.count > 0);

  const valueMul =
    1 +
    (s.upgrades.valueBonus ?? 0) * 0.10 +
    (s.prestigeUpgrades?.cosmicValuation ?? 0) * 0.05;
  const maxSafe = Number.MAX_SAFE_INTEGER;
  const safeMultiplyAdd = (sum: number, count: number, value: number): number => {
    if (sum >= maxSafe || count <= 0 || value <= 0) return Math.min(maxSafe, sum);
    if (count > Math.floor((maxSafe - sum) / value)) return maxSafe;
    return sum + count * value;
  };
  const rawValue = groups.reduce(
    (sum, group) => safeMultiplyAdd(sum, group.count, group.rarity),
    0,
  );
  const finalValue = rawValue >= maxSafe / valueMul
    ? maxSafe
    : Math.min(maxSafe, Math.round(rawValue * valueMul));

  const coinTotals = groups.reduce(
    (sum, group) => sum + group.count * Math.max(1, Math.round(coinsForRarity(group.rarity))),
    0,
  );
  const topRarity = Math.max(...groups.map(group => group.rarity));
  const topCoin = Math.max(1, Math.round(coinsForRarity(topRarity)));
  let coinsGained = Math.max(
    1,
    Math.round(topCoin + Math.max(0, coinTotals - topCoin) * 0.20),
  );

  const levelBenefits = getLevelBenefits(s.level || 1);
  coinsGained = Math.round(
    coinsGained *
    levelBenefits.coinsMultiplier *
    (1 + (s.upgrades.coinBonus ?? 0) * 0.15) *
    (1 + (s.masterySkills?.prosperity ?? 0) * 0.12) *
    (1 + (s.guildPerks?.coinRank ?? 0) * 0.10) *
    (isPremiumBoosterActive(s, 'prosperity') ? 10 : 1),
  );

  const lowRarityCoins = groups
    .filter(group => group.rarity < 100)
    .reduce(
      (sum, group) => sum + group.count * Math.max(1, Math.round(coinsForRarity(group.rarity))),
      0,
    );
  if ((s.prestigeUpgrades?.autoFilter ?? 0) > 0 && lowRarityCoins > 0) {
    coinsGained += Math.round(lowRarityCoins * 0.25);
  }
  const transmutationLevel = s.prestigeUpgrades?.transmutation ?? 0;
  if (transmutationLevel > 0 && lowRarityCoins > 0) {
    coinsGained += Math.round(lowRarityCoins * (transmutationLevel * 0.15));
  }

  const xpForRarity = (rarity: number) =>
    Math.round(
      Math.min(300, 12 + Math.floor(Math.log10(rarity + 1) * 12)) *
      (1 + (s.upgrades.xpBonus ?? 0) * 0.20) *
      levelBenefits.xpMultiplier *
      (isPremiumBoosterActive(s, 'ascension') ? 10 : 1),
    );
  const xpGained = Math.min(
    Number.MAX_SAFE_INTEGER,
    groups.reduce((sum, group) => sum + group.count * xpForRarity(group.rarity), 0),
  );

  const shardChance = Math.min(
    1,
    (s.upgrades.shardChance ?? 0) * 0.0015 +
    (s.masterySkills?.shardAttunement ?? 0) * 0.001 +
    (s.guildPerks?.shardRank ?? 0) * 0.0005 +
    (s.prestigeUpgrades?.shardResonator ?? 0) * 0.0025 +
    levelBenefits.shardChance,
  );
  const procShards = sampleBinomial(count, shardChance);
  const transmutationShardProcs = transmutationLevel > 0
    ? sampleBinomial(count, Math.min(1, 0.01 * transmutationLevel))
    : 0;
  const rarityShards = groups.reduce((sum, group) => {
    if (group.rarity >= 1_000_000) return sum + group.count * 10;
    if (group.rarity >= 100_000) return sum + group.count * 5;
    if (group.rarity >= 10_000) return sum + group.count * 2;
    if (group.rarity >= 1_000) return sum + group.count;
    return sum;
  }, 0);
  const shardsGained = grantRollShards(s, rarityShards + procShards + transmutationShardProcs);

  const previousHighest = s.highestRarity;
  const bestRarity = topRarity;
  s.totalRolls += count;
  s.currentRunRolls = (s.currentRunRolls ?? 0) + count;
  s.collectionValue = addCollectionValue(s.collectionValue, finalValue);
  s.lifetimeCollectionValue = addCollectionValue(s.lifetimeCollectionValue, finalValue);
  s.totalCrits = (s.totalCrits ?? 0) + critCount;

  // Stage Guild taxes/contribution in the same save as this claim. A failed
  // player save must not leave a consumed Guild tax, task credit, or roll count.
  const pendingGuildWrite = getPendingSaveExtraWrite(s, 'io:guilds');
  let guildEffects: Awaited<ReturnType<typeof prepareGuildRollEffects>>;
  try {
    guildEffects = await prepareGuildRollEffects(
      coinsGained,
      finalValue,
      count,
      bestRarity,
      pendingGuildWrite,
    );
  } catch (error) {
    // A broken optional Guild projection must not void a valid Orb Frenzy claim.
    // Keep the stored Guild untouched and omit its effects for this claim.
    console.error('[Guild] Could not prepare Frenzy effects; skipping Guild tax/contribution for this claim.', error);
    guildEffects = { taxedCoins: 0 };
  }
  if (guildEffects.extraWrite) {
    stageSaveExtraWrite(s, {
      ...guildEffects.extraWrite,
      onConflict: () => {
        if (guildEffects.taxedCoins > 0) addCoins(s, guildEffects.taxedCoins);
      },
    });
  }
  coinsGained = Math.max(0, coinsGained - guildEffects.taxedCoins);
  coinsGained = addCoins(s, coinsGained);
  s.lastFrenzyClaimDate = new Date(now).toISOString().slice(0, 10);
  s.lastFrenzyClaimAt = now;
  const newRarityKeys = groups.filter(
    group => (s.collection[group.isInfinity ? 'Infinity' : String(group.rarity)] ?? 0) <= 0,
  );
  const uniqueGained = newRarityKeys.length;

  for (const group of groups) {
    const keyForRarity = group.isInfinity ? 'Infinity' : String(group.rarity);
    s.collection[keyForRarity] = (s.collection[keyForRarity] ?? 0) + group.count;
  }
  const bestIsInfinity = groups.some(group => group.rarity === bestRarity && group.isInfinity);
  const bestIsCrit = groups.some(group => group.rarity === bestRarity && group.isCrit);
  s.highestRarity = Math.max(s.highestRarity, bestRarity);
  if (bestRarity > previousHighest || (bestIsInfinity && !s.highestRarityIsInfinity)) {
    s.highestRarity = bestRarity;
    s.highestRarityIsInfinity = bestIsInfinity;
    const previousDryRolls = Math.max(0, Math.floor(Number(s.rollsSinceBest ?? 0) || 0));
    if (previousHighest > 0) {
      s.aftershockRecord = Math.max(
        Math.max(0, Math.floor(Number(s.aftershockRecord ?? 0) || 0)),
        previousDryRolls,
      );
    }
    s.rollsSinceBest = 0;
  } else {
    s.rollsSinceBest = (s.rollsSinceBest ?? 0) + count;
    s.highestDryStreak = Math.max(s.highestDryStreak ?? 0, s.rollsSinceBest);
  }

  s.xp += xpGained;
  applyLevelProgress(s, 1);

  // Claiming a Frenzy is active online rolling activity for Unbroken Momentum.
  if (count > 0) recordRollingSessionActivity(s, now);

  advanceQuestProgress(s, 'roll', count);
  advanceQuestProgress(s, 'rare', bestRarity);
  advanceQuestProgress(s, 'value', finalValue);
  advanceQuestProgress(s, 'unique', uniqueGained);

  const pendingCommunityWrite = getPendingSaveExtraWrite(s, 'io:community_event');
  try {
    const communityUpdate = await prepareCommunityRolls(count, pendingCommunityWrite);
    stageSaveExtraWrite(s, {
      key: communityUpdate.key,
      expectedValue: communityUpdate.expectedValue,
      nextValue: communityUpdate.nextValue,
      conflictMessage: 'Community event changed before the Frenzy claim saved. Please retry.',
      optional: true,
    });
  } catch (error) {
    // World Event progress is an optional projection, not a prerequisite for a
    // valid Frenzy reward. Preserve corrupt shared data and still commit the
    // claimant's reward, Guild effects, consumed post and owner reward atomically.
    console.error('[Community Event] Frenzy progress not recorded; preserving shared data.', error);
  }

  let ownerRewardShards = 0;
  let ownerRewardWrites: SaveExtraWrite[] = [];
  if (isOwner) {
    ownerRewardShards = grantFrenzyOwnerShards(s, FRENZY_OWNER_SHARD_REWARD);
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

  const rolledAt = Date.now();
  const visibleBatch: Orb[] = [];
  for (const group of groups) {
    const groupInfo = getOrbInfo(group.rarity, group.isInfinity);
    const groupIsNew = newRarityKeys.some(item => item.rarity === group.rarity && Boolean(item.isInfinity) === Boolean(group.isInfinity));
    const visibleCount = Math.min(group.count, Math.max(0, 8 - visibleBatch.length));
    for (let i = 0; i < visibleCount; i += 1) {
      visibleBatch.push({
        rarity: group.rarity,
        rolledAt,
        tier: groupInfo.tier,
        name: groupInfo.name,
        isInfinity: group.isInfinity,
        isNew: groupIsNew,
        isCrit: group.isCrit,
      });
    }
  }

  const orbInfo = getOrbInfo(bestRarity, bestIsInfinity);
  const bestOrb: Orb = {
    rarity: bestRarity,
    rolledAt,
    tier: orbInfo.tier,
    name: orbInfo.name,
    isInfinity: bestIsInfinity,
    isNew: newRarityKeys.some(group => group.rarity === bestRarity && Boolean(group.isInfinity) === bestIsInfinity),
    isCrit: bestIsCrit,
  };
  if (visibleBatch.length === 0) visibleBatch.push(bestOrb);

  return {
    orb: bestOrb,
    batch: visibleBatch,
    totalValueGained: finalValue,
    totalRollValue: finalValue,
    coinsGained,
    shardsGained: shardsGained + (isOwner ? ownerRewardShards : 0),
    xpGained,
    state: s,
    rollsRemainingUntilNext: cooldownMs(s),
    dramaticReveal: bestRarity >= 100,
    frenzyCount: count,
  };

  };
  return playerGuildScopes.get(loadedState)
    ? withGuildDataMutationLock(performClaim)
    : performClaim();
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
  void recordLeaderboard(s).catch(error => {
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
  void recordLeaderboard(s).catch(error => {
    console.error('[Leaderboard] Share update failed:', error);
  });
}
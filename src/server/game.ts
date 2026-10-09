import { redis, context, reddit } from './devvit-mock.js';
import { withPlayerMutationLock, withPlayerMutationLockFor } from './player-lock.js';
import * as notificationsModule from '@devvit/notifications';

const notifications = (notificationsModule as any).notifications;
import {
  createInitialState,
  createInitialDailyStreakCommunity,
  type PlayerState,
  type RollResponse,
  type UpgradeId,
  type PrestigeUpgradeId,
  type Orb,
  AUTO_UNLOCK_COST,
  SHARD_SYNTHESIS_COST,
  PRESTIGE_UPGRADES,
  cooldownMs,
  rollsPerActivation,
  luckMultiplier,
  upgradeCost,
  prestigeUpgradeCost,
  calculatePrestigeDust,
  offlineRollCap,
  getOrbInfo,
  formatRarity,
  createInitialDailyQuests,
  createInitialWeeklyQuests,
  COSMETICS_LIST,
  rollContinuum,
  coinsForRarity,
  OFFLINE_TICK_MS,
  calculateCosmicDust,
  effectiveOfflineTickMs,
  critMultiplier,
  calculateLevelFromXp,
  applyLevelProgress,
  totalXpRequiredBeforeLevel,
  singularityTitheDustForRolls,
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
  MASTERY_SKILLS,
  masterySkillCost,
  getLevelBenefits,
  highestCodexChain,
  codexDevotionLuckPercent,
  altarCoinDevotionChancePercent,
  altarCoinFloor,
} from '../shared/game.js';
import {
  contribute,
  recordLeaderboard,
  applyGuildTax,
  getPlayerGuildPerks,
  getPlayerGuildCombo,
  addCommunityRolls,
  getCommunityEvent,
  getDailyStreakCommunity,
  addDailyStreakCommunityProgress,
} from './social.js';


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

function isValidGameBanRecord(value: unknown, key: string): value is GameBanRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ban = value as Record<string, unknown>;
  return typeof ban.userId === 'string' && ban.userId === key &&
    typeof ban.username === 'string' && ban.username.length > 0 &&
    Number.isFinite(ban.bannedAt) && Number(ban.bannedAt) >= 0 &&
    (ban.bannedUntil === null || (Number.isFinite(ban.bannedUntil) && Number(ban.bannedUntil) >= Number(ban.bannedAt))) &&
    typeof ban.reason === 'string' && typeof ban.bannedBy === 'string';
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

async function ensureRedisStringKey(keyName: string, fallback: string): Promise<void> {
  const existing = await redis.get(keyName);
  if (existing == null) {
    // Another request may initialize this key after our GET. NX prevents this
    // fallback write from overwriting a real value created in that interval.
    await redis.set(keyName, fallback, { nx: true });
  }
}

async function readGameBans(): Promise<Record<string, GameBanRecord>> {
  const raw = await redis.get(GAME_BANS_KEY);
  if (raw == null || raw === '') return {};
  const parsed = parseStoredJson<unknown>(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // Failing open here would silently treat every player as unbanned, while
    // later writes could erase the complete ban registry.
    throw new Error('Game ban list could not be read safely.');
  }
  return parsed as Record<string, GameBanRecord>;
}

async function mutateGameBans<T>(
  update: (bans: Record<string, GameBanRecord>) => { changed: boolean; result: T },
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const txn = await redis.watch(GAME_BANS_KEY);
    const raw = await redis.get(GAME_BANS_KEY);
    let bans: Record<string, GameBanRecord> = {};
    if (raw != null) {
      const parsed = parseStoredJson<unknown>(raw);
      if (
        !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        raw === '' ||
        !Object.entries(parsed as Record<string, unknown>).every(([userId, ban]) => isValidGameBanRecord(ban, userId))
      ) {
        await txn.unwatch();
        throw new Error('Game ban list could not be read safely. No changes were applied.');
      }
      bans = parsed as Record<string, GameBanRecord>;
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
  const durationDays =
    options.durationDays == null
      ? null
      : Math.max(1, Math.floor(Number(options.durationDays)));
  const ban: GameBanRecord = {
    userId: options.userId,
    username: options.username,
    bannedAt: Date.now(),
    bannedUntil: durationDays === null ? null : Date.now() + durationDays * 86_400_000,
    reason: String(options.reason ?? 'Game moderation action').slice(0, 300),
    bannedBy: String(options.bannedBy ?? context.username ?? 'Admin').slice(0, 100),
  };
  return mutateGameBans(bans => {
    bans[options.userId] = ban;
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
const ONLINE_WINDOW_MS = 30_000;

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

async function touchOnlinePresence(): Promise<number> {
  const userId = context.userId;
  if (!userId) return 1;
  const now = Date.now();
  await redis.zAdd(ONLINE_PLAYERS_KEY, { member: userId, score: now });
  await redis.zRemRangeByScore(ONLINE_PLAYERS_KEY, 0, now - ONLINE_WINDOW_MS);
  const ccu = Math.max(1, await redis.zCard(ONLINE_PLAYERS_KEY));
  void recordCcuPeak(ccu, now).catch(error => {
    console.error('Failed to record CCU peak:', error);
  });
  return ccu;
}

export async function getOnlinePlayers(): Promise<number> {
  return touchOnlinePresence();
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
const FRENZY_HANDOFF_PREFIX = 'io:frenzy:handoff:';
const FRENZY_HANDOFF_TTL_MS = 60_000;

function frenzyHandoffKey(userId: string): string {
  return FRENZY_HANDOFF_PREFIX + userId;
}

function isFrenzyTestAdmin(username?: string): boolean {
  const candidate = String(username ?? context.username ?? '')
    .trim()
    .replace(/^u\//i, '')
    .toLowerCase();
  return candidate === 'shadow_fen';
}

async function readFrenzyHandoff(userId: string): Promise<{ postId: string; expiresAt: number } | null> {
  const raw = await redis.get(frenzyHandoffKey(userId));
  const data = parseStoredJson<{ postId?: string; expiresAt?: number }>(raw);
  const postId = String(data?.postId ?? '').trim();
  const expiresAt = Number(data?.expiresAt ?? 0);
  if (!postId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    if (raw != null) await redis.del(frenzyHandoffKey(userId));
    return null;
  }
  return { postId, expiresAt };
}

export async function armOrbFrenzyClaim(): Promise<{ armed: true; postId: string }> {
  const postId = String(context.postId ?? '').trim();
  if (!postId) throw new Error('This is not an Orb Frenzy post.');

  const raw = await redis.get(FRENZY_POST_PREFIX + postId);
  if (!raw) throw new Error('This is not an Orb Frenzy post.');
  const data = parseStoredJson<{
    ownerId: string;
    createdAt?: number;
    adminTest?: boolean;
    inGame?: boolean;
  }>(raw);
  if (!data || data.inGame !== true) throw new Error('This is not an Orb Frenzy post.');

  const s = await settleOffline(await loadRaw());
  const now = Date.now();
  const createdAt = Number(data.createdAt ?? 0);
  if (isFrenzyPostExpired(createdAt, now)) throw new Error('This Frenzy has expired.');
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

  await redis.set(frenzyHandoffKey(currentUserId()), JSON.stringify({
    postId,
    expiresAt: Date.now() + FRENZY_HANDOFF_TTL_MS,
  }));
  return { armed: true, postId };
}

export async function getOrbFrenzyHandoff(): Promise<{ armed: boolean; postId?: string }> {
  const handoff = await readFrenzyHandoff(currentUserId());
  return handoff ? { armed: true, postId: handoff.postId } : { armed: false };
}

async function grantFrenzyOwnerReward(
  ownerId: string,
  amount = FRENZY_OWNER_SHARD_REWARD,
): Promise<number> {
  const safeOwnerId = String(ownerId ?? '').trim();
  if (!safeOwnerId || safeOwnerId === 'unknown') return 0;

  const ownerKey = playerKeyFor(safeOwnerId);
  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(ownerKey);
    const raw = await redis.get(ownerKey);
    if (raw == null) {
      await txn.unwatch();
      throw new Error('Frenzy owner save was not found.');
    }

    const ownerState = parsePlayerStateValue(raw);
    if (!ownerState) {
      await txn.unwatch();
      throw new Error('Frenzy owner save could not be read safely.');
    }

    const granted = grantFrenzyOwnerShards(ownerState, amount);
    const currentRevision = Math.max(
      0,
      Math.floor(Number(ownerState.stateRevision ?? 0)) || 0,
    );
    const nextState = { ...ownerState, stateRevision: currentRevision + 1 };

    await txn.multi();
    await txn.set(ownerKey, JSON.stringify(nextState));
    const committed = await txn.exec();
    if (committed !== null) return granted;
  }

  throw new Error('Could not safely grant the Frenzy owner reward.');
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

    if (
      record.luck && typeof record.luck === 'object' &&
      record.speed && typeof record.speed === 'object' &&
      record.crit && typeof record.crit === 'object'
    ) {
      return {
        luck: decayGlobalBoosterState(record.luck as GlobalBoosterSnapshot['luck'], now),
        speed: decayGlobalBoosterState(record.speed as GlobalBoosterSnapshot['speed'], now),
        crit: decayGlobalBoosterState(record.crit as GlobalBoosterSnapshot['crit'], now),
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

async function updateGlobalBooster(id: GlobalBoosterId): Promise<GlobalBoosterSnapshot> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const now = Date.now();
    const txn = await redis.watch(GLOBAL_BOOSTERS_KEY);
    const raw = await redis.get(GLOBAL_BOOSTERS_KEY);

    await appendGlobalBoosterDebugLog('activate:redis-read', {
      id,
      attempt,
      key: GLOBAL_BOOSTERS_KEY,
      rawType: typeof raw,
      rawIsNull: raw == null,
      rawValue: summarizeGlobalBoosterRaw(raw),
    });

    const current = raw == null ? createInitialGlobalBoosters(now) : parseGlobalBoosterSnapshot(raw, now);
    if (!current) {
      await txn.unwatch();
      throw new Error('Global Booster state could not be read safely. No changes were written.');
    }
    const before = current[id];
    const after = activateGlobalBoosterStack(before, now, id === 'speed' ? 10 : Number.MAX_SAFE_INTEGER);
    current[id] = after;

    await appendGlobalBoosterDebugLog('activate:state-computed', {
      id,
      attempt,
      before,
      after,
    });

    await txn.multi();
    await txn.set(GLOBAL_BOOSTERS_KEY, JSON.stringify(current));
    const committed = await txn.exec();

    if (committed !== null) {
      const verifiedRaw = await redis.get(GLOBAL_BOOSTERS_KEY);
      const verified = parseGlobalBoosterSnapshot(verifiedRaw, Date.now()) ?? current;
      await appendGlobalBoosterDebugLog('activate:global-write-success', {
        id,
        attempt,
        committed: true,
        verifiedRawType: typeof verifiedRaw,
        verifiedRaw: summarizeGlobalBoosterRaw(verifiedRaw),
        verifiedSnapshot: verified,
      });
      return verified;
    }

    await appendGlobalBoosterDebugLog('activate:global-write-conflict', { id, attempt });
  }

  await appendGlobalBoosterDebugLog('activate:global-write-exhausted', { id });
  throw new Error('The Global Booster was activated by another player. Please try again.');
}

export async function setGlobalBoosterDebugState(
  id: GlobalBoosterId,
  tier: number,
  minutes: number,
): Promise<{ tier: number; activationProgress: number; endsAt: number }> {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(GLOBAL_BOOSTERS, id)) {
    throw new Error('Unknown Global Booster.');
  }
  if (!Number.isFinite(tier) || tier < 0 || !Number.isFinite(minutes) || minutes < 1 || minutes > 10_080) {
    throw new Error('Global Booster debug tier or duration is invalid.');
  }
  const safeTier = Math.floor(tier);
  const safeMinutes = Math.floor(minutes);
  for (let attempt = 0; attempt < 8; attempt++) {
    const now = Date.now();
    const txn = await redis.watch(GLOBAL_BOOSTERS_KEY);
    const raw = await redis.get(GLOBAL_BOOSTERS_KEY);
    const snapshot = raw == null ? createInitialGlobalBoosters(now) : parseGlobalBoosterSnapshot(raw, now);
    if (!snapshot) {
      await txn.unwatch();
      throw new Error('Global Booster state could not be read safely. No changes were written.');
    }
    const previous = snapshot[id];
    const cappedTier = id === 'speed' ? Math.min(10, safeTier) : safeTier;
    const next = {
      tier: cappedTier,
      activationProgress: 0,
      endsAt: cappedTier === 0 ? 0 : now + safeMinutes * 60_000,
    };
    snapshot[id] = { ...snapshot[id], ...next };
    await txn.multi();
    await txn.set(GLOBAL_BOOSTERS_KEY, JSON.stringify(snapshot));
    const committed = await txn.exec();
    if (committed !== null) {
      await appendGlobalBoosterDebugLog('admin:set', { id, previous, next, minutes: safeMinutes, key: GLOBAL_BOOSTERS_KEY });
      return next;
    }
  }
  throw new Error('Global Booster state changed repeatedly. Refresh and retry.');
}

function playerKeyFor(userId: string): string {
  return `player:${userId}`;
}

const PLAYTIME_ACTIVE_GAP_MS = 5 * 60_000;

interface PlayerRegistryEntry {
  username: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastLoginAt?: number;
  lastActivityAt?: number;
  playtimeMs?: number;
}

async function touchPlayerActivity(userId: string, username: string, now = Date.now()): Promise<number> {
  // Keep the per-user registry read/modify/write serialized independently from
  // the player-save lock so save() can call this without re-entering that lock.
  return withPlayerMutationLockFor(`activity:${userId}`, async () => {
    let firstSeenAt = now;
    let lastLoginAt = now;
    let playtimeMs = 0;

    const existingRaw = await redis.hGet(PLAYER_REGISTRY_KEY, userId);
    let previousActivityAt = 0;
    if (existingRaw) {
      const existing = parseStoredJson<Partial<PlayerRegistryEntry>>(existingRaw);
      firstSeenAt = Math.max(0, Number(existing?.firstSeenAt ?? now) || now);
      previousActivityAt = Math.max(
        0,
        Number(existing?.lastActivityAt ?? existing?.lastSeenAt ?? 0) || 0,
      );
      const previousPlaytimeMs = Math.max(0, Number(existing?.playtimeMs ?? 0) || 0);
      const activityAt = Math.max(now, Date.now(), previousActivityAt);
      const activityDelta = previousActivityAt > 0
        ? Math.min(PLAYTIME_ACTIVE_GAP_MS, Math.max(0, activityAt - previousActivityAt))
        : 0;

      playtimeMs = previousPlaytimeMs + activityDelta;
      if (activityAt - previousActivityAt <= PLAYTIME_ACTIVE_GAP_MS && Number(existing?.lastLoginAt ?? 0) > 0) {
        lastLoginAt = Number(existing?.lastLoginAt);
      }
      now = activityAt;
    } else {
      now = Math.max(now, Date.now());
    }

    await redis.hSet(PLAYER_REGISTRY_KEY, {
      [userId]: JSON.stringify({
        username: String(username).trim().slice(0, 100),
        firstSeenAt,
        lastSeenAt: now,
        lastLoginAt,
        lastActivityAt: now,
        playtimeMs,
      } satisfies PlayerRegistryEntry),
    });

    return playtimeMs;
  });
}

async function registerPlayer(userId: string, username: string): Promise<void> {
  await touchPlayerActivity(userId, username);
}

export async function recordPlayerHeartbeat(): Promise<{ playtimeMs: number }> {
  const userId = currentUserId();
  const username = String(context.username ?? `reddit-user-${userId.slice(-8)}`);
  return { playtimeMs: await touchPlayerActivity(userId, username) };
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
  totalRolls: number;
  highestRarity: number;
  coins: number;
  shards: number;
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
      Number(registry.lastSeenAt ?? 0) || 0,
      Number(save?.lastSeenAt ?? 0) || 0,
    );
    return {
      userId,
      username: String(registry.username ?? save?.username ?? ('user-' + userId.slice(-8))).trim().slice(0, 100),
      firstSeenAt: Math.max(0, Number(registry.firstSeenAt ?? 0) || 0),
      lastSeenAt,
      active: lastSeenAt >= now - 30_000,
      level: Math.max(1, Number(save?.level ?? 1) || 1),
      xp: Math.max(0, Number(save?.xp ?? 0) || 0),
      playtimeMs: Math.max(0, Number(registry.playtimeMs ?? 0) || 0),
      totalRolls: Math.max(0, Number(save?.totalRolls ?? 0) || 0),
      highestRarity: Math.max(0, Number(save?.highestRarity ?? 0) || 0),
      coins: Math.max(0, Number(save?.coins ?? 0) || 0),
      shards: Math.max(0, Number(save?.shards ?? 0) || 0),
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
      Number(entry.lastSeenAt ?? 0) || 0,
      Number(entry.lastActivityAt ?? 0) || 0,
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
  // Redis/proxy wrapper such as { value: '...' } for the save itself.
  if ('coins' in record && 'shards' in record && 'totalRolls' in record) {
    return record as unknown as PlayerState;
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
    const looksLikePlayerState =
      'coins' in record ||
      'shards' in record ||
      'totalRolls' in record ||
      'username' in record ||
      'saveGeneration' in record ||
      'upgrades' in record ||
      'collection' in record ||
      'paymentReceipts' in record;

    if (looksLikePlayerState) {
      const base = createInitialState();
      const upgrades = record.upgrades && typeof record.upgrades === 'object' && !Array.isArray(record.upgrades)
        ? record.upgrades as Record<string, unknown>
        : {};
      const prestigeUpgrades = record.prestigeUpgrades && typeof record.prestigeUpgrades === 'object' && !Array.isArray(record.prestigeUpgrades)
        ? record.prestigeUpgrades as Record<string, unknown>
        : {};

      return {
        ...base,
        ...record,
        upgrades: { ...base.upgrades, ...upgrades },
        prestigeUpgrades: { ...base.prestigeUpgrades, ...prestigeUpgrades },
        collection: (record.collection && typeof record.collection === 'object' && !Array.isArray(record.collection))
          ? record.collection as Record<string, number>
          : base.collection,
        claimedAchievements: Array.isArray(record.claimedAchievements)
          ? record.claimedAchievements as string[]
          : base.claimedAchievements,
        unlockedCosmetics: Array.isArray(record.unlockedCosmetics)
          ? record.unlockedCosmetics as string[]
          : base.unlockedCosmetics,
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

    state.stateRevision = Math.max(0, Math.floor(Number(state.stateRevision ?? 0)) || 0) + 1;
    state.shards = (state.shards ?? 0) + pack.shards;
    state.purchasedShards = (state.purchasedShards ?? 0) + pack.shards;
    state.lifetimeShards = (state.lifetimeShards ?? 0) + pack.shards;
    state.globalBoosterCredits = (state.globalBoosterCredits ?? 0) + pack.globalBoosterCredits;
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
  for (let attempt = 0; attempt < 4; attempt++) {
    const txn = await redis.watch(pkey);
    const raw = await redis.get(pkey);
    if (raw == null) {
      await txn.unwatch();
      return;
    }
    const state = parsePaymentPlayerState(raw);
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

    // New receipts store the exact entitlement granted by this order. Old
    // status-only receipts migrate using the verified SKU payload.
    const grantedShards = typeof receipt === 'string' ? pack.shards : receipt.shards;
    const refundableShards = Math.min(state.purchasedShards ?? 0, grantedShards);
    state.shards = Math.max(0, (state.shards ?? 0) - refundableShards);
    state.purchasedShards = Math.max(0, (state.purchasedShards ?? 0) - refundableShards);

    const grantedCredits = typeof receipt === 'string'
      ? pack.globalBoosterCredits
      : Math.max(0, Number(receipt.globalBoosterCredits ?? 0) || 0);
    const refundableCredits = Math.min(state.globalBoosterCredits ?? 0, grantedCredits);
    state.globalBoosterCredits = Math.max(0, (state.globalBoosterCredits ?? 0) - refundableCredits);

    state.stateRevision = Math.max(0, Math.floor(Number(state.stateRevision ?? 0)) || 0) + 1;
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

export async function loadRaw(): Promise<PlayerState> {
  const userId = currentUserId();
  const playerKey = key();
  const generationKey = saveGenerationKeyFor(userId);
  const generationRaw = await redis.get(generationKey);
  const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
  const raw = await redis.get(playerKey);
  const username = context.username ?? `reddit-user-${userId.slice(-8)}`;
  await registerPlayer(userId, username);
  const [perks, guildCombo, globalBoosters, dailyStreakCommunity] = await Promise.all([
    getPlayerGuildPerks(username, userId),
    getPlayerGuildCombo(username, userId),
    getGlobalBoosters(),
    getDailyStreakCommunity().catch(error => {
      if (!(error instanceof Error) || !error.message.startsWith('Stored Daily Streak event is invalid.')) throw error;
      console.error('[Player Load] Daily Streak community projection is unavailable:', error.message);
      // Keep the corrupt global bytes untouched. This fallback is display-only;
      // the claim/progression API continues to fail closed until repaired.
      return createInitialDailyStreakCommunity();
    }),
  ]);


  if (!raw) {
    const s = createInitialState();
    s.username = username;
    s.saveGeneration = generation;
    s.guildPerks = perks;
    s.guildCombo = guildCombo;
    s.globalBoosters = globalBoosters;
    s.dailyStreakCommunity = dailyStreakCommunity;

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
    fresh.guildPerks = perks;
    fresh.guildCombo = guildCombo;
    fresh.globalBoosters = globalBoosters;
    fresh.dailyStreakCommunity = dailyStreakCommunity;

    return fresh;
  }

  const base = createInitialState();
  const cleanParsed = { ...(parsed as PlayerState & Record<string, unknown>) };
  const normalizedManualRolls = Math.max(
    0,
    Math.min(
      10,
      Number(
        parsed.manualRolls ??
        Math.min(Number(parsed.totalRolls ?? 0), 10),
      ) || 0,
    ),
  );
  const normalizedUpgrades = {
    ...base.upgrades,
    ...(parsed.upgrades ?? {}),
    // Auto Roll is free and unlocks automatically at 3 manual roll activations.
    auto: normalizedManualRolls >= 3 ? 1 : 0,
  };

  const parsedLevel = Math.max(1, Math.min(1000, Math.floor(Number(parsed.level ?? 1) || 1)));
  const parsedXp = Math.max(0, Number(parsed.xp ?? 0) || 0);
  const calculatedLevel = calculateLevelFromXp(parsedXp).level;
  const storedLevelXpFloor = Number(parsed.levelXpFloor);
  const levelXpFloor = Number.isFinite(storedLevelXpFloor)
    ? Math.max(0, Math.min(parsedXp, storedLevelXpFloor))
    : parsedLevel > calculatedLevel
      ? parsedXp
      : totalXpRequiredBeforeLevel(parsedLevel);

  return {
    ...base,
    ...cleanParsed,
    level: parsedLevel,
    xp: parsedXp,
    levelXpFloor,
    upgrades: normalizedUpgrades,
    manualRolls: normalizedManualRolls,
    saveGeneration: generation,
    username,
    prestigeUpgrades: { ...base.prestigeUpgrades, ...(parsed.prestigeUpgrades ?? {}) },
    collection: parsed.collection ?? {},
    claimedAchievements: parsed.claimedAchievements ?? [],
    streak: { ...base.streak, ...(parsed.streak ?? {}) },
    dailyQuests: parsed.dailyQuests?.length ? parsed.dailyQuests : base.dailyQuests,
    weeklyQuests: parsed.weeklyQuests?.length ? parsed.weeklyQuests : base.weeklyQuests,
    unlockedCosmetics: parsed.unlockedCosmetics?.length ? parsed.unlockedCosmetics : base.unlockedCosmetics,
    sacrifices: {
      coinsSacrificed: parsed.sacrifices?.coinsSacrificed ?? base.sacrifices!.coinsSacrificed,
      shardsSacrificed: parsed.sacrifices?.shardsSacrificed ?? base.sacrifices!.shardsSacrificed,
      altarLevel: parsed.sacrifices?.altarLevel ?? base.sacrifices!.altarLevel,
      luckSurgeUntil: parsed.sacrifices?.luckSurgeUntil ?? base.sacrifices!.luckSurgeUntil,
      altarPity: parsed.sacrifices?.altarPity ?? base.sacrifices!.altarPity ?? 0,
    },
    masterySkills: { ...base.masterySkills!, ...(parsed.masterySkills ?? {}) } as Record<MasterySkillId, number>,
    masteryPoints: parsed.masteryPoints ?? base.masteryPoints ?? 1,
    guildPerks: perks,
    guildCombo,
    globalBoosters,
    dailyStreakCommunity,
  };
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
  if (
    !Number.isSafeInteger(s.streak.count) ||
    s.streak.count < 0 ||
    !Number.isSafeInteger(s.streak.longestStreak) ||
    s.streak.longestStreak < 0
  ) {
    throw new Error('Daily streak data is invalid. Please retry later.');
  }
  if (s.streak.lastClaimDate === today) throw new Error('Already claimed daily reward for today.');

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const nextStreakCount = s.streak.lastClaimDate === yesterday ? s.streak.count + 1 : 1;
  if (!Number.isSafeInteger(nextStreakCount)) {
    throw new Error('Daily streak data is invalid. Please retry later.');
  }

  // Validate/commit the shared progression before mutating player rewards. If
  // the shared projection is corrupt, the player save remains untouched.
  const community = await addDailyStreakCommunityProgress(nextStreakCount);
  const day = ((nextStreakCount - 1) % 7) + 1;
  const rewardCoins = day * 100;
  const rewardShards = grantFreeShards(s, day === 7 ? 5 : day === 3 ? 1 : 0);
  const rewardFreeRolls = day * 5;
  s.streak.count = nextStreakCount;
  s.streak.longestStreak = Math.max(s.streak.longestStreak, nextStreakCount);
  s.streak.lastClaimDate = today;
  s.freeRolls = (s.freeRolls ?? 0) + rewardFreeRolls;
  addCoins(s, rewardCoins);
  s.dailyStreakCommunity = community;
  return { rewardCoins, rewardShards, rewardFreeRolls, day, community };
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

async function processAutomation(s: PlayerState): Promise<void> {
  if (s.automations?.autoStreakClaim) {
    const today = new Date().toISOString().slice(0, 10);
    if (s.streak.lastClaimDate !== today) {
      try {
        await claimDailyStreakFromState(s);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Stored Daily Streak event is invalid.')) {
          // A corrupt shared projection must not prevent unrelated game loads.
          // The player reward was not mutated because the projection is checked first.
          console.error('[Automation] Daily Streak auto-claim skipped:', error.message);
        } else {
          throw error;
        }
      }
    }
  }

  if (s.automations?.autoQuestClaim) {
    const quests = [...s.dailyQuests, ...s.weeklyQuests]
      .filter(q => q.unlocked !== false && !q.claimed && q.progress >= q.target)
      .slice(0, 25);
    for (const q of quests) {
      applyQuestReward(s, q);
    }
  }

  if (s.automations?.autoCommunityClaim) {
    await claimCommunityRewardFromState(s);
  }

  if (s.automations?.autoOfflineClaim && s.offlineRolls > 0) {
    const batches = s.offlineRolls;
    s.offlineRolls = 0;
    await applyRolls(s, batches, undefined, 'offline');
    s.lastRollAt = Date.now();
  }

  if (s.automations?.autoUpgrade) {
    autoBuyCheapest(s);
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
  const username = String(context.username ?? s.username ?? '').trim();
  const subredditName = String(context.subredditName ?? '').trim();
  if (!username || !subredditName) return;

  const highestRarity = Math.max(2, Math.floor(Number(s.highestRarity ?? 2) || 2));
  const orbInfo = getOrbInfo(highestRarity);
  const flairText = orbInfo.tier;
  const backgroundColor = orbInfo.color;
  const textColor = flairTextColorForBackground(backgroundColor);
  const flairKey = PLAYER_FLAIR_KEY_PREFIX + currentUserId();
  const flairState = JSON.stringify({
    text: flairText,
    backgroundColor,
    textColor,
  });

  try {
    const current = await redis.get(flairKey);
    if (String(current ?? '') === flairState) return;

    await reddit.setUserFlair({
      subredditName,
      username,
      text: flairText,
      backgroundColor,
      textColor,
    });
    await redis.set(flairKey, flairState);
  } catch (error) {
    console.error('[Rarity Flair] Failed to update user flair:', error);
  }
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
    const raw = await redis.get(ticketKey);
    const current = parseStoredJson<RollTicket>(raw);

    if (
      current &&
      typeof current.id === 'string' &&
      current.id.length > 0 &&
      Number.isSafeInteger(current.nextIndex) &&
      current.nextIndex >= 0 &&
      current.nextIndex < ROLL_TICKET_COUNT &&
      Number.isSafeInteger(current.expiresAt) &&
      current.expiresAt > now
    ) {
      await txn.unwatch();
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
    if (committed !== null) {
      return {
        ticketId: ticket.id,
        nextIndex: 0,
        rollsRemaining: ROLL_TICKET_COUNT,
        expiresAt: ticket.expiresAt,
      };
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

  if (
    !raw ||
    !ticket ||
    typeof ticket.id !== 'string' ||
    ticket.id.length === 0 ||
    !Number.isSafeInteger(ticket.nextIndex) ||
    !Number.isSafeInteger(ticket.expiresAt)
  ) {
    throw new Error('Roll prediction ticket is unavailable. Refresh the game.');
  }
  if (ticket.id !== ticketId) throw new Error('Roll prediction ticket is stale. Refresh the game.');
  if (ticket.expiresAt <= Date.now()) throw new Error('Roll prediction ticket expired. Refresh the game.');
  if (ticketIndex !== ticket.nextIndex) throw new Error('Roll prediction ticket is out of order. Refresh the game.');
  if (ticketIndex < 0 || ticketIndex >= ROLL_TICKET_COUNT) {
    throw new Error('Roll prediction ticket is exhausted. Refresh the game.');
  }

  return { ticket, raw };
}

export async function save(
  s: PlayerState,
  extraWrite?: { key: string; expectedValue: string | null; nextValue: string; conflictMessage?: string },
) {
  const userId = currentUserId();
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
    const watchedKeys = extraWrite ? [playerKey, generationKey, extraWrite.key] : [playerKey, generationKey];
    const txn = await redis.watch(...watchedKeys);
    // Devvit's TxClient is a command builder after WATCH/MULTI. Reads must use
    // the Redis client itself, while WATCH keeps these keys protected until EXEC.
    const latestRaw = await redis.get(playerKey);
    const generationRaw = await redis.get(generationKey);
    const extraRaw = extraWrite ? await redis.get(extraWrite.key) : null;

    if (extraWrite && extraRaw !== extraWrite.expectedValue) {
      await txn.unwatch();
      throw new Error(extraWrite.conflictMessage ?? 'Roll prediction ticket changed. Refresh the game.');
    }
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
      // This request started before an admin wipe. Discard its stale mutation
      // Never let an old request resurrect pre-wipe data or report a
      // mutation that was discarded because an admin wipe changed generation.
      await txn.unwatch();
      throw new Error('Your Infinity Orbs save was invalidated by an admin wipe. Please reload.');
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
    if (extraWrite) await txn.set(extraWrite.key, extraWrite.nextValue);
    const committed = await txn.exec();
    if (committed !== null) {
      Object.assign(s, nextState);
      // Clear offline-full reminders only after the save that consumes the
      // rolls commits. This also covers automation paths that mutate rolls
      // during settlement and may otherwise throw before their caller saves.
      if (latest && Number(latest.offlineRolls ?? 0) > 0 && Number(nextState.offlineRolls ?? 0) <= 0) {
        await Promise.all([
          redis.del(OFFLINE_FULL_NOTIFICATION_PREFIX + userId).catch(error => {
            console.error('[Offline Rolls] Could not clear full notification after save:', error);
          }),
          redis.del(OFFLINE_FULL_JOB_PREFIX + userId).catch(error => {
            console.error('[Offline Rolls] Could not clear scheduled job after save:', error);
          }),
        ]);
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
  }

  throw new Error('Could not safely save player data. Please retry.');
}

function serverRandom(): number {
  // Use 64 bits of entropy so the extended rarity continuum is actually
  // reachable. A 32-bit sample bottoms out around 1 / 4.3 billion, which made
  // the upper rarity tiers mathematically decorative.
  const sample = new BigUint64Array(1);
  globalThis.crypto.getRandomValues(sample);
  const denominator = 18_446_744_073_709_551_616;
  const value = Number(sample[0]) / denominator;
  if (value >= 1) return 0.9999999999999999;
  // Clamp zero to the smallest discrete 64-bit sampling step.
  return Math.max(1 / denominator, value);
}

function finiteNonNegativeInteger(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}
function addCoins(s: PlayerState, amount: number): number {
  const gain = finiteNonNegativeInteger(amount);
  if (gain <= 0) return 0;
  s.coins += gain;
  s.lifetimeCoins = (s.lifetimeCoins ?? 0) + gain;
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

export async function applyRolls(
  s: PlayerState,
  activationCount = 1,
  forcedRarity?: number,
  source: 'online' | 'offline' = 'online',
  rollCountOverride?: number,
  randomOverride?: () => number,
): Promise<{ bestOrb: Orb; batch: Orb[]; totalVal: number; coinsGained: number; shardsGained: number; xpGained: number; rollCount: number }> {
  let bestRarity = 0;
  let bestIsCrit = false;
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
  const rng = randomOverride ?? serverRandom;

  // Astral Magnetism proc: chance for multi-rolls to pull 2 bonus orbs
  const magnetLevel = s.prestigeUpgrades?.stellarMagnet ?? 0;
  if (rollCount > 1 && magnetLevel > 0 && rng() < 0.10 * magnetLevel) {
    rollCount += 2;
  }


  // These reads are independent. Keep them parallel so a roll does not spend
  // several sequential Redis round trips before it can even start rolling.
  const [freshGlobalBoosters, worldEvent, fakeCcuBonus] = await Promise.all([
    getGlobalBoosters(),
    getCommunityEvent(),
    getFakeCcuBonus(),
  ]);
  s.globalBoosters = freshGlobalBoosters;
  const globalBoosters = s.globalBoosters;
  const communityLuck = worldEvent.buffMultiplier ?? 1.15;

  // Fake CCU is an admin testing offset applied only to this player's luck calculation.
  // The underlying CCU metric and historical peaks always remain based on real players.
  const luckCcu = Math.max(1, Math.floor((s.onlinePlayers ?? 1) + fakeCcuBonus));
  const luckState = luckCcu === (s.onlinePlayers ?? 1) ? s : { ...s, onlinePlayers: luckCcu };
  // Community Luck is another additive source, kept transient rather than persisted.
  const baseLuck = luckMultiplier(luckState) + Math.max(0, communityLuck - 1);

  // Apex Fortune Mastery: chance on multi-roll to double the luck of that activation
  const apexChance = Math.min(0.45, (s.masterySkills?.apexFortune ?? 0) * 0.03);
  const isApex = rollCount > 1 && rng() < apexChance;
  const effectiveLuck = isApex ? baseLuck * 2 : baseLuck;

  const cm = critMultiplier(s);
  const levelBenefits = getLevelBenefits(s.level || 1);
  const valueMul =
    1 +
    (s.upgrades.valueBonus ?? 0) * 0.10 +
    (s.prestigeUpgrades?.cosmicValuation ?? 0) * 0.05;

  const critChance =
    (s.upgrades.critChance ?? 0) * 0.03 +
    (s.masterySkills?.critMastery ?? 0) * 0.03 +
    (s.guildPerks?.critRank ?? 0) * 0.015 +
    globalBoosterCritChanceBonus(globalBoosters.crit) +
    guildComboCritChanceBonus(s.guildCombo);
  const effectiveCritChance = Math.min(0.40, critChance);

  for (let i = 0; i < rollCount; i++) {
    // New-player hype: the third Orb this account ever rolls is guaranteed
    // to land in the 1/101 through 1/120 range. It cannot crit upward, so the
    // guarantee is the exact advertised range.
    const isGuaranteedThirdBall = forcedRarity == null && s.totalRolls + i === 2;

    const isCrit = !isGuaranteedThirdBall && rng() < effectiveCritChance;
    let effectiveCm = cm;
    if (isCrit) {
      s.totalCrits = (s.totalCrits ?? 0) + 1;
      const supernovaLevel = s.prestigeUpgrades?.supernova ?? 0;
      if (supernovaLevel > 0 && rng() < supernovaLevel * 0.10) {
        effectiveCm = 5; // Supernova always resolves to exactly 5x the base rarity.
      }
    }

    // Continuum RNG generation with effective luck. Luck reshapes the tail;
    // it does not multiply the final rarity directly.
    // The third lifetime Orb overrides the random result with a guaranteed beginner drop.
    const minimumRarity = 2 + (s.prestigeUpgrades?.luckyFloor ?? 0);
    const beginnerRarity = 101 + Math.floor(rng() * 20);
    const rolledRarity = isGuaranteedThirdBall
      ? beginnerRarity
      : (forcedRarity && i === 0)
        ? forcedRarity
        : Math.max(minimumRarity, rollContinuum(effectiveLuck, rng));
    const baseRarity = Math.max(minimumRarity, rolledRarity);
    const rarity = isCrit ? Math.min(1_000_000_000_000_000, Math.round(baseRarity * effectiveCm)) : baseRarity;
    const finalVal = Math.round(rarity * valueMul);

    totalVal += finalVal;
    rarities.push(rarity);
    s.totalRolls++;
    s.currentRunRolls = (s.currentRunRolls ?? 0) + 1;
    s.collectionValue = (s.collectionValue ?? 0) + finalVal;
    s.lifetimeCollectionValue = (s.lifetimeCollectionValue ?? 0) + finalVal;

    const isNew = !s.collection[String(rarity)];
    if (isNew) uniqueGained++;
    s.collection[String(rarity)] = (s.collection[String(rarity)] ?? 0) + 1;

    if (rarity > s.highestRarity) {
      s.highestRarity = rarity;
      s.rollsSinceBest = 0;
    } else {
      s.rollsSinceBest = (s.rollsSinceBest ?? 0) + 1;
      s.highestDryStreak = Math.max(s.highestDryStreak ?? 0, s.rollsSinceBest);
    }

    if (rarity > bestRarity) {
      bestRarity = rarity;
      bestIsCrit = isCrit;
    } else if (rarity === bestRarity && isCrit) {
      bestIsCrit = true;
    }

    const xpBonusMul =
      (1 + (s.upgrades.xpBonus ?? 0) * 0.20) *
      levelBenefits.xpMultiplier;
    const earnedXp = Math.round(Math.min(300, 12 + Math.floor(Math.log10(rarity + 1) * 12)) * xpBonusMul);

    // Shards bonus for rare orbs (1,000+)
    let earnedShards = 0;
    if (rarity >= 1_000_000) earnedShards = 10;
    else if (rarity >= 100_000) earnedShards = 5;
    else if (rarity >= 10_000) earnedShards = 2;
    else if (rarity >= 1_000) earnedShards = 1;

    // Shard Chance upgrade + Mastery + Guild perk proc
    const shardProcChance = Math.min(
      1,
      (s.upgrades.shardChance ?? 0) * 0.0015 +
      (s.masterySkills?.shardAttunement ?? 0) * 0.001 +
      (s.guildPerks?.shardRank ?? 0) * 0.0005 +
      (s.prestigeUpgrades?.shardResonator ?? 0) * 0.0025 +
      levelBenefits.shardChance
    );
    if (rng() < shardProcChance) {
      earnedShards += 1;
    }

    shardsGained += earnedShards;
    xpGained += earnedXp;

    const orbInfo = getOrbInfo(rarity);
    if (batch.length < 50) {
      batch.push({
        rarity,
        rolledAt: now,
        tier: orbInfo.tier,
        name: orbInfo.name,
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
    (1 + (s.guildPerks?.coinRank ?? 0) * 0.10);
  coinsGained = Math.round(coinsGained * coinBonusMul);

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
        shardsGained += 1;
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

  const guildTax = await applyGuildTax(coinsGained);
  coinsGained = Math.max(0, coinsGained - guildTax.taxedCoins);
  s.coins += coinsGained;
  shardsGained = grantRollShards(s, shardsGained);

  // Ascension increases XP by 10× while preserving the existing level logic.
  const effectiveXpGained = isPremiumBoosterActive(s, 'ascension') ? xpGained * 10 : xpGained;
  s.xp += effectiveXpGained;
  xpGained = effectiveXpGained;

  // Rich EXP Level Progression. Normal roll activations deliberately advance
  // at most one level at a time, while applyXp/quest rewards can catch up safely.
  applyLevelProgress(s, 1);
  s.lifetimeCoins = (s.lifetimeCoins ?? 0) + coinsGained;

  // Singularity Tithe pays +1 Cosmic Dust per 200 processed rolls per level.
  // Every processed orb counts, including multi-roll, auto-roll, offline, and Frenzy rolls.
  const titheLevel = s.prestigeUpgrades?.singularityTithe ?? 0;
  if (titheLevel > 0 && rollCount > 0) {
    const before = Math.max(0, Math.floor(s.singularityTitheSingleRolls ?? 0));
    s.singularityTitheSingleRolls = before + rollCount;
    const dustEarned = singularityTitheDustForRolls(before, rollCount, titheLevel);
    if (dustEarned > 0) s.cosmicDust = (s.cosmicDust ?? 0) + dustEarned;
  }

  // Mastery Engine: permanent Mastery Point income from sustained rolling.
  const masteryEngineLevel = s.prestigeUpgrades?.masteryEngine ?? 0;
  if (masteryEngineLevel > 0) {
    const interval = Math.max(1, Math.floor(100 / masteryEngineLevel));
    const before = Math.floor((s.totalRolls - rollCount) / interval);
    const after = Math.floor(s.totalRolls / interval);
    if (after > before) s.masteryPoints = (s.masteryPoints ?? 0) + (after - before);
  }

  // Celestial Auto-Buyer Prestige Upgrade: auto-buy cheapest affordable upgrade
  const autoBuyerLevel = s.prestigeUpgrades?.autoBuyer ?? 0;
  if (autoBuyerLevel > 0 && s.coins > 50) {
    autoBuyCheapest(s);
  }

  advanceQuestProgress(s, 'roll', rollCount);
  if (bestRarity >= 100) advanceQuestProgress(s, 'rare', bestRarity);
  advanceQuestProgress(s, 'value', totalVal);
  advanceQuestProgress(s, 'unique', uniqueGained);

  await contribute(totalVal, rollCount, bestRarity);
  await addCommunityRolls(rollCount);

  const bestInfo = getOrbInfo(bestRarity);
  const bestOrb: Orb = {
    rarity: bestRarity,
    rolledAt: now,
    tier: bestInfo.tier,
    name: bestInfo.name,
    isNew: s.collection[String(bestRarity)] === 1,
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

async function sendOfflineFullNotification(userId: string, subredditName: string): Promise<boolean> {
  const notificationKey = OFFLINE_FULL_NOTIFICATION_PREFIX + userId;
  if (await redis.get(notificationKey)) return false;

  if (!(await notifications.isOptedIn(userId))) return false;

  await notifications.enqueue({
    title: 'Infinity Orbs',
    body: 'your offline orbs are full, make sure to collect them! ',
    recipients: [{
      userId,
      link: `https://reddit.com/r/${subredditName}`,
    }],
  });
  await redis.set(notificationKey, '1');
  return true;
}

async function scheduleOfflineFullNotification(
  userId: string,
  subredditName: string,
  runAt: number,
): Promise<void> {
  if (!subredditName || !userId) return;
  if (await redis.get(OFFLINE_FULL_NOTIFICATION_PREFIX + userId)) return;
  if (!(await notifications.isOptedIn(userId))) return;

  const jobKey = OFFLINE_FULL_JOB_PREFIX + userId;
  if (await redis.get(jobKey)) return;

  const safeRunAt = Math.max(Date.now() + 1_000, runAt);
  const jobId = await context.scheduler.runJob({
    name: 'offline-orbs-full',
    data: { userId, subredditName },
    runAt: new Date(safeRunAt),
  });
  await redis.set(jobKey, jobId);
}

export async function processOfflineFullNotification(
  userId: string,
  subredditName: string,
): Promise<void> {
  const jobKey = OFFLINE_FULL_JOB_PREFIX + userId;
  if (!(await redis.get(jobKey))) return;

  const raw = await redis.get('player:' + userId);
  if (!raw) {
    await redis.del(jobKey);
    return;
  }

  let s: PlayerState;
  try {
    s = JSON.parse(String(raw)) as PlayerState;
  } catch {
    await redis.del(jobKey);
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
    await redis.del(jobKey);
    await scheduleOfflineFullNotification(userId, subredditName, fullAt);
    return;
  }

  try {
    await sendOfflineFullNotification(userId, subredditName);
    await redis.del(jobKey);
  } catch (error) {
    console.error('Failed to send scheduled offline-orbs-full notification:', error);
    await redis.del(jobKey);
    await scheduleOfflineFullNotification(userId, subredditName, now + OFFLINE_FULL_RETRY_MS);
  }
}

export async function settleOffline(s: PlayerState): Promise<PlayerState> {
  const now = Date.now();
  checkPeriodicResets(s, now);
  resetFreeShardBudgetIfNeeded(s, now);
  s.onlinePlayers = await touchOnlinePresence();
  s.globalBoosters = await getGlobalBoosters();

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
  await processAutomation(s);

  const cap = offlineRollCap(s);
  const userId = String(context.userId ?? '').trim();
  const subredditName = String(context.subredditName ?? '').trim();
  if (userId && subredditName && s.offlineRolls >= cap) {
    try {
      await sendOfflineFullNotification(userId, subredditName);
      await redis.del(OFFLINE_FULL_JOB_PREFIX + userId);
    } catch (error) {
      console.error('Failed to send offline-orbs-full notification:', error);
    }
  } else if (userId && subredditName) {
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
  const s = await loadRaw();
  const offset = Math.max(0, Math.floor(Number(options.offset ?? 0)));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit ?? 60))));
  const sort = options.sort ?? 'rarity_desc';
  const tier = String(options.tier ?? 'all');

  let entries = Object.entries(s.collection ?? {})
    .map(([rarityStr, count]) => ({ rarity: Number(rarityStr), count: Number(count) }))
    .filter(item => Number.isFinite(item.rarity) && item.count > 0);

  if (tier !== 'all') {
    entries = entries.filter(item => getOrbInfo(item.rarity).tier === tier);
  }

  entries.sort((a, b) => {
    if (sort === 'rarity_asc') return a.rarity - b.rarity;
    if (sort === 'count') return b.count - a.count || b.rarity - a.rarity;
    return b.rarity - a.rarity;
  });

  return {
    items: entries.slice(offset, offset + limit),
    total: entries.length,
    offset,
    limit,
  };
}

export async function getState(): Promise<PlayerState> {
  // GET /api/me must remain a read operation. Previously this path called
  // settleOffline() and save(), which meant every background refresh could
  // increment stateRevision and race a real mutation.
  const s = await loadRaw();
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
  s.onlinePlayers = await touchOnlinePresence();
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

export async function getMe(): Promise<PlayerState> {
  const ban = await getGameBanStatus();
  const s = ban ? await loadRaw() : await getState();
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

  s.autoRollEnabled = Boolean(enabled);
  await save(s);
  return s;

  });}

export async function roll(
  isAuto = false,
  ticketId?: string,
  ticketIndex?: number,
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
        id: loaded.ticket.id,
        nextIndex: loaded.ticket.nextIndex + 1,
        expiresAt: loaded.ticket.expiresAt,
      };
      ticketUse = {
        ticket: loaded.ticket,
        raw: loaded.raw,
        index: requestedTicketIndex,
        nextValue: JSON.stringify(nextTicket),
      };
    }

    const s = await settleOffline(await loadRaw());
    if (isAuto && (s.upgrades.auto ?? 0) <= 0) {
      throw new Error('Auto Roll is not unlocked yet.');
    }

    const now = Date.now();
    const usingFreeRoll = !isAuto && (s.freeRolls ?? 0) > 0;
    const cd = cooldownMs(s, isAuto);
    if (!usingFreeRoll && s.lastRollAt !== null && now - s.lastRollAt < cd) {
      throw new Error(`Cooldown: ${((cd - now + s.lastRollAt) / 1000).toFixed(1)}s`);
    }
    if (usingFreeRoll) {
      s.freeRolls = Math.max(0, (s.freeRolls ?? 0) - 1);
    }

    // Tickets sequence requests and never determine reward outcomes.
    const { bestOrb, batch, totalVal, coinsGained, shardsGained, xpGained, rollCount } =
      await applyRolls(s, 1, undefined, 'online');

    if (!isAuto) {
      s.manualRolls = Math.min(10, (s.manualRolls ?? 0) + 1);
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

    const alreadyRecorded = Boolean(await redis.get(subscribedKey));
    if (!alreadyRecorded) {
      await redis.set(subscribedKey, String(Date.now()));
      await redis.incr(FOLLOW_ACTION_COUNT_KEY);
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
    const rewardMarker = String(
      globalThis.crypto?.randomUUID?.() ??
      `claimed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
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
    void recordLeaderboard(s).catch(error => {
      console.error('[Follow Reward] Leaderboard update failed:', error);
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
  const s = await settleOffline(await loadRaw());
  if (s.offlineRolls <= 0) throw new Error('No offline rolls waiting.');
  const batches = s.offlineRolls;
  s.offlineRolls = 0;
  const { bestOrb, batch, totalVal, coinsGained, shardsGained, xpGained, rollCount } = await applyRolls(s, batches, undefined, 'offline');
  const now = Date.now();
  s.lastRollAt = now;
  s.lastSeenAt = now;
  // Persist the claim before deleting its reminder/job. If the player save
  // fails, the original offline-roll balance and notification remain intact.
  await save(s);
  await Promise.all([
    redis.del(OFFLINE_FULL_NOTIFICATION_PREFIX + currentUserId()).catch(error => {
      console.error('[Offline Rolls] Could not clear full notification:', error);
    }),
    redis.del(OFFLINE_FULL_JOB_PREFIX + currentUserId()).catch(error => {
      console.error('[Offline Rolls] Could not clear scheduled job:', error);
    }),
  ]);
  // Leaderboard is a projection, not part of the durable roll claim. A failure
  // here must not report the already-committed reward as a failed claim.
  void recordLeaderboard(s).catch(error => {
    console.error('[Offline Rolls] Leaderboard update failed:', error);
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

  });}

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

export function autoBuyCheapest(s: PlayerState): boolean {
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
    if (cost <= s.coins && cost < lowestCost) {
      lowestCost = cost;
      bestId = id;
    }
  }

  if (bestId && Number.isFinite(lowestCost) && s.coins >= lowestCost) {
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
  const s = await settleOffline(await loadRaw());
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
  const s = await settleOffline(await loadRaw());
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
  if (current >= info.maxLevel) {
    throw new Error(`Upgrade ${info.name} is already at max level (${info.maxLevel}).`);
  }
  const cost = prestigeUpgradeCost(id, current);
  if (s.cosmicDust < cost) {
    throw new Error(`Need ${cost} Cosmic Dust.`);
  }

  s.cosmicDust -= cost;
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
  s.shards = (s.shards ?? 0) - numShards;

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
  if (typeof skillId !== 'string' || !Object.prototype.hasOwnProperty.call(MASTERY_SKILLS, skillId)) {
    throw new Error('Unknown mastery skill.');
  }
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const skill = MASTERY_SKILLS[skillId];

  if (!s.masterySkills) {
    s.masterySkills = {
      continuumLuck: 0,
      prosperity: 0,
      shardAttunement: 0,
      critMastery: 0,
      chronoFlow: 0,
      infiniteVault: 0,
      cosmicAttunement: 0,
      celestialSurge: 0,
      pityAccelerant: 0,
      apexFortune: 0,
      celestialVolley: 0,
    };
  }

  const currentLevel = Number(s.masterySkills[skillId] ?? 0);
  if (!Number.isSafeInteger(currentLevel) || currentLevel < 0) throw new Error('Saved mastery level is invalid.');
  if (currentLevel >= skill.maxLevel) {
    throw new Error(`Mastery skill ${skill.name} is already at max level (${skill.maxLevel}).`);
  }

  const cost = masterySkillCost(skillId, currentLevel);
  if (!Number.isSafeInteger(cost) || cost < 1) throw new Error('Mastery skill cost is invalid.');
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
  if ((s.shards ?? 0) < SHARD_SYNTHESIS_COST) {
    throw new Error(`Synthesizing requires at least ${SHARD_SYNTHESIS_COST} Shards.`);
  }

  spendShards(s, SHARD_SYNTHESIS_COST);
  s.cosmicDust = (s.cosmicDust ?? 0) + 1;
  await save(s);
  await appendPlayerSpyLog('dust-synthesis', {
    shardsSpent: SHARD_SYNTHESIS_COST,
    dustEarned: 1,
    snapshot: playerSpySnapshot(s),
  });
  return { state: s, dustEarned: 1 };

  });}

export async function buyCosmetic(id: string): Promise<PlayerState> {
  return withPlayerMutationLock(async () => {
  const s = await settleOffline(await loadRaw());
  const cosmetic = COSMETICS_LIST.find(c => c.id === id);
  if (!cosmetic) throw new Error('Cosmetic not found.');
  if (s.unlockedCosmetics.includes(id)) {
    s.activeCosmetic = id;
    await save(s);
    return s;
  }

  if (s.coins < cosmetic.costCoins || s.shards < cosmetic.costShards) {
    throw new Error('Not enough Coins or Shards.');
  }

  s.coins -= cosmetic.costCoins;
  spendShards(s, cosmetic.costShards);
  s.unlockedCosmetics.push(id);
  s.activeCosmetic = id;
  await save(s);
  await appendPlayerSpyLog('cosmetic-purchase', {
    cosmeticId: id,
    coinsSpent: cosmetic.costCoins,
    shardsSpent: cosmetic.costShards,
    snapshot: playerSpySnapshot(s),
  });
  return s;

  });}

async function claimWorldBoosterActivation(
  s: PlayerState,
  id: GlobalBoosterId,
  useCredit: boolean,
): Promise<{
  state: PlayerState;
  snapshot: GlobalBoosterSnapshot;
  usedCredit: boolean;
  announcement: { id: GlobalBoosterId; name: string; username: string; activatedAt: number };
}> {
  const cost = GLOBAL_BOOSTERS[id].costShards;
  const userId = currentUserId();
  await appendGlobalBoosterDebugLog('player:activation-start', {
    userId, username: context.username ?? null, id, useCredit, costShards: cost,
    currentShards: s.shards, currentCredits: s.globalBoosterCredits ?? 0,
    playerGlobalState: s.globalBoosters ?? null,
  });

  if (useCredit) {
    if ((s.globalBoosterCredits ?? 0) <= 0) throw new Error('No free Global Booster activations remain.');
    s.globalBoosterCredits = (s.globalBoosterCredits ?? 0) - 1;
  } else {
    if ((s.shards ?? 0) < cost) throw new Error(`${GLOBAL_BOOSTERS[id].name} requires ${cost} Shards.`);
    spendShards(s, cost);
  }

  try {
    const activatedAt = Date.now();
    const globalRaw = await redis.get(GLOBAL_BOOSTERS_KEY) as string | null;
    const parsed = globalRaw == null ? createInitialGlobalBoosters(activatedAt) : parseGlobalBoosterSnapshot(globalRaw, activatedAt);
    if (!parsed) throw new Error('Global Booster state could not be read safely. No changes were written.');
    const snapshot: GlobalBoosterSnapshot = { ...parsed };
    snapshot[id] = activateGlobalBoosterStack(snapshot[id], activatedAt, id === 'speed' ? 10 : Number.MAX_SAFE_INTEGER);
    s.globalBoosters = snapshot;

    await appendGlobalBoosterDebugLog('player:before-save', {
      userId, id, useCredit, snapshot, shards: s.shards, credits: s.globalBoosterCredits ?? 0,
    });

    // Commit the player's debit and the shared booster snapshot in one watched transaction.
    await save(s, {
      key: GLOBAL_BOOSTERS_KEY,
      expectedValue: globalRaw,
      nextValue: JSON.stringify(snapshot),
      conflictMessage: 'Global Booster state changed while activating. Refresh the game and try again.',
    });

    await appendGlobalBoosterDebugLog('player:activation-success', {
      userId, id, useCredit, snapshot, shardsAfter: s.shards, creditsAfter: s.globalBoosterCredits ?? 0,
    });

    const activatedBy = String(context.username ?? s.username ?? 'Redditor').trim() || 'Redditor';
    try {
      await appendGlobalBoosterActivationLog({
        timestamp: activatedAt, userId, username: activatedBy, boosterId: id,
        boosterName: GLOBAL_BOOSTERS[id].name, usedCredit: useCredit,
        tier: Number(snapshot[id].tier ?? 0), endsAt: Number(snapshot[id].endsAt ?? 0),
      });
    } catch (error) {
      console.error('[Global Boosters] Activation committed but log append failed:', error);
    }
    try {
      await redis.set(GLOBAL_BOOSTER_ANNOUNCEMENT_KEY, JSON.stringify({
        id, name: GLOBAL_BOOSTERS[id].name, username: activatedBy, activatedAt,
      }));
    } catch (error) {
      // The debit + booster activation already committed; announcement failure must not
      // turn a durable success into an error that encourages a duplicate retry.
      console.error('[Global Boosters] Activation committed but announcement write failed:', error);
    }

    return {
      state: s, snapshot, usedCredit: useCredit,
      announcement: { id, name: GLOBAL_BOOSTERS[id].name, username: activatedBy, activatedAt },
    };
  } catch (error) {
    // save() did not commit the debit unless its extra-write transaction committed too.
    if (useCredit) s.globalBoosterCredits = (s.globalBoosterCredits ?? 0) + 1;
    else s.shards = (s.shards ?? 0) + cost;
    await appendGlobalBoosterDebugLog('player:activation-failed', {
      userId, id, useCredit, errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
      refundedShards: useCredit ? 0 : cost, refundedCredit: useCredit,
    });
    throw error;
  }
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
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(GLOBAL_BOOSTERS, id)) throw new Error('Unknown Global Booster.');
  return withPlayerMutationLock(async () => {

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
  const s = await settleOffline(await loadRaw());
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
    const s = await settleOffline(await loadRaw());
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
    const createdAt = Date.now();
    const expiresAt = frenzyPostExpiresAt(createdAt);
    const postText =
      `u/${ownerUsername} got a 1/${formatRarity(rarity)} Orb in their Frenzy.\n\n` +
      `Click below to claim it! You can only claim one every 23 hours.\n\n` +
      `When someone claims your Frenzy, you receive +${FRENZY_OWNER_SHARD_REWARD} Shards. ` +
      `This reward bypasses the 50 Shard daily cap.`;
    const post = await reddit.submitCustomPost({
      runAs: 'USER',
      subredditName,
      title: `u/${ownerUsername} got a 1/${formatRarity(rarity)} Orb in their Frenzy`,
      flairText: 'frenzy',
      entry: 'frenzy',
      userGeneratedContent: { text: postText },
    });
    const postId = String(post?.id ?? '').trim();
    if (!postId) throw new Error('Could not create the Frenzy post.');

    const adminTest = options.adminTest === true || isFrenzyTestAdmin(s.username) || isFrenzyTestAdmin(ownerUsername);
    await redis.set(FRENZY_POST_PREFIX + postId, JSON.stringify({
      ownerId: currentUserId(),
      ownerUsername,
      rarity,
      subredditName,
      adminTest,
      inGame: true,
      createdAt,
      expiresAt,
      consumedAt: null,
    }));

    s.manualRolls = Math.min(10, (s.manualRolls ?? 0) + 1);
    if (s.manualRolls >= 3) s.upgrades.auto = 1;
    s.lastFrenzyDate = today;
    s.lastFrenzyAt = createdAt;
    s.lastRollAt = Date.now();
    s.lastSeenAt = Date.now();
    await save(s);
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
  });
}

export async function getOrbFrenzyInfo(): Promise<{
  rarity: number;
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

  const data = parseStoredJson<{
    ownerId: string;
    ownerUsername: string;
    rarity: number;
    createdAt: number;
    expiresAt?: number;
    adminTest?: boolean;
    inGame?: boolean;
    consumedAt?: number | null;
  }>(raw);
  if (!data) throw new Error('Orb Frenzy data is corrupted.');

  const now = Date.now();
  const expiresAt = Number(data.expiresAt ?? frenzyPostExpiresAt(data.createdAt));
  const expired = isFrenzyPostExpired(data.createdAt, now);
  const s = await getMe();
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
    ownerUsername: data.ownerUsername,
    createdAt: data.createdAt,
    expiresAt,
    expired,
    consumed: data.consumedAt != null,
    claimedToday,
    claimCooldownRemainingMs,
    claimCooldownEndsAt,
    isOwner,
    canClaim: !expired && data.consumedAt == null && (claimCooldownRemainingMs <= 0 || selfClaimTest) && (!isOwner || selfClaimTest),
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
  const initialData = parseStoredJson<{ ownerId?: string }>(initialRaw);
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

  const data = parseStoredJson<{
    ownerId: string;
    ownerUsername: string;
    rarity: number;
    subredditName: string;
    adminTest?: boolean;
    inGame?: boolean;
    consumedAt?: number | null;
    createdAt?: number;
    expiresAt?: number;
  }>(raw);
  if (!data) throw new Error('Orb Frenzy data is corrupted.');
  if (String(data.ownerId ?? '').trim() !== lockedOwnerId) {
    throw new Error('Frenzy ownership changed. Please reopen the post.');
  }
  if (handoff && handoff.expiresAt <= Date.now()) {
    throw new Error('This Frenzy handoff expired. Please reopen the post.');
  }
  if (data.consumedAt != null) throw new Error('This Orb Frenzy has already been claimed.');

  const isOwner = data.ownerId === claimantId;

  const now = Date.now();
  const createdAt = Number(data.createdAt ?? 0);
  if (isFrenzyPostExpired(createdAt, now)) throw new Error('This Frenzy has expired.');
  const s = await settleOffline(await loadRaw());
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

  const critChance = Math.min(
    1,
    (s.upgrades.critChance ?? 0) * 0.03 +
    (s.masterySkills?.critMastery ?? 0) * 0.03 +
    (s.guildPerks?.critRank ?? 0) * 0.015 +
    globalBoosterCritChanceBonus(s.globalBoosters?.crit),
  );
  const critCount = sampleBinomial(count, critChance);

  const supernovaLevel = s.prestigeUpgrades?.supernova ?? 0;
  const supernovaCount = supernovaLevel > 0
    ? sampleBinomial(critCount, Math.min(1, supernovaLevel * 0.10))
    : 0;

  const normalCritCount = Math.max(0, critCount - supernovaCount);
  const normalCritRarity = Math.min(1_000_000_000_000_000, Math.round(data.rarity * critMultiplier(s)));
  const supernovaRarity = Math.min(1_000_000_000_000_000, Math.round(data.rarity * 5));

  const groups = [
    { count: count - critCount, rarity: data.rarity },
    { count: normalCritCount, rarity: normalCritRarity },
    { count: supernovaCount, rarity: supernovaRarity },
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
  const rarityShards = groups.reduce((sum, group) => {
    if (group.rarity >= 1_000_000) return sum + group.count * 10;
    if (group.rarity >= 100_000) return sum + group.count * 5;
    if (group.rarity >= 10_000) return sum + group.count * 2;
    if (group.rarity >= 1_000) return sum + group.count;
    return sum;
  }, 0);
  const shardsGained = grantRollShards(s, rarityShards + procShards);

  const previousHighest = s.highestRarity;
  s.totalRolls += count;
  s.currentRunRolls = (s.currentRunRolls ?? 0) + count;
  s.collectionValue = Math.min(Number.MAX_SAFE_INTEGER, (s.collectionValue ?? 0) + finalValue);
  s.lifetimeCollectionValue = Math.min(Number.MAX_SAFE_INTEGER, (s.lifetimeCollectionValue ?? 0) + finalValue);
  s.totalCrits = (s.totalCrits ?? 0) + critCount;
  const guildTax = await applyGuildTax(coinsGained);
  coinsGained = Math.max(0, coinsGained - guildTax.taxedCoins);
  s.coins += coinsGained;
  s.lifetimeCoins = (s.lifetimeCoins ?? 0) + coinsGained;
  s.lastFrenzyClaimDate = new Date(now).toISOString().slice(0, 10);
  s.lastFrenzyClaimAt = now;

  const bestRarity = topRarity;
  const newRarityKeys = groups.filter(
    group => (s.collection[String(group.rarity)] ?? 0) <= 0,
  );
  const uniqueGained = newRarityKeys.length;

  for (const group of groups) {
    const keyForRarity = String(group.rarity);
    s.collection[keyForRarity] = (s.collection[keyForRarity] ?? 0) + group.count;
  }
  s.highestRarity = Math.max(s.highestRarity, bestRarity);
  s.rollsSinceBest = bestRarity > previousHighest ? 0 : (s.rollsSinceBest ?? 0) + count;

  s.xp += xpGained;
  applyLevelProgress(s, 1);

  // Frenzy claim rolls are real processed rolls and therefore count toward Tithe.
  const titheLevel = s.prestigeUpgrades?.singularityTithe ?? 0;
  if (titheLevel > 0 && count > 0) {
    const beforeTitheRolls = Math.max(0, Math.floor(s.singularityTitheSingleRolls ?? 0));
    s.singularityTitheSingleRolls = beforeTitheRolls + count;
    const dustEarned = singularityTitheDustForRolls(beforeTitheRolls, count, titheLevel);
    if (dustEarned > 0) s.cosmicDust = (s.cosmicDust ?? 0) + dustEarned;
  }

  advanceQuestProgress(s, 'roll', count);
  advanceQuestProgress(s, 'rare', bestRarity);
  advanceQuestProgress(s, 'value', finalValue);
  advanceQuestProgress(s, 'unique', uniqueGained);
  await contribute(finalValue, count, bestRarity);
  await addCommunityRolls(count);

  let ownerRewardShards = 0;
  if (isOwner) {
    ownerRewardShards = grantFrenzyOwnerShards(s, FRENZY_OWNER_SHARD_REWARD);
  }

  // Consume the post atomically with the claimant save. Different players
  // have different player locks, so the watched post key prevents multiple
  // claimants from winning the same Frenzy.
  const consumedPostValue = JSON.stringify({ ...data, consumedAt: now });
  await save(s, {
    key: FRENZY_POST_PREFIX + postId,
    expectedValue: raw,
    nextValue: consumedPostValue,
    conflictMessage: 'This Orb Frenzy has already been claimed.',
  });
  // save() intentionally discards pre-wipe mutations. Do not report a claim
  // or award its owner if the claimant mutation was invalidated before commit.
  if (await redis.get(FRENZY_POST_PREFIX + postId) !== consumedPostValue) {
    throw new Error('FRENZY_CLAIM_SAVE_INVALIDATED');
  }
  if (handoff && handoff.postId === postId) {
    await redis.del(frenzyHandoffKey(claimantId));
  }

  if (!isOwner) {
    try {
      ownerRewardShards = await grantFrenzyOwnerReward(
        data.ownerId,
        FRENZY_OWNER_SHARD_REWARD,
      );
    } catch (error) {
      console.error('[Orb Frenzy] Failed to grant owner Shards:', error);
    }
  }

  const rolledAt = Date.now();
  const visibleBatch: Orb[] = [];
  for (const group of groups) {
    const groupInfo = getOrbInfo(group.rarity);
    const groupIsNew = newRarityKeys.some(item => item.rarity === group.rarity);
    const visibleCount = Math.min(group.count, Math.max(0, 8 - visibleBatch.length));
    for (let i = 0; i < visibleCount; i += 1) {
      visibleBatch.push({
        rarity: group.rarity,
        rolledAt,
        tier: groupInfo.tier,
        name: groupInfo.name,
        isNew: groupIsNew,
        isCrit: group.rarity > data.rarity,
      });
    }
  }

  const orbInfo = getOrbInfo(bestRarity);
  const bestOrb: Orb = {
    rarity: bestRarity,
    rolledAt,
    tier: orbInfo.tier,
    name: orbInfo.name,
    isNew: newRarityKeys.some(group => group.rarity === bestRarity),
    isCrit: bestRarity > data.rarity,
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

  });
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
  const costShards = 5;
  if (s.shards < costShards) {
    throw new Error('Turbo Roll requires 5 Shards.');
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

export async function recordShareAction(s: PlayerState) {
  const now = Date.now();
  if (s.lastShareAt && now - s.lastShareAt < 30_000) {
    throw new Error('Please wait before sharing another orb.');
  }
  s.lastShareAt = now;
  advanceQuestProgress(s, 'share', 1);
  await save(s);
  void recordLeaderboard(s).catch(error => {
    console.error('[Leaderboard] Share update failed:', error);
  });
}
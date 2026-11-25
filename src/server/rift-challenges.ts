import { context, redis } from './devvit-mock.js';
import { withPlayerMutationLock, withPlayerMutationLockFor } from './player-lock.js';
import { loadRaw, deleteRiftCodexForRun, save, prepareFrenzyOwnerRewardWrites } from './game.js';
import { getCombatScrapBalance, spendCombatScrapForRiftForge, refundCombatScrapForRiftForge } from './combat.js';
import { normalizeRiftRelicLevels, normalizeEquippedRiftRelics, riftRelicCost, getRiftRelicEffects, RIFT_RELICS, RIFT_RELIC_EQUIP_SLOTS, RIFT_RELIC_FORKED_EQUIP_SLOTS, type RiftRelicId } from '../shared/rift-relics.js';
import {
  createInitialState,
  calculateLevelFromXp,
  grantFrenzyOwnerShards,
  type PlayerState,
} from '../shared/game.js';
import {
  accrueRiftDimensionalInterest,
  createEmptyRiftChallengeArchive,
  emptyRiftPerkLevels,
  getRiftChallengeDefinition,
  normalizeRiftMainProgress,
  normalizeRiftTemporalDragMultiplier,
  riftChallengeIsAvailable,
  riftChallengeMechanicUnlocks,
  riftChallengeUpgradeCost,
  riftPerkCost,
  riftRatePerHour,
  RIFT_CHALLENGE_UPGRADES,
  RIFT_CHALLENGES,
  getRiftMutationDefinition,
  riftMutationDurationRolls,
  RIFT_FIRST_SPARK,
  RIFT_PERKS,
  type RiftChallengeArchive,
  type RiftChallengeId,
  type RiftChallengeMainProgress,
  type RiftChallengeRun,
  type RiftChallengeSnapshot,
  type RiftChallengeUpgradeId,
  type RiftPerkId,
  type RiftMutationId,
  type RiftPerkLevels,
} from '../shared/rift-challenges.js';

const RIFT_ARCHIVE_KEY_PREFIX = 'io:rift-challenge:v1:';
const RIFT_COMPLETION_POST_PREFIX = 'io:rift-completion:post:v1:';
const RIFT_COMPLETION_RUN_PREFIX = 'io:rift-completion:run:v1:';
const RIFT_COMPLETION_KUDOS_PREFIX = 'io:rift-completion:kudos:v1:';
const RIFT_COMPLETION_KUDOS_POST_LOCK_PREFIX = '__rift-completion-kudos__:';
const RIFT_KUDOS_REWARD_SHARDS = 10;
const RIFT_KUDOS_PROGRESS_MINUTES = 1;
const RIFT_KUDOS_WINDOW_MS = 24 * 60 * 60_000;
const RIFT_KUDOS_HISTORY_MS = 30 * 24 * 60 * 60_000;
const RIFT_POST_RECORD_TTL_MS = 7 * 24 * 60 * 60_000;

interface RiftCompletionPostRecord {
  version: 1;
  postId: string;
  runId: string;
  ownerId: string;
  ownerUsername: string;
  challengeId: string;
  challengeName: string;
  subredditName: string;
  createdAt: number;
}

function riftCompletionKudosReceiptKey(postId: string, userId: string): string {
  return RIFT_COMPLETION_KUDOS_PREFIX + encodeURIComponent(postId) + ':' + encodeURIComponent(userId);
}

async function withRiftPlayerLocks<T>(userIds: string[], fn: () => Promise<T>): Promise<T> {
  const ordered = Array.from(new Set(userIds.map(id => String(id ?? '').trim()).filter(Boolean))).sort();
  const acquire = (index: number): Promise<T> => index >= ordered.length
    ? fn()
    : withPlayerMutationLockFor(ordered[index], () => acquire(index + 1));
  return acquire(0);
}

export type { RiftChallengeSnapshot } from '../shared/rift-challenges.js';

function currentUserId(): string {
  const userId = String(context.userId ?? '').trim();
  if (!userId) throw new Error('REDDIT_LOGIN_REQUIRED');
  return userId;
}

function archiveKey(userId = currentUserId()): string {
  return RIFT_ARCHIVE_KEY_PREFIX + String(userId ?? '').trim();
}

function safeInteger(value: unknown, fallback = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? Math.max(0, Math.min(maximum, numeric)) : fallback;
}

function normalizePerkLevels(value: unknown): RiftPerkLevels {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const defaults = emptyRiftPerkLevels();
  return Object.fromEntries(
    Object.entries(defaults).map(([id, fallback]) => {
      const max = RIFT_PERKS[id as RiftPerkId].maxLevel;
      return [id, safeInteger(raw[id], fallback, max)];
    }),
  ) as RiftPerkLevels;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRun(value: unknown): RiftChallengeRun | null {
  if (!isRecord(value)) return null;
  const challenge = getRiftChallengeDefinition(value.challengeId);
  if (!challenge || (value.status !== 'active' && value.status !== 'completed')) return null;
  const levels = isRecord(value.upgradeLevels) ? value.upgradeLevels : {};
  const rarity = Number(value.bestRarity);
  const lastRaw = isRecord(value.lastRoll) ? value.lastRoll : null;
  const lastRarity = Number(lastRaw?.rarity);
  const lastRoll = lastRaw && Number.isFinite(lastRarity) && lastRarity >= 2
    ? {
        rarity: Math.min(Number.MAX_SAFE_INTEGER, lastRarity),
        isCritical: lastRaw.isCritical === true,
        coinsGained: safeInteger(lastRaw.coinsGained),
        rolledAt: safeInteger(lastRaw.rolledAt),
      }
    : null;

  return {
    runId: String(value.runId ?? '').slice(0, 120),
    challengeId: challenge.id as RiftChallengeId,
    status: value.status,
    startedAt: safeInteger(value.startedAt),
    updatedAt: safeInteger(value.updatedAt),
    completedAt: value.completedAt == null ? null : safeInteger(value.completedAt),
    coins: safeInteger(value.coins),
    totalRolls: safeInteger(value.totalRolls),
    bestRarity: Number.isFinite(rarity) ? Math.max(2, Math.min(Number.MAX_SAFE_INTEGER, rarity)) : 2,
    nextRollAt: safeInteger(value.nextRollAt),
    upgradeLevels: {
      fortune: safeInteger(levels.fortune, 0, RIFT_CHALLENGE_UPGRADES.fortune.maxLevel),
      speed: safeInteger(levels.speed, 0, RIFT_CHALLENGE_UPGRADES.speed.maxLevel),
      prosperity: safeInteger(levels.prosperity, 0, RIFT_CHALLENGE_UPGRADES.prosperity.maxLevel),
      critical: safeInteger(levels.critical, 0, RIFT_CHALLENGE_UPGRADES.critical.maxLevel),
    },
    mainProgressAtStart: normalizeRiftMainProgress(
      isRecord(value.mainProgressAtStart)
        ? value.mainProgressAtStart as Partial<RiftChallengeMainProgress>
        : null,
    ),
    mechanicUnlocks: {
      fortune: isRecord(value.mechanicUnlocks) && value.mechanicUnlocks.fortune === true,
      speed: isRecord(value.mechanicUnlocks) && value.mechanicUnlocks.speed === true,
      prosperity: isRecord(value.mechanicUnlocks) && value.mechanicUnlocks.prosperity === true,
      critical: isRecord(value.mechanicUnlocks) && value.mechanicUnlocks.critical === true,
    },
    lastRoll,
    temporalDragMultiplier: normalizeRiftTemporalDragMultiplier(value.temporalDragMultiplier),
    lastInterestAt: safeInteger(value.lastInterestAt, safeInteger(value.startedAt)),
    activeMutation: (() => {
      const mutation = isRecord(value.activeMutation) ? value.activeMutation : null;
      return mutation && getRiftMutationDefinition(mutation.id)
        ? {
            id: mutation.id as RiftMutationId,
            startedAt: safeInteger(mutation.startedAt),
            startedAtRoll: safeInteger(mutation.startedAtRoll),
            endsAtRoll: safeInteger(mutation.endsAtRoll),
          }
        : null;
    })(),
    pendingMutationChoices: Array.isArray(value.pendingMutationChoices)
      ? value.pendingMutationChoices.filter((id): id is RiftMutationId => getRiftMutationDefinition(id) !== undefined).slice(0, 3)
      : [],
    lastMutationRoll: safeInteger(value.lastMutationRoll),
    completedMutations: safeInteger(value.completedMutations),
    emergencyProtocolsUsed: safeInteger(value.emergencyProtocolsUsed),
    emergencyProtocolUntilRoll: safeInteger(value.emergencyProtocolUntilRoll),
    equippedRelics: normalizeEquippedRiftRelics(value.equippedRelics),
    fractureCascadePending: value.fractureCascadePending === true,
    gameState: isRecord(value.gameState) ? value.gameState as unknown as PlayerState : null,
  };
}

function normalizeArchive(value: unknown, now = Date.now()): RiftChallengeArchive {
  if (!isRecord(value)) return createEmptyRiftChallengeArchive(now);
  const completed = Array.isArray(value.completedChallengeIds)
    ? value.completedChallengeIds.filter((item): item is string =>
        typeof item === 'string' && getRiftChallengeDefinition(item) !== undefined,
      ).slice(0, 100)
    : [];
  const bestRaw = isRecord(value.bestRarityByChallenge) ? value.bestRarityByChallenge : {};
  const bestRarityByChallenge: Record<string, number> = {};
  for (const [id, best] of Object.entries(bestRaw).slice(0, 50)) {
    const rarity = Number(best);
    if (getRiftChallengeDefinition(id) && Number.isFinite(rarity) && rarity >= 2) {
      bestRarityByChallenge[id] = Math.min(Number.MAX_SAFE_INTEGER, rarity);
    }
  }
  const riftPerkLevels = normalizePerkLevels(value.riftPerkLevels);
  const lastAccrued = safeInteger(value.riftLastAccruedAt, now);
  const riftProgressValue = Number(value.riftProgress);
  const archive: RiftChallengeArchive = {
    version: 4,
    activeRun: normalizeRun(value.activeRun),
    completedChallengeIds: [...new Set(completed)],
    bestRarityByChallenge,
    totalCompletedRuns: safeInteger(value.totalCompletedRuns),
    riftPoints: safeInteger(value.riftPoints),
    riftProgress: Number.isFinite(riftProgressValue) ? Math.max(0, Math.min(0.999999999, riftProgressValue)) : 0,
    riftRatePerHour: 1,
    riftLastAccruedAt: Math.min(now, lastAccrued),
    totalRiftPointsEarned: safeInteger(value.totalRiftPointsEarned, safeInteger(value.riftPoints)),
    riftPlayerProgress: isRecord(value.riftPlayerProgress)
      ? normalizeRiftMainProgress(value.riftPlayerProgress as Partial<RiftChallengeMainProgress>)
      : null,
    kudosReceivedAt: Array.isArray(value.kudosReceivedAt)
      ? value.kudosReceivedAt
          .map(item => Number(item))
          .filter(item => Number.isSafeInteger(item) && item >= Math.max(0, now - RIFT_KUDOS_HISTORY_MS) && item <= now)
          .slice(-1000)
      : [],
    lastGameOpenedAt: safeInteger(value.lastGameOpenedAt, now),
    kudosSinceLastOpen: safeInteger(value.kudosSinceLastOpen),
    kudosDisplaySinceLastOpen: safeInteger(value.kudosDisplaySinceLastOpen),
    riftPerkLevels,
    riftRelicLevels: normalizeRiftRelicLevels(value.riftRelicLevels),
    equippedRiftRelics: normalizeEquippedRiftRelics(
      value.equippedRiftRelics,
      value.riftRelicLevels,
      riftPerkLevels.timelineFork > 0 ? RIFT_RELIC_FORKED_EQUIP_SLOTS : RIFT_RELIC_EQUIP_SLOTS,
    ),
  };
  archive.riftRatePerHour = riftRatePerHour(archive.completedChallengeIds, archive.riftPerkLevels);
  return archive;
}

async function readArchive(userId = currentUserId()): Promise<RiftChallengeArchive> {
  const raw = await redis.get(archiveKey(userId));
  if (!raw) return createEmptyRiftChallengeArchive(Date.now());
  try {
    return normalizeArchive(JSON.parse(String(raw)));
  } catch {
    console.error('[Rift Challenges] Stored archive could not be parsed; a clean archive was returned.');
    return createEmptyRiftChallengeArchive(Date.now());
  }
}

async function writeArchive(archive: RiftChallengeArchive, userId = currentUserId()): Promise<void> {
  await redis.set(archiveKey(userId), JSON.stringify(archive));
}

function accrueRiftProgress(archive: RiftChallengeArchive, now = Date.now()): void {
  const safeNow = Math.max(archive.riftLastAccruedAt, Math.floor(now));
  const elapsedMs = Math.max(0, safeNow - archive.riftLastAccruedAt);
  const rate = riftRatePerHour(archive.completedChallengeIds, archive.riftPerkLevels);
  const accumulated = archive.riftProgress + (elapsedMs / 3_600_000) * rate;
  const wholePoints = Number.isFinite(accumulated) ? Math.floor(accumulated) : Number.MAX_SAFE_INTEGER;
  const nextBalance = Math.min(Number.MAX_SAFE_INTEGER, archive.riftPoints + wholePoints);
  const earnedNow = Math.max(0, nextBalance - archive.riftPoints);
  archive.riftPoints = nextBalance;
  archive.totalRiftPointsEarned = Math.min(Number.MAX_SAFE_INTEGER, archive.totalRiftPointsEarned + earnedNow);
  archive.riftProgress = nextBalance >= Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, accumulated - wholePoints);
  archive.riftRatePerHour = rate;
  archive.riftLastAccruedAt = safeNow;
}

function progressFromGameState(state: PlayerState): RiftChallengeMainProgress {
  const storedLevel = Math.max(1, Number(state.level) || 1);
  const xpLevel = Math.max(1, calculateLevelFromXp(Number(state.xp) || 0).level);
  return normalizeRiftMainProgress({
    level: Math.max(storedLevel, xpLevel),
    totalRolls: state.totalRolls,
    totalCrits: state.totalCrits,
    highestRarity: state.highestRarity,
    masteryPoints: state.masteryPoints,
  });
}

async function readMainProgress(): Promise<RiftChallengeMainProgress> {
  // Challenge availability can still require a main-save level. Once a challenge
  // starts, every gameplay variable comes from the independent Rift save instead.
  const state = await loadRaw({ registerActivity: false, persistMigrations: false, source: 'main' });
  return progressFromGameState(state);
}

function createLegacyRunGameState(run: RiftChallengeRun): PlayerState {
  // Migration for active First Spark runs created before full PlayerState isolation.
  // Carry over the already-earned challenge wallet/counters, never the main save.
  const state = createInitialState(run.startedAt || Date.now());
  state.username = String(context.username ?? '').slice(0, 100) || undefined;
  state.coins = Math.max(0, run.coins);
  state.lifetimeCoins = state.coins;
  state.shards = 0;
  state.lifetimeShards = 0;
  state.freeShardsEarnedToday = 0;
  state.shardPityRolls = 0;
  state.totalRolls = run.totalRolls;
  state.highestRarity = run.bestRarity;
  state.stateRevision = 0;
  state.saveGeneration = 0;
  return state;
}

function ensureRunGameState(run: RiftChallengeRun): PlayerState {
  if (!run.gameState || !isRecord(run.gameState)) {
    run.gameState = createLegacyRunGameState(run);
  }
  return run.gameState;
}

function accrueRunDimensionalInterest(run: RiftChallengeRun, level: number, now = Date.now()): number {
  const state = ensureRunGameState(run);
  const result = accrueRiftDimensionalInterest(
    state.coins,
    state.lifetimeCoins ?? state.coins,
    run.lastInterestAt,
    run.startedAt,
    level,
    now,
  );
  state.coins = result.coins;
  state.lifetimeCoins = result.lifetimeCoins;
  run.lastInterestAt = result.lastInterestAt;
  return result.minutesAccrued;
}

function syncRunSummaryFromGameState(run: RiftChallengeRun, now = Date.now()): void {
  const state = ensureRunGameState(run);
  run.coins = Math.max(0, Number(state.coins) || 0);
  run.totalRolls = safeInteger(state.totalRolls);
  run.bestRarity = Math.max(2, Number(state.highestRarity) || 2);
  run.mainProgressAtStart = progressFromGameState(state);
  run.mechanicUnlocks = riftChallengeMechanicUnlocks(run.mainProgressAtStart);
  run.updatedAt = now;
}

function snapshot(archive: RiftChallengeArchive, currentMainProgress: RiftChallengeMainProgress): RiftChallengeSnapshot {
  const storedRun = archive.activeRun?.gameState ? archive.activeRun : null;
  const activeRun = archive.activeRun?.status === 'active' ? archive.activeRun : null;
  if (activeRun) syncRunSummaryFromGameState(activeRun);
  const mainProgress = storedRun?.gameState
    ? progressFromGameState(storedRun.gameState)
    : archive.riftPlayerProgress ?? currentMainProgress;
  const earlyAuthorizationLevel = archive.riftPerkLevels.earlyAuthorization ?? 0;
  const mechanicUnlocks = activeRun?.gameState
    ? riftChallengeMechanicUnlocks(mainProgress, earlyAuthorizationLevel)
    : activeRun?.mechanicUnlocks ?? riftChallengeMechanicUnlocks(mainProgress, earlyAuthorizationLevel);
  if (activeRun) {
    for (const id of Object.keys(activeRun.upgradeLevels) as RiftChallengeUpgradeId[]) {
      if (safeInteger(activeRun.upgradeLevels[id]) > 0) mechanicUnlocks[id] = true;
    }
  }
  return {
    challenge: RIFT_FIRST_SPARK,
    challenges: RIFT_CHALLENGES,
    archive,
    mainProgress,
    mechanicUnlocks,
    challengeAvailable: riftChallengeIsAvailable(mainProgress),
    kudosStats: {
      last24Hours: archive.kudosReceivedAt.filter(timestamp => timestamp >= Date.now() - RIFT_KUDOS_WINDOW_MS).length,
      sinceLastOpen: archive.kudosDisplaySinceLastOpen + archive.kudosSinceLastOpen,
    },
  };
}

function createRunId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

function assertExpectedRunId(run: RiftChallengeRun, expectedRunIdValue: unknown): void {
  const expectedRunId = typeof expectedRunIdValue === 'string' ? expectedRunIdValue.trim() : '';
  if (!expectedRunId || expectedRunId !== run.runId) {
    throw new Error('CHALLENGE_RUN_MISMATCH');
  }
}

export async function getRiftChallengeStatus(): Promise<RiftChallengeSnapshot> {
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    const now = Date.now();
    accrueRiftProgress(archive, now);
    if (archive.activeRun?.status === 'active') {
      const run = archive.activeRun;
      const accruedMinutes = accrueRunDimensionalInterest(run, archive.riftPerkLevels.dimensionalInterest, now);
      if (accruedMinutes > 0) {
        const nextRevision = safeInteger(ensureRunGameState(run).stateRevision) + 1;
        if (!Number.isSafeInteger(nextRevision)) throw new Error('Rift player save reached its revision limit.');
        ensureRunGameState(run).stateRevision = nextRevision;
      }
      syncRunSummaryFromGameState(run, now);
    }
    await writeArchive(archive);
    if (archive.activeRun?.status === 'active') {
      return snapshot(archive, archive.activeRun.mainProgressAtStart);
    }
    return snapshot(archive, await readMainProgress());
  });
}

/** Record one full-game entry so the Rift menu can report kudos received since the previous opening. */
export async function markRiftGameOpened(): Promise<{ openedAt: number }> {
  return withPlayerMutationLock(async () => {
    const now = Date.now();
    const archive = await readArchive();
    accrueRiftProgress(archive, now);
    archive.lastGameOpenedAt = now;
    archive.kudosDisplaySinceLastOpen = archive.kudosSinceLastOpen;
    archive.kudosSinceLastOpen = 0;
    await writeArchive(archive);
    return { openedAt: now };
  });
}

export async function getRiftChallengeAdminStatus(userIdValue: unknown): Promise<{
  archive: RiftChallengeArchive;
  kudosStats: { last24Hours: number; sinceLastOpen: number };
  generatedAt: number;
}> {
  const userId = String(userIdValue ?? '').trim();
  if (!userId) throw new Error('A player ID is required.');
  return withPlayerMutationLockFor(userId, async () => {
    const now = Date.now();
    const archive = await readArchive(userId);
    accrueRiftProgress(archive, now);
    await writeArchive(archive, userId);
    return {
      archive,
      kudosStats: {
        last24Hours: archive.kudosReceivedAt.filter(timestamp => timestamp >= now - RIFT_KUDOS_WINDOW_MS).length,
        sinceLastOpen: archive.kudosDisplaySinceLastOpen + archive.kudosSinceLastOpen,
      },
      generatedAt: now,
    };
  });
}

export async function adminGrantRiftProgress(
  userIdValue: unknown,
  options: { points?: unknown; minutes?: unknown },
): Promise<{ archive: RiftChallengeArchive; grantedPoints: number; grantedMinutes: number }> {
  const userId = String(userIdValue ?? '').trim();
  if (!userId) throw new Error('A player ID is required.');
  const points = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.points) || 0)));
  const minutes = Math.max(0, Math.min(1_000_000, Math.floor(Number(options.minutes) || 0)));
  if (points === 0 && minutes === 0) throw new Error('Enter a positive Rift Point or progress-minute amount.');
  return withPlayerMutationLockFor(userId, async () => {
    const archive = await readArchive(userId);
    accrueRiftProgress(archive);
    const pointBalance = Math.min(Number.MAX_SAFE_INTEGER, archive.riftPoints + points);
    const directPointsGranted = pointBalance - archive.riftPoints;
    archive.riftPoints = pointBalance;
    archive.totalRiftPointsEarned = Math.min(Number.MAX_SAFE_INTEGER, archive.totalRiftPointsEarned + directPointsGranted);
    const accumulated = archive.riftProgress + archive.riftRatePerHour * minutes / 60;
    const whole = Math.floor(accumulated);
    const nextBalance = Math.min(Number.MAX_SAFE_INTEGER, archive.riftPoints + whole);
    const progressPointsGranted = nextBalance - archive.riftPoints;
    archive.riftPoints = nextBalance;
    archive.totalRiftPointsEarned = Math.min(Number.MAX_SAFE_INTEGER, archive.totalRiftPointsEarned + progressPointsGranted);
    archive.riftProgress = nextBalance >= Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, accumulated - whole);
    await writeArchive(archive, userId);
    return { archive, grantedPoints: directPointsGranted + progressPointsGranted, grantedMinutes: minutes };
  });
}

export async function registerRiftCompletionPost(
  record: Omit<RiftCompletionPostRecord, 'version'>,
): Promise<void> {
  const safePostId = String(record.postId ?? '').trim();
  const safeRunId = String(record.runId ?? '').trim();
  if (!safePostId || !safeRunId || !record.ownerId || !record.ownerUsername || !record.challengeName) {
    throw new Error('Rift completion post metadata is incomplete.');
  }
  const value: RiftCompletionPostRecord = {
    version: 1,
    ...record,
    postId: safePostId,
    runId: safeRunId,
    ownerUsername: String(record.ownerUsername).replace(/^u\//i, '').slice(0, 32),
    challengeName: String(record.challengeName).slice(0, 100),
    subredditName: String(record.subredditName).replace(/^r\//i, '').slice(0, 100),
  };
  const expiresAt = value.createdAt + RIFT_POST_RECORD_TTL_MS;
  // Keep the post display record so old Reddit posts remain renderable after Kudos expires.
  await redis.set(RIFT_COMPLETION_POST_PREFIX + safePostId, JSON.stringify(value));
  await redis.set(RIFT_COMPLETION_RUN_PREFIX + safeRunId, safePostId, { expiration: new Date(expiresAt) });
}

export async function getRiftCompletionPostInfo(postIdValue?: unknown): Promise<{
  postId: string;
  ownerUsername: string;
  challengeId: string;
  challengeName: string;
  createdAt: number;
  kudosExpiresAt: number;
  expired: boolean;
  isOwner: boolean;
  alreadyKudosed: boolean;
  canKudos: boolean;
}> {
  const postId = String(postIdValue ?? context.postId ?? '').trim();
  if (!postId) throw new Error('This is not a Rift completion post.');
  const raw = await redis.get(RIFT_COMPLETION_POST_PREFIX + postId);
  if (typeof raw !== 'string' || !raw) throw new Error('Rift completion post data was not found.');
  let record: RiftCompletionPostRecord;
  try {
    record = JSON.parse(raw) as RiftCompletionPostRecord;
  } catch {
    throw new Error('Rift completion post data is corrupted.');
  }
  if (record.version !== 1 || record.postId !== postId || !record.ownerId || !record.challengeName ||
      !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) {
    throw new Error('Rift completion post data is invalid.');
  }
  const viewerId = currentUserId();
  const now = Date.now();
  const kudosExpiresAt = record.createdAt + RIFT_KUDOS_WINDOW_MS;
  const expired = now >= kudosExpiresAt;
  const isOwner = viewerId === record.ownerId;
  const alreadyKudosed = await redis.get(riftCompletionKudosReceiptKey(postId, viewerId)) != null;
  return {
    postId,
    ownerUsername: record.ownerUsername,
    challengeId: record.challengeId,
    challengeName: record.challengeName,
    createdAt: record.createdAt,
    kudosExpiresAt,
    expired,
    isOwner,
    alreadyKudosed,
    canKudos: !expired && !isOwner && !alreadyKudosed,
  };
}

export async function awardRiftCompletionKudos(postIdValue?: unknown): Promise<{
  alreadyKudosed: boolean;
  shardsGrantedToYou: number;
  shardsGrantedToOwner: number;
  progressMinutesGranted: number;
}> {
  const postId = String(postIdValue ?? context.postId ?? '').trim();
  if (!postId) throw new Error('This is not a Rift completion post.');
  const giverId = currentUserId();
  const initialRaw = await redis.get(RIFT_COMPLETION_POST_PREFIX + postId);
  if (typeof initialRaw !== 'string' || !initialRaw) throw new Error('Rift completion post data was not found.');
  let initialRecord: RiftCompletionPostRecord;
  try { initialRecord = JSON.parse(initialRaw) as RiftCompletionPostRecord; }
  catch { throw new Error('Rift completion post data is corrupted.'); }
  const ownerId = String(initialRecord.ownerId ?? '').trim();
  if (!ownerId || initialRecord.postId !== postId) throw new Error('Rift completion post ownership is invalid.');
  if (giverId === ownerId) throw new Error('You cannot kudos your own Rift completion post.');
  if (Date.now() >= Number(initialRecord.createdAt) + RIFT_KUDOS_WINDOW_MS) {
    throw new Error('Kudos are only available for the first 24 hours after this post was created.');
  }

  return withRiftPlayerLocks([giverId, ownerId, RIFT_COMPLETION_KUDOS_POST_LOCK_PREFIX + postId + ':' + giverId], async () => {
    const raw = await redis.get(RIFT_COMPLETION_POST_PREFIX + postId);
    if (typeof raw !== 'string' || !raw) throw new Error('Rift completion post data was not found.');
    const record = JSON.parse(raw) as RiftCompletionPostRecord;
    if (record.ownerId !== ownerId || record.postId !== postId) throw new Error('Rift completion post ownership changed.');
    const now = Date.now();
    if (now >= record.createdAt + RIFT_KUDOS_WINDOW_MS) {
      throw new Error('Kudos are only available for the first 24 hours after this post was created.');
    }
    const receiptKey = riftCompletionKudosReceiptKey(postId, giverId);
    if (await redis.get(receiptKey) != null) {
      return { alreadyKudosed: true, shardsGrantedToYou: 0, shardsGrantedToOwner: 0, progressMinutesGranted: 0 };
    }

    const ownerArchiveKey = archiveKey(ownerId);
    const archiveRaw = await redis.get(ownerArchiveKey);
    if (typeof archiveRaw !== 'string' || !archiveRaw) {
      throw new Error('The Rift owner archive is unavailable; no kudos rewards were granted.');
    }
    let archiveData: unknown;
    try { archiveData = JSON.parse(archiveRaw); }
    catch { throw new Error('The Rift owner archive is corrupted; no kudos rewards were granted.'); }
    const archive = normalizeArchive(archiveData, now);
    accrueRiftProgress(archive, now);
    const progressAmount = archive.riftRatePerHour * RIFT_KUDOS_PROGRESS_MINUTES / 60;
    const accumulated = archive.riftProgress + progressAmount;
    const whole = Math.floor(accumulated);
    const nextBalance = Math.min(Number.MAX_SAFE_INTEGER, archive.riftPoints + whole);
    const earned = nextBalance - archive.riftPoints;
    archive.riftPoints = nextBalance;
    archive.totalRiftPointsEarned = Math.min(Number.MAX_SAFE_INTEGER, archive.totalRiftPointsEarned + earned);
    archive.riftProgress = nextBalance >= Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, accumulated - whole);
    archive.kudosReceivedAt = [...archive.kudosReceivedAt.filter(timestamp => timestamp >= now - RIFT_KUDOS_HISTORY_MS), now].slice(-1000);
    archive.kudosSinceLastOpen = Math.min(Number.MAX_SAFE_INTEGER, archive.kudosSinceLastOpen + 1);

    const giverState = await loadRaw({ source: 'main' });
    const shardsGrantedToYou = grantFrenzyOwnerShards(giverState, RIFT_KUDOS_REWARD_SHARDS);
    const ownerReward = await prepareFrenzyOwnerRewardWrites(ownerId, RIFT_KUDOS_REWARD_SHARDS, false);
    const receipt = JSON.stringify({
      postId,
      giverId,
      ownerId,
      createdAt: now,
      shardsGrantedToYou,
      shardsGrantedToOwner: ownerReward.granted,
      progressMinutesGranted: RIFT_KUDOS_PROGRESS_MINUTES,
    });
    try {
      await save(giverState, [
        ...ownerReward.writes,
        {
          key: ownerArchiveKey,
          expectedValue: archiveRaw,
          nextValue: JSON.stringify(archive),
          conflictMessage: 'The Rift owner archive changed. Retry the kudos action.',
        },
        {
          key: receiptKey,
          expectedValue: null,
          nextValue: receipt,
          expiration: new Date(now + RIFT_POST_RECORD_TTL_MS),
          conflictMessage: 'You have already kudosed this Rift completion post.',
        },
      ]);
    } catch (error) {
      if (await redis.get(receiptKey) != null) {
        return { alreadyKudosed: true, shardsGrantedToYou: 0, shardsGrantedToOwner: 0, progressMinutesGranted: 0 };
      }
      throw error;
    }
    return {
      alreadyKudosed: false,
      shardsGrantedToYou,
      shardsGrantedToOwner: ownerReward.granted,
      progressMinutesGranted: RIFT_KUDOS_PROGRESS_MINUTES,
    };
  });
}

export async function startRiftChallenge(
  challengeIdValue: unknown = RIFT_FIRST_SPARK.id,
  blueprintIdValue: unknown = 'fortune',
): Promise<RiftChallengeSnapshot> {
  const challenge = getRiftChallengeDefinition(String(challengeIdValue ?? RIFT_FIRST_SPARK.id));
  if (!challenge) throw new Error('Choose a valid Rift Challenge.');
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    const mainGameState = await loadRaw({ source: 'main' });
    const mainProgress = archive.activeRun?.gameState
      ? progressFromGameState(archive.activeRun.gameState)
      : archive.riftPlayerProgress ?? progressFromGameState(mainGameState);
    if (mainProgress.level < challenge.requiredMainLevel) {
      throw new Error('Reach Level ' + challenge.requiredMainLevel + ' in ' + (challenge.prerequisiteId ? 'the previous Rift run' : 'the main game') + ' to unlock ' + challenge.name + '.');
    }
    if (challenge.prerequisiteId && !archive.completedChallengeIds.includes(challenge.prerequisiteId)) {
      const prerequisite = getRiftChallengeDefinition(challenge.prerequisiteId);
      throw new Error('Complete ' + (prerequisite?.name ?? 'the previous Rift Challenge') + ' first.');
    }
    if (archive.activeRun?.status === 'active') {
      throw new Error('You already have an active challenge. Resume it or abandon it before starting another.');
    }
    const previousCompletedRunId = archive.activeRun?.status === 'completed'
      ? archive.activeRun.runId
      : null;
    const now = Date.now();
    const state = createInitialState(now);
    const seedCoins = archive.riftPerkLevels.riftStartCoins * 100;
    const masteryBridgeLevel = archive.riftPerkLevels.masteryBridge ?? 0;
    if (masteryBridgeLevel > 0) {
      const sourceSkills = mainGameState.masterySkills ?? {};
      state.masterySkills = Object.fromEntries(
        Object.entries(sourceSkills).map(([id, raw]) => {
          const level = Math.max(0, Math.floor(Number(raw) || 0));
          const transferred = level > 0 ? Math.max(1, Math.floor(level * masteryBridgeLevel / 10)) : 0;
          return [id, transferred];
        }),
      ) as typeof state.masterySkills;
      state.masteryPoints = Math.max(0, Math.floor(
        (Number(mainGameState.masteryPoints) || 0) * masteryBridgeLevel / 10,
      ));
    }
    if ((archive.riftPerkLevels.chronoEngine ?? 0) > 0) {
      state.masterySkills = { ...state.masterySkills, cooldownReclaimer: Math.max(1, state.masterySkills?.cooldownReclaimer ?? 0) };
    }
    const relicSlots = archive.riftPerkLevels.timelineFork > 0
      ? RIFT_RELIC_FORKED_EQUIP_SLOTS
      : RIFT_RELIC_EQUIP_SLOTS;
    const relicEffects = getRiftRelicEffects(archive.equippedRiftRelics, archive.riftRelicLevels, relicSlots);
    if (relicEffects.multiballBonus > 0) {
      state.upgrades = { ...state.upgrades, multi: Math.max(0, state.upgrades.multi ?? 0) + relicEffects.multiballBonus };
    }
    if ((archive.riftPerkLevels.automationOverride ?? 0) > 0) {
      state.upgrades.auto = 1;
      state.manualRolls = Math.max(3, state.manualRolls);
    }
    state.username = String(context.username ?? '').slice(0, 100) || undefined;
    state.coins = seedCoins;
    state.lifetimeCoins = seedCoins;
    state.shards = 0;
    state.lifetimeShards = 0;
    state.freeShardsEarnedToday = 0;
    state.shardPityRolls = 0;
    state.saveGeneration = 0;
    state.stateRevision = 0;
    const riftProgress = progressFromGameState(state);
    const validBlueprintId = RIFT_CHALLENGE_UPGRADES[blueprintIdValue as RiftChallengeUpgradeId]
      ? blueprintIdValue as RiftChallengeUpgradeId
      : 'fortune';
    const blueprintLevel = Math.max(0, Math.min(4, archive.riftPerkLevels.preloadedBlueprint ?? 0));
    const startingUpgradeLevels: Record<RiftChallengeUpgradeId, number> = {
      fortune: 0, speed: 0, prosperity: 0, critical: 0,
    };
    if (blueprintLevel > 0) startingUpgradeLevels[validBlueprintId] = blueprintLevel;
    archive.activeRun = {
      runId: createRunId(),
      challengeId: challenge.id as RiftChallengeId,
      status: 'active',
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      coins: state.coins,
      totalRolls: state.totalRolls,
      bestRarity: Math.max(2, state.highestRarity),
      nextRollAt: 0,
      upgradeLevels: startingUpgradeLevels,
      mainProgressAtStart: riftProgress,
      mechanicUnlocks: riftChallengeMechanicUnlocks(riftProgress, archive.riftPerkLevels.earlyAuthorization),
      lastRoll: null,
      temporalDragMultiplier: 1,
      lastInterestAt: now,
      activeMutation: null,
      pendingMutationChoices: [],
      lastMutationRoll: 0,
      completedMutations: 0,
      emergencyProtocolsUsed: 0,
      emergencyProtocolUntilRoll: 0,
      equippedRelics: [...archive.equippedRiftRelics],
      fractureCascadePending: false,
      gameState: state,
    };
    await writeArchive(archive);
    if (previousCompletedRunId) {
      await deleteRiftCodexForRun(previousCompletedRunId).catch(error => {
        console.error('[Rift Challenges] Replaced run Codex cleanup failed:', error);
      });
    }
    return snapshot(archive, mainProgress);
  });
}

/** Kept as a compatibility guard; actual Rift rolls now use the ordinary game /api/roll path. */
export async function rollRiftChallenge(_expectedRunIdValue: unknown): Promise<RiftChallengeSnapshot> {
  throw new Error('Use the main game Roll button while a Rift challenge is active.');
}

export async function buyRiftChallengeUpgrade(
  upgradeIdValue: unknown,
  expectedRunIdValue: unknown,
): Promise<RiftChallengeSnapshot> {
  const upgradeId = String(upgradeIdValue ?? '') as RiftChallengeUpgradeId;
  if (!Object.prototype.hasOwnProperty.call(RIFT_CHALLENGE_UPGRADES, upgradeId)) {
    throw new Error('Choose a valid challenge upgrade.');
  }

  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    const run = archive.activeRun;
    if (!run || run.status !== 'active') throw new Error('CHALLENGE_RUN_MISMATCH');
    assertExpectedRunId(run, expectedRunIdValue);
    const gameState = ensureRunGameState(run);
    accrueRunDimensionalInterest(run, archive.riftPerkLevels.dimensionalInterest);
    const progress = progressFromGameState(gameState);
    const mechanicUnlocks = riftChallengeMechanicUnlocks(
      progress,
      archive.riftPerkLevels.earlyAuthorization,
    );
    if (!mechanicUnlocks[upgradeId] && run.upgradeLevels[upgradeId] <= 0) {
      throw new Error('Rift-game requirement not met: ' + RIFT_CHALLENGE_UPGRADES[upgradeId].mainRequirement + '.');
    }
    const definition = RIFT_CHALLENGE_UPGRADES[upgradeId];
    const currentLevel = run.upgradeLevels[upgradeId];
    if (currentLevel >= definition.maxLevel) throw new Error('This challenge upgrade is already at maximum level.');
    const cost = riftChallengeUpgradeCost(upgradeId, currentLevel, run.totalRolls);
    if (gameState.coins < cost) throw new Error('Need ' + String(cost) + ' Rift Coins for this upgrade.');
    gameState.coins -= cost;
    gameState.stateRevision = safeInteger(gameState.stateRevision) + 1;
    run.coins = gameState.coins;
    run.upgradeLevels[upgradeId] = currentLevel + 1;
    syncRunSummaryFromGameState(run);
    await writeArchive(archive);
    return snapshot(archive, run.mainProgressAtStart);
  });
}

export async function getRiftRelicForgeStatus(): Promise<RiftChallengeSnapshot & { scrapBalance: number; relicSlots: number }> {
  const [challenge, scrapBalance] = await Promise.all([
    getRiftChallengeStatus(),
    getCombatScrapBalance(),
  ]);
  return {
    ...challenge,
    scrapBalance,
    relicSlots: challenge.archive.riftPerkLevels.timelineFork > 0
      ? RIFT_RELIC_FORKED_EQUIP_SLOTS
      : RIFT_RELIC_EQUIP_SLOTS,
  };
}

export async function buyRiftRelic(relicIdValue: unknown): Promise<RiftChallengeSnapshot> {
  const relicId = String(relicIdValue ?? '') as RiftRelicId;
  if (!Object.prototype.hasOwnProperty.call(RIFT_RELICS, relicId)) {
    throw new Error('Choose a valid Rift relic.');
  }
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    if (archive.completedChallengeIds.length === 0) {
      throw new Error('Complete your first Rift Challenge to unlock the Relic Forge.');
    }
    if (archive.activeRun?.status === 'active') {
      throw new Error('Finish or abandon the active Rift run before using the Relic Forge.');
    }
    const currentLevel = archive.riftRelicLevels[relicId] ?? 0;
    const definition = RIFT_RELICS[relicId];
    if (currentLevel >= definition.maxLevel) throw new Error('This relic is already at maximum rank.');
    const cost = riftRelicCost(relicId, currentLevel);
    if (archive.riftPoints < cost.riftPoints) {
      throw new Error('Need ' + String(cost.riftPoints) + ' Rift Points for this relic.');
    }
    const scrapBalance = await getCombatScrapBalance();
    if (scrapBalance < cost.scrap) {
      throw new Error('Not enough Combat Scrap. Need ' + String(cost.scrap) + '.');
    }
    await spendCombatScrapForRiftForge(cost.scrap);
    archive.riftPoints -= cost.riftPoints;
    archive.riftRelicLevels[relicId] = currentLevel + 1;
    try {
      await writeArchive(archive);
    } catch (error) {
      await refundCombatScrapForRiftForge(cost.scrap).catch(refundError => {
        console.error('[Rift Relic Forge] Scrap compensation failed after archive write error.', refundError);
      });
      throw error;
    }
    return snapshot(archive, await readMainProgress());
  });
}

export async function setEquippedRiftRelic(relicIdValue: unknown, equippedValue: unknown): Promise<RiftChallengeSnapshot> {
  const relicId = String(relicIdValue ?? '') as RiftRelicId;
  if (typeof equippedValue !== 'boolean') throw new Error('Choose whether to equip or unequip the relic.');
  if (!Object.prototype.hasOwnProperty.call(RIFT_RELICS, relicId)) {
    throw new Error('Choose a valid Rift relic.');
  }
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    if (archive.completedChallengeIds.length === 0) {
      throw new Error('Complete your first Rift Challenge to unlock the Relic Forge.');
    }
    if (archive.activeRun?.status === 'active') {
      throw new Error('Finish or abandon the active Rift run before changing relics.');
    }
    if ((archive.riftRelicLevels[relicId] ?? 0) <= 0) throw new Error('Forge this relic before equipping it.');
    const maxSlots = archive.riftPerkLevels.timelineFork > 0
      ? RIFT_RELIC_FORKED_EQUIP_SLOTS
      : RIFT_RELIC_EQUIP_SLOTS;
    const current = [...archive.equippedRiftRelics];
    if (equippedValue) {
      if (current.includes(relicId)) return snapshot(archive, await readMainProgress());
      if (current.length >= maxSlots) throw new Error('All relic slots are occupied. Unequip a relic first.');
      current.push(relicId);
    } else {
      const index = current.indexOf(relicId);
      if (index >= 0) current.splice(index, 1);
    }
    archive.equippedRiftRelics = normalizeEquippedRiftRelics(current, archive.riftRelicLevels, maxSlots);
    await writeArchive(archive);
    return snapshot(archive, await readMainProgress());
  });
}

export async function buyRiftPerk(perkIdValue: unknown): Promise<RiftChallengeSnapshot> {
  const perkId = String(perkIdValue ?? '') as RiftPerkId;
  if (!Object.prototype.hasOwnProperty.call(RIFT_PERKS, perkId)) {
    throw new Error('Choose a valid Rift perk.');
  }
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    if (archive.activeRun?.status === 'active' && archive.activeRun.gameState) {
      accrueRunDimensionalInterest(archive.activeRun, archive.riftPerkLevels.dimensionalInterest);
    }
    const definition = RIFT_PERKS[perkId];
    const currentLevel = archive.riftPerkLevels[perkId];
    if (currentLevel >= definition.maxLevel) throw new Error('This Rift perk is already at maximum level.');
    const cost = riftPerkCost(perkId, currentLevel);
    if (archive.riftPoints < cost) throw new Error('Need ' + String(cost) + ' Rift Points for this perk.');
    archive.riftPoints -= cost;
    archive.riftPerkLevels[perkId] = currentLevel + 1;
    if (archive.activeRun?.status === 'active' && archive.activeRun.gameState) {
      const activeState = archive.activeRun.gameState;
      if (perkId === 'automationOverride' && archive.riftPerkLevels.automationOverride > 0) {
        activeState.upgrades = { ...activeState.upgrades, auto: Math.max(1, activeState.upgrades?.auto ?? 0) };
        activeState.manualRolls = Math.max(3, activeState.manualRolls ?? 0);
      }
      if (perkId === 'chronoEngine' && archive.riftPerkLevels.chronoEngine > 0) {
        activeState.masterySkills = {
          ...activeState.masterySkills,
          cooldownReclaimer: Math.max(1, activeState.masterySkills?.cooldownReclaimer ?? 0),
        };
      }
      const nextRevision = safeInteger(activeState.stateRevision) + 1;
      if (!Number.isSafeInteger(nextRevision)) throw new Error('Rift player save reached its revision limit.');
      activeState.stateRevision = nextRevision;
    }
    archive.riftRatePerHour = riftRatePerHour(archive.completedChallengeIds, archive.riftPerkLevels);
    await writeArchive(archive);
    const mainProgress = archive.activeRun?.status === 'active' && archive.activeRun.gameState
      ? progressFromGameState(archive.activeRun.gameState)
      : await readMainProgress();
    return snapshot(archive, mainProgress);
  });
}

export async function setRiftTemporalDrag(
  multiplierValue: unknown,
  expectedRunIdValue: unknown,
): Promise<RiftChallengeSnapshot> {
  const numeric = Number(multiplierValue);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 20) {
    throw new Error('Temporal Drag must be between ×1 and ×20.');
  }
  const multiplier = normalizeRiftTemporalDragMultiplier(numeric);
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    const run = archive.activeRun;
    if (!run || run.status !== 'active') throw new Error('CHALLENGE_RUN_MISMATCH');
    assertExpectedRunId(run, expectedRunIdValue);
    accrueRunDimensionalInterest(run, archive.riftPerkLevels.dimensionalInterest);
    run.temporalDragMultiplier = multiplier;
    const state = ensureRunGameState(run);
    const nextRevision = safeInteger(state.stateRevision) + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error('Rift player save reached its revision limit.');
    state.stateRevision = nextRevision;
    syncRunSummaryFromGameState(run);
    await writeArchive(archive);
    return snapshot(archive, run.mainProgressAtStart);
  });
}

export async function chooseRiftMutation(
  mutationIdValue: unknown,
  expectedRunIdValue: unknown,
): Promise<RiftChallengeSnapshot> {
  const mutationId = String(mutationIdValue ?? '') as RiftMutationId;
  if (!getRiftMutationDefinition(mutationId)) throw new Error('Choose a valid Rift Mutation.');
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    const run = archive.activeRun;
    if (!run || run.status !== 'active') throw new Error('CHALLENGE_RUN_MISMATCH');
    assertExpectedRunId(run, expectedRunIdValue);
    if (run.activeMutation) throw new Error('A Rift Mutation is already active.');
    if (!Array.isArray(run.pendingMutationChoices) || !run.pendingMutationChoices.includes(mutationId)) {
      throw new Error('That mutation was not offered for this run.');
    }
    const now = Date.now();
    run.activeMutation = {
      id: mutationId,
      startedAt: now,
      startedAtRoll: run.totalRolls,
      endsAtRoll: run.totalRolls + riftMutationDurationRolls(archive.riftPerkLevels.anomalyPersistence),
    };
    run.pendingMutationChoices = [];
    const state = ensureRunGameState(run);
    const nextRevision = safeInteger(state.stateRevision) + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error('Rift player save reached its revision limit.');
    state.stateRevision = nextRevision;
    syncRunSummaryFromGameState(run);
    await writeArchive(archive);
    return snapshot(archive, run.mainProgressAtStart);
  });
}

export async function activateRiftEmergencyProtocol(
  expectedRunIdValue: unknown,
): Promise<RiftChallengeSnapshot> {
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    const run = archive.activeRun;
    if (!run || run.status !== 'active') throw new Error('CHALLENGE_RUN_MISMATCH');
    assertExpectedRunId(run, expectedRunIdValue);
    if (safeInteger(archive.riftPerkLevels.emergencyProtocol) <= 0) {
      throw new Error('Emergency Protocol must be unlocked first.');
    }
    const availableCharges = safeInteger(archive.riftPerkLevels.emergencyProtocol) +
      safeInteger(archive.riftPerkLevels.advancedDeployment) -
      safeInteger(run.emergencyProtocolsUsed);
    if (availableCharges <= 0) throw new Error('No Emergency Protocol charges remain this run.');
    const state = ensureRunGameState(run);
    state.lastRollAt = null;
    run.emergencyProtocolsUsed = safeInteger(run.emergencyProtocolsUsed) + 1;
    run.emergencyProtocolUntilRoll = run.totalRolls + 5;
    const nextRevision = safeInteger(state.stateRevision) + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error('Rift player save reached its revision limit.');
    state.stateRevision = nextRevision;
    syncRunSummaryFromGameState(run);
    await writeArchive(archive);
    return snapshot(archive, run.mainProgressAtStart);
  });
}

export async function abandonRiftChallenge(expectedRunIdValue: unknown): Promise<RiftChallengeSnapshot> {
  return withPlayerMutationLock(async () => {
    const archive = await readArchive();
    accrueRiftProgress(archive);
    if (!archive.activeRun || archive.activeRun.status !== 'active') {
      throw new Error('CHALLENGE_RUN_MISMATCH');
    }
    assertExpectedRunId(archive.activeRun, expectedRunIdValue);
    const completedRunId = archive.activeRun.runId;
    archive.activeRun = null;
    await writeArchive(archive);
    await deleteRiftCodexForRun(completedRunId).catch(error => {
      console.error('[Rift Challenges] Abandoned run Codex cleanup failed:', error);
    });
    return snapshot(archive, await readMainProgress());
  });
}

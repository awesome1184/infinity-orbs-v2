import type { LiveBalanceConfig } from './live-balance.js';
import { CODEX_STORAGE_VERSION, codexRarityBucket, nextCodexRarityBucket } from './collection-storage.js';

export type UpgradeId =
  | 'speed'
  | 'multi'
  | 'clusterRoll'
  | 'auto'
  | 'luck'
  | 'coinBonus'
  | 'shardChance'
  | 'xpBonus'
  | 'critChance'
  | 'critPower'
  | 'offlineRate'
  | 'valueBonus'
  | 'offlineFoundry'
  | 'orbFingers'
  | 'criticalDividend';

/**
 * Minimum player levels for standard Coin upgrades.
 */
export const UPGRADE_UNLOCK_LEVELS: Record<UpgradeId, number> = {
  speed: 1,
  multi: 1,
  luck: 1,
  coinBonus: 1,
  auto: 1,
  xpBonus: 5,
  shardChance: 10,
  critChance: 15,
  valueBonus: 20,
  critPower: 25,
  offlineRate: 30,
  offlineFoundry: 35,
  orbFingers: 40,
  criticalDividend: 45,
  clusterRoll: 50,
};

export function upgradeUnlockLevel(id: UpgradeId): number {
  return UPGRADE_UNLOCK_LEVELS[id];
}

export type MasterySkillId =
  | 'continuumLuck'
  | 'prosperity'
  | 'shardAttunement'
  | 'critMastery'
  | 'aftershock'
  | 'chronoFlow'
  | 'infiniteVault'
  | 'cosmicAttunement'
  | 'celestialSurge'
  | 'pityAccelerant'
  | 'apexFortune'
  | 'celestialVolley'
  | 'cooldownReclaimer'
  | 'altarInsurance'
  | 'constellationAtlas'
  | 'celestialAlignment';

export interface MasterySkillInfo {
  name: string;
  desc: string;
  maxLevel: number;
  costMultiplier: number;
}

export const MASTERY_SKILLS: Record<MasterySkillId, MasterySkillInfo> = {
  continuumLuck: {
    name: 'Continuum Attunement',
    desc: '+3% Luck per level.',
    maxLevel: 50,
    costMultiplier: 1,
  },
  prosperity: {
    name: 'Midas Touch',
    desc: '+12% coins earned per level.',
    maxLevel: 30,
    costMultiplier: 1,
  },
  shardAttunement: {
    name: 'Shard Resonance',
    desc: '+0.0025% Shard drop chance per level (0.25% primary-proc cap per Orb).',
    maxLevel: 25,
    costMultiplier: 2,
  },
  critMastery: {
    name: 'Critical Overdrive',
    desc: '+3% critical chance and +0.3x crit multiplier per level.',
    maxLevel: 25,
    costMultiplier: 2,
  },
  aftershock: {
    name: 'Aftershock',
    desc: 'Unlocks permanent Critical Luck from your best dry interval between successive all-time rarity records. Each 10× record tier grants +0.005×, up to +0.075×.',
    maxLevel: 1,
    costMultiplier: 4,
  },
  chronoFlow: {
    name: 'Chrono Flow',
    desc: '5% multiplicative cooldown reduction per level, compounding after all other Speed effects. Also lowers the base cooldown floor by 120ms per level; the theoretical cooldown can pass below 300ms.',
    maxLevel: 20,
    costMultiplier: 2,
  },
  infiniteVault: {
    name: 'Vault Architecture',
    desc: '+200 offline roll capacity per level.',
    maxLevel: 30,
    costMultiplier: 1,
  },
  cosmicAttunement: {
    name: 'Cosmic Affinity',
    desc: '+8% cosmic dust earned on prestige per level.',
    maxLevel: 20,
    costMultiplier: 3,
  },
  celestialSurge: {
    name: 'Codex Devotion',
    desc: '+0.3% Luck per Codex chain number per level, based on your longest consecutive rarity chain.',
    maxLevel: 10,
    costMultiplier: 3,
  },
  pityAccelerant: {
    name: 'Pity Calibration',
    desc: 'Pity luck meter requires 2 fewer dry rolls per level.',
    maxLevel: 5,
    costMultiplier: 4,
  },
  apexFortune: {
    name: 'Apex Fortune',
    desc: '3% chance per level on multi-rolls to double the luck of that activation, capped at 45%.',
    maxLevel: 15,
    costMultiplier: 3,
  },
  celestialVolley: {
    name: 'Celestial Volley',
    desc: '+1 additional orb rolled per activation per level.',
    maxLevel: 5,
    costMultiplier: 4,
  },
  cooldownReclaimer: {
    name: 'Cooldown Reclaimer',
    desc: 'Gain 1% of your current roll cooldown as Time Energy per level with each normal roll activation. Bank it to buy instant activations at your current cooldown.',
    maxLevel: 10,
    costMultiplier: 2,
  },
  altarInsurance: {
    name: 'Altar Insurance',
    desc: 'Failed Coin Breakthroughs preserve 5% of the effective offering per level as credit toward your next attempt (up to 50%).',
    maxLevel: 10,
    costMultiplier: 3,
  },
  constellationAtlas: {
    name: 'Constellation Atlas',
    desc: 'Discover distinct rarity values to unlock up to 10 permanent +1% Luck constellation milestones.',
    maxLevel: 10,
    costMultiplier: 3,
  },
  celestialAlignment: {
    name: 'Celestial Alignment',
    desc: 'Unlock a Celestial Alignment event every 20–30 minutes. Choose within 60 seconds; each effect lasts 2 hours and stacks independently.',
    maxLevel: 1,
    costMultiplier: 4,
  },
};

export const TIME_ENERGY_MAX_MS = 1_000_000_000;
/**
 * Let one spend consume the full bank even at the 300ms live cooldown floor.
 * The server still divides large spends into bounded 500,000-Orb chunks, and
 * each chunk uses the shared weighted-sample compression in applyRolls().
 */
export const TIME_ENERGY_MAX_ACTIVATIONS_PER_USE = Math.floor(TIME_ENERGY_MAX_MS / 300);

/** Number of complete roll activations a Time Energy balance can currently fund. */
export function timeEnergyActivationsAvailable(timeEnergyMs: number, cooldownMs: number): number {
  const energy = Number(timeEnergyMs);
  const cooldown = Number(cooldownMs);
  if (!Number.isFinite(energy) || !Number.isFinite(cooldown) || energy <= 0 || cooldown <= 0) return 0;
  return Math.min(TIME_ENERGY_MAX_ACTIVATIONS_PER_USE, Math.floor(Math.max(0, energy) / Math.max(1, cooldown)));
}
export const CELESTIAL_ALIGNMENT_MIN_INTERVAL_MS = 20 * 60 * 1_000;
export const CELESTIAL_ALIGNMENT_MAX_INTERVAL_MS = 30 * 60 * 1_000;
export const CELESTIAL_ALIGNMENT_MEAN_INTERVAL_MS =
  (CELESTIAL_ALIGNMENT_MIN_INTERVAL_MS + CELESTIAL_ALIGNMENT_MAX_INTERVAL_MS) / 2;
export const CELESTIAL_ALIGNMENT_LEGACY_DURATION_MS = 60 * 60 * 1_000;
export const CELESTIAL_ALIGNMENT_DURATION_MS = 2 * 60 * 60 * 1_000;
export const CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS = 60 * 1_000;
/** Allows a selection admitted before expiry to finish in the server action queue. */
export const CELESTIAL_ALIGNMENT_CHOICE_GRACE_MS = 30 * 1_000;
export type CelestialAlignmentChoice = 'starseeker' | 'goldenOrbit' | 'clockwork';
export interface CelestialAlignmentInstance { id: string; choice: CelestialAlignmentChoice; activatedAt: number; expiresAt: number; }
const CELESTIAL_ALIGNMENT_CHOICES: readonly CelestialAlignmentChoice[] = ['starseeker', 'goldenOrbit', 'clockwork'];

export function normalizeCelestialAlignmentInstances(value: unknown, legacyChoice?: unknown, legacyUntil?: unknown, now = Date.now()): CelestialAlignmentInstance[] {
  const source = Array.isArray(value) ? value : [];
  const instances: CelestialAlignmentInstance[] = [];
  for (const raw of source.slice(-100)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? '').trim().slice(0, 100);
    const choice = item.choice as CelestialAlignmentChoice;
    const activatedAt = Number(item.activatedAt);
    const expiresAt = Number(item.expiresAt);
    if (!id || !CELESTIAL_ALIGNMENT_CHOICES.includes(choice) || !Number.isSafeInteger(activatedAt) ||
        activatedAt <= 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt <= activatedAt) continue;
    instances.push({ id, choice, activatedAt, expiresAt });
  }
  if (!Array.isArray(value)) {
    const choice = legacyChoice as CelestialAlignmentChoice;
    const expiresAt = Number(legacyUntil);
    if (CELESTIAL_ALIGNMENT_CHOICES.includes(choice) && Number.isSafeInteger(expiresAt) && expiresAt > now) {
      const activatedAt = Math.max(1, expiresAt - CELESTIAL_ALIGNMENT_LEGACY_DURATION_MS);
      instances.push({ id: 'legacy-' + activatedAt.toString(36), choice, activatedAt, expiresAt });
    }
  }
  const unique = new Map<string, CelestialAlignmentInstance>();
  for (const instance of instances) unique.set(instance.id, instance);
  return [...unique.values()].sort((a, b) => a.activatedAt - b.activatedAt).slice(-100);
}
export function activeCelestialAlignmentInstances(value: unknown, now = Date.now()): CelestialAlignmentInstance[] {
  return normalizeCelestialAlignmentInstances(value, undefined, undefined, now);
}
export function celestialAlignmentStackCount(value: unknown, choice: CelestialAlignmentChoice, now = Date.now()): number {
  return activeCelestialAlignmentInstances(value, now).filter(instance => instance.choice === choice).length;
}

export const CONSTELLATION_ATLAS_MILESTONE_THRESHOLDS = [5, 10, 20, 35, 50, 75, 100, 150, 225, 325] as const;

/** Counts owned rarity keys, not consecutive rarity chains. */
export function constellationAtlasDiscoveredRarities(collection: Record<string, number> | null | undefined): number {
  return Object.entries(collection ?? {}).filter(([rarity, count]) => {
    if (!(Number(count) > 0)) return false;
    if (rarity.toLowerCase() === 'infinity') return true;
    const value = Number(rarity);
    return Number.isFinite(value) && value >= 2;
  }).length;
}

export function constellationAtlasMilestonesUnlocked(
  masteryRank: number,
  collection: Record<string, number> | null | undefined,
): number {
  const rank = Math.max(0, Math.min(CONSTELLATION_ATLAS_MILESTONE_THRESHOLDS.length, Math.floor(Number(masteryRank) || 0)));
  const discovered = constellationAtlasDiscoveredRarities(collection);
  return CONSTELLATION_ATLAS_MILESTONE_THRESHOLDS.slice(0, rank).filter(threshold => discovered >= threshold).length;
}

export function masterySkillCost(id: MasterySkillId, currentLevel: number): number {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(MASTERY_SKILLS, id)) {
    throw new Error('Unknown mastery skill.');
  }
  if (!Number.isSafeInteger(currentLevel) || currentLevel < 0) {
    throw new Error('Mastery skill level is invalid.');
  }
  const cost = Math.round(MASTERY_SKILLS[id].costMultiplier * (1 + currentLevel * 1.5));
  if (!Number.isSafeInteger(cost) || cost < 1) {
    throw new Error('Mastery skill cost is invalid.');
  }
  return cost;
}

export type PremiumBoosterId =
  | 'fortune'
  | 'hyperdrive'
  | 'barrage'
  | 'prosperity'
  | 'ascension';

export type AutomationId =
  | 'autoQuestClaim'
  | 'autoStreakClaim'
  | 'autoCommunityClaim'
  | 'autoOfflineClaim'
  | 'autoUpgrade';

export interface PremiumBoosterInfo {
  name: string;
  desc: string;
  costShards: number;
  durationMs: number;
}

export const PREMIUM_BOOSTERS: Record<PremiumBoosterId, PremiumBoosterInfo> = {
  fortune: { name: 'Fortune Surge', desc: 'Multiplies Luck by 4× while active. RNG still decides every roll.', costShards: 750, durationMs: 30 * 60 * 1000 },
  hyperdrive: { name: 'Hyperdrive', desc: 'Cuts roll cooldown to 25% of its normal value while active.', costShards: 750, durationMs: 30 * 60 * 1000 },
  barrage: { name: 'Orb Barrage', desc: 'Adds 25 extra orbs to every activation while active.', costShards: 1_000, durationMs: 30 * 60 * 1000 },
  prosperity: { name: 'Prosperity Field', desc: 'Multiplies Coin rewards by 10× while active.', costShards: 500, durationMs: 30 * 60 * 1000 },
  ascension: { name: 'Ascension', desc: 'Multiplies roll XP by 10× while active.', costShards: 750, durationMs: 30 * 60 * 1000 },
};

export function normalizeActiveBoosters(value: unknown): Partial<Record<PremiumBoosterId, number>> {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalized: Partial<Record<PremiumBoosterId, number>> = {};
  for (const id of Object.keys(PREMIUM_BOOSTERS) as PremiumBoosterId[]) {
    const expiry = source[id];
    if (typeof expiry === 'number' && Number.isSafeInteger(expiry) && expiry >= 0) {
      normalized[id] = expiry;
    }
  }
  return normalized;
}

export const AUTOMATIONS: Record<AutomationId, { name: string; desc: string; costShards: number }> = {
  autoQuestClaim: { name: 'Auto-Complete Quests', desc: 'Automatically claims completed daily and weekly quest rewards.', costShards: 7_500 },
  autoStreakClaim: { name: 'Auto-Claim Streak', desc: 'Automatically claims the daily streak reward when it becomes available.', costShards: 5_000 },
  autoCommunityClaim: { name: 'Auto-Claim Community Rewards', desc: 'Automatically claims each newly reached Community Reward tier.', costShards: 10_000 },
  autoOfflineClaim: { name: 'Auto-Claim Offline Rolls', desc: 'Automatically claims accumulated offline rolls when you return to the game.', costShards: 7_500 },
  autoUpgrade: { name: 'Auto-Complete Upgrades', desc: 'Automatically purchases one affordable standard upgrade whenever the game processes your state.', costShards: 15_000 },
};

export function normalizeAutomations(value: unknown): Partial<Record<AutomationId, boolean>> {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    (Object.keys(AUTOMATIONS) as AutomationId[]).map(id => [id, source[id] === true]),
  ) as Partial<Record<AutomationId, boolean>>;
}

/** Shards are whole-number currency. The primary roll proc is capped at 0.25% per Orb. */
export const ROLL_SHARD_PROC_CHANCE_CAP = 0.0025;
export const SHARD_DECIMAL_PLACES = 0;
export const SHARD_PRECISION = 1;
export const SHARD_PITY_ROLLS_TO_REWARD = 0;
export const SHARD_PROC_REWARD = 1;
export const SHARD_PITY_REWARD = 0;

/** Normalize the whole-Shard wallet, discarding fractional legacy balances rather than minting currency. */
export function roundShardAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(n));
}

/** Display whole Shards only. */
export function formatShardAmount(value: unknown): string {
  return roundShardAmount(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Legacy export retained for save compatibility; there is no Shard pity counter or guaranteed payout. */
export function resolveShardPityReward(state: Pick<PlayerState, 'shardPityRolls'>, procTriggered: boolean): number {
  state.shardPityRolls = 0;
  return procTriggered ? SHARD_PROC_REWARD : 0;
}

export function todayKey(now = Date.now()): string {
  const timestamp = Number(now);
  const safeTimestamp = Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15 ? timestamp : Date.now();
  return new Date(safeTimestamp).toISOString().slice(0, 10);
}

// Week boundaries are Sunday 00:00 UTC. Using the Unix epoch directly would
// start the week on Thursday because 1970-01-01 was a Thursday.
export const WEEK_MS = 604_800_000;
export const WEEK_EPOCH_SUNDAY = Date.UTC(1970, 0, 4);

export function weekStartMs(now = Date.now()): number {
  const timestamp = Number(now);
  const date = new Date(Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15 ? timestamp : Date.now());
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return startOfDay - date.getUTCDay() * 86_400_000;
}

export function weekEndMs(now = Date.now()): number {
  return weekStartMs(now) + WEEK_MS;
}

export function weekKey(now = Date.now()): number {
  return Math.floor((weekStartMs(now) - WEEK_EPOCH_SUNDAY) / WEEK_MS);
}

export interface DailyStreakCommunityEvent {
  id: string;
  goal: number;
  currentProgress: number;
  tier: number;
  completedTier: number;
  luckMultiplier: number;
  speedMultiplier: number;
  endsAt: number;
  weekId: number;
}

export function createInitialDailyStreakCommunity(now = Date.now()): DailyStreakCommunityEvent {
  return {
    id: 'daily-streak-w1',
    goal: 250,
    currentProgress: 0,
    tier: 1,
    completedTier: 0,
    luckMultiplier: 1.50,
    speedMultiplier: 0.99,
    endsAt: weekEndMs(now),
    weekId: weekKey(now),
  };
}

export function resetFreeShardBudgetIfNeeded(s: PlayerState, now = Date.now()): void {
  const today = todayKey(now);
  if (s.lastFreeShardReset === today) return;
  // This value is reporting-only after the daily earning cap was removed.
  // Always repair stale/corrupt markers and reset the display counter; it can
  // never grant or deny spendable Shards.
  s.lastFreeShardReset = today;
  s.freeShardsEarnedToday = 0;
}

function addShardsWithinSafeIntegerLimit(s: PlayerState, requested: number): number {
  const amount = roundShardAmount(requested);
  const rawCurrentShards = s.shards ?? 0;
  const currentShards = typeof rawCurrentShards === 'number' && Number.isFinite(rawCurrentShards) && rawCurrentShards >= 0 && rawCurrentShards <= Number.MAX_SAFE_INTEGER
    ? roundShardAmount(rawCurrentShards)
    : rawCurrentShards;
  // The persisted-state parser already rejects invalid balances. Keep shared
  // helpers defensive too, without silently resetting a bad balance to zero.
  if (
    typeof currentShards !== 'number' ||
    !Number.isFinite(currentShards) ||
    currentShards < 0 ||
    currentShards > Number.MAX_SAFE_INTEGER
  ) {
    return 0;
  }

  const rawLifetimeShards = s.lifetimeShards;
  const lifetimeShards =
    typeof rawLifetimeShards === 'number' &&
    Number.isFinite(rawLifetimeShards) &&
    rawLifetimeShards >= 0
      ? roundShardAmount(rawLifetimeShards)
      : 0;
  s.lifetimeShards = lifetimeShards;

  // Lifetime totals are statistics, not spendable currency. Saturate the
  // statistic independently so a maxed lifetime counter never blocks new
  // Shards that still fit safely in the player's spendable balance.
  const safeRoom = Math.max(0, Number.MAX_SAFE_INTEGER - currentShards);
  const granted = roundShardAmount(Math.min(amount, safeRoom));
  s.shards = roundShardAmount(currentShards + granted);
  s.lifetimeShards = roundShardAmount(Math.min(Number.MAX_SAFE_INTEGER, lifetimeShards + granted));
  return granted;
}

export function grantFreeShards(s: PlayerState, requested: number, _now = Date.now()): number {
  if (s.riftSession?.challengeId === 'first-spark') return 0;
  // Free rewards use the same whole-Shard normalization and numeric safety as roll rewards.
  return addShardsWithinSafeIntegerLimit(s, requested);
}

export function grantRollShards(s: PlayerState, requested: number, now = Date.now()): number {
  if (s.riftSession?.challengeId === 'first-spark') return 0;
  resetFreeShardBudgetIfNeeded(s, now);
  const rawEarnedToday = s.freeShardsEarnedToday;
  // This field is telemetry only now: malformed values are repaired, not used to
  // suppress or multiply spendable currency. There is no daily roll-earned cap.
  const earnedToday = typeof rawEarnedToday === 'number' && Number.isFinite(rawEarnedToday) && rawEarnedToday >= 0
    ? roundShardAmount(rawEarnedToday)
    : 0;
  s.freeShardsEarnedToday = earnedToday;
  const granted = addShardsWithinSafeIntegerLimit(s, requested);
  s.freeShardsEarnedToday = roundShardAmount(earnedToday + granted);
  return granted;
}

export function spendShards(s: PlayerState, requested: number): number {
  if (s.riftSession?.challengeId === 'first-spark') {
    throw new Error('Shards are disabled in The First Spark.');
  }
  if (!Number.isFinite(requested)) throw new Error('Invalid Shards amount.');
  const amount = Math.max(0, Math.floor(requested));
  if (!Number.isSafeInteger(amount)) throw new Error('Invalid Shards amount.');
  const shardBalance = typeof s.shards === 'number' && Number.isFinite(s.shards) && s.shards >= 0 && s.shards <= Number.MAX_SAFE_INTEGER
    ? roundShardAmount(s.shards)
    : 0;
  // Normalize legacy fractional saves even when this request rounds down to a zero-cost no-op.
  s.shards = shardBalance;
  if (shardBalance < amount) throw new Error('Not enough Shards.');
  if (amount <= 0) return 0;

  const purchasedBalance = Math.min(
    Number.isSafeInteger(s.purchasedShards) && (s.purchasedShards ?? 0) >= 0
      ? (s.purchasedShards ?? 0)
      : 0,
    Math.floor(shardBalance),
  );
  const freeBalance = Math.max(0, shardBalance - purchasedBalance);
  // Purchases consume whole free Shards first; purchased entitlement lots remain integers.
  const wholeFreeBalance = Math.floor(freeBalance + 1e-9);
  const purchasedToSpend = Math.max(0, amount - Math.min(amount, wholeFreeBalance));
  s.shards = roundShardAmount(shardBalance - amount);
  if (purchasedToSpend <= 0) return amount;

  const lots: Record<string, number> = { ...(s.purchasedShardLots ?? {}) };
  const lotTotal = Object.values(lots).reduce(
    (sum, raw) => sum + (Number.isSafeInteger(raw) && raw >= 0 ? raw : 0),
    0,
  );
  // Preserve provenance for legacy balances that predate per-order lot tracking.
  if (purchasedBalance > lotTotal) {
    lots.legacy = Math.max(0, Number(lots.legacy ?? 0) || 0) + (purchasedBalance - lotTotal);
  }

  let remainingPaid = purchasedToSpend;
  for (const orderId of Object.keys(lots)) {
    if (remainingPaid <= 0) break;
    const rawLot = lots[orderId];
    const lot = Number.isSafeInteger(rawLot) && rawLot >= 0 ? rawLot : 0;
    const used = Math.min(lot, remainingPaid);
    if (used > 0) {
      lots[orderId] = lot - used;
      remainingPaid -= used;
      if (lots[orderId] <= 0) delete lots[orderId];
    }
  }

  const spentPaid = purchasedToSpend - remainingPaid;
  s.purchasedShards = Math.max(0, purchasedBalance - spentPaid);
  s.purchasedShardLots = lots;
  return amount;
}
export function isPremiumBoosterActive(s: PlayerState, id: PremiumBoosterId, now = Date.now()): boolean {
  const expiry = s.activeBoosters?.[id];
  return typeof expiry === 'number' && Number.isSafeInteger(expiry) && expiry > now;
}

export function premiumBoosterRemainingMs(s: PlayerState, id: PremiumBoosterId, now = Date.now()): number {
  const expiry = s.activeBoosters?.[id];
  return typeof expiry === 'number' && Number.isSafeInteger(expiry) && expiry > now
    ? expiry - now
    : 0;
}

export function onlinePlayerLuckMultiplier(onlinePlayers: number): number {
  const count = Math.max(1, Math.floor(onlinePlayers));
  return Math.round((1 + Math.log2(count) * 0.05) * 100) / 100;
}

export type GlobalBoosterId = 'luck' | 'speed' | 'crit';

export interface GlobalBoosterState {
  tier: number;
  activationProgress: number;
  endsAt: number;
  lastTickAt?: number;
  /** Most recent four activation tiers represented by the 2-hour bar. */
  segmentTiers?: number[];
}

export type GlobalBoosterSnapshot = Record<GlobalBoosterId, GlobalBoosterState>;

export interface GuildComboState {
  tier: number;
  activationProgress: number;
  endsAt: number;
  /** Sum of all timer duration granted by Guild Task completions in this combo. */
  totalDurationMs: number;
  lastTickAt?: number;
}

export const GUILD_COMBO_BASE_DURATION_MS = 20 * 60 * 1000;
export const GUILD_COMBO_ACTIVATIONS_PER_TIER = 4;
export const GUILD_COMBO_MAX_TIER = 100;
export const GUILD_COMBO_DURATION_DECAY_PER_TIER = 0.85;
export const GUILD_COMBO_TIMER_ACCELERATION_PER_TIER = 0.25;


export const FRENZY_LOG_BASE = 1.004;
export const FRENZY_MIN_ORBS = 1;
export const FRENZY_OWNER_SHARD_REWARD = 100;
export const FRENZY_CLAIMS_PER_DAY = 3;
export const FRENZY_PROMPT_DELAY_MS = 3 * 60_000;
export const FRENZY_POST_COOLDOWN_MS = 23 * 60 * 60 * 1000;
export const FRENZY_CLAIM_COOLDOWN_MS = 23 * 60 * 60 * 1000;
export const FRENZY_POST_LIFETIME_MS = 24 * 60 * 60 * 1000;
export function frenzyOrbCountForRarity(rarity: number): number {
  const safeRarity = Math.max(1, Number(rarity) || 1);
  return Math.max(
    FRENZY_MIN_ORBS,
    Math.floor(Math.log(safeRarity) / Math.log(FRENZY_LOG_BASE)),
  );
}

export function frenzyClaimCountForRarity(
  rarity: number,
  multiRolls: number,
  frenzyVolleyLevel = 0,
): number {
  const baseCount = frenzyOrbCountForRarity(rarity);
  const safeMultiRolls = Math.max(1, Math.floor(Number(multiRolls) || 1));
  const safeVolleyLevel = Math.max(0, Math.floor(Number(frenzyVolleyLevel) || 0));
  // Frenzy always applies the full Multiball multiplier. Frenzy Volley is a
  // bonus, never a penalty: its one level adds 20% on top of that full payout.
  const volleyMultiplier = safeVolleyLevel > 0 ? 1.20 : 1;
  return Math.max(1, Math.floor(baseCount * safeMultiRolls * volleyMultiplier));
}

export function grantFrenzyOwnerShards(
  s: PlayerState,
  requested = FRENZY_OWNER_SHARD_REWARD,
): number {
  // Frenzy owner rewards share the wallet's whole-number precision and numeric bounds.
  return addShardsWithinSafeIntegerLimit(s, Number(requested));
}

export function frenzyCooldownRemaining(lastFrenzyAt?: number, now = Date.now()): number {
  if (lastFrenzyAt == null) return 0;
  if (
    typeof lastFrenzyAt !== 'number' ||
    !Number.isSafeInteger(lastFrenzyAt) ||
    lastFrenzyAt < 0
  ) return FRENZY_POST_COOLDOWN_MS;
  if (lastFrenzyAt === 0) return 0;
  return Math.max(0, lastFrenzyAt + FRENZY_POST_COOLDOWN_MS - now);
}

export function frenzyClaimsUsedToday(lastClaimDate?: string, claimsToday?: number, now = Date.now()): number {
  const today = new Date(now).toISOString().slice(0, 10);
  if (String(lastClaimDate ?? '') !== today) return 0;
  // Older saves only recorded the last claim timestamp, so count one proven claim.
  if (claimsToday === undefined || claimsToday === null) return 1;
  const count = Number(claimsToday);
  return Number.isSafeInteger(count) && count >= 0
    ? Math.min(FRENZY_CLAIMS_PER_DAY, count)
    : 1;
}

export function frenzyClaimsRemainingToday(lastClaimDate?: string, claimsToday?: number, now = Date.now()): number {
  return Math.max(0, FRENZY_CLAIMS_PER_DAY - frenzyClaimsUsedToday(lastClaimDate, claimsToday, now));
}

/** @deprecated Claim eligibility now uses the per-day counter. Retained for legacy readers and compatibility tests. */
export function frenzyClaimCooldownRemaining(lastFrenzyClaimAt?: number, now = Date.now()): number {
  if (lastFrenzyClaimAt == null) return 0;
  if (
    typeof lastFrenzyClaimAt !== 'number' ||
    !Number.isSafeInteger(lastFrenzyClaimAt) ||
    lastFrenzyClaimAt < 0
  ) return FRENZY_CLAIM_COOLDOWN_MS;
  if (lastFrenzyClaimAt === 0) return 0;
  return Math.max(0, lastFrenzyClaimAt + FRENZY_CLAIM_COOLDOWN_MS - now);
}

export function frenzyPostExpiresAt(createdAt: number): number {
  const created = Number(createdAt) || 0;
  return created > 0 ? created + FRENZY_POST_LIFETIME_MS : 0;
}

export function isFrenzyPostExpired(createdAt: number, now = Date.now()): boolean {
  const expiresAt = frenzyPostExpiresAt(createdAt);
  return expiresAt <= 0 || now >= expiresAt;
}

export function canShowDailyFrenzyPrompt(lastFrenzyAt?: number | string, now = Date.now()): boolean {
  if (typeof lastFrenzyAt === 'number' && lastFrenzyAt > 0) return frenzyCooldownRemaining(lastFrenzyAt, now) <= 0;
  return String(lastFrenzyAt ?? '') !== todayKey(now);
}

export function createInitialGuildCombo(now = Date.now()): GuildComboState {
  return { tier: 0, activationProgress: 0, endsAt: 0, totalDurationMs: 0, lastTickAt: now };
}

export function decayGuildComboState(
  state: GuildComboState | null | undefined,
  now = Date.now(),
): GuildComboState {
  const tier = Math.max(0, Math.min(GUILD_COMBO_MAX_TIER, Math.floor(Number(state?.tier ?? 0) || 0)));
  const activationProgress = Math.max(
    0,
    Math.min(
      GUILD_COMBO_ACTIVATIONS_PER_TIER - 1,
      Math.floor(Number(state?.activationProgress ?? 0) || 0),
    ),
  );
  let endsAt = Math.max(0, Math.floor(Number(state?.endsAt ?? 0) || 0));
  const previousTickAt = Math.max(0, Math.floor(Number(state?.lastTickAt ?? now) || now));
  const elapsed = Math.max(0, now - previousTickAt);
  // Legacy Guild combos predate the stored duration budget. Their last mutation
  // timestamp and deadline provide the best available estimate of time granted.
  const legacyDuration = Math.max(0, endsAt - previousTickAt);
  let totalDurationMs = Math.max(0, Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.floor(Number(state?.totalDurationMs ?? legacyDuration) || 0),
  ));

  if (tier > 0 && endsAt > 0 && elapsed > 0) {
    // Diminishing timer acceleration keeps high-tier combos demanding without making
    // tiers above 10 expire almost instantly.
    endsAt -= Math.round(elapsed * GUILD_COMBO_TIMER_ACCELERATION_PER_TIER * Math.log2(tier + 1));
  }

  if (tier <= 0 || endsAt <= now) {
    return { tier: 0, activationProgress: 0, endsAt: 0, totalDurationMs: 0, lastTickAt: now };
  }

  // Keep the display budget at least as large as the current remaining time.
  // This also makes migrated legacy snapshots safe when their inferred duration
  // is smaller than the true still-active deadline.
  totalDurationMs = Math.max(totalDurationMs, Math.min(Number.MAX_SAFE_INTEGER, endsAt - now));
  return { tier, activationProgress, endsAt, totalDurationMs, lastTickAt: now };
}

export function guildComboDurationMs(tier: number, durationMultiplier = 1): number {
  const safeTier = Math.max(1, Math.min(GUILD_COMBO_MAX_TIER, Math.floor(Number(tier) || 1)));
  return Math.max(
    60_000,
    Math.round(
      GUILD_COMBO_BASE_DURATION_MS *
      Math.pow(GUILD_COMBO_DURATION_DECAY_PER_TIER, safeTier - 1) *
      Math.max(0.5, Number(durationMultiplier) || 1),
    ),
  );
}

export function activateGuildComboStack(
  state: GuildComboState | null | undefined,
  now = Date.now(),
  maxTier = GUILD_COMBO_MAX_TIER,
  durationMultiplier = 1,
): GuildComboState {
  const current = decayGuildComboState(state, now);
  const safeMaxTier = Math.max(1, Math.min(GUILD_COMBO_MAX_TIER, Math.floor(maxTier)));
  let tier = Math.min(Math.max(0, current.tier), safeMaxTier);
  let activationProgress = current.activationProgress + 1;

  if (tier <= 0) tier = 1;

  if (activationProgress >= GUILD_COMBO_ACTIVATIONS_PER_TIER) {
    if (tier < safeMaxTier) {
      tier += 1;
      activationProgress = 0;
    } else {
      activationProgress = 0;
    }
  }

  const durationGained = guildComboDurationMs(tier, durationMultiplier);
  const endsAt = Math.max(now, current.endsAt) + durationGained;
  const totalDurationMs = Math.min(
    Number.MAX_SAFE_INTEGER,
    current.totalDurationMs + durationGained,
  );
  return { tier, activationProgress, endsAt, totalDurationMs, lastTickAt: now };
}

export function guildComboRemainingMs(state: GuildComboState | null | undefined, now = Date.now()): number {
  return Math.max(0, decayGuildComboState(state, now).endsAt - now);
}

export function guildComboProgress(state: GuildComboState | null | undefined, now = Date.now()): number {
  const current = decayGuildComboState(state, now);
  return Math.round(
    Math.min(1, Math.max(0, current.activationProgress) / GUILD_COMBO_ACTIVATIONS_PER_TIER) * 100,
  );
}

export function guildComboTimeProgress(state: GuildComboState | null | undefined, now = Date.now()): number {
  const current = decayGuildComboState(state, now);
  const remaining = Math.max(0, current.endsAt - now);
  const totalGained = Math.max(0, Number(current.totalDurationMs) || 0);
  if (remaining <= 0 || totalGained <= 0) return 0;
  return Math.round(Math.min(1, remaining / totalGained) * 10000) / 100;
}

export function guildComboLuckMultiplier(state: GuildComboState | null | undefined, now = Date.now()): number {
  const current = decayGuildComboState(state, now);
  return current.tier > 0 && current.endsAt > now ? 1 + 0.05 * current.tier : 1;
}

export function guildComboSpeedMultiplier(state: GuildComboState | null | undefined, now = Date.now()): number {
  const current = decayGuildComboState(state, now);
  return current.tier > 0 && current.endsAt > now
    ? Math.max(0.60, 1 - 0.025 * current.tier)
    : 1;
}

export function guildComboCritChanceBonus(state: GuildComboState | null | undefined, now = Date.now()): number {
  const current = decayGuildComboState(state, now);
  return current.tier > 0 && current.endsAt > now ? 0.01 * current.tier : 0;
}

export function guildComboCritLuckBonus(state: GuildComboState | null | undefined, now = Date.now()): number {
  const current = decayGuildComboState(state, now);
  return current.tier > 0 && current.endsAt > now ? 0.05 * current.tier : 0;
}

export const GLOBAL_BOOSTER_DURATION_MS = 2 * 60 * 60 * 1000;
export const GLOBAL_BOOSTER_BAR_DURATION_MS = 2 * 60 * 60 * 1000;
export const GLOBAL_BOOSTER_ACTIVATIONS_PER_TIER = 4;
export const GLOBAL_BOOSTER_TIMER_ACCELERATION_PER_TIER = 0.10;

export const GLOBAL_BOOSTERS: Record<GlobalBoosterId, {
  name: string;
  desc: string;
  costShards: number;
}> = {
  luck: {
    name: 'Global Luck',
    desc: 'Improves Luck for everyone.',
    costShards: 250,
  },
  speed: {
    name: 'Global Speed',
    desc: 'Reduces roll cooldown for everyone.',
    costShards: 250,
  },
  crit: {
    name: 'Global Crit Luck',
    desc: 'Improves Crit Chance and Crit Luck for everyone.',
    costShards: 250,
  },
};

export function createInitialGlobalBoosters(now = Date.now()): GlobalBoosterSnapshot {
  const inactive = (): GlobalBoosterState => ({
    tier: 0,
    activationProgress: 0,
    endsAt: 0,
    lastTickAt: now,
    segmentTiers: [],
  });
  return {
    luck: inactive(),
    speed: inactive(),
    crit: inactive(),
  };
}

export function decayGlobalBoosterState(
  state: GlobalBoosterState | null | undefined,
  now = Date.now(),
): GlobalBoosterState {
  const tier = Math.max(0, Math.floor(Number(state?.tier ?? 0) || 0));
  const activationProgress = Math.max(
    0,
    Math.min(
      GLOBAL_BOOSTER_ACTIVATIONS_PER_TIER - 1,
      Math.floor(Number(state?.activationProgress ?? 0) || 0),
    ),
  );
  let endsAt = Math.max(0, Math.floor(Number(state?.endsAt ?? 0) || 0));
  const previousTickAt = Math.max(
    0,
    Math.floor(Number(state?.lastTickAt ?? now) || now),
  );
  const elapsed = Math.max(0, now - previousTickAt);

  if (tier > 0 && endsAt > 0 && elapsed > 0) {
    const acceleration = 1 + tier * GLOBAL_BOOSTER_TIMER_ACCELERATION_PER_TIER;
    endsAt -= Math.round(elapsed * (acceleration - 1));
  }

  if (tier <= 0 || endsAt <= now) {
    return {
      tier: 0,
      activationProgress: 0,
      endsAt: 0,
      lastTickAt: now,
      segmentTiers: [],
    };
  }

  return {
    tier,
    activationProgress,
    endsAt,
    lastTickAt: now,
    segmentTiers: Array.isArray(state?.segmentTiers)
      ? state.segmentTiers
        .map(value => Number.isSafeInteger(value) && value >= 0 ? value : 0)
        .slice(-GLOBAL_BOOSTER_ACTIVATIONS_PER_TIER)
      : [],
  };
}

export function globalBoosterRemainingMs(
  state: GlobalBoosterState | null | undefined,
  now = Date.now(),
): number {
  const normalized = decayGlobalBoosterState(state, now);
  return Math.max(0, normalized.endsAt - now);
}

export function activateGlobalBoosterStack(
  state: GlobalBoosterState | null | undefined,
  now = Date.now(),
  maxTier = Number.MAX_SAFE_INTEGER,
): GlobalBoosterState {
  const current = decayGlobalBoosterState(state, now);
  const safeMaxTier = Math.max(1, Math.floor(maxTier));
  let tier = Math.min(Math.max(0, current.tier), safeMaxTier);
  let activationProgress = current.activationProgress + 1;

  if (tier <= 0) tier = 1;

  const segmentTier = tier;
  const segmentTiers = [...(current.segmentTiers ?? []), segmentTier]
    .slice(-GLOBAL_BOOSTER_ACTIVATIONS_PER_TIER);

  if (activationProgress >= GLOBAL_BOOSTER_ACTIVATIONS_PER_TIER) {
    if (tier < safeMaxTier) {
      tier += 1;
      activationProgress = 0;
    } else {
      activationProgress = 0;
    }
  }

  const endsAt = Math.max(now, current.endsAt) + GLOBAL_BOOSTER_DURATION_MS;
  return { tier, activationProgress, endsAt, lastTickAt: now, segmentTiers };
}

export function globalBoosterProgress(state: GlobalBoosterState | null | undefined, now = Date.now()): number {
  return Math.round(
    Math.min(1, Math.max(0, decayGlobalBoosterState(state, now).activationProgress) /
      GLOBAL_BOOSTER_ACTIVATIONS_PER_TIER) * 100,
  );
}

export function globalBoosterTimeProgress(
  state: GlobalBoosterState | null | undefined,
  now = Date.now(),
): number {
  const remaining = globalBoosterRemainingMs(state, now);
  if (remaining <= 0) return 0;
  return Math.round(
    Math.min(1, remaining / GLOBAL_BOOSTER_BAR_DURATION_MS) * 10000,
  ) / 100;
}

export function globalBoosterLuckMultiplier(state: GlobalBoosterState | null | undefined, now = Date.now()): number {
  const current = decayGlobalBoosterState(state, now);
  return current.tier > 0 && current.endsAt > now ? 1 + 0.10 * current.tier : 1;
}

export function globalBoosterSpeedMultiplier(state: GlobalBoosterState | null | undefined, now = Date.now()): number {
  const current = decayGlobalBoosterState(state, now);
  return current.tier > 0 && current.endsAt > now
    ? Math.max(0.35, 1 - 0.05 * current.tier)
    : 1;
}

export function globalBoosterCritChanceBonus(state: GlobalBoosterState | null | undefined, now = Date.now()): number {
  const current = decayGlobalBoosterState(state, now);
  return current.tier > 0 && current.endsAt > now ? 0.02 * current.tier : 0;
}

export function globalBoosterCritLuckBonus(state: GlobalBoosterState | null | undefined, now = Date.now()): number {
  const current = decayGlobalBoosterState(state, now);
  return current.tier > 0 && current.endsAt > now ? 0.10 * current.tier : 0;
}

const GLOBAL_BOOSTER_BAR_COLORS = [
  '#c084fc',
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#fb7185',
  '#a78bfa',
  '#22d3ee',
  '#f472b6',
];

export function globalBoosterBarColor(tier: number): string {
  const normalizedTier = Math.max(0, Math.floor(Number(tier) || 0));
  return GLOBAL_BOOSTER_BAR_COLORS[normalizedTier % GLOBAL_BOOSTER_BAR_COLORS.length];
}

export type FeatureId =
  | 'upgrades'
  | 'quests'
  | 'collection'
  | 'boosters'
  | 'shop'
  | 'social'
  | 'altar'
  | 'mastery'
  | 'prestige'
  | 'combat';

export const FEATURE_UNLOCK_LEVELS: Record<FeatureId, number> = {
  upgrades: 2,
  quests: 3,
  collection: 4,
  boosters: 5,
  shop: 5,
  social: 7,
  altar: 10,
  mastery: 15,
  prestige: 20,
  combat: 8,
};

export function featureUnlockLevel(feature: FeatureId): number {
  return FEATURE_UNLOCK_LEVELS[feature];
}


export interface PurchasePack {
  sku: string;
  name: string;
  description: string;
  priceGold: number;
  shards: number;
  globalBoosterCredits: number;
}

export const PURCHASE_PACKS: PurchasePack[] = [
  {
    sku: 'shards-100',
    name: '100 Shards + 1 Global Boost',
    description: '100 Shards and 1 free Global Booster activation.',
    priceGold: 50,
    shards: 100,
    globalBoosterCredits: 1,
  },
  {
    sku: 'shards-600',
    name: '600 Shards + 8 Global Boosts',
    description: '600 Shards and 8 free Global Booster activations.',
    priceGold: 250,
    shards: 600,
    globalBoosterCredits: 8,
  },
  {
    sku: 'shards-1400',
    name: '1,400 Shards + 20 Global Boosts',
    description: '1,400 Shards and 20 free Global Booster activations.',
    priceGold: 500,
    shards: 1_400,
    globalBoosterCredits: 20,
  },
];

export const ORB_FRENZY_DAILY_KEY_OFFSET = 0;

export type PrestigeUpgradeId =
  | 'permLuck'
  | 'permSpeed'
  | 'unbrokenMomentum'
  | 'vaultCap'
  | 'sonarPing'
  | 'instantReveal'
  | 'autoOverclock'
  | 'autoFilter'
  | 'resonanceMeter'
  | 'stellarMagnet'
  | 'chronoOverdrive'
  | 'transmutation'
  | 'shardSynthesis'
  | 'astralBarrage'
  | 'cosmicInheritance'
  | 'autoBuyer'
  | 'supernova'
  | 'altarResonator'
  | 'offlineOverdrive'
  | 'luckyFloor'
  | 'astralArsenal'
  | 'deepVault'
  | 'steadyHands'
  | 'offlineFortune'
  | 'frenzyVolley'
  | 'astralReserve'
  | 'temporalCompression'
  | 'shardResonator'
  | 'cosmicValuation'
  | 'cosmicReserve'
  | 'autoScrap';

export function createSeededRandom(seed: number): () => number {
  let state = (Math.floor(Number(seed)) >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function rollTicketSeed(seed: number, index: number): number {
  let x = ((Math.floor(Number(seed)) >>> 0) ^ Math.imul(Math.max(0, Math.floor(Number(index))), 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export interface RollPrediction {
  state: PlayerState;
  orb: Orb;
  batch: Orb[];
  totalValueGained: number;
  coinsGained: number;
  shardsGained: number;
  xpGained: number;
  rollsProcessed: number;
}

export interface Orb {
  /** Stored numeric rarity; over-cap rolls are represented by MAX_ORB_RARITY plus isInfinity. */
  rarity: number;
  rolledAt: number;
  tier: string;
  name: string;
  /** True only when the uncapped rarity calculation overflowed the finite Number range. */
  isInfinity?: boolean;
  isNew?: boolean;
  isCrit?: boolean;
}

export interface QuestItem {
  id: string;
  title: string;
  desc: string;
  target: number;
  unlocked?: boolean;
  progress: number;
  rewardCoins: number;
  rewardShards?: number;
  rewardTokens?: number;
  rewardXp?: number;
  minRarity?: number;
  unlockRarity?: number;
  claimed: boolean;
}

export interface PlayerStreak {
  count: number;
  lastClaimDate: string; // YYYY-MM-DD
  longestStreak: number;
}

export type GamePopupId = 'notification' | 'frenzy' | 'frenzyShard' | 'joinSubreddit';
export type GamePopupEvent = 'shown' | 'accepted' | 'dismissed';
export interface PopupConfig { notification: boolean; frenzy: boolean; frenzyShard: boolean; joinSubreddit: boolean }
export interface PopupMetric { shown: number; accepted: number; dismissed: number; acceptanceRate: number }
export type PopupStats = Record<GamePopupId, PopupMetric>;
export const DEFAULT_POPUP_CONFIG: PopupConfig = { notification: true, frenzy: true, frenzyShard: true, joinSubreddit: true };

export interface RiftPlayerSession {
  runId: string;
  challengeId: string;
  targetRarity: number;
  baseCooldownMs: number;
  upgradeLevels: { fortune: number; speed: number; prosperity: number; critical: number };
  riftLuckPerkLevel: number;
  riftSpeedPerkLevel: number;
  temporalDragMultiplier?: number;
  temporalArbitrageLevel?: number;
  temporalCompressionLevel?: number;
  probabilityDebtLevel?: number;
  fractureCascadeLevel?: number;
  echoChamberLevel?: number;
  singularityFocusLevel?: number;
  bossResonanceLevel?: number;
  masteryBridgeLevel?: number;
  runeReconnectionLevel?: number;
  automationOverrideLevel?: number;
  chronoEngineLevel?: number;
  combatIntegrationLevel?: number;
  initialCalibrationLevel?: number;
  earlyAuthorizationLevel?: number;
  riftConditioningLevel?: number;
  fortuneReservoirLevel?: number;
  criticalConversionLevel?: number;
  fractureRecyclingLevel?: number;
  milestoneAmplifierLevel?: number;
  anomalyHarvestingLevel?: number;
  anomalyForecasterLevel?: number;
  emergencyProtocolLevel?: number;
  riftConditioningCompletions?: number;
  mutationStabilizerLevel?: number;
  mutationAmplifierLevel?: number;
  mutationExtractionLevel?: number;
  anomalyPersistenceLevel?: number;
  activeMutation?: { id: string; startedAtRoll: number; endsAtRoll: number } | null;
  emergencyProtocolUntilRoll?: number;
  emergencyProtocolCharges?: number;
  challengeCoinMultiplier: number;
  riftRelicLuckExcessMultiplier?: number;
  riftObserverLuckMultiplier?: number;
  riftLoadedDieMultiplier?: number;
  riftFractureCascadeMultiplier?: number;
  riftFractureCascadePending?: boolean;
  riftRelicCompletionRewardMultiplier?: number;
  riftTemporalArbitrageEfficiency?: number;
  riftTemporalDragPenaltyReduction?: number;
  riftStillnessCooldownReduction?: number;
  riftRelicProgressCoinBonus?: number;
}
 
export interface PlayerState {
  /** Runtime-only marker that routes all normal game reads and writes to the active Rift save. */
  riftSession?: RiftPlayerSession;
  /** Runtime-only flag returned on the roll that completes a Rift challenge. */
  riftRunComplete?: boolean;
  /** Runtime-only first-clear announcement payload attached only after the Rift transaction commits. */
  riftChallengeFirstClear?: { challengeId: string; challengeName: string; runId: string; completedAt: number; ownerId: string; ownerUsername: string };
  /** Shard reward notice queued by Frenzy claims and acknowledged when the owner dismisses it. */
  frenzyShardPopupPending?: { amount: number; eventCount: number; lastRewardAt: number };
  /** Runtime identity that lets the client distinguish a completed Rift response from the restored main save. */
  riftSaveContext?: string;
  username?: string;
  // Monotonic save version used to reject stale full-state writes.
  stateRevision?: number;
  // Whether the player wants Auto Roll to remain enabled between sessions.
  autoRollEnabled?: boolean;
  // Incremented whenever an admin wipes this account. Prevents stale in-flight
  // requests from resurrecting pre-wipe save data.
  saveGeneration?: number;
  gameBan?: {
    active: true;
    bannedAt: number;
    bannedUntil: number | null;
    reason: string;
  };
  coins: number;
  shards: number;
  cosmicDust: number;
  level: number;
  xp: number;
  // Lifetime XP at the start of the current level. This preserves progression
  // for accounts created under older XP curves while keeping the current curve
  // for all future level-ups.
  levelXpFloor?: number;
  totalRolls: number;
  manualRolls: number;
  totalCrits: number;
  lifetimeCoins: number;
  lifetimeShards: number;
  highestRarity: number;
  /** True when the best rarity was a mathematically over-cap roll, not merely Number.MAX_VALUE. */
  highestRarityIsInfinity?: boolean;
  collectionValue: number;
  lifetimeCollectionValue: number;
  collection: Record<string, number>;
  /** Versioned external Redis hash storage keeps the growing Codex out of player saves. */
  collectionStorageVersion?: number;
  collectionCount?: number;
  codexChain?: number;
  codexChainStart?: number;
  codexChainEnd?: number;
  codexDevotionLuckPercent?: number;
  /** Persistent charge for equipped Shard Constellation Rune effects. */
  runeConstellationCharge?: number;
  /** Persistent charge meter for equipped Temporal Loop Rune effects. */
  runeTemporalMomentum?: number;
  /** If positive, the next accepted roll is exactly one orb of this rarity. */
  chainPatcherNextRarity?: number;
  /** True when the pending exact-rarity charge came from the admin's Queue Next command. */
  adminGuaranteedRollQueued?: boolean;
  /** Server-calculated Codex target shown before purchase; null means no extension exists. */
  chainPatcherSuggestedRarity?: number | null;
  /** Absolute timestamp when the next Chain Patcher purchase is allowed. */
  chainPatcherCooldownUntil?: number;
  lastRollAt: number | null;
  /** Milliseconds of recovered cooldown available for instant activations. */
  timeEnergy?: number;
  /** Next independent random Alignment event timestamp. */
  alignmentNextAt?: number;
  /** Timestamp of an unclaimed Alignment prompt; zero means none is pending. */
  alignmentPendingAt?: number;
  /** True only for a prompt explicitly queued by the admin test console. */
  alignmentPendingForced?: boolean;
  alignmentActiveInstances?: CelestialAlignmentInstance[];
  alignmentActiveChoice?: CelestialAlignmentChoice | null;
  alignmentActiveUntil?: number;
  lastSeenAt: number;
  offlineRolls: number;
  claimedAchievements: string[];
  upgrades: Record<UpgradeId, number>;
  prestigeCount: number;
  prestigeUpgrades: Record<PrestigeUpgradeId, number>;
  streak: PlayerStreak;
  dailyStreakCommunity?: DailyStreakCommunityEvent;
  dailyQuests: QuestItem[];
  weeklyQuests: QuestItem[];
  lastDailyReset: string;
  lastWeeklyReset: string;
  rollsSinceBest: number;
  /** Remaining Rift-only Fracture Cascade rolls, persisted across activations. */
  riftFractureCascadeRollsRemaining?: number;
  /** Best number of rolls between successive all-time rarity records. Persists through Prestige. */
  aftershockRecord?: number;
  /** Beginning of the current uninterrupted online rolling session. */
  rollingSessionStartedAt?: number;
  /** Timestamp of the most recent roll counted toward the current session. */
  rollingSessionLastRollAt?: number;
  /** Longest uninterrupted online rolling session, in milliseconds. */
  longestRollingSessionMs?: number;
  highestDryStreak?: number;
  freeRolls?: number;
  activeCosmetic: string;
  unlockedCosmetics: string[];
  turboRollUntil: number; // timestamp
  activeBoosters?: Partial<Record<PremiumBoosterId, number>>;
  automations?: Partial<Record<AutomationId, boolean>>;
  /** User-configurable Auto Scrap cutoff, gated by the Auto Scrap Prestige upgrade. */
  combatAutoScrap: { enabled: boolean; maxQuality: number };
  onlinePlayers?: number;
  communityRewardClaimedAt?: number;
  freeShardsEarnedToday?: number;
  /** Consecutive rolls without a Shard proc; resets on proc or guaranteed pity. */
  shardPityRolls?: number;
  lastFreeShardReset?: string;
  purchasedShards?: number;
  /** Remaining purchased Shards by payment order. Legacy saves migrate into the "legacy" lot. */
  purchasedShardLots?: Record<string, number>;
  globalBoosterCredits?: number;
  /** Remaining purchased Global Booster credits by payment order; non-purchased grants have no lot. */
  globalBoosterCreditLots?: Record<string, number>;
  globalBoosters?: GlobalBoosterSnapshot;
  guildCombo?: GuildComboState;

  lastFrenzyDate?: string;
  lastFrenzyAt?: number;
  lastFrenzyClaimDate?: string;
  lastFrenzyClaimAt?: number;
  frenzyClaimsToday?: number;
  pendingFrenzyOfflineClaimCount?: number;
  pendingFrenzyOfflineShards?: number;
  communityRewardClaimedTier?: number;
  paymentReceipts?: Record<string, PaymentReceipt | 'fulfilled' | 'refunded'>;
  currentRunRolls?: number;
  questsCompleted?: number;
  guildContribution?: number;
  sacrifices?: {
    coinsSacrificed: number;
    shardsSacrificed: number;
    altarLevel: number;
    luckSurgeUntil?: number; // timestamp
    altarPity?: number; // consecutive failed coin breakthrough attempts
    /** Offering value carried forward by Altar Insurance after a failed breakthrough. */
    altarInsuranceCredit?: number;
  };
  masteryPoints?: number;
  masterySkills?: Record<MasterySkillId, number>;
  socialActivityDate?: string;
  lastShareAt?: number;
  guildPerks?: {
    luckRank: number;
    speedRank: number;
    vaultRank: number;
    shardRank?: number;
    critRank?: number;
    coinRank?: number;
    memberCapacityRank?: number;
    tokenYieldRank?: number;
    guildXpRank?: number;
  };
}

export interface PaymentReceipt {
  status: 'fulfilled' | 'refunded';
  shards: number;
  globalBoosterCredits: number;
}

export interface RollResponse {
  orb: Orb;
  batch: Orb[];
  totalValueGained: number;
  totalRollValue: number;
  coinsGained: number;
  shardsGained: number;
  xpGained: number;
  state: PlayerState;
  rollsRemainingUntilNext: number;
  rollsProcessed?: number;
  dramaticReveal: boolean;
  frenzyCount?: number;
}

export type RarityTierName =
  | 'Common'
  | 'Uncommon'
  | 'Rare'
  | 'Epic'
  | 'Legendary'
  | 'Mythic'
  | 'Relic'
  | 'Divine'
  | 'Transcendent'
  | 'Ascendant'
  | 'Eternal'
  | 'Celestial'
  | 'Infinite'
  | 'Absolute'
  | 'Omniversal'
  | 'Paradox'
  | 'Beyond'
  | 'Endless'
  | 'Empyrean'
  | 'Hyperversal'
  | 'Transfinite'
  | 'Metacosmic'
  | 'Primordial'
  | 'Unfathomable'
  | 'Axiom'
  | 'Omniscient'
  | 'Omega'
  | 'Hyperion'
  | 'Ethereal'
  | 'Aetherion'
  | 'Nexus'
  | 'Archetype'
  | 'Apotheosis'
  | 'Eschaton'
  | 'Omniform'
  | 'Eternity';

export interface RarityTierInfo {
  rarity: number;
  name: string;
  tier: RarityTierName | 'Infinity';
  approxChance: string;
  color: string;
  bgGradient: string;
  animated?: boolean;
}

export function getOrbTier(rarity: number): RarityTierName {
  if (rarity >= 1e62) return 'Eternity';
  if (rarity >= 1e59) return 'Omniform';
  if (rarity >= 1e56) return 'Eschaton';
  if (rarity >= 1e53) return 'Apotheosis';
  if (rarity >= 1e50) return 'Archetype';
  if (rarity >= 1e47) return 'Nexus';
  if (rarity >= 1e44) return 'Aetherion';
  if (rarity >= 1e41) return 'Ethereal';
  if (rarity >= 1e38) return 'Hyperion';
  if (rarity >= 1e35) return 'Omega';
  if (rarity >= 1e33) return 'Omniscient';
  if (rarity >= 1e31) return 'Axiom';
  if (rarity >= 1e29) return 'Unfathomable';
  if (rarity >= 1e27) return 'Primordial';
  if (rarity >= 1e25) return 'Metacosmic';
  if (rarity >= 1e23) return 'Transfinite';
  if (rarity >= 1e21) return 'Hyperversal';
  if (rarity >= 1e19) return 'Empyrean';
  if (rarity >= 1e17) return 'Endless';
  if (rarity >= 1e16) return 'Beyond';
  if (rarity >= 1e15) return 'Paradox';
  if (rarity >= 1e14) return 'Omniversal';
  if (rarity >= 1e13) return 'Absolute';
  if (rarity >= 1e12) return 'Infinite';
  if (rarity >= 1e11) return 'Celestial';
  if (rarity >= 1e10) return 'Eternal';
  if (rarity >= 1e9) return 'Ascendant';
  if (rarity >= 1e8) return 'Transcendent';
  if (rarity >= 1e7) return 'Divine';
  if (rarity >= 1e6) return 'Relic';
  if (rarity >= 1e5) return 'Mythic';
  if (rarity >= 1e4) return 'Legendary';
  if (rarity >= 1e3) return 'Epic';
  if (rarity >= 1e2) return 'Rare';
  if (rarity >= 10) return 'Uncommon';
  return 'Common';
}

export const ORB_TIER_NAMES: Record<RarityTierName, string[]> = {
  Common: ['Spark Orb', 'Mist Orb', 'Pebble Orb', 'Ember Orb', 'Dew Orb', 'Echo Orb', 'Flint Orb', 'Haze Orb', 'Moss Orb', 'Ripple Orb', 'Cinder Orb', 'Drift Orb', 'Brook Orb', 'Cloud Orb', 'Ash Orb', 'Glimmer Orb'],
  Uncommon: ['Tide Orb', 'Vapor Orb', 'Gale Orb', 'Frost Orb', 'Amethyst Orb', 'Verdant Orb', 'Moonstone Orb', 'Tempest Orb', 'Glacier Orb', 'Jade Orb', 'Zephyr Orb', 'Coral Orb', 'Shimmer Orb', 'Thunderhead Orb', 'Aquamarine Orb', 'Wildwood Orb'],
  Rare: ['Chrono Orb', 'Prism Orb', 'Thunder Orb', 'Aurora Orb', 'Plasma Orb', 'Quartz Orb', 'Stormglass Orb', 'Runebound Orb', 'Luminous Orb', 'Obsidian Orb', 'Comet Orb', 'Arcane Orb', 'Voidlight Orb', 'Starforge Orb', 'Sapphire Orb', 'Rift Orb'],
  Epic: ['Aether Orb', 'Solaris Orb', 'Eclipse Orb', 'Radiant Orb', 'Abyssal Orb', 'Inferno Orb', 'Celestial Forge', 'Dreadnova Orb', 'Crimson Zenith', 'Moonfall Orb', 'Astral Flame', 'Stormcaller Orb', 'Sunshard Orb', 'Voidfire Orb', 'Argent Dawn', 'Etherstorm Orb'],
  Legendary: ['Nova Orb', 'Starlight Orb', 'Quasar Orb', 'Vortex Orb', 'Nebula Orb', 'Supernova Orb', 'Titanfall Orb', 'Event Horizon Orb', 'Cosmic Tempest', 'Star Eater Orb', 'Dawnbringer Orb', 'Void Emperor', 'Galactic Crown', 'Solar Requiem', 'Worldshaper Orb', 'Red Giant Orb'],
  Mythic: ['Singularity Orb', 'Cosmic Core Orb', 'Hypernova Orb', 'Dark Star Orb', 'Astral Rift Orb', 'Void Titan', 'Primordial Star', 'Reality Breaker', 'Entropy Heart', 'Godparticle Orb', 'Black Sun Orb', 'Celestial Maw', 'Dream of Worlds', 'Omega Flare', 'Unwritten Sky'],
  Relic: ['Infinite Relic', 'Omega Fragment', 'Primordial Core', 'Eternal Horizon', 'Void Monolith', 'Astral Archive', 'Forgotten Axis', 'Timeworn Crown', 'Worldroot', 'Dead Star Reliquary', 'Chrono Relic', 'Hollow Genesis', 'First Ember', 'Last Artifact', 'Shattered Continuum'],
  Divine: ['Divine Eternity', 'Celestial Pantheon', 'Omnipresent Eye', 'Seraphic Sphere', 'Halo of Creation', 'Throne of Light', 'Archon Prism', 'Sacred Singularity', 'Choir of Suns', 'Grace Eternal', 'Oracle’s Heart', 'Empyrean Seal', 'Elysian Gate', 'Dawn of All'],
  Transcendent: ['The Absolute Zero', 'Infinity Point', 'Cosmic Monolith', 'Genesis Void', 'Beyond the First', 'Uncaused Flame', 'Unbound Equation', 'Transfinite Crown', 'Outside Time', 'The Unmaking', 'Apex of Being', 'Lawless Origin', 'Ever-Ascending', 'Inconceivable End'],
  Ascendant: ['Redshift Orb', 'Pulsar Orb', 'Neutron Orb', 'Quasar Prime', 'Blazar Core', 'Magnetar Orb', 'Zenith Star', 'Ascension Gate', 'Radiant Climb', 'Solar Apex', 'Blue Giant Orb', 'Dawnflare Orb', 'Crowned Pulsar', 'Helios Engine'],
  Eternal: ['Eventide Orb', 'Worldline Orb', 'Stellar Crown', 'Eternal Core', 'Ageglass Heart', 'Timeless Beacon', 'Unending Dawn', 'Aeon Pearl', 'Evernight Star', 'Perennial Nova', 'Century Flame', 'Ageless Tide', 'Infinity Clock', 'Constant Flame'],
  Celestial: ['Heavenfall Orb', 'Solar Flare Orb', 'Astral Crown', 'Celestial Engine', 'Moon Choir', 'Star Cathedral', 'Orion’s Halo', 'Skyvault Orb', 'Zodiac Heart', 'Comet Basilica', 'Heaven’s Compass', 'Seraph Star', 'Constellation Seed', 'Firmament Core'],
  Infinite: ['Infinite Horizon', 'Endless Core', 'Void Singularity', 'Infinity Seed', 'Unbounded Sea', 'Infinite Bloom', 'Limitless Star', 'Evermore Engine', 'Endless Expanse', 'Horizon Beyond', 'Infinite Mirror', 'Boundless Eye', 'Uncapped Flame', 'Neverending Axis'],
  Absolute: ['Absolute Orb', 'First Principle', 'Origin Point', 'Final Horizon', 'Zero Beyond Zero', 'Prime Law', 'Unconditioned Core', 'Absolute Dawn', 'The Necessary', 'Pure Existence', 'Perfect Null', 'First and Last', 'Unbroken Axiom', 'Root of Everything'],
  Omniversal: ['Omniversal Eye', 'Totality Core', 'Everything Orb', 'The Last Constant', 'All-Reality Seed', 'Grand Ensemble', 'Everywhen Core', 'Multitude Crown', 'The Sum of Worlds', 'Totality Engine', 'Omni-Origin', 'The Whole Beyond', 'Allspace Pearl', 'Full Spectrum'],
  Paradox: ['Paradox Orb', 'Contradiction Core', 'Broken Loop', 'Null Point', 'Impossible Horizon', 'Causal Knot', 'Self-Undoing Star', 'Schrödinger’s Crown', 'False Origin', 'Two-Truth Engine', 'The Unresolved', 'Logicbreaker Orb', 'Ever-Now Shard', 'Loop Without End'],
  Beyond: ['Beyond Orb', 'Outer Core', 'Far Point', 'Unknown Edge', 'Unseen Boundary', 'Outside the Map', 'The Further', 'Elsewhere Engine', 'The Unreached', 'Distant Outside', 'Untouchable Horizon', 'Outer Silence', 'Uncharted Constant', 'Not-Here Star'],
  Endless: ['Endless Orb', 'Final Loop', 'Last Horizon', 'Zero Point', 'Penultimate Dawn', 'Everturn Core', 'Loop Eternal', 'After the End', 'Final Finality', 'Closing Star', 'The Last Orbit', 'One More World', 'End That Waits', 'Final Continuation'],
  Empyrean: ['Empyrean Orb', 'Heavenforge Core', 'Astral Throne', 'Radiant Apex', 'Crown of Dawn', 'Elysium Engine', 'Skybound Origin', 'Seraphic Horizon', 'Heavenlit Last Light', 'Unbounded Throne', 'First Firmament', 'Radiant Elsewhere', 'The Beyond Crown', 'Unwritten Heaven'],
  Hyperversal: ['Hyperversal Orb', 'Beyondspace Heart', 'Grand Infinity', 'Multiverse Loom', 'Reality Crown', 'Paragon Star', 'Omni Horizon', 'Eververse Core', 'Hyperverse Beacon', 'Infinite Loom', 'Reality Above', 'Unending Multiverse', 'Worldframe Orb', 'The Far Singularity'],
  Transfinite: ['Transfinite Orb', 'Uncountable Flame', 'Aleph Core', 'Beyond Number', 'Infinite Ladder', 'Limitless Axiom', 'Set of All Suns', 'Cardinal Dawn', 'Aleph Infinity', 'Countless Dawn', 'Uncountable Sea', 'Transfinite Crown', 'Beyond Cardinality', 'The Final Set'],
  Metacosmic: ['Metacosmic Orb', 'Cosmos Above Cosmos', 'Outer Creation', 'Meta-Origin', 'Worldswell Core', 'Outside Everything', 'Allframe Engine', 'Beyondspace Crown', 'Meta-Cosmos Beacon', 'Outside Creation', 'The Outer Principle', 'Cosmic Mirror', 'Worlds Beyond Worlds', 'Allframe Singularity'],
  Primordial: ['Primordial Orb', 'First Silence', 'Genesis Seed', 'Before Time', 'Origin Ember', 'The First Law', 'Dawn Unmade', 'Primordial Axis', 'Origin of Stars', 'Before the First', 'Genesis Crown', 'First Emberlight', 'Primordial Sea', 'Beginning Without End'],
  Unfathomable: ['Unfathomable Orb', 'Depth Without End', 'Nameless Beyond', 'Unseen Constant', 'Horizonless Core', 'Unknown Absolute', 'The Unmeasured', 'Dark Before Dawn', 'Nameless Deep', 'The Unmeasured Crown', 'Abyss Before Time', 'Unknown Genesis', 'Endless Mystery', 'Horizon Unseen'],
  Axiom: ['Axiom Orb', 'First Truth', 'Prime Axiom', 'Proof Eternal', 'The Necessary', 'Root Principle', 'Unbroken Theorem', 'Law of All', 'Axiom of Light', 'First Proof', 'The Prime Rule', 'Truth Unbroken', 'Essential Constant', 'Absolute Theorem'],
  Omniscient: ['Omniscient Orb', 'All-Knowing Star', 'Total Awareness', 'The Witness', 'All-Seen Core', 'Evermind', 'Infinite Archive', 'Knowledge Without End', 'Eye Beyond All', 'All-Knowing Crown', 'The Great Witness', 'Infinite Testament', 'Archive of Everything', 'Mind of Eternity'],
  Omega: ['Omega Orb', 'Last Beginning', 'Final Axiom', 'End of All Ends', 'Closure Engine', 'Last Truth', 'The Final Constant', 'Omega Horizon', 'Omega Singularity', 'The Last Horizon', 'Final Beginning', 'Closure of Creation', 'The Last Principle', 'Ultimate Continuum'],
  Hyperion: ["Hyperion Orb","Crimson Singularity","Solar Apex Prime","Heart of the Flare","Redshift Crown","The Burning Constant","First Supergiant","Dawnfire Engine"],
  Ethereal: ["Ethereal Orb","Veil of Creation","Spectral Horizon","Unseen Aether","Wisp of Forever","The Quiet Expanse","Pale Genesis","Shimmering Elsewhere"],
  Aetherion: ["Aetherion Orb","Aether Crown","Astral Dominion","First Ether","The Violet Engine","Starless Throne","Aetherwake","Crown of the Unseen"],
  Nexus: ["Nexus Orb","Convergence Core","Junction of Worlds","The Great Link","Crossroads Eternal","Nexus Bloom","Allpaths Engine","Confluence Star"],
  Archetype: ["Archetype Orb","Prime Pattern","Form Eternal","Blueprint of All","The First Shape","Origin Template","Perfect Pattern","Universal Mold"],
  Apotheosis: ["Apotheosis Orb","Ascension Absolute","Godform Engine","The Unbound Crown","Last Transfiguration","Radiant Apotheon","Beyond Divinity","Sovereign of Light"],
  Eschaton: ["Eschaton Orb","Final Dawn","Terminus Star","Last Eventide","The Closing Sky","Endtime Core","Last Horizon Prime","The Final Bloom"],
  Omniform: ["Omniform Orb","Shape of Everything","Allform Engine","Infinite Morph","The Total Pattern","Formless Crown","Omni-Genesis","Allshape Singularity"],
  Eternity: ["Eternity Orb","Everlasting Core","The Timeless One","Eternal Horizon Prime","Endless Beginning","Forever Engine","Unending Constant","Age Without End"],
};

const TIER_COLORS: Record<RarityTierName, { color: string; bgGradient: string }> = {
  Common: {
    color: '#8D99AE',
    bgGradient: 'radial-gradient(circle at 35% 30%, #E2E8F0, #8D99AE 52%, #293241 100%)',
  },
  Uncommon: {
    color: '#43AA8B',
    bgGradient: 'radial-gradient(circle at 35% 30%, #B7F7DD, #43AA8B 52%, #064E3B 100%)',
  },
  Rare: {
    color: '#4361EE',
    bgGradient: 'radial-gradient(circle at 35% 30%, #BFDBFE, #4361EE 52%, #1E3A8A 100%)',
  },
  Epic: {
    color: '#F3722C',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FED7AA, #F3722C 52%, #7C2D12 100%)',
  },
  Legendary: {
    color: '#90BE6D',
    bgGradient: 'radial-gradient(circle at 35% 30%, #D9F99D, #90BE6D 52%, #365314 100%)',
  },
  Mythic: {
    color: '#8338EC',
    bgGradient: 'radial-gradient(circle at 35% 30%, #DDD6FE, #8338EC 52%, #3B0764 100%)',
  },
  Relic: {
    color: '#FFD166',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FFF1B8, #FFD166 52%, #854D0E 100%)',
  },
  Divine: {
    color: '#118AB2',
    bgGradient: 'radial-gradient(circle at 35% 30%, #A5F3FC, #118AB2 52%, #164E63 100%)',
  },
  Transcendent: {
    color: '#FF006E',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FFC2DE, #FF006E 52%, #831843 100%)',
  },
  Ascendant: {
    color: '#F94144',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FECACA, #F94144 52%, #7F1D1D 100%)',
  },
  Eternal: {
    color: '#007F5F',
    bgGradient: 'radial-gradient(circle at 35% 30%, #99F6E4, #007F5F 52%, #134E4A 100%)',
  },
  Celestial: {
    color: '#F4A261',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FFE0BD, #F4A261 52%, #7C2D12 100%)',
  },
  Infinite: {
    color: '#4CC9F0',
    bgGradient: 'radial-gradient(circle at 35% 30%, #C4F1FF, #4CC9F0 52%, #1E40AF 100%)',
  },
  Absolute: {
    color: '#B56576',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FBCFE8, #B56576 52%, #831843 100%)',
  },
  Omniversal: {
    color: '#A3E635',
    bgGradient: 'radial-gradient(circle at 35% 30%, #ECFCCB, #A3E635 52%, #365314 100%)',
  },
  Paradox: {
    color: '#264653',
    bgGradient: 'radial-gradient(circle at 35% 30%, #A8DADC, #264653 52%, #0B2530 100%)',
  },
  Beyond: {
    color: '#6D597A',
    bgGradient: 'radial-gradient(circle at 35% 30%, #E9D5FF, #6D597A 52%, #2E1A47 100%)',
  },
  Endless: {
    color: '#F8FAFC',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FFFFFF, #F8FAFC 52%, #64748B 100%)',
  },
  Empyrean: {
    color: '#C77DFF',
    bgGradient: 'radial-gradient(circle at 29% 23%, #FFF7ED 0%, #FDBA74 18%, #C77DFF 43%, #6D28D9 70%, #1E1B4B 100%)',
  },
  Hyperversal: {
    color: '#355070',
    bgGradient: 'radial-gradient(circle at 30% 22%, #DBEAFE 0%, #60A5FA 19%, #355070 43%, #7C3AED 70%, #111827 100%)',
  },
  Transfinite: {
    color: '#00F5D4',
    bgGradient: 'radial-gradient(circle at 28% 24%, #CCFBF1 0%, #2DD4BF 18%, #00F5D4 42%, #3B82F6 70%, #082F49 100%)',
  },
  Metacosmic: {
    color: '#B08968',
    bgGradient: 'radial-gradient(circle at 29% 22%, #FEF3C7 0%, #D6A77A 20%, #B08968 42%, #A78BFA 70%, #422006 100%)',
  },
  Primordial: {
    color: '#00BFA6',
    bgGradient: 'radial-gradient(circle at 30% 22%, #FFF7D6 0%, #F59E0B 18%, #00BFA6 44%, #047857 70%, #052E2B 100%)',
  },
  Unfathomable: {
    color: '#BE123C',
    bgGradient: 'radial-gradient(circle at 28% 23%, #FDA4AF 0%, #BE123C 20%, #7C3AED 48%, #3B0764 72%, #1F0A1D 100%)',
  },
  Axiom: {
    color: '#F72585',
    bgGradient: 'radial-gradient(circle at 29% 22%, #FBCFE8 0%, #F72585 20%, #8B5CF6 48%, #312E81 74%, #190B35 100%)',
  },
  Omniscient: {
    color: '#577590',
    bgGradient: 'radial-gradient(circle at 30% 22%, #D4E6F1 0%, #577590 22%, #22D3EE 48%, #1D4ED8 72%, #10243A 100%)',
  },
  Omega: {
    color: '#FFFFFF',
    bgGradient: 'radial-gradient(circle at 30% 22%, #FFFFFF 0%, #E9D5FF 19%, #A78BFA 42%, #7C3AED 68%, #2E1065 100%)',
  },
  Hyperion: {
    color: '#FF6B6B',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FFD1D1, #FF6B6B 52%, #7F1D1D 100%)',
  },
  Ethereal: {
    color: '#00C2A8',
    bgGradient: 'radial-gradient(circle at 35% 30%, #B8FFF4, #00C2A8 52%, #064E3B 100%)',
  },
  Aetherion: {
    color: '#9B5DE5',
    bgGradient: 'radial-gradient(circle at 35% 30%, #E9D5FF, #9B5DE5 52%, #3B0764 100%)',
  },
  Nexus: {
    color: '#F15BB5',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FFD6EF, #F15BB5 52%, #831843 100%)',
  },
  Archetype: {
    color: '#FEE440',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FFF9B0, #FEE440 52%, #713F12 100%)',
  },
  Apotheosis: {
    color: '#00BBF9',
    bgGradient: 'radial-gradient(circle at 35% 30%, #C4F1FF, #00BBF9 52%, #0C4A6E 100%)',
  },
  Eschaton: {
    color: '#00F5A0',
    bgGradient: 'radial-gradient(circle at 35% 30%, #C8FFE8, #00F5A0 52%, #064E3B 100%)',
  },
  Omniform: {
    color: '#FF7F11',
    bgGradient: 'radial-gradient(circle at 35% 30%, #FFE0BD, #FF7F11 52%, #7C2D12 100%)',
  },
  Eternity: {
    color: '#B8F2E6',
    bgGradient: 'radial-gradient(circle at 35% 30%, #F0FFFB, #B8F2E6 52%, #134E4A 100%)',
  },
};

export function normalizeCoinAmount(value: unknown, fallback = 0): number {
  const safeFallback = Number.isFinite(fallback) && fallback >= 0
    ? Math.min(Number.MAX_VALUE, Math.floor(fallback))
    : 0;
  const numeric = Number(value);
  if (numeric === Number.POSITIVE_INFINITY) return Number.MAX_VALUE;
  if (!Number.isFinite(numeric) || numeric < 0) return safeFallback;
  return Math.min(Number.MAX_VALUE, Math.floor(numeric));
}

/** Add whole Coin amounts while saturating only at the largest finite JS Number. */
export function addCoinAmount(current: unknown, increment: unknown): number {
  const balance = normalizeCoinAmount(current);
  const gain = normalizeCoinAmount(increment);
  const sum = balance + gain;
  return Number.isFinite(sum) ? Math.min(Number.MAX_VALUE, sum) : Number.MAX_VALUE;
}

export function formatNumber(value: number): string {
  const raw = Number(value);
  const safe = Number.isNaN(raw) || raw < 0
    ? 0
    : raw === Number.POSITIVE_INFINITY
      ? Number.MAX_VALUE
      : raw;
  if (safe > 100_000_000) {
    const exponent = Math.floor(Math.log10(safe));
    const mantissa = safe / Math.pow(10, exponent);
    return `${mantissa.toFixed(2)}e${exponent}`;
  }
  return safe.toLocaleString('en-US');
}

export function formatRarity(rarity: number, isInfinity = false): string {
  const raw = Number(rarity);
  // Infinity is an overflow result represented by a separate marker. The
  // largest finite Number remains a finite rarity and must never be called Infinity.
  if (isInfinity || raw === Number.POSITIVE_INFINITY) return 'Infinity';
  const safe = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  if (safe >= 100_000_000) {
    const exponent = Math.floor(Math.log10(safe));
    const mantissa = safe / Math.pow(10, exponent);
    // Keep values immediately below the cap from rounding up to "1.80e308",
    // which would visually imply a value beyond the finite Number ceiling.
    const mantissaText = exponent >= 300
      ? mantissa.toFixed(6)
      : mantissa.toFixed(2);
    return `${mantissaText}e${exponent}`;
  }
  return safe.toLocaleString('en-US');
}

function rarityRangeLabel(minRarity: number, maxRarity: number): string {
  return `1 / ${formatRarity(minRarity)} - 1 / ${formatRarity(maxRarity)}`;
}

function orbNameIndex(rarityValue: number, nameCount: number): number {
  const rarity = Number.isFinite(rarityValue) ? Math.max(0, rarityValue) : 2;
  if (rarity <= Number.MAX_SAFE_INTEGER) return Math.floor(rarity) % nameCount;
  // Above 2^53, integer remainders collapse for many representable values.
  // Hash scientific notation so the expanded names remain usable at finite extremes.
  const encoded = rarity.toExponential(15);
  let hash = 0x811c9dc5;
  for (let index = 0; index < encoded.length; index += 1) {
    hash ^= encoded.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % nameCount;
}

export function getOrbInfo(rarity: number, isInfinity = false): RarityTierInfo {
  if (isInfinity) {
    const { color, bgGradient } = { color: '#ffffff', bgGradient: 'radial-gradient(circle at 35% 30%, #ffffff, #c084fc 25%, #22d3ee 55%, #020617 100%)' };
    return { rarity, name: 'Infinity Orb', tier: 'Infinity', approxChance: '1 / Infinity', color, bgGradient, animated: false };
  }
  const tier = getOrbTier(rarity);
  const names = ORB_TIER_NAMES[tier];
  const name = names[orbNameIndex(rarity, names.length)];
  const { color, bgGradient } = TIER_COLORS[tier];

  return {
    rarity,
    name,
    tier,
    approxChance: `1 / ${formatRarity(rarity)}`,
    color,
    bgGradient,
    animated: rarity >= 1e38,
  };
}

/**
 * Continuous Rarity Distribution (Continuum RNG)
 *
 * At Level 1 and 1× Luck, the tail follows the displayed "1 / R" model:
 * P(Rarity >= R) ≈ 1 / R.
 *
 * Player level scales the rarity distribution linearly. Total Luck contributes a
 * separate diminishing-return factor, so high levels always matter predictably
 * without also smuggling level into the Luck multiplier.
 */
export function luckRarityFactor(luck: number): number {
  const rawLuck = Number(luck);
  const effectiveLuck = Number.isFinite(rawLuck) ? Math.max(1, rawLuck) : 1;
  // Square-root scaling keeps Luck on a diminishing-return curve without an
  // arbitrary ceiling. Even extreme values such as 1e21 Luck remain meaningful.
  return Math.sqrt(effectiveLuck);
}

// Compatibility helper for the continuum's unchanged 1/R distribution tail.
// Luck scaling is applied independently by luckRarityFactor above.
export function luckRarityExponent(_luck: number): number {
  return 1;
}

// JavaScript's largest finite Number is the current rarity ceiling. Attempted
// overflow is clamped here and displayed to players as Infinity.
export const MAX_ORB_RARITY = Number.MAX_VALUE;

export function rollContinuum(
  luck: number,
  random: () => number = Math.random,
  rarityMultiplier = 1,
  minimumRarity = 2,
  level = 1,
): number {
  const sample = Number(random());
  const u = Number.isFinite(sample)
    ? Math.min(1 - Number.EPSILON, Math.max(Number.MIN_VALUE, sample))
    : 0.5;
  // Apply all rarity multipliers to the continuous sample before flooring it.
  // Flooring first and multiplying later collapses many distinct RNG samples
  // onto the same sparse set of high-rarity values for heavily boosted players.
  const requestedMultiplier = Number(rarityMultiplier);
  const safeMultiplier = Number.isNaN(requestedMultiplier) || requestedMultiplier <= 0
    ? 1
    : requestedMultiplier;
  const requestedLevel = Number(level);
  const safeLevel = Number.isFinite(requestedLevel) ? Math.max(1, Math.floor(requestedLevel)) : 1;
  const rawRarity = (1 / u) * safeLevel * luckRarityFactor(luck) * safeMultiplier;
  // Values beyond Number.MAX_VALUE cannot be stored as finite rarity values.
  // Return Infinity as a transient sentinel; callers persist MAX_ORB_RARITY
  // and set Orb.isInfinity instead of serializing a non-finite number.
  if (!Number.isFinite(rawRarity) || rawRarity > MAX_ORB_RARITY) return Number.POSITIVE_INFINITY;
  const requestedFloor = Number(minimumRarity);
  const safeFloor = Number.isNaN(requestedFloor) ? 2 : Math.max(2, Math.floor(requestedFloor));
  if (!Number.isFinite(safeFloor)) return Number.POSITIVE_INFINITY;
  return Math.max(safeFloor, Math.min(MAX_ORB_RARITY, Math.floor(rawRarity)));
}

export interface ContinuumTierMilestone {
  tier: RarityTierName;
  minRarity: number;
  label: string;
  approxChance: string;
  coinsPerOrb: string;
  color: string;
}

export const CONTINUUM_TIERS: ContinuumTierMilestone[] = [
  { tier: 'Common', minRarity: 2, label: rarityRangeLabel(2, 9), approxChance: '~90.0%', coinsPerOrb: '2 - 9 Coins', color: TIER_COLORS.Common.color },
  { tier: 'Uncommon', minRarity: 10, label: rarityRangeLabel(10, 99), approxChance: '~9.0%', coinsPerOrb: '10 - 99 Coins', color: TIER_COLORS.Uncommon.color },
  { tier: 'Rare', minRarity: 100, label: rarityRangeLabel(100, 999), approxChance: '~0.9%', coinsPerOrb: '100 - 999 Coins', color: TIER_COLORS.Rare.color },
  { tier: 'Epic', minRarity: 1000, label: rarityRangeLabel(1000, 9999), approxChance: '~0.09%', coinsPerOrb: '1,000 - 9,999 Coins', color: TIER_COLORS.Epic.color },
  { tier: 'Legendary', minRarity: 10000, label: rarityRangeLabel(10000, 99999), approxChance: '~0.009%', coinsPerOrb: '10,000 - 99,999 Coins', color: TIER_COLORS.Legendary.color },
  { tier: 'Mythic', minRarity: 100000, label: rarityRangeLabel(100000, 999999), approxChance: '~0.0009%', coinsPerOrb: '100,000 - 999,999 Coins', color: TIER_COLORS.Mythic.color },
  { tier: 'Relic', minRarity: 1000000, label: rarityRangeLabel(1000000, 9999999), approxChance: '~0.00009%', coinsPerOrb: '1,000,000 - 9,999,999 Coins', color: TIER_COLORS.Relic.color },
  { tier: 'Divine', minRarity: 10000000, label: rarityRangeLabel(10000000, 99999999), approxChance: '~0.000009%', coinsPerOrb: '10,000,000 - 99,999,999 Coins', color: TIER_COLORS.Divine.color },
  { tier: 'Transcendent', minRarity: 100000000, label: rarityRangeLabel(100000000, 999999999), approxChance: '~0.0000009%', coinsPerOrb: `${formatNumber(100000000)} - ${formatNumber(999999999)} Coins`, color: TIER_COLORS.Transcendent.color },
  { tier: 'Ascendant', minRarity: 1000000000, label: rarityRangeLabel(1000000000, 9999999999), approxChance: '~0.00000009%', coinsPerOrb: `${formatNumber(1000000000)} - ${formatNumber(9999999999)} Coins`, color: TIER_COLORS.Ascendant.color },
  { tier: 'Eternal', minRarity: 10000000000, label: rarityRangeLabel(10000000000, 99999999999), approxChance: '~0.000000009%', coinsPerOrb: `${formatNumber(10000000000)} - ${formatNumber(99999999999)} Coins`, color: TIER_COLORS.Eternal.color },
  { tier: 'Celestial', minRarity: 100000000000, label: rarityRangeLabel(100000000000, 999999999999), approxChance: '~0.0000000009%', coinsPerOrb: `${formatNumber(100000000000)} - ${formatNumber(999999999999)} Coins`, color: TIER_COLORS.Celestial.color },
  { tier: 'Infinite', minRarity: 1000000000000, label: rarityRangeLabel(1000000000000, 9999999999999), approxChance: '~0.00000000009%', coinsPerOrb: `${formatNumber(1000000000000)} - ${formatNumber(9999999999999)} Coins`, color: TIER_COLORS.Infinite.color },
  { tier: 'Absolute', minRarity: 10000000000000, label: rarityRangeLabel(10000000000000, 99999999999999), approxChance: '~0.000000000009%', coinsPerOrb: `${formatNumber(10000000000000)} - ${formatNumber(99999999999999)} Coins`, color: TIER_COLORS.Absolute.color },
  { tier: 'Omniversal', minRarity: 100000000000000, label: `1 / ${formatRarity(100000000000000)}+`, approxChance: '~0.0000000000009%', coinsPerOrb: `${formatNumber(100000000000000)}+ Coins`, color: TIER_COLORS.Omniversal.color },
  { tier: 'Paradox', minRarity: 1000000000000000, label: rarityRangeLabel(1000000000000000, 9999999999999999), approxChance: '~0.00000000000009%', coinsPerOrb: `${formatNumber(1000000000000000)} - ${formatNumber(9999999999999999)} Coins`, color: TIER_COLORS.Paradox.color },
  { tier: 'Beyond', minRarity: 10000000000000000, label: rarityRangeLabel(10000000000000000, 99999999999999999), approxChance: '~0.000000000000009%', coinsPerOrb: `${formatNumber(10000000000000000)} - ${formatNumber(99999999999999999)} Coins`, color: TIER_COLORS.Beyond.color },
  { tier: 'Endless', minRarity: 100000000000000000, label: `1 / ${formatRarity(100000000000000000)}+`, approxChance: '~0.0000000000000009%', coinsPerOrb: `${formatNumber(100000000000000000)}+ Coins`, color: TIER_COLORS.Endless.color },
  { tier: 'Empyrean', minRarity: 1e19, label: `1 / ${formatRarity(1e19)}+`, approxChance: '~9.9e-18%', coinsPerOrb: `${formatNumber(1e19)}+ Coins`, color: TIER_COLORS.Empyrean.color },
  { tier: 'Hyperversal', minRarity: 1e21, label: `1 / ${formatRarity(1e21)}+`, approxChance: '~9.9e-20%', coinsPerOrb: `${formatNumber(1e21)}+ Coins`, color: TIER_COLORS.Hyperversal.color },
  { tier: 'Transfinite', minRarity: 1e23, label: `1 / ${formatRarity(1e23)}+`, approxChance: '~9.9e-22%', coinsPerOrb: `${formatNumber(1e23)}+ Coins`, color: TIER_COLORS.Transfinite.color },
  { tier: 'Metacosmic', minRarity: 1e25, label: `1 / ${formatRarity(1e25)}+`, approxChance: '~9.9e-24%', coinsPerOrb: `${formatNumber(1e25)}+ Coins`, color: TIER_COLORS.Metacosmic.color },
  { tier: 'Primordial', minRarity: 1e27, label: `1 / ${formatRarity(1e27)}+`, approxChance: '~9.9e-26%', coinsPerOrb: `${formatNumber(1e27)}+ Coins`, color: TIER_COLORS.Primordial.color },
  { tier: 'Unfathomable', minRarity: 1e29, label: `1 / ${formatRarity(1e29)}+`, approxChance: '~9.9e-28%', coinsPerOrb: `${formatNumber(1e29)}+ Coins`, color: TIER_COLORS.Unfathomable.color },
  { tier: 'Axiom', minRarity: 1e31, label: `1 / ${formatRarity(1e31)}+`, approxChance: '~9.9e-30%', coinsPerOrb: `${formatNumber(1e31)}+ Coins`, color: TIER_COLORS.Axiom.color },
  { tier: 'Omniscient', minRarity: 1e33, label: `1 / ${formatRarity(1e33)}+`, approxChance: '~9.9e-32%', coinsPerOrb: `${formatNumber(1e33)}+ Coins`, color: TIER_COLORS.Omniscient.color },
  { tier: 'Omega', minRarity: 1e35, label: `1 / ${formatRarity(1e35)}+`, approxChance: '~9.9e-34%', coinsPerOrb: `${formatNumber(1e35)}+ Coins`, color: TIER_COLORS.Omega.color },
  { tier: 'Hyperion', minRarity: 1e38, label: `1 / ${formatRarity(1e38)}+`, approxChance: '~9.9e-37%', coinsPerOrb: `${formatNumber(1e38)}+ Coins`, color: TIER_COLORS.Hyperion.color },
  { tier: 'Ethereal', minRarity: 1e41, label: `1 / ${formatRarity(1e41)}+`, approxChance: '~9.9e-40%', coinsPerOrb: `${formatNumber(1e41)}+ Coins`, color: TIER_COLORS.Ethereal.color },
  { tier: 'Aetherion', minRarity: 1e44, label: `1 / ${formatRarity(1e44)}+`, approxChance: '~9.9e-43%', coinsPerOrb: `${formatNumber(1e44)}+ Coins`, color: TIER_COLORS.Aetherion.color },
  { tier: 'Nexus', minRarity: 1e47, label: `1 / ${formatRarity(1e47)}+`, approxChance: '~9.9e-46%', coinsPerOrb: `${formatNumber(1e47)}+ Coins`, color: TIER_COLORS.Nexus.color },
  { tier: 'Archetype', minRarity: 1e50, label: `1 / ${formatRarity(1e50)}+`, approxChance: '~9.9e-49%', coinsPerOrb: `${formatNumber(1e50)}+ Coins`, color: TIER_COLORS.Archetype.color },
  { tier: 'Apotheosis', minRarity: 1e53, label: `1 / ${formatRarity(1e53)}+`, approxChance: '~9.9e-52%', coinsPerOrb: `${formatNumber(1e53)}+ Coins`, color: TIER_COLORS.Apotheosis.color },
  { tier: 'Eschaton', minRarity: 1e56, label: `1 / ${formatRarity(1e56)}+`, approxChance: '~9.9e-55%', coinsPerOrb: `${formatNumber(1e56)}+ Coins`, color: TIER_COLORS.Eschaton.color },
  { tier: 'Omniform', minRarity: 1e59, label: `1 / ${formatRarity(1e59)}+`, approxChance: '~9.9e-58%', coinsPerOrb: `${formatNumber(1e59)}+ Coins`, color: TIER_COLORS.Omniform.color },
  { tier: 'Eternity', minRarity: 1e62, label: `1 / ${formatRarity(1e62)}+`, approxChance: '~9.9e-61%', coinsPerOrb: `${formatNumber(1e62)}+ Coins`, color: TIER_COLORS.Eternity.color },
];

export const CONTINUUM_DISCOVERY_UNLOCK_RARITY = 1_000_000;
export const CONTINUUM_EXPANSION_UNLOCK_RARITY = 1e15;
export const CONTINUUM_INITIAL_TIER_COUNT = 9;
export const CONTINUUM_EXISTING_TIER_COUNT = 18;

export function visibleContinuumTiers(highestRarity: number): ContinuumTierMilestone[] {
  const rawHighest = Number(highestRarity);
  const safeHighest = Number.isFinite(rawHighest) ? Math.max(0, rawHighest) : 0;
  return CONTINUUM_TIERS.filter((tier, index) => {
    if (index < CONTINUUM_INITIAL_TIER_COUNT) return true;
    if (index < CONTINUUM_EXISTING_TIER_COUNT) {
      return safeHighest >= CONTINUUM_DISCOVERY_UNLOCK_RARITY;
    }
    return safeHighest >= CONTINUUM_EXPANSION_UNLOCK_RARITY;
  });
}

export interface CosmeticItem {
  id: string;
  name: string;
  desc: string;
  costCoins: number;
  costShards: number;
}

export const COSMETICS_LIST: CosmeticItem[] = [
  { id: 'default', name: 'Classic', desc: 'Default orb skin.', costCoins: 0, costShards: 0 },
  { id: 'galaxy', name: 'Galaxy', desc: 'Galaxy orb skin.', costCoins: 1000, costShards: 0 },
  { id: 'solar', name: 'Solar', desc: 'Solar orb skin.', costCoins: 5000, costShards: 5 },
  { id: 'cyber', name: 'Cyber', desc: 'Cyberpunk orb skin.', costCoins: 15000, costShards: 15 },
  { id: 'emerald', name: 'Emerald', desc: 'Emerald orb skin.', costCoins: 50000, costShards: 30 },
  { id: 'divine', name: 'Prismatic', desc: 'Prismatic orb skin.', costCoins: 250000, costShards: 100 },
];

export const COSMETICS = COSMETICS_LIST;

export interface PrestigeUpgradeInfo {
  name: string;
  desc: string;
  category: 'core' | 'qol' | 'alchemy';
  maxLevel: number;
  costPerLevel: number;
  qol?: boolean;
}

export const PRESTIGE_UPGRADES: Record<PrestigeUpgradeId, PrestigeUpgradeInfo> = {
  permLuck: {
    name: 'Permanent Luck',
    desc: 'Multiplies Luck by 1.05× per level.',
    category: 'core',
    maxLevel: 10,
    costPerLevel: 2,
  },
  permSpeed: {
    name: 'Permanent Speed Floor',
    desc: '-300ms cooldown floor per level.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 3,
  },
  unbrokenMomentum: {
    name: 'Unbroken Momentum',
    desc: 'Unlocks permanent Speed from your longest uninterrupted online rolling session. The logarithmic bonus reaches +20% at 48 hours, about +25% at 72 hours, and caps at +30%. Only completed five-minute blocks count.',
    category: 'core',
    maxLevel: 1,
    costPerLevel: 8,
  },
  vaultCap: {
    name: 'Vault Expansion',
    desc: '+250 offline roll capacity per level.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 1,
  },
  sonarPing: {
    name: 'Silent Alert Mode',
    desc: 'Mute normal rolls. Play audio alert on Rare+ orbs.',
    category: 'qol',
    maxLevel: 1,
    costPerLevel: 2,
    qol: true,
  },
  instantReveal: {
    name: 'Skip Animations',
    desc: 'Skip roll animation delays.',
    category: 'qol',
    maxLevel: 1,
    costPerLevel: 2,
    qol: true,
  },
  autoOverclock: {
    name: 'Auto-Roll Speed',
    desc: 'Auto-roll cooldown is 5% shorter per level.',
    category: 'qol',
    maxLevel: 5,
    costPerLevel: 2,
    qol: true,
  },
  autoFilter: {
    name: 'Common Salvage',
    desc: '+25% coins from Common and Uncommon rolls.',
    category: 'qol',
    maxLevel: 1,
    costPerLevel: 3,
    qol: true,
  },
  autoScrap: {
    name: 'Auto Scrap',
    desc: 'Unlocks configurable automatic combat-gear salvaging. Set a quality threshold in this upgrade; drops at or below it become Scrap instead of taking inventory space.',
    category: 'qol',
    maxLevel: 1,
    costPerLevel: 4,
    qol: true,
  },
  resonanceMeter: {
    name: 'Dry Streak Luck',
    desc: '+1% Luck per pity stack; stacks begin every 18 rolls and can accelerate with mastery.',
    category: 'qol',
    maxLevel: 3,
    costPerLevel: 3,
    qol: true,
  },
  stellarMagnet: {
    name: 'Multi-Roll Extra',
    desc: '10% chance per level to roll +2 extra orbs on multi-roll.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 3,
  },
  chronoOverdrive: {
    name: 'Turbo Duration',
    desc: 'Turbo lasts 60m with 30% cooldown reduction.',
    category: 'alchemy',
    maxLevel: 2,
    costPerLevel: 4,
    qol: true,
  },
  transmutation: {
    name: 'Transmutation',
    desc: '+15% Coins from low-rarity rolls and +0.025% Shard chance per level.',
    category: 'alchemy',
    maxLevel: 5,
    costPerLevel: 3,
  },
  shardSynthesis: {
    name: 'Dust Synthesis',
    desc: 'Convert 100 Shards into 1 Cosmic Dust.',
    category: 'alchemy',
    maxLevel: 1,
    costPerLevel: 4,
    qol: true,
  },
  astralBarrage: {
    name: 'Astral Barrage',
    desc: '+1 permanent extra orb rolled per activation per level.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 4,
  },
  cosmicInheritance: {
    name: 'Cosmic Inheritance',
    desc: 'Keep 10% more Coins through prestige per level. Shards are always preserved.',
    category: 'alchemy',
    maxLevel: 5,
    costPerLevel: 3,
    qol: true,
  },
  autoBuyer: {
    name: 'Celestial Auto-Buyer',
    desc: 'Buys the cheapest standard upgrade from spare Coins on a roll, keeping a 50-Coin reserve.',
    category: 'qol',
    maxLevel: 1,
    costPerLevel: 5,
    qol: true,
  },
  supernova: {
    name: 'Supernova Burst',
    desc: 'Critical rolls have a 10% chance per level to trigger a 5x Supernova multiplier.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 3,
  },
  altarResonator: {
    name: 'Altar Resonator',
    desc: '+15% greater luck multiplier from Altar sacrifices per level.',
    category: 'alchemy',
    maxLevel: 4,
    costPerLevel: 3,
  },
  offlineOverdrive: {
    name: 'Offline Overdrive',
    desc: 'Offline rolls generate 50% faster and grant 50% more Coins per level.',
    category: 'qol',
    maxLevel: 3,
    costPerLevel: 3,
    qol: true,
  },
  luckyFloor: {
    name: 'Lucky Floor',
    desc: '+1 minimum orb rarity per level.',
    category: 'core',
    maxLevel: 10,
    costPerLevel: 3,
  },
  astralArsenal: {
    name: 'Astral Arsenal',
    desc: '+1 orb per activation per level.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 5,
  },
  deepVault: {
    name: 'Deep Vault',
    desc: '+250 offline roll capacity per level.',
    category: 'qol',
    maxLevel: 5,
    costPerLevel: 2,
    qol: true,
  },
  steadyHands: {
    name: 'Steady Hands',
    desc: '-100ms cooldown floor per level.',
    category: 'qol',
    maxLevel: 5,
    costPerLevel: 3,
    qol: true,
  },
  frenzyVolley: {
    name: 'Frenzy Volley',
    desc: '+20% Orb Frenzy rolls after the full Multiball multiplier is applied.',
    category: 'core',
    maxLevel: 1,
    costPerLevel: 25,
    qol: true,
  },
  offlineFortune: {
    name: 'Offline Fortune',
    desc: '+25% offline Coins per level.',
    category: 'qol',
    maxLevel: 4,
    costPerLevel: 3,
    qol: true,
  },
  astralReserve: {
    name: 'Astral Reserve',
    desc: '+2% Luck per level.',
    category: 'core',
    maxLevel: 10,
    costPerLevel: 4,
  },
  temporalCompression: {
    name: 'Temporal Compression',
    desc: '-75ms cooldown floor per level.',
    category: 'qol',
    maxLevel: 5,
    costPerLevel: 4,
    qol: true,
  },
  shardResonator: {
    name: 'Shard Resonator',
    desc: '+0.00625% bonus Shard chance per level (0.25% primary-proc cap per Orb).',
    category: 'alchemy',
    maxLevel: 8,
    costPerLevel: 4,
  },
  cosmicValuation: {
    name: 'Cosmic Valuation',
    desc: '+5% Collection Value from rolls per level.',
    category: 'alchemy',
    maxLevel: 5,
    costPerLevel: 5,
  },
  cosmicReserve: {
    name: 'Cosmic Reserve',
    desc: 'Each unspent Cosmic Dust adds +1% multiplicative Luck per level, up to +5% per Dust at Lv 5.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 5,
  },
};

/**
 * Quest objectives rise gently with the best Orb. Shards retain the small,
 * capped rarity bonus. Coin rewards are tied to current earning rate: Daily
 * quests together pay 30 minutes of Coins; Weekly quests together pay four
 * hours. The pool is split by the original reward weights, avoiding an
 * arbitrary 50% Coin-reward ceiling.
 */
export function questDifficultyMultiplier(highestRarity: unknown): number {
  const raw = Number(highestRarity);
  const rarity = Number.isFinite(raw) && raw > 0 ? raw : 2;
  const decadesAboveRare = Math.max(0, Math.log10(rarity / 100));
  return Math.min(1.20, 1 + decadesAboveRare * 0.025);
}

export function questShardRewardMultiplier(highestRarity: unknown): number {
  const raw = Number(highestRarity);
  const rarity = Number.isFinite(raw) && raw > 0 ? raw : 2;
  const decadesAboveRare = Math.max(0, Math.log10(rarity / 100));
  return Math.min(1.50, 1 + decadesAboveRare * 0.05);
}

/** Legacy name retained for callers that display the Shard rarity multiplier. */
export function questRewardMultiplier(highestRarity: unknown): number {
  return questShardRewardMultiplier(highestRarity);
}

/**
 * Estimate ordinary Coin income using the same best-Orb value, Multiball payout,
 * cooldown, and persistent Coin multipliers as a normal activation. This is a
 * reward-budget estimate, not a guarantee of future RNG results.
 */
export function estimateQuestCoinsPerMinute(s: PlayerState): number {
  const rarity = s.highestRarityIsInfinity === true
    ? MAX_ORB_RARITY
    : Math.max(2, Number(s.highestRarity) || 2);
  const multiRolls = rollsPerActivation(s);
  const activationCoins = coinsForRarity(rarity) * (1 + Math.max(0, multiRolls - 1) * 0.20);
  const levelBenefits = getLevelBenefits(Math.max(1, Math.floor(Number(s.level) || 1)));
  const goldenOrbitStacks = celestialAlignmentStackCount(s.alignmentActiveInstances, 'goldenOrbit');
  const expectedCriticalShare = Math.min(
    0.40,
    (s.upgrades.critChance ?? 0) * 0.03 +
      (s.masterySkills?.critMastery ?? 0) * 0.03 +
      (s.guildPerks?.critRank ?? 0) * 0.015,
  );
  const coinMultiplier =
    Math.pow(1.5, goldenOrbitStacks) *
    levelBenefits.coinsMultiplier *
    (1 + (s.upgrades.coinBonus ?? 0) * 0.15) *
    orbFingersMultiplier(s) *
    criticalDividendMultiplier(s, expectedCriticalShare) *
    (1 + (s.masterySkills?.prosperity ?? 0) * 0.12) *
    (1 + (s.guildPerks?.coinRank ?? 0) * 0.10) *
    (isPremiumBoosterActive(s, 'prosperity') ? 10 : 1);
  const rate = activationCoins * coinMultiplier * (60_000 / cooldownMs(s, false));
  return Number.isFinite(rate) && rate > 0 ? rate : Number.MAX_VALUE;
}

function scaledQuestTarget(base: number, multiplier: number): number {
  const scaled = base * multiplier;
  // Avoid turning exact integer thresholds (for example 100 × 1.1) into
  // the next whole number because of binary floating-point representation.
  const precisionGuard = Math.max(1, Math.abs(scaled)) * Number.EPSILON * 4;
  return Math.max(base, Math.ceil(scaled - precisionGuard));
}

function scaledQuestReward(base: number, multiplier: number): number {
  return Math.max(base, Math.round(base * multiplier));
}

function splitQuestCoinBudget(coinsPerMinute: number, minutes: number, weights: number[]): number[] {
  const rate = Number(coinsPerMinute);
  const rawBudget = (Number.isFinite(rate) && rate > 0 ? rate : 8) * minutes;
  const budget = Number.isFinite(rawBudget)
    ? Math.max(weights.length, Math.floor(rawBudget))
    : Number.MAX_VALUE;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  return weights.map((weight, index) => {
    const amount = index === weights.length - 1
      ? Math.max(1, budget - allocated)
      : Math.max(1, Math.floor(budget * (weight / totalWeight)));
    allocated = Math.min(Number.MAX_VALUE, allocated + amount);
    return amount;
  });
}

export function createInitialDailyQuests(highestRarity = 2, coinsPerMinute = 8): QuestItem[] {
  const difficulty = questDifficultyMultiplier(highestRarity);
  const shardReward = questShardRewardMultiplier(highestRarity);
  const coinRewards = splitQuestCoinBudget(coinsPerMinute, 30, [100, 500, 300, 200, 150]);
  const rareThreshold = scaledQuestTarget(100, difficulty);
  const rolls25 = scaledQuestTarget(25, difficulty);
  const rolls100 = scaledQuestTarget(100, difficulty);
  const uniqueTarget = scaledQuestTarget(3, difficulty);
  return [
    { id: 'daily-rolls-25', title: 'Roll 25 Times', desc: `Perform ${rolls25} rolls`, target: rolls25, progress: 0, rewardCoins: coinRewards[0], rewardXp: 50, claimed: false },
    { id: 'daily-rolls-100', title: 'Roll 100 Times', desc: `Perform ${rolls100} rolls`, target: rolls100, progress: 0, rewardCoins: coinRewards[1], rewardShards: scaledQuestReward(1, shardReward), rewardXp: 150, claimed: false },
    { id: 'daily-rare-100', title: 'Find Rare Orb', desc: `Obtain an orb with 1/${rareThreshold}+ rarity`, target: 1, minRarity: rareThreshold, progress: 0, rewardCoins: coinRewards[2], rewardXp: 100, claimed: false },
    { id: 'daily-unique-3', title: 'Unique Orbs', desc: `Obtain ${uniqueTarget} unique orbs today`, target: uniqueTarget, progress: 0, rewardCoins: coinRewards[3], rewardXp: 80, claimed: false },
    { id: 'daily-social', title: 'Guild Activity', desc: 'View guild or leaderboard', target: 1, progress: 0, rewardCoins: coinRewards[4], rewardXp: 50, claimed: false },
  ];
}

export function createInitialWeeklyQuests(highestRarity = 2, coinsPerMinute = 8): QuestItem[] {
  const difficulty = questDifficultyMultiplier(highestRarity);
  const shardReward = questShardRewardMultiplier(highestRarity);
  const coinRewards = splitQuestCoinBudget(coinsPerMinute, 240, [5_000, 3_000, 4_000, 1_500]);
  const rareThreshold = scaledQuestTarget(100, difficulty);
  const epicThreshold = scaledQuestTarget(1_000, difficulty);
  const weeklyRollTarget = scaledQuestTarget(1_000, difficulty);
  const collectionTarget = scaledQuestTarget(10_000, difficulty);
  return [
    { id: 'weekly-grind', title: 'Weekly Rolls', desc: `Perform ${weeklyRollTarget.toLocaleString()} rolls this week`, target: weeklyRollTarget, progress: 0, rewardCoins: coinRewards[0], rewardShards: scaledQuestReward(5, shardReward), rewardXp: 600, claimed: false },
    { id: 'weekly-epic', title: 'Find Epic Orb', desc: `Obtain an Epic orb (1/${epicThreshold.toLocaleString()}+)`, target: 1, minRarity: epicThreshold, progress: 0, rewardCoins: coinRewards[1], rewardShards: scaledQuestReward(3, shardReward), rewardXp: 400, claimed: false },
    { id: 'weekly-guild', title: 'Collection Value', desc: `Contribute ${collectionTarget.toLocaleString()} collection value`, target: collectionTarget, progress: 0, rewardCoins: coinRewards[2], rewardXp: 500, claimed: false },
    { id: 'weekly-share', title: 'Share Post', desc: `Share an orb to Reddit after discovering a Rare+ orb (1/${rareThreshold}+)`, target: 1, unlockRarity: rareThreshold, progress: 0, rewardCoins: coinRewards[3], rewardShards: scaledQuestReward(2, shardReward), rewardXp: 200, claimed: false, unlocked: false },
  ];
}

export function createInitialState(now = Date.now()): PlayerState {
  const today = new Date(now).toISOString().slice(0, 10);
  return {
    coins: 50,
    stateRevision: 0,
    saveGeneration: 0,
    autoRollEnabled: false,
    shards: 5,
    cosmicDust: 0,
    level: 1,
    xp: 0,
    levelXpFloor: 0,
    totalRolls: 0,
    manualRolls: 0,
    totalCrits: 0,
    lifetimeCoins: 50,
    lifetimeShards: 5,
    highestRarity: 0,
    highestRarityIsInfinity: false,
    collectionValue: 0,
    lifetimeCollectionValue: 0,
    collection: {},
    collectionStorageVersion: CODEX_STORAGE_VERSION,
    runeConstellationCharge: 0,
    runeTemporalMomentum: 0,
    chainPatcherNextRarity: 0,
    adminGuaranteedRollQueued: false,
    chainPatcherCooldownUntil: 0,
    lastRollAt: null,
    timeEnergy: 0,
    alignmentNextAt: 0,
    alignmentPendingAt: 0,
    alignmentPendingForced: false,
    alignmentActiveInstances: [],
    alignmentActiveChoice: null,
    alignmentActiveUntil: 0,
    lastSeenAt: now,
    offlineRolls: 0,
    claimedAchievements: [],
    upgrades: {
      speed: 0,
      multi: 0,
      clusterRoll: 0,
      auto: 0,
      luck: 0,
      coinBonus: 0,
      shardChance: 0,
      xpBonus: 0,
      critChance: 0,
      critPower: 0,
      offlineRate: 0,
      valueBonus: 0,
      offlineFoundry: 0,
      orbFingers: 0,
      criticalDividend: 0,
    },
    prestigeCount: 0,
    prestigeUpgrades: {
      permLuck: 0,
      permSpeed: 0,
      unbrokenMomentum: 0,
      vaultCap: 0,
      sonarPing: 0,
      instantReveal: 0,
      autoOverclock: 0,
      autoFilter: 0,
      resonanceMeter: 0,
      stellarMagnet: 0,
      chronoOverdrive: 0,
      transmutation: 0,
      shardSynthesis: 0,
      astralBarrage: 0,
      cosmicInheritance: 0,
      autoBuyer: 0,
      supernova: 0,
      altarResonator: 0,
      offlineOverdrive: 0,
      luckyFloor: 0,
      astralArsenal: 0,
      deepVault: 0,
      steadyHands: 0,
      offlineFortune: 0,
      frenzyVolley: 0,
      astralReserve: 0,
      temporalCompression: 0,
      shardResonator: 0,
      cosmicValuation: 0,
      cosmicReserve: 0,
      autoScrap: 0,
    },
    streak: { count: 0, lastClaimDate: '', longestStreak: 0 },
    dailyStreakCommunity: createInitialDailyStreakCommunity(now),
    dailyQuests: createInitialDailyQuests(),
    weeklyQuests: createInitialWeeklyQuests(),
    lastDailyReset: today,
    lastWeeklyReset: today,
    rollsSinceBest: 0,
    aftershockRecord: 0,
    rollingSessionStartedAt: 0,
    rollingSessionLastRollAt: 0,
    longestRollingSessionMs: 0,
    highestDryStreak: 0,
    freeRolls: 0,
    activeCosmetic: 'default',
    unlockedCosmetics: ['default'],
    turboRollUntil: 0,
    activeBoosters: {},
    automations: {},
    combatAutoScrap: { enabled:false, maxQuality:20 },
    onlinePlayers: 1,
    communityRewardClaimedAt: 0,
    freeShardsEarnedToday: 0,
    shardPityRolls: 0,
    lastFreeShardReset: today,
    purchasedShards: 0,
    purchasedShardLots: {},
    globalBoosterCredits: 0,
    globalBoosterCreditLots: {},
    globalBoosters: createInitialGlobalBoosters(now),
    guildCombo: createInitialGuildCombo(now),

    lastFrenzyDate: '',
    lastFrenzyAt: 0,
    lastFrenzyClaimDate: '',
    lastFrenzyClaimAt: 0,
    frenzyClaimsToday: 0,
    pendingFrenzyOfflineClaimCount: 0,
    pendingFrenzyOfflineShards: 0,
    communityRewardClaimedTier: 0,
    currentRunRolls: 0,
    questsCompleted: 0,
    guildContribution: 0,
    sacrifices: {
      coinsSacrificed: 0,
      shardsSacrificed: 0,
      altarLevel: 0,
      luckSurgeUntil: 0,
      altarPity: 0,
      altarInsuranceCredit: 0,
    },
    masteryPoints: 0,
    masterySkills: {
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
    },
    guildPerks: { luckRank: 0, speedRank: 0, vaultRank: 0 },
  };
}

// Level Progression and Milestones System
export const MAX_PLAYER_LEVEL = 10_000;
export const LEVEL_EXPANSION_START = 1_000;

export interface LevelMilestonePerk {
  level: number;
  name: string;
  desc: string;
  bonusBalls?: number;
  bonusLuckMultiplier?: number;
  bonusCoinsMultiplier?: number;
  bonusXpMultiplier?: number;
  bonusShardChance?: number;
  bonusCooldownReductionMs?: number;
  bonusAltarEffectMultiplier?: number;
}

export const LEVEL_MILESTONES: LevelMilestonePerk[] = [
  { level: 5, name: 'Novice Seeker', desc: '+15% XP from rolls, quests, and community rewards', bonusXpMultiplier: 1.15 },
  { level: 10, name: 'Shard Sifter', desc: '+0.125 percentage points of Shard proc chance', bonusShardChance: 0.05 },
  { level: 15, name: 'Chrono Adept', desc: 'Cooldown floor reduced by 150ms', bonusCooldownReductionMs: 150 },
  { level: 20, name: 'Alchemical Affinity', desc: 'Altar Sacrifices are 15% more potent', bonusAltarEffectMultiplier: 1.15 },
  { level: 25, name: 'Twin Orb Conductor', desc: '+1 Extra Orb per activation!', bonusBalls: 1 },
  { level: 35, name: "Fortune's Blessing", desc: '+15% Luck!', bonusLuckMultiplier: 1.15 },
  { level: 50, name: 'Orb Titan', desc: '+1 Extra Orb per activation & 1.30× Coins!', bonusBalls: 1, bonusCoinsMultiplier: 1.30 },
  { level: 75, name: 'Astral Conduit', desc: '+20% Luck!', bonusLuckMultiplier: 1.20 },
  { level: 100, name: 'Transcendent Paragon', desc: '+2 Extra Orbs per activation & +30% Luck!', bonusBalls: 2, bonusLuckMultiplier: 1.30 },
  { level: 150, name: 'Grand Conductor', desc: '+2 Extra Orbs per activation & +20% XP!', bonusBalls: 2, bonusXpMultiplier: 1.20 },
  { level: 200, name: 'Void Fortune', desc: '+30% Luck!', bonusLuckMultiplier: 1.30 },
  { level: 300, name: 'Golden Age', desc: '1.50× Multiplicative Coin boost!', bonusCoinsMultiplier: 1.50 },
  { level: 400, name: 'Orb Battalion', desc: '+2 Extra Orbs per activation!', bonusBalls: 2 },
  { level: 500, name: 'Astral Zenith', desc: '+40% Luck and +0.25 percentage points of Shard proc chance', bonusLuckMultiplier: 1.40, bonusShardChance: 0.10 },
  { level: 750, name: 'Infinite Arsenal', desc: '+3 Extra Orbs per activation!', bonusBalls: 3 },
  { level: 1000, name: 'Infinity Master', desc: '+50% Luck and 2.00× Coins!', bonusLuckMultiplier: 1.50, bonusCoinsMultiplier: 2.00 },
  { level: 1250, name: 'Aether Cartographer', desc: 'Another +10% XP from all sources', bonusXpMultiplier: 1.10 },
  { level: 1500, name: 'Stellar Economy', desc: '+15% Coin earnings', bonusCoinsMultiplier: 1.15 },
  { level: 2000, name: 'Paragon of Fortune', desc: '+20% Luck', bonusLuckMultiplier: 1.20 },
  { level: 2500, name: 'Celestial Chorus', desc: '+1 Extra Orb per activation', bonusBalls: 1 },
  { level: 3000, name: 'Chrono Architect', desc: 'Cooldown floor reduced by another 100ms', bonusCooldownReductionMs: 100 },
  { level: 4000, name: 'Starlit Crucible', desc: 'Altar Sacrifices are 15% more potent', bonusAltarEffectMultiplier: 1.15 },
  { level: 5000, name: 'Infinite Conductor', desc: '+1 Extra Orb and +0.0625 percentage points of Shard proc chance', bonusBalls: 1, bonusShardChance: 0.025 },
  { level: 7500, name: 'Paragon Fortune', desc: '+25% Luck', bonusLuckMultiplier: 1.25 },
  { level: 10000, name: 'Infinity Ascendant', desc: '+2 Extra Orbs, +25% Coins and +15% XP', bonusBalls: 2, bonusCoinsMultiplier: 1.25, bonusXpMultiplier: 1.15 },
];

export function xpRequiredForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  if (safeLevel > LEVEL_EXPANSION_START) {
    // Preserve the original curve through Level 1,000. Beyond that, continue
    // from the exact Level 1,000 cost with a gentler power curve so the
    // expanded endgame remains challenging without the old linear multiplier
    // making each additional level disproportionately expensive.
    const legacyCapBase = Math.floor(70 * Math.pow(LEVEL_EXPANSION_START, 1.30));
    const legacyCapCost = Math.floor(
      legacyCapBase * (1 + (LEVEL_EXPANSION_START - 25) * 0.10),
    );
    return Math.floor(legacyCapCost * Math.pow(safeLevel / LEVEL_EXPANSION_START, 1.35));
  }

  const base = Math.floor(70 * Math.pow(safeLevel, 1.30));
  // The original curve is retained exactly through Level 1,000 for existing
  // accounts. Only the newly opened Paragon range uses the smoother extension.
  const lateGameMultiplier = safeLevel <= 25 ? 1 : 1 + (safeLevel - 25) * 0.10;
  return Math.floor(base * lateGameMultiplier);
}

export interface LevelBenefits {
  bonusBalls: number;
  luckMultiplier: number;
  coinsMultiplier: number;
  xpMultiplier: number;
  shardChance: number;
  cooldownReductionMs: number;
  altarEffectMultiplier: number;
}

export function getLevelBenefits(level: number): LevelBenefits {
  let bonusBalls = 0;
  let luckMultiplier = 1 + Math.max(0, level - 1) * 0.01;
  let coinsMultiplier = 1 + Math.max(0, level - 1) * 0.03;
  let xpMultiplier = 1;
  let shardChance = 0;
  let cooldownReductionMs = 0;
  let altarEffectMultiplier = 1;

  for (const milestone of LEVEL_MILESTONES) {
    if (level < milestone.level) continue;
    bonusBalls += milestone.bonusBalls ?? 0;
    luckMultiplier += Math.max(0, (milestone.bonusLuckMultiplier ?? 1) - 1);
    coinsMultiplier *= milestone.bonusCoinsMultiplier ?? 1;
    xpMultiplier *= milestone.bonusXpMultiplier ?? 1;
    shardChance += milestone.bonusShardChance ?? 0;
    cooldownReductionMs += milestone.bonusCooldownReductionMs ?? 0;
    altarEffectMultiplier *= milestone.bonusAltarEffectMultiplier ?? 1;
  }

  return {
    bonusBalls,
    luckMultiplier,
    coinsMultiplier,
    xpMultiplier,
    shardChance,
    cooldownReductionMs,
    altarEffectMultiplier,
  };
}

/** Apply the current level's cumulative XP bonus to quest and community rewards.
 * Roll XP uses its per-orb batch calculation, so it deliberately does not call this helper.
 */
export function levelAdjustedXpReward(level: number, baseXp: number): number {
  const numericXp = Number(baseXp);
  if (!Number.isFinite(numericXp) || numericXp <= 0) return 0;
  const safeXp = Math.floor(numericXp);
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(0, Math.round(safeXp * getLevelBenefits(level).xpMultiplier)),
  );
}

export function totalXpRequiredBeforeLevel(level: number): number {
  const safeLevel = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(Number(level) || 1)));
  let total = 0;
  for (let currentLevel = 1; currentLevel < safeLevel; currentLevel++) {
    total += xpRequiredForLevel(currentLevel);
  }
  return total;
}

export function getLevelProgress(
  level: number,
  totalXp: number,
  levelXpFloor?: number,
): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
} {
  const safeLevel = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(Number(level) || 1)));
  const safeXp = Math.max(0, Number(totalXp) || 0);
  const calculatedFloor = totalXpRequiredBeforeLevel(safeLevel);
  const floor = Number.isFinite(Number(levelXpFloor))
    ? Math.max(0, Math.min(safeXp, Number(levelXpFloor)))
    : calculatedFloor;
  const nextLevelXp = xpRequiredForLevel(safeLevel);
  const currentLevelXp = Math.max(0, safeXp - floor);
  return {
    level: safeLevel,
    currentLevelXp,
    nextLevelXp,
    progressPercent: Math.min(100, Math.round((currentLevelXp / nextLevelXp) * 100)),
  };
}

export function applyLevelProgress(s: PlayerState, maxLevelsPerCall = Number.MAX_SAFE_INTEGER): number {
  const MAX_LEVEL = MAX_PLAYER_LEVEL;
  const maxLevels = Math.max(0, Math.floor(Number(maxLevelsPerCall) || 0));
  if (maxLevels === 0) return 0;

  let level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(s.level) || 1)));
  const safeXp = Math.max(0, Number(s.xp) || 0);
  let floor = Number(s.levelXpFloor);
  if (!Number.isFinite(floor)) {
    const curveFloor = totalXpRequiredBeforeLevel(level);
    // A stored level that is ahead of the current XP curve is an account that
    // predates a balance change. Start that player at their existing XP rather
    // than requiring the retroactively raised cumulative threshold.
    floor = safeXp < curveFloor ? safeXp : curveFloor;
  }
  floor = Math.max(0, Math.min(safeXp, floor));

  let gained = 0;
  while (level < MAX_LEVEL && gained < maxLevels) {
    const required = xpRequiredForLevel(level);
    if (safeXp - floor < required) break;
    floor += required;
    level += 1;
    gained += 1;
  }

  s.level = level;
  s.levelXpFloor = floor;
  if (gained > 0) s.masteryPoints = (s.masteryPoints ?? 0) + gained;
  return gained;
}

export function calculateLevelFromXp(totalXp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
} {
  const safeXp = Math.max(0, Number(totalXp) || 0);
  const MAX_LEVEL = MAX_PLAYER_LEVEL;
  let lvl = 1;
  let accumulated = 0;

  while (lvl < MAX_LEVEL) {
    const req = xpRequiredForLevel(lvl);
    if (safeXp < accumulated + req) {
      const currentLevelXp = Math.max(0, safeXp - accumulated);
      const progressPercent = Math.min(100, Math.round((currentLevelXp / req) * 100));
      return { level: lvl, currentLevelXp, nextLevelXp: req, progressPercent };
    }
    accumulated += req;
    lvl++;
  }

  const finalReq = xpRequiredForLevel(MAX_LEVEL);
  return {
    level: MAX_LEVEL,
    currentLevelXp: Math.max(0, safeXp - accumulated),
    nextLevelXp: finalReq,
    progressPercent: 100,
  };
}

// Altar Luck is a multiplicative layer. Each altar component is calculated
// independently, then the components compound with one another and with other
// multiplicative Luck sources.
export function calculateAltarMultipliers(s: PlayerState): {
  coinMultiplier: number;
  shardMultiplier: number;
  surgeMultiplier: number;
  totalAltarMultiplier: number;
} {
  const sacrifices = s.sacrifices ?? { coinsSacrificed: 0, shardsSacrificed: 0, altarLevel: 0 };
  const resonatorBonus = 1 + (s.prestigeUpgrades?.altarResonator ?? 0) * 0.15;
  const altarEffectMultiplier = getLevelBenefits(Math.max(1, s.level || 1)).altarEffectMultiplier;

  // Altar rank compounds as ×1.05 per level. The Level 20 milestone and
  // Altar Resonator still strengthen the bonus above 1×; shard infusion remains
  // its own multiplicative layer.
  const rawCoinLevelMultiplier = Math.pow(1.05, Math.max(0, sacrifices.altarLevel));
  const coinBonus = (rawCoinLevelMultiplier - 1) * altarEffectMultiplier * resonatorBonus;
  const shardBonus = (sacrifices.shardsSacrificed || 0) * 0.02 * altarEffectMultiplier * resonatorBonus;

  const coinMultiplier = 1 + coinBonus;
  const shardMultiplier = 1 + shardBonus;
  const isSurgeActive = Boolean(sacrifices.luckSurgeUntil && Date.now() < sacrifices.luckSurgeUntil);
  const surgeMultiplier = isSurgeActive ? 1.25 : 1.0;

  // Altar components multiply rather than add: coin × shards × active Surge.
  // Keep full precision for gameplay math; the UI rounds its presentation only.
  const totalAltarMultiplier = coinMultiplier * shardMultiplier * surgeMultiplier;

  return {
    coinMultiplier,
    shardMultiplier,
    surgeMultiplier,
    totalAltarMultiplier,
  };
}

// Roll speed is deliberately a long-term investment: 20 levels, 150ms per level,
 // for a maximum 3.0s reduction from this run upgrade.
export const BASE_COOLDOWN_MS = 15_000;
export const AUTO_UNLOCK_COST = 0;
export const MAX_OFFLINE_ROLLS = 1_000;
export const OFFLINE_TICK_MS = 60_000; // 1 offline roll every 60 seconds

export const SHARD_SYNTHESIS_COST = 100;

// Unbroken Momentum ends a rolling session after a five-minute gap.
// Its permanent Speed reward scales logarithmically: 48 hours = 20%,
// 72 hours ≈ 25%, and the bonus never exceeds 30%.
export const UNBROKEN_MOMENTUM_SESSION_GAP_MS = 5 * 60_000;
/** @deprecated Retained for compatibility; the logarithmic curve no longer uses fixed steps. */
export const UNBROKEN_MOMENTUM_STEP_MS = 5 * 60_000;
/** @deprecated Retained for compatibility; the logarithmic curve no longer uses a per-step bonus. */
export const UNBROKEN_MOMENTUM_PER_STEP = 0.01;
export const UNBROKEN_MOMENTUM_MAX_BONUS = 0.30;

export function unbrokenMomentumSpeedBonus(longestSessionMs: number | null | undefined): number {
  const safeDuration = Number.isFinite(Number(longestSessionMs))
    ? Math.max(0, Math.floor(Number(longestSessionMs)))
    : 0;
  // Only completed five-minute blocks count toward the recorded session bonus.
  const completedDurationMs = Math.floor(safeDuration / UNBROKEN_MOMENTUM_STEP_MS) * UNBROKEN_MOMENTUM_STEP_MS;
  const hours = completedDurationMs / 3_600_000;
  if (hours <= 0) return 0;

  // Normalize the logarithmic curve so the requested 48h and 72h landmarks
  // map to 20% and approximately 25%, respectively.
  const normalized = Math.log1p(hours / 20) / Math.log1p(48 / 20);
  return Math.min(UNBROKEN_MOMENTUM_MAX_BONUS, Math.max(0, 0.20 * normalized));
}

/**
 * Aftershock permanently improves Critical Luck (the rarity multiplier of a
 * critical hit) based on the best dry interval between all-time rarity records.
 * Each order of magnitude in the personal record adds +0.005×, reaching +0.075×
 * at the largest safe-integer roll record. The record survives Prestige.
 */
export function aftershockCriticalLuckBonus(recordRolls: number | null | undefined): number {
  const safeRecord = Number.isFinite(Number(recordRolls))
    ? Math.max(0, Math.floor(Number(recordRolls)))
    : 0;
  if (safeRecord < 10) return 0;
  const decades = Math.floor(Math.log10(safeRecord));
  return Math.min(0.075, decades * 0.005);
}

/** Record one successfully processed online roll batch in the rolling session. */
export function recordRollingSessionActivity(s: PlayerState, now = Date.now()): void {
  if (!Number.isSafeInteger(now) || now < 0) return;

  const startedAt = Number(s.rollingSessionStartedAt);
  const lastRollAt = Number(s.rollingSessionLastRollAt);
  const continuing =
    Number.isSafeInteger(startedAt) && startedAt > 0 &&
    Number.isSafeInteger(lastRollAt) && lastRollAt > 0 &&
    now >= lastRollAt &&
    now - lastRollAt <= UNBROKEN_MOMENTUM_SESSION_GAP_MS &&
    startedAt <= lastRollAt;

  const sessionStartedAt = continuing ? startedAt : now;
  const sessionDuration = Math.max(0, now - sessionStartedAt);
  const previousBest = Number.isFinite(Number(s.longestRollingSessionMs))
    ? Math.max(0, Math.floor(Number(s.longestRollingSessionMs)))
    : 0;

  s.rollingSessionStartedAt = sessionStartedAt;
  s.rollingSessionLastRollAt = now;
  s.longestRollingSessionMs = Math.max(previousBest, sessionDuration);
}

export function effectiveOfflineTickMs(s: PlayerState): number {
  const rateReduction = Math.min(0.60, Math.min(8, Math.max(0, s.upgrades.offlineRate ?? 0)) * 0.08);
  const overdriveLevel = Math.max(0, Math.min(3, s.prestigeUpgrades?.offlineOverdrive ?? 0));
  const overdriveMultiplier = Math.pow(1.5, overdriveLevel);
  return Math.max(10_000, Math.round((OFFLINE_TICK_MS / overdriveMultiplier) * (1 - Math.min(0.6, rateReduction))));
}

export function critMultiplier(s: PlayerState): number {
  const masteryCritPower = (s.masterySkills?.critMastery ?? 0) * 0.30;
  return 2.0 +
    (s.upgrades.critPower ?? 0) * 0.25 +
    masteryCritPower +
    ((s.masterySkills?.aftershock ?? 0) > 0 ? aftershockCriticalLuckBonus(s.aftershockRecord) : 0) +
    globalBoosterCritLuckBonus(s.globalBoosters?.crit) +
    guildComboCritLuckBonus(s.guildCombo);
}

export function effectiveRollCritChance(s: PlayerState): number {
  return Math.min(
    0.40,
    (s.upgrades.critChance ?? 0) * 0.03 +
      (s.masterySkills?.critMastery ?? 0) * 0.03 +
      (s.guildPerks?.critRank ?? 0) * 0.015 +
      globalBoosterCritChanceBonus(s.globalBoosters?.crit) +
      guildComboCritChanceBonus(s.guildCombo),
  );
}

/**
 * The theoretical cooldown after every permanent and temporary Speed effect.
 * This value is intentionally allowed below 300ms so Cooldown Reclaimer can
 * recover the overflow. Only cooldownMs() applies the live activation floor.
 */
export function theoreticalCooldownMs(s: PlayerState, isAuto = false, liveBalance?: LiveBalanceConfig): number {
  const permReduction = (s.prestigeUpgrades?.permSpeed ?? 0) * 300;
  const guildSpeedReduction = (s.guildPerks?.speedRank ?? 0) * 100;
  const chronoFlowLevel = Math.max(0, Math.min(20, Math.floor(Number(s.masterySkills?.chronoFlow ?? 0) || 0)));
  const chronoFlowFloorReduction = chronoFlowLevel * 120;
  const steadyHandsReduction = (s.prestigeUpgrades?.steadyHands ?? 0) * 100;
  const temporalCompressionReduction = (s.prestigeUpgrades?.temporalCompression ?? 0) * 75;
  const levelBenefits = getLevelBenefits(Math.max(1, s.level || 1));
  const levelReduction = levelBenefits.cooldownReductionMs;

  // Roll speed: 20 levels × 150ms = 3.0s total maximum reduction.
  const speedLevel = Math.min(20, Math.max(0, s.upgrades.speed ?? 0));
  const coinReduction = speedLevel * (liveBalance?.['roll.speedPerLevelMs'] ?? 150);

  // Upgrades can remove the base floor entirely. No intermediate Speed layer
  // is clamped: all multipliers compound before the one final 300ms safety cap.
  const floor = Math.max(
    0,
    2000 -
      permReduction -
      guildSpeedReduction -
      chronoFlowFloorReduction -
      steadyHandsReduction -
      temporalCompressionReduction -
      levelReduction,
  );
  const directCooldownReduction =
    permReduction + steadyHandsReduction + temporalCompressionReduction;
  // An active Rift owns its own base cadence. Normal Speed/Prestige modifiers
  // still work on that cadence, but the player's main-save cooldown is never used.
  let cd = s.riftSession
    ? Math.max(500, s.riftSession.baseCooldownMs - coinReduction - directCooldownReduction - (s.riftSession.upgradeLevels.speed * 90))
    : Math.max(
        floor,
        BASE_COOLDOWN_MS - coinReduction - directCooldownReduction,
      );

  if (isAuto && (s.prestigeUpgrades?.autoOverclock ?? 0) > 0) {
    cd *= 1 - (s.prestigeUpgrades.autoOverclock * 0.05);
  }
  if (
    typeof s.turboRollUntil === 'number' &&
    Number.isSafeInteger(s.turboRollUntil) &&
    s.turboRollUntil > Date.now()
  ) {
    cd *= (s.prestigeUpgrades?.chronoOverdrive ?? 0) > 0 ? 0.65 : 0.75;
  }
  if (isPremiumBoosterActive(s, 'hyperdrive')) {
    cd *= 0.25;
  }
  if (s.globalBoosters?.speed) {
    cd *= globalBoosterSpeedMultiplier(s.globalBoosters.speed);
  }
  if (s.guildCombo) {
    cd *= guildComboSpeedMultiplier(s.guildCombo);
  }
  if (s.dailyStreakCommunity?.speedMultiplier) {
    cd *= s.dailyStreakCommunity.speedMultiplier;
  }

  const momentumSpeedMultiplier = 1 + ((s.prestigeUpgrades?.unbrokenMomentum ?? 0) > 0
    ? unbrokenMomentumSpeedBonus(s.longestRollingSessionMs)
    : 0);
  cd /= momentumSpeedMultiplier;
  if (isAuto) {
    const canonicalInstances = Array.isArray(s.alignmentActiveInstances)
      ? s.alignmentActiveInstances
      : normalizeCelestialAlignmentInstances(undefined, s.alignmentActiveChoice, s.alignmentActiveUntil);
    const clockworkStacks = celestialAlignmentStackCount(canonicalInstances, 'clockwork');
    if (clockworkStacks > 0) cd *= Math.pow(0.80, clockworkStacks);
  }
  if (isAuto) cd *= liveBalance?.['roll.autoCooldownMultiplier'] ?? 1;

  // Chrono Flow compounds with all other effects so endgame Speed investments
  // can create a genuine sub-300ms overflow.
  cd *= Math.pow(0.95, chronoFlowLevel);
  if (s.riftSession) {
    cd *= Math.max(0.65, 1 - s.riftSession.riftSpeedPerkLevel * 0.03);
    const timeDrag = Math.max(1, Math.min(20, Number(s.riftSession.temporalDragMultiplier) || 1));
    const compression = Math.min(0.80, Math.max(0, Number(s.riftSession.temporalCompressionLevel ?? 0)) * 0.04);
    cd *= 1 + (timeDrag - 1) * (1 - compression);
    if (s.riftSession.activeMutation?.id === 'temporal-collapse') {
      const amplifierLevel = Math.max(0, Math.min(10, Math.floor(Number(s.riftSession.mutationAmplifierLevel) || 0)));
      cd *= Math.max(0.35, 1 - 0.30 * (1 + amplifierLevel * 0.05));
    }
  }
  return Number.isFinite(cd) ? Math.max(s.riftSession ? 500 : 0, Math.round(cd)) : (s.riftSession ? 500 : 0);
}

export function cooldownMs(s: PlayerState, isAuto = false, liveBalance?: LiveBalanceConfig): number {
  const floor = Math.max(300, liveBalance?.['roll.minimumCooldownMs'] ?? 300);
  return Math.max(floor, theoreticalCooldownMs(s, isAuto, liveBalance));
}

/**
 * Earn 1% of the current live roll cooldown per Cooldown Reclaimer level
 * for each eligible completed activation. This works at the 300ms floor too.
 */
export function cooldownReclaimerEnergyPerActivationMs(s: PlayerState, isAuto = false, liveBalance?: LiveBalanceConfig): number {
  const level = Math.max(0, Math.min(10, Math.floor(Number(s.masterySkills?.cooldownReclaimer ?? 0) || 0)));
  if (level <= 0) return 0;

  const currentCooldownMs = cooldownMs(s, isAuto, liveBalance);
  return Math.min(TIME_ENERGY_MAX_MS, Math.floor(currentCooldownMs * level * 0.01));
}

/**
 * Add completed eligible activations to the player's Time Energy bank.
 * Callers pass the cooldown-derived amount captured before the reward batch,
 * so leveling or other roll side effects cannot change the rate mid-claim.
 */
export function grantCooldownReclaimerTimeEnergy(
  s: PlayerState,
  activations: number,
  energyPerActivationMs = cooldownReclaimerEnergyPerActivationMs(s),
): number {
  const safeActivations = Number.isSafeInteger(activations) && activations > 0 ? activations : 0;
  const safeEnergyPerActivation = Number.isSafeInteger(energyPerActivationMs) && energyPerActivationMs > 0
    ? Math.min(TIME_ENERGY_MAX_MS, energyPerActivationMs)
    : 0;
  const rawCurrent = Number(s.timeEnergy ?? 0);
  const currentEnergy = Number.isSafeInteger(rawCurrent) && rawCurrent >= 0
    ? Math.min(TIME_ENERGY_MAX_MS, rawCurrent)
    : 0;
  const earned = safeEnergyPerActivation * safeActivations;
  s.timeEnergy = Math.min(TIME_ENERGY_MAX_MS, currentEnergy + earned);
  return s.timeEnergy - currentEnergy;
}

// Multi roll upgrade is strictly LINEAR (+1 ball per level), plus multiple sources of +1 ball!
export function rollsPerActivation(s: PlayerState): number {
  let balls = 1;
  // 1. Standard Multi upgrade: linear +1 ball per level
  balls += (s.upgrades.multi ?? 0);
  // 2. Advanced Cluster Roll upgrade: +1 ball per level
  balls += (s.upgrades.clusterRoll ?? 0);
  // 3. Prestige Astral Barrage: +1 ball per level
  balls += (s.prestigeUpgrades?.astralBarrage ?? 0);
  // 4. Astral Mastery Celestial Volley: +1 ball per level
  balls += (s.masterySkills?.celestialVolley ?? 0);
  // 5. Level milestones and permanent prestige arsenal
  const lvl = Math.max(1, s.level || 1);
  balls += getLevelBenefits(lvl).bonusBalls;
  balls += (s.prestigeUpgrades?.astralArsenal ?? 0);
  if (isPremiumBoosterActive(s, 'barrage')) balls += 25;
  return Math.max(1, balls);
}

export function autoUnlocked(s: PlayerState): boolean {
  return (s.manualRolls ?? 0) >= 3;
}

// Luck sources contribute additively to one total Luck factor. The RNG then
// applies diminishing returns to that factor's effect on the rarity tail.
export interface CodexChain {
  start: number;
  end: number;
  length: number;
}

export function bestCodexChain(collection: Record<string, number> | null | undefined): CodexChain {
  const rarities = [...new Set(
    Object.entries(collection ?? {})
      .filter(([rarity, count]) => {
        const value = Number(rarity);
        return Number.isFinite(value) && value >= 2 && count > 0;
      })
      .map(([rarity]) => codexRarityBucket(Number(rarity)))
      .filter(Number.isFinite),
  )].sort((a, b) => a - b);
  if (rarities.length === 0) return { start: 0, end: 0, length: 0 };

  let bestStart = rarities[0]!;
  let bestEnd = rarities[0]!;
  let bestLength = 1;
  let currentStart = rarities[0]!;
  let currentLength = 1;
  for (let index = 1; index < rarities.length; index += 1) {
    const previous = rarities[index - 1]!;
    const current = rarities[index]!;
    if (nextCodexRarityBucket(previous) === current) currentLength += 1;
    else {
      currentStart = current;
      currentLength = 1;
    }
    if (currentLength > bestLength || (currentLength === bestLength && current > bestEnd)) {
      bestStart = currentStart;
      bestEnd = current;
      bestLength = currentLength;
    }
  }
  return { start: bestStart, end: bestEnd, length: bestLength };
}

export function highestCodexChain(collection: Record<string, number> | null | undefined): number {
  return bestCodexChain(collection).length;
}

/** One guaranteed Chain Patcher orb can be purchased every 24 hours. */
export const CHAIN_PATCHER_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

/**
 * Return the next upper-end rarity bucket after the player's longest Codex
 * chain. With an empty Codex, start at 1/2. Returns null when no bucket remains.
 */
export function nextCodexChainRarity(
  collection: Record<string, number> | null | undefined,
): number | null {
  const chain = bestCodexChain(collection);
  if (chain.length <= 0) return (collection?.['2'] ?? 0) > 0 ? null : 2;
  const next = nextCodexRarityBucket(chain.end);
  return next != null && next <= MAX_ORB_RARITY ? next : null;
}

/**
 * Shard cost scales in 100-rarity bands under the whole-number Shard economy.
 * A guaranteed 1/900 orb costs 100 Shards; global Booster costs remain flat by booster type.
 */
export function chainPatcherShardCost(targetRarity: number): number {
  if (
    !Number.isFinite(targetRarity) || !Number.isInteger(targetRarity) ||
    targetRarity < 2 ||
    targetRarity > MAX_ORB_RARITY
  ) {
    throw new Error('Chain Patcher target rarity is invalid.');
  }
  return Math.min(Number.MAX_SAFE_INTEGER, 10 * (Math.floor(targetRarity / 100) + 1));
}

export function codexDevotionLuckPercent(skillLevel: number, chain: number): number {
  const safeLevel = Math.max(0, Math.floor(Number(skillLevel) || 0));
  const safeChain = Math.max(0, Math.floor(Number(chain) || 0));
  if (safeLevel <= 0 || safeChain <= 0) return 0;

  // Each mastery level grants 0.3% Luck per number in the player's longest
  // consecutive Codex rarity chain.
  return Math.round(safeLevel * safeChain * 0.3 * 100) / 100;
}

export const MIN_ALTAR_COIN_OFFER = 10_000;
export const ALTAR_COIN_FLOOR_GROWTH = 1.5;
export const ALTAR_BASE_CHANCE_DECAY = 0.85;

export function altarCoinFloor(altarLevel: number): number {
  const safeLevel = Math.max(0, Math.floor(Number(altarLevel) || 0));
  const required = MIN_ALTAR_COIN_OFFER * Math.pow(ALTAR_COIN_FLOOR_GROWTH, safeLevel);
  return Number.isFinite(required)
    ? Math.min(Number.MAX_VALUE, Math.round(required))
    : Number.MAX_VALUE;
}

export function altarCoinDevotionChancePercent(
  coins: number,
  pity = 0,
  altarLevel = 0,
): number {
  const safeCoins = Math.max(0, Math.floor(Number(coins) || 0));
  const safePity = Math.max(0, Math.floor(Number(pity) || 0));
  const safeLevel = Math.max(0, Math.floor(Number(altarLevel) || 0));
  const floor = altarCoinFloor(safeLevel);
  if (safeCoins < floor) return 0;

  // Every breakthrough makes the next one harder: the minimum offering
  // grows by 1.5×, while the underlying odds fall by 15% per level. Larger
  // offerings can compensate somewhat, but never bypass the new floor.
  const amountRatio = safeCoins / floor;
  const levelChanceMultiplier = Math.pow(ALTAR_BASE_CHANCE_DECAY, safeLevel);
  const baseChance = Math.min(0.12, (0.05 + Math.log10(amountRatio) * 0.07) * levelChanceMultiplier);
  const pityMultiplier = Math.pow(1.35, safePity);

  return Math.round(Math.min(0.90, baseChance * pityMultiplier) * 10000) / 100;
}

export function luckMultiplier(s: PlayerState): number {
  // Most Luck sources add into the base factor. Prestige Permanent Luck and
  // Altar Luck are multiplicative layers, so long-term investment compounds
  // with the additive pool instead of merely joining it.
  let additiveBonus = 0;

  // 1. Run upgrade Luck
  additiveBonus += (s.upgrades.luck ?? 0) * 0.05;

  // 2. Level Luck, including milestone bonuses
  const safeLevel = Math.max(1, Math.floor(Number(s.level) || 1));
  const totalLevelLuck = getLevelBenefits(safeLevel).luckMultiplier;
  const linearLevelLuckBase = 1 + Math.max(0, safeLevel - 1) * 0.01;
  // The old +1% per-level base is now the direct linear rarity multiplier below.
  // Preserve explicit level-milestone Luck perks without counting the base twice.
  additiveBonus += Math.max(0, totalLevelLuck - linearLevelLuckBase);

  // 3. Astral Mastery Luck + Codex Devotion
  additiveBonus += (s.masterySkills?.continuumLuck ?? 0) * 0.03;
  const codexChain = highestCodexChain(s.collection);
  additiveBonus += codexDevotionLuckPercent(
    s.masterySkills?.celestialSurge ?? 0,
    codexChain,
  ) / 100;

  // 4. Guild Perk Luck
  additiveBonus += (s.guildPerks?.luckRank ?? 0) * 0.03;

  // 5. Dry-streak pity Luck
  if ((s.prestigeUpgrades?.resonanceMeter ?? 0) > 0) {
    const dryRolls = s.rollsSinceBest ?? 0;
    const interval = Math.max(6, 18 - (s.masterySkills?.pityAccelerant ?? 0) * 2);
    const stacks = Math.floor(dryRolls / interval);
    additiveBonus += (s.prestigeUpgrades.resonanceMeter * 0.01) * stacks;
  }

  // 6. Online population Luck
  additiveBonus += Math.max(0, onlinePlayerLuckMultiplier(s.onlinePlayers ?? 1) - 1);

  // 7. Temporary Luck boosters remain additive to the base pool.
  if (isPremiumBoosterActive(s, 'fortune')) additiveBonus += 3.0; // 4× becomes +300%.
  additiveBonus += Math.max(0, globalBoosterLuckMultiplier(s.globalBoosters?.luck) - 1);
  additiveBonus += Math.max(0, guildComboLuckMultiplier(s.guildCombo) - 1);
  additiveBonus += Math.max(0, (s.dailyStreakCommunity?.luckMultiplier ?? 1) - 1);

  additiveBonus += (s.prestigeUpgrades?.astralReserve ?? 0) * 0.02;

  // 8. Multiplicative long-term layers.
  // Permanent Luck is ×1.05 per level, rather than +5% into the additive pool.
  const prestigeMultiplier = Math.pow(1.05, Math.max(0, s.prestigeUpgrades?.permLuck ?? 0));
  const { totalAltarMultiplier } = calculateAltarMultipliers(s);
  const unspentCosmicDust = Math.max(0, Math.floor(Number(s.cosmicDust ?? 0) || 0));
  const cosmicReserveLevel = Math.max(0, Math.min(5, Math.floor(Number(s.prestigeUpgrades?.cosmicReserve ?? 0) || 0)));
  const cosmicReserveMultiplier = 1 + unspentCosmicDust * cosmicReserveLevel * 0.01;

  additiveBonus += constellationAtlasMilestonesUnlocked(
    s.masterySkills?.constellationAtlas ?? 0,
    s.collection,
  ) * 0.01;

  const baseLuck = 1 + additiveBonus;
  return Math.round(baseLuck * prestigeMultiplier * totalAltarMultiplier * cosmicReserveMultiplier * 100) / 100;
}

export function offlineRollCap(s: PlayerState): number {
  const permVaultBonus = (s.prestigeUpgrades?.vaultCap ?? 0) * 250;
  const guildVaultBonus = (s.guildPerks?.vaultRank ?? 0) * 100;
  const masteryVaultBonus = (s.masterySkills?.infiniteVault ?? 0) * 200;
  const deepVaultBonus = (s.prestigeUpgrades?.deepVault ?? 0) * 250;
  return Math.min(
    MAX_OFFLINE_ROLLS,
    Math.round((30 + (s.upgrades.auto ?? 0) * 20) * (1 + (s.upgrades.speed ?? 0) * 0.04)) +
      permVaultBonus +
      guildVaultBonus +
      masteryVaultBonus +
      deepVaultBonus
  );
}

/**
 * Paced coin progression formula.
 */
export const AUTO_BUYER_COIN_RESERVE = 50;

export function coinsForRarity(rarity: number): number {
  const safeRarity = Number(rarity);
  if (Number.isNaN(safeRarity) || safeRarity <= 1) return 1;
  if (safeRarity === Number.POSITIVE_INFINITY) return Number.MAX_VALUE;
  if (!Number.isFinite(safeRarity)) return 1;
  const value = Math.pow(safeRarity, 0.68);
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : Number.MAX_VALUE;
}

/**
 * Cookie Clicker-style cross-upgrade synergy. Investment in other standard
 * upgrades increases the Coin output of Orb Fingers, with logarithmic scaling.
 * Auto Roll is excluded because it is an unlock rather than a spendable level.
 */
export function orbFingersMultiplier(s: PlayerState): number {
  const level = Math.min(15, Math.max(0, Math.floor(Number(s.upgrades.orbFingers ?? 0) || 0)));
  if (level <= 0) return 1;
  const supportingLevels = Object.entries(s.upgrades ?? {}).reduce((total, [id, value]) => {
    if (id === 'orbFingers' || id === 'auto') return total;
    const numericLevel = Number(value);
    return total + (Number.isFinite(numericLevel) ? Math.max(0, Math.floor(numericLevel)) : 0);
  }, 0);
  return 1 + level * Math.log2(1 + supportingLevels) * 0.01;
}

/**
 * Converts the share of critical rolls into a Coin multiplier. The share is
 * measured from the authoritative simulated batch, not estimated from UI odds.
 */
export function criticalDividendMultiplier(s: PlayerState, criticalShare: number): number {
  const level = Math.min(20, Math.max(0, Math.floor(Number(s.upgrades.criticalDividend ?? 0) || 0)));
  const share = Number.isFinite(criticalShare) ? Math.max(0, Math.min(1, criticalShare)) : 0;
  return 1 + level * share * 0.025;
}

/** Offline-only Coin bonus. Never modifies live rolls or Frenzy payouts. */
export function offlineFoundryMultiplier(s: PlayerState): number {
  const level = Math.min(10, Math.max(0, Math.floor(Number(s.upgrades.offlineFoundry ?? 0) || 0)));
  return 1 + level * 0.10;
}

/**
 * Sustainable upgrade costs
 */
export function predictRollActivation(
  sourceState: PlayerState,
  seed: number,
  isAuto = false,
  communityLuckMultiplier = 1.15,
): RollPrediction {
  const s: PlayerState = {
    ...sourceState,
    upgrades: { ...sourceState.upgrades },
    prestigeUpgrades: { ...sourceState.prestigeUpgrades },
    masterySkills: { ...(sourceState.masterySkills ?? {}) } as Record<MasterySkillId, number>,
    collection: { ...(sourceState.collection ?? {}) },
    globalBoosters: sourceState.globalBoosters
      ? JSON.parse(JSON.stringify(sourceState.globalBoosters)) as GlobalBoosterSnapshot
      : sourceState.globalBoosters,
  };
  const predictionNow = Date.now();
  resetFreeShardBudgetIfNeeded(s, predictionNow);
  const rng = createSeededRandom(seed);
  const levelBenefits = getLevelBenefits(Math.max(1, s.level || 1));

  if (!isAuto && (s.freeRolls ?? 0) > 0) {
    s.freeRolls = Math.max(0, (s.freeRolls ?? 0) - 1);
  }
  const valueMul = 1 + (s.upgrades.valueBonus ?? 0) * 0.10;
  let rollCount = rollsPerActivation(s);

  const magnetLevel = s.prestigeUpgrades?.stellarMagnet ?? 0;
  if (rollCount > 1 && magnetLevel > 0 && rng() < 0.10 * magnetLevel) {
    rollCount += 2;
  }

  const baseLuck = luckMultiplier(s) + Math.max(0, communityLuckMultiplier - 1);
  const apexChance = Math.min(0.45, (s.masterySkills?.apexFortune ?? 0) * 0.03);
  const effectiveLuck = rollCount > 1 && rng() < apexChance ? baseLuck * 2 : baseLuck;
  const cm = critMultiplier(s);
  const critChance = effectiveRollCritChance(s);

  const rarities: number[] = [];
  const batch: Orb[] = [];
  let bestRarity = 0;
  let bestIsCrit = false;
  let bestIsNew = false;
  let bestIsInfinity = false;
  let totalValueGained = 0;
  let shardsGained = 0;
  let xpGained = 0;
  let uniqueGained = 0;
  let criticalRollsInBatch = 0;
  const lifetimeRollsBeforeBatch = s.totalRolls;

  for (let i = 0; i < rollCount; i++) {
    const isGuaranteedThirdBall = !s.riftSession && lifetimeRollsBeforeBatch + i === 2;
    const isCrit = !isGuaranteedThirdBall && rng() < critChance;
    let effectiveCm = cm;

    if (isCrit) {
      criticalRollsInBatch += 1;
      s.totalCrits = (s.totalCrits ?? 0) + 1;
      const supernovaLevel = s.prestigeUpgrades?.supernova ?? 0;
      if (supernovaLevel > 0 && rng() < supernovaLevel * 0.10) {
        effectiveCm = cm * 5;
      }
    }

    const minimumRarity = 2 + (s.prestigeUpgrades?.luckyFloor ?? 0);
    const beginnerRarity = 101 + Math.floor(rng() * 20);
    const rawRolledRarity = isGuaranteedThirdBall
      ? beginnerRarity
      : rollContinuum(
        effectiveLuck,
        rng,
        1,
        minimumRarity,
        Math.max(1, Math.floor(Number(s.level) || 1)),
      );
    const rawCritRarity = isCrit ? Math.round(rawRolledRarity * effectiveCm) : rawRolledRarity;
    const isInfinityOrb = !isGuaranteedThirdBall &&
      (rawRolledRarity === Number.POSITIVE_INFINITY || rawCritRarity === Number.POSITIVE_INFINITY ||
       !Number.isFinite(rawCritRarity) || rawCritRarity > MAX_ORB_RARITY);
    const rolledRarity = Math.max(minimumRarity, Math.min(MAX_ORB_RARITY,
      Number.isFinite(rawRolledRarity) ? rawRolledRarity : MAX_ORB_RARITY));
    const rarity = isCrit
      ? Math.min(MAX_ORB_RARITY, Number.isFinite(rawCritRarity) ? Math.round(rawCritRarity) : MAX_ORB_RARITY)
      : rolledRarity;

    const finalVal = Math.min(MAX_ORB_RARITY, Math.round(rarity * valueMul));
    const rarityKey = isInfinityOrb ? 'Infinity' : String(codexRarityBucket(rarity));
    const isNew = !s.collection[rarityKey];
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
    if (isNew) uniqueGained++;
    s.collection[rarityKey] = (s.collection[rarityKey] ?? 0) + 1;
    s.totalRolls++;
    s.currentRunRolls = (s.currentRunRolls ?? 0) + 1;
    s.collectionValue = addCollectionValue(s.collectionValue, finalVal);
    s.lifetimeCollectionValue = addCollectionValue(s.lifetimeCollectionValue, finalVal);
    if (rarity > s.highestRarity || (isInfinityOrb && !s.highestRarityIsInfinity)) {
      s.highestRarity = rarity;
      s.highestRarityIsInfinity = isInfinityOrb;
      s.rollsSinceBest = 0;
    } else {
      s.rollsSinceBest = (s.rollsSinceBest ?? 0) + 1;
      s.highestDryStreak = Math.max(s.highestDryStreak ?? 0, s.rollsSinceBest);
    }

    // High rarity no longer guarantees currency: an Orb can only pay on a Shard proc.
    let earnedShards = 0;

    const shardProcChance = Math.min(
      ROLL_SHARD_PROC_CHANCE_CAP,
      ((s.upgrades.shardChance ?? 0) * 0.0015 +
      (s.masterySkills?.shardAttunement ?? 0) * 0.001 +
      (s.guildPerks?.shardRank ?? 0) * 0.0005 +
      levelBenefits.shardChance) * 0.025,
    );
    const shardProcTriggered = rng() < shardProcChance;
    earnedShards += resolveShardPityReward(s, shardProcTriggered);

    shardsGained = roundShardAmount(shardsGained + earnedShards);
    const earnedXp = Math.round(
      Math.min(300, 12 + Math.floor(Math.log10(rarity + 1) * 12)) *
      (1 + (s.upgrades.xpBonus ?? 0) * 0.20) *
      levelBenefits.xpMultiplier,
    );
    xpGained += earnedXp;

    if (batch.length < 50) {
      const info = getOrbInfo(rarity, isInfinityOrb);
      batch.push({
        rarity,
        rolledAt: Date.now(),
        tier: info.tier,
        name: info.name,
        isInfinity: isInfinityOrb,
        isNew,
        isCrit,
      });
    }
    rarities.push(rarity);
    totalValueGained = Math.min(Number.MAX_VALUE, totalValueGained + finalVal);
  }

  rarities.sort((a, b) => b - a);
  const topCoins = Math.round(coinsForRarity(rarities[0] ?? 2));
  const extraCoins = rarities.slice(1).reduce(
    (sum, rarity) => addCoinAmount(sum, Math.max(1, Math.round(coinsForRarity(rarity) * 0.20))),
    0,
  );
  let coinsGained = normalizeCoinAmount(Math.round(
    addCoinAmount(topCoins, extraCoins) *
    levelBenefits.coinsMultiplier *
    (1 + (s.upgrades.coinBonus ?? 0) * 0.15) *
    orbFingersMultiplier(s) *
    criticalDividendMultiplier(s, criticalRollsInBatch / Math.max(1, rollCount)) *
    (1 + (s.masterySkills?.prosperity ?? 0) * 0.12) *
    (1 + (s.guildPerks?.coinRank ?? 0) * 0.10),
  ));

  const lowRarityCoins = rarities
    .filter(rarity => rarity < 100)
    .reduce((sum, rarity) => sum + Math.max(1, Math.round(coinsForRarity(rarity))), 0);

  if ((s.prestigeUpgrades?.autoFilter ?? 0) > 0 && lowRarityCoins > 0) {
    coinsGained = addCoinAmount(coinsGained, Math.round(lowRarityCoins * 0.25));
  }

  const transLevel = s.prestigeUpgrades?.transmutation ?? 0;
  if (transLevel > 0) {
    coinsGained = addCoinAmount(coinsGained, Math.round(lowRarityCoins * (transLevel * 0.15)));
    for (let i = 0; i < rollCount; i++) {
      if (rng() < 0.00025 * transLevel) shardsGained = roundShardAmount(shardsGained + 1);
    }
  }

  if (isPremiumBoosterActive(s, 'ascension')) {
    xpGained *= 10;
  }
  s.coins = addCoinAmount(s.coins, coinsGained);
  s.lifetimeCoins = addCoinAmount(s.lifetimeCoins ?? 0, coinsGained);
  // Match the authoritative uncapped whole-number wallet and overflow handling in predictions.
  shardsGained = grantRollShards(s, shardsGained, predictionNow);
  s.xp += xpGained;

  const oldLevel = Math.max(1, sourceState.level || 1);
  const earnedLevel = calculateLevelFromXp(s.xp).level;
  const newLevel = Math.max(oldLevel, Math.min(oldLevel + 1, earnedLevel));
  s.level = newLevel;
  if (newLevel > oldLevel) s.masteryPoints = (s.masteryPoints ?? 0) + 1;

  s.manualRolls = isAuto
    ? Math.min(10, s.manualRolls ?? 0)
    : Math.min(10, (s.manualRolls ?? 0) + 1);
  if (!isAuto && s.manualRolls >= 3) s.upgrades.auto = 1;
  s.lastRollAt = Date.now();
  s.lastSeenAt = Date.now();

  const bestInfo = getOrbInfo(bestRarity, bestIsInfinity);
  const bestOrb: Orb = {
    rarity: bestRarity,
    rolledAt: Date.now(),
    tier: bestInfo.tier,
    name: bestInfo.name,
    isInfinity: bestIsInfinity,
    isNew: bestIsNew,
    isCrit: bestIsCrit,
  };

  return {
    state: s,
    orb: bestOrb,
    batch,
    totalValueGained,
    coinsGained,
    shardsGained,
    xpGained,
    rollsProcessed: rollCount,
  };
}

export function upgradeCost(id: UpgradeId, level: number): number {
  if (id === 'auto') return level ? Infinity : 0;
  // Roll Speed has a deliberate cap: 20 levels, totaling at most 3 seconds.
  if (id === 'speed' && level >= 20) return Infinity;
  // The effective offline-rate benefit is capped at 60%, reached at level 8.
  if (id === 'offlineRate' && level >= 8) return Infinity;
  if (id === 'offlineFoundry' && level >= 10) return Infinity;
  if (id === 'orbFingers' && level >= 15) return Infinity;
  if (id === 'criticalDividend' && level >= 20) return Infinity;
  const configs: Record<Exclude<UpgradeId, 'auto'>, { base: number; mult: number }> = {
    speed: { base: 45, mult: 1.65 },
    multi: { base: 120, mult: 1.75 },
    clusterRoll: { base: 250, mult: 1.85 },
    luck: { base: 75, mult: 1.55 },
    coinBonus: { base: 50, mult: 1.45 },
    shardChance: { base: 150, mult: 1.60 },
    xpBonus: { base: 45, mult: 1.40 },
    critChance: { base: 100, mult: 1.72 },
    critPower: { base: 120, mult: 1.78 },
    offlineRate: { base: 90, mult: 1.50 },
    valueBonus: { base: 80, mult: 1.50 },
    offlineFoundry: { base: 1_200, mult: 1.75 },
    orbFingers: { base: 2_500, mult: 1.85 },
    criticalDividend: { base: 1_800, mult: 1.80 },
  };
  const { base, mult } = configs[id];
  // Unlimited repeatable upgrades have a modest price premium; capped speed upgrades keep their original curve.
  const repeatableCostPremium = id === 'speed' || id === 'offlineRate' ? 1 : 1.15;
  return Math.floor(base * Math.pow(mult, level) * repeatableCostPremium);
}

/**
 * Collection values share the game's full finite-number range. Saturate only
 * when IEEE-754 addition would overflow, never at the safe-integer boundary.
 */
export function addCollectionValue(current: unknown, increment: unknown): number {
  return addCoinAmount(current, increment);
}

/**
 * Prestige Dust has diminishing returns after the first two million-value steps.
 * The first Dust costs 1,000,000 Collection Value; the second costs another
 * 1,000,000. Each later Dust requires 5% more Collection Value than the prior
 * step, so the marginal requirement never drops below 1,000,000 and gains scale
 * logarithmically instead of granting one Dust per million forever.
 *
 * Examples: 1m => 1 Dust, 2m => 2 Dust, 3m => 3 Dust, 4m => 3 Dust,
 * 4.05m => 4 Dust, 300m => 58 Dust.
 */
export function calculatePrestigeDust(collectionValue: number): number {
  if (!Number.isFinite(collectionValue) || collectionValue < 1_000_000) return 0;

  const valueInMillions = collectionValue / 1_000_000;
  if (valueInMillions < 2) return 1;

  const additionalDust = Math.floor(
    Math.log1p(0.05 * (valueInMillions - 2)) / Math.log1p(0.05) + 1e-10,
  );
  return 2 + Math.max(0, additionalDust);
}

export function calculateCosmicDust(s: PlayerState): number {
  const currentVal = s.collectionValue ?? 0;
  if (currentVal < 1_000_000) return 0;
  const base = calculatePrestigeDust(currentVal);
  if (base <= 0) return 0;
  const masteryBonus = (s.masterySkills?.cosmicAttunement ?? 0) * 0.08;
  const existingDust = Number.isSafeInteger(s.cosmicDust) && s.cosmicDust >= 0
    ? s.cosmicDust
    : 0;
  const pending = Math.floor(base * (1 + masteryBonus));
  // Cosmic Dust has no gameplay wallet cap. Only preserve the safe-integer
  // boundary required by the Number-based player-save format.
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - existingDust, pending));
}

export function prestigeUpgradeCost(id: PrestigeUpgradeId, level: number): number {
  const bases: Record<PrestigeUpgradeId, number> = {
    permLuck: 2,
    permSpeed: 3,
    unbrokenMomentum: 8,
    vaultCap: 1,
    sonarPing: 2,
    instantReveal: 2,
    autoOverclock: 2,
    autoFilter: 3,
    resonanceMeter: 3,
    stellarMagnet: 3,
    chronoOverdrive: 4,
    transmutation: 3,
    shardSynthesis: 4,
    astralBarrage: 4,
    cosmicInheritance: 3,
    autoBuyer: 5,
    supernova: 3,
    altarResonator: 3,
    offlineOverdrive: 3,
    luckyFloor: 3,
    astralArsenal: 5,
    deepVault: 2,
    steadyHands: 3,
    offlineFortune: 3,
    frenzyVolley: 25,
    astralReserve: 4,
    temporalCompression: 4,
    shardResonator: 4,
    cosmicValuation: 5,
    cosmicReserve: 8,
    autoScrap: 4,
  };
  const base = bases[id] ?? 2;
  return Math.round(base * Math.pow(1.5, level));
}

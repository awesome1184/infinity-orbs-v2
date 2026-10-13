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
  | 'valueBonus';

export type MasterySkillId =
  | 'continuumLuck'
  | 'prosperity'
  | 'shardAttunement'
  | 'critMastery'
  | 'chronoFlow'
  | 'infiniteVault'
  | 'cosmicAttunement'
  | 'celestialSurge'
  | 'pityAccelerant'
  | 'apexFortune'
  | 'celestialVolley';

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
    desc: '+0.1% shard drop chance on rolls per level.',
    maxLevel: 25,
    costMultiplier: 2,
  },
  critMastery: {
    name: 'Critical Overdrive',
    desc: '+3% critical chance and +0.3x crit multiplier per level.',
    maxLevel: 25,
    costMultiplier: 2,
  },
  chronoFlow: {
    name: 'Chrono Flow',
    desc: '-120ms cooldown floor per level.',
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
    desc: '5% chance per level on multi-rolls to double the luck of that activation.',
    maxLevel: 15,
    costMultiplier: 3,
  },
  celestialVolley: {
    name: 'Celestial Volley',
    desc: '+1 additional orb rolled per activation per level.',
    maxLevel: 5,
    costMultiplier: 4,
  },
};

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
  fortune: { name: 'Fortune Surge', desc: 'Multiplies Luck by 4× while active. RNG still decides every roll.', costShards: 75, durationMs: 30 * 60 * 1000 },
  hyperdrive: { name: 'Hyperdrive', desc: 'Cuts roll cooldown to 25% of its normal value while active.', costShards: 75, durationMs: 30 * 60 * 1000 },
  barrage: { name: 'Orb Barrage', desc: 'Adds 25 extra orbs to every activation while active.', costShards: 100, durationMs: 30 * 60 * 1000 },
  prosperity: { name: 'Prosperity Field', desc: 'Multiplies Coin rewards by 10× while active.', costShards: 50, durationMs: 30 * 60 * 1000 },
  ascension: { name: 'Ascension', desc: 'Multiplies roll XP by 10× while active.', costShards: 75, durationMs: 30 * 60 * 1000 },
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
  autoQuestClaim: { name: 'Auto-Complete Quests', desc: 'Automatically claims completed daily and weekly quest rewards.', costShards: 750 },
  autoStreakClaim: { name: 'Auto-Claim Streak', desc: 'Automatically claims the daily streak reward when it becomes available.', costShards: 500 },
  autoCommunityClaim: { name: 'Auto-Claim Community Rewards', desc: 'Automatically claims each newly reached Community Reward tier.', costShards: 1_000 },
  autoOfflineClaim: { name: 'Auto-Claim Offline Rolls', desc: 'Automatically claims accumulated offline rolls when you return to the game.', costShards: 750 },
  autoUpgrade: { name: 'Auto-Complete Upgrades', desc: 'Automatically purchases one affordable standard upgrade whenever the game processes your state.', costShards: 1_500 },
};

export function normalizeAutomations(value: unknown): Partial<Record<AutomationId, boolean>> {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(
    (Object.keys(AUTOMATIONS) as AutomationId[]).map(id => [id, source[id] === true]),
  ) as Partial<Record<AutomationId, boolean>>;
}

export const FREE_SHARD_DAILY_CAP = 50;

export function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

// Week boundaries are Sunday 00:00 UTC. Using the Unix epoch directly would
// start the week on Thursday because 1970-01-01 was a Thursday.
export const WEEK_MS = 604_800_000;
export const WEEK_EPOCH_SUNDAY = Date.UTC(1970, 0, 4);

export function weekStartMs(now = Date.now()): number {
  const date = new Date(now);
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
  const resetMarker = s.lastFreeShardReset;
  if (resetMarker === today) return;

  // Only a valid earlier UTC day proves the daily budget should reset. Corrupt
  // or future markers fail closed for the rest of today instead of reopening it.
  const isValidDateKey =
    typeof resetMarker === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(resetMarker) &&
    Number.isFinite(Date.parse(`${resetMarker}T00:00:00.000Z`)) &&
    new Date(`${resetMarker}T00:00:00.000Z`).toISOString().slice(0, 10) === resetMarker;

  if (!isValidDateKey || resetMarker > today) {
    s.lastFreeShardReset = today;
    return;
  }

  s.lastFreeShardReset = today;
  s.freeShardsEarnedToday = 0;
}

function addShardsWithinSafeIntegerLimit(s: PlayerState, requested: number): number {
  const amount = Number.isFinite(requested)
    ? Math.max(0, Math.floor(requested))
    : 0;
  const currentShards = s.shards ?? 0;
  // The persisted-state parser already rejects invalid balances. Keep shared
  // helpers defensive too, without silently resetting a bad balance to zero.
  if (
    typeof currentShards !== 'number' ||
    !Number.isSafeInteger(currentShards) ||
    currentShards < 0
  ) {
    return 0;
  }

  const rawLifetimeShards = s.lifetimeShards;
  const lifetimeShards =
    typeof rawLifetimeShards === 'number' &&
    Number.isSafeInteger(rawLifetimeShards) &&
    rawLifetimeShards >= 0
      ? rawLifetimeShards
      : 0;
  s.lifetimeShards = lifetimeShards;

  // Lifetime totals are statistics, not spendable currency. Saturate the
  // statistic independently so a maxed lifetime counter never blocks new
  // Shards that still fit safely in the player's spendable balance.
  const safeRoom = Math.max(0, Number.MAX_SAFE_INTEGER - currentShards);
  const granted = Math.min(amount, safeRoom);
  s.shards = currentShards + granted;
  s.lifetimeShards = Math.min(Number.MAX_SAFE_INTEGER, lifetimeShards + granted);
  return granted;
}

export function grantFreeShards(s: PlayerState, requested: number, _now = Date.now()): number {
  // Free rewards intentionally bypass the rolling daily cap, not numeric safety.
  return addShardsWithinSafeIntegerLimit(s, requested);
}

export function grantRollShards(s: PlayerState, requested: number, now = Date.now()): number {
  resetFreeShardBudgetIfNeeded(s, now);
  const amount = Number.isFinite(requested)
    ? Math.max(0, Math.floor(requested))
    : 0;

  // Treat a genuinely missing legacy counter as a fresh day's zero, but never
  // let a malformed counter (e.g. a persisted string/NaN) bypass the daily cap.
  const rawEarnedToday = s.freeShardsEarnedToday;
  const earnedToday = rawEarnedToday == null
    ? 0
    : typeof rawEarnedToday === 'number' &&
        Number.isSafeInteger(rawEarnedToday) &&
        rawEarnedToday >= 0
      ? Math.min(FREE_SHARD_DAILY_CAP, rawEarnedToday)
      : FREE_SHARD_DAILY_CAP;
  s.freeShardsEarnedToday = earnedToday;

  const available = Math.max(0, FREE_SHARD_DAILY_CAP - earnedToday);
  const granted = addShardsWithinSafeIntegerLimit(s, Math.min(amount, available));
  s.freeShardsEarnedToday = earnedToday + granted;
  return granted;
}

export function spendShards(s: PlayerState, requested: number): number {
  if (!Number.isFinite(requested)) throw new Error('Invalid Shards amount.');
  const amount = Math.max(0, Math.floor(requested));
  if (!Number.isSafeInteger(amount)) throw new Error('Invalid Shards amount.');
  const shardBalance = Number.isSafeInteger(s.shards) && s.shards >= 0 ? s.shards : 0;
  if (shardBalance < amount) throw new Error('Not enough Shards.');
  if (amount <= 0) return 0;

  const purchasedBalance = Math.min(
    Number.isSafeInteger(s.purchasedShards) && (s.purchasedShards ?? 0) >= 0
      ? (s.purchasedShards ?? 0)
      : 0,
    shardBalance,
  );
  const freeBalance = Math.max(0, shardBalance - purchasedBalance);
  const purchasedToSpend = Math.max(0, amount - Math.min(amount, freeBalance));
  s.shards = shardBalance - amount;
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
  lastTickAt?: number;
}

export const GUILD_COMBO_BASE_DURATION_MS = 20 * 60 * 1000;
export const GUILD_COMBO_ACTIVATIONS_PER_TIER = 4;
export const GUILD_COMBO_MAX_TIER = 10;
export const GUILD_COMBO_DURATION_DECAY_PER_TIER = 0.85;
export const GUILD_COMBO_TIMER_ACCELERATION_PER_TIER = 0.25;


export const FRENZY_LOG_BASE = 1.05;
export const FRENZY_MIN_ORBS = 1;
export const FRENZY_OWNER_SHARD_REWARD = 5;
export const FRENZY_PROMPT_DELAY_MS = 3 * 60_000;
export const FRENZY_POST_COOLDOWN_MS = 23 * 60 * 60 * 1000;
export const FRENZY_CLAIM_COOLDOWN_MS = 23 * 60 * 60 * 1000;
export const FRENZY_POST_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const FRENZY_CLAIM_MAX_ORBS = 50_000_000;

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
  // Without Volley, every Multi Roll contributes one full share.
  // With Volley, the first share is full value and every additional
  // multiball contributes at 20% efficiency.
  const effectiveRolls = safeVolleyLevel > 0
    ? 1 + Math.max(0, safeMultiRolls - 1) * 0.20
    : safeMultiRolls;
  return Math.max(
    1,
    Math.min(
      FRENZY_CLAIM_MAX_ORBS,
      Math.floor(baseCount * effectiveRolls),
    ),
  );
}

export function grantFrenzyOwnerShards(
  s: PlayerState,
  requested = FRENZY_OWNER_SHARD_REWARD,
): number {
  // Frenzy owner rewards bypass the daily cap but share the wallet's numeric bounds.
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
  return { tier: 0, activationProgress: 0, endsAt: 0, lastTickAt: now };
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

  if (tier > 0 && endsAt > 0 && elapsed > 0) {
    endsAt -= Math.round(elapsed * tier * GUILD_COMBO_TIMER_ACCELERATION_PER_TIER);
  }

  if (tier <= 0 || endsAt <= now) {
    return { tier: 0, activationProgress: 0, endsAt: 0, lastTickAt: now };
  }

  return { tier, activationProgress, endsAt, lastTickAt: now };
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

  const endsAt = Math.max(now, current.endsAt) + guildComboDurationMs(tier, durationMultiplier);
  return { tier, activationProgress, endsAt, lastTickAt: now };
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
  const remaining = guildComboRemainingMs(state, now);
  if (remaining <= 0) return 0;
  return Math.round(Math.min(1, remaining / GUILD_COMBO_BASE_DURATION_MS) * 10000) / 100;
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
    costShards: 25,
  },
  speed: {
    name: 'Global Speed',
    desc: 'Reduces roll cooldown for everyone.',
    costShards: 25,
  },
  crit: {
    name: 'Global Crit Luck',
    desc: 'Improves Crit Chance and Crit Luck for everyone.',
    costShards: 25,
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
  | 'prestige';

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
  | 'vaultCap'
  | 'dustBounty'
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
  | 'singularityTithe'
  | 'luckyFloor'
  | 'astralArsenal'
  | 'deepVault'
  | 'masteryEngine'
  | 'steadyHands'
  | 'offlineFortune'
  | 'frenzyVolley'
  | 'astralReserve'
  | 'temporalCompression'
  | 'shardResonator'
  | 'cosmicValuation'
  | 'cosmicReserve';

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
  rarity: number;
  rolledAt: number;
  tier: string;
  name: string;
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
  claimed: boolean;
}

export interface PlayerStreak {
  count: number;
  lastClaimDate: string; // YYYY-MM-DD
  longestStreak: number;
}

export interface PlayerState {
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
  collectionValue: number;
  lifetimeCollectionValue: number;
  collection: Record<string, number>;
  collectionCount?: number;
  codexChain?: number;
  codexDevotionLuckPercent?: number;
  lastRollAt: number | null;
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
  highestDryStreak?: number;
  freeRolls?: number;
  activeCosmetic: string;
  unlockedCosmetics: string[];
  turboRollUntil: number; // timestamp
  activeBoosters?: Partial<Record<PremiumBoosterId, number>>;
  automations?: Partial<Record<AutomationId, boolean>>;
  onlinePlayers?: number;
  communityRewardClaimedAt?: number;
  freeShardsEarnedToday?: number;
  lastFreeShardReset?: string;
  purchasedShards?: number;
  /** Remaining purchased Shards by payment order. Legacy saves migrate into the "legacy" lot. */
  purchasedShardLots?: Record<string, number>;
  globalBoosterCredits?: number;
  /** Remaining purchased Global Booster credits by payment order; non-purchased grants have no lot. */
  globalBoosterCreditLots?: Record<string, number>;
  globalBoosters?: GlobalBoosterSnapshot;
  guildCombo?: GuildComboState;

  // Lifetime roll counter used by Singularity Tithe. It counts processed orbs,
  // including multi-roll and offline batches, once Tithe is active.
  singularityTitheSingleRolls?: number;

  lastFrenzyDate?: string;
  lastFrenzyAt?: number;
  lastFrenzyClaimDate?: string;
  lastFrenzyClaimAt?: number;
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
  | 'Endless';

export interface RarityTierInfo {
  rarity: number;
  name: string;
  tier: RarityTierName;
  approxChance: string;
  color: string;
  bgGradient: string;
}

export function getOrbTier(rarity: number): RarityTierName {
  if (rarity >= 100_000_000_000_000_000) return 'Endless';
  if (rarity >= 10_000_000_000_000_000) return 'Beyond';
  if (rarity >= 1_000_000_000_000_000) return 'Paradox';
  if (rarity >= 100_000_000_000_000) return 'Omniversal';
  if (rarity >= 10_000_000_000_000) return 'Absolute';
  if (rarity >= 1_000_000_000_000) return 'Infinite';
  if (rarity >= 100_000_000_000) return 'Celestial';
  if (rarity >= 10_000_000_000) return 'Eternal';
  if (rarity >= 1_000_000_000) return 'Ascendant';
  if (rarity >= 100_000_000) return 'Transcendent';
  if (rarity >= 10_000_000) return 'Divine';
  if (rarity >= 1_000_000) return 'Relic';
  if (rarity >= 100_000) return 'Mythic';
  if (rarity >= 10_000) return 'Legendary';
  if (rarity >= 1_000) return 'Epic';
  if (rarity >= 100) return 'Rare';
  if (rarity >= 10) return 'Uncommon';
  return 'Common';
}

const TIER_NAMES: Record<RarityTierName, string[]> = {
  Common: ['Spark Orb', 'Mist Orb', 'Pebble Orb', 'Ember Orb', 'Dew Orb', 'Echo Orb'],
  Uncommon: ['Tide Orb', 'Vapor Orb', 'Gale Orb', 'Frost Orb', 'Amethyst Orb', 'Verdant Orb'],
  Rare: ['Chrono Orb', 'Prism Orb', 'Thunder Orb', 'Aurora Orb', 'Plasma Orb', 'Quartz Orb'],
  Epic: ['Aether Orb', 'Solaris Orb', 'Eclipse Orb', 'Radiant Orb', 'Abyssal Orb', 'Inferno Orb'],
  Legendary: ['Nova Orb', 'Starlight Orb', 'Quasar Orb', 'Vortex Orb', 'Nebula Orb', 'Supernova Orb'],
  Mythic: ['Singularity Orb', 'Cosmic Core Orb', 'Hypernova Orb', 'Dark Star Orb', 'Astral Rift Orb'],
  Relic: ['Infinite Relic', 'Omega Fragment', 'Primordial Core', 'Eternal Horizon', 'Void Monolith'],
  Divine: ['Divine Eternity', 'Celestial Pantheon', 'Omnipresent Eye', 'Seraphic Sphere'],
  Transcendent: ['The Absolute Zero', 'Infinity Point', 'Cosmic Monolith', 'Genesis Void'],
  Ascendant: ['Redshift Orb', 'Pulsar Orb', 'Neutron Orb', 'Quasar Prime'],
  Eternal: ['Eventide Orb', 'Worldline Orb', 'Stellar Crown', 'Eternal Core'],
  Celestial: ['Heavenfall Orb', 'Solar Flare Orb', 'Astral Crown', 'Celestial Engine'],
  Infinite: ['Infinite Horizon', 'Endless Core', 'Void Singularity', 'Infinity Seed'],
  Absolute: ['Absolute Orb', 'First Principle', 'Origin Point', 'Final Horizon'],
  Omniversal: ['Omniversal Eye', 'Totality Core', 'Everything Orb', 'The Last Constant'],
  Paradox: ['Paradox Orb', 'Contradiction Core', 'Broken Loop', 'Null Point'],
  Beyond: ['Beyond Orb', 'Outer Core', 'Far Point', 'Unknown Edge'],
  Endless: ['Endless Orb', 'Final Loop', 'Last Horizon', 'Zero Point'],
};

const TIER_COLORS: Record<RarityTierName, { color: string; bgGradient: string }> = {
  Common: {
    color: '#94a3b8',
    bgGradient: 'radial-gradient(circle at 35% 30%, #cbd5e1, #64748b 60%, #1e293b)',
  },
  Uncommon: {
    color: '#38bdf8',
    bgGradient: 'radial-gradient(circle at 35% 30%, #7dd3fc, #0284c7 60%, #0c4a6e)',
  },
  Rare: {
    color: '#c084fc',
    bgGradient: 'radial-gradient(circle at 35% 30%, #d8b4fe, #9333ea 60%, #581c87)',
  },
  Epic: {
    color: '#fb923c',
    bgGradient: 'radial-gradient(circle at 35% 30%, #fed7aa, #ea580c 60%, #7c2d12)',
  },
  Legendary: {
    color: '#4ade80',
    bgGradient: 'radial-gradient(circle at 35% 30%, #86efac, #16a34a 60%, #14532d)',
  },
  Mythic: {
    color: '#a855f7',
    bgGradient: 'radial-gradient(circle at 35% 30%, #d8b4fe, #7e22ce 60%, #3b0764)',
  },
  Relic: {
    color: '#f59e0b',
    bgGradient: 'radial-gradient(circle at 35% 30%, #fde68a, #d97706 60%, #451a03)',
  },
  Divine: {
    color: '#38bdf8',
    bgGradient: 'radial-gradient(circle at 35% 30%, #e0f2fe, #0284c7 40%, #4f46e5 80%)',
  },
  Transcendent: {
    color: '#ffffff',
    bgGradient: 'radial-gradient(circle at 35% 30%, #ffffff, #a855f7 35%, #06b6d4 70%, #030712 100%)',
  },
  Ascendant: {
    color: '#fb7185',
    bgGradient: 'radial-gradient(circle at 35% 30%, #fecdd3, #e11d48 45%, #4c0519 100%)',
  },
  Eternal: {
    color: '#14b8a6',
    bgGradient: 'radial-gradient(circle at 35% 30%, #99f6e4, #0f766e 50%, #042f2e 100%)',
  },
  Celestial: {
    color: '#f97316',
    bgGradient: 'radial-gradient(circle at 35% 30%, #fed7aa, #ea580c 45%, #431407 100%)',
  },
  Infinite: {
    color: '#22d3ee',
    bgGradient: 'radial-gradient(circle at 35% 30%, #cffafe, #0891b2 45%, #082f49 100%)',
  },
  Absolute: {
    color: '#e879f9',
    bgGradient: 'radial-gradient(circle at 35% 30%, #fae8ff, #c026d3 45%, #4a044e 100%)',
  },
  Omniversal: {
    color: '#f8fafc',
    bgGradient: 'radial-gradient(circle at 35% 30%, #ffffff, #f0abfc 30%, #22d3ee 58%, #030712 100%)',
  },
  Paradox: {
    color: '#ef4444',
    bgGradient: 'radial-gradient(circle at 35% 30%, #fecaca, #dc2626 45%, #450a0a 100%)',
  },
  Beyond: {
    color: '#8b5cf6',
    bgGradient: 'radial-gradient(circle at 35% 30%, #ddd6fe, #7c3aed 45%, #2e1065 100%)',
  },
  Endless: {
    color: '#f1f5f9',
    bgGradient: 'radial-gradient(circle at 35% 30%, #ffffff, #64748b 35%, #0f172a 80%, #020617 100%)',
  },
};

export function formatNumber(value: number): string {
  const safe = Math.max(0, Number(value) || 0);
  if (safe > 100_000_000) {
    const exponent = Math.floor(Math.log10(safe));
    const mantissa = safe / Math.pow(10, exponent);
    return `${mantissa.toFixed(2)}e${exponent}`;
  }
  return safe.toLocaleString('en-US');
}

export function formatRarity(rarity: number): string {
  const safe = Math.max(0, Number(rarity) || 0);
  if (safe >= 100_000_000) {
    const exponent = Math.floor(Math.log10(safe));
    const mantissa = safe / Math.pow(10, exponent);
    return `${mantissa.toFixed(2)}e${exponent}`;
  }
  return safe.toLocaleString('en-US');
}

function rarityRangeLabel(minRarity: number, maxRarity: number): string {
  return `1 / ${formatRarity(minRarity)} - 1 / ${formatRarity(maxRarity)}`;
}

export function getOrbInfo(rarity: number): RarityTierInfo {
  const tier = getOrbTier(rarity);
  const names = TIER_NAMES[tier];
  const name = names[Math.abs(Math.floor(rarity)) % names.length];
  const { color, bgGradient } = TIER_COLORS[tier];

  return {
    rarity,
    name,
    tier,
    approxChance: `1 / ${formatRarity(rarity)}`,
    color,
    bgGradient,
  };
}

/**
 * Continuous Rarity Distribution (Continuum RNG)
 *
 * At 1× Luck, the tail matches the displayed "1 / R" rarity model:
 * P(Rarity >= R) ≈ 1 / R.
 *
 * Luck increases the tail weight through a diminishing-return shape exponent
 * instead of multiplying the rolled rarity directly. This keeps high Luck
 * valuable without turning ordinary rolls into giant outliers.
 */
// Luck is deliberately a gentle tail multiplier. At 1× Luck the distribution
// remains P(Rarity >= R) ≈ 1/R; higher Luck improves the scale slowly instead of
// changing the distribution's exponent and making extreme drops commonplace.
export function luckRarityFactor(luck: number): number {
  const rawLuck = Number(luck);
  const effectiveLuck = Number.isFinite(rawLuck) ? Math.max(1, rawLuck) : 1;
  // Luck should make rare results meaningfully better without turning the
  // upper tail into routine drops.  Every full order of magnitude of Luck
  // adds only 0.75× to the rarity scale, capped at 5×.
  return Math.min(5, 1 + Math.log10(effectiveLuck) * 0.75);
}

// Kept for compatibility with older callers. The continuum no longer changes its exponent.
export function luckRarityExponent(_luck: number): number {
  return 1;
}

export const MAX_ORB_RARITY = 1_000_000_000_000_000_000;

export function rollContinuum(luck: number, random: () => number = Math.random): number {
  const sample = Number(random());
  const u = Number.isFinite(sample)
    ? Math.min(1 - Number.EPSILON, Math.max(Number.MIN_VALUE, sample))
    : 0.5;
  const rarity = Math.floor((1 / u) * luckRarityFactor(luck));
  return Math.min(MAX_ORB_RARITY, Math.max(2, rarity));
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
  { tier: 'Common', minRarity: 2, label: rarityRangeLabel(2, 9), approxChance: '~90.0%', coinsPerOrb: '2 - 9 Coins', color: '#94a3b8' },
  { tier: 'Uncommon', minRarity: 10, label: rarityRangeLabel(10, 99), approxChance: '~9.0%', coinsPerOrb: '10 - 99 Coins', color: '#38bdf8' },
  { tier: 'Rare', minRarity: 100, label: rarityRangeLabel(100, 999), approxChance: '~0.9%', coinsPerOrb: '100 - 999 Coins', color: '#c084fc' },
  { tier: 'Epic', minRarity: 1000, label: rarityRangeLabel(1000, 9999), approxChance: '~0.09%', coinsPerOrb: '1,000 - 9,999 Coins', color: '#fb923c' },
  { tier: 'Legendary', minRarity: 10000, label: rarityRangeLabel(10000, 99999), approxChance: '~0.009%', coinsPerOrb: '10,000 - 99,999 Coins', color: '#4ade80' },
  { tier: 'Mythic', minRarity: 100000, label: rarityRangeLabel(100000, 999999), approxChance: '~0.0009%', coinsPerOrb: '100,000 - 999,999 Coins', color: '#a855f7' },
  { tier: 'Relic', minRarity: 1000000, label: rarityRangeLabel(1000000, 9999999), approxChance: '~0.00009%', coinsPerOrb: '1,000,000 - 9,999,999 Coins', color: '#f59e0b' },
  { tier: 'Divine', minRarity: 10000000, label: rarityRangeLabel(10000000, 99999999), approxChance: '~0.000009%', coinsPerOrb: '10,000,000 - 99,999,999 Coins', color: '#38bdf8' },
  { tier: 'Transcendent', minRarity: 100000000, label: rarityRangeLabel(100000000, 999999999), approxChance: '~0.0000009%', coinsPerOrb: `${formatNumber(100000000)} - ${formatNumber(999999999)} Coins`, color: '#ffffff' },
  { tier: 'Ascendant', minRarity: 1000000000, label: rarityRangeLabel(1000000000, 9999999999), approxChance: '~0.00000009%', coinsPerOrb: `${formatNumber(1000000000)} - ${formatNumber(9999999999)} Coins`, color: '#fb7185' },
  { tier: 'Eternal', minRarity: 10000000000, label: rarityRangeLabel(10000000000, 99999999999), approxChance: '~0.000000009%', coinsPerOrb: `${formatNumber(10000000000)} - ${formatNumber(99999999999)} Coins`, color: '#14b8a6' },
  { tier: 'Celestial', minRarity: 100000000000, label: rarityRangeLabel(100000000000, 999999999999), approxChance: '~0.0000000009%', coinsPerOrb: `${formatNumber(100000000000)} - ${formatNumber(999999999999)} Coins`, color: '#f97316' },
  { tier: 'Infinite', minRarity: 1000000000000, label: rarityRangeLabel(1000000000000, 9999999999999), approxChance: '~0.00000000009%', coinsPerOrb: `${formatNumber(1000000000000)} - ${formatNumber(9999999999999)} Coins`, color: '#22d3ee' },
  { tier: 'Absolute', minRarity: 10000000000000, label: rarityRangeLabel(10000000000000, 99999999999999), approxChance: '~0.000000000009%', coinsPerOrb: `${formatNumber(10000000000000)} - ${formatNumber(99999999999999)} Coins`, color: '#e879f9' },
  { tier: 'Omniversal', minRarity: 100000000000000, label: `1 / ${formatRarity(100000000000000)}+`, approxChance: '~0.0000000000009%', coinsPerOrb: `${formatNumber(100000000000000)}+ Coins`, color: '#f8fafc' },
  { tier: 'Paradox', minRarity: 1000000000000000, label: rarityRangeLabel(1000000000000000, 9999999999999999), approxChance: '~0.00000000000009%', coinsPerOrb: `${formatNumber(1000000000000000)} - ${formatNumber(9999999999999999)} Coins`, color: '#ef4444' },
  { tier: 'Beyond', minRarity: 10000000000000000, label: rarityRangeLabel(10000000000000000, 99999999999999999), approxChance: '~0.000000000000009%', coinsPerOrb: `${formatNumber(10000000000000000)} - ${formatNumber(99999999999999999)} Coins`, color: '#8b5cf6' },
  { tier: 'Endless', minRarity: 100000000000000000, label: `1 / ${formatRarity(100000000000000000)}+`, approxChance: '~0.0000000000000009%', coinsPerOrb: `${formatNumber(100000000000000000)}+ Coins`, color: '#f1f5f9' },
];

export const CONTINUUM_DISCOVERY_UNLOCK_RARITY = 9;

export function visibleContinuumTiers(highestRarity: number): ContinuumTierMilestone[] {
  return Number(highestRarity) >= CONTINUUM_DISCOVERY_UNLOCK_RARITY
    ? CONTINUUM_TIERS
    : CONTINUUM_TIERS.slice(0, 9);
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
  vaultCap: {
    name: 'Vault Expansion',
    desc: '+250 offline roll capacity per level.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 1,
  },
  dustBounty: {
    name: 'Cosmic Dust Bounty',
    desc: '+15% Cosmic Dust from prestige per level.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 5,
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
    desc: '+15% coins and 1% shard chance on low rarity rolls per level.',
    category: 'alchemy',
    maxLevel: 5,
    costPerLevel: 3,
  },
  shardSynthesis: {
    name: 'Dust Synthesis',
    desc: 'Convert 10 Shards into 1 Cosmic Dust.',
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
  singularityTithe: {
    name: 'Singularity Tithe',
    desc: 'Passively generate +1 Cosmic Dust every 200 rolls per level.',
    category: 'alchemy',
    maxLevel: 3,
    costPerLevel: 5,
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
  masteryEngine: {
    name: 'Mastery Engine',
    desc: 'Gain +1 Mastery Point every 100 rolls per level.',
    category: 'core',
    maxLevel: 5,
    costPerLevel: 4,
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
    desc: 'Very high-tier upgrade: every additional multiball counts at 20% efficiency during Orb Frenzy.',
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
    desc: '+0.25% bonus Shard chance per level.',
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

export function createInitialDailyQuests(): QuestItem[] {
  return [
    { id: 'daily-rolls-25', title: 'Roll 25 Times', desc: 'Perform 25 rolls', target: 25, progress: 0, rewardCoins: 100, rewardXp: 50, claimed: false },
    { id: 'daily-rolls-100', title: 'Roll 100 Times', desc: 'Perform 100 rolls', target: 100, progress: 0, rewardCoins: 500, rewardShards: 1, rewardXp: 150, claimed: false },
    { id: 'daily-rare-100', title: 'Find Rare Orb', desc: 'Obtain an orb with 1/100+ rarity', target: 1, progress: 0, rewardCoins: 300, rewardXp: 100, claimed: false },
    { id: 'daily-unique-3', title: 'Unique Orbs', desc: 'Obtain 3 unique orbs today', target: 3, progress: 0, rewardCoins: 200, rewardXp: 80, claimed: false },
    { id: 'daily-social', title: 'Guild Activity', desc: 'View guild or leaderboard', target: 1, progress: 0, rewardCoins: 150, rewardXp: 50, claimed: false },
  ];
}

export function createInitialWeeklyQuests(): QuestItem[] {
  return [
    { id: 'weekly-grind', title: 'Weekly Rolls', desc: 'Perform 1,000 rolls this week', target: 1000, progress: 0, rewardCoins: 5000, rewardShards: 5, rewardXp: 600, claimed: false },
    { id: 'weekly-epic', title: 'Find Epic Orb', desc: 'Obtain an Epic orb (1/1,000+)', target: 1, progress: 0, rewardCoins: 3000, rewardShards: 3, rewardXp: 400, claimed: false },
    { id: 'weekly-guild', title: 'Collection Value', desc: 'Contribute 10,000 collection value', target: 10000, progress: 0, rewardCoins: 4000, rewardXp: 500, claimed: false },
    { id: 'weekly-share', title: 'Share Post', desc: 'Share an orb to Reddit after discovering a Rare+ orb.', target: 1, progress: 0, rewardCoins: 1500, rewardShards: 2, rewardXp: 200, claimed: false, unlocked: false },
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
    collectionValue: 0,
    lifetimeCollectionValue: 0,
    collection: {},
    lastRollAt: null,
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
    },
    prestigeCount: 0,
    prestigeUpgrades: {
      permLuck: 0,
      permSpeed: 0,
      vaultCap: 0,
      dustBounty: 0,
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
      singularityTithe: 0,
      luckyFloor: 0,
      astralArsenal: 0,
      deepVault: 0,
      masteryEngine: 0,
      steadyHands: 0,
      offlineFortune: 0,
      frenzyVolley: 0,
      astralReserve: 0,
      temporalCompression: 0,
      shardResonator: 0,
      cosmicValuation: 0,
      cosmicReserve: 0,
    },
    streak: { count: 1, lastClaimDate: '', longestStreak: 1 },
    dailyStreakCommunity: createInitialDailyStreakCommunity(now),
    dailyQuests: createInitialDailyQuests(),
    weeklyQuests: createInitialWeeklyQuests(),
    lastDailyReset: today,
    lastWeeklyReset: today,
    rollsSinceBest: 0,
    highestDryStreak: 0,
    freeRolls: 0,
    activeCosmetic: 'default',
    unlockedCosmetics: ['default'],
    turboRollUntil: 0,
    activeBoosters: {},
    automations: {},
    onlinePlayers: 1,
    communityRewardClaimedAt: 0,
    freeShardsEarnedToday: 0,
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
    },
    masteryPoints: 0,
    masterySkills: {
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
    },
    guildPerks: { luckRank: 0, speedRank: 0, vaultRank: 0 },
  };
}

// Level Progression and Milestones System
export interface LevelMilestonePerk {
  level: number;
  name: string;
  desc: string;
  bonusBalls?: number;
  bonusLuckMultiplier?: number;
  bonusCoinsMultiplier?: number;
  bonusXpMultiplier?: number;
  bonusShardChance?: number;
}

export const LEVEL_MILESTONES: LevelMilestonePerk[] = [
  { level: 5, name: 'Novice Seeker', desc: '+15% XP earned on all rolls', bonusXpMultiplier: 1.15 },
  { level: 10, name: 'Shard Sifter', desc: '+5% chance for bonus Shards', bonusShardChance: 0.05 },
  { level: 15, name: 'Chrono Adept', desc: 'Cooldown floor reduced by 150ms' },
  { level: 20, name: 'Alchemical Affinity', desc: 'Altar Sacrifices are 15% more potent' },
  { level: 25, name: 'Twin Orb Conductor', desc: '+1 Extra Orb per activation!', bonusBalls: 1 },
  { level: 35, name: "Fortune's Blessing", desc: '+15% Luck!', bonusLuckMultiplier: 1.15 },
  { level: 50, name: 'Orb Titan', desc: '+1 Extra Orb per activation & 1.30× Coins!', bonusBalls: 1, bonusCoinsMultiplier: 1.30 },
  { level: 75, name: 'Astral Conduit', desc: '+20% Luck!', bonusLuckMultiplier: 1.20 },
  { level: 100, name: 'Transcendent Paragon', desc: '+2 Extra Orbs per activation & +30% Luck!', bonusBalls: 2, bonusLuckMultiplier: 1.30 },
  { level: 150, name: 'Grand Conductor', desc: '+2 Extra Orbs per activation & +20% XP!', bonusBalls: 2, bonusXpMultiplier: 1.20 },
  { level: 200, name: 'Void Fortune', desc: '+30% Luck!', bonusLuckMultiplier: 1.30 },
  { level: 300, name: 'Golden Age', desc: '1.50× Multiplicative Coin boost!', bonusCoinsMultiplier: 1.50 },
  { level: 400, name: 'Orb Battalion', desc: '+2 Extra Orbs per activation!', bonusBalls: 2 },
  { level: 500, name: 'Astral Zenith', desc: '+40% Luck and +10% Shard Chance!', bonusLuckMultiplier: 1.40, bonusShardChance: 0.10 },
  { level: 750, name: 'Infinite Arsenal', desc: '+3 Extra Orbs per activation!', bonusBalls: 3 },
  { level: 1000, name: 'Infinity Master', desc: '+50% Luck and 2.00× Coins!', bonusLuckMultiplier: 1.50, bonusCoinsMultiplier: 2.00 },
];

export function xpRequiredForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const base = Math.floor(70 * Math.pow(safeLevel, 1.30));
  // Levels through 25 retain the existing curve. After 25, each additional
  // level increases its XP requirement by another 10%, progressively slowing
  // late-game leveling without changing the early game.
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
    if (milestone.level === 15) cooldownReductionMs += 150;
    if (milestone.level === 20) altarEffectMultiplier *= 1.15;
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

export function totalXpRequiredBeforeLevel(level: number): number {
  const safeLevel = Math.max(1, Math.min(1000, Math.floor(Number(level) || 1)));
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
  const safeLevel = Math.max(1, Math.min(1000, Math.floor(Number(level) || 1)));
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
  const MAX_LEVEL = 1000;
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
  const MAX_LEVEL = 1000;
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

  // Match the displayed Altar bonuses: +1% per altar level and +2% per infused shard.
  const coinBonus = sacrifices.altarLevel * 0.01 * altarEffectMultiplier * resonatorBonus;
  const shardBonus = (sacrifices.shardsSacrificed || 0) * 0.02 * altarEffectMultiplier * resonatorBonus;

  const coinMultiplier = Math.round((1 + coinBonus) * 100) / 100;
  const shardMultiplier = Math.round((1 + shardBonus) * 100) / 100;
  const isSurgeActive = Boolean(sacrifices.luckSurgeUntil && Date.now() < sacrifices.luckSurgeUntil);
  const surgeMultiplier = isSurgeActive ? 1.25 : 1.0;

  // Altar components multiply rather than add: coin × shards × active Surge.
  const totalAltarMultiplier =
    Math.round(coinMultiplier * shardMultiplier * surgeMultiplier * 100) / 100;

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

export const SHARD_SYNTHESIS_COST = 10;
export const SINGULARITY_TITHE_ROLLS_PER_DUST = 200;
export function singularityTitheDustForRolls(
  previousRolls: number,
  processedRolls: number,
  level: number,
): number {
  const before = Math.max(0, Math.floor(Number(previousRolls) || 0));
  const rolls = Math.max(0, Math.floor(Number(processedRolls) || 0));
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  if (rolls === 0 || safeLevel === 0) return 0;

  const milestonesBefore = Math.floor(before / SINGULARITY_TITHE_ROLLS_PER_DUST);
  const milestonesAfter = Math.floor((before + rolls) / SINGULARITY_TITHE_ROLLS_PER_DUST);
  return Math.max(0, milestonesAfter - milestonesBefore) * safeLevel;
}


export function effectiveOfflineTickMs(s: PlayerState): number {
  const rateReduction = (s.upgrades.offlineRate ?? 0) * 0.08;
  const overdriveLevel = Math.max(0, Math.min(3, s.prestigeUpgrades?.offlineOverdrive ?? 0));
  const overdriveMultiplier = Math.pow(1.5, overdriveLevel);
  return Math.max(10_000, Math.round((OFFLINE_TICK_MS / overdriveMultiplier) * (1 - Math.min(0.6, rateReduction))));
}

export function critMultiplier(s: PlayerState): number {
  const masteryCritPower = (s.masterySkills?.critMastery ?? 0) * 0.30;
  return 2.0 +
    (s.upgrades.critPower ?? 0) * 0.25 +
    masteryCritPower +
    globalBoosterCritLuckBonus(s.globalBoosters?.crit) +
    guildComboCritLuckBonus(s.guildCombo);
}

export function cooldownMs(s: PlayerState, isAuto = false): number {
  const permReduction = (s.prestigeUpgrades?.permSpeed ?? 0) * 300;
  const guildSpeedReduction = (s.guildPerks?.speedRank ?? 0) * 100;
  const masteryChronoReduction = (s.masterySkills?.chronoFlow ?? 0) * 120;
  const steadyHandsReduction = (s.prestigeUpgrades?.steadyHands ?? 0) * 100;
  const temporalCompressionReduction = (s.prestigeUpgrades?.temporalCompression ?? 0) * 75;
  const levelBenefits = getLevelBenefits(Math.max(1, s.level || 1));
  const levelReduction = levelBenefits.cooldownReductionMs;

  // Roll speed: 20 levels × 150ms = 3.0s total maximum reduction.
  const speedLevel = Math.min(20, Math.max(0, s.upgrades.speed ?? 0));
  const coinReduction = speedLevel * 150;

  const floor = Math.max(
    800,
    2000 -
      permReduction -
      guildSpeedReduction -
      masteryChronoReduction -
      steadyHandsReduction -
      temporalCompressionReduction -
      levelReduction,
  );
  // Prestige cooldown investments reduce the active cooldown as well as
  // lowering its minimum floor. Otherwise a 15s base cooldown makes these
  // upgrades effectively inert at ordinary roll speeds.
  const directPrestigeReduction =
    permReduction + steadyHandsReduction + temporalCompressionReduction;
  let cd = Math.max(
    floor,
    BASE_COOLDOWN_MS - coinReduction - directPrestigeReduction,
  );

  if (isAuto && (s.prestigeUpgrades?.autoOverclock ?? 0) > 0) {
    const overclockFactor = 1 - (s.prestigeUpgrades.autoOverclock * 0.05);
    cd = Math.max(700, Math.round(cd * overclockFactor));
  }
  if (
    typeof s.turboRollUntil === 'number' &&
    Number.isSafeInteger(s.turboRollUntil) &&
    s.turboRollUntil > Date.now()
  ) {
    const turboReduction = (s.prestigeUpgrades?.chronoOverdrive ?? 0) > 0 ? 0.65 : 0.75;
    cd = Math.max(600, Math.round(cd * turboReduction));
  }

  if (isPremiumBoosterActive(s, 'hyperdrive')) {
    cd = Math.max(400, Math.round(cd * 0.25));
  }
  if (s.globalBoosters?.speed) {
    cd = Math.max(300, Math.round(cd * globalBoosterSpeedMultiplier(s.globalBoosters.speed)));
  }
  if (s.guildCombo) {
    cd = Math.max(300, Math.round(cd * guildComboSpeedMultiplier(s.guildCombo)));
  }
  if (s.dailyStreakCommunity?.speedMultiplier) {
    cd = Math.max(300, Math.round(cd * s.dailyStreakCommunity.speedMultiplier));
  }
  return Math.round(cd);
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
      .map(([rarity]) => Math.floor(Number(rarity)))
      .filter(Number.isFinite),
  )].sort((a, b) => a - b);

  if (rarities.length === 0) return { start: 0, end: 0, length: 0 };

  let bestStart = rarities[0];
  let bestEnd = rarities[0];
  let currentStart = rarities[0];

  for (let i = 1; i <= rarities.length; i++) {
    const previous = rarities[i - 1];
    const current = rarities[i];
    if (i < rarities.length && current === previous + 1) continue;

    const currentEnd = previous;
    const currentLength = currentEnd - currentStart + 1;
    const bestLength = bestEnd - bestStart + 1;

    if (
      currentLength > bestLength ||
      (currentLength === bestLength && currentEnd > bestEnd)
    ) {
      bestStart = currentStart;
      bestEnd = currentEnd;
    }

    currentStart = current;
  }

  return {
    start: bestStart,
    end: bestEnd,
    length: bestEnd - bestStart + 1,
  };
}

export function highestCodexChain(collection: Record<string, number> | null | undefined): number {
  return bestCodexChain(collection).length;
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
export const ALTAR_COIN_FLOOR_GROWTH = 2;
export const ALTAR_BASE_CHANCE_DECAY = 0.85;

export function altarCoinFloor(altarLevel: number): number {
  const safeLevel = Math.max(0, Math.floor(Number(altarLevel) || 0));
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.round(MIN_ALTAR_COIN_OFFER * Math.pow(ALTAR_COIN_FLOOR_GROWTH, safeLevel)),
  );
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
  // doubles, while the underlying odds fall by 15% per level. Larger
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
  const totalLevelLuck = getLevelBenefits(Math.max(1, s.level || 1)).luckMultiplier;
  additiveBonus += Math.max(0, totalLevelLuck - 1);

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
  // Cosmic Reserve is an independent multiplicative layer. Each unspent Dust
  // contributes another 1%-5% to this factor based on the purchased level.
  const cosmicReserveLevel = Math.max(0, Math.min(5, Math.floor(Number(s.prestigeUpgrades?.cosmicReserve ?? 0) || 0)));
  const unspentDust = Math.max(0, Math.floor(Number(s.cosmicDust ?? 0) || 0));
  const cosmicReserveMultiplier = 1 + unspentDust * cosmicReserveLevel * 0.01;
  const { totalAltarMultiplier } = calculateAltarMultipliers(s);

  const baseLuck = 1 + additiveBonus;
  return Math.round(baseLuck * prestigeMultiplier * cosmicReserveMultiplier * totalAltarMultiplier * 100) / 100;
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
  if (rarity <= 1) return 1;
  return Math.max(1, Math.round(Math.pow(rarity, 0.68)));
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
  const critChance = Math.min(
    0.40,
    (s.upgrades.critChance ?? 0) * 0.03 +
    (s.masterySkills?.critMastery ?? 0) * 0.03 +
    (s.guildPerks?.critRank ?? 0) * 0.015 +
    globalBoosterCritChanceBonus(s.globalBoosters?.crit) +
    guildComboCritChanceBonus(s.guildCombo),
  );

  const rarities: number[] = [];
  const batch: Orb[] = [];
  let bestRarity = 0;
  let totalValueGained = 0;
  let shardsGained = 0;
  let xpGained = 0;
  let uniqueGained = 0;
  const lifetimeRollsBeforeBatch = s.totalRolls;

  for (let i = 0; i < rollCount; i++) {
    const isGuaranteedThirdBall = lifetimeRollsBeforeBatch + i === 2;
    const isCrit = !isGuaranteedThirdBall && rng() < critChance;
    let effectiveCm = cm;

    if (isCrit) {
      s.totalCrits = (s.totalCrits ?? 0) + 1;
      const supernovaLevel = s.prestigeUpgrades?.supernova ?? 0;
      if (supernovaLevel > 0 && rng() < supernovaLevel * 0.10) {
        effectiveCm = 5;
      }
    }

    const minimumRarity = 2 + (s.prestigeUpgrades?.luckyFloor ?? 0);
    const beginnerRarity = 101 + Math.floor(rng() * 20);
    const rolledRarity = isGuaranteedThirdBall
      ? beginnerRarity
      : Math.max(minimumRarity, rollContinuum(effectiveLuck, rng));
    const rarity = isCrit
      ? Math.min(MAX_ORB_RARITY, Math.round(rolledRarity * effectiveCm))
      : rolledRarity;

    const finalVal = Math.round(rarity * valueMul);
    const isNew = !s.collection[String(rarity)];
    if (isNew) uniqueGained++;
    s.collection[String(rarity)] = (s.collection[String(rarity)] ?? 0) + 1;
    s.totalRolls++;
    s.currentRunRolls = (s.currentRunRolls ?? 0) + 1;
    s.collectionValue = Math.min(Number.MAX_SAFE_INTEGER, (s.collectionValue ?? 0) + finalVal);
    s.lifetimeCollectionValue = Math.min(Number.MAX_SAFE_INTEGER, (s.lifetimeCollectionValue ?? 0) + finalVal);
    if (rarity > s.highestRarity) {
      s.highestRarity = rarity;
      s.rollsSinceBest = 0;
    } else {
      s.rollsSinceBest = (s.rollsSinceBest ?? 0) + 1;
      s.highestDryStreak = Math.max(s.highestDryStreak ?? 0, s.rollsSinceBest);
    }
    bestRarity = Math.max(bestRarity, rarity);

    let earnedShards = 0;
    if (rarity >= 1_000_000) earnedShards = 10;
    else if (rarity >= 100_000) earnedShards = 5;
    else if (rarity >= 10_000) earnedShards = 2;
    else if (rarity >= 1_000) earnedShards = 1;

    const shardProcChance = Math.min(
      1,
      (s.upgrades.shardChance ?? 0) * 0.0015 +
      (s.masterySkills?.shardAttunement ?? 0) * 0.001 +
      (s.guildPerks?.shardRank ?? 0) * 0.0005 +
      levelBenefits.shardChance,
    );
    if (rng() < shardProcChance) earnedShards += 1;

    shardsGained += earnedShards;
    const earnedXp = Math.round(
      Math.min(300, 12 + Math.floor(Math.log10(rarity + 1) * 12)) *
      (1 + (s.upgrades.xpBonus ?? 0) * 0.20) *
      levelBenefits.xpMultiplier,
    );
    xpGained += earnedXp;

    if (batch.length < 50) {
      const info = getOrbInfo(rarity);
      batch.push({
        rarity,
        rolledAt: Date.now(),
        tier: info.tier,
        name: info.name,
        isNew,
        isCrit,
      });
    }
    rarities.push(rarity);
    totalValueGained += finalVal;
  }

  rarities.sort((a, b) => b - a);
  const topCoins = Math.round(coinsForRarity(rarities[0] ?? 2));
  const extraCoins = rarities.slice(1).reduce(
    (sum, rarity) => sum + Math.max(1, Math.round(coinsForRarity(rarity) * 0.20)),
    0,
  );
  let coinsGained = Math.round(
    (topCoins + extraCoins) *
    levelBenefits.coinsMultiplier *
    (1 + (s.upgrades.coinBonus ?? 0) * 0.15) *
    (1 + (s.masterySkills?.prosperity ?? 0) * 0.12) *
    (1 + (s.guildPerks?.coinRank ?? 0) * 0.10),
  );

  const lowRarityCoins = rarities
    .filter(rarity => rarity < 100)
    .reduce((sum, rarity) => sum + Math.max(1, Math.round(coinsForRarity(rarity))), 0);

  if ((s.prestigeUpgrades?.autoFilter ?? 0) > 0 && lowRarityCoins > 0) {
    coinsGained += Math.round(lowRarityCoins * 0.25);
  }

  const transLevel = s.prestigeUpgrades?.transmutation ?? 0;
  if (transLevel > 0) {
    coinsGained += Math.round(lowRarityCoins * (transLevel * 0.15));
    for (let i = 0; i < rollCount; i++) {
      if (rng() < 0.01 * transLevel) shardsGained += 1;
    }
  }

  if (isPremiumBoosterActive(s, 'ascension')) {
    xpGained *= 10;
  }
  s.coins += coinsGained;
  s.lifetimeCoins = (s.lifetimeCoins ?? 0) + coinsGained;
  s.shards = Math.max(0, (s.shards ?? 0) + shardsGained);
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

  const bestInfo = getOrbInfo(bestRarity);
  const bestOrb: Orb = {
    rarity: bestRarity,
    rolledAt: Date.now(),
    tier: bestInfo.tier,
    name: bestInfo.name,
    isNew: (sourceState.collection?.[String(bestRarity)] ?? 0) <= 0,
    isCrit: bestRarity > (sourceState.highestRarity ?? 0),
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
  // Hard caps are shared so UI, bulk buying, automation, and server verification agree.
  if (id === 'speed' && level >= 20) return Infinity;
  // Offline Generation Speed reduces its tick by 8% per level, capped at 60%.
  // Level 8 reaches the hard cap; further purchases have no gameplay effect.
  if (id === 'offlineRate' && level >= 8) return Infinity;
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
  };
  const { base, mult } = configs[id];
  return Math.floor(base * Math.pow(mult, level));
}

// Prestige formula: floor(sqrt(Collection Value / 1,000,000))
export function calculatePrestigeDust(collectionValue: number): number {
  if (!collectionValue || collectionValue < 1_000_000) return 0;
  return Math.floor(Math.sqrt(collectionValue / 1_000_000));
}

export function calculateCosmicDust(s: PlayerState): number {
  const currentVal = s.collectionValue ?? 0;
  if (currentVal < 1_000_000) return 0;
  const base = calculatePrestigeDust(currentVal);
  if (base <= 0) return 0;
  const bonus = (s.prestigeUpgrades?.dustBounty ?? 0) * 0.15;
  const masteryBonus = (s.masterySkills?.cosmicAttunement ?? 0) * 0.08;
  return Math.floor(base * (1 + bonus + masteryBonus));
}

export function prestigeUpgradeCost(id: PrestigeUpgradeId, level: number): number {
  const bases: Record<PrestigeUpgradeId, number> = {
    permLuck: 2,
    permSpeed: 3,
    vaultCap: 1,
    dustBounty: 5,
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
    singularityTithe: 5,
    luckyFloor: 3,
    astralArsenal: 5,
    deepVault: 2,
    masteryEngine: 4,
    steadyHands: 3,
    offlineFortune: 3,
    frenzyVolley: 25,
    astralReserve: 4,
    temporalCompression: 4,
    shardResonator: 4,
    cosmicValuation: 5,
    cosmicReserve: 5,
  };
  const base = bases[id] ?? 2;
  return Math.round(base * Math.pow(1.5, level));
}

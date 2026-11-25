import type { PlayerState } from './game.js';
import type { RiftRelicId, RiftRelicLevels } from './rift-relics.js';
export type RiftChallengeUpgradeId = 'fortune' | 'speed' | 'prosperity' | 'critical';
export type RiftChallengeRunStatus = 'active' | 'completed';

export const RIFT_CHALLENGES = [
  {
    id: 'first-spark',
    number: 1,
    name: 'The First Spark',
    subtitle: 'Build something from nothing',
    description: 'Start with an empty Rift economy. Find an Orb with rarity 1 in 1,000 before the temporary economy runs dry.',
    targetRarity: 1_000,
    requiredMainLevel: 5,
    prerequisiteId: null,
    baseCooldownMs: 1_500,
    coinMultiplier: 1,
    firstClearPoints: 3,
    repeatClearPoints: 1,
    rateBonusPerHour: 0.5,
    debuffs: [
      { name: 'Fresh Save', description: 'Main-game Coins and upgrades do not carry over. Only the permanent Emergency Stipend perk can seed this separate wallet.' },
      { name: 'Dimensional Tax', description: 'Challenge-upgrade prices rise by 5% every 10 rolls, up to 50%.' },
      { name: 'Shards Disabled', description: 'Shards cannot drop or be spent during a Rift run.' },
      { name: 'No Automation', description: 'Auto Roll and offline rolls are unavailable.' },
      { name: 'Sealed Progression', description: 'Main-game boosts do not affect this temporary economy.' },
    ],
  },
  {
    id: 'fractured-tempo',
    number: 2,
    name: 'Fractured Tempo',
    subtitle: 'A slower world, a sharper clock',
    description: 'The Rift resists rapid action. Work around a longer roll interval and find an Orb with rarity 1 in 10,000.',
    targetRarity: 10_000,
    requiredMainLevel: 10,
    prerequisiteId: 'first-spark',
    baseCooldownMs: 2_100,
    coinMultiplier: 0.9,
    firstClearPoints: 5,
    repeatClearPoints: 2,
    rateBonusPerHour: 0.75,
    debuffs: [
      { name: 'Temporal Drag', description: 'The base roll interval is longer than in The First Spark.' },
      { name: 'Thin Payouts', description: 'Challenge Coin rewards are reduced by 10%.' },
      { name: 'Dimensional Tax', description: 'Challenge-upgrade prices rise by 5% every 10 rolls, up to 50%.' },
      { name: 'Sealed Progression', description: 'Only Rift-specific perks affect this temporary economy.' },
    ],
  },
  {
    id: 'hollow-economy',
    number: 3,
    name: 'Hollow Economy',
    subtitle: 'Make every Coin count',
    description: 'The economy is nearly empty. Challenge Coins are scarce, but the target is within reach if you build carefully. Find an Orb with rarity 1 in 100,000.',
    targetRarity: 100_000,
    requiredMainLevel: 15,
    prerequisiteId: 'fractured-tempo',
    baseCooldownMs: 2_400,
    coinMultiplier: 0.55,
    firstClearPoints: 7,
    repeatClearPoints: 3,
    rateBonusPerHour: 1,
    debuffs: [
      { name: 'Hollow Payouts', description: 'Challenge Coin rewards are reduced by 45%.' },
      { name: 'Temporal Drag', description: 'The base roll interval is longer than in earlier challenges.' },
      { name: 'Dimensional Tax', description: 'Challenge-upgrade prices rise by 5% every 10 rolls, up to 50%.' },
      { name: 'Sealed Progression', description: 'Main-game Luck, Coins, and XP perks do not apply inside the challenge.' },
    ],
  },
] as const;

export type RiftChallengeId = typeof RIFT_CHALLENGES[number]['id'];
export type RiftChallengeDefinition = typeof RIFT_CHALLENGES[number];
export const RIFT_FIRST_SPARK = RIFT_CHALLENGES[0];

export function getRiftChallengeDefinition(id: unknown): RiftChallengeDefinition | undefined {
  return RIFT_CHALLENGES.find(challenge => challenge.id === id);
}

export interface RiftChallengeMainProgress {
  level: number;
  totalRolls: number;
  totalCrits: number;
  highestRarity: number;
  masteryPoints: number;
}

export interface RiftChallengeMechanicUnlocks {
  fortune: boolean;
  speed: boolean;
  prosperity: boolean;
  critical: boolean;
}

export interface RiftChallengeUpgradeDefinition {
  name: string;
  description: string;
  mainRequirement: string;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
}

export interface RiftPerkDefinition {
  id: RiftPerkId;
  name: string;
  category: 'main-game' | 'rift';
  description: string;
  effect: string;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
}

export type RiftPerkId =
  | 'mainLuck'
  | 'mainCoins'
  | 'mainXp'
  | 'riftLuck'
  | 'riftSpeed'
  | 'riftYield'
  | 'riftStartCoins'
  | 'temporalArbitrage'
  | 'probabilityDebt'
  | 'temporalCompression'
  | 'fractureCascade'
  | 'echoChamber'
  | 'dimensionalInterest'
  | 'overkill'
  | 'singularityFocus'
  | 'bossResonance' | 'masteryBridge' | 'runeReconnection'
  | 'automationOverride' | 'chronoEngine' | 'combatIntegration'
  | 'initialCalibration' | 'preloadedBlueprint' | 'earlyAuthorization'
  | 'riftConditioning' | 'advancedDeployment' | 'fortuneReservoir'
  | 'criticalConversion' | 'fractureRecycling' | 'emergencyProtocol'
  | 'milestoneAmplifier' | 'anomalyHarvesting' | 'anomalyForecaster'
  | 'mutationStabilizer' | 'mutationAmplifier' | 'mutationExtraction'
  | 'anomalyPersistence'
  | 'timelineFork';

export type RiftPerkLevels = Record<RiftPerkId, number>;

export const RIFT_PERKS: Record<RiftPerkId, RiftPerkDefinition> = {
  mainLuck: {
    id: 'mainLuck', name: 'Rift Attunement', category: 'main-game',
    description: 'Tune ordinary Orb rolls to the Rift frequency.',
    effect: '+2% main-game Luck per level.',
    baseCost: 3, costGrowth: 1.62, maxLevel: 10,
  },
  mainCoins: {
    id: 'mainCoins', name: 'Fracture Dividend', category: 'main-game',
    description: 'Recover value from the edges of every discovery.',
    effect: '+5% main-game Coin earnings per level.',
    baseCost: 4, costGrowth: 1.68, maxLevel: 10,
  },
  mainXp: {
    id: 'mainXp', name: 'Echo Study', category: 'main-game',
    description: 'Carry a little more knowledge back from each roll.',
    effect: '+5% main-game XP earnings per level.',
    baseCost: 4, costGrowth: 1.68, maxLevel: 10,
  },
  riftLuck: {
    id: 'riftLuck', name: 'Rift-Side Fortune', category: 'rift',
    description: 'Improve the odds inside temporary challenge saves.',
    effect: '+5% challenge Luck per level.',
    baseCost: 2, costGrowth: 1.55, maxLevel: 10,
  },
  riftSpeed: {
    id: 'riftSpeed', name: 'Temporal Anchor', category: 'rift',
    description: 'Reduce the waiting period between challenge rolls.',
    effect: '−3% challenge cooldown per level.',
    baseCost: 3, costGrowth: 1.62, maxLevel: 10,
  },
  riftYield: {
    id: 'riftYield', name: 'Resonant Flow', category: 'rift',
    description: 'Increase the amount of Rift energy converted into points.',
    effect: '+5% Rift Bar generation per level.',
    baseCost: 8, costGrowth: 1.82, maxLevel: 10,
  },
  riftStartCoins: {
    id: 'riftStartCoins', name: 'Emergency Stipend', category: 'rift',
    description: 'Seed each new challenge with a small reserve.',
    effect: '+100 starting challenge Coins per level.',
    baseCost: 2, costGrowth: 1.48, maxLevel: 20,
  },
  temporalArbitrage: {
    id: 'temporalArbitrage', name: 'Temporal Arbitrage', category: 'rift',
    description: 'Turn Temporal Drag into Luck. The slower you choose to roll, the stronger this becomes.',
    effect: '+1% conversion per level. At level 20, ×6 Time grants ×2 Luck and ×20 grants ×4.8.',
    baseCost: 5, costGrowth: 1.70, maxLevel: 20,
  },
  probabilityDebt: {
    id: 'probabilityDebt', name: 'Probability Debt', category: 'rift',
    description: 'Failed rolls accumulate Luck until a new personal best clears the debt.',
    effect: 'Each failed roll adds 0.1% Luck per level, with another 0.1% per level every 100 failures.',
    baseCost: 6, costGrowth: 1.72, maxLevel: 10,
  },
  temporalCompression: {
    id: 'temporalCompression', name: 'Temporal Compression', category: 'rift',
    description: 'Compress the cooldown penalty from Temporal Drag without reducing its Luck conversion.',
    effect: 'Ignore 4% of the added cooldown per level, up to 80%.',
    baseCost: 7, costGrowth: 1.72, maxLevel: 20,
  },
  fractureCascade: {
    id: 'fractureCascade', name: 'Fracture Cascade', category: 'rift',
    description: 'A new personal best primes a chain of increasingly fortunate follow-up rolls.',
    effect: 'Next 5 + 2 per level rolls gain +5% Luck per level.',
    baseCost: 5, costGrowth: 1.72, maxLevel: 10,
  },
  echoChamber: {
    id: 'echoChamber', name: 'Echo Chamber', category: 'rift',
    description: 'Some Orbs repeat themselves as separate bonus Orbs. Echoes count toward progress and collection.',
    effect: '+1% echo chance per level, up to 20%.',
    baseCost: 8, costGrowth: 1.78, maxLevel: 20,
  },
  dimensionalInterest: {
    id: 'dimensionalInterest', name: 'Dimensional Interest', category: 'rift',
    description: 'Unspent challenge Coins compound while a Rift run is active.',
    effect: '+0.25% Coin interest per level, compounded each minute.',
    baseCost: 5, costGrowth: 1.70, maxLevel: 10,
  },
  overkill: {
    id: 'overkill', name: 'Overkill', category: 'rift',
    description: 'Rarity beyond the challenge objective is converted into a larger completion reward.',
    effect: '+10% reward per excess order of magnitude per level.',
    baseCost: 10, costGrowth: 1.80, maxLevel: 10,
  },
  singularityFocus: {
    id: 'singularityFocus', name: 'Singularity Focus', category: 'rift',
    description: 'Luck intensifies as your best Orb approaches the challenge objective.',
    effect: 'At level 10, reach ×2 Luck at 90% and ×5 at 99% objective progress.',
    baseCost: 7, costGrowth: 1.75, maxLevel: 10,
  },
  bossResonance: { id: 'bossResonance', name: 'Boss Resonance', category: 'rift', description: 'Reconnect the permanent Combat boss-clear bonus to Rift rolls.', effect: 'Restores 10% of your Combat Boss Luck per level, up to 100%.', baseCost: 18, costGrowth: 1.78, maxLevel: 10 },
  masteryBridge: { id: 'masteryBridge', name: 'Mastery Bridge', category: 'rift', description: 'Carry your main-game Mastery skills into new Rift runs.', effect: 'Transfers 10% of each unlocked Mastery skill level per level.', baseCost: 16, costGrowth: 1.78, maxLevel: 10 },
  runeReconnection: { id: 'runeReconnection', name: 'Rune Reconnection', category: 'rift', description: 'Reconnect equipped Combat Runes to Rift rolls.', effect: 'Restores 10% of equipped Rune effects per level, up to 100%.', baseCost: 20, costGrowth: 1.82, maxLevel: 10 },
  automationOverride: { id: 'automationOverride', name: 'Automation Override', category: 'rift', description: 'Bypass the Rift restriction on Auto Roll, including in The First Spark.', effect: 'Unlocks Auto Roll inside all Rift challenges.', baseCost: 32, costGrowth: 1.9, maxLevel: 1 },
  chronoEngine: { id: 'chronoEngine', name: 'Chrono Engine', category: 'rift', description: 'Unlock Time Energy generation and spending inside Rift runs.', effect: 'Enables Cooldown Reclaimer and instant Time Energy activations in the Rift.', baseCost: 36, costGrowth: 1.9, maxLevel: 1 },
  combatIntegration: { id: 'combatIntegration', name: 'Combat Integration', category: 'rift', description: 'Let your equipped Combat Orb focus influence Rift rarity floors.', effect: 'Transfers 10% of Combat Orb Focus per level, up to 100%.', baseCost: 22, costGrowth: 1.82, maxLevel: 10 },
  initialCalibration: { id: 'initialCalibration', name: 'Initial Calibration', category: 'rift', description: 'Tune your starting Rift frequency before each challenge.', effect: '+1% displayed objective progress and +2% Rift Luck per level. It never counts as an actual discovery.', baseCost: 9, costGrowth: 1.7, maxLevel: 10 },
  preloadedBlueprint: { id: 'preloadedBlueprint', name: 'Preloaded Blueprint', category: 'rift', description: 'Choose one challenge upgrade to install before a run begins.', effect: 'The selected challenge upgrade starts with one free level per perk level, up to 4.', baseCost: 15, costGrowth: 1.82, maxLevel: 4 },
  earlyAuthorization: { id: 'earlyAuthorization', name: 'Early Authorization', category: 'rift', description: 'Pre-authorize challenge mechanics instead of waiting for their usual in-run requirements.', effect: 'Unlocks one additional challenge upgrade requirement per level, up to all four.', baseCost: 12, costGrowth: 1.75, maxLevel: 4 },
  riftConditioning: { id: 'riftConditioning', name: 'Rift Conditioning', category: 'rift', description: 'Completed challenges permanently condition future Rift expeditions.', effect: '+1% Rift Luck per previously cleared challenge per level.', baseCost: 11, costGrowth: 1.75, maxLevel: 10 },
  advancedDeployment: { id: 'advancedDeployment', name: 'Advanced Deployment', category: 'rift', description: 'Prepare additional Emergency Protocol charges before entering a challenge.', effect: '+1 Emergency Protocol use per level at the start of each run.', baseCost: 14, costGrowth: 1.78, maxLevel: 5 },
  fortuneReservoir: { id: 'fortuneReservoir', name: 'Fortune Reservoir', category: 'rift', description: 'Store unused fortune and release it in regular bursts.', effect: 'Every 50 rolls, the next 5 rolls gain +10% Luck per level.', baseCost: 13, costGrowth: 1.78, maxLevel: 10 },
  criticalConversion: { id: 'criticalConversion', name: 'Critical Conversion', category: 'rift', description: 'Convert every fifth critical roll into a growing Luck charge.', effect: '+1% Luck per level for every five critical rolls, capped at +100%.', baseCost: 15, costGrowth: 1.8, maxLevel: 10 },
  fractureRecycling: { id: 'fractureRecycling', name: 'Fracture Recycling', category: 'rift', description: 'Recycle rarity that exceeds the current challenge objective into Coins.', effect: '+5% bonus Rift Coin yield per excess order of magnitude per level.', baseCost: 13, costGrowth: 1.8, maxLevel: 10 },
  emergencyProtocol: { id: 'emergencyProtocol', name: 'Emergency Protocol', category: 'rift', description: 'Activate a one-use emergency sequence during an active run.', effect: 'Gain one charge per run. An activation clears the roll cooldown and grants 5 rolls of ×1.5 Luck.', baseCost: 25, costGrowth: 1.9, maxLevel: 1 },
  milestoneAmplifier: { id: 'milestoneAmplifier', name: 'Milestone Amplifier', category: 'rift', description: 'Approaching the objective unlocks increasingly powerful temporary Luck.', effect: '+5% Luck per level at each 25%, 50%, 75%, and 90% objective milestone.', baseCost: 14, costGrowth: 1.78, maxLevel: 10 },
  anomalyHarvesting: { id: 'anomalyHarvesting', name: 'Anomaly Harvesting', category: 'rift', description: 'Harvest extra Rift Coins while a mutation is active.', effect: '+5% Rift Coin earnings during active mutations per level.', baseCost: 12, costGrowth: 1.8, maxLevel: 10 },
  anomalyForecaster: { id: 'anomalyForecaster', name: 'Anomaly Forecaster', category: 'rift', description: 'See several possible mutations before one takes hold.', effect: 'Choose between three mutations instead of receiving one random option.', baseCost: 18, costGrowth: 1.85, maxLevel: 1 },
  mutationStabilizer: { id: 'mutationStabilizer', name: 'Mutation Stabilizer', category: 'rift', description: 'Reduce the harmful side effects of active Rift Mutations.', effect: 'Reduces mutation penalties by 5% per level, up to 50%.', baseCost: 12, costGrowth: 1.78, maxLevel: 10 },
  mutationAmplifier: { id: 'mutationAmplifier', name: 'Mutation Amplifier', category: 'rift', description: 'Make mutations more volatile and more rewarding.', effect: '+5% mutation benefits and +2% mutation penalties per level.', baseCost: 11, costGrowth: 1.78, maxLevel: 10 },
  mutationExtraction: { id: 'mutationExtraction', name: 'Mutation Extraction', category: 'rift', description: 'Convert completed mutations into additional Rift Point rewards.', effect: '+1 Rift Point per completed mutation per level.', baseCost: 14, costGrowth: 1.8, maxLevel: 10 },
  anomalyPersistence: { id: 'anomalyPersistence', name: 'Anomaly Persistence', category: 'rift', description: 'Keep beneficial and harmful mutations active for longer.', effect: '+5 mutation rolls of duration per level.', baseCost: 10, costGrowth: 1.75, maxLevel: 10 },
  timelineFork: { id: 'timelineFork', name: 'Timeline Fork', category: 'rift', description: 'Split the Rift timeline and stabilize a third permanent relic slot.', effect: 'Equip 3 Rift Relics instead of 2.', baseCost: 60, costGrowth: 1.9, maxLevel: 1 },
};

export const RIFT_MUTATIONS = [
  { id: 'temporal-collapse', name: 'Temporal Collapse', description: 'Roll cooldowns shrink dramatically, but Rift Coin income is reduced.', effect: '×0.70 cooldown and ×0.75 Coins.' },
  { id: 'gravitational-surge', name: 'Gravitational Surge', description: 'A gravity well bends rarity upward while pulling Coins out of the run.', effect: '×1.45 Luck and ×0.70 Coins.' },
  { id: 'unstable-economy', name: 'Unstable Economy', description: 'The Rift wallet swings between lean and unusually profitable roll batches.', effect: 'Rift Coin yield alternates between ×0.55 and ×1.85 every five rolls.' },
  { id: 'critical-instability', name: 'Critical Instability', description: 'Critical energy surges, but ordinary rarity becomes less reliable.', effect: '+8 percentage points of critical chance and ×0.85 Luck.' },
  { id: 'nullification', name: 'Nullification', description: 'Rift Luck perks are partially suppressed in exchange for a larger mutation payout.', effect: 'Rift Luck perk bonuses are halved and mutation completion rewards are doubled.' },
] as const;

export type RiftMutationId = typeof RIFT_MUTATIONS[number]['id'];
export type RiftMutationState = { id: RiftMutationId; startedAt: number; startedAtRoll: number; endsAtRoll: number; };

export function getRiftMutationDefinition(id: unknown) {
  return RIFT_MUTATIONS.find(mutation => mutation.id === id);
}

export function riftMutationDurationRolls(persistenceLevel: number): number {
  const level = Math.max(0, Math.min(RIFT_PERKS.anomalyPersistence.maxLevel, Math.floor(Number(persistenceLevel) || 0)));
  return 25 + level * 5;
}

export function riftMutationPenaltyFactor(stabilizerLevel: number, amplifierLevel: number): number {
  const stabilizer = Math.max(0, Math.min(RIFT_PERKS.mutationStabilizer.maxLevel, Math.floor(Number(stabilizerLevel) || 0)));
  const amplifier = Math.max(0, Math.min(RIFT_PERKS.mutationAmplifier.maxLevel, Math.floor(Number(amplifierLevel) || 0)));
  return Math.max(0.25, 1 - stabilizer * 0.05 + amplifier * 0.02);
}

/**
 * Normalized logarithmic progress from the run's starting rarity (2) to its
 * objective. Equal jumps in orders of magnitude contribute equal progress.
 * Returns a clamped fraction from 0 to 1.
 */
export function riftObjectiveProgress(bestRarityValue: number, targetRarityValue: number): number {
  const start = 2;
  const best = Number.isFinite(Number(bestRarityValue)) ? Math.max(start, Number(bestRarityValue)) : start;
  const target = Number.isFinite(Number(targetRarityValue)) ? Math.max(start, Number(targetRarityValue)) : start;
  if (target <= start) return best >= target ? 1 : 0;
  const progress = Math.log(best / start) / Math.log(target / start);
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : (best >= target ? 1 : 0);
}

export const RIFT_CHALLENGE_UPGRADES: Record<RiftChallengeUpgradeId, RiftChallengeUpgradeDefinition> = {
  fortune: {
    name: 'Fortune Lens',
    description: '+12% effective Luck per level in this challenge.',
    mainRequirement: 'Reach Level 5 in the Rift',
    baseCost: 10, costGrowth: 1.42, maxLevel: 10,
  },
  speed: {
    name: 'Quickstep Coil',
    description: 'Reduces the challenge roll cooldown by 90ms per level.',
    mainRequirement: 'Reach Level 10 in the Rift',
    baseCost: 18, costGrowth: 1.48, maxLevel: 10,
  },
  prosperity: {
    name: 'Coin Converter',
    description: '+20% Coins earned per level in this challenge.',
    mainRequirement: 'Roll 25 Orbs in the Rift',
    baseCost: 14, costGrowth: 1.45, maxLevel: 10,
  },
  critical: {
    name: 'Critical Echo',
    description: '+1.5 percentage points of critical chance per level, up to 15%.',
    mainRequirement: 'Land 10 critical rolls in the Rift',
    baseCost: 55, costGrowth: 1.65, maxLevel: 10,
  },
};

export const RIFT_CHALLENGE_BASE_COOLDOWN_MS = 1_500;
export const RIFT_CHALLENGE_MIN_COOLDOWN_MS = 600;
export const RIFT_CHALLENGE_COOLDOWN_REDUCTION_PER_LEVEL_MS = 90;
export const RIFT_CHALLENGE_COST_TAX_PER_10_ROLLS = 0.05;
export const RIFT_CHALLENGE_MAX_COST_TAX = 0.5;
// Rift energy accrues continuously and is credited when the player next opens the Rift page or performs a Rift action.
export const RIFT_BASE_RATE_PER_HOUR = 1;

export interface RiftChallengeLastRoll {
  rarity: number;
  isCritical: boolean;
  coinsGained: number;
  rolledAt: number;
}

export interface RiftChallengeRun {
  runId: string;
  challengeId: RiftChallengeId;
  status: RiftChallengeRunStatus;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
  coins: number;
  totalRolls: number;
  bestRarity: number;
  nextRollAt: number;
  upgradeLevels: Record<RiftChallengeUpgradeId, number>;
  mainProgressAtStart: RiftChallengeMainProgress;
  mechanicUnlocks: RiftChallengeMechanicUnlocks;
  lastRoll: RiftChallengeLastRoll | null;
  /** Player-selected Temporal Drag setting, from ×1 to ×20. */
  temporalDragMultiplier: number;
  /** Minute boundary for the active run's compound Coin interest. */
  lastInterestAt: number;
  activeMutation: RiftMutationState | null;
  pendingMutationChoices: RiftMutationId[];
  lastMutationRoll: number;
  completedMutations: number;
  emergencyProtocolsUsed: number;
  emergencyProtocolUntilRoll: number;
  /** Relic loadout captured when this run starts. */
  equippedRelics: RiftRelicId[];
  /** Consumed on the next roll activation after a new Rift personal best. */
  fractureCascadePending: boolean;
  /** Complete, isolated main-game save used while this Rift challenge is active. */
  gameState?: PlayerState | null;
}

export interface RiftChallengeArchive {
  version: 4;
  activeRun: RiftChallengeRun | null;
  completedChallengeIds: string[];
  bestRarityByChallenge: Record<string, number>;
  totalCompletedRuns: number;
  riftPoints: number;
  /** Fractional progress toward the next whole Rift Point. */
  riftProgress: number;
  riftRatePerHour: number;
  riftLastAccruedAt: number;
  totalRiftPointsEarned: number;
  /** Last permanently completed challenge's Rift-game progression, independent of the active run. */
  riftPlayerProgress: RiftChallengeMainProgress | null;
  /** Timestamps of kudos received in the recent month, used for social reward counters. */
  kudosReceivedAt: number[];
  /** Most recent full-game open, used as the baseline for the session kudos counter. */
  lastGameOpenedAt: number;
  /** Number of Kudos received after the most recent game entry; snapshotted on the next entry. */
  kudosSinceLastOpen: number;
  /** Kudos received during the previous interval, displayed in the current game session. */
  kudosDisplaySinceLastOpen: number;
  riftPerkLevels: RiftPerkLevels;
  riftRelicLevels: RiftRelicLevels;
  equippedRiftRelics: RiftRelicId[];
}

export interface RiftChallengeSnapshot {
  /** Kept for older callers; the full catalog is in challenges. */
  challenge: typeof RIFT_FIRST_SPARK;
  challenges: typeof RIFT_CHALLENGES;
  archive: RiftChallengeArchive;
  mainProgress: RiftChallengeMainProgress;
  mechanicUnlocks: RiftChallengeMechanicUnlocks;
  challengeAvailable: boolean;
  kudosStats: { last24Hours: number; sinceLastOpen: number };
}

export function normalizeRiftMainProgress(value: Partial<RiftChallengeMainProgress> | null | undefined): RiftChallengeMainProgress {
  const integer = (raw: unknown, minimum = 0) => {
    const number = Number(raw);
    return Number.isSafeInteger(number) ? Math.max(minimum, number) : minimum;
  };
  return {
    level: integer(value?.level, 1),
    totalRolls: integer(value?.totalRolls),
    totalCrits: integer(value?.totalCrits),
    highestRarity: Math.max(2, Number.isFinite(Number(value?.highestRarity)) ? Number(value?.highestRarity) : 2),
    masteryPoints: integer(value?.masteryPoints),
  };
}

export function riftChallengeIsAvailable(mainProgress: Partial<RiftChallengeMainProgress> | null | undefined): boolean {
  return normalizeRiftMainProgress(mainProgress).level >= RIFT_FIRST_SPARK.requiredMainLevel;
}

export function riftChallengeMechanicUnlocks(
  mainProgress: Partial<RiftChallengeMainProgress> | null | undefined,
  earlyAuthorizationLevel = 0,
): RiftChallengeMechanicUnlocks {
  const progress = normalizeRiftMainProgress(mainProgress);
  const authorization = Math.max(0, Math.min(4, Math.floor(Number(earlyAuthorizationLevel) || 0)));
  return {
    fortune: progress.level >= 5 || authorization >= 1,
    speed: progress.level >= 10 || authorization >= 2,
    prosperity: progress.totalRolls >= 25 || authorization >= 3,
    critical: progress.totalCrits >= 10 || authorization >= 4,
  };
}

export function riftChallengeUpgradeCost(
  id: RiftChallengeUpgradeId,
  currentLevel: number,
  totalRolls: number,
): number {
  const definition = RIFT_CHALLENGE_UPGRADES[id];
  const level = Math.max(0, Math.min(definition.maxLevel, Math.floor(Number(currentLevel) || 0)));
  const rolls = Math.max(0, Math.floor(Number(totalRolls) || 0));
  const taxStacks = Math.min(
    RIFT_CHALLENGE_MAX_COST_TAX / RIFT_CHALLENGE_COST_TAX_PER_10_ROLLS,
    Math.floor(rolls / 10),
  );
  const taxMultiplier = 1 + taxStacks * RIFT_CHALLENGE_COST_TAX_PER_10_ROLLS;
  return Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.ceil(definition.baseCost * Math.pow(definition.costGrowth, level) * taxMultiplier),
  );
}

export function riftChallengeCooldownMs(speedLevel: number, baseCooldownMs = RIFT_CHALLENGE_BASE_COOLDOWN_MS): number {
  const level = Math.max(0, Math.min(RIFT_CHALLENGE_UPGRADES.speed.maxLevel, Math.floor(Number(speedLevel) || 0)));
  const base = Math.max(500, Math.floor(Number(baseCooldownMs) || RIFT_CHALLENGE_BASE_COOLDOWN_MS));
  return Math.max(500, base - level * RIFT_CHALLENGE_COOLDOWN_REDUCTION_PER_LEVEL_MS);
}

export function riftChallengeEffectiveLuck(fortuneLevel: number): number {
  const level = Math.max(0, Math.min(RIFT_CHALLENGE_UPGRADES.fortune.maxLevel, Math.floor(Number(fortuneLevel) || 0)));
  return 1 + level * 0.12;
}

export function riftChallengeCoinMultiplier(prosperityLevel: number): number {
  const level = Math.max(0, Math.min(RIFT_CHALLENGE_UPGRADES.prosperity.maxLevel, Math.floor(Number(prosperityLevel) || 0)));
  return 1 + level * 0.20;
}

export function riftChallengeCriticalChance(criticalLevel: number): number {
  const level = Math.max(0, Math.min(RIFT_CHALLENGE_UPGRADES.critical.maxLevel, Math.floor(Number(criticalLevel) || 0)));
  return Math.min(0.15, level * 0.015);
}

export function emptyRiftPerkLevels(): RiftPerkLevels {
  return {
    mainLuck: 0, mainCoins: 0, mainXp: 0,
    riftLuck: 0, riftSpeed: 0, riftYield: 0, riftStartCoins: 0,
    temporalArbitrage: 0, probabilityDebt: 0, temporalCompression: 0,
    fractureCascade: 0, echoChamber: 0, dimensionalInterest: 0,
    overkill: 0, singularityFocus: 0,
    bossResonance: 0, masteryBridge: 0, runeReconnection: 0,
    automationOverride: 0, chronoEngine: 0, combatIntegration: 0,
    initialCalibration: 0, preloadedBlueprint: 0, earlyAuthorization: 0,
    riftConditioning: 0, advancedDeployment: 0, fortuneReservoir: 0,
    criticalConversion: 0, fractureRecycling: 0, emergencyProtocol: 0,
    milestoneAmplifier: 0, anomalyHarvesting: 0, anomalyForecaster: 0,
    mutationStabilizer: 0, mutationAmplifier: 0, mutationExtraction: 0,
    anomalyPersistence: 0,
    timelineFork: 0,
  };
}

export function riftPerkCost(id: RiftPerkId, currentLevel: number): number {
  const definition = RIFT_PERKS[id];
  const level = Math.max(0, Math.min(definition.maxLevel, Math.floor(Number(currentLevel) || 0)));
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(definition.baseCost * Math.pow(definition.costGrowth, level)));
}

export const RIFT_TEMPORAL_DRAG_MAX = 20;
export const RIFT_TEMPORAL_DRAG_STEP = 0.5;

export function normalizeRiftTemporalDragMultiplier(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(RIFT_TEMPORAL_DRAG_MAX,
    Math.round(numeric / RIFT_TEMPORAL_DRAG_STEP) * RIFT_TEMPORAL_DRAG_STEP));
}

export function riftTemporalArbitrageMultiplier(timeMultiplier: number, levelValue: number): number {
  const level = Math.max(0, Math.min(RIFT_PERKS.temporalArbitrage.maxLevel, Math.floor(Number(levelValue) || 0)));
  return 1 + (normalizeRiftTemporalDragMultiplier(timeMultiplier) - 1) * level * 0.01;
}

export function riftTemporalCooldownMultiplier(timeMultiplier: number, levelValue: number): number {
  const level = Math.max(0, Math.min(RIFT_PERKS.temporalCompression.maxLevel, Math.floor(Number(levelValue) || 0)));
  const compression = Math.min(0.80, level * 0.04);
  return 1 + (normalizeRiftTemporalDragMultiplier(timeMultiplier) - 1) * (1 - compression);
}

export function riftProbabilityDebtMultiplier(failedRollsValue: number, levelValue: number): number {
  const failedRolls = Number.isFinite(Number(failedRollsValue))
    ? Math.max(0, Math.floor(Number(failedRollsValue)))
    : 0;
  const level = Math.max(0, Math.min(RIFT_PERKS.probabilityDebt.maxLevel, Math.floor(Number(levelValue) || 0)));
  if (level <= 0 || failedRolls <= 0) return 1;
  return 1 + failedRolls * level * 0.001 + Math.floor(failedRolls / 100) * level * 0.001;
}

export function riftFractureCascadeMultiplier(levelValue: number): number {
  const level = Math.max(0, Math.min(RIFT_PERKS.fractureCascade.maxLevel, Math.floor(Number(levelValue) || 0)));
  return 1 + level * 0.05;
}

export function riftFractureCascadeDuration(levelValue: number): number {
  const level = Math.max(0, Math.min(RIFT_PERKS.fractureCascade.maxLevel, Math.floor(Number(levelValue) || 0)));
  return level <= 0 ? 0 : 5 + level * 2;
}

export function riftEchoChamberChance(levelValue: number): number {
  const level = Math.max(0, Math.min(RIFT_PERKS.echoChamber.maxLevel, Math.floor(Number(levelValue) || 0)));
  return level * 0.01;
}

export function riftSingularityFocusMultiplier(bestRarityValue: number, targetRarityValue: number, levelValue: number): number {
  const level = Math.max(0, Math.min(RIFT_PERKS.singularityFocus.maxLevel, Math.floor(Number(levelValue) || 0)));
  const target = Math.max(2, Number(targetRarityValue) || 2);
  const best = Math.max(2, Number(bestRarityValue) || 2);
  if (level <= 0) return 1;
  const progress = riftObjectiveProgress(best, target);
  const fullStrength = progress < 0.90
    ? 1 + (progress / 0.90)
    : progress < 0.99
      ? 2 + ((progress - 0.90) / 0.09) * 3
      : 5;
  return 1 + (fullStrength - 1) * (level / RIFT_PERKS.singularityFocus.maxLevel);
}

export function riftOverkillRewardMultiplier(bestRarityValue: number, targetRarityValue: number, levelValue: number): number {
  const level = Math.max(0, Math.min(RIFT_PERKS.overkill.maxLevel, Math.floor(Number(levelValue) || 0)));
  const best = Math.max(2, Number(bestRarityValue) || 2);
  const target = Math.max(2, Number(targetRarityValue) || 2);
  if (level <= 0 || best <= target) return 1;
  const excessOrders = Math.max(0, Math.min(10, Math.log10(best / target)));
  return 1 + excessOrders * level * 0.10;
}

export function accrueRiftDimensionalInterest(
  coinsValue: unknown,
  lifetimeCoinsValue: unknown,
  lastInterestAtValue: unknown,
  startedAtValue: unknown,
  levelValue: number,
  nowValue = Date.now(),
): { coins: number; lifetimeCoins: number; lastInterestAt: number; minutesAccrued: number } {
  const safeBalance = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const startedAt = Number.isSafeInteger(Number(startedAtValue)) ? Math.max(0, Number(startedAtValue)) : 0;
  const lastInterestAt = Number.isSafeInteger(Number(lastInterestAtValue))
    ? Math.max(startedAt, Number(lastInterestAtValue))
    : startedAt;
  const now = Number.isSafeInteger(Number(nowValue)) ? Math.max(lastInterestAt, Number(nowValue)) : lastInterestAt;
  const level = Math.max(0, Math.min(RIFT_PERKS.dimensionalInterest.maxLevel, Math.floor(Number(levelValue) || 0)));
  const minutesAccrued = level > 0 ? Math.max(0, Math.floor((now - lastInterestAt) / 60_000)) : 0;
  const nextInterestAt = level > 0 ? lastInterestAt + minutesAccrued * 60_000 : now;
  if (minutesAccrued <= 0) {
    return {
      coins: safeBalance(coinsValue),
      lifetimeCoins: safeBalance(lifetimeCoinsValue),
      lastInterestAt: nextInterestAt,
      minutesAccrued,
    };
  }
  const factor = Math.pow(1 + level * 0.0025, minutesAccrued);
  const compound = (value: unknown) => {
    const amount = safeBalance(value) * factor;
    return Number.isFinite(amount) ? Math.max(0, amount) : Number.MAX_VALUE;
  };
  return {
    coins: compound(coinsValue),
    lifetimeCoins: compound(lifetimeCoinsValue),
    lastInterestAt: nextInterestAt,
    minutesAccrued,
  };
}

export function riftRatePerHour(completedChallengeIds: readonly string[], perkLevels: Partial<RiftPerkLevels> | null | undefined): number {
  const firstClearRate = RIFT_CHALLENGES.reduce(
    (sum, challenge) => sum + (completedChallengeIds.includes(challenge.id) ? challenge.rateBonusPerHour : 0),
    0,
  );
  const yieldLevel = Math.max(0, Math.min(RIFT_PERKS.riftYield.maxLevel, Math.floor(Number(perkLevels?.riftYield) || 0)));
  const rate = (RIFT_BASE_RATE_PER_HOUR + firstClearRate) * (1 + yieldLevel * 0.05);
  return Number.isFinite(rate) ? Math.max(RIFT_BASE_RATE_PER_HOUR, rate) : Number.MAX_SAFE_INTEGER;
}

export function createEmptyRiftChallengeArchive(now = Date.now()): RiftChallengeArchive {
  const riftPerkLevels = emptyRiftPerkLevels();
  return {
    version: 4,
    activeRun: null,
    completedChallengeIds: [],
    bestRarityByChallenge: {},
    totalCompletedRuns: 0,
    riftPoints: 0,
    riftProgress: 0,
    riftRatePerHour: RIFT_BASE_RATE_PER_HOUR,
    riftLastAccruedAt: Math.max(0, Math.floor(now)),
    totalRiftPointsEarned: 0,
    riftPlayerProgress: null,
    kudosReceivedAt: [],
    lastGameOpenedAt: Math.max(0, Math.floor(now)),
    kudosSinceLastOpen: 0,
    kudosDisplaySinceLastOpen: 0,
    riftPerkLevels,
    riftRelicLevels: {
      'clock-without-hands': 0, 'temporal-arbitrage': 0, 'unlucky-star': 0,
      observer: 0, 'loaded-die': 0, 'fracture-cascade': 0, 'mirror-array': 0,
      'stillness-engine': 0, 'rift-tithe': 0,
    },
    equippedRiftRelics: [],
  };
}

import type { RuneItem } from './runes.js';

export type CombatPage = 'fight' | 'dungeons' | 'gear' | 'forge' | 'skills' | 'arena';
export type CombatIntent = 'strike' | 'heavy' | 'guard' | 'mend';
export type CombatCommand = CombatIntent | 'auto' | 'ability';
export type CombatAbilityType = 'strike' | 'flurry' | 'mend' | 'focus' | 'bounty';
export const COMBAT_ABILITY_SLOTS = 3;
export const SKILL_GACHA_RANK_MAX = 30;
/** Server and client share the same cadence so Auto Fight never hammers rejected requests. */
export const COMBAT_BEAT_INTERVAL_MS = 30_000;
/** Maximum supported PvE depth; reaching it ends the descent instead of farming a capped room. */
export const COMBAT_MAX_DEPTH = 50_000;
export type CombatTactic = 'balanced' | 'aggressive' | 'defensive' | 'recovery';
export type CombatDungeonId = 'undercrypt' | 'cinder-vault' | 'glass-labyrinth';
export interface CombatAutoScrapSettings { enabled: boolean; maxQuality: number; }
export const DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS: CombatAutoScrapSettings = { enabled:false, maxQuality:20 };
export type CombatRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Mythic';
export type CombatSkillStat = 'damagePct' | 'speedFlat' | 'healthPct' | 'critChance' | 'coinBonus';
export type CombatUpgradeId = 'edge-training' | 'vitality' | 'precision' | 'scavenger' | 'orb-resonance';
export type CombatUpgradeStat = 'damagePct' | 'healthPct' | 'speedFlat' | 'critChance' | 'markBonus' | 'orbFocusPct';
export type CombatTrait = 'bleed' | 'keen' | 'first-strike' | 'bulwark' | 'regeneration' | 'desperation';
export type CombatGearSlot = 'weapon' | 'armor' | 'helmet' | 'gloves' | 'boots' | 'ring' | 'amulet';
export type CombatMajorAbility =
  | { id:'second-dawn'; name:string; trigger:'on-damage'; healPercent:number; description:string; }
  | { id:'chrono-surge'; name:string; trigger:'passive'; speedPercent:number; description:string; }
  | { id:'void-edge'; name:string; trigger:'passive'; damagePercent:number; description:string; }
  | { id:'aegis-ward'; name:string; trigger:'passive'; damageReduction:number; description:string; };
export interface CombatOrbRoll { rarity:number; tier:string; name:string; damageMultiplier:number; baseDamage:number; }

export interface CombatGear {
  id: string;
  name: string;
  slot: CombatGearSlot;
  quality: number;
  /** Zero-based floor/depth where this piece dropped; old saves are migrated on read. */
  sourceFloor: number;
  power: number;
  effect: string;
  trait: CombatTrait;
  damageBonus: number;
  speedBonus: number;
  maxHealthBonus: number;
  armorBonus: number;
  critChanceBonus: number;
  majorAbility?: CombatMajorAbility;
}
export type CombatSkillId =
  | 'ember-lung' | 'surefoot' | 'ironbark' | 'lucky-fang' | 'penny-hunter'
  | 'razor-current' | 'quicksilver' | 'deep-vitals' | 'execution-script' | 'bone-collector'
  | 'rift-hammer' | 'afterimage' | 'titan-blood' | 'fracture-math' | 'gilded-kill'
  | 'singularity-edge' | 'time-shear' | 'starforged-core' | 'apex-instinct' | 'royal-tithe'
  | 'infinity-cleaver' | 'chronos-heel' | 'worldheart' | 'annihilator' | 'infinite-bounty'
  | 'steady-hand' | 'coin-sense' | 'sunder-mark' | 'lightstep' | 'warden-slayer'
  | 'crystal-aegis' | 'blackstar-velocity' | 'astral-scavenger' | 'worldbreaker' | 'phoenix-engine';

export interface CombatSkillDefinition {
  id: CombatSkillId;
  name: string;
  rarity: CombatRarity;
  /** Determines the active ability archetype, not a passive stat bonus. */
  stat: CombatSkillStat;
  value: number;
  effect: string;
}

export function combatAbilityType(skill: Pick<CombatSkillDefinition, 'stat'>): CombatAbilityType {
  if (skill.stat === 'damagePct') return 'strike';
  if (skill.stat === 'speedFlat') return 'flurry';
  if (skill.stat === 'healthPct') return 'mend';
  if (skill.stat === 'critChance') return 'focus';
  return 'bounty';
}

export function combatSkillRankEffectiveness(rankValue: unknown): number {
  const rank = Number.isFinite(Number(rankValue)) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(rankValue)))) : 1;
  return 1 + Math.log2(rank + 1) * 0.25;
}

/** Copies needed to advance FROM the given rank; grows super-linearly without a hard rank cap. */
export function combatSkillCopiesForNextRank(rankValue: unknown): number {
  const rank = Number.isFinite(Number(rankValue)) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER - 1, Math.floor(Number(rankValue)))) : 1;
  const required = Math.ceil(Math.pow(rank + 1, 1.25));
  return Math.max(2, Math.min(Number.MAX_SAFE_INTEGER, Number.isFinite(required) ? required : Number.MAX_SAFE_INTEGER));
}

/** Extra flurry attacks scale by skill value (8 means +8% per bonus strike), capped at 2x. */
export function combatFlurryAttackMultiplier(value: unknown): number {
  const amount = Number(value);
  return 1 + (Number.isFinite(amount) ? Math.max(0, Math.min(100, amount)) : 0) / 100;
}

/** Keep flurry bonus strikes within the combat resolver's total-hit budget. */
export function combatEffectiveFlurryBonusAttacks(bonusValue: unknown, baseAttacksValue: unknown, maxTotalValue = 12): number {
  const rawBonus = Number(bonusValue), rawBase = Number(baseAttacksValue), rawMax = Number(maxTotalValue);
  const bonus = Number.isFinite(rawBonus) ? Math.max(0, Math.min(11, Math.floor(rawBonus))) : 0;
  const baseAttacks = Number.isFinite(rawBase) ? Math.max(1, Math.min(12, Math.floor(rawBase))) : 1;
  const maxTotal = Number.isFinite(rawMax) ? Math.max(1, Math.min(12, Math.floor(rawMax))) : 12;
  return Math.max(0, Math.min(bonus, maxTotal - baseAttacks));
}

/** Rank-scaled PvE bounty reward. Old Marks + Delver Coin rewards are merged into one Combat Marks amount. */
export function combatBountyReward(value: unknown, rankValue: unknown): number {
  const rawValue = Number(value);
  const skillValue = Number.isFinite(rawValue) ? Math.max(0, Math.min(1, rawValue)) : 0;
  const rawRank = Number(rankValue);
  const rank = Number.isFinite(rawRank) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(rawRank))) : 1;
  const baseMarks = Math.max(1, Math.round((3 + Math.log2(rank + 1) * 2) * (1 + skillValue * 3)));
  return Math.min(Number.MAX_SAFE_INTEGER, baseMarks * 11);
}

/** Energy actually available after the beat's one-point regeneration, respecting the cap. */
export function combatEnergyAfterRegen(energyValue: unknown, maxEnergyValue: unknown): number {
  const rawMax = Number(maxEnergyValue);
  const maxEnergy = Number.isFinite(rawMax) ? Math.max(1, Math.min(10, Math.floor(rawMax))) : 5;
  const rawEnergy = Number(energyValue);
  const energy = Number.isFinite(rawEnergy) ? Math.max(0, Math.min(maxEnergy, Math.floor(rawEnergy))) : 0;
  return Math.min(maxEnergy, energy + 1);
}

export function combatSkillEnergyCost(rarity: CombatRarity): number {
  return rarity === 'Common' || rarity === 'Uncommon' ? 2 : rarity === 'Rare' || rarity === 'Epic' ? 3 : 4;
}

export function combatSkillBaseCooldown(rarity: CombatRarity): number {
  return rarity === 'Common' ? 4 : rarity === 'Uncommon' ? 5 : rarity === 'Rare' ? 6 : rarity === 'Epic' ? 7 : 8;
}

export function combatSkillCooldown(rarity: CombatRarity, rankValue: unknown): number {
  const rank = Number.isFinite(Number(rankValue)) ? Math.max(1, Math.floor(Number(rankValue))) : 1;
  return Math.max(2, combatSkillBaseCooldown(rarity) - Math.floor(Math.log2(rank + 1) / 2));
}

export interface SkillGachaRankRequirement {
  rank: number;
  requiredPulls: number;
  requiredMarks: number;
  /** Description of how the rarity odds shift at this rank, not a hard rarity unlock. */
  unlocks: string;
}
export const SKILL_GACHA_RANK_REQUIREMENTS: SkillGachaRankRequirement[] = Array.from(
  { length: SKILL_GACHA_RANK_MAX - 1 },
  (_, index) => {
    const rank = index + 2;
    return {
      rank,
      requiredPulls: Math.round(3 * Math.pow(rank - 1, 1.55)),
      requiredMarks: Math.round(25 * Math.pow(rank - 1, 1.45)),
      unlocks: rank === SKILL_GACHA_RANK_MAX ? 'Mythic 0.50%; each other rarity 24.875%' : 'Improved higher-rarity odds',
    };
  },
);

export function skillGachaRankRequirement(currentRankValue: unknown): SkillGachaRankRequirement | null {
  const currentRank = Number.isFinite(Number(currentRankValue)) ? Math.max(1, Math.min(SKILL_GACHA_RANK_MAX, Math.floor(Number(currentRankValue)))) : 1;
  return SKILL_GACHA_RANK_REQUIREMENTS.find(requirement => requirement.rank === currentRank + 1) ?? null;
}

export interface CombatSkillRarityOdds { Common: number; Uncommon: number; Rare: number; Epic: number; Mythic: number; }
/** Rank 1 is all Common. At Rank 30, Mythic is 0.5% and each other tier is 24.875%. */
export function combatSkillRarityOdds(gachaRankValue: unknown): CombatSkillRarityOdds {
  const raw = Number(gachaRankValue);
  const rank = Number.isFinite(raw) ? Math.max(1, Math.min(SKILL_GACHA_RANK_MAX, Math.floor(raw))) : 1;
  const progress = (rank - 1) / (SKILL_GACHA_RANK_MAX - 1);
  const sharedTierOdds = 0.24875 * progress;
  return {
    Common: 1 - 0.75125 * progress,
    Uncommon: sharedTierOdds,
    Rare: sharedTierOdds,
    Epic: sharedTierOdds,
    Mythic: 0.005 * progress,
  };
}

export function skillRarityUnlocked(_rarity: CombatRarity, _gachaRankValue: unknown): boolean {
  // All rarities exist in the pool from Rank 1; rank controls their probabilities.
  return true;
}
export const COMBAT_SKILLS: CombatSkillDefinition[] = [
  { id:'ember-lung', name:'Ember Lung', rarity:'Common', stat:'damagePct', value:.025, effect:'+2.5% damage per rank' },
  { id:'surefoot', name:'Surefoot', rarity:'Common', stat:'speedFlat', value:8, effect:'+8 Speed per rank' },
  { id:'ironbark', name:'Ironbark', rarity:'Common', stat:'healthPct', value:.03, effect:'+3% max health per rank' },
  { id:'lucky-fang', name:'Lucky Fang', rarity:'Common', stat:'critChance', value:.01, effect:'+1 percentage point critical chance per rank' },
  { id:'penny-hunter', name:'Penny Hunter', rarity:'Common', stat:'coinBonus', value:.05, effect:'+5% Combat Marks per rank' },
  { id:'razor-current', name:'Razor Current', rarity:'Uncommon', stat:'damagePct', value:.04, effect:'+4% damage per rank' },
  { id:'quicksilver', name:'Quicksilver', rarity:'Uncommon', stat:'speedFlat', value:14, effect:'+14 Speed per rank' },
  { id:'deep-vitals', name:'Deep Vitals', rarity:'Uncommon', stat:'healthPct', value:.05, effect:'+5% max health per rank' },
  { id:'execution-script', name:'Execution Script', rarity:'Uncommon', stat:'critChance', value:.018, effect:'+1.8 percentage points critical chance per rank' },
  { id:'bone-collector', name:'Bone Collector', rarity:'Uncommon', stat:'coinBonus', value:.08, effect:'+8% Combat Marks per rank' },
  { id:'rift-hammer', name:'Rift Hammer', rarity:'Rare', stat:'damagePct', value:.065, effect:'+6.5% damage per rank' },
  { id:'afterimage', name:'Afterimage', rarity:'Rare', stat:'speedFlat', value:22, effect:'+22 Speed per rank' },
  { id:'titan-blood', name:'Titan Blood', rarity:'Rare', stat:'healthPct', value:.075, effect:'+7.5% max health per rank' },
  { id:'fracture-math', name:'Fracture Math', rarity:'Rare', stat:'critChance', value:.025, effect:'+2.5 percentage points critical chance per rank' },
  { id:'gilded-kill', name:'Gilded Kill', rarity:'Rare', stat:'coinBonus', value:.12, effect:'+12% Combat Marks per rank' },
  { id:'singularity-edge', name:'Singularity Edge', rarity:'Epic', stat:'damagePct', value:.09, effect:'+9% damage per rank' },
  { id:'time-shear', name:'Time Shear', rarity:'Epic', stat:'speedFlat', value:32, effect:'+32 Speed per rank' },
  { id:'starforged-core', name:'Starforged Core', rarity:'Epic', stat:'healthPct', value:.10, effect:'+10% max health per rank' },
  { id:'apex-instinct', name:'Apex Instinct', rarity:'Epic', stat:'critChance', value:.035, effect:'+3.5 percentage points critical chance per rank' },
  { id:'royal-tithe', name:'Royal Tithe', rarity:'Epic', stat:'coinBonus', value:.18, effect:'+18% Combat Marks per rank' },
  { id:'infinity-cleaver', name:'Infinity Cleaver', rarity:'Mythic', stat:'damagePct', value:.13, effect:'+13% damage per rank' },
  { id:'chronos-heel', name:'Chronos Heel', rarity:'Mythic', stat:'speedFlat', value:45, effect:'+45 Speed per rank' },
  { id:'worldheart', name:'Worldheart', rarity:'Mythic', stat:'healthPct', value:.15, effect:'+15% max health per rank' },
  { id:'annihilator', name:'Annihilator', rarity:'Mythic', stat:'critChance', value:.05, effect:'+5 percentage points critical chance per rank' },
  { id:'infinite-bounty', name:'Infinite Bounty', rarity:'Mythic', stat:'coinBonus', value:.25, effect:'+25% Combat Marks per rank' },
  { id:'steady-hand', name:'Steady Hand', rarity:'Common', stat:'critChance', value:.008, effect:'+0.8 percentage points critical chance per rank' },
  { id:'coin-sense', name:'Coin Sense', rarity:'Common', stat:'coinBonus', value:.03, effect:'+3% Combat Marks per rank' },
  { id:'sunder-mark', name:'Sunder Mark', rarity:'Uncommon', stat:'damagePct', value:.035, effect:'+3.5% damage per rank' },
  { id:'lightstep', name:'Lightstep', rarity:'Uncommon', stat:'speedFlat', value:12, effect:'+12 Speed per rank' },
  { id:'warden-slayer', name:'Warden Slayer', rarity:'Rare', stat:'damagePct', value:.08, effect:'+8% damage per rank' },
  { id:'crystal-aegis', name:'Crystal Aegis', rarity:'Rare', stat:'healthPct', value:.065, effect:'+6.5% max health per rank' },
  { id:'blackstar-velocity', name:'Blackstar Velocity', rarity:'Epic', stat:'speedFlat', value:36, effect:'+36 Speed per rank' },
  { id:'astral-scavenger', name:'Astral Scavenger', rarity:'Epic', stat:'coinBonus', value:.20, effect:'+20% Combat Marks per rank' },
  { id:'worldbreaker', name:'Worldbreaker', rarity:'Mythic', stat:'damagePct', value:.16, effect:'+16% damage per rank' },
  { id:'phoenix-engine', name:'Phoenix Engine', rarity:'Mythic', stat:'healthPct', value:.18, effect:'+18% max health per rank' },
];
export type CombatSkillLevels = Partial<Record<CombatSkillId, number>>;

export interface CombatUpgradeDefinition {
  id: CombatUpgradeId;
  name: string;
  description: string;
  stat: CombatUpgradeStat;
  value: number;
  baseCost: number;
  costMultiplier: number;
  maxRank: number;
}
export const COMBAT_UPGRADE_RANK_CAP = 10;
export const COMBAT_UPGRADES: CombatUpgradeDefinition[] = [
  { id:'edge-training', name:'Edge Training', description:'+4% damage per rank', stat:'damagePct', value:.04, baseCost:18, costMultiplier:1.55, maxRank:10 },
  { id:'vitality', name:'Delver Vitality', description:'+5% maximum HP per rank', stat:'healthPct', value:.05, baseCost:18, costMultiplier:1.55, maxRank:10 },
  { id:'precision', name:'Critical Calibration', description:'+1 percentage point critical chance per rank', stat:'critChance', value:.01, baseCost:25, costMultiplier:1.60, maxRank:10 },
  { id:'scavenger', name:'Battle Scavenger', description:'+8% Combat Marks from kills per rank', stat:'markBonus', value:.08, baseCost:28, costMultiplier:1.62, maxRank:10 },
  { id:'orb-resonance', name:'Orb Resonance', description:'+1.5% focused-orb combat power per rank', stat:'orbFocusPct', value:.015, baseCost:32, costMultiplier:1.65, maxRank:10 },
];
export type CombatUpgradeLevels = Partial<Record<CombatUpgradeId, number>>;

/** Floor 0 asks for no minimum quality; the curve reaches 60% at floor 50. */
export function floorQualityRequirement(floorValue: unknown): number {
  const floor = Number.isFinite(Number(floorValue)) ? Math.max(0, Math.min(COMBAT_MAX_DEPTH, Math.floor(Number(floorValue)))) : 0;
  return Math.round(Math.min(100, floor * 1.2) * 100) / 100;
}

/** Relative gear contribution compared with the quality expected at the current floor. */
export function gearQualityEffectiveness(item: Pick<CombatGear, 'quality'> | null | undefined, floorValue: unknown): number {
  if (!item) return 0;
  const requirement = floorQualityRequirement(floorValue);
  if (requirement <= 0) return 1;
  const quality = Number.isFinite(Number(item.quality)) ? Math.max(0, Math.min(100, Number(item.quality))) : 0;
  return Math.max(.15, Math.min(1.25, quality / requirement));
}

export function combatUpgradeRank(state: Pick<CombatState, 'combatUpgrades'>, id: CombatUpgradeId): number {
  return Math.max(0, Math.min(COMBAT_UPGRADE_RANK_CAP, Math.floor(Number(state.combatUpgrades?.[id]) || 0)));
}

export function combatUpgradeCost(state: Pick<CombatState, 'combatUpgrades'>, id: CombatUpgradeId): number {
  const upgrade = COMBAT_UPGRADES.find(entry => entry.id === id);
  if (!upgrade) throw new Error('Unknown combat upgrade.');
  return Math.round(upgrade.baseCost * Math.pow(upgrade.costMultiplier, combatUpgradeRank(state, id)));
}

/** Deterministic rarity helper keeps weighted odds and pity boundaries testable. */
export function resolveCombatSkillRarity(randomValue: number, gachaRankValue: number, pityEpic: number, pityMythic: number): CombatRarity {
  const chance = Number.isFinite(randomValue) ? Math.max(0, Math.min(.999999999, randomValue)) : 0;
  const rank = Number.isFinite(gachaRankValue) ? Math.max(1, Math.min(SKILL_GACHA_RANK_MAX, Math.floor(gachaRankValue))) : 1;
  if (rank >= 20 && pityMythic >= 39) return 'Mythic';
  if (rank >= 10 && pityEpic >= 9) return chance < .5 ? 'Epic' : 'Mythic';
  const odds = combatSkillRarityOdds(rank);
  let threshold = 0;
  for (const rarity of ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythic'] as const) {
    threshold += odds[rarity];
    if (chance < threshold || rarity === 'Mythic') return rarity;
  }
  return 'Common';
}

export interface CombatState {
  version: 1;
  runId: number;
  dungeonId: CombatDungeonId;
  dungeonBestDepths: Record<CombatDungeonId, number>;
  depth: number;
  bestDepth: number;
  level: number;
  xp: number;
  xpToNext: number;
  health: number;
  maxHealth: number;
  speed: number;
  baseDamage: number;
  /** Legacy saved field kept for migration compatibility; normalized to zero after wallet consolidation. */
  coins: number;
  /** Salvaged material used by the Forge. Shared across the three dungeon-specific gear bags. */
  scrap: number;
  /** Shared combat wallet: kill and ability rewards fund permanent upgrades and Skill Gacha pulls. */
  combatMarks: number;
  combatUpgrades: CombatUpgradeLevels;
  totalKills: number;
  skillRolls: number;
  /** Gacha station rank unlocks increasingly rare skill pools. */
  skillGachaRank: number;
  /** Pulls since the last Epic-or-better and Mythic skill, respectively. */
  skillPityEpic: number;
  skillPityMythic: number;
  /** Extra copies banked toward the next infinite rank for each skill. */
  skillCopyProgress: Partial<Record<CombatSkillId, number>>;
  /** Three-slot active-ability loadout; ownership alone does not activate a skill. */
  equippedAbilities: CombatSkillId[];
  /** Permanent monster drops, separate from gear and preserved across dungeon runs. */
  runes: RuneItem[];
  /** Three passively equipped Runes boost the main Orb-rolling game. */
  equippedRunes: string[];
  /** Cooldown expiry combat sequence for each equipped/owned ability. */
  abilityCooldowns: Partial<Record<CombatSkillId, number>>;
  /** Latest orb rolled in Infinity Orbs; it actively attunes combat stats. */
  orbFocusRarity: number;
  orbFocusName: string;
  sequence: number;
  /** Timestamp of the last accepted server combat beat; used to enforce cadence. */
  lastAcceptedBeatAtMs: number;
  combatBeats: number;
  playerActionsResolved: number;
  enemyActionsResolved: number;
  energy: number;
  maxEnergy: number;
  guardBeats: number;
  enemyHp: number;
  encounterFirstStrikeUsed: boolean;
  /** Delayed healing from a defensive gear ability; applied at the start of the next accepted beat. */
  pendingHealAmount: number;
  /** Persistent player-owned gear; survives deaths and dungeon switches. */
  inventory: CombatGear[];
  equipment: Record<CombatGearSlot, string | null>;
  /** Gear picked up during the current run; only these items count toward the run carrying cap. */
  runInventoryIds: string[];
  autoScrapUnlocked: boolean;
  autoScrapSettings: CombatAutoScrapSettings;
  skillLevels: CombatSkillLevels;
  arenaRating: number;
  arenaWins: number;
  arenaLosses: number;
  arenaLastChallengeAt: number;
  coreLevel: number;
  coreHighestRarity: number;
  autoTactic: CombatTactic;
}
export interface CombatStats {
  damage: number;
  speed: number;
  maxHealth: number;
  armor: number;
  critChance: number;
  damageReduction: number;
  coinMultiplier: number;
  coreProgressionBonus: number;
  orbFocusBonus: number;
  gearQualityRequirement: number;
}
export interface CombatEnemy {
  id: string; name: string; kind: 'common' | 'elite' | 'boss';
  hp: number; maxHp: number; damage: number; speed: number;
  room: string; emoji: string; boss: boolean;
}
export interface CombatAction {
  actor: 'player' | 'enemy';
  kind: 'attack' | 'ability' | 'death' | 'advance' | 'loot' | 'level';
  damage?: number;
  text: string;
}
export interface CombatSnapshot { state: CombatState; enemy: CombatEnemy; stats: CombatStats; }
export interface CombatArenaProfile {
  userId: string;
  username: string;
  level: number;
  bestDepth: number;
  rating: number;
  wins: number;
  losses: number;
  updatedAt: number;
  damage: number;
  speed: number;
  maxHealth: number;
  critChance: number;
  weaponName: string;
  armorName: string;
  skillRanks: number;
}
export interface CombatArenaResult {
  opponent: CombatArenaProfile;
  winner: 'you' | 'opponent';
  rounds: number;
  log: string[];
  ratingChange: number;
  opponentRatingChange: number;
  ratingAfter: number;
  opponentRatingAfter: number;
}
/** Quality is the item's rarity proxy. Even Mythic items only have a chance to roll a major ability. */
export function combatMajorAbilityChance(qualityValue:number):number {
  const quality=Number.isFinite(Number(qualityValue))?Math.max(0,Math.min(100,Number(qualityValue))):0;
  return quality>=90 ? .25 : quality>=70 ? .12 : quality>=40 ? .04 : quality>=15 ? .01 : .0025;
}

/** Damage multiplier for a fresh orb roll; higher rarity increases attack damage logarithmically. */
export function combatOrbDamageMultiplier(rarity:number):number {
  const safe=Number.isFinite(Number(rarity))?Math.max(2,Number(rarity)):2;
  return Math.max(1,Math.min(20,1+Math.log10(safe/2)));
}
/** Skills have no gameplay rank cap; storage is bounded by safe integer capacity. */
export const SKILL_RANK_CAP = Number.MAX_SAFE_INTEGER;
export const COMBAT_INVENTORY_CAP = 30;

function createCombatStarterGear(): { inventory: CombatGear[]; equipment: CombatState['equipment'] } {
  const weapon: CombatGear = { id:'starter-weapon', name:'Delver Knife', slot:'weapon', quality:35, sourceFloor:0, power:8, effect:'Adds +4 damage. Critical chance +4 percentage points.', trait:'keen', damageBonus:4, speedBonus:0, maxHealthBonus:0, armorBonus:0, critChanceBonus:0 };
  const armor: CombatGear = { id:'starter-armor', name:'Worn Leathers', slot:'armor', quality:28, sourceFloor:0, power:5, effect:'Adds +40 max HP and reduces incoming damage by 4%.', trait:'bulwark', damageBonus:0, speedBonus:0, maxHealthBonus:40, armorBonus:0, critChanceBonus:0 };
  return { inventory:[weapon,armor], equipment:{weapon:weapon.id,armor:armor.id,helmet:null,gloves:null,boots:null,ring:null,amulet:null} };
}

/** Each run can carry up to 30 newly acquired pieces; the owned inventory persists between runs. */
export function addCombatGearToInventory(state: CombatState, item: CombatGear, maxItems = COMBAT_INVENTORY_CAP): void {
  // Retried loot grants must not replace an owned item or count it twice.
  if (state.inventory.some(existing => existing.id === item.id)) return;

  // Keep both equipped pieces and the newest pickup safe even if a custom/test cap is supplied.
  const cap = Math.max(3, Math.floor(Number.isFinite(maxItems) ? maxItems : COMBAT_INVENTORY_CAP));
  state.inventory.unshift(item);
  const ownedIds = new Set(state.inventory.map(existing => existing.id));
  state.runInventoryIds = [...new Set((Array.isArray(state.runInventoryIds) ? state.runInventoryIds : []).filter(id => ownedIds.has(id)))];
  state.runInventoryIds.unshift(item.id);

  while (state.runInventoryIds.length > cap) {
    let removable = -1;
    for (let index = 0; index < state.runInventoryIds.length; index += 1) {
      const id = state.runInventoryIds[index];
      // Equipped pieces are permanent equipment, not disposable haul overflow.
      if (id === item.id || Object.values(state.equipment).includes(id)) continue;
      const current = state.inventory.find(existing => existing.id === id);
      if (!current) { removable = index; break; }
      if (removable < 0) { removable = index; continue; }
      const worst = state.inventory.find(existing => existing.id === state.runInventoryIds[removable]);
      if (!worst) { removable = index; continue; }
      const currentFloor = Number.isFinite(Number(current.sourceFloor)) ? Math.max(0, Math.floor(Number(current.sourceFloor))) : 0;
      const worstFloor = Number.isFinite(Number(worst.sourceFloor)) ? Math.max(0, Math.floor(Number(worst.sourceFloor))) : 0;
      const currentQuality = Number.isFinite(Number(current.quality)) ? Math.max(0, Math.min(100, Number(current.quality))) : 0;
      const worstQuality = Number.isFinite(Number(worst.quality)) ? Math.max(0, Math.min(100, Number(worst.quality))) : 0;
      if (currentFloor < worstFloor || (currentFloor === worstFloor && currentQuality < worstQuality) || (currentFloor === worstFloor && currentQuality === worstQuality && index > removable)) removable = index;
    }
    // Every equipped item and the newest pickup are protected from haul overflow.
    if (removable < 0) break;
    const [removedId] = state.runInventoryIds.splice(removable, 1);
    state.inventory = state.inventory.filter(existing => existing.id !== removedId);
  }

  const equipmentSlots:CombatGearSlot[]=['weapon','armor','helmet','gloves','boots','ring','amulet'];
  for (const slot of equipmentSlots) {
    const activeId = state.equipment[slot];
    if (activeId && state.inventory.some(g => g.id === activeId && g.slot === slot)) continue;
    const candidates = state.inventory.filter(g => g.slot === slot).sort((a,b) => b.power - a.power || b.quality - a.quality);
    state.equipment[slot] = candidates[0]?.id ?? null;
  }
}

/** A new run resets only the haul counter; owned gear and the equipped loadout are permanent. */
export function resetCombatRunCarry(state: Pick<CombatState, 'runInventoryIds'>): void {
  state.runInventoryIds = [];
}
export function combatScrapValue(item: Pick<CombatGear,'power'|'quality'|'sourceFloor'>): number {
  const power = Number.isFinite(Number(item.power)) ? Math.max(1, Math.min(1_000_000, Number(item.power))) : 1;
  const quality = Number.isFinite(Number(item.quality)) ? Math.max(0, Math.min(100, Number(item.quality))) : 0;
  const floor = Number.isFinite(Number(item.sourceFloor)) ? Math.max(0, Math.min(COMBAT_MAX_DEPTH, Number(item.sourceFloor))) : 0;
  return Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(4 + power * 0.6 + quality * 0.1 + Math.log10(floor + 1) * 2)));
}

export function combatForgeCost(floorValue: unknown): number {
  const floor = Number.isFinite(Number(floorValue)) ? Math.max(0, Math.min(COMBAT_MAX_DEPTH, Math.floor(Number(floorValue)))) : 0;
  return Math.max(10, Math.min(Number.MAX_SAFE_INTEGER, Math.round(10 + floor * 1.8)));
}

/** Exponential quality pricing; a 100.00% guarantee costs exactly 5,000,000 Scrap. */
export function combatForgeQualityCost(floorValue: unknown, qualityValue: unknown): number {
  const raw = Number(qualityValue);
  const quality = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw * 100) / 100)) : 0;
  const premium = Math.round(5_000_000 * Math.pow(quality / 100, 8));
  return Math.max(combatForgeCost(floorValue), Math.min(Number.MAX_SAFE_INTEGER, premium));
}

export function normalizeCombatAutoScrapSettings(value: unknown): CombatAutoScrapSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS };
  const raw = value as Record<string, unknown>;
  const quality = Number(raw.maxQuality);
  return {
    enabled: raw.enabled === true,
    maxQuality: Number.isFinite(quality) ? Math.round(Math.max(0, Math.min(100, quality)) * 100) / 100 : DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS.maxQuality,
  };
}

export const SKILL_PULL_BASE_COST = 75;
export function skillPullCost(_skillRolls: number): number {
  return SKILL_PULL_BASE_COST;
}
export function createCombatState(): CombatState {
  const starter = createCombatStarterGear();
  const state: CombatState = {
    version:1, runId:1, dungeonId:'undercrypt', dungeonBestDepths:{undercrypt:1,'cinder-vault':1,'glass-labyrinth':1}, depth:1, bestDepth:1,
    level:1, xp:0, xpToNext:100, health:1040, maxHealth:1040, speed:310,
    baseDamage:54, coins:0, scrap:0, combatMarks:250, combatUpgrades:{}, totalKills:0, skillRolls:0, skillGachaRank:1, skillPityEpic:0, skillPityMythic:0, skillCopyProgress:{}, equippedAbilities:[], runes:[], equippedRunes:[], abilityCooldowns:{}, orbFocusRarity:2, orbFocusName:'Common Orb', sequence:0, lastAcceptedBeatAtMs:0,
    combatBeats:0, playerActionsResolved:0, enemyActionsResolved:0,
    energy:3, maxEnergy:5, guardBeats:0, enemyHp:130,
    encounterFirstStrikeUsed:false, pendingHealAmount:0, inventory:starter.inventory,
    equipment:starter.equipment, runInventoryIds:[],
    autoScrapUnlocked:false,autoScrapSettings:{...DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS},skillLevels:{},
    arenaRating:1000, arenaWins:0, arenaLosses:0, arenaLastChallengeAt:0,
    coreLevel:1, coreHighestRarity:2, autoTactic:'balanced',
  };
  synchronizeCombatStats(state);
  state.enemyHp = getEnemyForDepth(1).maxHp;
  return state;
}
export function combatStatsFor(state: CombatState): CombatStats {
  const floor = Math.max(0, state.depth - 1);
  const equipmentSlots = Object.entries(state.equipment) as [CombatGearSlot,string|null][];
  const equippedItems = equipmentSlots.map(([slot,id]) => state.inventory.find(item => item.id === id && item.slot === slot)).filter((item):item is CombatGear=>Boolean(item));
  const qualityOf = (item:CombatGear) => gearQualityEffectiveness(item,floor);
  const effectiveDamageBonus=equippedItems.reduce((sum,item)=>sum+Math.round(item.damageBonus*qualityOf(item)),0);
  // Legacy saved speedBonus remains supported, but newly generated gear only grants turn speed through a Major Ability.
  // Ordinary affixes and legacy gear cannot grant turn speed; only Major Abilities do.
  const effectiveSpeedBonus=0;
  const majorSpeedPercent=equippedItems.reduce((sum,item)=>sum+(item.majorAbility?.id==='chrono-surge'?item.majorAbility.speedPercent*qualityOf(item):0),0);
  const majorDamagePercent=equippedItems.reduce((sum,item)=>sum+(item.majorAbility?.id==='void-edge'?item.majorAbility.damagePercent*qualityOf(item):0),0);
  const majorDamageReduction=equippedItems.reduce((sum,item)=>sum+(item.majorAbility?.id==='aegis-ward'?item.majorAbility.damageReduction*qualityOf(item):0),0);
  const effectiveHealthBonus=equippedItems.reduce((sum,item)=>sum+Math.round(item.maxHealthBonus*qualityOf(item)),0);
  const effectiveArmorBonus=equippedItems.reduce((sum,item)=>sum+Math.round(item.armorBonus*qualityOf(item)),0);
  const effectiveCritBonus=equippedItems.reduce((sum,item)=>sum+item.critChanceBonus*qualityOf(item),0);
  const traitEffectiveness=(trait:CombatTrait)=>equippedItems.filter(item=>item.trait===trait).reduce((best,item)=>Math.max(best,qualityOf(item)),0);
  // Acquired skills are equipped active abilities, not permanent passive-stat stacks.
  let damagePct=0, speedFlat=0, healthPct=0, critChance=.08, coinBonus=0;
  for (const upgrade of COMBAT_UPGRADES) {
    const rank = combatUpgradeRank(state, upgrade.id);
    if (!rank) continue;
    if (upgrade.stat === 'damagePct') damagePct += upgrade.value * rank;
    else if (upgrade.stat === 'healthPct') healthPct += upgrade.value * rank;
    else if (upgrade.stat === 'speedFlat') speedFlat += upgrade.value * rank;
    else if (upgrade.stat === 'critChance') critChance += upgrade.value * rank;
  }
  const gearQualityRequirement = floorQualityRequirement(floor);
  const orbRarity = Math.max(2, Math.min(1_000_000_000_000_000_000, Math.floor(Number(state.orbFocusRarity) || 2)));
  const orbFocusBonus = Math.min(.35, Math.max(0, (Math.log10(orbRarity) - Math.log10(2)) * .025 + combatUpgradeRank(state, 'orb-resonance') * .015));
  const coreProgressionBonus = coreProgressionCombatBonus(state.coreLevel, state.coreHighestRarity);
  const dungeonDamageBonus = state.dungeonId === 'cinder-vault' ? 0.10 : 0;
  const dungeonSpeedBonus = state.dungeonId === 'glass-labyrinth' ? 35 : 0;
  const dungeonCritBonus = state.dungeonId === 'glass-labyrinth' ? 0.05 : 0;
  const flatDamage = 50 + (Math.max(1,state.level)-1)*4 + effectiveDamageBonus;
  const flatHealth = 1000 + (Math.max(1,state.level)-1)*30 + effectiveHealthBonus;
  const maxHealth = Math.max(1,Math.round(flatHealth*(1+healthPct)*(1+coreProgressionBonus)*(1+orbFocusBonus*.65)));
  let speed = Math.round((310 + effectiveSpeedBonus + speedFlat + dungeonSpeedBonus) * (1 + majorSpeedPercent));
  if (traitEffectiveness('desperation')>0 && state.health>0 && state.health<=maxHealth*.4) speed+=Math.round(20*traitEffectiveness('desperation'));
  if (traitEffectiveness('keen')>0) critChance+=.04*traitEffectiveness('keen');
  critChance += effectiveCritBonus + dungeonCritBonus;
  const damageReduction = Math.min(.80, effectiveArmorBonus/250 + .04*traitEffectiveness('bulwark') + majorDamageReduction);
  return {
    damage:Math.max(1,Math.round(flatDamage*(1+damagePct)*(1+majorDamagePercent)*(1+coreProgressionBonus)*(1+dungeonDamageBonus)*(1+orbFocusBonus))),
    speed:Math.min(800,speed), maxHealth, armor:effectiveArmorBonus,
    critChance:Math.min(.75,Math.max(0,critChance)),
    damageReduction,
    coinMultiplier:1+coinBonus, coreProgressionBonus, orbFocusBonus, gearQualityRequirement,
  };
}
export function synchronizeCombatStats(state: CombatState): CombatStats {
  const stats=combatStatsFor(state);
  state.baseDamage=stats.damage; state.speed=stats.speed;
  const previousMax=Number(state.maxHealth)||stats.maxHealth;
  state.maxHealth=stats.maxHealth;
  if (!Number.isFinite(state.health)) state.health=state.maxHealth;
  state.health=Math.max(0,Math.min(state.maxHealth,state.health));
  if (previousMax<=0) state.health=state.maxHealth;
  state.maxEnergy=Math.max(1,Math.min(10,Math.floor(Number(state.maxEnergy)||5)));
  state.energy=Math.max(0,Math.min(state.maxEnergy,Math.floor(Number(state.energy)||0)));
  return stats;
}

export function combatMarkMultiplier(state: Pick<CombatState, 'combatUpgrades'>): number {
  return 1 + combatUpgradeRank(state, 'scavenger') * .08;
}

export interface CombatSkillCopyResult {
  rank: number;
  duplicate: boolean;
  /** Always false: rank progression is uncapped. Kept for callers migrating from the old 5-rank system. */
  maxRank: boolean;
  coinsRefunded: number;
  progress: number;
  copiesNeeded: number;
  rankedUp: boolean;
}

/** First copy unlocks Rank 1; subsequent copies bank toward increasingly expensive infinite ranks. */
export function applyCombatSkillCopy(
  state: CombatState,
  skillId: CombatSkillId,
  _pullCost: number,
): CombatSkillCopyResult {
  if (!COMBAT_SKILLS.some(candidate => candidate.id === skillId)) throw new Error('Unknown combat skill.');
  const oldRank = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(state.skillLevels[skillId]) || 0)));
  const duplicate = oldRank > 0;
  let rank = oldRank;
  let progress = Math.max(0, Math.floor(Number(state.skillCopyProgress[skillId]) || 0));
  let rankedUp = false;
  if (oldRank === 0) {
    rank = 1;
    state.skillLevels[skillId] = rank;
    state.skillCopyProgress[skillId] = 0;
    rankedUp = true;
  } else {
    const copiesNeeded = combatSkillCopiesForNextRank(oldRank);
    progress += 1;
    if (progress >= copiesNeeded && oldRank < Number.MAX_SAFE_INTEGER) {
      rank = oldRank + 1;
      progress = 0;
      state.skillLevels[skillId] = rank;
      rankedUp = true;
    }
    state.skillCopyProgress[skillId] = progress;
  }
  synchronizeCombatStats(state);
  return { rank, duplicate, maxRank: false, coinsRefunded: 0, progress, copiesNeeded: combatSkillCopiesForNextRank(rank), rankedUp };
}

export function getEnemyForDepth(depthValue: number): CombatEnemy {
  const depth=Math.max(1,Math.min(COMBAT_MAX_DEPTH,Math.floor(Number(depthValue)||1)));
  const encounters=[
    {id:'ash-husk',name:'Ash Husk',kind:'common' as const,hp:1,damage:1,speed:100,room:'Stone Gallery',emoji:'💀'},
    {id:'bone-rat',name:'Bone Rat',kind:'common' as const,hp:.72,damage:.72,speed:185,room:'Rat Warrens',emoji:'🐀'},
    {id:'ember-acolyte',name:'Ember Acolyte',kind:'elite' as const,hp:.9,damage:1.12,speed:125,room:'Cinder Chapel',emoji:'🔥'},
    {id:'ironbound',name:'Ironbound',kind:'elite' as const,hp:1.45,damage:.86,speed:80,room:'Ironworks',emoji:'⚙️'},
    {id:'grave-scout',name:'Grave Scout',kind:'common' as const,hp:1.02,damage:1.02,speed:175,room:'Broken Gallery',emoji:'🦴'},
    {id:'mire-witch',name:'Mire Witch',kind:'elite' as const,hp:1.15,damage:1.08,speed:110,room:'Drowned Vault',emoji:'🧙'},
    {id:'crypt-hound',name:'Crypt Hound',kind:'common' as const,hp:.96,damage:1.2,speed:215,room:'Hunt Hall',emoji:'🐺'},
    {id:'bell-knight',name:'Bell Knight',kind:'elite' as const,hp:1.55,damage:.98,speed:90,room:'Bell Nave',emoji:'🛡️'},
    {id:'ash-executioner',name:'Ash Executioner',kind:'elite' as const,hp:1.22,damage:1.3,speed:130,room:'Execution Yard',emoji:'🪓'},
  ];
  const boss=depth%10===0;
  const base=encounters[(depth-1)%encounters.length]!;
  const scaledHp=Math.min(1e12,Math.round(130*Math.pow(1.065,depth-1)*base.hp));
  const maxHp=boss?Math.round(scaledHp*1.15*4.6):scaledHp;
  const damage=Math.min(1e9,Math.max(1,Math.round((20+depth*1.55)*base.damage*(boss?2.2*1.15:1))));
  return {id:boss?'crypt-warden':base.id,name:boss?'Crypt Warden':base.name,kind:boss?'boss':base.kind,hp:maxHp,maxHp,damage,speed:Math.min(450,base.speed+Math.floor(depth/15)*25+(boss?55:0)),room:boss?'Warden Throne':base.room,emoji:boss?'👹':base.emoji,boss};
}


/** Each defeated Crypt Warden grants +1% effective Luck for main-game orb rolls, capped at +25%. */
export const UNDERCRYPT_ORB_LUCK_PER_WARDEN = 0.01;
export const UNDERCRYPT_ORB_LUCK_BONUS_CAP = 0.25;

export function undercryptWardensDefeated(bestDepthValue: unknown): number {
  const rawDepth = Number(bestDepthValue);
  const bestDepth = Number.isFinite(rawDepth) ? Math.max(1, Math.min(COMBAT_MAX_DEPTH, Math.floor(rawDepth))) : 1;
  return Math.min(
    Math.floor(UNDERCRYPT_ORB_LUCK_BONUS_CAP / UNDERCRYPT_ORB_LUCK_PER_WARDEN),
    Math.floor((bestDepth - 1) / 10),
  );
}

export function undercryptOrbLuckMultiplier(bestDepthValue: unknown): number {
  return 1 + undercryptWardensDefeated(bestDepthValue) * UNDERCRYPT_ORB_LUCK_PER_WARDEN;
}


export interface CombatArenaRatingUpdate {
  playerRating: number;
  opponentRating: number;
  playerChange: number;
  opponentChange: number;
}

/** Standard K=24 Elo update, bounded to keep stored ratings valid. */
export function calculateCombatArenaRatingUpdate(
  playerRatingValue: number,
  opponentRatingValue: number,
  playerWon: boolean,
): CombatArenaRatingUpdate {
  const playerBefore = Number.isFinite(playerRatingValue) ? Math.max(100, Math.min(10_000, Math.floor(playerRatingValue))) : 1000;
  const opponentBefore = Number.isFinite(opponentRatingValue) ? Math.max(100, Math.min(10_000, Math.floor(opponentRatingValue))) : 1000;
  const expectedPlayer = 1 / (1 + Math.pow(10, (opponentBefore - playerBefore) / 400));
  const score = playerWon ? 1 : 0;
  const rawChange = Math.round(24 * (score - expectedPlayer));
  // Transfer only rating points the winner can receive and the loser can give.
  // Independent clamps break zero-sum fairness at the 100/10,000 boundaries.
  const minimumTransfer = Math.max(100 - playerBefore, opponentBefore - 10_000);
  const maximumTransfer = Math.min(10_000 - playerBefore, opponentBefore - 100);
  const transfer = Math.max(minimumTransfer, Math.min(maximumTransfer, rawChange));
  const playerRating = playerBefore + transfer;
  const opponentRating = opponentBefore - transfer;
  return {
    playerRating,
    opponentRating,
    playerChange: playerRating - playerBefore,
    opponentChange: opponentRating - opponentBefore,
  };
}

/** Main-game progress boosts combat when the player enters Combat, without mutating the core save. */
export function coreProgressionCombatBonus(coreLevelValue: unknown, highestRarityValue: unknown): number {
  const rawLevel = Number(coreLevelValue);
  const level = Number.isFinite(rawLevel) ? Math.max(1, Math.min(1_000_000, Math.floor(rawLevel))) : 1;
  const rawRarity = Number(highestRarityValue);
  const rarity = Number.isFinite(rawRarity) ? Math.max(2, Math.min(1_000_000_000_000_000_000, rawRarity)) : 2;
  const levelBonus = Math.min(0.20, Math.floor((level - 1) / 10) * 0.02);
  const rarityBonus = Math.min(0.05, Math.max(0, Math.floor(Math.log10(rarity)) * 0.003));
  return Math.round((levelBonus + rarityBonus) * 10_000) / 10_000;
}


/** Choose an action from persisted health, energy, and tactic settings. */
export function chooseAutoCombatIntent(state: CombatState): CombatIntent {
  const maxHealth = Math.max(1, Number(state.maxHealth) || 1);
  const healthRatio = Math.max(0, Math.min(1, (Number(state.health) || 0) / maxHealth));
  const energy = Math.max(0, Math.min(10, Math.floor(Number(state.energy) || 0)));

  switch (state.autoTactic) {
    case 'aggressive':
      return energy >= 3 ? 'heavy' : 'strike';
    case 'defensive':
      if (healthRatio <= 0.70 && energy >= 4) return 'mend';
      if (healthRatio <= 0.45 && energy >= 2) return 'guard';
      return 'strike';
    case 'recovery':
      if (healthRatio <= 0.85 && energy >= 4) return 'mend';
      if (healthRatio <= 0.40 && energy >= 2) return 'guard';
      return energy >= 3 ? 'heavy' : 'strike';
    case 'balanced':
    default:
      if (healthRatio <= 0.35 && energy >= 4) return 'mend';
      if (healthRatio <= 0.18 && energy >= 2) return 'guard';
      return energy >= 3 ? 'heavy' : 'strike';
  }
}


export function getEnemyForDungeonDepth(dungeonValue: unknown, depth: number): CombatEnemy {
  const dungeon: CombatDungeonId =
    dungeonValue === 'cinder-vault' || dungeonValue === 'glass-labyrinth' ? dungeonValue : 'undercrypt';
  const base = getEnemyForDepth(depth);
  if (dungeon === 'undercrypt') return base;
  if (dungeon === 'cinder-vault') {
    const maxHp = Math.max(1, Math.round(base.maxHp * 1.35));
    return {
      ...base,
      id: base.boss ? 'cinder-sovereign' : base.id,
      name: base.boss ? 'Cinder Sovereign' : 'Cinder ' + base.name,
      hp: maxHp,
      maxHp,
      damage: Math.max(1, Math.round(base.damage * 1.25)),
      speed: Math.min(500, Math.round(base.speed * 1.08)),
      room: base.boss ? 'The Furnace Crown' : 'Cinder ' + base.room,
      emoji: base.boss ? '🌋' : base.emoji,
    };
  }
  const maxHp = Math.max(1, Math.round(base.maxHp * 0.78));
  return {
    ...base,
    id: base.boss ? 'prism-regent' : base.id,
    name: base.boss ? 'Prism Regent' : 'Prism ' + base.name,
    hp: maxHp,
    maxHp,
    damage: Math.max(1, Math.round(base.damage * 1.12)),
    speed: Math.min(600, Math.round(base.speed * 1.35)),
    room: base.boss ? 'Hall of Infinite Reflections' : 'Mirror ' + base.room,
    emoji: base.boss ? '🔮' : base.emoji,
  };
}

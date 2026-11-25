export type CombatPage = 'fight' | 'dungeons' | 'gear' | 'forge' | 'skills' | 'arena' | 'runes';
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


export type CombatRuneRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic' | 'Cosmic' | 'Astral' | 'Celestial' | 'Transcendent';
export type CombatRuneStat = 'luckPct' | 'coinGainPct' | 'shardChancePct' | 'xpGainPct';
export const COMBAT_RUNE_RARITIES: CombatRuneRarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Cosmic', 'Astral', 'Celestial', 'Transcendent'];
/** Cumulative cryptographic drop thresholds; each new tier is exactly 10× rarer than the previous one. */
export const COMBAT_RUNE_RARITY_ROLL_THRESHOLDS: Record<CombatRuneRarity, number> = {
  Common: 1,
  Uncommon: .3500555,
  Rare: .1200555,
  Epic: .0350555,
  Legendary: .0100555,
  Mythic: .0025555,
  Cosmic: .0005555,
  Astral: .0000555,
  Celestial: .0000055,
  Transcendent: .0000005,
};
export function combatRuneRarityFromRoll(value: unknown): CombatRuneRarity {
  const raw = Number(value);
  const roll = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
  for (const rarity of [...COMBAT_RUNE_RARITIES].reverse()) {
    if (roll < COMBAT_RUNE_RARITY_ROLL_THRESHOLDS[rarity]) return rarity;
  }
  return 'Common';
}
export interface CombatRuneAutoSacrificeSettings {
  enabled: boolean;
  maxRarity: CombatRuneRarity;
  /** A preferred equipped Rune to strengthen; null prefers an equipped Insight Rune, then the first equipped Rune. */
  targetRuneId: string | null;
  /** Keep donor Runes that have a Major Ability rather than sacrificing their special effect. */
  preserveSpecialEffects: boolean;
}
export const DEFAULT_COMBAT_RUNE_AUTO_SACRIFICE_SETTINGS: CombatRuneAutoSacrificeSettings = {
  enabled: false,
  maxRarity: 'Rare',
  targetRuneId: null,
  preserveSpecialEffects: true,
};
export function combatRuneRarityAtOrBelow(rarity: CombatRuneRarity, maxRarity: CombatRuneRarity): boolean {
  return COMBAT_RUNE_RARITIES.indexOf(rarity) >= 0 &&
    COMBAT_RUNE_RARITIES.indexOf(rarity) <= COMBAT_RUNE_RARITIES.indexOf(maxRarity);
}
/** Shared donor eligibility rule: preserve special-effect Runes by default. */
export function shouldAutoSacrificeRune(
  rune: Pick<CombatRune, 'rarity' | 'majorAbility'>,
  maxRarity: CombatRuneRarity,
  preserveSpecialEffects: boolean,
): boolean {
  return combatRuneRarityAtOrBelow(rune.rarity, maxRarity) &&
    !(preserveSpecialEffects && Boolean(rune.majorAbility));
}
export type CombatRuneMajorAbilityId =
  | 'fateweaver'
  | 'midas-engine'
  | 'memory-well'
  | 'echo-chamber'
  | 'paradox-engine'
  | 'event-horizon'
  | 'shard-constellation'
  | 'temporal-loop'
  | 'prismatic-fork'
  | 'critical-convergence'
  | 'rarity-ladder'
  | 'stellar-dividend'
  | 'shard-jackpot'
  | 'milestone-engine'
  | 'shard-tithe'
  | 'discovery-oracle'
  | 'dry-streak-refinery';
export interface CombatRuneMajorAbility {
  id: CombatRuneMajorAbilityId;
  name: string;
  /** Base effect percentage before the ability's slow Rune-level scaling. */
  valuePct: number;
  description: string;
}
export interface CombatRuneMajorAbilityEffects {
  echoChamberPct:number;
  echoChamberMaxChain:number;
  paradoxEnginePct:number;
  paradoxEngineBonusRolls:number;
  eventHorizonPct:number;
  eventHorizonBonusRolls:number;
  shardConstellationPct:number;
  shardConstellationBonusRolls:number;
  shardConstellationBonusShards:number;
  temporalLoopPct:number;
  temporalLoopMomentumPerRoll:number;
  temporalLoopBonusRolls:number;
  prismaticForkPct:number;
  criticalConvergencePct:number;
  criticalConvergenceBonusRolls:number;
  rarityLadderPct:number;
  rarityLadderBonusRolls:number;
  stellarDividendPct:number;
  stellarDividendBonusRolls:number;
  shardJackpotPct:number;
  shardJackpotExtraMultiplier:number;
  milestoneEnginePct:number;
  milestoneEngineBonusRolls:number;
  milestoneEngineBonusShards:number;
  shardTithePerRoll:number;
  discoveryOraclePct:number;
  discoveryOracleBonusRolls:number;
  dryStreakRefineryRate:number;
}
export interface CombatRune {
  id: string;
  name: string;
  rarity: CombatRuneRarity;
  stat: CombatRuneStat;
  /** Base percentage before the Rune's level multiplier is applied. */
  value: number;
  /** Rune level is derived from total Rune XP; legacy saves migrate from their saved level. */
  level?: number;
  /** Total lifetime XP, including XP spent to reach the current level. */
  experience?: number;
  sourceDepth: number;
  sourceDungeon: CombatDungeonId;
  /** Main-game-only perk; distinct from combat gear Major Abilities. */
  majorAbility?: CombatRuneMajorAbility;
}
export interface CombatRuneBonuses { luckPct: number; coinGainPct: number; shardChancePct: number; xpGainPct: number; }
export const COMBAT_RUNE_INVENTORY_CAP = 200;
/** Rune effects approach this multiplier asymptotically instead of growing without bound. */
export const COMBAT_RUNE_EFFECT_MULTIPLIER_CAP = 1_000_000;
const COMBAT_RUNE_RARITY_MULTIPLIER: Record<CombatRuneRarity, number> = {
  Common: 1, Uncommon: 1.35, Rare: 1.9, Epic: 2.8, Legendary: 4.4, Mythic: 7, Cosmic: 13,
  Astral: 20, Celestial: 30, Transcendent: 45,
};
const COMBAT_RUNE_BASE_VALUE: Record<CombatRuneStat, number> = {
  luckPct: .6, coinGainPct: 1.5, shardChancePct: .035, xpGainPct: 1.5,
};
const COMBAT_RUNE_MAJOR_ABILITY_CHANCE: Record<CombatRuneRarity, number> = {
  Common: .005, Uncommon: .02, Rare: .07, Epic: .18, Legendary: .35, Mythic: .50, Cosmic: .70,
  Astral: .80, Celestial: .90, Transcendent: .95,
};
const COMBAT_RUNE_MAJOR_ABILITY_QUALITY: Record<CombatRuneRarity, number> = {
  Common: 5, Uncommon: 25, Rare: 40, Epic: 60, Legendary: 75, Mythic: 90, Cosmic: 100,
  Astral: 100, Celestial: 100, Transcendent: 100,
};
const COMBAT_RUNE_MAJOR_ABILITY_MULTIPLIER: Record<CombatRuneRarity, number> = {
  Common: .5, Uncommon: .7, Rare: .85, Epic: 1, Legendary: 1.2, Mythic: 1.45, Cosmic: 1.8,
  Astral: 2.1, Celestial: 2.4, Transcendent: 2.8,
};
export function combatRuneMajorAbilityChance(rarity: CombatRuneRarity): number {
  return COMBAT_RUNE_MAJOR_ABILITY_CHANCE[rarity];
}
export function combatRuneMajorAbilityQuality(rarity: CombatRuneRarity): number {
  return COMBAT_RUNE_MAJOR_ABILITY_QUALITY[rarity];
}
export function combatRuneMajorAbilityMultiplier(rarity: CombatRuneRarity): number {
  return COMBAT_RUNE_MAJOR_ABILITY_MULTIPLIER[rarity];
}
export function combatRuneSlotsUnlocked(levelValue: unknown, bestDepthValue: unknown): number {
  const rawLevel = Number(levelValue);
  const rawBestDepth = Number(bestDepthValue);
  // Invalid/infinite client snapshots must not accidentally unlock progression.
  const level = Number.isFinite(rawLevel) ? Math.max(1, Math.floor(rawLevel)) : 1;
  const bestDepth = Number.isFinite(rawBestDepth) ? Math.max(1, Math.floor(rawBestDepth)) : 1;
  return 2 + (level >= 10 ? 1 : 0) + (level >= 25 ? 1 : 0) + (bestDepth >= 50 ? 1 : 0);
}
export function combatRuneValueFor(rarity: CombatRuneRarity, stat: CombatRuneStat, depthValue: unknown): number {
  if (!Object.prototype.hasOwnProperty.call(COMBAT_RUNE_BASE_VALUE, stat) ||
      !Object.prototype.hasOwnProperty.call(COMBAT_RUNE_RARITY_MULTIPLIER, rarity)) return 0;
  const rawDepth = Number(depthValue);
  const depth = Number.isFinite(rawDepth) ? Math.max(0, Math.floor(rawDepth)) : 0;
  const depthMultiplier = 1 + Math.min(.4, Math.log2(depth + 1) * .025);
  const decimals = stat === 'shardChancePct' ? 4 : 2;
  const factor = 10 ** decimals;
  const result = Math.round(COMBAT_RUNE_BASE_VALUE[stat] * COMBAT_RUNE_RARITY_MULTIPLIER[rarity] * depthMultiplier * factor) / factor;
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}
/** Converts the Rune's Luck percentage into a direct rarity multiplier. */
export function combatRuneLuckMultiplier(luckBonusPctValue: unknown): number {
  const raw=Number(luckBonusPctValue);
  const bonus=Number.isFinite(raw)?Math.max(0,raw):0;
  const multiplier=1+bonus/100;
  return Number.isFinite(multiplier)?multiplier:Number.MAX_VALUE;
}
/** Total XP needed to have reached a Rune level. Growth remains steep for a long progression curve. */
const MAX_RUNE_LEVEL_FROM_SAFE_XP = Math.floor(Math.pow((Number.MAX_SAFE_INTEGER - 1) / 100, 1 / 2.35)) + 1;
export function combatRuneExperienceForLevel(levelValue: unknown): number {
  const level = Number.isFinite(Number(levelValue))
    ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(levelValue))))
    : 1;
  if (level <= 1) return 0;
  if (level > MAX_RUNE_LEVEL_FROM_SAFE_XP) return Number.MAX_SAFE_INTEGER;
  const required = 100 * Math.pow(level - 1, 2.35);
  return Number.isFinite(required) ? Math.min(Number.MAX_SAFE_INTEGER - 1, Math.ceil(required)) : Number.MAX_SAFE_INTEGER;
}
/** Convert accumulated Rune XP into a level using a bounded binary search. */
export function combatRuneLevelFromExperience(experienceValue: unknown): number {
  const raw = Number(experienceValue);
  const xp = Number.isFinite(raw) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(raw))) : 0;
  // Once XP saturates, retain the highest distinguishable level rather than
  // treating every still-larger level as attained because its cost also saturated.
  if (xp >= Number.MAX_SAFE_INTEGER) return MAX_RUNE_LEVEL_FROM_SAFE_XP;
  let low = 1;
  let high = 2;
  while (high < Number.MAX_SAFE_INTEGER && combatRuneExperienceForLevel(high) <= xp) {
    low = high;
    high = Math.min(Number.MAX_SAFE_INTEGER, high * 2);
    if (high === low) return low;
  }
  while (low + 1 < high) {
    const mid = Math.floor(low + (high - low) / 2);
    if (combatRuneExperienceForLevel(mid) <= xp) low = mid;
    else high = mid;
  }
  return low;
}
/** Large rarity-weighted XP grant for consuming a Rune; deeper drops and higher-level donors are worth more. */
export function combatRuneSacrificeExperience(rune: Pick<CombatRune, 'rarity' | 'level' | 'sourceDepth'>): number {
  const base = ({ Common: 100, Uncommon: 250, Rare: 650, Epic: 1_700, Legendary: 4_500, Mythic: 12_000, Cosmic: 32_000, Astral: 320_000, Celestial: 3_200_000, Transcendent: 32_000_000 } as Record<string, number>)[String(rune.rarity)];
  if (!Number.isFinite(base) || base <= 0) return 1;
  const rawLevel = Number(rune.level);
  const level = Number.isFinite(rawLevel) ? Math.max(1, Math.floor(rawLevel)) : 1;
  const depth = Number.isFinite(Number(rune.sourceDepth)) ? Math.max(0, Math.floor(Number(rune.sourceDepth))) : 0;
  const depthMultiplier = 1 + Math.min(1.5, Math.log2(depth + 1) * 0.08);
  const raw = base * Math.pow(level, 1.25) * depthMultiplier;
  return Number.isFinite(raw) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.round(raw))) : Number.MAX_SAFE_INTEGER;
}
/** Rune benefits approach a generous soft cap; there is no abrupt level ceiling. */
export function combatRuneLevelMultiplier(levelValue: unknown): number {
  const level = Number.isFinite(Number(levelValue)) ? Math.max(1, Math.floor(Number(levelValue))) : 1;
  return 1 + (COMBAT_RUNE_EFFECT_MULTIPLIER_CAP - 1) * (1 - Math.exp(-(level - 1) / 1_500));
}
export function combatRuneScaledValue(rune: Pick<CombatRune, 'stat' | 'value' | 'level'>): number {
  const value = Number(rune.value);
  if (!Number.isFinite(value) || value <= 0) return 0;
  // Shard Rune values intentionally remain unchanged at every level.
  if (rune.stat === 'shardChancePct') return Math.min(100, value);
  const scaled = value * combatRuneLevelMultiplier(rune.level);
  return Number.isFinite(scaled) ? scaled : Number.MAX_VALUE;
}
function runePercentText(value: number, decimals: number): string {
  return value >= 1e21 ? value.toExponential(2) : value.toFixed(decimals);
}
export function combatRuneEffectText(rune: Pick<CombatRune, 'stat' | 'value' | 'level'>): string {
  const value = combatRuneScaledValue(rune);
  if (rune.stat === 'luckPct') return '+' + runePercentText(value, 2) + '% Orb Luck';
  if (rune.stat === 'coinGainPct') return '+' + runePercentText(value, 2) + '% Coins';
  if (rune.stat === 'shardChancePct') return '+' + runePercentText(value * 0.025, 5) + '% effective Shard chance';
  return '+' + runePercentText(value, 2) + '% XP';
}
/**
 * Existing economy-style Rune perks keep their established exponential scaling.
 * Trigger-style Major Abilities use a slower logarithmic curve so leveling makes
 * their mechanics stronger without turning a proc chance into an automatic proc.
 */
export function combatRuneMajorAbilityStrengthPct(
  ability:Pick<CombatRuneMajorAbility,'id'|'valuePct'>,
  levelValue:unknown,
  rarity:CombatRuneRarity,
):number {
  const raw=Number(ability.valuePct);
  // Rarity scales the starting Major Ability power before Rune-level progression.
  // This also upgrades already-saved Runes without rewriting their stored ability data.
  const value=Number.isFinite(raw)?Math.max(0,raw)*combatRuneMajorAbilityMultiplier(rarity):0;
  const level=Number.isFinite(Number(levelValue))?Math.max(1,Math.floor(Number(levelValue))):1;
  if(ability.id==='fateweaver'||ability.id==='midas-engine'||ability.id==='memory-well'){
    const scaled=value*combatRuneLevelMultiplier(level);
    return Number.isFinite(scaled)?Math.min(Number.MAX_VALUE,scaled):Number.MAX_VALUE;
  }
  const scaled=value*(1+Math.log2(level)*.12);
  return Number.isFinite(scaled)?Math.min(1_000_000,scaled):1_000_000;
}
function runeMajorBonusRollCount(strengthPct:number,level:number):number {
  return Math.min(10,Math.max(1,1+Math.floor(strengthPct/20)+Math.floor(Math.log2(level)/6)));
}
/** Render the actual proc mechanic in a Rune tooltip instead of a generic percentage. */
export function combatRuneMajorAbilitySummary(ability:CombatRuneMajorAbility,levelValue:unknown,rarity:CombatRuneRarity):string {
  const level=Number.isFinite(Number(levelValue))?Math.max(1,Math.floor(Number(levelValue))):1;
  const power=combatRuneMajorAbilityStrengthPct(ability,level,rarity);
  const pct=(value:number)=>String(Math.round(value*10)/10)+'%';
  const rolls=runeMajorBonusRollCount(power,level);
  switch(ability.id){
    case 'fateweaver':return '+'+power.toLocaleString(undefined,{maximumFractionDigits:2})+'% effective Luck on main-game rolls.';
    case 'midas-engine':return '+'+power.toLocaleString(undefined,{maximumFractionDigits:2})+'% Coins from main-game rolls.';
    case 'memory-well':return '+'+power.toLocaleString(undefined,{maximumFractionDigits:2})+'% XP from main-game rolls.';
    case 'echo-chamber':return pct(Math.min(45,power))+' chance per roll to echo; each echo can chain again at half the previous chance, up to '+Math.min(8,1+Math.floor(Math.log2(level)/4)+Math.floor(power/20))+' echoes.';
    case 'paradox-engine':return pct(Math.min(50,power))+' chance on a multi-roll activation to add '+rolls+' extra roll'+(rolls===1?'':'s')+'.';
    case 'event-horizon':return 'Every new all-time rarity record triggers a '+rolls+'-roll burst with a '+(1+Math.min(2,power/100)).toFixed(2)+'× minimum-rarity floor.';
    case 'shard-constellation':return 'Every '+Math.max(100,Math.floor(200/(1+power/100)))+' Shards found grants 1 bonus Shard and up to '+Math.min(2,rolls)+' bonus roll'+(Math.min(2,rolls)===1?'':'s')+'.';
    case 'temporal-loop':return 'Each roll adds '+(1+Math.min(9,power/10)).toFixed(2)+' Momentum, and long dry streaks accelerate charge; every 100 Momentum grants '+rolls+' bonus roll'+(rolls===1?'':'s')+'.';
    case 'prismatic-fork':return 'At rarity 1,000+, '+pct(Math.min(45,power))+' chance to fork a bonus roll with a '+(1+Math.min(2,power/100)).toFixed(2)+'× minimum-rarity floor.';
    case 'critical-convergence':return 'Critical rolls have a '+pct(Math.min(35,power))+' chance to create '+rolls+' extra roll'+(rolls===1?'':'s')+' with a rarity floor based on the critical result.';
    case 'rarity-ladder':return 'Three rising rarities in one activation trigger '+rolls+' bonus roll'+(rolls===1?'':'s')+' with a '+(1+Math.min(2,power/100)).toFixed(2)+'× rarity floor.';
    case 'stellar-dividend':return 'Every '+Math.max(20,Math.floor(100/(1+power/100)))+' lifetime rolls triggers '+rolls+' bonus roll'+(rolls===1?'':'s')+'.';
    case 'shard-jackpot':return pct(Math.min(.5,power/200))+' chance to double a Shard payout (maximum 2 Shards per Orb).';
    case 'milestone-engine':return 'A new all-time rarity milestone at a power of ten has a '+pct(Math.min(.25,power/400))+' chance to grant 1 bonus Shard and adds up to '+Math.min(2,rolls)+' rarity-floored bonus roll'+(Math.min(2,rolls)===1?'':'s')+'.';
    case 'shard-tithe':return Math.min(.0125,power/8000).toFixed(4)+'% chance to grant +1 whole Shard on each main-game roll.';
    case 'discovery-oracle':return pct(Math.min(20,power/5))+' chance for a first-time rarity discovery to grant '+rolls+' extra roll'+(rolls===1?'':'s')+' with the same rarity floor.';
    case 'dry-streak-refinery':return 'Each 100 rolls since your best rarity adds up to '+Math.min(.0125,power/80000).toFixed(4)+'% chance per roll to grant +1 whole Shard.';
  }
}
export function combatRuneMajorAbilityEffects(runesValue:unknown,equippedValue:unknown):CombatRuneMajorAbilityEffects {
  const effects:CombatRuneMajorAbilityEffects={
    echoChamberPct:0,echoChamberMaxChain:0,
    paradoxEnginePct:0,paradoxEngineBonusRolls:1,
    eventHorizonPct:0,eventHorizonBonusRolls:1,
    shardConstellationPct:0,shardConstellationBonusRolls:1,shardConstellationBonusShards:1,
    temporalLoopPct:0,temporalLoopMomentumPerRoll:0,temporalLoopBonusRolls:1,
    prismaticForkPct:0,
    criticalConvergencePct:0,criticalConvergenceBonusRolls:1,rarityLadderPct:0,rarityLadderBonusRolls:1,
    stellarDividendPct:0,stellarDividendBonusRolls:1,
    shardJackpotPct:0,shardJackpotExtraMultiplier:0,
    milestoneEnginePct:0,milestoneEngineBonusRolls:1,milestoneEngineBonusShards:1,
    shardTithePerRoll:0,discoveryOraclePct:0,discoveryOracleBonusRolls:1,dryStreakRefineryRate:0,
  };
  const equipped=new Set((Array.isArray(equippedValue)?equippedValue:[]).filter((id):id is string=>typeof id==='string'));
  if(!equipped.size||!Array.isArray(runesValue))return effects;
  const add=(current:number,extra:number)=>Math.min(1_000_000,current+Math.max(0,extra));
  for(const raw of runesValue){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    const rune=raw as Partial<CombatRune>;
    if(typeof rune.id!=='string'||!equipped.has(rune.id)||!rune.majorAbility||typeof rune.majorAbility!=='object'||
       !rune.rarity||!COMBAT_RUNE_RARITIES.includes(rune.rarity))continue;
    const ability=rune.majorAbility;
    if(!ability.id||!Number.isFinite(Number(ability.valuePct))||Number(ability.valuePct)<=0)continue;
    const level=Number.isFinite(Number(rune.level))?Math.max(1,Math.floor(Number(rune.level))):1;
    const power=combatRuneMajorAbilityStrengthPct(ability,level,rune.rarity);
    switch(ability.id){
      case 'echo-chamber':
        effects.echoChamberPct=add(effects.echoChamberPct,power);
        effects.echoChamberMaxChain=Math.max(effects.echoChamberMaxChain,Math.min(8,1+Math.floor(Math.log2(level)/4)+Math.floor(power/20)));
        break;
      case 'paradox-engine':
        effects.paradoxEnginePct=add(effects.paradoxEnginePct,power);
        effects.paradoxEngineBonusRolls=Math.max(effects.paradoxEngineBonusRolls,runeMajorBonusRollCount(power,level));
        break;
      case 'event-horizon':
        effects.eventHorizonPct=add(effects.eventHorizonPct,power);
        effects.eventHorizonBonusRolls=Math.max(effects.eventHorizonBonusRolls,runeMajorBonusRollCount(power,level));
        break;
      case 'shard-constellation':
        effects.shardConstellationPct=add(effects.shardConstellationPct,power);
        effects.shardConstellationBonusRolls=Math.max(effects.shardConstellationBonusRolls,Math.min(2,runeMajorBonusRollCount(power,level)));
        effects.shardConstellationBonusShards=1;
        break;
      case 'temporal-loop':
        effects.temporalLoopPct=add(effects.temporalLoopPct,power);
        effects.temporalLoopBonusRolls=Math.max(effects.temporalLoopBonusRolls,runeMajorBonusRollCount(power,level));
        break;
      case 'prismatic-fork':
        effects.prismaticForkPct=add(effects.prismaticForkPct,power);
        break;
      case 'critical-convergence':
        effects.criticalConvergencePct=add(effects.criticalConvergencePct,power);
        effects.criticalConvergenceBonusRolls=Math.max(effects.criticalConvergenceBonusRolls,runeMajorBonusRollCount(power,level));
        break;
      case 'rarity-ladder':
        effects.rarityLadderPct=add(effects.rarityLadderPct,power);
        effects.rarityLadderBonusRolls=Math.max(effects.rarityLadderBonusRolls,runeMajorBonusRollCount(power,level));
        break;
      case 'stellar-dividend':
        effects.stellarDividendPct=add(effects.stellarDividendPct,power);
        effects.stellarDividendBonusRolls=Math.max(effects.stellarDividendBonusRolls,runeMajorBonusRollCount(power,level));
        break;
      case 'shard-jackpot':
        effects.shardJackpotPct=add(effects.shardJackpotPct,power);
        effects.shardJackpotExtraMultiplier=1;
        break;
      case 'milestone-engine':
        effects.milestoneEnginePct=add(effects.milestoneEnginePct,power);
        effects.milestoneEngineBonusRolls=Math.max(effects.milestoneEngineBonusRolls,Math.min(2,runeMajorBonusRollCount(power,level)));
        effects.milestoneEngineBonusShards=1;
        break;
      case 'shard-tithe':
        effects.shardTithePerRoll=Math.min(.001,effects.shardTithePerRoll+Math.min(.00025,power/400000));
        break;
      case 'discovery-oracle':
        effects.discoveryOraclePct=add(effects.discoveryOraclePct,power);
        effects.discoveryOracleBonusRolls=Math.max(effects.discoveryOracleBonusRolls,runeMajorBonusRollCount(power,level));
        break;
      case 'dry-streak-refinery':
        effects.dryStreakRefineryRate=Math.min(.00025,effects.dryStreakRefineryRate+Math.min(.00025,power/4000000));
        break;
    }
  }
  effects.temporalLoopMomentumPerRoll=effects.temporalLoopPct>0?1+Math.min(9,effects.temporalLoopPct/10):0;
  return effects;
}
export function combatRuneBonuses(runesValue: unknown, equippedValue: unknown): CombatRuneBonuses {
  const bonuses: CombatRuneBonuses = { luckPct: 0, coinGainPct: 0, shardChancePct: 0, xpGainPct: 0 };
  const equipped = new Set((Array.isArray(equippedValue) ? equippedValue : []).filter((value): value is string => typeof value === 'string'));
  if (!equipped.size || !Array.isArray(runesValue)) return bonuses;
  const validStats = new Set<CombatRuneStat>(['luckPct', 'coinGainPct', 'shardChancePct', 'xpGainPct']);
  const safeAdd = (current: number, extra: number) => Math.min(Number.MAX_VALUE, current + Math.min(Number.MAX_VALUE, Math.max(0, extra)));
  for (const raw of runesValue) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rune = raw as Partial<CombatRune>;
    if (typeof rune.id !== 'string' || !equipped.has(rune.id) || !rune.stat || !validStats.has(rune.stat)) continue;
    const value = combatRuneScaledValue(rune as Pick<CombatRune, 'stat' | 'value' | 'level'>);
    if (value <= 0) continue;
    bonuses[rune.stat] = safeAdd(bonuses[rune.stat], rune.stat === 'shardChancePct' ? Math.min(100, value) : value);
    const ability = rune.majorAbility;
    if (ability && rune.rarity && COMBAT_RUNE_RARITIES.includes(rune.rarity) &&
        Number.isFinite(Number(ability.valuePct)) && Number(ability.valuePct) > 0 &&
        (ability.id === 'fateweaver' || ability.id === 'midas-engine' || ability.id === 'memory-well')) {
      const abilityValue = combatRuneMajorAbilityStrengthPct(ability, rune.level, rune.rarity);
      if (ability.id === 'fateweaver') bonuses.luckPct = safeAdd(bonuses.luckPct, abilityValue);
      else if (ability.id === 'midas-engine') bonuses.coinGainPct = safeAdd(bonuses.coinGainPct, abilityValue);
      else if (ability.id === 'memory-well') bonuses.xpGainPct = safeAdd(bonuses.xpGainPct, abilityValue);
    }
  }
  // Rune Shard chance contributes before the shared 0.25% primary-proc cap per Orb.
  bonuses.shardChancePct = Math.min(100, bonuses.shardChancePct);
  return bonuses;
}
export type CombatSkillStat = 'damagePct' | 'speedFlat' | 'healthPct' | 'critChance' | 'coinBonus';
export type CombatUpgradeId = 'edge-training' | 'vitality' | 'precision' | 'scavenger' | 'orb-resonance' | 'mark-magnet' | 'ward-training' | 'turn-timer';
export type CombatUpgradeStat = 'damagePct' | 'healthPct' | 'speedFlat' | 'critChance' | 'markBonus' | 'orbFocusPct' | 'damageReduction' | 'beatIntervalMs';
export type CombatTrait = 'bleed' | 'keen' | 'first-strike' | 'bulwark' | 'regeneration' | 'desperation';
export type CombatGearSlot = 'weapon' | 'armor' | 'helmet' | 'gloves' | 'boots' | 'ring' | 'amulet';
export type CombatMajorAbility =
  | { id:'second-dawn'; name:string; trigger:'on-damage'; healPercent:number; description:string; }
  | { id:'chrono-surge'; name:string; trigger:'passive'; speedPercent:number; description:string; }
  | { id:'void-edge'; name:string; trigger:'passive'; damagePercent:number; description:string; }
  | { id:'aegis-ward'; name:string; trigger:'passive'; damageReduction:number; description:string; }
  | { id:'starfall'; name:string; trigger:'passive'; critChanceBonus:number; description:string; }
  | { id:'mark-harvest'; name:string; trigger:'passive'; markBonusPercent:number; description:string; }
  | { id:'titan-heart'; name:string; trigger:'passive'; maxHealthPercent:number; description:string; }
  | { id:'blood-drinker'; name:string; trigger:'passive'; lifestealPercent:number; description:string; }
  | { id:'executioner'; name:string; trigger:'passive'; executeDamagePercent:number; description:string; }
  | { id:'emberwake'; name:string; trigger:'passive'; burnChance:number; burnDamagePercent:number; description:string; }
  | { id:'mirrorplate'; name:string; trigger:'passive'; reflectPercent:number; description:string; }
  | { id:'last-bastion'; name:string; trigger:'passive'; damageReduction:number; description:string; }
  | { id:'critical-mass'; name:string; trigger:'passive'; critDamageBonus:number; description:string; }
  | { id:'orb-conduit'; name:string; trigger:'passive'; orbDamagePercent:number; description:string; }
  | { id:'soul-harvest'; name:string; trigger:'passive'; healOnKillPercent:number; description:string; }
  | { id:'salvagers-touch'; name:string; trigger:'passive'; scrapBonusPercent:number; description:string; }
  | { id:'rune-savant'; name:string; trigger:'passive'; runeDropBonusPercent:number; description:string; }
  | { id:'bossbreaker'; name:string; trigger:'passive'; bossDamagePercent:number; description:string; }
  | { id:'echo-fang'; name:string; trigger:'passive'; echoChance:number; echoDamagePercent:number; description:string; }
  | { id:'phase-shift'; name:string; trigger:'passive'; evadeChance:number; description:string; }
  | { id:'blood-moon'; name:string; trigger:'passive'; lowHealthDamagePercent:number; description:string; }
  | { id:'deep-roots'; name:string; trigger:'passive'; damagePerTenLevelsPercent:number; description:string; }
  | { id:'frostbrand'; name:string; trigger:'passive'; damageReduction:number; description:string; }
  | { id:'aegis-pulse'; name:string; trigger:'passive'; shieldOnHitPercent:number; description:string; }
  | { id:'glass-cannon'; name:string; trigger:'passive'; damagePercent:number; damageTakenPercent:number; description:string; }
  | { id:'fortune-engine'; name:string; trigger:'passive'; critMarkBonusPercent:number; description:string; }
  | { id:'unending-ward'; name:string; trigger:'passive'; shieldOnKillPercent:number; description:string; }
  | { id:'full-moon'; name:string; trigger:'passive'; critChanceBonus:number; description:string; }
  | { id:'unstable-singularity'; name:string; trigger:'passive'; burstChance:number; burstDamagePercent:number; description:string; }
  | { id:'genesis-core'; name:string; trigger:'passive'; regenPercent:number; description:string; }
  | { id:'expanded-reserves'; name:string; trigger:'passive'; maxEnergyFlat:number; description:string; }
  | { id:'third-beat-recharge'; name:string; trigger:'passive'; energyPerThreeTurns:number; description:string; };

export const COMBAT_MAJOR_ABILITY_IDS = [
  'second-dawn',
  'chrono-surge',
  'void-edge',
  'aegis-ward',
  'starfall',
  'mark-harvest',
  'titan-heart',
  'blood-drinker',
  'executioner',
  'emberwake',
  'mirrorplate',
  'last-bastion',
  'critical-mass',
  'orb-conduit',
  'soul-harvest',
  'salvagers-touch',
  'rune-savant',
  'bossbreaker',
  'echo-fang',
  'phase-shift',
  'blood-moon',
  'deep-roots',
  'frostbrand',
  'aegis-pulse',
  'glass-cannon',
  'fortune-engine',
  'unending-ward',
  'full-moon',
  'unstable-singularity',
  'genesis-core',
  'expanded-reserves',
  'third-beat-recharge'
] as const;
export interface CombatOrbRoll { rarity:number; tier:string; name:string; isInfinity?:boolean; damageMultiplier:number; baseDamage:number; }

export interface CombatGear {
  id: string;
  name: string;
  slot: CombatGearSlot;
  quality: number;
  /** Internal zero-based depth index where this item dropped; the UI presents it as a 1-based Level. */
  sourceFloor: number;
  power: number;
  effect: string;
  trait: CombatTrait;
  damageBonus: number;
  speedBonus: number;
  /** Roll used to trade other stat budget for Speed; absent on pre-update saves. */
  speedInvestmentRoll?: number;
  maxHealthBonus: number;
  armorBonus: number;
  critChanceBonus: number;
  majorAbility?: CombatMajorAbility;
}

/** A steep quality curve makes the high-end gear grades genuinely scarce. */
export const COMBAT_GEAR_QUALITY_EXPONENT = 16;
export function combatGearQualityFromRoll(randomValue: unknown): number {
  const raw = Number(randomValue);
  const roll = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  return Math.round(10_000 * Math.pow(roll, COMBAT_GEAR_QUALITY_EXPONENT)) / 100;
}
export function combatGearRarityForQuality(qualityValue: unknown): CombatRarity {
  const raw = Number(qualityValue);
  const quality = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  return quality >= 90 ? 'Mythic' : quality >= 70 ? 'Epic' : quality >= 40 ? 'Rare' : quality >= 15 ? 'Uncommon' : 'Common';
}
export function combatGearRarityOdds(): Record<CombatRarity, number> {
  const cdf = (quality: number) => Math.pow(quality / 100, 1 / COMBAT_GEAR_QUALITY_EXPONENT);
  return { Common:cdf(15), Uncommon:cdf(40)-cdf(15), Rare:cdf(70)-cdf(40), Epic:cdf(90)-cdf(70), Mythic:1-cdf(90) };
}
/** Nonlinear gear budget: perfect quality has five times the depth baseline power. */
export function combatGearStatBudgetMultiplier(qualityValue: unknown): number {
  const raw = Number(qualityValue);
  const quality = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) / 100 : 0;
  return 0.35 + 4.65 * Math.pow(quality, 2.4);
}
/** Every slot can invest 8%-40% of its power budget in Speed. */
function normalizedCombatGearSpeedRoll(rollValue: unknown): number {
  const raw = Number(rollValue);
  return Number.isFinite(raw) ? Math.max(0, Math.min(0.999999999, raw)) : 0;
}
export function combatGearSpeedShare(rollValue: unknown): number {
  return 0.08 + 0.32 * normalizedCombatGearSpeedRoll(rollValue);
}
/** High-Speed rolls spend up to 30% of the item's other stat budget on Speed. */
export function combatGearOtherStatMultiplier(rollValue: unknown): number {
  return 1 - normalizedCombatGearSpeedRoll(rollValue) * 0.30;
}
export function combatGearSpeedBonus(_slot: CombatGearSlot, powerValue: unknown, rollValue: unknown): number {
  const p = Number(powerValue);
  const power = Number.isFinite(p) ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(p))) : 1;
  return Math.max(1, Math.round(power * combatGearSpeedShare(rollValue)));
}

export function combatNextBeatDelayMs(
  nowValue: unknown,
  lastAcceptedValue: unknown,
  bufferMs = 150,
  intervalMsValue: unknown = COMBAT_BEAT_INTERVAL_MS,
): number {
  const now = Number(nowValue), lastAccepted = Number(lastAcceptedValue);
  if (!Number.isFinite(now) || now < 0 || !Number.isFinite(lastAccepted) || lastAccepted <= 0) return 0;
  const buffer = Number.isFinite(Number(bufferMs)) ? Math.max(0, Number(bufferMs)) : 150;
  const rawInterval = Number(intervalMsValue);
  const interval = Number.isFinite(rawInterval)
    ? Math.max(1_000, Math.min(COMBAT_BEAT_INTERVAL_MS, Math.floor(rawInterval)))
    : COMBAT_BEAT_INTERVAL_MS;
  return Math.max(0, lastAccepted + interval - now + buffer);
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
export function combatTurnsCrossedThree(previousValue: unknown, currentValue: unknown): number {
  const previousRaw=Number(previousValue), currentRaw=Number(currentValue);
  const previous=Number.isFinite(previousRaw)?Math.max(0,Math.floor(previousRaw)):0;
  const current=Number.isFinite(currentRaw)?Math.max(0,Math.floor(currentRaw)):0;
  return Math.max(0,Math.floor(current/3)-Math.floor(previous/3));
}
export function combatEnergyAfterRegen(energyValue: unknown, maxEnergyValue: unknown): number {
  const rawMax = Number(maxEnergyValue);
  const maxEnergy = Number.isFinite(rawMax) ? Math.max(1, Math.min(50, Math.floor(rawMax))) : 5;
  const rawEnergy = Number(energyValue);
  const energy = Number.isFinite(rawEnergy) ? Math.max(0, Math.min(maxEnergy, Math.floor(rawEnergy))) : 0;
  return Math.min(maxEnergy, energy + 1);
}
/** Legacy threshold constant retained for older saved/test compatibility; live combat uses Speed charge. */
export const COMBAT_SPEED_PER_ACTION = 400;

/** Legacy fixed-threshold action helper; live combat uses combatTurnStep for one action per beat. */
export function combatActionsDue(speedValue: unknown, beatValue: unknown, resolvedValue: unknown, maxActionsValue = 100): number {
  const speedRaw = Number(speedValue), beatRaw = Number(beatValue), resolvedRaw = Number(resolvedValue);
  const speed = Number.isFinite(speedRaw) ? Math.max(0, speedRaw) : 0;
  const beats = Number.isFinite(beatRaw) ? Math.max(0, Math.floor(beatRaw)) : 0;
  const resolved = Number.isFinite(resolvedRaw) ? Math.max(0, Math.floor(resolvedRaw)) : 0;
  const rawLimit = Number(maxActionsValue);
  const limit = Number.isFinite(rawLimit) ? Math.max(0, Math.min(1000, Math.floor(rawLimit))) : 100;
  const earnedBonusActions = Math.floor(Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.max(0, (beats - 1) * speed / COMBAT_SPEED_PER_ACTION),
  ));
  const target = speed > 0 && beats > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, beats + earnedBonusActions)
    : 0;
  return Math.max(0, Math.min(limit, target - resolved));
}


/** A single scheduled action. Each accepted combat beat resolves one turn slot. */
export interface CombatActionTimelineEntry {
  actor: 'player' | 'enemy';
  /** Zero-based action number for this actor within the accepted combat beat. */
  actionIndex: number;
  /** Whole-number slot offset; the scheduled turn itself starts at 0. */
  time: number;
}

export interface CombatTurnStep {
  actor: 'player' | 'enemy';
  /** Progress toward the next player action, normalized to 0..1. */
  playerSpeedCharge: number;
  /** Progress toward the next enemy action, normalized to 0..1. */
  enemySpeedCharge: number;
}

/**
 * Advance both Speed clocks to the next ready action, then consume exactly that action.
 * Charge is carried between beats. A tie favors the Delver, so 300 Speed versus 100 Speed
 * produces player, player, player, enemy. Enemy charge is reset when a foe is replaced;
 * player charge is preserved so a kill never grants a free extra turn.
 */
export function combatTurnStep(
  playerSpeedValue: unknown,
  enemySpeedValue: unknown,
  playerChargeValue: unknown,
  enemyChargeValue: unknown,
): CombatTurnStep {
  const safeSpeed = (value: unknown): number => {
    const raw = Number(value);
    return Number.isFinite(raw) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(raw))) : 0;
  };
  const safeCharge = (value: unknown): number => {
    const raw = Number(value);
    return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  };
  const playerSpeed = safeSpeed(playerSpeedValue);
  const enemySpeed = safeSpeed(enemySpeedValue);
  let playerCharge = safeCharge(playerChargeValue);
  let enemyCharge = safeCharge(enemyChargeValue);

  if (playerSpeed <= 0 && enemySpeed <= 0) {
    return { actor: 'player', playerSpeedCharge: 0, enemySpeedCharge: 0 };
  }

  const playerTime = playerSpeed > 0 ? Math.max(0, 1 - playerCharge) / playerSpeed : Number.POSITIVE_INFINITY;
  const enemyTime = enemySpeed > 0 ? Math.max(0, 1 - enemyCharge) / enemySpeed : Number.POSITIVE_INFINITY;
  const elapsed = Math.min(playerTime, enemyTime);
  if (Number.isFinite(elapsed)) {
    playerCharge = Math.min(1, playerCharge + elapsed * playerSpeed);
    enemyCharge = Math.min(1, enemyCharge + elapsed * enemySpeed);
  }

  // Charge may reach 1 for both actors at the same instant. Consume the player's turn
  // first and leave the enemy ready for the following whole-number combat beat.
  const playerReady = playerSpeed > 0 && playerCharge >= 1 - 1e-9;
  const enemyReady = enemySpeed > 0 && enemyCharge >= 1 - 1e-9;
  const actor: CombatTurnStep['actor'] = playerReady ? 'player' : enemyReady ? 'enemy' : playerSpeed > 0 ? 'player' : 'enemy';
  if (actor === 'player' && playerReady) playerCharge = Math.max(0, playerCharge - 1);
  else if (actor === 'enemy' && enemyReady) enemyCharge = Math.max(0, enemyCharge - 1);
  return { actor, playerSpeedCharge: playerCharge, enemySpeedCharge: enemyCharge };
}

/** Convenience helper when only the next actor, not the updated charge, is needed. */
export function combatNextActor(
  playerSpeedValue: unknown,
  enemySpeedValue: unknown,
  playerChargeValue: unknown,
  enemyChargeValue: unknown,
): CombatTurnStep['actor'] {
  return combatTurnStep(playerSpeedValue, enemySpeedValue, playerChargeValue, enemyChargeValue).actor;
}

/**
 * Compatibility wrapper for turn previews. `time` is always an integer slot (zero here);
 * it is not a fractional beat. Action counts indicate which actor slots are available.
 */
export function combatActionTimeline(
  playerSpeedValue: unknown,
  enemySpeedValue: unknown,
  _turnValue: unknown,
  playerChargeValue: unknown,
  enemyChargeValue: unknown,
  playerActionsValue: unknown,
  enemyActionsValue: unknown,
  _enemyTurnValue: unknown = _turnValue,
): CombatActionTimelineEntry[] {
  const hasPlayerAction = Number.isFinite(Number(playerActionsValue)) && Number(playerActionsValue) > 0;
  const hasEnemyAction = Number.isFinite(Number(enemyActionsValue)) && Number(enemyActionsValue) > 0;
  if (!hasPlayerAction && !hasEnemyAction) return [];
  const actor = combatNextActor(playerSpeedValue, enemySpeedValue, playerChargeValue, enemyChargeValue);
  if (actor === 'player' ? !hasPlayerAction : !hasEnemyAction) return [];
  return [{ actor, actionIndex: 0, time: 0 }];
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
      unlocks: rank === SKILL_GACHA_RANK_MAX ? 'Common 50%; Uncommon 30%; Rare 14.5%; Epic 5%; Mythic 0.5%' : 'Improved higher-rarity odds',
    };
  },
);

export function skillGachaRankRequirement(currentRankValue: unknown): SkillGachaRankRequirement | null {
  const currentRank = Number.isFinite(Number(currentRankValue)) ? Math.max(1, Math.min(SKILL_GACHA_RANK_MAX, Math.floor(Number(currentRankValue)))) : 1;
  return SKILL_GACHA_RANK_REQUIREMENTS.find(requirement => requirement.rank === currentRank + 1) ?? null;
}

export interface CombatSkillRarityOdds { Common: number; Uncommon: number; Rare: number; Epic: number; Mythic: number; }

/**
 * The Gacha starts with Common-only draws, then gradually introduces each
 * rarity tier. Mythic remains rare, capped at 0.5% even at max rank. Between
 * anchor ranks, odds interpolate smoothly and every row sums to 100%.
 */
const SKILL_GACHA_ODDS_ANCHORS: Array<{ rank: number; odds: CombatSkillRarityOdds }> = [
  { rank: 1, odds: { Common: 1, Uncommon: 0, Rare: 0, Epic: 0, Mythic: 0 } },
  { rank: 2, odds: { Common: 0.98, Uncommon: 0.02, Rare: 0, Epic: 0, Mythic: 0 } },
  { rank: 3, odds: { Common: 0.93, Uncommon: 0.065, Rare: 0.005, Epic: 0, Mythic: 0 } },
  { rank: 5, odds: { Common: 0.82, Uncommon: 0.16, Rare: 0.02, Epic: 0, Mythic: 0 } },
  { rank: 8, odds: { Common: 0.70, Uncommon: 0.22, Rare: 0.07, Epic: 0.01, Mythic: 0 } },
  { rank: 12, odds: { Common: 0.60, Uncommon: 0.28, Rare: 0.10, Epic: 0.0195, Mythic: 0.0005 } },
  { rank: 18, odds: { Common: 0.55, Uncommon: 0.28, Rare: 0.14, Epic: 0.0285, Mythic: 0.0015 } },
  { rank: 24, odds: { Common: 0.52, Uncommon: 0.29, Rare: 0.145, Epic: 0.042, Mythic: 0.003 } },
  { rank: 30, odds: { Common: 0.50, Uncommon: 0.30, Rare: 0.145, Epic: 0.05, Mythic: 0.005 } },
];

export function combatSkillRarityOdds(gachaRankValue: unknown): CombatSkillRarityOdds {
  const raw = Number(gachaRankValue);
  const rank = Number.isFinite(raw)
    ? Math.max(1, Math.min(SKILL_GACHA_RANK_MAX, Math.floor(raw)))
    : 1;

  const finalAnchor = SKILL_GACHA_ODDS_ANCHORS[SKILL_GACHA_ODDS_ANCHORS.length - 1]!;
  if (rank >= finalAnchor.rank) return { ...finalAnchor.odds };

  for (let index = 1; index < SKILL_GACHA_ODDS_ANCHORS.length; index += 1) {
    const upper = SKILL_GACHA_ODDS_ANCHORS[index]!;
    if (rank > upper.rank) continue;
    const lower = SKILL_GACHA_ODDS_ANCHORS[index - 1]!;
    const progress = (rank - lower.rank) / (upper.rank - lower.rank);
    const interpolate = (rarity: keyof CombatSkillRarityOdds) =>
      lower.odds[rarity] + (upper.odds[rarity] - lower.odds[rarity]) * progress;
    return {
      Common: interpolate('Common'),
      Uncommon: interpolate('Uncommon'),
      Rare: interpolate('Rare'),
      Epic: interpolate('Epic'),
      Mythic: interpolate('Mythic'),
    };
  }

  return { ...finalAnchor.odds };
}

export function skillRarityUnlocked(rarity: CombatRarity, gachaRankValue: unknown): boolean {
  const raw = Number(gachaRankValue);
  const rank = Number.isFinite(raw)
    ? Math.max(1, Math.min(SKILL_GACHA_RANK_MAX, Math.floor(raw)))
    : 1;
  const unlockRank: Record<CombatRarity, number> = {
    Common: 1,
    Uncommon: 2,
    Rare: 3,
    Epic: 6,
    Mythic: 9,
  };
  return rank >= unlockRank[rarity];
}
export const COMBAT_SKILLS: CombatSkillDefinition[] = [
  { id:'ember-lung', name:'Ember Lung', rarity:'Common', stat:'damagePct', value:.025, effect:"Applies Burn for several beats; each tick deals rank-scaled damage before your next attack." },
  { id:'surefoot', name:'Surefoot', rarity:'Common', stat:'speedFlat', value:8, effect:"Launches a quick combo of weakened bonus strikes and evades the next enemy hit." },
  { id:'ironbark', name:'Ironbark', rarity:'Common', stat:'healthPct', value:.03, effect:"Raises a personal shield that absorbs incoming damage; shield strength grows with rank." },
  { id:'lucky-fang', name:'Lucky Fang', rarity:'Common', stat:'critChance', value:.01, effect:"Your opening hit is a guaranteed critical strike with extra critical damage." },
  { id:'penny-hunter', name:'Penny Hunter', rarity:'Common', stat:'coinBonus', value:.05, effect:"Places a bounty on the target. Defeating it grants bonus Combat Marks." },
  { id:'razor-current', name:'Razor Current', rarity:'Uncommon', stat:'damagePct', value:.04, effect:"Pierces defenses with a heavy strike and leaves the target exposed to follow-up attacks." },
  { id:'quicksilver', name:'Quicksilver', rarity:'Uncommon', stat:'speedFlat', value:14, effect:"Unleashes a rapid flurry of weakened hits, respecting the 12-hit combat cap." },
  { id:'deep-vitals', name:'Deep Vitals', rarity:'Uncommon', stat:'healthPct', value:.05, effect:"Restores a portion of maximum HP and recovers 1 Energy." },
  { id:'execution-script', name:'Execution Script', rarity:'Uncommon', stat:'critChance', value:.018, effect:"Marks the target; attacks gain a finisher bonus once it falls below 25% HP." },
  { id:'bone-collector', name:'Bone Collector', rarity:'Uncommon', stat:'coinBonus', value:.08, effect:"Your next kill grants bonus Delver XP." },
  { id:'rift-hammer', name:'Rift Hammer', rarity:'Rare', stat:'damagePct', value:.065, effect:"Smashes enemy defenses, applying a strong armor break and a heavy impact." },
  { id:'afterimage', name:'Afterimage', rarity:'Rare', stat:'speedFlat', value:22, effect:"Replays part of your previous hit as delayed damage on your next beat." },
  { id:'titan-blood', name:'Titan Blood', rarity:'Rare', stat:'healthPct', value:.075, effect:"Leeches a share of the damage dealt by this cast as HP." },
  { id:'fracture-math', name:'Fracture Math', rarity:'Rare', stat:'critChance', value:.025, effect:"Against an armor-broken enemy, guarantees a critical hit and magnifies its damage." },
  { id:'gilded-kill', name:'Gilded Kill', rarity:'Rare', stat:'coinBonus', value:.12, effect:"Critical hits during this cast also mint bonus Combat Marks." },
  { id:'singularity-edge', name:'Singularity Edge', rarity:'Epic', stat:'damagePct', value:.09, effect:"Releases stored attack energy into a burst; ordinary attacks slowly charge the reserve." },
  { id:'time-shear', name:'Time Shear', rarity:'Epic', stat:'speedFlat', value:32, effect:"Cancels one enemy action when possible and shortens other skill cooldowns." },
  { id:'starforged-core', name:'Starforged Core', rarity:'Epic', stat:'healthPct', value:.10, effect:"Creates a shield that retaliates against a portion of incoming damage." },
  { id:'apex-instinct', name:'Apex Instinct', rarity:'Epic', stat:'critChance', value:.035, effect:"If this beat's Orb is at least 1 in 1,000, delivers an empowered critical strike." },
  { id:'royal-tithe', name:'Royal Tithe', rarity:'Epic', stat:'coinBonus', value:.18, effect:"Empowers Combat Mark rewards from your next three kills." },
  { id:'infinity-cleaver', name:'Infinity Cleaver', rarity:'Mythic', stat:'damagePct', value:.13, effect:"Deals a powerful cut, with a devastating finisher bonus below 30% enemy HP." },
  { id:'chronos-heel', name:'Chronos Heel', rarity:'Mythic', stat:'speedFlat', value:45, effect:"Shortens other equipped abilities' cooldowns and strikes immediately." },
  { id:'worldheart', name:'Worldheart', rarity:'Mythic', stat:'healthPct', value:.15, effect:"Restores HP and reinforces you with an additional shield." },
  { id:'annihilator', name:'Annihilator', rarity:'Mythic', stat:'critChance', value:.05, effect:"Damage grows with missing enemy HP, putting pressure on wounded foes." },
  { id:'infinite-bounty', name:'Infinite Bounty', rarity:'Mythic', stat:'coinBonus', value:.25, effect:"Pays Combat Marks now and grows a capped bounty streak for future kills." },
  { id:'steady-hand', name:'Steady Hand', rarity:'Common', stat:'critChance', value:.008, effect:"Steadies the strike for bonus damage and restores 1 Energy." },
  { id:'coin-sense', name:'Coin Sense', rarity:'Common', stat:'coinBonus', value:.03, effect:"Converts a share of damage dealt by this cast into immediate Combat Marks." },
  { id:'sunder-mark', name:'Sunder Mark', rarity:'Uncommon', stat:'damagePct', value:.035, effect:"Shreds the target's guard for several beats, increasing follow-up damage." },
  { id:'lightstep', name:'Lightstep', rarity:'Uncommon', stat:'speedFlat', value:12, effect:"Evades the next incoming hit and gains 1 Energy." },
  { id:'warden-slayer', name:'Warden Slayer', rarity:'Rare', stat:'damagePct', value:.08, effect:"Deals greatly increased damage to bosses while remaining useful against ordinary foes." },
  { id:'crystal-aegis', name:'Crystal Aegis', rarity:'Rare', stat:'healthPct', value:.065, effect:"Converts missing HP into a large, capped protective barrier." },
  { id:'blackstar-velocity', name:'Blackstar Velocity', rarity:'Epic', stat:'speedFlat', value:36, effect:"Turns a temporal burst into hard-hitting bonus strikes." },
  { id:'astral-scavenger', name:'Astral Scavenger', rarity:'Epic', stat:'coinBonus', value:.20, effect:"Improves the next eligible Rune drop chance; boss Rune guarantees remain unchanged." },
  { id:'worldbreaker', name:'Worldbreaker', rarity:'Mythic', stat:'damagePct', value:.16, effect:"Adds a capped burst of damage based on the enemy's maximum HP." },
  { id:'phoenix-engine', name:'Phoenix Engine', rarity:'Mythic', stat:'healthPct', value:.18, effect:"Arms a once-per-encounter survival spark that prevents one lethal hit." },
];
export type CombatSkillLevels = Partial<Record<CombatSkillId, number>>;

export interface CombatSkillRuntime {
  burnTicks:number; burnDamage:number; armorBreakBeats:number; shield:number;
  delayedDamage:number; delayedDamageReadyAtSequence:number; lastAttackDamage:number; storedDamage:number;
  executeMarked:boolean; evadeNext:boolean; phoenixReady:boolean; phoenixUsed:boolean;
  nextKillMarkBonus:number; nextKillXpBonus:number; royalTitheKills:number; bountyStreak:number; nextRuneDropBonus:number;
}
export function createCombatSkillRuntime():CombatSkillRuntime {
  return {burnTicks:0,burnDamage:0,armorBreakBeats:0,shield:0,delayedDamage:0,delayedDamageReadyAtSequence:0,lastAttackDamage:0,storedDamage:0,
    executeMarked:false,evadeNext:false,phoenixReady:false,phoenixUsed:false,nextKillMarkBonus:0,nextKillXpBonus:0,royalTitheKills:0,bountyStreak:0,nextRuneDropBonus:0};
}
export interface StrategyGuideRankDefinition {rank:number;name:string;description:string;manualCost:number;markCost:number;}
export const STRATEGY_GUIDE_RANKS:StrategyGuideRankDefinition[]=[
  {rank:1,name:'Intent Awareness',description:'Auto Fight can use equipped skills and make basic decisions from current combat state.',manualCost:1,markCost:0},
  {rank:2,name:'Survival Management',description:'Prioritizes recovery and protection when health is low.',manualCost:0,markCost:1000},
  {rank:3,name:'Ability Planning',description:'Prefers setup effects before compatible follow-up skills.',manualCost:0,markCost:4000},
  {rank:4,name:'Equipment Synergy',description:'Uses the current loadout and active debuffs to select more useful skills.',manualCost:1,markCost:12000},
  {rank:5,name:'Adaptive Tactics',description:'Adapts skill priorities to health, boss encounters, active effects, and the selected tactic.',manualCost:1,markCost:30000},
];
/** Manual drop rate falls with Strategy Guide rank; there is no fixed pity override. */
export function tacticianManualDropChance(rankValue:unknown):number {
  const rank=Number.isFinite(Number(rankValue))?Math.max(0,Math.min(STRATEGY_GUIDE_RANKS.length,Math.floor(Number(rankValue)))):0;
  return [0.025,0.02,0.015,0.01,0.0075,0.005][rank]??0;
}


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
  { id:'edge-training', name:'Edge Training', description:'+4% damage per rank', stat:'damagePct', value:.04, baseCost:23, costMultiplier:1.55, maxRank:10 },
  { id:'vitality', name:'Delver Vitality', description:'+5% maximum HP per rank', stat:'healthPct', value:.05, baseCost:23, costMultiplier:1.55, maxRank:10 },
  { id:'precision', name:'Critical Calibration', description:'+1 percentage point critical chance per rank', stat:'critChance', value:.01, baseCost:32, costMultiplier:1.60, maxRank:10 },
  { id:'scavenger', name:'Battle Scavenger', description:'+8% Combat Marks from kills per rank', stat:'markBonus', value:.08, baseCost:35, costMultiplier:1.62, maxRank:10 },
  { id:'orb-resonance', name:'Orb Resonance', description:'+1.5% focused-orb combat power per rank', stat:'orbFocusPct', value:.015, baseCost:40, costMultiplier:1.65, maxRank:10 },
  { id:'mark-magnet', name:'Mark Magnet', description:'+10% Combat Marks from kills per rank', stat:'markBonus', value:.10, baseCost:60, costMultiplier:1.68, maxRank:10 },
  { id:'ward-training', name:'Warding Doctrine', description:'+1.5 percentage points damage reduction per rank', stat:'damageReduction', value:.015, baseCost:52, costMultiplier:1.65, maxRank:10 },
  { id:'turn-timer', name:'Turn Timer', description:'−1 second from the combat beat timer per rank', stat:'beatIntervalMs', value:1_000, baseCost:80, costMultiplier:1.75, maxRank:10 },
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
export function resolveCombatSkillRarity(randomValue: number, gachaRankValue: number, _legacyPityEpic = 0, _legacyPityMythic = 0): CombatRarity {
  const chance = Number.isFinite(randomValue) ? Math.max(0, Math.min(.999999999, randomValue)) : 0;
  const rank = Number.isFinite(gachaRankValue) ? Math.max(1, Math.min(SKILL_GACHA_RANK_MAX, Math.floor(gachaRankValue))) : 1;
  // Skill Gacha has no pity system: every pull uses the visible rank-weighted odds.
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
  /** Lifetime boss clears per dungeon; survives deaths and dungeon switches. */
  dungeonBossesBeaten: Record<CombatDungeonId, number>;
  depth: number;
  bestDepth: number;
  /** True when the final supported depth has been cleared; prevents repeat farming. */
  depthCapCleared?: boolean;
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
  /** Persistent monster drops that improve the core orb-rolling game while equipped. */
  runes: CombatRune[];
  equippedRunes: string[];
  /** Auto-sacrifice only consumes un-equipped Runes and feeds XP into a random equipped Rune. */
  runeAutoSacrifice: CombatRuneAutoSacrificeSettings;
  /** Persisted server-side so the Combat tutorial is only shown once per player. */
  combatTutorialSeen: boolean;
  combatUpgrades: CombatUpgradeLevels;
  totalKills: number;
  skillRolls: number;
  skillRuntime:CombatSkillRuntime;
  strategyGuideRank:number;
  tacticianManuals:number;
  /** Gacha station rank unlocks increasingly rare skill pools. */
  skillGachaRank: number;
  /** Pulls since the last Epic-or-better and Mythic skill, respectively. */
  skillPityEpic: number;
  skillPityMythic: number;
  /** Extra copies banked toward the next infinite rank for each skill. */
  skillCopyProgress: Partial<Record<CombatSkillId, number>>;
  /** Three-slot active-ability loadout; ownership alone does not activate a skill. */
  equippedAbilities: CombatSkillId[];
  /** Cooldown expiry combat sequence for each equipped/owned ability. */
  abilityCooldowns: Partial<Record<CombatSkillId, number>>;
  /** Latest orb rolled in Infinity Orbs; it actively attunes combat stats. */
  orbFocusRarity: number;
  orbFocusName: string;
  sequence: number;
  /** Timestamp of the last accepted server combat beat; used to enforce cadence. */
  lastAcceptedBeatAtMs: number;
  /** Cumulative accepted beats for player Speed; persists when an enemy is defeated. */
  playerSpeedBeats?: number;
  /** Fractional progress toward the next player action; carried between enemies. */
  playerSpeedCharge?: number;
  /** Fractional progress toward the current enemy's next action. */
  enemySpeedCharge?: number;
  /** One-shot enemy-turn cancellation queued by Time-Shear. */
  enemyTurnsToSkip?: number;
  combatBeats: number;
  playerActionsResolved: number;
  enemyActionsResolved: number;
  /** Lifetime count of completed player actions, used by Third-Beat Recharge across rooms. */
  playerTurnsCompleted: number;
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
  /** Legacy field retained for older saves; Arena no longer uses rating points. */
  arenaRating: number;
  arenaWins: number;
  arenaLosses: number;
  arenaLastChallengeAt: number;
  arenaLastMatchAt: number;
  coreLevel: number;
  coreHighestRarity: number;
  autoTactic: CombatTactic;
}
/** Returns the saved all-dungeon peak, ignoring malformed counters and respecting the supported cap. */
export function combatHighestDepthReached(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const state = value as Record<string, unknown>;
  const normalize = (candidate: unknown): number => {
    const raw = Number(candidate);
    if (!Number.isSafeInteger(raw) || raw < 1) return 0;
    return Math.min(COMBAT_MAX_DEPTH, raw);
  };
  let highest = Math.max(normalize(state.depth), normalize(state.bestDepth));
  const dungeonDepths = state.dungeonBestDepths;
  if (dungeonDepths && typeof dungeonDepths === 'object' && !Array.isArray(dungeonDepths)) {
    const record = dungeonDepths as Record<string, unknown>;
    highest = Math.max(
      highest,
      normalize(record.undercrypt),
      normalize(record['cinder-vault']),
      normalize(record['glass-labyrinth']),
    );
  }
  return highest;
}

/** Bosses appear every ten depths in each of the three dungeons. */
export function combatBossesBeatenByDepth(bestDepthValue: unknown, finalBossCleared = false): number {
  const rawDepth = Number(bestDepthValue);
  const depth = Number.isFinite(rawDepth)
    ? Math.max(1, Math.min(COMBAT_MAX_DEPTH, Math.floor(rawDepth)))
    : 1;
  let beaten = Math.floor((depth - 1) / 10);
  if (finalBossCleared && depth === COMBAT_MAX_DEPTH && COMBAT_MAX_DEPTH % 10 === 0) beaten += 1;
  return Math.max(0, Math.min(Math.floor(COMBAT_MAX_DEPTH / 10), beaten));
}

/** Reads lifetime boss clears while backfilling older saves from their best depth in each dungeon. */
export function combatTotalBossesBeaten(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const state = value as Record<string, unknown>;
  const dungeonIds: CombatDungeonId[] = ['undercrypt', 'cinder-vault', 'glass-labyrinth'];
  const activeDungeon: CombatDungeonId = dungeonIds.includes(state.dungeonId as CombatDungeonId)
    ? state.dungeonId as CombatDungeonId
    : 'undercrypt';
  const rawDepths = state.dungeonBestDepths;
  const depths = rawDepths && typeof rawDepths === 'object' && !Array.isArray(rawDepths)
    ? rawDepths as Record<string, unknown>
    : {};
  const rawCounts = state.dungeonBossesBeaten;
  const counts = rawCounts && typeof rawCounts === 'object' && !Array.isArray(rawCounts)
    ? rawCounts as Record<string, unknown>
    : {};
  const maxPerDungeon = Math.floor(COMBAT_MAX_DEPTH / 10);
  let total = 0;

  for (const dungeon of dungeonIds) {
    const storedDepth = depths[dungeon];
    const hasStoredDepth = storedDepth !== undefined && storedDepth !== null &&
      Number.isFinite(Number(storedDepth)) && Number(storedDepth) >= 1;
    const legacyDepth = state.bestDepth ?? state.depth ?? 1;
    const depth = hasStoredDepth ? storedDepth : dungeon === activeDungeon ? legacyDepth : 1;
    const inferred = combatBossesBeatenByDepth(
      depth,
      dungeon === activeDungeon && state.depthCapCleared === true,
    );
    const rawCount = Number(counts[dungeon]);
    const saved = Number.isFinite(rawCount)
      ? Math.max(0, Math.min(maxPerDungeon, Math.floor(rawCount)))
      : 0;
    total += Math.max(inferred, saved);
  }
  return total;
}

/** The boss-clear bonus stacks as 1.01^n with itself, then adds to other Luck sources. */
export function combatBossLuckBonus(bossesBeatenValue: unknown): number {
  const raw = Number(bossesBeatenValue);
  const maxTotal = Math.floor(COMBAT_MAX_DEPTH / 10) * 3;
  const count = Number.isFinite(raw) ? Math.max(0, Math.min(maxTotal, Math.floor(raw))) : 0;
  return Math.pow(1.01, count) - 1;
}


export interface CombatStats {
  damage: number;
  speed: number;
  maxHealth: number;
  maxEnergy: number;
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
  wins: number;
  losses: number;
  updatedAt: number;
  challengeBlockedUntil: number;
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
  // Keep salvage at one quarter of the original payout curve so gear drops do not flood the Forge.
  const depthMultiplier = 1 + Math.min(4, Math.sqrt(floor / 250));
  const rawValue = (20 + power * 1.1 + quality * 0.75 + Math.log10(floor + 1) * 8) * depthMultiplier;
  return Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(rawValue * 0.25)));
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
/** Pulls become progressively more expensive at higher Gacha ranks; lifetime pulls add a small further increase. */
export function skillPullCost(skillRollsValue: number, gachaRankValue: unknown = 1): number {
  const rollsRaw = Number(skillRollsValue);
  const rolls = Number.isFinite(rollsRaw) ? Math.max(0, Math.floor(rollsRaw)) : 0;
  const rankRaw = Number(gachaRankValue);
  const rank = Number.isFinite(rankRaw) ? Math.max(1, Math.min(SKILL_GACHA_RANK_MAX, Math.floor(rankRaw))) : 1;
  const lifetimeFactor = 1 + Math.min(.25, rolls / 10_000);
  return Math.max(1, Math.round(SKILL_PULL_BASE_COST * Math.pow(rank, 1.25) * lifetimeFactor));
}
export function createCombatState(): CombatState {
  const state: CombatState = {
    version:1, runId:1, dungeonId:'undercrypt', dungeonBestDepths:{undercrypt:1,'cinder-vault':1,'glass-labyrinth':1}, dungeonBossesBeaten:{undercrypt:0,'cinder-vault':0,'glass-labyrinth':0}, depth:1, bestDepth:1, depthCapCleared:false,
    level:1, xp:0, xpToNext:100, health:500, maxHealth:500, speed:150,
    baseDamage:30, coins:0, scrap:0, combatMarks:250, runes:[], equippedRunes:[], runeAutoSacrifice:{...DEFAULT_COMBAT_RUNE_AUTO_SACRIFICE_SETTINGS}, combatTutorialSeen:false, combatUpgrades:{}, totalKills:0, skillRolls:0, skillRuntime:createCombatSkillRuntime(), strategyGuideRank:0, tacticianManuals:0, skillGachaRank:1, skillPityEpic:0, skillPityMythic:0, skillCopyProgress:{}, equippedAbilities:[], abilityCooldowns:{}, orbFocusRarity:2, orbFocusName:'Common Orb', sequence:0, lastAcceptedBeatAtMs:0,
    playerSpeedBeats:0, playerSpeedCharge:0, enemySpeedCharge:0, enemyTurnsToSkip:0, combatBeats:0, playerActionsResolved:0, enemyActionsResolved:0, playerTurnsCompleted:0,
    energy:3, maxEnergy:5, guardBeats:0, enemyHp:130,
    encounterFirstStrikeUsed:false, pendingHealAmount:0, inventory:[],
    equipment:{weapon:null,armor:null,helmet:null,gloves:null,boots:null,ring:null,amulet:null}, runInventoryIds:[],
    autoScrapUnlocked:false,autoScrapSettings:{...DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS},skillLevels:{},
    arenaRating:1000, arenaWins:0, arenaLosses:0, arenaLastChallengeAt:0, arenaLastMatchAt:0,
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
  const abilityTotal=(id:CombatMajorAbility['id'],property:string)=>{
    // Rune perks are main-game-only; only equipped combat gear contributes here.
    return equippedItems.reduce((sum,item)=>{
      if(item.majorAbility?.id!==id)return sum;
      const raw=Number((item.majorAbility as unknown as Record<string,unknown>)[property]);
      return sum+(Number.isFinite(raw)?Math.max(0,raw)*qualityOf(item):0);
    },0);
  };
  const effectiveDamageBonus=equippedItems.reduce((sum,item)=>sum+Math.round(item.damageBonus*qualityOf(item)),0);
  // Gear Speed is flat, so equipping an item grants the same Speed at every depth.
  const effectiveSpeedBonus=equippedItems.reduce((sum,item)=>sum+Math.max(0,Math.floor(Number(item.speedBonus)||0)),0);
  const majorSpeedPercent=abilityTotal('chrono-surge','speedPercent');
  const majorDamagePercent=Math.min(1.5,abilityTotal('void-edge','damagePercent')+abilityTotal('glass-cannon','damagePercent')+
    Math.min(.4,abilityTotal('deep-roots','damagePerTenLevelsPercent')*Math.floor(floor/10)));
  const majorDamageReduction=abilityTotal('aegis-ward','damageReduction');
  const majorHealthPercent=Math.min(1.5,abilityTotal('titan-heart','maxHealthPercent'));
  const majorMaxEnergyFlat=Math.floor(Math.max(0,Math.min(45,abilityTotal('expanded-reserves','maxEnergyFlat'))));
  const maxEnergy=Math.max(5,Math.min(50,5+majorMaxEnergyFlat));
  const majorLastStand=state.health>0&&state.health<=Math.max(1,Number(state.maxHealth)||1000)*.35?abilityTotal('last-bastion','damageReduction'):0;
  const majorFrostbrandReduction=abilityTotal('frostbrand','damageReduction');
  const majorGlassCannonTaken=abilityTotal('glass-cannon','damageTakenPercent');
  const effectiveHealthBonus=equippedItems.reduce((sum,item)=>sum+Math.round(item.maxHealthBonus*qualityOf(item)),0);
  const effectiveArmorBonus=equippedItems.reduce((sum,item)=>sum+Math.round(item.armorBonus*qualityOf(item)),0);
  const effectiveCritBonus=equippedItems.reduce((sum,item)=>sum+item.critChanceBonus*qualityOf(item),0);
  const majorCritBonus=abilityTotal('starfall','critChanceBonus')+
    (state.health>0&&state.health>=Math.max(1,Number(state.maxHealth)||1000)?abilityTotal('full-moon','critChanceBonus'):0);
  const traitEffectiveness=(trait:CombatTrait)=>equippedItems.filter(item=>item.trait===trait).reduce((best,item)=>Math.max(best,qualityOf(item)),0);
  // Acquired skills are equipped active abilities, not permanent passive-stat stacks.
  let damagePct=0, speedFlat=0, healthPct=0, critChance=.08, coinBonus=0, damageReductionPct=0;
  for (const upgrade of COMBAT_UPGRADES) {
    const rank = combatUpgradeRank(state, upgrade.id);
    if (!rank) continue;
    if (upgrade.stat === 'damagePct') damagePct += upgrade.value * rank;
    else if (upgrade.stat === 'healthPct') healthPct += upgrade.value * rank;
    else if (upgrade.stat === 'speedFlat') speedFlat += upgrade.value * rank;
    else if (upgrade.stat === 'critChance') critChance += upgrade.value * rank;
    else if (upgrade.stat === 'damageReduction') damageReductionPct += upgrade.value * rank;
  }
  const gearQualityRequirement = floorQualityRequirement(floor);
  const orbRarity = Math.max(2, Math.min(Number.MAX_VALUE, Math.floor(Number(state.orbFocusRarity) || 2)));
  const orbFocusBonus = Math.min(.35, Math.max(0, (Math.log10(orbRarity) - Math.log10(2)) * .025 + combatUpgradeRank(state, 'orb-resonance') * .015));
  const coreProgressionBonus = coreProgressionCombatBonus(state.coreLevel, state.coreHighestRarity);
  const dungeonDamageBonus = state.dungeonId === 'cinder-vault' ? 0.10 : 0;
  const dungeonSpeedBonus = state.dungeonId === 'glass-labyrinth' ? 35 : 0;
  const dungeonCritBonus = state.dungeonId === 'glass-labyrinth' ? 0.05 : 0;
  // Ungeared Delvers start with modest baseline damage; gear is intended to be a meaningful early drop.
  const flatDamage = 30 + (Math.max(1,state.level)-1)*4 + effectiveDamageBonus + Math.round(floor*10);
  const flatHealth = 500 + (Math.max(1,state.level)-1)*30 + effectiveHealthBonus + Math.round(floor*20);
  const maxHealth = Math.max(1,Math.round(flatHealth*(1+healthPct)*(1+coreProgressionBonus)*(1+orbFocusBonus*.65)*(1+majorHealthPercent)));
  // Player Speed comes from gear and explicit bonuses, never dungeon depth.
  let speed = Math.round((150 + effectiveSpeedBonus + speedFlat + dungeonSpeedBonus) * (1 + majorSpeedPercent));
  if (traitEffectiveness('desperation')>0 && state.health>0 && state.health<=maxHealth*.4) speed+=Math.round(20*traitEffectiveness('desperation'));
  if (traitEffectiveness('keen')>0) critChance+=.04*traitEffectiveness('keen');
  critChance += effectiveCritBonus + majorCritBonus + dungeonCritBonus;
  const damageReduction = Math.max(-.50,Math.min(.80,effectiveArmorBonus/250 + .04*traitEffectiveness('bulwark') + majorDamageReduction + majorLastStand + majorFrostbrandReduction + damageReductionPct - majorGlassCannonTaken));
  return {
    damage:Math.max(1,Math.round(flatDamage*(1+damagePct)*(1+majorDamagePercent)*(1+coreProgressionBonus)*(1+dungeonDamageBonus)*(1+orbFocusBonus))),
    speed, maxHealth, maxEnergy, armor:effectiveArmorBonus,
    critChance:Math.min(.75,Math.max(0,critChance)),
    damageReduction,
    coinMultiplier:1+coinBonus, coreProgressionBonus, orbFocusBonus, gearQualityRequirement,
  };
}
/**
 * Turn Timer ranks reduce the global base beat interval by one second each.
 * Equipped, quality-adjusted Chrono Surge then multiplies that faster cadence.
 * The same derived interval is used by server cooldown validation and the client.
 */
export function combatBeatIntervalMsFor(
  state: Pick<CombatState, 'depth' | 'equipment' | 'inventory' | 'combatUpgrades'> | null | undefined,
): number {
  if (!state) return COMBAT_BEAT_INTERVAL_MS;
  const baseIntervalMs = Math.max(1_000, COMBAT_BEAT_INTERVAL_MS - combatUpgradeRank(state, 'turn-timer') * 1_000);
  const floor = Math.max(0, Number(state.depth ?? 1) - 1);
  const inventory = Array.isArray(state.inventory) ? state.inventory : [];
  const equipment = state.equipment ?? {};
  let chronoSpeedPercent = 0;
  for (const [slot, id] of Object.entries(equipment) as [CombatGearSlot, string | null][]) {
    if (!id) continue;
    const item = inventory.find(candidate => candidate.id === id && candidate.slot === slot);
    if (item?.majorAbility?.id !== 'chrono-surge') continue;
    const raw = Number(item.majorAbility.speedPercent);
    if (Number.isFinite(raw) && raw > 0) chronoSpeedPercent += raw * gearQualityEffectiveness(item, floor);
  }
  const speedMultiplier = 1 + Math.max(0, chronoSpeedPercent);
  return Math.max(1_000, Math.round(baseIntervalMs / speedMultiplier));
}

export function synchronizeCombatStats(state: CombatState): CombatStats {
  const stats=combatStatsFor(state);
  state.baseDamage=stats.damage; state.speed=stats.speed;
  const previousMax=Number(state.maxHealth)||stats.maxHealth;
  state.maxHealth=stats.maxHealth;
  if (!Number.isFinite(state.health)) state.health=state.maxHealth;
  state.health=Math.max(0,Math.min(state.maxHealth,state.health));
  if (previousMax<=0) state.health=state.maxHealth;
  state.maxEnergy=stats.maxEnergy;
  state.energy=Math.max(0,Math.min(state.maxEnergy,Math.floor(Number(state.energy)||0)));
  return stats;
}

export function combatMarkMultiplier(state: Pick<CombatState, 'combatUpgrades'> & Partial<Pick<CombatState, 'equipment' | 'inventory' | 'depth' | 'runes' | 'equippedRunes'>>): number {
  const floor = Math.max(0, Math.floor(Number(state.depth ?? 1) - 1));
  const inventory = Array.isArray(state.inventory) ? state.inventory : [];
  const equipment = state.equipment ?? {};
  const majorMarkBonus = (Object.entries(equipment) as [CombatGearSlot, string | null][]).reduce((sum, [slot, id]) => {
    const item = inventory.find(candidate => candidate.id === id && candidate.slot === slot);
    return sum + (item?.majorAbility?.id === 'mark-harvest' ? item.majorAbility.markBonusPercent * gearQualityEffectiveness(item, floor) : 0);
  }, 0);
  return 1 + combatUpgradeRank(state, 'scavenger') * .08 + combatUpgradeRank(state, 'mark-magnet') * .10 + majorMarkBonus;
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
    {id:'silt-revenant',name:'Silt Revenant',kind:'common' as const,hp:1.08,damage:1.05,speed:115,room:'The Drowned Steps',emoji:'🧟'},
    {id:'lantern-wraith',name:'Lantern Wraith',kind:'common' as const,hp:.8,damage:.9,speed:225,room:'Lantern Ossuary',emoji:'🏮'},
    {id:'hollow-arbalist',name:'Hollow Arbalist',kind:'elite' as const,hp:1.3,damage:1.16,speed:155,room:'Arrow Crypt',emoji:'🏹'},
    {id:'graveglass-mantis',name:'Graveglass Mantis',kind:'common' as const,hp:.74,damage:1.28,speed:240,room:'Shattered Conservatory',emoji:'🦗'},
    {id:'mirebound-oracle',name:'Mirebound Oracle',kind:'elite' as const,hp:1.18,damage:1.15,speed:105,room:"Oracle's Mire",emoji:'🔮'},
    {id:'tomb-sapper',name:'Tomb Sapper',kind:'common' as const,hp:1.1,damage:1.05,speed:90,room:'Collapsed Causeway',emoji:'⛏️'},
    {id:'boneweaver',name:'Boneweaver',kind:'elite' as const,hp:1.4,damage:.94,speed:80,room:'The Ossuary Loom',emoji:'🕸️'},
    {id:'carrion-drake',name:'Carrion Drake',kind:'elite' as const,hp:1.6,damage:1.55,speed:145,room:'Ribcage Aerie',emoji:'🐉'},
    {id:'pallid-duelist',name:'Pallid Duelist',kind:'common' as const,hp:.82,damage:1.25,speed:195,room:'Marrow Court',emoji:'🤺'},
    {id:'gloom-stalker',name:'Gloom Stalker',kind:'elite' as const,hp:1.05,damage:1.35,speed:260,room:'The Lightless Gallery',emoji:'🌑'},
    {id:'ashen-abbot',name:'Ashen Abbot',kind:'elite' as const,hp:1.35,damage:1.1,speed:95,room:'Cinder Reliquary',emoji:'🕯️'},
    {id:'shardback-brute',name:'Shardback Brute',kind:'common' as const,hp:1.8,damage:.85,speed:70,room:'Glass Quarry',emoji:'🪨'},
    {id:'dusk-harrier',name:'Dusk Harrier',kind:'common' as const,hp:.9,damage:1.22,speed:230,room:'Twilight Rampart',emoji:'🦅'},
    {id:'sepulcher-guard',name:'Sepulcher Guard',kind:'elite' as const,hp:1.7,damage:.92,speed:85,room:'Kings Below',emoji:'🪦'},
    {id:'wailing-curator',name:'Wailing Curator',kind:'elite' as const,hp:1.12,damage:1.28,speed:175,room:'The Memory Vault',emoji:'📜'},
    {id:'vault-parasite',name:'Vault Parasite',kind:'common' as const,hp:.68,damage:1.1,speed:210,room:'Coin-Eater Tunnels',emoji:'🪱'},
    {id:'rift-touched-husk',name:'Rift-Touched Husk',kind:'common' as const,hp:1.05,damage:1.2,speed:130,room:'The Fracture Walk',emoji:'🌀'},
    {id:'blackglass-sentinel',name:'Blackglass Sentinel',kind:'elite' as const,hp:1.55,damage:1.05,speed:120,room:'Blackglass Gate',emoji:'🗿'},
  ];
  const safeDepth=Math.max(1,Math.min(COMBAT_MAX_DEPTH,Math.floor(Number(depth)||1)));
  const floor=safeDepth-1;
  const boss=safeDepth%10===0;
  const base=encounters[(safeDepth-1)%encounters.length]!;
  // Polynomial HP scaling avoids hitting the old 1e12 cap within the first few hundred rooms.
  const scaledHp=Math.min(1e15,Math.round(130*Math.pow(1+floor/100,2.2)*base.hp));
  const maxHp=boss?Math.round(scaledHp*1.15*4.6):scaledHp;
  const damage=Math.min(1e12,Math.max(1,Math.round((20+floor*1.55)*Math.pow(1+floor/100,.35)*base.damage*(boss?2.2*1.15:1))));
  // Enemy Speed deliberately scales with depth; player Speed does not.
  // Gear power grows linearly with depth, so enemy Speed does too. Superlinear scaling
  // eventually made even dedicated high-Speed builds unable to keep up.
  const depthSpeedMultiplier = 1 + floor / 100;
  const speed=Math.round(base.speed*depthSpeedMultiplier+floor*1.2+(boss?55:0));
  return {id:boss?'crypt-warden':base.id,name:boss?'Crypt Warden':base.name,kind:boss?'boss':base.kind,hp:maxHp,maxHp,damage,speed,room:boss?'Warden Throne':base.room,emoji:boss?'👹':base.emoji,boss};
}


/** @deprecated Boss Luck now tracks clear counts across all three dungeons. */
export function undercryptWardensDefeated(bestDepthValue: unknown): number {
  return combatBossesBeatenByDepth(bestDepthValue);
}

/** @deprecated Use combatBossLuckBonus with the lifetime boss count. */
export function undercryptOrbLuckMultiplier(bestDepthValue: unknown): number {
  return 1 + combatBossLuckBonus(combatBossesBeatenByDepth(bestDepthValue));
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
  const rarity = Number.isFinite(rawRarity) ? Math.max(2, Math.min(Number.MAX_VALUE, rawRarity)) : 2;
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
      speed: Math.round(base.speed * 1.08),
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
    speed: Math.round(base.speed * 1.35),
    room: base.boss ? 'Hall of Infinite Reflections' : 'Mirror ' + base.room,
    emoji: base.boss ? '🔮' : base.emoji,
  };
}

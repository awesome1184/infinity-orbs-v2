import { context, redis } from './devvit-mock.js';
import { loadRaw } from './game.js';
import { getOrbInfo, luckMultiplier, rollContinuum } from '../shared/game.js';
import type { CombatAction, CombatArenaProfile, CombatArenaResult, CombatCommand, CombatSkillDefinition, CombatDungeonId, CombatEnemy, CombatGear, CombatGearSlot, CombatIntent, CombatMajorAbility, CombatOrbRoll, CombatSkillId, CombatSnapshot, CombatState, CombatTactic, CombatTrait, CombatRarity, CombatRune, CombatRuneAutoSacrificeSettings, CombatRuneRarity, CombatRuneStat, CombatSkillRuntime } from '../shared/combat.js';
import { calculateCombatArenaRatingUpdate, chooseAutoCombatIntent, COMBAT_ABILITY_SLOTS, COMBAT_INVENTORY_CAP, COMBAT_MAJOR_ABILITY_IDS, COMBAT_MAX_DEPTH, COMBAT_SKILLS, DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS, SKILL_GACHA_RANK_MAX, SKILL_RANK_CAP, COMBAT_UPGRADES, addCombatGearToInventory, applyCombatSkillCopy, combatMajorAbilityChance, combatOrbDamageMultiplier, combatAbilityType, combatBountyReward, combatEffectiveFlurryBonusAttacks, combatActionsDue, combatEnergyAfterRegen, combatTurnsCrossedThree, combatFlurryAttackMultiplier, combatForgeCost, combatMarkMultiplier, combatScrapValue, combatSkillCooldown, combatSkillEnergyCost, combatSkillCopiesForNextRank, combatStatsFor, combatUpgradeCost, combatUpgradeRank, createCombatState, gearQualityEffectiveness, getEnemyForDungeonDepth, normalizeCombatAutoScrapSettings, resetCombatRunCarry, resolveCombatSkillRarity, skillGachaRankRequirement, skillPullCost, skillRarityUnlocked, synchronizeCombatStats, COMBAT_BEAT_INTERVAL_MS, combatForgeQualityCost, COMBAT_RUNE_INVENTORY_CAP, COMBAT_RUNE_RARITIES, DEFAULT_COMBAT_RUNE_AUTO_SACRIFICE_SETTINGS, combatRuneRarityAtOrBelow, STRATEGY_GUIDE_RANKS, tacticianManualDropChance, createCombatSkillRuntime, combatRuneEffectText, combatRuneExperienceForLevel, combatRuneLevelFromExperience, combatRuneSacrificeExperience, combatRuneSlotsUnlocked, combatRuneValueFor, combatRuneMajorAbilityChance, combatRuneMajorAbilityQuality, combatGearQualityFromRoll, combatGearStatBudgetMultiplier } from '../shared/combat.js';

const MAX_CAS_ATTEMPTS=8, INVENTORY_CAP=COMBAT_INVENTORY_CAP;
function combatKey():string { const id=String(context.userId??'').trim(); if(!id) throw new Error('REDDIT_LOGIN_REQUIRED'); return 'infinity-orbs:combat:'+id; }
/** Use the platform cryptographic RNG; never fall back to predictable secureRandom(). */
function secureRandom():number {
  const cryptoApi=globalThis.crypto;
  if(!cryptoApi||typeof cryptoApi.getRandomValues!=='function')throw new Error('Secure combat randomness is unavailable.');
  const words=new Uint32Array(2);
  cryptoApi.getRandomValues(words);
  // Uniform 53-bit fraction in [0, 1), built from cryptographically random bits.
  return (words[0]!*0x20_0000+(words[1]!>>>11))/0x20_0000_0000_0000;
}
function pick<T>(values:T[]):T { return values[Math.floor(secureRandom()*values.length)]!; }
function finiteInt(value:unknown,fallback:number,min:number,max:number):number {
  const bounded=(n:number)=>Math.max(min,Math.min(max,Math.floor(n)));
  const n=Number(value);
  if(Number.isFinite(n))return bounded(n);
  return Number.isFinite(fallback)?bounded(fallback):min;
}
function traitText(t:CombatTrait):string {
  if(t==='bleed')return '18% chance to add bonus bleed damage.';
  if(t==='keen')return '+4 percentage points of critical chance.';
  if(t==='first-strike')return 'First attack against each foe deals 50% extra damage.';
  if(t==='bulwark')return 'Reduces incoming damage by 4%.';
  if(t==='regeneration')return 'Recover 2% max HP after elite or boss kills.';
  return 'Gain +20 Speed while below 40% health.';
}
function normalizeMajorAbility(raw:Record<string,unknown>|null):CombatMajorAbility|undefined {
  if(!raw)return undefined;
  const name=(fallback:string)=>typeof raw.name==='string'?raw.name.slice(0,60):fallback;
  const description=(fallback:string)=>typeof raw.description==='string'?raw.description.slice(0,180):fallback;
  const value=(key:string,fallback:number,max:number)=>Math.max(0,Math.min(max,Number.isFinite(Number(raw[key]))?Number(raw[key]):fallback));
  switch(raw.id){
    case 'second-dawn': return raw.trigger==='on-damage'?{id:'second-dawn',name:name('Second Dawn'),trigger:'on-damage',healPercent:value('healPercent',.15,.75),description:description('Queues a 15% Max HP heal after incoming damage.')}:undefined;
    case 'chrono-surge': return raw.trigger==='passive'?{id:'chrono-surge',name:name('Chrono Surge'),trigger:'passive',speedPercent:value('speedPercent',.10,.5),description:description('Increases turn speed while equipped.')}:undefined;
    case 'void-edge': return raw.trigger==='passive'?{id:'void-edge',name:name('Void Edge'),trigger:'passive',damagePercent:value('damagePercent',.12,.75),description:description('Increases outgoing damage while equipped.')}:undefined;
    case 'aegis-ward': return raw.trigger==='passive'?{id:'aegis-ward',name:name('Aegis Ward'),trigger:'passive',damageReduction:value('damageReduction',.08,.25),description:description('Reduces incoming damage while equipped.')}:undefined;
    case 'starfall': return raw.trigger==='passive'?{id:'starfall',name:name('Starfall'),trigger:'passive',critChanceBonus:value('critChanceBonus',.05,.12),description:description('Adds critical-hit chance while equipped.')}:undefined;
    case 'mark-harvest': return raw.trigger==='passive'?{id:'mark-harvest',name:name('Mark Harvest'),trigger:'passive',markBonusPercent:value('markBonusPercent',.15,1),description:description('Increases Combat Marks from kills while equipped.')}:undefined;
    case 'titan-heart': return raw.trigger==='passive'?{id:'titan-heart',name:name("Titan's Heart"),trigger:'passive',maxHealthPercent:value('maxHealthPercent',.1,.75),description:description('Increases maximum HP.')}:undefined;
    case 'blood-drinker': return raw.trigger==='passive'?{id:'blood-drinker',name:name('Blood Drinker'),trigger:'passive',lifestealPercent:value('lifestealPercent',.08,.25),description:description('Restores HP from damage dealt.')}:undefined;
    case 'executioner': return raw.trigger==='passive'?{id:'executioner',name:name("Executioner's Sigil"),trigger:'passive',executeDamagePercent:value('executeDamagePercent',.15,.75),description:description('Deals extra damage to enemies below 30% HP.')}:undefined;
    case 'emberwake': return raw.trigger==='passive'?{id:'emberwake',name:name('Emberwake'),trigger:'passive',burnChance:value('burnChance',.15,1),burnDamagePercent:value('burnDamagePercent',.2,1),description:description('Hits can ignite enemies for bonus damage.')}:undefined;
    case 'mirrorplate': return raw.trigger==='passive'?{id:'mirrorplate',name:name('Mirrorplate'),trigger:'passive',reflectPercent:value('reflectPercent',.08,.35),description:description('Reflects part of incoming damage back to attackers.')}:undefined;
    case 'last-bastion': return raw.trigger==='passive'?{id:'last-bastion',name:name('Last Bastion'),trigger:'passive',damageReduction:value('damageReduction',.08,.25),description:description('Reduces damage further while below 35% HP.')}:undefined;
    case 'critical-mass': return raw.trigger==='passive'?{id:'critical-mass',name:name('Critical Mass'),trigger:'passive',critDamageBonus:value('critDamageBonus',.15,1.5),description:description('Increases critical-hit damage.')}:undefined;
    case 'orb-conduit': return raw.trigger==='passive'?{id:'orb-conduit',name:name('Orb Conduit'),trigger:'passive',orbDamagePercent:value('orbDamagePercent',.1,1),description:description('Amplifies damage from each beat Orb.')}:undefined;
    case 'soul-harvest': return raw.trigger==='passive'?{id:'soul-harvest',name:name('Soul Harvest'),trigger:'passive',healOnKillPercent:value('healOnKillPercent',.08,.5),description:description('Restores a portion of Max HP after a kill.')}:undefined;
    case 'salvagers-touch': return raw.trigger==='passive'?{id:'salvagers-touch',name:name("Salvager's Touch"),trigger:'passive',scrapBonusPercent:value('scrapBonusPercent',.2,2),description:description('Increases Scrap gained from gear.')}:undefined;
    case 'rune-savant': return raw.trigger==='passive'?{id:'rune-savant',name:name('Rune Savant'),trigger:'passive',runeDropBonusPercent:value('runeDropBonusPercent',.05,.25),description:description('Improves non-boss Rune drop chance.')}:undefined;
    case 'bossbreaker': return raw.trigger==='passive'?{id:'bossbreaker',name:name('Bossbreaker'),trigger:'passive',bossDamagePercent:value('bossDamagePercent',.2,1),description:description('Deals more damage to bosses.')}:undefined;
    case 'echo-fang': return raw.trigger==='passive'?{id:'echo-fang',name:name('Echo Fang'),trigger:'passive',echoChance:value('echoChance',.1,.5),echoDamagePercent:value('echoDamagePercent',.4,2),description:description('Hits can echo for additional Orb damage.')}:undefined;
    case 'phase-shift': return raw.trigger==='passive'?{id:'phase-shift',name:name('Phase Shift'),trigger:'passive',evadeChance:value('evadeChance',.05,.25),description:description('Has a chance to evade incoming attacks.')}:undefined;
    case 'blood-moon': return raw.trigger==='passive'?{id:'blood-moon',name:name('Blood Moon'),trigger:'passive',lowHealthDamagePercent:value('lowHealthDamagePercent',.15,1),description:description('Deals bonus damage while below 35% HP.')}:undefined;
    case 'deep-roots': return raw.trigger==='passive'?{id:'deep-roots',name:name('Deep Roots'),trigger:'passive',damagePerTenLevelsPercent:value('damagePerTenLevelsPercent',.015,.1),description:description('Damage grows every ten dungeon levels.')}:undefined;
    case 'frostbrand': return raw.trigger==='passive'?{id:'frostbrand',name:name('Frostbrand'),trigger:'passive',damageReduction:value('damageReduction',.06,.2),description:description('Reduces incoming enemy damage.')}:undefined;
    case 'aegis-pulse': return raw.trigger==='passive'?{id:'aegis-pulse',name:name('Aegis Pulse'),trigger:'passive',shieldOnHitPercent:value('shieldOnHitPercent',.03,.2),description:description('Builds a small shield after enemy attacks.')}:undefined;
    case 'glass-cannon': return raw.trigger==='passive'?{id:'glass-cannon',name:name('Glass Cannon'),trigger:'passive',damagePercent:value('damagePercent',.3,1),damageTakenPercent:value('damageTakenPercent',.12,.4),description:description('Deals much more damage, but also takes more damage.')}:undefined;
    case 'fortune-engine': return raw.trigger==='passive'?{id:'fortune-engine',name:name('Fortune Engine'),trigger:'passive',critMarkBonusPercent:value('critMarkBonusPercent',.04,.1),description:description('Critical hits also generate Combat Marks.')}:undefined;
    case 'unending-ward': return raw.trigger==='passive'?{id:'unending-ward',name:name('Unending Ward'),trigger:'passive',shieldOnKillPercent:value('shieldOnKillPercent',.06,.3),description:description('Builds a shield whenever you defeat an enemy.')}:undefined;
    case 'full-moon': return raw.trigger==='passive'?{id:'full-moon',name:name('Full Moon'),trigger:'passive',critChanceBonus:value('critChanceBonus',.06,.3),description:description('Adds critical chance while at full HP.')}:undefined;
    case 'unstable-singularity': return raw.trigger==='passive'?{id:'unstable-singularity',name:name('Unstable Singularity'),trigger:'passive',burstChance:value('burstChance',.08,.3),burstDamagePercent:value('burstDamagePercent',.5,2),description:description('Hits can erupt in a burst of bonus damage.')}:undefined;
    case 'genesis-core': return raw.trigger==='passive'?{id:'genesis-core',name:name('Genesis Core'),trigger:'passive',regenPercent:value('regenPercent',.01,.05),description:description('Regenerates a little HP on every combat beat.')}:undefined;
    case 'expanded-reserves': return raw.trigger==='passive'?{id:'expanded-reserves',name:name('Expanded Reserves'),trigger:'passive',maxEnergyFlat:value('maxEnergyFlat',1,45),description:description('Increases maximum Energy while this gear is equipped.')}:undefined;
    case 'third-beat-recharge': return raw.trigger==='passive'?{id:'third-beat-recharge',name:name('Third-Beat Recharge'),trigger:'passive',energyPerThreeTurns:value('energyPerThreeTurns',1,10),description:description('Restores Energy every three completed player turns.')}:undefined;
    default:return undefined;
  }
}

function normalizeGear(value:unknown,fallbackFloor=0):CombatGear|null {
  if(!value||typeof value!=='object')return null;
  const x=value as Record<string,unknown>;
  const rawSlot=String(x.slot??'');
  const slot:CombatGearSlot|null=rawSlot==='armor'||rawSlot==='chest'?'armor':
    (['weapon','helmet','gloves','boots','ring','amulet'] as string[]).includes(rawSlot)?rawSlot as CombatGearSlot:null;
  const traits:CombatTrait[]=['bleed','keen','first-strike','bulwark','regeneration','desperation'];
  if(!slot||typeof x.id!=='string'||!x.id||typeof x.name!=='string')return null;
  const trait=traits.includes(x.trait as CombatTrait)?x.trait as CombatTrait:(slot==='weapon'?'keen':'bulwark');
  const rawAbility=x.majorAbility&&typeof x.majorAbility==='object'?x.majorAbility as Record<string,unknown>:null;
  const majorAbility=normalizeMajorAbility(rawAbility);

  return {id:x.id.slice(0,160),name:x.name.slice(0,100),slot,quality:Math.max(0,Math.min(100,Number.isFinite(Number(x.quality))?Number(x.quality):0)),sourceFloor:finiteInt(x.sourceFloor,fallbackFloor,0,COMBAT_MAX_DEPTH-1),power:finiteInt(x.power,1,1,1_000_000),effect:x.id==='starter-weapon'?'Adds +4 damage. Critical chance +4 percentage points.':typeof x.effect==='string'?x.effect.slice(0,180):traitText(trait),trait,damageBonus:finiteInt(x.damageBonus,0,0,1_000_000),speedBonus:0,maxHealthBonus:finiteInt(x.maxHealthBonus,0,0,1_000_000),armorBonus:finiteInt(x.armorBonus,0,0,1_000_000),critChanceBonus:Math.max(0,Math.min(.75,Number.isFinite(Number(x.critChanceBonus))?Number(x.critChanceBonus):0)),...(majorAbility?{majorAbility}:{})};
}
function normalizeRuneMajorAbility(raw:Record<string,unknown>|null,stat:CombatRuneStat):CombatRune['majorAbility'] {
  if(!raw)return undefined;
  const validIds=['fateweaver','midas-engine','memory-well','echo-chamber','paradox-engine','event-horizon','shard-constellation','temporal-loop','prismatic-fork','critical-convergence','rarity-ladder','stellar-dividend','shard-jackpot','milestone-engine','shard-tithe','discovery-oracle','dry-streak-refinery'];
  const valid=validIds.includes(String(raw.id));
  const id:NonNullable<CombatRune['majorAbility']>['id']=valid
    ?raw.id as NonNullable<CombatRune['majorAbility']>['id']
    :stat==='coinGainPct'?'midas-engine':stat==='xpGainPct'?'memory-well':'fateweaver';
  const names={
    fateweaver:'Fateweaver','midas-engine':'Midas Engine','memory-well':'Memory Well',
    'echo-chamber':'Echo Chamber','paradox-engine':'Paradox Engine','event-horizon':'Event Horizon',
    'shard-constellation':'Shard Constellation','temporal-loop':'Temporal Loop','prismatic-fork':'Prismatic Fork',
    'critical-convergence':'Critical Convergence','rarity-ladder':'Rarity Ladder','stellar-dividend':'Stellar Dividend',
    'shard-jackpot':'Shard Jackpot','milestone-engine':'Milestone Engine','shard-tithe':'Shard Tithe','discovery-oracle':'Discovery Oracle','dry-streak-refinery':'Dry-Streak Refinery',
  };
  const descriptions={
    fateweaver:'Adds effective Luck to main-game Infinity Orb rolls.',
    'midas-engine':'Adds Coins to main-game Infinity Orb rewards.',
    'memory-well':'Adds XP to main-game Infinity Orb rewards.',
    'echo-chamber':'Rolls can echo into extra rolls; each echo has a lower chance to continue the chain.',
    'paradox-engine':'Multi-roll activations can fracture into extra rolls.',
    'event-horizon':'New all-time rarity records trigger a burst of bonus rolls with a rarity floor.',
    'shard-constellation':'Shard finds charge a constellation that rewards bonus Shards and rolls.',
    'temporal-loop':'Each roll charges Momentum; a full meter releases a bonus batch.',
    'prismatic-fork':'Rare rolls can fork into a bonus roll with a rarity floor.',
    'critical-convergence':'Critical rolls can trigger a rarity-floored bonus roll.',
    'rarity-ladder':'Three rising rarities in one activation trigger bonus rolls.',
    'stellar-dividend':'Lifetime roll milestones trigger extra rolls.',
    'shard-jackpot':'Shard payouts can trigger a scaled Shard multiplier.',
    'milestone-engine':'Crossing a new all-time rarity decade grants bonus Shards and rolls.',
    'shard-tithe':'Adds fractional Shards to every main-game roll.',
    'discovery-oracle':'First-time rarity discoveries can trigger rarity-matched bonus rolls.',
    'dry-streak-refinery':'Long gaps between rarity records gradually add fractional Shards per roll.',
  };
  const rawValue=Number(raw.valuePct);
  const valuePct=Number.isFinite(rawValue)?Math.max(0,Math.min(Number.MAX_VALUE,rawValue)):10;
  return {id,name:typeof raw.name==='string'?raw.name.slice(0,60):names[id],valuePct,description:descriptions[id]};
}
function normalizeRune(value:unknown):CombatRune|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const x=value as Record<string,unknown>,rarity=x.rarity,stat=x.stat,dungeon=x.sourceDungeon;
  if(typeof x.id!=='string'||!x.id.trim()||x.id.length>160)return null;
  if(!(['Common','Uncommon','Rare','Epic','Legendary','Mythic','Cosmic'] as unknown[]).includes(rarity))return null;
  if(!(['luckPct','coinGainPct','shardChancePct','xpGainPct'] as unknown[]).includes(stat))return null;
  const sourceDungeon:CombatDungeonId=(['undercrypt','cinder-vault','glass-labyrinth'] as unknown[]).includes(dungeon)?dungeon as CombatDungeonId:'undercrypt';
  const sourceDepth=finiteInt(x.sourceDepth,0,0,COMBAT_MAX_DEPTH-1);
  const rawValue=Number(x.value),cap=stat==='shardChancePct'?100:Number.MAX_VALUE;
  const runeValue=Number.isFinite(rawValue)?Math.max(0,Math.min(cap,rawValue)):0;
  if(runeValue<=0)return null;
  const rawAbility=x.majorAbility&&typeof x.majorAbility==='object'&&!Array.isArray(x.majorAbility)?x.majorAbility as Record<string,unknown>:null;
  // Migrate saved combat-style Rune perks into core-game-only Rune perks.
  const majorAbility=normalizeRuneMajorAbility(rawAbility,stat as CombatRuneStat);
  const legacyLevel=finiteInt(x.level,1,1,Number.MAX_SAFE_INTEGER);
  const rawExperience=Number(x.experience);
  const hasExperience=x.experience!==undefined&&x.experience!==null&&Number.isFinite(rawExperience)&&rawExperience>=0;
  const experience=hasExperience?Math.min(Number.MAX_SAFE_INTEGER,Math.floor(rawExperience)):combatRuneExperienceForLevel(legacyLevel);
  const level=hasExperience?combatRuneLevelFromExperience(experience):legacyLevel;
  return {id:x.id.trim(),name:typeof x.name==='string'?x.name.slice(0,120):'Unnamed Rune',
    rarity:rarity as CombatRuneRarity,stat:stat as CombatRuneStat,value:runeValue,
    level,experience,sourceDepth,sourceDungeon,...(majorAbility?{majorAbility}:{})};
}
function equippedMajorAbilityTotal(state:CombatState,abilityId:CombatMajorAbility['id'],property:string):number {
  const floor=Math.max(0,state.depth-1);
  let total=0;
  for(const [slot,id] of Object.entries(state.equipment) as [CombatGearSlot,string|null][]){
    if(!id)continue;
    const item=state.inventory.find(candidate=>candidate.id===id&&candidate.slot===slot);
    if(item?.majorAbility?.id!==abilityId)continue;
    const raw=Number((item.majorAbility as unknown as Record<string,unknown>)[property]);
    if(Number.isFinite(raw)&&raw>0)total+=Math.min(10,raw)*gearQualityEffectiveness(item,floor);
  }
  return total;
}

const COMBAT_RUNE_MAJOR_ABILITY_IDS = ['fateweaver','midas-engine','memory-well','echo-chamber','paradox-engine','event-horizon','shard-constellation','temporal-loop','prismatic-fork','critical-convergence','rarity-ladder','stellar-dividend','shard-jackpot','milestone-engine','shard-tithe','discovery-oracle','dry-streak-refinery'] as const;
type CombatRuneMajorAbilityId = NonNullable<CombatRune['majorAbility']>['id'];
function createRuneMajorAbility(qualityValue:number,requestedAbilityId?:CombatRuneMajorAbilityId):NonNullable<CombatRune['majorAbility']> {
  const quality=Math.max(0,Math.min(100,Number(qualityValue)||0));
  const valuePct=Math.round((5+quality*.15)*100)/100;
  const id=requestedAbilityId&&COMBAT_RUNE_MAJOR_ABILITY_IDS.includes(requestedAbilityId)?requestedAbilityId:pick([...COMBAT_RUNE_MAJOR_ABILITY_IDS]);
  const definitions:Record<CombatRuneMajorAbilityId,{name:string;description:string}>={
    fateweaver:{name:'Fateweaver',description:'Adds effective Luck to main-game Infinity Orb rolls.'},
    'midas-engine':{name:'Midas Engine',description:'Adds Coins to main-game Infinity Orb rewards.'},
    'memory-well':{name:'Memory Well',description:'Adds XP to main-game Infinity Orb rewards.'},
    'echo-chamber':{name:'Echo Chamber',description:'Rolls can echo into extra rolls; each echo has a lower chance to continue the chain.'},
    'paradox-engine':{name:'Paradox Engine',description:'Multi-roll activations can fracture into extra rolls.'},
    'event-horizon':{name:'Event Horizon',description:'New all-time rarity records trigger a burst of bonus rolls with a rarity floor.'},
    'shard-constellation':{name:'Shard Constellation',description:'Shard finds charge a constellation that rewards bonus Shards and rolls.'},
    'temporal-loop':{name:'Temporal Loop',description:'Each roll charges Momentum; a full meter releases a bonus batch.'},
    'prismatic-fork':{name:'Prismatic Fork',description:'Rare rolls can fork into a bonus roll with a rarity floor.'},
    'critical-convergence':{name:'Critical Convergence',description:'Critical rolls can trigger a rarity-floored bonus roll.'},
    'rarity-ladder':{name:'Rarity Ladder',description:'Three rising rarities in one activation trigger bonus rolls.'},
    'stellar-dividend':{name:'Stellar Dividend',description:'Lifetime roll milestones trigger extra rolls.'},
    'shard-jackpot':{name:'Shard Jackpot',description:'Shard payouts can trigger a scaled Shard multiplier.'},
    'milestone-engine':{name:'Milestone Engine',description:'Crossing a new all-time rarity decade grants bonus Shards and rolls.'},
    'shard-tithe':{name:'Shard Tithe',description:'Adds fractional Shards to every main-game roll.'},
    'discovery-oracle':{name:'Discovery Oracle',description:'First-time rarity discoveries can trigger rarity-matched bonus rolls.'},
    'dry-streak-refinery':{name:'Dry-Streak Refinery',description:'Long gaps between rarity records gradually add fractional Shards per roll.'},
  };
  const definition=definitions[id];
  return {id,name:definition.name,valuePct,description:definition.description};
}
function createCombatRune(sourceDepth:number,sourceDungeon:CombatDungeonId,totalKills:number,sequence:number):CombatRune {
  const rarityRoll=secureRandom();
  const rarity:CombatRuneRarity=rarityRoll<.0005?'Cosmic':rarityRoll<.0025?'Mythic':rarityRoll<.01?'Legendary':rarityRoll<.035?'Epic':rarityRoll<.12?'Rare':rarityRoll<.35?'Uncommon':'Common';
  const stat=pick(['luckPct','coinGainPct','shardChancePct','xpGainPct'] as CombatRuneStat[]);
  const value=combatRuneValueFor(rarity,stat,sourceDepth);
  const rarityName:Record<CombatRuneRarity,string>={Common:'Fractured',Uncommon:'Polished',Rare:'Radiant',Epic:'Runed',Legendary:'Ascendant',Mythic:'Mythic',Cosmic:'Cosmic'};
  const statName:Record<CombatRuneStat,string>={luckPct:'Fate',coinGainPct:'Hoard',shardChancePct:'Prism',xpGainPct:'Insight'};
  const majorAbility=secureRandom()<combatRuneMajorAbilityChance(rarity)?createRuneMajorAbility(combatRuneMajorAbilityQuality(rarity)):undefined;
  const suffix=Math.floor(secureRandom()*1_000_000_000).toString(36);
  return {id:'rune-'+sourceDungeon+'-'+totalKills+'-'+sequence+'-'+suffix,name:rarityName[rarity]+' '+statName[stat]+' Rune',rarity,stat,value,level:1,experience:0,sourceDepth,sourceDungeon,...(majorAbility?{majorAbility}:{})};
}
function normalizeState(raw:string|null|undefined):CombatState {
  // Missing saves are new players; present-but-invalid saves must never be silently
  // replaced by starter state, which would permanently erase combat progression.
  if(raw===null||raw===undefined)return createCombatState();
  if(typeof raw!=='string'||!raw.trim())throw new Error('Combat state is corrupted; refusing to overwrite it.');
  let p:Partial<CombatState>;
  try {
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid combat-state root');
    p=parsed as Partial<CombatState>;
  } catch {
    throw new Error('Combat state is corrupted; refusing to overwrite it.');
  }
  const storedGachaRank=p.skillGachaRank;
  const savedSkillLevels=(p.skillLevels&&typeof p.skillLevels==='object'?p.skillLevels:{}) as Partial<Record<CombatSkillId,number>>;
  const legacyUnlockedRank=Math.max(1,...COMBAT_SKILLS.filter(skill=>Number(savedSkillLevels[skill.id])>0).map(skill=>({Common:1,Uncommon:2,Rare:3,Epic:4,Mythic:5}[skill.rarity])));
  const s=createCombatState();
  const legacyKeys=new Set(['inventoryByDungeon','equipmentByDungeon']);
  if(!Object.keys(p).some(key=>Object.prototype.hasOwnProperty.call(s,key)||legacyKeys.has(key))){
    throw new Error('Combat state is corrupted; refusing to overwrite it.');
  }
  // Copy only known own state fields. Besides preventing prototype-key tricks,
  // this keeps unknown or retired properties from leaking back into saved state.
  for(const [key,value] of Object.entries(p)){
    if(Object.prototype.hasOwnProperty.call(s,key)){
      Object.defineProperty(s,key,{value,writable:true,enumerable:true,configurable:true});
    }
  }
  s.version=1;
  s.combatTutorialSeen = s.combatTutorialSeen === true;
  s.dungeonId=(['undercrypt','cinder-vault','glass-labyrinth'] as unknown[]).includes(s.dungeonId)?s.dungeonId:'undercrypt';
  s.runId=finiteInt(s.runId,1,1,Number.MAX_SAFE_INTEGER);s.depth=finiteInt(s.depth,1,1,COMBAT_MAX_DEPTH);s.depthCapCleared=s.depthCapCleared===true;
  s.bestDepth=Math.max(s.depth,finiteInt(s.bestDepth,1,1,COMBAT_MAX_DEPTH));
  const savedDungeonBests=(s.dungeonBestDepths&&typeof s.dungeonBestDepths==='object'?s.dungeonBestDepths:{}) as Partial<Record<CombatDungeonId,number>>;
  s.dungeonBestDepths={
    undercrypt:finiteInt(savedDungeonBests.undercrypt,s.dungeonId==='undercrypt'?s.bestDepth:1,1,COMBAT_MAX_DEPTH),
    'cinder-vault':finiteInt(savedDungeonBests['cinder-vault'],s.dungeonId==='cinder-vault'?s.bestDepth:1,1,COMBAT_MAX_DEPTH),
    'glass-labyrinth':finiteInt(savedDungeonBests['glass-labyrinth'],s.dungeonId==='glass-labyrinth'?s.bestDepth:1,1,COMBAT_MAX_DEPTH),
  };
  s.dungeonBestDepths[s.dungeonId]=Math.max(s.dungeonBestDepths[s.dungeonId],s.bestDepth);
  s.bestDepth=Math.max(s.depth,s.dungeonBestDepths[s.dungeonId]);
  s.level=finiteInt(s.level,1,1,60);s.xp=finiteInt(s.xp,0,0,Number.MAX_SAFE_INTEGER);
  s.xpToNext=finiteInt(s.xpToNext,100,1,1_000_000_000);
  // Migrate legacy Delver Coins and Combat Marks into one saved balance.
  const legacyCoins=finiteInt(p.coins,0,0,Number.MAX_SAFE_INTEGER);
  const legacyMarks=finiteInt(p.combatMarks,0,0,Number.MAX_SAFE_INTEGER);
  s.coins=0;
  s.combatMarks=Math.min(Number.MAX_SAFE_INTEGER,legacyCoins+legacyMarks);
  s.totalKills=finiteInt(s.totalKills,0,0,Number.MAX_SAFE_INTEGER);
  s.arenaRating=finiteInt(s.arenaRating,1000,100,10000);s.arenaWins=finiteInt(s.arenaWins,0,0,Number.MAX_SAFE_INTEGER);s.arenaLosses=finiteInt(s.arenaLosses,0,0,Number.MAX_SAFE_INTEGER);s.arenaLastChallengeAt=finiteInt(s.arenaLastChallengeAt,0,0,Number.MAX_SAFE_INTEGER);s.arenaLastMatchAt=finiteInt(s.arenaLastMatchAt,0,0,Number.MAX_SAFE_INTEGER);
  s.coreLevel=finiteInt(s.coreLevel,1,1,1_000_000);s.coreHighestRarity=finiteInt(s.coreHighestRarity,2,2,Number.MAX_VALUE);
  s.autoTactic=(['balanced','aggressive','defensive','recovery'] as unknown[]).includes(s.autoTactic)?s.autoTactic:'balanced';
  s.scrap=finiteInt(s.scrap,0,0,Number.MAX_SAFE_INTEGER);s.autoScrapUnlocked=s.autoScrapUnlocked===true;s.autoScrapSettings=normalizeCombatAutoScrapSettings(s.autoScrapSettings);s.skillRolls=finiteInt(s.skillRolls,0,0,Number.MAX_SAFE_INTEGER);s.skillGachaRank=finiteInt(storedGachaRank,legacyUnlockedRank,1,SKILL_GACHA_RANK_MAX);s.skillPityEpic=finiteInt(s.skillPityEpic,0,0,9);s.skillPityMythic=finiteInt(s.skillPityMythic,0,0,39);s.orbFocusRarity=finiteInt(s.orbFocusRarity,2,2,Number.MAX_VALUE);s.orbFocusName=typeof s.orbFocusName==='string'?s.orbFocusName.slice(0,100):'Common Orb';s.combatUpgrades=Object.fromEntries(COMBAT_UPGRADES.map(upgrade=>[upgrade.id,finiteInt(s.combatUpgrades?.[upgrade.id],0,0,upgrade.maxRank)])) as CombatState['combatUpgrades'];s.sequence=finiteInt(s.sequence,0,0,Number.MAX_SAFE_INTEGER);s.lastAcceptedBeatAtMs=Math.min(finiteInt(s.lastAcceptedBeatAtMs,0,0,Number.MAX_SAFE_INTEGER),Date.now());s.combatBeats=finiteInt(s.combatBeats,0,0,Number.MAX_SAFE_INTEGER);
  s.playerActionsResolved=finiteInt(s.playerActionsResolved,0,0,Number.MAX_SAFE_INTEGER);s.enemyActionsResolved=finiteInt(s.enemyActionsResolved,0,0,Number.MAX_SAFE_INTEGER);s.playerTurnsCompleted=finiteInt(s.playerTurnsCompleted,0,0,Number.MAX_SAFE_INTEGER);
  s.strategyGuideRank=finiteInt(s.strategyGuideRank,0,0,STRATEGY_GUIDE_RANKS.length);
  s.tacticianManuals=finiteInt(s.tacticianManuals,0,0,1);
  // Remove the retired miss counter from older saved combat states.
  delete (s as CombatState & {bossesSinceManual?:unknown}).bossesSinceManual;
  const rawSkillRuntime=(p.skillRuntime&&typeof p.skillRuntime==='object'&&!Array.isArray(p.skillRuntime)?p.skillRuntime:{}) as Partial<CombatSkillRuntime>;
  const defaultSkillRuntime=createCombatSkillRuntime();
  s.skillRuntime={
    burnTicks:finiteInt(rawSkillRuntime.burnTicks,0,0,10),burnDamage:finiteInt(rawSkillRuntime.burnDamage,0,0,Number.MAX_SAFE_INTEGER),
    armorBreakBeats:finiteInt(rawSkillRuntime.armorBreakBeats,0,0,20),shield:finiteInt(rawSkillRuntime.shield,0,0,Number.MAX_SAFE_INTEGER),
    delayedDamage:finiteInt(rawSkillRuntime.delayedDamage,0,0,Number.MAX_SAFE_INTEGER),
    delayedDamageReadyAtSequence:finiteInt(rawSkillRuntime.delayedDamageReadyAtSequence,0,0,Number.MAX_SAFE_INTEGER),
    lastAttackDamage:finiteInt(rawSkillRuntime.lastAttackDamage,0,0,Number.MAX_SAFE_INTEGER),storedDamage:finiteInt(rawSkillRuntime.storedDamage,0,0,Number.MAX_SAFE_INTEGER),
    executeMarked:rawSkillRuntime.executeMarked===true,evadeNext:rawSkillRuntime.evadeNext===true,
    phoenixReady:rawSkillRuntime.phoenixReady===true,phoenixUsed:rawSkillRuntime.phoenixUsed===true,
    nextKillMarkBonus:finiteInt(rawSkillRuntime.nextKillMarkBonus,0,0,Number.MAX_SAFE_INTEGER),
    nextKillXpBonus:finiteInt(rawSkillRuntime.nextKillXpBonus,0,0,Number.MAX_SAFE_INTEGER),
    royalTitheKills:finiteInt(rawSkillRuntime.royalTitheKills,0,0,10),bountyStreak:finiteInt(rawSkillRuntime.bountyStreak,0,0,10),
    nextRuneDropBonus:Math.max(0,Math.min(.5,Number.isFinite(Number(rawSkillRuntime.nextRuneDropBonus))?Number(rawSkillRuntime.nextRuneDropBonus):defaultSkillRuntime.nextRuneDropBonus)),
  };
  s.maxEnergy=finiteInt(s.maxEnergy,5,1,50);s.energy=finiteInt(s.energy,Math.min(3,s.maxEnergy),0,s.maxEnergy);s.guardBeats=finiteInt(s.guardBeats,0,0,10);s.encounterFirstStrikeUsed=s.encounterFirstStrikeUsed===true;s.pendingHealAmount=finiteInt(s.pendingHealAmount,0,0,1_000_000_000);
  const defaults=createCombatState();
  const persisted=p as Partial<CombatState>&{
    inventoryByDungeon?:Partial<Record<CombatDungeonId,unknown>>;
    equipmentByDungeon?:Partial<Record<CombatDungeonId,Record<string,unknown>>>;
  };
  // Current inventory is authoritative when present; merge in old dungeon bags so previously collected gear is retained.
  const rawInventory:unknown[]=[];
  const hasPersistedInventory=Object.prototype.hasOwnProperty.call(p,'inventory')||
    Object.prototype.hasOwnProperty.call(p,'inventoryByDungeon')||
    (['undercrypt','cinder-vault','glass-labyrinth'] as const).some(dungeon=>Array.isArray(persisted.inventoryByDungeon?.[dungeon]));
  if(Array.isArray(p.inventory))for(const item of p.inventory)rawInventory.push(item);
  for(const dungeon of ['undercrypt','cinder-vault','glass-labyrinth'] as const){
    const legacyBag=persisted.inventoryByDungeon?.[dungeon];
    if(Array.isArray(legacyBag))for(const item of legacyBag)rawInventory.push(item);
  }
  // Default equipment is for genuinely old saves with no inventory field, not
  // players who deliberately scrapped every item or saved an empty bag.
  if(rawInventory.length===0&&!hasPersistedInventory)for(const item of defaults.inventory)rawInventory.push(item);
  const knownGearIds=new Set<string>();
  s.inventory=rawInventory.map(g=>normalizeGear(g,Math.max(0,s.depth-1))).filter((g):g is CombatGear=>{
    if(!g||knownGearIds.has(g.id))return false;
    knownGearIds.add(g.id);return true;
  });
  // Do not silently recreate starter gear when a persisted inventory was explicitly
  // empty or contained only invalid records; that masks corruption and undoes scrapping.
  // Restore only this run's tracked pickups, validating each ID against the permanent inventory.
  const knownRunIds=new Set<string>();
  const knownInventoryIds=new Set(s.inventory.map(g=>g.id));
  s.runInventoryIds=[];
  for(const value of Array.isArray(p.runInventoryIds)?p.runInventoryIds:[]){
    if(typeof value!=='string'||knownRunIds.has(value)||!knownInventoryIds.has(value))continue;
    knownRunIds.add(value);
    if(s.runInventoryIds.length<INVENTORY_CAP)s.runInventoryIds.push(value);
  }
  const savedEquipment=(p.equipment&&typeof p.equipment==='object'&&!Array.isArray(p.equipment)?p.equipment:persisted.equipmentByDungeon?.[s.dungeonId]) as Record<string,unknown>|undefined;
  const owns=(key:string)=>Boolean(savedEquipment&&Object.prototype.hasOwnProperty.call(savedEquipment,key));
  const savedSlot=(key:string):string|null=>savedEquipment&&typeof savedEquipment[key]==='string'&&savedEquipment[key]
    ?String(savedEquipment[key]):null;
  const desired:Record<CombatGearSlot,string|null>={
    weapon:owns('weapon')?savedSlot('weapon'):defaults.equipment.weapon,
    helmet:owns('helmet')?savedSlot('helmet'):null,
    armor:owns('armor')?savedSlot('armor'):owns('chest')?savedSlot('chest'):defaults.equipment.armor,
    gloves:owns('gloves')?savedSlot('gloves'):null,
    boots:owns('boots')?savedSlot('boots'):null,
    ring:owns('ring')?savedSlot('ring'):null,
    amulet:owns('amulet')?savedSlot('amulet'):null,
  };
  const explicitlyCleared=(slot:CombatGearSlot):boolean=>{
    if(!savedEquipment)return false;
    if(slot==='armor'&&owns('armor'))return savedEquipment.armor===null;
    if(slot==='armor'&&owns('chest'))return savedEquipment.chest===null;
    return owns(slot)&&savedEquipment[slot]===null;
  };
  const slots:CombatGearSlot[]=['weapon','armor','helmet','gloves','boots','ring','amulet'];
  const migratedEquipment={} as Record<CombatGearSlot,string|null>;
  for(const slot of slots){
    if(explicitlyCleared(slot)){migratedEquipment[slot]=null;continue;}
    const selected=s.inventory.find(g=>g.id===desired[slot]&&g.slot===slot);
    migratedEquipment[slot]=selected?.id??s.inventory.filter(g=>g.slot===slot).sort((a,b)=>b.power-a.power||b.quality-a.quality)[0]?.id??null;
  }
  s.equipment=migratedEquipment;
  // Discard only obsolete storage maps after merging their items into the persistent shared inventory.
  const legacyInventoryMaps=s as CombatState&{inventoryByDungeon?:unknown;equipmentByDungeon?:unknown};
  delete legacyInventoryMaps.inventoryByDungeon;
  delete legacyInventoryMaps.equipmentByDungeon;
  // Older saves didn't track per-run pickups, so their merged inventory remains owned and starts with an empty haul counter.
  const levels:Partial<Record<CombatSkillId,number>>={}, copyProgress:Partial<Record<CombatSkillId,number>>={}, cooldowns:Partial<Record<CombatSkillId,number>>={};
  for(const skill of COMBAT_SKILLS){
    const rank=finiteInt(s.skillLevels?.[skill.id],0,0,Number.MAX_SAFE_INTEGER);
    if(rank){levels[skill.id]=rank;copyProgress[skill.id]=finiteInt(s.skillCopyProgress?.[skill.id],0,0,Math.max(0,combatSkillCopiesForNextRank(rank)-1));}
    cooldowns[skill.id]=finiteInt(s.abilityCooldowns?.[skill.id],0,0,Number.MAX_SAFE_INTEGER);
  }
  s.skillLevels=levels;s.skillCopyProgress=copyProgress;s.abilityCooldowns=cooldowns;
  const ownedSkillIds=COMBAT_SKILLS.filter(skill=>(levels[skill.id]??0)>0).map(skill=>skill.id);
  const requestedEquipped=Array.isArray(p.equippedAbilities)?p.equippedAbilities.filter((id):id is CombatSkillId=>typeof id==='string'&&COMBAT_SKILLS.some(skill=>skill.id===id)&&ownedSkillIds.includes(id)):ownedSkillIds.slice(0,COMBAT_ABILITY_SLOTS);
  s.equippedAbilities=[...new Set(requestedEquipped)].slice(0,COMBAT_ABILITY_SLOTS);
  const normalizedRunes:CombatRune[]=[];
  const seenRuneIds=new Set<string>();
  for(const rawRune of Array.isArray(p.runes)?p.runes:[]){
    const rune=normalizeRune(rawRune);
    if(!rune||seenRuneIds.has(rune.id))continue;
    seenRuneIds.add(rune.id);normalizedRunes.push(rune);
  }
  s.runes=normalizedRunes.slice(-COMBAT_RUNE_INVENTORY_CAP);
  const ownedRuneIds=new Set(s.runes.map(rune=>rune.id));
  const requestedRunes=Array.isArray(p.equippedRunes)?p.equippedRunes.filter((id):id is string=>typeof id==='string'&&ownedRuneIds.has(id)):[];
  s.equippedRunes=[...new Set(requestedRunes)].slice(0,combatRuneSlotsUnlocked(s.level,Math.max(s.bestDepth,...Object.values(s.dungeonBestDepths))));
  const rawRuneAutoSacrifice = s.runeAutoSacrifice as Partial<CombatRuneAutoSacrificeSettings> | undefined;
  s.runeAutoSacrifice = {
    enabled: rawRuneAutoSacrifice?.enabled === true,
    maxRarity: COMBAT_RUNE_RARITIES.includes(rawRuneAutoSacrifice?.maxRarity as CombatRuneRarity)
      ? rawRuneAutoSacrifice!.maxRarity as CombatRuneRarity
      : DEFAULT_COMBAT_RUNE_AUTO_SACRIFICE_SETTINGS.maxRarity,
  };
  synchronizeCombatStats(s);
  // Legacy gear removal or malformed saves must not leave HP above the newly calculated max.
  s.health=finiteInt(s.health,s.maxHealth,0,Math.max(1,s.maxHealth));
  const enemy=getEnemyForDungeonDepth(s.dungeonId,s.depth);s.enemyHp=finiteInt(s.enemyHp,enemy.maxHp,1,enemy.maxHp);
  return s;
}
function createMajorAbility(qualityValue:number,requestedAbilityId?:CombatMajorAbility['id']):CombatMajorAbility {
  const quality=Math.max(0,Math.min(100,Number(qualityValue)||0));
  const v=(base:number,step:number)=>Math.round((base+quality*step)*1000)/1000;
  const f:Record<CombatMajorAbility['id'],()=>CombatMajorAbility>={
    'second-dawn':()=>({id:'second-dawn',name:'Second Dawn',trigger:'on-damage',healPercent:v(.10,.0005),description:'Queues a '+Math.round(v(.10,.0005)*100)+'% Max HP heal after incoming damage.'}),
    'chrono-surge':()=>({id:'chrono-surge',name:'Chrono Surge',trigger:'passive',speedPercent:v(.10,.0025),description:'Increases turn speed by '+Math.round(v(.10,.0025)*100)+'% while equipped.'}),
    'void-edge':()=>({id:'void-edge',name:'Void Edge',trigger:'passive',damagePercent:v(.08,.001),description:'Increases outgoing damage by '+Math.round(v(.08,.001)*100)+'% while equipped.'}),
    'aegis-ward':()=>({id:'aegis-ward',name:'Aegis Ward',trigger:'passive',damageReduction:v(.05,.0005),description:'Reduces incoming damage by '+Math.round(v(.05,.0005)*100)+'% while equipped.'}),
    'starfall':()=>({id:'starfall',name:'Starfall',trigger:'passive',critChanceBonus:v(.025,.00045),description:'Adds '+Math.round(v(.025,.00045)*1000)/10+' percentage points of critical-hit chance.'}),
    'mark-harvest':()=>({id:'mark-harvest',name:'Mark Harvest',trigger:'passive',markBonusPercent:v(.08,.001),description:'Increases Combat Marks from kills by '+Math.round(v(.08,.001)*100)+'%.'}),
    'titan-heart':()=>({id:'titan-heart',name:"Titan's Heart",trigger:'passive',maxHealthPercent:v(.08,.0012),description:'Increases maximum HP by '+Math.round(v(.08,.0012)*100)+'%.'}),
    'blood-drinker':()=>({id:'blood-drinker',name:'Blood Drinker',trigger:'passive',lifestealPercent:v(.04,.0012),description:'Restores '+Math.round(v(.04,.0012)*100)+'% of damage dealt as HP.'}),
    'executioner':()=>({id:'executioner',name:"Executioner's Sigil",trigger:'passive',executeDamagePercent:v(.1,.002),description:'Deals '+Math.round(v(.1,.002)*100)+'% bonus damage to enemies below 30% HP.'}),
    'emberwake':()=>({id:'emberwake',name:'Emberwake',trigger:'passive',burnChance:v(.15,.002),burnDamagePercent:v(.12,.002),description:'Hits have a '+Math.round(v(.15,.002)*100)+'% chance to ignite for '+Math.round(v(.12,.002)*100)+'% bonus Orb damage.'}),
    'mirrorplate':()=>({id:'mirrorplate',name:'Mirrorplate',trigger:'passive',reflectPercent:v(.04,.0012),description:'Reflects '+Math.round(v(.04,.0012)*100)+'% of incoming damage.'}),
    'last-bastion':()=>({id:'last-bastion',name:'Last Bastion',trigger:'passive',damageReduction:v(.06,.001),description:'Reduces incoming damage by '+Math.round(v(.06,.001)*100)+'% while below 35% HP.'}),
    'critical-mass':()=>({id:'critical-mass',name:'Critical Mass',trigger:'passive',critDamageBonus:v(.1,.0025),description:'Critical hits deal '+Math.round(v(.1,.0025)*100)+' percentage points more bonus damage.'}),
    'orb-conduit':()=>({id:'orb-conduit',name:'Orb Conduit',trigger:'passive',orbDamagePercent:v(.05,.0015),description:'Amplifies each beat Orb by '+Math.round(v(.05,.0015)*100)+'%.'}),
    'soul-harvest':()=>({id:'soul-harvest',name:'Soul Harvest',trigger:'passive',healOnKillPercent:v(.05,.001),description:'Restores '+Math.round(v(.05,.001)*100)+'% Max HP after every kill.'}),
    'salvagers-touch':()=>({id:'salvagers-touch',name:"Salvager's Touch",trigger:'passive',scrapBonusPercent:v(.1,.004),description:'Increases Scrap from gear by '+Math.round(v(.1,.004)*100)+'%.'}),
    'rune-savant':()=>({id:'rune-savant',name:'Rune Savant',trigger:'passive',runeDropBonusPercent:v(.025,.00075),description:'Adds '+Math.round(v(.025,.00075)*100)+' percentage points to non-boss Rune drop chance.'}),
    'bossbreaker':()=>({id:'bossbreaker',name:'Bossbreaker',trigger:'passive',bossDamagePercent:v(.15,.003),description:'Deals '+Math.round(v(.15,.003)*100)+'% bonus damage to bosses.'}),
    'echo-fang':()=>({id:'echo-fang',name:'Echo Fang',trigger:'passive',echoChance:v(.05,.0015),echoDamagePercent:v(.3,.003),description:'Hits have a '+Math.round(v(.05,.0015)*100)+'% chance to echo for '+Math.round(v(.3,.003)*100)+'% Orb damage.'}),
    'phase-shift':()=>({id:'phase-shift',name:'Phase Shift',trigger:'passive',evadeChance:v(.02,.0008),description:'Has a '+Math.round(v(.02,.0008)*100)+'% chance to evade each incoming attack.'}),
    'blood-moon':()=>({id:'blood-moon',name:'Blood Moon',trigger:'passive',lowHealthDamagePercent:v(.1,.002),description:'Deals '+Math.round(v(.1,.002)*100)+'% bonus damage while below 35% HP.'}),
    'deep-roots':()=>({id:'deep-roots',name:'Deep Roots',trigger:'passive',damagePerTenLevelsPercent:v(.008,.0002),description:'Damage increases by '+Math.round(v(.008,.0002)*1000)/10+'% per ten dungeon levels.'}),
    'frostbrand':()=>({id:'frostbrand',name:'Frostbrand',trigger:'passive',damageReduction:v(.03,.001),description:'Reduces incoming enemy damage by '+Math.round(v(.03,.001)*100)+'%.'}),
    'aegis-pulse':()=>({id:'aegis-pulse',name:'Aegis Pulse',trigger:'passive',shieldOnHitPercent:v(.015,.00075),description:'Adds a shield equal to '+Math.round(v(.015,.00075)*100)+'% Max HP after an enemy attack.'}),
    'glass-cannon':()=>({id:'glass-cannon',name:'Glass Cannon',trigger:'passive',damagePercent:v(.25,.003),damageTakenPercent:v(.08,.001),description:'Deals '+Math.round(v(.25,.003)*100)+'% more damage but takes '+Math.round(v(.08,.001)*100)+'% more damage.'}),
    'fortune-engine':()=>({id:'fortune-engine',name:'Fortune Engine',trigger:'passive',critMarkBonusPercent:v(.01,.0005),description:'Critical hits mint Combat Marks equal to '+Math.round(v(.01,.0005)*100)+'% of damage dealt.'}),
    'unending-ward':()=>({id:'unending-ward',name:'Unending Ward',trigger:'passive',shieldOnKillPercent:v(.04,.001),description:'Defeating an enemy adds a shield equal to '+Math.round(v(.04,.001)*100)+'% Max HP.'}),
    'full-moon':()=>({id:'full-moon',name:'Full Moon',trigger:'passive',critChanceBonus:v(.04,.001),description:'Adds '+Math.round(v(.04,.001)*100)+' percentage points of critical chance while at full HP.'}),
    'unstable-singularity':()=>({id:'unstable-singularity',name:'Unstable Singularity',trigger:'passive',burstChance:v(.04,.001),burstDamagePercent:v(.3,.007),description:'Hits have a '+Math.round(v(.04,.001)*100)+'% chance to burst for '+Math.round(v(.3,.007)*100)+'% bonus Orb damage.'}),
    'genesis-core':()=>({id:'genesis-core',name:'Genesis Core',trigger:'passive',regenPercent:v(.005,.0002),description:'Regenerates '+Math.round(v(.005,.0002)*1000)/10+'% Max HP each combat beat.'}),
    'expanded-reserves':()=>({id:'expanded-reserves',name:'Expanded Reserves',trigger:'passive',maxEnergyFlat:1+Math.floor(quality/20),description:'Increases maximum Energy by '+(1+Math.floor(quality/20))+' while equipped.'}),
    'third-beat-recharge':()=>({id:'third-beat-recharge',name:'Third-Beat Recharge',trigger:'passive',energyPerThreeTurns:1,description:'Restores +1 Energy every 3 completed player turns.'}),
  };
  const validRequested=requestedAbilityId&&COMBAT_MAJOR_ABILITY_IDS.includes(requestedAbilityId)?requestedAbilityId:null;
  return f[validRequested??pick([...COMBAT_MAJOR_ABILITY_IDS])]();
}
function createGear(sourceFloor:number,requestedSlot?:CombatGearSlot,requestedQuality?:number):CombatGear {
  const floor=Math.max(0,Math.min(COMBAT_MAX_DEPTH-1,Math.floor(Number(sourceFloor)||0)));
  const scale=floor+1;
  const slots:CombatGearSlot[]=['weapon','armor','helmet','gloves','boots','ring','amulet'];
  const slot=requestedSlot??pick(slots);
  // Natural drops remain random; Forge can supply an exact requested quality.
  const quality=Number.isFinite(Number(requestedQuality))?Math.round(Math.max(0,Math.min(100,Number(requestedQuality)))*100)/100:combatGearQualityFromRoll(secureRandom());
  const firstWords=['Ashen','Hollow','Cinder','Riftbound','Starforged','Warden’s','Lost','Quiet','Infinity-Touched','Dread','Veiled','Frostbitten'];
  const secondWords=['Riftbound','Starforged','Moonfallen','Emberwrought','Graveborn','Voidwoven','Dawnbreak','Stormforged','Frostmarked','Kingslayer','Nightglass','Runebound'];
  const nouns:Record<CombatGearSlot,string[]>={weapon:['Cleaver','Brand','Knife','Axe','Fang','Edge','Spear','Greatblade'],helmet:['Helm','Visor','Crown','Circlet','Mask'],armor:['Cuirass','Plate','Mantle','Hauberk','Aegis'],gloves:['Grips','Gauntlets','Handguards','Bindings'],boots:['Greaves','Strideboots','Treads','Sabatons'],ring:['Signet','Band','Loop','Ring'],amulet:['Pendant','Talisman','Medallion','Amulet']};
  const weaponTraits:CombatTrait[]=['bleed','keen','first-strike'], armorTraits:CombatTrait[]=['bulwark','regeneration','desperation'];
  const trait=slot==='weapon'?pick(weaponTraits):pick(armorTraits);
  const power=Math.max(1,Math.round(Math.min(1_000_000,scale)*combatGearStatBudgetMultiplier(quality)));
  const isProtective=['helmet','armor','gloves','boots'].includes(slot);
  // Slots have a natural bias, but random affixes create flexible item builds.
  const damageBonus=slot==='weapon'?Math.max(1,Math.round(power*.8)):secureRandom()<.45?Math.max(1,Math.round(power*.7)):0;
  // Turn-speed bonuses are granted only through Major Abilities, not ordinary gear affixes.
  const speedBonus=0;
  const maxHealthBonus=slot==='armor'?Math.max(5,Math.round(power*4)):isProtective?Math.max(0,Math.round(power*1.4)):secureRandom()<.2?Math.max(1,Math.round(power*.9)):0;
  const armorBonus=isProtective?Math.max(1,Math.round(power*(slot==='armor' ? .65 : .55))):secureRandom()<.25?Math.max(1,Math.round(power*.3)):0;
  const critChanceBonus=slot==='ring'||slot==='amulet'?Math.min(.30,.05+quality*.0025):secureRandom()<.28?Math.min(.30,.06+quality*.0028):0;
  const majorAbilityChance=combatMajorAbilityChance(quality);
  const majorAbility=secureRandom()<majorAbilityChance?createMajorAbility(quality):undefined;

  const firstWord=pick(firstWords),secondWord=pick(secondWords.filter(word=>word!==firstWord));
  return {id:'gear-'+Date.now().toString(36)+'-'+Math.floor(secureRandom()*0x7fffffff).toString(36),name:firstWord+' '+secondWord+' '+pick(nouns[slot]),slot,quality,sourceFloor:floor,power,trait,effect:traitText(trait),damageBonus,speedBonus,maxHealthBonus,armorBonus,critChanceBonus,...(majorAbility?{majorAbility}:{})};
}
function enemySnapshot(s:CombatState):CombatEnemy { const e=getEnemyForDungeonDepth(s.dungeonId,s.depth); const rawHp=Number(s.enemyHp); const hp=Number.isFinite(rawHp)?Math.max(0,Math.min(e.maxHp,rawHp)):e.maxHp; return {...e,hp}; }
function snapshot(s:CombatState):CombatSnapshot { return {state:s,enemy:enemySnapshot(s),stats:synchronizeCombatStats(s)}; }
async function mutate<T>(fn:(s:CombatState)=>T):Promise<T> {
  const key=combatKey();
  for(let i=0;i<MAX_CAS_ATTEMPTS;i++){
    const txn=await redis.watch(key);let closed=false;
    try { const s=normalizeState(await redis.get(key)),result=fn(s);await txn.multi();await txn.set(key,JSON.stringify(s));const commit=await txn.exec();closed=true;if(commit!==null)return result; }
    finally { if(!closed)await txn.unwatch().catch(()=>undefined); }
  }
  throw new Error('Combat state changed repeatedly. Please retry.');
}
/** Read the shared Combat Marks wallet for the global HUD without creating/writing combat state. */
export async function getCombatMarksBalance():Promise<number>{
  return normalizeState(await redis.get(combatKey())).combatMarks;
}
export async function getCombatSnapshot():Promise<CombatSnapshot>{
  let coreProgression:{level?:unknown;highestRarity?:unknown;autoScrapLevel?:unknown;autoScrapSettings?:unknown}|null=null;
  try {
    const core=await loadRaw({ registerActivity: false });
    coreProgression={level:core.level,highestRarity:core.highestRarity,autoScrapLevel:core.prestigeUpgrades?.autoScrap,autoScrapSettings:core.combatAutoScrap};
  } catch(error) {
    // Core-game progress is a bonus, not a prerequisite for loading combat.
    console.error('[Combat] Could not refresh core-game attunement; retaining saved values.',error);
  }
  const current=normalizeState(await redis.get(combatKey()));
  const nextCoreLevel=coreProgression?finiteInt(coreProgression.level,current.coreLevel,1,1_000_000):current.coreLevel;
  const nextCoreHighestRarity=coreProgression?finiteInt(coreProgression.highestRarity,current.coreHighestRarity,2,Number.MAX_VALUE):current.coreHighestRarity;
  const nextAutoScrapUnlocked=coreProgression?Number(coreProgression.autoScrapLevel)>0:current.autoScrapUnlocked;
  const nextAutoScrapSettings=coreProgression
    ? normalizeCombatAutoScrapSettings(coreProgression.autoScrapSettings)
    : { ...current.autoScrapSettings };
  if(!nextAutoScrapUnlocked)nextAutoScrapSettings.enabled=false;
  const projectionChanged=Boolean(coreProgression)&&(
    current.coreLevel!==nextCoreLevel||
    current.coreHighestRarity!==nextCoreHighestRarity||
    current.autoScrapUnlocked!==nextAutoScrapUnlocked||
    JSON.stringify(current.autoScrapSettings)!==JSON.stringify(nextAutoScrapSettings)
  );
  let state=current;
  if(projectionChanged){state=await mutate(s=>{
    s.coreLevel=nextCoreLevel;
    s.coreHighestRarity=nextCoreHighestRarity;
    s.autoScrapUnlocked=nextAutoScrapUnlocked;
    s.autoScrapSettings=nextAutoScrapSettings;
    synchronizeCombatStats(s);
    return s;
  });}
  synchronizeCombatStats(state);
  const userId=String(context.userId??'').trim();
  if(userId){
    const profile=createArenaProfile(userId,arenaName(context.username),state,Date.now());
    await redis.hSet(ARENA_PROFILE_KEY,{[userId]:JSON.stringify(profile)}).catch((error: unknown)=>console.error('[Combat Arena] Profile registration failed.',error));
  }
  return snapshot(state);
}

function grantXp(s:CombatState,amount:number,actions:CombatAction[]):void {
  const safeAmount=finiteInt(amount,0,0,Number.MAX_SAFE_INTEGER);
  s.xp=Math.min(Number.MAX_SAFE_INTEGER,finiteInt(s.xp,0,0,Number.MAX_SAFE_INTEGER)+safeAmount);
  while(s.xp>=s.xpToNext&&s.level<60){
    s.xp-=s.xpToNext;
    s.level+=1;
    s.xpToNext=Math.min(1_000_000_000,Math.max(1,Math.round(s.xpToNext*1.19)));
    synchronizeCombatStats(s);
    s.health=Math.min(s.maxHealth,s.health+Math.round(s.maxHealth*.08));
    actions.push({actor:'player',kind:'level',text:'Delver reached Level '+s.level+'.'});
  }
}

function chooseGuidedSkillId(s:CombatState,enemy:CombatEnemy):CombatSkillId|null {
  if(s.strategyGuideRank<1)return null;
  const energy=combatEnergyAfterRegen(s.energy,s.maxEnergy);
  const ready=s.equippedAbilities.map(id=>COMBAT_SKILLS.find(skill=>skill.id===id))
    .filter((skill):skill is CombatSkillDefinition=>skill!==undefined)
    .filter(skill=>(s.skillLevels[skill.id]??0)>0&&(s.abilityCooldowns[skill.id]??0)<=s.sequence&&energy>=combatSkillEnergyCost(skill.rarity));
  if(!ready.length)return null;
  const ids=new Set(ready.map(skill=>skill.id)),healthRatio=s.health/Math.max(1,s.maxHealth),tactic=s.autoTactic;
  let priority:CombatSkillId[]=[];
  if((s.strategyGuideRank>=2&&healthRatio<.38)||tactic==='recovery'||(tactic==='defensive'&&healthRatio<.65))priority.push('worldheart','deep-vitals','crystal-aegis','ironbark','titan-blood','phoenix-engine','lightstep');
  if(enemy.boss||tactic==='aggressive')priority.push('warden-slayer','worldbreaker','infinity-cleaver','annihilator','rift-hammer','fracture-math','execution-script');
  if(s.strategyGuideRank>=3){
    if(s.skillRuntime.armorBreakBeats<=0)priority.push('rift-hammer','sunder-mark','razor-current');
    else priority.push('fracture-math','annihilator','infinity-cleaver');
  }
  if(s.strategyGuideRank>=4){
    const weapon=s.inventory.find(item=>item.id===s.equipment.weapon);
    if(weapon?.trait==='bleed')priority.push('ember-lung');
    if(s.skillRuntime.delayedDamage>0)priority.push('afterimage');
    if(s.skillRuntime.storedDamage>0)priority.push('singularity-edge');
    if(weapon?.trait==='first-strike')priority.push('surefoot','lucky-fang');
    priority.push('astral-scavenger','royal-tithe','time-shear','starforged-core');
  }
  if(s.strategyGuideRank>=5){
    if(tactic==='aggressive')priority.push('quicksilver','blackstar-velocity','apex-instinct','steady-hand');
    else if(tactic==='defensive')priority.push('ironbark','crystal-aegis','starforged-core','worldheart');
    else priority.push('time-shear','afterimage','apex-instinct','coin-sense','infinite-bounty');
  }
  priority.push('ember-lung','razor-current','quicksilver','afterimage','steady-hand','lucky-fang','coin-sense','penny-hunter');
  for(const id of priority)if(ids.has(id))return id;
  const rarityOrder:Record<string,number>={Mythic:5,Epic:4,Rare:3,Uncommon:2,Common:1};
  ready.sort((a,b)=>rarityOrder[b.rarity]-rarityOrder[a.rarity]||a.name.localeCompare(b.name));
  return ready[0]?.id??null;
}

export async function hasCompletedCombatTutorial():Promise<boolean>{
  // Share the same fail-closed save validation as all combat reads. A damaged
  // save must not masquerade as an unseen tutorial and then be overwritten.
  return normalizeState(await redis.get(combatKey())).combatTutorialSeen;
}
export async function markCombatTutorialSeen():Promise<void>{
  await mutate(s=>{s.combatTutorialSeen=true;return undefined;});
}

export async function performCombatBeat(sequence:number,intent:CombatCommand,skillIdValue?:unknown,adminSkipCooldown=false):Promise<CombatSnapshot&{actions:CombatAction[];defeated:boolean;died:boolean;item?:CombatGear;orbRoll:CombatOrbRoll;abilityCast?:{id:CombatSkillId;rank:number;cooldown:number}}> {
  let orbLuck=1;
  try { orbLuck=luckMultiplier(await loadRaw()); }
  catch(error) { console.error('[Combat] Could not refresh Luck for the beat orb; using baseline Luck.',error); }
  return mutate(s=>{
    if(sequence!==s.sequence+1)throw new Error('stale combat sequence');
    if(s.depthCapCleared && s.depth>=COMBAT_MAX_DEPTH)throw new Error('Maximum supported depth reached. Switch dungeons to begin a new descent.');
    const manualSkillId=typeof skillIdValue==='string'&&COMBAT_SKILLS.some(skill=>skill.id===skillIdValue)?skillIdValue as CombatSkillId:null;
    const guideEnemy=getEnemyForDungeonDepth(s.dungeonId,s.depth);
    const predictedPlayerActions=combatActionsDue(s.speed,s.combatBeats+1,s.playerActionsResolved);
    const activeSkillId=intent==='ability'?manualSkillId:intent==='auto'&&predictedPlayerActions>0?chooseGuidedSkillId(s,guideEnemy):null;
    const activeSkill=activeSkillId?COMBAT_SKILLS.find(skill=>skill.id===activeSkillId):null;
    if(intent==='ability'&&!activeSkill)throw new Error('Choose a valid equipped ability.');
    if(activeSkill){
      if(!s.equippedAbilities.includes(activeSkill.id)||(s.skillLevels[activeSkill.id]??0)<1)throw new Error('Ability is not equipped.');
      if((s.abilityCooldowns[activeSkill.id]??0)>s.sequence)throw new Error('Ability is on cooldown.');
      if(combatEnergyAfterRegen(s.energy,s.maxEnergy)<combatSkillEnergyCost(activeSkill.rarity))throw new Error('Not enough energy for this ability.');
    }
    const activeSkillRank=activeSkill?Math.max(1,Number(s.skillLevels[activeSkill.id])||1):0;
    const now=Date.now();
    const elapsed=s.lastAcceptedBeatAtMs>0?Math.max(0,now-s.lastAcceptedBeatAtMs):Number.POSITIVE_INFINITY;
    if(!adminSkipCooldown&&elapsed<COMBAT_BEAT_INTERVAL_MS)throw new Error('COMBAT_BEAT_TOO_SOON:'+Math.max(1,COMBAT_BEAT_INTERVAL_MS-elapsed));
    s.lastAcceptedBeatAtMs=now;
    const actions:CombatAction[]=[];synchronizeCombatStats(s);s.sequence+=1;s.combatBeats+=1;s.energy=combatEnergyAfterRegen(s.energy,s.maxEnergy);
    if(s.pendingHealAmount>0){
      const heal=Math.min(s.pendingHealAmount,Math.max(0,s.maxHealth-s.health));s.pendingHealAmount=0;
      if(heal>0){s.health=Math.min(s.maxHealth,s.health+heal);actions.push({actor:'player',kind:'ability',text:'Second Dawn restored '+heal.toLocaleString()+' HP from its delayed heal.'});}
    }
    let enemy=getEnemyForDungeonDepth(s.dungeonId,s.depth);const stats=combatStatsFor(s);
     const majorTotal=(id:CombatMajorAbility['id'],property:string)=>equippedMajorAbilityTotal(s,id,property);
     const thirdBeatRecharge=majorTotal('third-beat-recharge','energyPerThreeTurns');
     const passiveLifesteal=Math.min(.35,majorTotal('blood-drinker','lifestealPercent'));
     const criticalDamageBonus=Math.min(1,majorTotal('critical-mass','critDamageBonus'));
     const orbConduitBonus=Math.min(.75,majorTotal('orb-conduit','orbDamagePercent'));
     const passiveMarkOnCrit=Math.min(.10,majorTotal('fortune-engine','critMarkBonusPercent'));
     const echoChance=Math.min(.5,majorTotal('echo-fang','echoChance'));
     const echoDamagePercent=Math.min(2,majorTotal('echo-fang','echoDamagePercent'));
     const emberwakeChance=Math.min(.5,majorTotal('emberwake','burnChance'));
     const emberwakeDamage=Math.min(1,majorTotal('emberwake','burnDamagePercent'));
     const singularityChance=Math.min(.3,majorTotal('unstable-singularity','burstChance'));
     const singularityDamage=Math.min(2,majorTotal('unstable-singularity','burstDamagePercent'));
     const phaseShiftChance=Math.min(.25,majorTotal('phase-shift','evadeChance'));
     const reflectionPercent=Math.min(.8,majorTotal('mirrorplate','reflectPercent'));
     const pulseShieldPercent=Math.min(.2,majorTotal('aegis-pulse','shieldOnHitPercent'));
     const soulHarvestPercent=Math.min(.5,majorTotal('soul-harvest','healOnKillPercent'));
     const unendingWardPercent=Math.min(.3,majorTotal('unending-ward','shieldOnKillPercent'));
     const genesisRegenPercent=Math.min(.05,majorTotal('genesis-core','regenPercent'));
     if(genesisRegenPercent>0&&s.health>0){const heal=Math.min(s.maxHealth-s.health,Math.max(0,Math.round(s.maxHealth*genesisRegenPercent)));if(heal>0){s.health+=heal;actions.push({actor:'player',kind:'ability',text:'Genesis Core regenerates '+heal.toLocaleString()+' HP.'});}}

    // Each accepted beat receives its own server-side cryptographic orb roll; rarity drives all attacks that beat.
    const rawOrbRarity=rollContinuum(orbLuck,secureRandom);
    const isInfinity=rawOrbRarity===Number.POSITIVE_INFINITY || rawOrbRarity>Number.MAX_VALUE;
    const orbRarity=Number.isFinite(rawOrbRarity)?Math.min(Number.MAX_VALUE,rawOrbRarity):Number.MAX_VALUE;
    const orbInfo=getOrbInfo(orbRarity,isInfinity),damageMultiplier=combatOrbDamageMultiplier(orbRarity);
    const orbRoll:CombatOrbRoll={rarity:orbRarity,tier:String(orbInfo.tier),name:orbInfo.name,isInfinity,damageMultiplier,baseDamage:Math.max(1,Math.round(stats.damage*damageMultiplier*(1+orbConduitBonus)))};
    actions.push({actor:'player',kind:'ability',text:'Orb roll: '+orbInfo.name+' · 1 / '+(isInfinity?'Infinity':orbRarity.toLocaleString())+' · ×'+damageMultiplier.toFixed(2)+' damage.'});
    const resolvedIntent:CombatIntent=activeSkill?'strike':intent==='auto'?chooseAutoCombatIntent(s):intent==='ability'?'strike':intent;
    const playerActions=combatActionsDue(stats.speed,s.combatBeats,s.playerActionsResolved);
    let enemyActions=combatActionsDue(enemy.speed,s.combatBeats,s.enemyActionsResolved);
    if(activeSkill&&playerActions<1)throw new Error('No player action is ready for this ability.');
    s.playerActionsResolved+=playerActions;s.enemyActionsResolved+=enemyActions;
    let enemyHp=Math.max(1,s.enemyHp||enemy.maxHp),heavy=false,consumed=false,defeated=false,died=false;
    if(s.skillRuntime.burnTicks>0&&s.skillRuntime.burnDamage>0&&enemyHp>1){
      const burn=Math.min(enemyHp-1,s.skillRuntime.burnDamage);enemyHp-=burn;s.skillRuntime.burnTicks=Math.max(0,s.skillRuntime.burnTicks-1);
      actions.push({actor:'player',kind:'ability',text:'Burn deals '+burn.toLocaleString()+' damage ('+s.skillRuntime.burnTicks+' ticks left).'});
    }else if(s.skillRuntime.burnTicks>0)s.skillRuntime.burnTicks=Math.max(0,s.skillRuntime.burnTicks-1);

    let item:CombatGear|undefined;
    let activeDamageMultiplier=1,activeGuaranteedCrit=false,activeExtraAttacks=0,activeFlurryMultiplier=1,activeLifesteal=0,activeThorns=0,activeMarksPerDamage=0,activeCritMarkBonus=0,activeFlatDamageBonus=0;
    let abilityCast:{id:CombatSkillId;rank:number;cooldown:number}|undefined;
    if(activeSkill){
      const energyCost=combatSkillEnergyCost(activeSkill.rarity);
      s.energy=Math.max(0,s.energy-energyCost);
      const cooldown=combatSkillCooldown(activeSkill.rarity,activeSkillRank);
      s.abilityCooldowns[activeSkill.id]=s.sequence+cooldown;
      abilityCast={id:activeSkill.id,rank:activeSkillRank,cooldown};
      const rankScale=Math.log2(activeSkillRank+1);
      const heal=(ratio:number)=>{const before=s.health;s.health=Math.min(s.maxHealth,s.health+Math.max(1,Math.round(s.maxHealth*ratio)));return s.health-before;};
      const addShield=(amount:number,capRatio=.75)=>{s.skillRuntime.shield=Math.min(Math.round(s.maxHealth*capRatio),s.skillRuntime.shield+Math.max(1,Math.round(amount)));};
      switch(activeSkill.id){
        case 'ember-lung':s.skillRuntime.burnTicks=Math.max(s.skillRuntime.burnTicks,Math.min(6,3+Math.floor(rankScale/2)));s.skillRuntime.burnDamage=Math.max(s.skillRuntime.burnDamage,Math.round(orbRoll.baseDamage*(.07+Math.min(.12,rankScale*.015))));activeDamageMultiplier=1.1+Math.min(.35,rankScale*.04);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' ignites the target for '+s.skillRuntime.burnTicks+' beats.'});break;
        case 'surefoot':activeExtraAttacks=combatEffectiveFlurryBonusAttacks(1+Math.floor(rankScale),playerActions);activeFlurryMultiplier=Math.min(.9,.58+Math.min(.25,rankScale*.04));s.skillRuntime.evadeNext=true;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' launches a quick combo and prepares an evasive step.'});break;
        case 'ironbark':{const before=s.skillRuntime.shield;addShield(s.maxHealth*(.12+Math.min(.18,rankScale*.025)),.5);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' adds '+(s.skillRuntime.shield-before).toLocaleString()+' shield.'});break;}
        case 'lucky-fang':activeGuaranteedCrit=true;activeDamageMultiplier=1.25+Math.min(.55,rankScale*.06);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' guarantees a critical opening strike.'});break;
        case 'penny-hunter':s.skillRuntime.nextKillMarkBonus=Math.min(Number.MAX_SAFE_INTEGER,s.skillRuntime.nextKillMarkBonus+combatBountyReward(.12,activeSkillRank));activeDamageMultiplier=1.1;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' places a bounty on this target.'});break;
        case 'razor-current':s.skillRuntime.armorBreakBeats=Math.max(s.skillRuntime.armorBreakBeats,2+Math.min(3,Math.floor(rankScale)));activeDamageMultiplier=1.35+Math.min(.5,rankScale*.06);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' pierces defenses; the target is exposed.'});break;
        case 'quicksilver':activeExtraAttacks=combatEffectiveFlurryBonusAttacks(1+Math.floor(rankScale*1.5),playerActions);activeFlurryMultiplier=Math.min(.72,.42+Math.min(.25,rankScale*.035));actions.push({actor:'player',kind:'ability',text:activeSkill.name+' unleashes '+activeExtraAttacks+' rapid bonus hits.'});break;
        case 'deep-vitals':{const restored=heal(Math.min(.65,.16+rankScale*.035));s.energy=Math.min(s.maxEnergy,s.energy+1);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' restores '+restored.toLocaleString()+' HP and 1 Energy.'});break;}
        case 'execution-script':s.skillRuntime.executeMarked=true;activeDamageMultiplier=1.15+Math.min(.3,rankScale*.035);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' marks the target for execution below 25% HP.'});break;
        case 'bone-collector':s.skillRuntime.nextKillXpBonus=Math.min(Number.MAX_SAFE_INTEGER,s.skillRuntime.nextKillXpBonus+Math.round(35+rankScale*18));activeDamageMultiplier=1.1+Math.min(.25,rankScale*.025);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' prepares bonus Delver XP for your next kill.'});break;
        case 'rift-hammer':s.skillRuntime.armorBreakBeats=Math.max(s.skillRuntime.armorBreakBeats,3+Math.min(4,Math.floor(rankScale)));activeDamageMultiplier=1.5+Math.min(.6,rankScale*.07);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' fractures enemy defenses for several beats.'});break;
        case 'afterimage':s.skillRuntime.delayedDamage=Math.min(Number.MAX_SAFE_INTEGER,Math.max(s.skillRuntime.delayedDamage,Math.round((s.skillRuntime.lastAttackDamage||orbRoll.baseDamage*.35)*(.45+Math.min(.5,rankScale*.04)))));s.skillRuntime.delayedDamageReadyAtSequence=s.sequence+1;activeDamageMultiplier=1.12;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' records an echo of your previous attack for the next beat.'});break;
        case 'titan-blood':activeLifesteal=Math.min(.25,.08+rankScale*.02);activeDamageMultiplier=1.18;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' leeches '+Math.round(activeLifesteal*100)+'% of damage dealt as HP.'});break;
        case 'fracture-math':if(s.skillRuntime.armorBreakBeats>0){activeGuaranteedCrit=true;activeDamageMultiplier=1.65+Math.min(.7,rankScale*.08);}else activeDamageMultiplier=1.25+Math.min(.35,rankScale*.04);actions.push({actor:'player',kind:'ability',text:activeSkill.name+(s.skillRuntime.armorBreakBeats>0?' exploits fractured armor for a guaranteed critical strike.':' primes a precision hit; armor break would amplify it.')});break;
        case 'gilded-kill':activeCritMarkBonus=Math.min(.5,.12+rankScale*.025);activeDamageMultiplier=1.12;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' converts critical hits into bonus Combat Marks.'});break;
        case 'singularity-edge':{const stored=s.skillRuntime.storedDamage;activeDamageMultiplier=1.25+Math.min(2.5,stored/Math.max(1,orbRoll.baseDamage));s.skillRuntime.storedDamage=0;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' releases '+Math.round(stored).toLocaleString()+' stored damage.'});break;}
        case 'time-shear':if(enemyActions>0){enemyActions-=1;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' cancels one enemy action.'});}for(const id of Object.keys(s.abilityCooldowns) as CombatSkillId[])if(id!==activeSkill.id)s.abilityCooldowns[id]=Math.max(s.sequence,Math.max(0,(s.abilityCooldowns[id]??0)-2));activeDamageMultiplier=1.15+Math.min(.25,rankScale*.025);break;
        case 'starforged-core':{const before=s.skillRuntime.shield;addShield(s.maxHealth*(.08+Math.min(.15,rankScale*.025)),.5);activeThorns=Math.min(.5,.12+rankScale*.025);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' forms a retaliating shield ('+(s.skillRuntime.shield-before).toLocaleString()+').'});break;}
        case 'apex-instinct':if(orbRarity>=1000){activeGuaranteedCrit=true;activeDamageMultiplier=1.6+Math.min(.8,rankScale*.08);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' resonates with the high-rarity Orb for an empowered critical.'});}else{activeDamageMultiplier=1.18+Math.min(.25,rankScale*.025);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' sharpens the strike; a 1-in-1,000 Orb threshold grants its full power.'});}break;
        case 'royal-tithe':s.skillRuntime.royalTitheKills=Math.max(s.skillRuntime.royalTitheKills,3+Math.min(3,Math.floor(rankScale/2)));activeDamageMultiplier=1.12;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' empowers Combat Mark rewards from your next kills.'});break;
        case 'infinity-cleaver':activeDamageMultiplier=1.38+Math.min(.65,rankScale*.06);if(enemyHp<=enemy.maxHp*.30)activeDamageMultiplier+=.75+Math.min(.8,rankScale*.06);actions.push({actor:'player',kind:'ability',text:activeSkill.name+(enemyHp<=enemy.maxHp*.30?' executes a wounded target with a devastating finisher.':' prepares a finisher for enemies below 30% HP.')});break;
        case 'chronos-heel':for(const id of Object.keys(s.abilityCooldowns) as CombatSkillId[])if(id!==activeSkill.id)s.abilityCooldowns[id]=Math.max(s.sequence,Math.max(0,(s.abilityCooldowns[id]??0)-2));activeDamageMultiplier=1.25+Math.min(.35,rankScale*.035);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' accelerates the recovery of your other abilities.'});break;
        case 'worldheart':{const restored=heal(Math.min(.6,.24+Math.min(.25,rankScale*.035)));addShield(s.maxHealth*(.08+Math.min(.12,rankScale*.02)),.5);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' restores '+restored.toLocaleString()+' HP and strengthens your shield.'});break;}
        case 'annihilator':activeDamageMultiplier=1.12+Math.min(1.2,(1-Math.max(0,enemyHp)/Math.max(1,enemy.maxHp))*.9)+Math.min(.25,rankScale*.025);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' grows more destructive as the target weakens.'});break;
        case 'infinite-bounty':{s.skillRuntime.bountyStreak=Math.min(10,s.skillRuntime.bountyStreak+1);const reward=Math.round(combatBountyReward(activeSkill.value,activeSkillRank)*(1+.12*(s.skillRuntime.bountyStreak-1)));const gained=Math.min(Number.MAX_SAFE_INTEGER-s.combatMarks,reward);s.combatMarks+=gained;activeDamageMultiplier=1.15;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' pays '+gained.toLocaleString()+' Combat Marks; bounty streak '+s.skillRuntime.bountyStreak+'/10.'});break;}
        case 'steady-hand':activeDamageMultiplier=1.35+Math.min(.35,rankScale*.04);s.energy=Math.min(s.maxEnergy,s.energy+1);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' steadies the strike and restores 1 Energy.'});break;
        case 'coin-sense':activeMarksPerDamage=Math.min(.25,.05+Math.min(.15,rankScale*.02));activeDamageMultiplier=1.08;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' converts a share of dealt damage into Combat Marks.'});break;
        case 'sunder-mark':s.skillRuntime.armorBreakBeats=Math.max(s.skillRuntime.armorBreakBeats,4+Math.min(4,Math.floor(rankScale)));activeDamageMultiplier=1.08;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' shreds the target guard for '+s.skillRuntime.armorBreakBeats+' beats.'});break;
        case 'lightstep':s.skillRuntime.evadeNext=true;s.energy=Math.min(s.maxEnergy,s.energy+1);activeDamageMultiplier=1.12;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' prepares an evade and restores 1 Energy.'});break;
        case 'warden-slayer':activeDamageMultiplier=enemy.boss?2.1+Math.min(.8,rankScale*.08):1.18+Math.min(.3,rankScale*.025);actions.push({actor:'player',kind:'ability',text:activeSkill.name+(enemy.boss?' strikes with bonus boss-slaying force.':' delivers a focused strike.')});break;
        case 'crystal-aegis':{const missing=Math.max(0,s.maxHealth-s.health),before=s.skillRuntime.shield;addShield(s.maxHealth*.07+missing*(.20+Math.min(.3,rankScale*.04)),.75);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' converts missing HP into '+(s.skillRuntime.shield-before).toLocaleString()+' shield.'});break;}
        case 'blackstar-velocity':activeExtraAttacks=combatEffectiveFlurryBonusAttacks(1+Math.floor(rankScale),playerActions);activeFlurryMultiplier=1.05+Math.min(.5,rankScale*.06);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' adds empowered bonus strikes.'});break;
        case 'astral-scavenger':s.skillRuntime.nextRuneDropBonus=Math.min(.5,s.skillRuntime.nextRuneDropBonus+.12+Math.min(.2,rankScale*.025));activeDamageMultiplier=1.12;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' attunes your next eligible kill to Rune drops.'});break;
        case 'worldbreaker':activeDamageMultiplier=1.3+Math.min(.45,rankScale*.045);activeFlatDamageBonus=Math.min(Math.round(enemy.maxHp*.20),Math.round(enemy.maxHp*(.07+Math.min(.13,rankScale*.015))));actions.push({actor:'player',kind:'ability',text:activeSkill.name+' adds '+activeFlatDamageBonus.toLocaleString()+' max-HP-based bonus damage.'});break;
        case 'phoenix-engine':if(!s.skillRuntime.phoenixUsed){s.skillRuntime.phoenixReady=true;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' arms a one-time survival spark for this encounter.'});}else{activeDamageMultiplier=1.5+Math.min(.5,rankScale*.05);actions.push({actor:'player',kind:'ability',text:activeSkill.name+' strikes after its survival spark has been spent.'});}break;
        default:activeDamageMultiplier=1.2+rankScale*.1;actions.push({actor:'player',kind:'ability',text:activeSkill.name+' empowers the strike.'});
      }
    }
    if(resolvedIntent==='heavy'&&s.energy>=3&&playerActions>0){s.energy-=3;heavy=true;actions.push({actor:'player',kind:'ability',text:'Heavy strike prepared.'});}
    else if(resolvedIntent==='guard'&&s.energy>=2&&playerActions>0){s.energy-=2;s.guardBeats=1;consumed=true;actions.push({actor:'player',kind:'ability',text:'Guard raised. Incoming hits are softened.'});}
    else if(resolvedIntent==='mend'&&s.health>=s.maxHealth&&playerActions>0)actions.push({actor:'player',kind:'ability',text:'Already at full health. Basic attacks continue.'});
    else if(resolvedIntent==='mend'&&s.energy>=4&&playerActions>0&&s.health<s.maxHealth){s.energy-=4;const before=s.health;s.health=Math.min(s.maxHealth,s.health+Math.max(1,Math.round(s.maxHealth*.14)));consumed=true;actions.push({actor:'player',kind:'ability',text:'Mend restored '+(s.health-before)+' HP.'});}
    else if(resolvedIntent!=='strike')actions.push({actor:'player',kind:'ability',text:'Not enough energy or no action ready. Basic attacks continue.'});
    // Every scheduled player action is a turn, including Heavy/Guard/Mend and skill casts.
    const previousCompletedTurns=s.playerTurnsCompleted;
    s.playerTurnsCompleted=Math.min(Number.MAX_SAFE_INTEGER,s.playerTurnsCompleted+playerActions);
    const rechargeTriggers=combatTurnsCrossedThree(previousCompletedTurns,s.playerTurnsCompleted);
    if(thirdBeatRecharge>0&&s.energy<s.maxEnergy){
      for(let trigger=0;trigger<rechargeTriggers&&s.energy<s.maxEnergy;trigger++){
        const restored=Math.min(s.maxEnergy-s.energy,Math.max(1,Math.round(thirdBeatRecharge)));
        s.energy+=restored;
        actions.push({actor:'player',kind:'ability',text:'Third-Beat Recharge restores '+restored+' Energy.'});
      }
    }
    const attacks=Math.min(1000,Math.max(0,playerActions-(consumed?1:0))+activeExtraAttacks),weapon=s.inventory.find(g=>g.id===s.equipment.weapon);
    for(let i=0;i<attacks;i++){
      if(enemyHp<=0)break;
      let multiplier=(heavy&&i===0?1.9:1)*(activeSkill&&i===0?activeDamageMultiplier:1)*(activeSkill&&combatAbilityType(activeSkill)==='flurry'&&i>=playerActions?activeFlurryMultiplier:1);
      if(s.skillRuntime.armorBreakBeats>0)multiplier*=1.15;
      if(enemy.boss)multiplier*=1+Math.min(1,majorTotal('bossbreaker','bossDamagePercent'));
      if(enemyHp<=enemy.maxHp*.30)multiplier*=1+Math.min(.75,majorTotal('executioner','executeDamagePercent'));
      if(s.health>0&&s.health<=s.maxHealth*.35)multiplier*=1+Math.min(1,majorTotal('blood-moon','lowHealthDamagePercent'));
      if(s.skillRuntime.executeMarked&&enemyHp<=enemy.maxHp*.25)multiplier*=1.45;
      if(activeSkill?.id==='infinity-cleaver'&&enemyHp<=enemy.maxHp*.30)multiplier*=1.25;
      if(activeSkill?.id==='annihilator')multiplier*=1+Math.min(.9,(1-enemyHp/Math.max(1,enemy.maxHp))*.65);
      if(!s.encounterFirstStrikeUsed){if(weapon?.trait==='first-strike')multiplier*=1+.5*gearQualityEffectiveness(weapon,Math.max(0,s.depth-1));s.encounterFirstStrikeUsed=true;}
      const crit=(activeSkill&&i===0&&activeGuaranteedCrit)||secureRandom()<stats.critChance;let damage=Math.max(1,Math.round(orbRoll.baseDamage*(crit?1.75+criticalDamageBonus:1)*multiplier));
      if(i===0&&activeFlatDamageBonus>0){damage+=activeFlatDamageBonus;activeFlatDamageBonus=0;}
      if(i===0&&s.skillRuntime.delayedDamage>0&&s.skillRuntime.delayedDamageReadyAtSequence<=s.sequence){
        const echo=Math.min(s.skillRuntime.delayedDamage,Math.max(0,enemyHp-1));damage+=echo;s.skillRuntime.delayedDamage=0;s.skillRuntime.delayedDamageReadyAtSequence=0;
        if(echo>0)actions.push({actor:'player',kind:'ability',text:'Afterimage replays '+echo.toLocaleString()+' damage.'});
      }
      if(weapon?.trait==='bleed'&&secureRandom()<.18*gearQualityEffectiveness(weapon,Math.max(0,s.depth-1))){const bleed=Math.max(1,Math.round(orbRoll.baseDamage*.3*gearQualityEffectiveness(weapon,Math.max(0,s.depth-1))));damage+=bleed;actions.push({actor:'player',kind:'ability',text:'Bleed adds '+bleed+' damage.'});}
      if(emberwakeChance>0&&secureRandom()<emberwakeChance){const burn=Math.max(1,Math.round(orbRoll.baseDamage*emberwakeDamage));damage+=burn;actions.push({actor:'player',kind:'ability',text:'Emberwake ignites the hit for '+burn.toLocaleString()+' bonus damage.'});}
      if(echoChance>0&&secureRandom()<echoChance){const echo=Math.max(1,Math.round(orbRoll.baseDamage*echoDamagePercent));damage+=echo;actions.push({actor:'player',kind:'ability',text:'Echo Fang repeats the strike for '+echo.toLocaleString()+' bonus damage.'});}
      if(singularityChance>0&&secureRandom()<singularityChance){const burst=Math.max(1,Math.round(orbRoll.baseDamage*singularityDamage));damage+=burst;actions.push({actor:'player',kind:'ability',text:'Unstable Singularity bursts for '+burst.toLocaleString()+' extra damage.'});}
      const appliedDamage=Math.min(damage,Math.max(1,enemyHp));enemyHp-=appliedDamage;s.skillRuntime.lastAttackDamage=appliedDamage;
      const totalLifesteal=Math.min(.6,activeLifesteal+passiveLifesteal);
      if(totalLifesteal>0){const restored=Math.min(s.maxHealth-s.health,Math.max(0,Math.round(appliedDamage*totalLifesteal)));if(restored>0){s.health+=restored;actions.push({actor:'player',kind:'ability',text:(passiveLifesteal>0?'Blood Drinker':'Titan Blood')+' restores '+restored.toLocaleString()+' HP.'});}}
      if(activeMarksPerDamage>0){const gained=Math.min(Number.MAX_SAFE_INTEGER-s.combatMarks,Math.max(0,Math.round(appliedDamage*activeMarksPerDamage)));if(gained>0){s.combatMarks+=gained;actions.push({actor:'player',kind:'loot',text:'Coin Sense converts damage into '+gained.toLocaleString()+' Combat Marks.'});}}
      if(crit&&activeCritMarkBonus>0){const gained=Math.min(Number.MAX_SAFE_INTEGER-s.combatMarks,Math.max(0,Math.round(appliedDamage*activeCritMarkBonus)));if(gained>0){s.combatMarks+=gained;actions.push({actor:'player',kind:'loot',text:'Gilded Kill mints '+gained.toLocaleString()+' Combat Marks.'});}}
      if(crit&&passiveMarkOnCrit>0){const gained=Math.min(Number.MAX_SAFE_INTEGER-s.combatMarks,Math.max(0,Math.round(appliedDamage*passiveMarkOnCrit)));if(gained>0){s.combatMarks+=gained;actions.push({actor:'player',kind:'loot',text:'Fortune Engine mints '+gained.toLocaleString()+' Combat Marks.'});}}
      if(activeSkill?.id!=='singularity-edge')s.skillRuntime.storedDamage=Math.min(Math.round(s.maxHealth*2),s.skillRuntime.storedDamage+Math.round(appliedDamage*.04));
      actions.push({actor:'player',kind:'attack',damage:appliedDamage,text:(crit?'Critical hit for ':'Strike for ')+appliedDamage+' damage.'});
      if(enemyHp<=0){
        defeated=true;actions.push({actor:'player',kind:'death',text:'The '+enemy.name+' falls.'});s.totalKills=Math.min(Number.MAX_SAFE_INTEGER,s.totalKills+1);
        if(soulHarvestPercent>0){const healed=Math.min(s.maxHealth-s.health,Math.max(0,Math.round(s.maxHealth*soulHarvestPercent)));if(healed>0){s.health+=healed;actions.push({actor:'player',kind:'ability',text:'Soul Harvest restores '+healed.toLocaleString()+' HP.'});}}
        if(unendingWardPercent>0){const before=s.skillRuntime.shield;s.skillRuntime.shield=Math.min(Math.round(s.maxHealth*.75),s.skillRuntime.shield+Math.max(1,Math.round(s.maxHealth*unendingWardPercent)));actions.push({actor:'player',kind:'ability',text:'Unending Ward adds '+(s.skillRuntime.shield-before).toLocaleString()+' shield.'});}
        const coins=Math.max(1,Math.round((12+s.depth*2.4)*stats.coinMultiplier*(s.dungeonId==='cinder-vault'?1.4:1)));
        const baseMarks=Math.max(1,2+Math.floor(Math.max(0,s.depth-1)/2)+(enemy.kind==='elite'?2:enemy.boss?8:0));
        let marks=Math.max(1,Math.round(baseMarks*combatMarkMultiplier(s)));
        if(s.skillRuntime.royalTitheKills>0){marks=Math.min(Number.MAX_SAFE_INTEGER,Math.round(marks*1.35));s.skillRuntime.royalTitheKills-=1;}
        if(s.skillRuntime.bountyStreak>0)marks=Math.min(Number.MAX_SAFE_INTEGER,Math.round(marks*(1+Math.min(.5,s.skillRuntime.bountyStreak*.04))));
        const combinedReward=Math.min(Number.MAX_SAFE_INTEGER-s.combatMarks,coins+marks+s.skillRuntime.nextKillMarkBonus);
        s.skillRuntime.nextKillMarkBonus=0;s.combatMarks+=combinedReward;
        actions.push({actor:'player',kind:'loot',text:'Earned '+combinedReward.toLocaleString()+' Combat Marks from the kill.'});
        let killXp=Math.round((18+s.depth*4.2)*(s.dungeonId==='glass-labyrinth'?1.25:1))+s.skillRuntime.nextKillXpBonus;
        if(s.skillRuntime.nextKillXpBonus>0)actions.push({actor:'player',kind:'loot',text:'Bone Collector adds '+s.skillRuntime.nextKillXpBonus.toLocaleString()+' bonus Delver XP.'});
        s.skillRuntime.nextKillXpBonus=0;grantXp(s,killXp,actions);
        const runeDropChance=enemy.boss?1:Math.min(.95,(enemy.kind==='elite'?Math.min(.5,.24+s.depth*.001):Math.min(.18,.07+s.depth*.0008))+s.skillRuntime.nextRuneDropBonus+Math.min(.20,majorTotal('rune-savant','runeDropBonusPercent')));
        if(secureRandom()<runeDropChance){
          const rune=createCombatRune(Math.max(0,s.depth-1),s.dungeonId,s.totalKills,s.sequence);
          const qualifiesForAutoSacrifice = s.runeAutoSacrifice.enabled &&
            combatRuneRarityAtOrBelow(rune.rarity, s.runeAutoSacrifice.maxRarity);
          const targets = qualifiesForAutoSacrifice ? getEquippedRuneTargets(s) : [];
          const target = targets.length ? pick(targets) : null;
          if(target){
            const result = grantRuneSacrificeExperience(target, rune);
            actions.push({actor:'player',kind:'loot',text:'Auto-strengthened '+target.name+' with '+rune.name+': +'+result.gainedXp.toLocaleString()+' Rune XP (Level '+(result.level)+').'});
          }else if(s.runes.length>=COMBAT_RUNE_INVENTORY_CAP){
            actions.push({actor:'player',kind:'loot',text:'Rune stash full: '+rune.name+' could not be stored. Sacrifice a Rune in the Runes menu to free a slot.'});
          }else{
            s.runes.push(rune);
            actions.push({actor:'player',kind:'loot',text:rune.rarity+' Rune found: '+rune.name+' · '+combatRuneEffectText(rune)+'.'+(qualifiesForAutoSacrifice?' Auto-sacrifice needs an equipped Rune target; this Rune was kept in inventory.':' Equip it in Runes to boost the main game.')});
          }
        }
        s.skillRuntime.nextRuneDropBonus=0;
        if(enemy.boss&&s.strategyGuideRank<STRATEGY_GUIDE_RANKS.length&&s.tacticianManuals===0){
          const manualChance=tacticianManualDropChance(s.strategyGuideRank);
          if(manualChance>0&&secureRandom()<manualChance){
            s.tacticianManuals=1;
            actions.push({actor:'player',kind:'loot',text:"Boss drop: Tactician's Manual! ("+(manualChance*100).toFixed(1)+"% chance at Strategy Guide Rank "+s.strategyGuideRank+")."});
          }
        }
        if((s.dungeonId==='cinder-vault'?s.depth%4===0:s.depth%5===0)||enemy.kind!=='common'||enemy.boss){
          item=createGear(Math.max(0,s.depth-1));
          if(s.autoScrapUnlocked&&s.autoScrapSettings.enabled&&item.quality<=s.autoScrapSettings.maxQuality){
            const gained=Math.round(combatScrapValue(item)*(1+Math.min(2,equippedMajorAbilityTotal(s,'salvagers-touch','scrapBonusPercent'))));s.scrap=Math.min(Number.MAX_SAFE_INTEGER,s.scrap+gained);
            actions.push({actor:'player',kind:'loot',text:'Auto-scrapped '+item.name+' ('+item.quality.toFixed(2)+'% quality) for '+gained+' Scrap.'});
            item=undefined;
          } else {addCombatGearToInventory(s,item);actions.push({actor:'player',kind:'loot',text:'Gear found: '+item.name+' ('+item.quality.toFixed(2)+'% quality).'});}
        }
        const regeneration=s.inventory.find(g=>Object.values(s.equipment).includes(g.id)&&g.trait==='regeneration');
        if(regeneration&&enemy.kind!=='common'){s.health=Math.min(s.maxHealth,s.health+Math.round(s.maxHealth*.02*gearQualityEffectiveness(regeneration,Math.max(0,s.depth-1))));actions.push({actor:'player',kind:'ability',text:'Regeneration restored 2% max HP.'});}
        s.bestDepth=Math.max(s.bestDepth,s.depth);
        s.dungeonBestDepths[s.dungeonId]=Math.max(s.dungeonBestDepths[s.dungeonId],s.bestDepth);
        s.skillRuntime.burnTicks=0;s.skillRuntime.burnDamage=0;s.skillRuntime.armorBreakBeats=0;s.skillRuntime.shield=0;s.skillRuntime.delayedDamage=0;s.skillRuntime.delayedDamageReadyAtSequence=0;s.skillRuntime.executeMarked=false;s.skillRuntime.evadeNext=false;s.skillRuntime.phoenixReady=false;s.skillRuntime.phoenixUsed=false;s.skillRuntime.storedDamage=0;
        s.combatBeats=0;s.playerActionsResolved=0;s.enemyActionsResolved=0;s.guardBeats=0;s.encounterFirstStrikeUsed=false;
        if(s.depth>=COMBAT_MAX_DEPTH){
          // The last supported boss can be cleared once. Keep the displayed depth
          // at its real cap, then require a dungeon switch before any further beats.
          s.depth=COMBAT_MAX_DEPTH;
          s.bestDepth=COMBAT_MAX_DEPTH;
          s.dungeonBestDepths[s.dungeonId]=Math.max(s.dungeonBestDepths[s.dungeonId],COMBAT_MAX_DEPTH);
          s.depthCapCleared=true;
          s.runId+=1;
          resetCombatRunCarry(s);
          s.pendingHealAmount=0;
          s.energy=Math.min(s.maxEnergy,3);
          s.enemyHp=enemy.maxHp;
          synchronizeCombatStats(s);
          s.health=s.maxHealth;
          actions.push({actor:'player',kind:'advance',text:'Maximum supported depth reached. This dungeon is cleared at Depth '+COMBAT_MAX_DEPTH+'. Switch dungeons to begin a new descent; permanent progress remains.'});
        }else{
          s.depth+=1;s.bestDepth=Math.max(s.bestDepth,s.depth);s.dungeonBestDepths[s.dungeonId]=Math.max(s.dungeonBestDepths[s.dungeonId],s.bestDepth);s.energy=Math.min(s.maxEnergy,s.energy+1);
          enemy=getEnemyForDungeonDepth(s.dungeonId,s.depth);s.enemyHp=enemy.maxHp;actions.push({actor:'player',kind:'advance',text:'Descending to Depth '+s.depth+'.'});
        }
        break;
      }
    }
    let guardWasUsed=false;
    if(!defeated)for(let i=0;i<enemyActions;i++){
      if(s.skillRuntime.evadeNext){s.skillRuntime.evadeNext=false;actions.push({actor:'player',kind:'ability',text:'Evasion avoids the incoming hit.'});continue;}
       if(phaseShiftChance>0&&secureRandom()<phaseShiftChance){actions.push({actor:'player',kind:'ability',text:'Phase Shift evades the incoming attack.'});continue;}
      let incoming=enemy.damage,strike='The '+enemy.name+' hits for ';
      if(enemy.boss&&s.combatBeats%4===0){incoming=Math.round(incoming*1.75);strike='The '+enemy.name+' cleaves for ';}
      else if(enemy.id.endsWith('ember-acolyte')&&s.combatBeats%3===0){incoming+=Math.round(s.maxHealth*.035);strike='The Ember Acolyte burns for ';}
      if(s.guardBeats>0){incoming=Math.round(incoming*.45);guardWasUsed=true;}
      incoming=Math.max(1,Math.round(incoming*(1-stats.damageReduction)));
      const absorbed=Math.min(s.skillRuntime.shield,incoming);
      if(absorbed>0){s.skillRuntime.shield-=absorbed;incoming-=absorbed;actions.push({actor:'player',kind:'ability',text:'Shield absorbs '+absorbed.toLocaleString()+' damage.'});}
      if(incoming>0)s.health=Math.max(0,s.health-incoming);
      const totalReflection=Math.min(.8,activeThorns+reflectionPercent);
      if(totalReflection>0&&enemyHp>1){const reflected=Math.min(enemyHp-1,Math.max(0,Math.round((incoming+absorbed)*totalReflection)));if(reflected>0){enemyHp-=reflected;actions.push({actor:'player',kind:'attack',damage:reflected,text:(reflectionPercent>0?'Mirrorplate':'Starforged Core')+' reflects '+reflected.toLocaleString()+' damage.'});}}
      actions.push({actor:'enemy',kind:'attack',damage:incoming,text:incoming>0?strike+incoming+' damage.':strike+' The shield blocks the hit.'});
      if(pulseShieldPercent>0&&incoming+absorbed>0){const before=s.skillRuntime.shield;s.skillRuntime.shield=Math.min(Math.round(s.maxHealth*.75),s.skillRuntime.shield+Math.max(1,Math.round(s.maxHealth*pulseShieldPercent)));if(s.skillRuntime.shield>before)actions.push({actor:'player',kind:'ability',text:'Aegis Pulse builds '+(s.skillRuntime.shield-before).toLocaleString()+' shield.'});}
      const defensiveAbility=s.inventory.find(g=>g.majorAbility?.id==='second-dawn'&&g.majorAbility.trigger==='on-damage'&&Object.values(s.equipment).includes(g.id))?.majorAbility;
      if(defensiveAbility?.id==='second-dawn'&&s.pendingHealAmount===0){
        s.pendingHealAmount=Math.max(1,Math.round(s.maxHealth*defensiveAbility.healPercent));
        actions.push({actor:'player',kind:'ability',text:defensiveAbility.name+' triggered: '+Math.round(defensiveAbility.healPercent*100)+'% Max HP healing queued for your next turn.'});
      }
      if(s.health<=0&&s.skillRuntime.phoenixReady&&!s.skillRuntime.phoenixUsed){s.health=1;s.skillRuntime.phoenixReady=false;s.skillRuntime.phoenixUsed=true;actions.push({actor:'player',kind:'ability',text:'Phoenix Engine prevents a lethal blow and leaves you at 1 HP.'});}
      if(s.health<=0){died=true;s.pendingHealAmount=0;actions.push({actor:'enemy',kind:'death',text:'Run '+s.runId+' ended at Depth '+s.depth+'. Permanent progress retained.'});s.runId+=1;s.depth=1;resetCombatRunCarry(s);s.skillRuntime.burnTicks=0;s.skillRuntime.burnDamage=0;s.skillRuntime.armorBreakBeats=0;s.skillRuntime.shield=0;s.skillRuntime.delayedDamage=0;s.skillRuntime.delayedDamageReadyAtSequence=0;s.skillRuntime.executeMarked=false;s.skillRuntime.evadeNext=false;s.skillRuntime.phoenixReady=false;s.skillRuntime.phoenixUsed=false;s.skillRuntime.bountyStreak=0;s.skillRuntime.storedDamage=0;s.skillRuntime.lastAttackDamage=0;s.skillRuntime.nextKillMarkBonus=0;s.skillRuntime.nextKillXpBonus=0;s.skillRuntime.nextRuneDropBonus=0;s.skillRuntime.royalTitheKills=0;s.combatBeats=0;s.playerActionsResolved=0;s.enemyActionsResolved=0;s.energy=Math.min(s.maxEnergy,3);s.guardBeats=0;s.encounterFirstStrikeUsed=false;s.enemyHp=getEnemyForDungeonDepth(s.dungeonId,1).maxHp;synchronizeCombatStats(s);s.health=s.maxHealth;actions.push({actor:'player',kind:'advance',text:'A new descent begins automatically at Depth 1.'});break;}
    }
    // Persist surviving enemy damage, including Burn and thorns contributions.
    if(!defeated&&!died)s.enemyHp=Math.max(1,enemyHp);
    // If no enemy action fires, preserve Guard until the next actual incoming strike.
    if(guardWasUsed)s.guardBeats=0;
    if(s.skillRuntime.armorBreakBeats>0)s.skillRuntime.armorBreakBeats=Math.max(0,s.skillRuntime.armorBreakBeats-1);
    synchronizeCombatStats(s);
    return {...snapshot(s),actions,defeated,died,orbRoll,...(item?{item}:{}),...(abilityCast?{abilityCast}:{})};
  });
}
export async function equipCombatItem(itemId:string):Promise<CombatSnapshot>{return mutate(s=>{const item=s.inventory.find(g=>g.id===itemId);if(!item)throw new Error('item not owned');s.equipment[item.slot]=item.id;synchronizeCombatStats(s);return snapshot(s);});}

export async function scrapCombatItem(itemIdValue:unknown):Promise<CombatSnapshot&{scrapResult:{itemName:string;gained:number;total:number}}>{
  if(typeof itemIdValue!=='string'||!itemIdValue.trim()||itemIdValue.length>160)throw new Error('A valid gear item is required.');
  return mutate(state=>{
    const item=state.inventory.find(gear=>gear.id===itemIdValue);
    if(!item)throw new Error('Gear item is not in your inventory.');
    if(Object.values(state.equipment).includes(item.id))throw new Error('Unequip this item before scrapping it.');
    state.inventory=state.inventory.filter(gear=>gear.id!==item.id);
    state.runInventoryIds=state.runInventoryIds.filter(id=>id!==item.id);
    const gained=Math.round(combatScrapValue(item)*(1+Math.min(2,equippedMajorAbilityTotal(state,'salvagers-touch','scrapBonusPercent'))));state.scrap=Math.min(Number.MAX_SAFE_INTEGER,state.scrap+gained);
    return {...snapshot(state),scrapResult:{itemName:item.name,gained,total:state.scrap}};
  });
}

export async function forgeCombatGear(slotValue:unknown,qualityValue?:unknown):Promise<CombatSnapshot&{forgeResult:{item:CombatGear;cost:number;remainingScrap:number}}>{
  if(typeof slotValue!=='string')throw new Error('Choose a valid equipment slot for the Forge.');
  // The client-facing name "chest" maps to the persisted gear slot "armor".
  const requestedSlot=slotValue==='chest'?'armor':slotValue;
  const isCombatGearSlot=(value:string):value is CombatGearSlot=>
    ['weapon','armor','helmet','gloves','boots','ring','amulet'].includes(value);
  if(!isCombatGearSlot(requestedSlot))throw new Error('Choose a valid equipment slot for the Forge.');
  let requestedQuality:number|undefined;
  if(qualityValue!==undefined){
    const rawQuality=Number(qualityValue);
    if(!Number.isFinite(rawQuality)||rawQuality<0||rawQuality>100)throw new Error('Choose a valid item quality for the Forge.');
    requestedQuality=Math.round(rawQuality*100)/100;
  }
  return mutate(state=>{
    const floor=Math.max(0,state.depth-1);
    const cost=requestedQuality===undefined?combatForgeCost(floor):combatForgeQualityCost(floor,requestedQuality);
    if(state.scrap<cost)throw new Error('Not enough Scrap to forge this item.');
    state.scrap-=cost;
    const item=createGear(floor,requestedSlot,requestedQuality);
    addCombatGearToInventory(state,item);
    return {...snapshot(state),forgeResult:{item,cost,remainingScrap:state.scrap}};
  });
}


export async function buyCombatStrategyGuideRank():Promise<CombatSnapshot>{
  return mutate(s=>{
    const requirement=STRATEGY_GUIDE_RANKS.find(entry=>entry.rank===s.strategyGuideRank+1);
    if(!requirement)throw new Error('Strategy Guide is already max rank.');
    if(s.tacticianManuals<requirement.manualCost)throw new Error("Need a Tactician's Manual.");
    if(s.combatMarks<requirement.markCost)throw new Error('Not enough Combat Marks for Strategy Guide.');
    s.tacticianManuals-=requirement.manualCost;s.combatMarks-=requirement.markCost;s.strategyGuideRank=requirement.rank;
    return snapshot(s);
  });
}

function grantRuneSacrificeExperience(target: CombatRune, donor: Pick<CombatRune, 'rarity'|'level'|'sourceDepth'>): { gainedXp: number; totalXp: number; level: number } {
  const currentXp = Number.isFinite(Number(target.experience))
    ? Math.max(0, Math.floor(Number(target.experience)))
    : combatRuneExperienceForLevel(target.level ?? 1);
  const gainedXp = combatRuneSacrificeExperience(donor);
  const totalXp = Math.min(Number.MAX_SAFE_INTEGER, currentXp + gainedXp);
  target.experience = totalXp;
  target.level = combatRuneLevelFromExperience(totalXp);
  return { gainedXp, totalXp, level: target.level ?? 1 };
}
function getEquippedRuneTargets(s: CombatState): CombatRune[] {
  return s.equippedRunes
    .map(id => s.runes.find(rune => rune.id === id))
    .filter((rune): rune is CombatRune => Boolean(rune));
}
function processAutoSacrificeForCurrentInventory(s: CombatState): { runesSacrificed: number; totalXp: number } {
  const targets = getEquippedRuneTargets(s);
  if (!targets.length) throw new Error('Equip at least one Rune before auto-sacrifice can strengthen a target.');
  const equipped = new Set(s.equippedRunes);
  const donors = s.runes.filter(rune =>
    !equipped.has(rune.id) && combatRuneRarityAtOrBelow(rune.rarity, s.runeAutoSacrifice.maxRarity));
  const donorIds = new Set(donors.map(rune => rune.id));
  let totalXp = 0;
  for (const donor of donors) {
    // Pick an equipped Rune uniformly for every donor so the loadout receives the XP.
    const target = pick(targets);
    const result = grantRuneSacrificeExperience(target, donor);
    totalXp = Math.min(Number.MAX_SAFE_INTEGER, totalXp + result.gainedXp);
  }
  s.runes = s.runes.filter(rune => !donorIds.has(rune.id));
  return { runesSacrificed: donors.length, totalXp };
}
export async function updateCombatRuneAutoSacrificeSettings(enabledValue: unknown, maxRarityValue: unknown): Promise<CombatSnapshot> {
  if (typeof enabledValue !== 'boolean' ||
      typeof maxRarityValue !== 'string' ||
      !COMBAT_RUNE_RARITIES.includes(maxRarityValue as CombatRuneRarity)) {
    throw new Error('Auto-sacrifice settings are invalid.');
  }
  return mutate(s => {
    s.runeAutoSacrifice = { enabled: enabledValue, maxRarity: maxRarityValue as CombatRuneRarity };
    return snapshot(s);
  });
}
export async function processCombatRuneAutoSacrifice(): Promise<CombatSnapshot & { runeAutoSacrificeResult: { runesSacrificed: number; totalXp: number } }> {
  return mutate(s => {
    const runeAutoSacrificeResult = processAutoSacrificeForCurrentInventory(s);
    return { ...snapshot(s), runeAutoSacrificeResult };
  });
}
export async function equipCombatRune(runeIdValue:unknown,equipValue:unknown):Promise<CombatSnapshot>{
  if(typeof runeIdValue!=='string'||!runeIdValue.trim()||runeIdValue.length>160)throw new Error('A valid Rune is required.');
  if(typeof equipValue!=='boolean')throw new Error('Choose whether to equip or unequip the Rune.');
  const shouldEquip=equipValue;
  return mutate(s=>{
    const rune=s.runes.find(item=>item.id===runeIdValue);
    if(!rune)throw new Error('Rune is not in your inventory.');
    const currentlyEquipped=s.equippedRunes.includes(rune.id);
    if(shouldEquip&&!currentlyEquipped){
      const slots=combatRuneSlotsUnlocked(s.level,Math.max(s.bestDepth,...Object.values(s.dungeonBestDepths)));
      if(s.equippedRunes.length>=slots)throw new Error('All Rune slots are full. Unequip a Rune or reach the next slot milestone.');
      s.equippedRunes=[...s.equippedRunes,rune.id];
    }else if(!shouldEquip&&currentlyEquipped){s.equippedRunes=s.equippedRunes.filter(id=>id!==rune.id);}
    return snapshot(s);
  });
}
export async function sacrificeCombatRuneInto(targetIdValue:unknown,donorIdValue:unknown):Promise<CombatSnapshot&{runeSacrifice:{donorName:string;targetName:string;gainedXp:number;totalXp:number;level:number}}>{
  if(typeof targetIdValue!=='string'||!targetIdValue.trim()||targetIdValue.length>160||
     typeof donorIdValue!=='string'||!donorIdValue.trim()||donorIdValue.length>160)throw new Error('A valid Rune is required.');
  if(targetIdValue===donorIdValue)throw new Error('Choose two different Runes.');
  return mutate(s=>{
    const target=s.runes.find(item=>item.id===targetIdValue);
    const donor=s.runes.find(item=>item.id===donorIdValue);
    if(!target||!donor)throw new Error('Rune is not in your inventory.');
    const result = grantRuneSacrificeExperience(target, donor);
    s.runes=s.runes.filter(item=>item.id!==donor.id);
    s.equippedRunes=s.equippedRunes.filter(id=>id!==donor.id);
    return {...snapshot(s),runeSacrifice:{donorName:donor.name,targetName:target.name,...result}};
  });
}

export async function rollCombatSkill():Promise<CombatSnapshot&{skillRoll:{id:CombatSkillId;name:string;rarity:CombatRarity;rank:number;duplicate:boolean;convertedCoins:number;pityEpic:number;pityMythic:number;progress:number;copiesNeeded:number;rankedUp:boolean};cost:number}> {
  return mutate(s=>{
    const cost=skillPullCost(s.skillRolls);if(s.combatMarks<cost)throw new Error('Not enough Combat Marks.');
    s.combatMarks-=cost;s.skillRolls+=1;
    const rarity=resolveCombatSkillRarity(secureRandom(),s.skillGachaRank,s.skillPityEpic,s.skillPityMythic);
    s.skillPityEpic=(s.skillGachaRank>=10&&(rarity==='Epic'||rarity==='Mythic'))?0:s.skillGachaRank>=10?Math.min(9,s.skillPityEpic+1):0;
    s.skillPityMythic=(s.skillGachaRank>=20&&rarity==='Mythic')?0:s.skillGachaRank>=20?Math.min(39,s.skillPityMythic+1):0;
    const pool=COMBAT_SKILLS.filter(skill=>skill.rarity===rarity&&skillRarityUnlocked(skill.rarity,s.skillGachaRank)),skill=pick(pool);if(!skill)throw new Error('Skill pool is unavailable.');
    const applied=applyCombatSkillCopy(s,skill.id,cost);
    return {...snapshot(s),skillRoll:{id:skill.id,name:skill.name,rarity,rank:applied.rank,duplicate:applied.duplicate,convertedCoins:applied.coinsRefunded,pityEpic:s.skillPityEpic,pityMythic:s.skillPityMythic,progress:applied.progress,copiesNeeded:applied.copiesNeeded,rankedUp:applied.rankedUp},cost};
  });
}

export async function equipCombatSkill(skillIdValue:unknown,equipValue:unknown):Promise<CombatSnapshot>{
  const skillId=typeof skillIdValue==='string'&&COMBAT_SKILLS.some(skill=>skill.id===skillIdValue)?skillIdValue as CombatSkillId:null;
  if(!skillId)throw new Error('Invalid combat ability.');
  if(typeof equipValue!=='boolean')throw new Error('Choose whether to equip or unequip the ability.');
  const shouldEquip=equipValue;
  return mutate(s=>{
    if((s.skillLevels[skillId]??0)<1)throw new Error('Ability not owned.');
    const isEquipped=s.equippedAbilities.includes(skillId);
    if(shouldEquip&&!isEquipped){
      if(s.equippedAbilities.length>=COMBAT_ABILITY_SLOTS)throw new Error('All active ability slots are full.');
      s.equippedAbilities=[...s.equippedAbilities,skillId];
    } else if(!shouldEquip&&isEquipped){s.equippedAbilities=s.equippedAbilities.filter(id=>id!==skillId);}
    return snapshot(s);
  });
}

export async function rankUpCombatSkillGacha():Promise<CombatSnapshot&{gachaRankUp:{rank:number;unlocks:string;spentMarks:number}}>{
  return mutate(s=>{
    const requirement=skillGachaRankRequirement(s.skillGachaRank);
    if(!requirement)throw new Error('Skill Gacha is already max rank.');
    if(s.skillRolls<requirement.requiredPulls)throw new Error('Need '+requirement.requiredPulls+' total skill pulls before ranking up.');
    if(s.combatMarks<requirement.requiredMarks)throw new Error('Not enough Combat Marks to rank up the Skill Gacha.');
    s.combatMarks-=requirement.requiredMarks;s.skillGachaRank=requirement.rank;
    if(s.skillGachaRank<10)s.skillPityEpic=0;
    if(s.skillGachaRank<20)s.skillPityMythic=0;
    return {...snapshot(s),gachaRankUp:{rank:s.skillGachaRank,unlocks:requirement.unlocks,spentMarks:requirement.requiredMarks}};
  });
}


const ARENA_PROFILE_KEY = 'infinity-orbs:combat:arena:profiles';
const ARENA_PROFILE_TTL_MS = 24 * 60 * 60_000;
const ARENA_CHALLENGE_COOLDOWN_MS = 90_000;

function arenaCooldownRemaining(lastAtValue: unknown, now = Date.now()): number {
  const lastAt = finiteInt(lastAtValue, 0, 0, Number.MAX_SAFE_INTEGER);
  if (lastAt <= 0) return 0;
  return Math.max(0, ARENA_CHALLENGE_COOLDOWN_MS - Math.max(0, now - lastAt));
}

/** Synthetic opponents are explicitly labelled practice bots and never written to player storage. */
const ARENA_TEST_BOTS = [
  { id:'testbot:rookie-sentinel', username:'Practice Bot · Rookie', level:3, bestDepth:5, rating:720, wins:8, losses:17, upgradeRank:0, skillId:'ember-lung' as CombatSkillId },
  { id:'testbot:ashen-vanguard', username:'Practice Bot · Vanguard', level:16, bestDepth:30, rating:1050, wins:41, losses:34, upgradeRank:3, skillId:'rift-hammer' as CombatSkillId },
  { id:'testbot:rift-champion', username:'Practice Bot · Champion', level:34, bestDepth:90, rating:1500, wins:126, losses:28, upgradeRank:7, skillId:'singularity-edge' as CombatSkillId },
] as const;

function combatKeyFor(userId: string): string {
  const id = String(userId ?? '').trim();
  if (!id) throw new Error('REDDIT_LOGIN_REQUIRED');
  return 'infinity-orbs:combat:' + id;
}
function arenaName(value: unknown): string {
  return String(value ?? 'Delver').trim().replace(/^u\//i, '').slice(0, 40) || 'Delver';
}
function arenaBuild(rawState: CombatState): { state: CombatState; stats: ReturnType<typeof combatStatsFor> } {
  const state: CombatState = {
    ...rawState,
    dungeonId: 'undercrypt',
    // PvP quality scaling must not jump when a death resets current depth to 1.
    depth: Math.max(1, Math.min(COMBAT_MAX_DEPTH, rawState.bestDepth)),
    // Arena stat resolution only needs equipped pieces; cloning the permanent stash on every challenge is wasteful.
    inventory: rawState.inventory.filter(item => Object.values(rawState.equipment).includes(item.id)).map(item => ({ ...item })),
    equipment: { ...rawState.equipment },
    skillLevels: { ...rawState.skillLevels },
    equippedAbilities: [...rawState.equippedAbilities],
    abilityCooldowns: { ...rawState.abilityCooldowns },
  };
  synchronizeCombatStats(state);
  state.health = state.maxHealth;
  const stats = combatStatsFor(state);
  return { state, stats };
}
function createArenaProfile(userId: string, username: string, state: CombatState, updatedAt: number): CombatArenaProfile {
  const build = arenaBuild(state);
  const weapon = build.state.inventory.find(item => item.id === build.state.equipment.weapon && item.slot === 'weapon');
  const armor = build.state.inventory.find(item => item.id === build.state.equipment.armor && item.slot === 'armor');
  const cooldownNow = Date.now();
  const protectionMs = arenaCooldownRemaining(state.arenaLastMatchAt, cooldownNow);
  return {
    userId,
    username: arenaName(username),
    level: state.level,
    bestDepth: state.bestDepth,
    rating: state.arenaRating,
    wins: state.arenaWins,
    losses: state.arenaLosses,
    updatedAt,
    challengeBlockedUntil: protectionMs > 0 ? cooldownNow + protectionMs : 0,
    damage: build.stats.damage,
    speed: build.stats.speed,
    maxHealth: build.stats.maxHealth,
    critChance: build.stats.critChance,
    weaponName: weapon?.name ?? 'Unarmed',
    armorName: armor?.name ?? 'No armor',
    skillRanks: Object.values(state.skillLevels).reduce((sum, rank) => Math.min(Number.MAX_SAFE_INTEGER, sum + Math.max(0, Number(rank) || 0)), 0),
  };
}
function createArenaTestState(bot: typeof ARENA_TEST_BOTS[number]): CombatState {
  const state=createCombatState();
  state.level=bot.level;
  state.bestDepth=bot.bestDepth;
  state.depth=bot.bestDepth;
  state.dungeonBestDepths.undercrypt=bot.bestDepth;
  state.arenaRating=bot.rating;
  state.combatUpgrades={
    'edge-training':bot.upgradeRank,
    vitality:Math.floor(bot.upgradeRank*.65),
    precision:Math.floor(bot.upgradeRank*.5),
    scavenger:Math.floor(bot.upgradeRank*.35),
    'orb-resonance':Math.floor(bot.upgradeRank*.5),
  };
  state.skillGachaRank=SKILL_GACHA_RANK_MAX;
  state.skillLevels[bot.skillId]=Math.max(1,bot.upgradeRank+1);
  state.equippedAbilities=[bot.skillId];
  synchronizeCombatStats(state);
  state.health=state.maxHealth;
  return state;
}
function createArenaTestProfile(bot: typeof ARENA_TEST_BOTS[number], updatedAt: number): CombatArenaProfile {
  const state=createArenaTestState(bot);
  state.arenaWins=bot.wins;
  state.arenaLosses=bot.losses;
  return createArenaProfile(bot.id,bot.username,state,updatedAt);
}

function parseArenaProfile(userId: string, raw: unknown): CombatArenaProfile | null {
  if (typeof raw !== 'string') return null;
  try {
    const p = JSON.parse(raw) as Partial<CombatArenaProfile>;
    if (!p || p.userId !== userId || typeof p.username !== 'string') return null;
    const updatedAt = Number(p.updatedAt), rating = Number(p.rating);
    if (!Number.isFinite(updatedAt) || !Number.isFinite(rating)) return null;
    return {
      userId,
      username: arenaName(p.username),
      level: finiteInt(p.level, 1, 1, 60),
      bestDepth: finiteInt(p.bestDepth, 1, 1, COMBAT_MAX_DEPTH),
      rating: finiteInt(rating, 1000, 100, 10000),
      wins: finiteInt(p.wins, 0, 0, Number.MAX_SAFE_INTEGER),
      losses: finiteInt(p.losses, 0, 0, Number.MAX_SAFE_INTEGER),
      updatedAt: finiteInt(updatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
      challengeBlockedUntil: finiteInt(p.challengeBlockedUntil, 0, 0, Number.MAX_SAFE_INTEGER),
      damage: finiteInt(p.damage, 1, 1, 1_000_000_000),
      speed: finiteInt(p.speed, 1, 1, 800),
      maxHealth: finiteInt(p.maxHealth, 1, 1, 1_000_000_000),
      critChance: Math.max(0, Math.min(.75, Number(p.critChance) || 0)),
      weaponName: String(p.weaponName ?? 'Unarmed').slice(0, 100),
      armorName: String(p.armorName ?? 'No armor').slice(0, 100),
      skillRanks: finiteInt(p.skillRanks, 0, 0, Number.MAX_SAFE_INTEGER),
    };
  } catch {
    return null;
  }
}
function resolveArenaDuel(challengerState: CombatState, opponentState: CombatState): {
  winner: 'challenger' | 'opponent'; rounds: number; log: string[];
} {
  const challenger = arenaBuild(challengerState);
  const opponent = arenaBuild(opponentState);
  let challengerHp = challenger.stats.maxHealth;
  let opponentHp = opponent.stats.maxHealth;
  let challengerFirst = true;
  let opponentFirst = true;
  const energy: Record<'challenger'|'opponent',number> = { challenger:3, opponent:3 };
  const flurrySkill: Record<'challenger'|'opponent',string|null> = { challenger:null, opponent:null };
  const cooldowns: Record<'challenger'|'opponent',Partial<Record<CombatSkillId,number>>> = { challenger:{}, opponent:{} };
  const log: string[] = [];
  let activeRound = 1;
  let activeSide: 'challenger'|'opponent' = 'challenger';
  const append = (message: string) => {
    const prefix = `Round ${activeRound} · ${activeSide==='challenger'?'You':'Opponent'}: `;
    // Keep a complete compact timeline: combine an actor's skill and all its
    // strikes into one round entry instead of trimming valid battle turns.
    const lastIndex = log.length - 1;
    if (lastIndex >= 0 && log[lastIndex]!.startsWith(prefix)) log[lastIndex] += ' · ' + message;
    else log.push(prefix + message);
    if (log.length > 201) log.shift();
  };

  const attack = (side: 'challenger' | 'opponent', abilityMultiplier=1, guaranteedCrit=false, bonusAttackMultiplier=1) => {
    const isChallenger = side === 'challenger';
    const attacker = isChallenger ? challenger : opponent;
    const defender = isChallenger ? opponent : challenger;
    const weapon = attacker.state.inventory.find(item => item.id === attacker.state.equipment.weapon);
    const weaponEffectiveness = gearQualityEffectiveness(weapon,Math.max(0,attacker.state.depth-1));
    let multiplier = abilityMultiplier;
    const isFirst = isChallenger ? challengerFirst : opponentFirst;
    if (isFirst && weapon?.trait === 'first-strike') multiplier *= 1 + .5*weaponEffectiveness;
    if (isChallenger) challengerFirst = false; else opponentFirst = false;
    const critical = guaranteedCrit || secureRandom() < attacker.stats.critChance;
    let damage = Math.max(1, Math.round(attacker.stats.damage * multiplier * bonusAttackMultiplier * (critical ? 1.75 : 1)));
    if (weapon?.trait === 'bleed' && secureRandom() < .18*weaponEffectiveness) {
      damage += Math.max(1, Math.round(attacker.stats.damage * .3*weaponEffectiveness));
    }
    damage = Math.max(1, Math.round(damage * (1 - defender.stats.damageReduction)));
    if (isChallenger) opponentHp = Math.max(0, opponentHp - damage);
    else challengerHp = Math.max(0, challengerHp - damage);
    const who = isChallenger ? 'You' : 'Opponent';
    append(`${who} ${critical ? 'critically hit' : 'hit'} for ${damage.toLocaleString()} damage.`);
  };

  const takeTurn = (side: 'challenger'|'opponent', round: number) => {
    activeRound = round;
    activeSide = side;
    const isChallenger = side==='challenger';
    const actor = isChallenger ? challenger : opponent;
    const actorHp = () => isChallenger ? challengerHp : opponentHp;
    const foeHp = () => isChallenger ? opponentHp : challengerHp;
    if(foeHp()<=0||actorHp()<=0)return;
    energy[side]=Math.min(actor.state.maxEnergy,energy[side]+1);
    let damageMultiplier=1,guaranteedCrit=false,extraAttacks=0,flurryMultiplier=1;
    const readySkill=actor.state.equippedAbilities
      .map(id=>COMBAT_SKILLS.find(skill=>skill.id===id))
      .find(skill=>skill&&(actor.state.skillLevels[skill.id]??0)>0&&(cooldowns[side][skill.id]??0)<=round&&energy[side]>=combatSkillEnergyCost(skill.rarity));
    if(readySkill){
      const rank=Math.max(1,Math.floor(Number(actor.state.skillLevels[readySkill.id])||1));
      const rankScale=Math.log2(rank+1);
      energy[side]-=combatSkillEnergyCost(readySkill.rarity);
      cooldowns[side][readySkill.id]=round+combatSkillCooldown(readySkill.rarity,rank);
      const archetype=combatAbilityType(readySkill);
      if(archetype==='strike'){
        damageMultiplier=1.2+readySkill.value*2+rankScale*.15;
        append(`${isChallenger?'You':'Opponent'} cast ${readySkill.name}.`);
      }else if(archetype==='flurry'){
        extraAttacks=1+Math.floor(rankScale);
        flurrySkill[side]=readySkill.name;
        flurryMultiplier=combatFlurryAttackMultiplier(readySkill.value);
      }else if(archetype==='mend'){
        const before=actorHp();
        const healed=Math.max(1,Math.round(actor.stats.maxHealth*Math.min(.9,.10+readySkill.value+rankScale*.06)));
        if(isChallenger)challengerHp=Math.min(actor.stats.maxHealth,challengerHp+healed);
        else opponentHp=Math.min(actor.stats.maxHealth,opponentHp+healed);
        append(`${isChallenger?'You':'Opponent'} cast ${readySkill.name} and restored ${Math.max(0,actorHp()-before)} HP.`);
      }else if(archetype==='focus'){
        guaranteedCrit=true;
        damageMultiplier=1.65+readySkill.value*2+rankScale*.15;
        append(`${isChallenger?'You':'Opponent'} cast ${readySkill.name}; the next strike is critical.`);
      }else{
        // Bounty currency is a PvE reward; this Arena buff does not mint currency through PvP.
        damageMultiplier=1+readySkill.value+rankScale*.05;
        append(`${isChallenger?'You':'Opponent'} cast ${readySkill.name} to empower the next strike.`);
      }
    }
    const desperationGear=actor.state.inventory.find(item=>Object.values(actor.state.equipment).includes(item.id)&&item.trait==='desperation');
    const desperationEffectiveness=gearQualityEffectiveness(desperationGear,Math.max(0,actor.state.depth-1));
    const speed=Math.min(800,actor.stats.speed+(desperationGear&&actorHp()<=actor.stats.maxHealth*.4?Math.round(20*desperationEffectiveness):0));
    const actionCount=Math.min(8,Math.max(1,Math.floor(speed/100)));
    extraAttacks=combatEffectiveFlurryBonusAttacks(extraAttacks,actionCount);
    if(flurrySkill[side])append(`${isChallenger?'You':'Opponent'} cast ${flurrySkill[side]} for ${extraAttacks} bonus strikes.`);
    const totalAttacks=actionCount+extraAttacks;
    for(let action=0;action<totalAttacks&&foeHp()>0;action++)attack(side,action===0?damageMultiplier:1,action===0&&guaranteedCrit,action>=actionCount?flurryMultiplier:1);
  };

  let rounds=0;
  for(rounds=1;rounds<=100;rounds++){
    const first=challenger.stats.speed>opponent.stats.speed?'challenger'
      :challenger.stats.speed<opponent.stats.speed?'opponent'
      :(secureRandom()<.5?'challenger':'opponent');
    const second=first==='challenger'?'opponent':'challenger';
    takeTurn(first,rounds);
    if(challengerHp<=0||opponentHp<=0)break;
    takeTurn(second,rounds);
    if(challengerHp<=0||opponentHp<=0)break;
  }
  // Extremely defensive equal builds resolve by remaining health; perfectly equal ties use fair RNG.
  const challengerHealthRatio=challengerHp/challenger.stats.maxHealth;
  const opponentHealthRatio=opponentHp/opponent.stats.maxHealth;
  const winner=challengerHealthRatio===opponentHealthRatio
    ?(secureRandom()<.5?'challenger':'opponent')
    :challengerHealthRatio>opponentHealthRatio?'challenger':'opponent';
  log.push(winner==='challenger'?'Victory. Arena rating updated.':'Defeat. Arena rating updated.');
  if (log.length > 201) log.shift();
  return {winner,rounds:Math.min(rounds,100),log};
}

/** Register the current server-owned build and return recently active opponents. */
export async function getCombatArenaOpponents(): Promise<{
  self: CombatArenaProfile;
  opponents: CombatArenaProfile[];
  cooldownRemainingMs: number;
}> {
  const userId = String(context.userId ?? '').trim();
  if (!userId) throw new Error('REDDIT_LOGIN_REQUIRED');
  // Persist the starter state too, so new players can be challenged after they
  // have opened Combat, even if they haven't killed the first enemy yet.
  const state = await mutate(s => s);
  const now = Date.now();
  const rawProfiles = await redis.hGetAll(ARENA_PROFILE_KEY);
  const self = createArenaProfile(userId, arenaName(context.username), state, now);
  await redis.hSet(ARENA_PROFILE_KEY, { [userId]: JSON.stringify(self) });
  const opponents: CombatArenaProfile[] = [];
  const staleProfileIds: string[] = [];
  for (const [id, raw] of Object.entries(rawProfiles ?? {})) {
    const profile = parseArenaProfile(id, raw);
    if (!profile || profile.updatedAt < now - ARENA_PROFILE_TTL_MS) {
      if (id !== userId) staleProfileIds.push(id);
      continue;
    }
    if (profile.userId !== userId) opponents.push(profile);
  }
  // Keep the profile hash bounded over time. Delete a small batch per request
  // rather than turning one Arena open into thousands of serial Redis writes.
  await Promise.all(staleProfileIds.slice(0, 100).map(id =>
    redis.hDel(ARENA_PROFILE_KEY, id).catch((error: unknown) => {
      console.error('[Combat Arena] Could not prune stale profile.', error);
      return 0;
    }),
  ));
  opponents.sort((a, b) => b.rating - a.rating || b.bestDepth - a.bestDepth);
  // Keep 4 slots available for live players and always append the synthetic practice roster.
  const visibleOpponents=[...opponents.slice(0,16),...ARENA_TEST_BOTS.map(bot=>createArenaTestProfile(bot,now))];
  return {
    self,
    opponents:visibleOpponents,
    cooldownRemainingMs: arenaCooldownRemaining(state.arenaLastChallengeAt, now),
  };
}

/** Challenge a recently active player's saved build. Both rating changes commit atomically. */
export async function challengeCombatArena(opponentIdValue: string): Promise<CombatSnapshot & { arenaResult: CombatArenaResult }> {
  const userId = String(context.userId ?? '').trim();
  const opponentId = String(opponentIdValue ?? '').trim();
  if (!userId) throw new Error('REDDIT_LOGIN_REQUIRED');
  if (!opponentId) throw new Error('ARENA_OPPONENT_UNAVAILABLE');
  if (userId === opponentId) throw new Error('ARENA_SELF_CHALLENGE');

  if(opponentId.startsWith('testbot:')){
    const bot=ARENA_TEST_BOTS.find(entry=>entry.id===opponentId);
    if(!bot)throw new Error('ARENA_OPPONENT_UNAVAILABLE');
    return mutate(ownState=>{
      const now=Date.now();
      const remaining=ARENA_CHALLENGE_COOLDOWN_MS-(now-ownState.arenaLastChallengeAt);
      if(remaining>0)throw new Error('ARENA_COOLDOWN:'+remaining);
      const opponentState=createArenaTestState(bot);
      const duel=resolveArenaDuel(ownState,opponentState);
      const ratingUpdate=calculateCombatArenaRatingUpdate(ownState.arenaRating,bot.rating,duel.winner==='challenger');
      ownState.arenaRating=ratingUpdate.playerRating;
      if(duel.winner==='challenger')ownState.arenaWins+=1;else ownState.arenaLosses+=1;
      ownState.arenaLastChallengeAt=now;
      const opponent=createArenaTestProfile(bot,now);
      const arenaResult:CombatArenaResult={
        opponent,
        winner:duel.winner==='challenger'?'you':'opponent',
        rounds:duel.rounds,
        log:[...duel.log,'Practice match: the bot roster is synthetic and its rating does not change.'].slice(-10),
        ratingChange:ratingUpdate.playerChange,
        opponentRatingChange:0,
        ratingAfter:ratingUpdate.playerRating,
        opponentRatingAfter:bot.rating,
      };
      return {...snapshot(ownState),arenaResult};
    });
  }

  const rawProfiles = await redis.hGetAll(ARENA_PROFILE_KEY);
  const opponentProfile = parseArenaProfile(opponentId, rawProfiles?.[opponentId]);
  if (!opponentProfile || opponentProfile.updatedAt < Date.now() - ARENA_PROFILE_TTL_MS) {
    throw new Error('ARENA_OPPONENT_UNAVAILABLE');
  }
  const ownKey = combatKeyFor(userId);
  const opponentKey = combatKeyFor(opponentId);

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const txn = await redis.watch(ownKey, opponentKey);
    let closed = false;
    try {
      const [ownRaw, opponentRaw] = await Promise.all([redis.get(ownKey), redis.get(opponentKey)]);
      if (!opponentRaw) {
        await txn.unwatch(); closed = true;
        throw new Error('ARENA_OPPONENT_UNAVAILABLE');
      }
      const ownState = normalizeState(ownRaw);
      let opponentState = normalizeState(opponentRaw);
      // Older Arena saves tracked only the outgoing challenge timestamp. Before
      // target protection existed, that timestamp is the best available proxy
      // for a recent match; migrate it when no explicit match timestamp exists.
      try {
        const rawOpponentState = JSON.parse(opponentRaw) as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(rawOpponentState, 'arenaLastMatchAt')) {
          opponentState.arenaLastMatchAt = finiteInt(
            rawOpponentState.arenaLastChallengeAt, 0, 0, Number.MAX_SAFE_INTEGER,
          );
        }
      } catch {
        // normalizeState owns malformed-save handling; keep its safe default.
      }
      const now = Date.now();
      const remaining = arenaCooldownRemaining(ownState.arenaLastChallengeAt, now);
      if (remaining > 0) {
        await txn.unwatch(); closed = true;
        throw new Error('ARENA_COOLDOWN:' + remaining);
      }
      const opponentProtection = arenaCooldownRemaining(opponentState.arenaLastMatchAt, now);
      if (opponentProtection > 0) {
        await txn.unwatch(); closed = true;
        // Refresh the cached card too, including legacy profiles whose schema
        // predates challengeBlockedUntil. The combat-state check remains authoritative.
        const protectedProfile = createArenaProfile(
          opponentId, opponentProfile.username, opponentState, opponentProfile.updatedAt,
        );
        await redis.hSet(ARENA_PROFILE_KEY, { [opponentId]: JSON.stringify(protectedProfile) })
          .catch((error: unknown) => console.error('[Combat Arena] Could not refresh protected profile.', error));
        throw new Error('ARENA_OPPONENT_COOLDOWN:' + opponentProtection);
      }

      const duel = resolveArenaDuel(ownState, opponentState);
      const ratingUpdate = calculateCombatArenaRatingUpdate(
        ownState.arenaRating,
        opponentState.arenaRating,
        duel.winner === 'challenger',
      );
      const ownAfter = ratingUpdate.playerRating;
      const opponentAfter = ratingUpdate.opponentRating;
      const ownChange = ratingUpdate.playerChange;
      const opponentChange = ratingUpdate.opponentChange;

      ownState.arenaRating = ownAfter;
      opponentState.arenaRating = opponentAfter;
      if (duel.winner === 'challenger') {
        ownState.arenaWins += 1;
        opponentState.arenaLosses += 1;
      } else {
        ownState.arenaLosses += 1;
        opponentState.arenaWins += 1;
      }
      ownState.arenaLastChallengeAt = now;
      ownState.arenaLastMatchAt = now;
      opponentState.arenaLastMatchAt = now;

      await txn.multi();
      await txn.set(ownKey, JSON.stringify(ownState));
      await txn.set(opponentKey, JSON.stringify(opponentState));
      const committed = await txn.exec();
      closed = true;
      if (committed === null) continue;

      const ownProfile = createArenaProfile(userId, arenaName(context.username), ownState, now);
      const nextOpponentProfile = createArenaProfile(
        opponentId, opponentProfile.username, opponentState, opponentProfile.updatedAt,
      );
      await redis.hSet(ARENA_PROFILE_KEY, {
        [userId]: JSON.stringify(ownProfile),
        [opponentId]: JSON.stringify(nextOpponentProfile),
      }).catch((error: unknown) => console.error('[Combat Arena] Profile refresh failed after result commit.', error));

      const arenaResult: CombatArenaResult = {
        opponent: nextOpponentProfile,
        winner: duel.winner === 'challenger' ? 'you' : 'opponent',
        rounds: duel.rounds,
        log: duel.log,
        ratingChange: ownChange,
        opponentRatingChange: opponentChange,
        ratingAfter: ownAfter,
        opponentRatingAfter: opponentAfter,
      };
      return { ...snapshot(ownState), arenaResult };
    } finally {
      if (!closed) await txn.unwatch().catch(() => undefined);
    }
  }
  throw new Error('Combat state changed repeatedly. Please retry.');
}


export async function setCombatAutoTactic(tacticValue: unknown): Promise<CombatSnapshot> {
  const validTactics: CombatTactic[] = ['balanced', 'aggressive', 'defensive', 'recovery'];
  if (typeof tacticValue !== 'string' || !validTactics.includes(tacticValue as CombatTactic)) {
    throw new Error('Invalid combat tactic.');
  }
  return mutate(state => {
    state.autoTactic = tacticValue as CombatTactic;
    return snapshot(state);
  });
}


export async function buyCombatUpgrade(upgradeValue: unknown): Promise<CombatSnapshot & { upgradePurchase: { id: string; name: string; rank: number; cost: number } }> {
  const upgrade = typeof upgradeValue === 'string' ? COMBAT_UPGRADES.find(entry => entry.id === upgradeValue) : undefined;
  if (!upgrade) throw new Error('Invalid combat upgrade.');
  return mutate(state => {
    const rank = combatUpgradeRank(state, upgrade.id);
    if (rank >= upgrade.maxRank) throw new Error('Combat upgrade is already max rank.');
    const cost = combatUpgradeCost(state, upgrade.id);
    if (state.combatMarks < cost) throw new Error('Not enough Combat Marks.');
    state.combatMarks -= cost;
    state.combatUpgrades[upgrade.id] = rank + 1;
    synchronizeCombatStats(state);
    return { ...snapshot(state), upgradePurchase: { id: upgrade.id, name: upgrade.name, rank: rank + 1, cost } };
  });
}

/** Most recent main-game orb roll becomes the character's active combat focus. */
export async function setCombatOrbFocus(rarityValue: unknown, nameValue: unknown): Promise<CombatSnapshot> {
  const raw = Number(rarityValue);
  const rarity = Number.isFinite(raw) ? Math.max(2, Math.min(Number.MAX_VALUE, Math.floor(raw))) : 2;
  const name = String(nameValue ?? 'Common Orb').trim().slice(0, 100) || 'Common Orb';
  return mutate(state => {
    state.orbFocusRarity = rarity;
    state.orbFocusName = name;
    synchronizeCombatStats(state);
    return snapshot(state);
  });
}

export async function setCombatDungeon(dungeonValue: unknown): Promise<CombatSnapshot> {
  const validDungeons: CombatDungeonId[] = ['undercrypt', 'cinder-vault', 'glass-labyrinth'];
  if (typeof dungeonValue !== 'string' || !validDungeons.includes(dungeonValue as CombatDungeonId)) {
    throw new Error('Invalid combat dungeon.');
  }
  return mutate(state => {
    const nextDungeon = dungeonValue as CombatDungeonId;
    if (state.dungeonId === nextDungeon && !state.depthCapCleared) return snapshot(state);
    state.depthCapCleared = false;
    state.dungeonId = nextDungeon;
    state.depth = 1;
    state.bestDepth = state.dungeonBestDepths[nextDungeon];
    state.runId += 1;
    resetCombatRunCarry(state);
    // Switching dungeons starts a fresh encounter. Do not carry shields, Burn,
    // queued healing, pending loot modifiers, or once-per-encounter triggers over.
    state.pendingHealAmount = 0;
    state.skillRuntime.burnTicks = 0;
    state.skillRuntime.burnDamage = 0;
    state.skillRuntime.armorBreakBeats = 0;
    state.skillRuntime.shield = 0;
    state.skillRuntime.delayedDamage = 0;
    state.skillRuntime.delayedDamageReadyAtSequence = 0;
    state.skillRuntime.lastAttackDamage = 0;
    state.skillRuntime.storedDamage = 0;
    state.skillRuntime.executeMarked = false;
    state.skillRuntime.evadeNext = false;
    state.skillRuntime.phoenixReady = false;
    state.skillRuntime.phoenixUsed = false;
    state.skillRuntime.nextKillMarkBonus = 0;
    state.skillRuntime.nextKillXpBonus = 0;
    state.skillRuntime.nextRuneDropBonus = 0;
    state.skillRuntime.royalTitheKills = 0;
    state.skillRuntime.bountyStreak = 0;
    state.combatBeats = 0;
    state.playerActionsResolved = 0;
    state.enemyActionsResolved = 0;
    state.guardBeats = 0;
    state.encounterFirstStrikeUsed = false;
    state.energy = Math.min(state.maxEnergy, 3);
    state.enemyHp = getEnemyForDungeonDepth(nextDungeon, 1).maxHp;
    synchronizeCombatStats(state);
    state.health = state.maxHealth;
    return snapshot(state);
  });
}


// Admin Combat Lab fixtures are called only from the server-guarded /api/dev router.
export async function adminCombatLabAction(value:unknown):Promise<CombatSnapshot&{labMessage:string}>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid Combat Lab payload.');
  const payload=value as Record<string,unknown>;
  const action=String(payload.action??'');
  return mutate(state=>{
    let labMessage='';
    if(action==='grant-resources'){
      const scrap=finiteInt(payload.scrap,0,0,1_000_000_000_000);
      const marks=finiteInt(payload.marks,0,0,1_000_000_000_000);
      state.scrap=Math.min(Number.MAX_SAFE_INTEGER,state.scrap+scrap);
      state.combatMarks=Math.min(Number.MAX_SAFE_INTEGER,state.combatMarks+marks);
      labMessage='Granted '+scrap.toLocaleString()+' Scrap and '+marks.toLocaleString()+' Combat Marks.';
    }else if(action==='set-depth'){
      const depth=finiteInt(payload.depth,state.depth,1,COMBAT_MAX_DEPTH);
      state.depth=depth;state.bestDepth=Math.max(state.bestDepth,depth);
      state.dungeonBestDepths[state.dungeonId]=Math.max(state.dungeonBestDepths[state.dungeonId],depth);
      state.lastAcceptedBeatAtMs=0;state.enemyHp=getEnemyForDungeonDepth(state.dungeonId,depth).maxHp;
      synchronizeCombatStats(state);state.health=state.maxHealth;
      labMessage='Set '+state.dungeonId+' to Depth '+depth.toLocaleString()+', refreshed enemy stats, and healed the test character.';
    }else if(action==='grant-gear'){
      const slots:CombatGearSlot[]=['weapon','armor','helmet','gloves','boots','ring','amulet'];
      const slot=String(payload.slot??'weapon') as CombatGearSlot;
      if(!slots.includes(slot))throw new Error('Choose a valid gear slot.');
      const rawQuality=Number(payload.quality);
      if(!Number.isFinite(rawQuality)||rawQuality<0||rawQuality>100)throw new Error('Gear quality must be between 0 and 100.');
      const quality=Math.round(rawQuality*100)/100;
      let item=createGear(Math.max(0,state.depth-1),slot,quality);
      const abilityId=String(payload.majorAbility??'none');
      if(abilityId==='none'){const {majorAbility:_discarded,...withoutAbility}=item;item=withoutAbility;}
      else if((COMBAT_MAJOR_ABILITY_IDS as readonly string[]).includes(abilityId))item={...item,majorAbility:createMajorAbility(quality,abilityId as CombatMajorAbility['id'])};
      else throw new Error('Choose a valid Major Ability or None.');
      addCombatGearToInventory(state,item);state.equipment[slot]=item.id;synchronizeCombatStats(state);state.health=state.maxHealth;
      labMessage='Granted and equipped '+item.name+' ('+item.quality.toFixed(2)+'% quality)'+(item.majorAbility?' with '+item.majorAbility.name:'')+'.';
    }else if(action==='grant-rune'){
      const rarities:CombatRuneRarity[]=['Common','Uncommon','Rare','Epic','Legendary','Mythic','Cosmic'];
      const stats:CombatRuneStat[]=['luckPct','coinGainPct','shardChancePct','xpGainPct'];
      const rarity=String(payload.rarity??'Cosmic') as CombatRuneRarity;
      const stat=String(payload.stat??'luckPct') as CombatRuneStat;
      if(!rarities.includes(rarity)||!stats.includes(stat))throw new Error('Choose a valid Rune rarity and stat.');
      if(state.runes.length>=COMBAT_RUNE_INVENTORY_CAP)throw new Error('Rune inventory is full; sacrifice a Rune into another Rune first.');
      const abilityId=String(payload.majorAbility??'none');
      let majorAbility:CombatRune['majorAbility'];
      if(abilityId!=='none'){
        if(!(COMBAT_RUNE_MAJOR_ABILITY_IDS as readonly string[]).includes(abilityId))throw new Error('Choose a valid Rune Major Ability or None.');
        majorAbility=createRuneMajorAbility(combatRuneMajorAbilityQuality(rarity),abilityId as CombatRuneMajorAbilityId);
      }
      const sourceDepth=Math.max(0,state.depth-1),id='rune-admin-'+Date.now().toString(36)+'-'+Math.floor(secureRandom()*0x7fffffff).toString(36);
      const rune:CombatRune={id,name:'TEST '+rarity+' '+stat+' Rune',rarity,stat,value:combatRuneValueFor(rarity,stat,sourceDepth),sourceDepth,sourceDungeon:state.dungeonId,...(majorAbility?{majorAbility}:{})};
      state.runes.push(rune);
      const slots=combatRuneSlotsUnlocked(state.level,Math.max(state.bestDepth,...Object.values(state.dungeonBestDepths)));
      if(state.equippedRunes.length<slots)state.equippedRunes.push(rune.id);else state.equippedRunes[slots-1]=rune.id;
      labMessage='Granted '+rarity+' '+stat+' Rune'+(majorAbility?' with '+majorAbility.name:'')+' and equipped it.';
    }else if(action==='heal'){
      synchronizeCombatStats(state);state.health=state.maxHealth;state.energy=state.maxEnergy;state.lastAcceptedBeatAtMs=0;
      labMessage='Restored HP and Energy; cleared the beat cooldown.';
    }else if(action==='clear-cooldown'){
      state.lastAcceptedBeatAtMs=0;labMessage='Cleared the combat beat cooldown for the next normal beat.';
    }else if(action==='late-game-preset'){
      const slots:CombatGearSlot[]=['weapon','helmet','armor','gloves','boots','ring','amulet'];
      state.depth=COMBAT_MAX_DEPTH;state.bestDepth=COMBAT_MAX_DEPTH;state.dungeonBestDepths[state.dungeonId]=COMBAT_MAX_DEPTH;
      state.level=60;state.xp=0;state.xpToNext=1_000_000_000;state.scrap=100_000_000;state.combatMarks=100_000_000;
      state.combatUpgrades=Object.fromEntries(COMBAT_UPGRADES.map(upgrade=>[upgrade.id,upgrade.maxRank])) as CombatState['combatUpgrades'];
      state.skillGachaRank=SKILL_GACHA_RANK_MAX;state.skillRolls=100_000;
      state.skillLevels=Object.fromEntries(COMBAT_SKILLS.map(skill=>[skill.id,100])) as CombatState['skillLevels'];
      state.skillCopyProgress=Object.fromEntries(COMBAT_SKILLS.map(skill=>[skill.id,0])) as CombatState['skillCopyProgress'];
      state.equippedAbilities=COMBAT_SKILLS.slice(0,COMBAT_ABILITY_SLOTS).map(skill=>skill.id);state.abilityCooldowns={};
      state.inventory=[];state.equipment=Object.fromEntries(slots.map(slot=>[slot,null])) as Record<CombatGearSlot,string|null>;
      state.runInventoryIds=[];state.runes=[];state.equippedRunes=[];
      slots.forEach((slot,index)=>{
        const item=createGear(COMBAT_MAX_DEPTH-1,slot,100);
        const geared={...item,majorAbility:createMajorAbility(100,COMBAT_MAJOR_ABILITY_IDS[index]!)};
        state.inventory.push(geared);state.equipment[slot]=geared.id;
      });
      const rarities:CombatRuneRarity[]=['Cosmic','Mythic','Legendary','Epic','Rare'];
      const runeStats:CombatRuneStat[]=['luckPct','coinGainPct','shardChancePct','xpGainPct','luckPct'];
      const runeAbilityIds=COMBAT_RUNE_MAJOR_ABILITY_IDS;
      rarities.forEach((rarity,index)=>{
        const id='rune-admin-endgame-'+Date.now().toString(36)+'-'+index,sourceDepth=COMBAT_MAX_DEPTH-1,stat=runeStats[index]!;
        state.runes.push({id,name:'TEST '+rarity+' Major Rune',rarity,stat,value:combatRuneValueFor(rarity,stat,sourceDepth),sourceDepth,sourceDungeon:state.dungeonId,majorAbility:createRuneMajorAbility(combatRuneMajorAbilityQuality(rarity),runeAbilityIds[index%runeAbilityIds.length]!)});
        state.equippedRunes.push(id);
      });
      state.lastAcceptedBeatAtMs=0;state.enemyHp=getEnemyForDungeonDepth(state.dungeonId,state.depth).maxHp;
      synchronizeCombatStats(state);state.health=state.maxHealth;state.energy=state.maxEnergy;
      labMessage='Applied late-game fixture: Depth 50,000, seven 100% Major Ability gear pieces, five ability Runes, max combat upgrades and 100M Scrap + Combat Marks.';
    }else if(action==='reset-combat'){
      Object.assign(state,createCombatState());
      labMessage='Reset only the Combat save. Your main Infinity Orbs save was not changed.';
    }else throw new Error('Unknown Combat Lab action.');
    return {...snapshot(state),labMessage};
  });
}

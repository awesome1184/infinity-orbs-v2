import { context, redis } from './devvit-mock.js';
import { loadRaw } from './game.js';
import { getOrbInfo, luckMultiplier, rollContinuum } from '../shared/game.js';
import { createRuneDrop, normalizeRuneItem, runeBonusesFromLoadout, RUNE_EQUIPMENT_SLOTS, RUNE_INVENTORY_CAP } from '../shared/runes.js';
import type { CombatAction, CombatArenaProfile, CombatArenaResult, CombatCommand, CombatDungeonId, CombatEnemy, CombatGear, CombatGearSlot, CombatIntent, CombatMajorAbility, CombatOrbRoll, CombatSkillId, CombatSnapshot, CombatState, CombatTactic, CombatTrait, CombatRarity } from '../shared/combat.js';
import { calculateCombatArenaRatingUpdate, chooseAutoCombatIntent, COMBAT_ABILITY_SLOTS, COMBAT_INVENTORY_CAP, COMBAT_MAX_DEPTH, COMBAT_SKILLS, DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS, SKILL_GACHA_RANK_MAX, SKILL_RANK_CAP, COMBAT_UPGRADES, addCombatGearToInventory, applyCombatSkillCopy, combatMajorAbilityChance, combatOrbDamageMultiplier, combatAbilityType, combatBountyReward, combatEffectiveFlurryBonusAttacks, combatEnergyAfterRegen, combatFlurryAttackMultiplier, combatForgeCost, combatMarkMultiplier, combatScrapValue, combatSkillCooldown, combatSkillEnergyCost, combatSkillCopiesForNextRank, combatStatsFor, combatUpgradeCost, combatUpgradeRank, createCombatState, gearQualityEffectiveness, getEnemyForDungeonDepth, normalizeCombatAutoScrapSettings, resetCombatRunCarry, resolveCombatSkillRarity, skillGachaRankRequirement, skillPullCost, skillRarityUnlocked, synchronizeCombatStats, COMBAT_BEAT_INTERVAL_MS, combatForgeQualityCost } from '../shared/combat.js';

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
  const abilityName=(fallback:string)=>typeof rawAbility?.name==='string'?rawAbility.name.slice(0,60):fallback;
  const abilityDescription=(fallback:string)=>typeof rawAbility?.description==='string'?rawAbility.description.slice(0,180):fallback;
  const majorAbility:CombatMajorAbility|undefined=rawAbility&&rawAbility.id==='second-dawn'&&rawAbility.trigger==='on-damage'
    ?{id:'second-dawn',name:abilityName('Second Dawn'),trigger:'on-damage',healPercent:Math.max(0,Math.min(.75,Number(rawAbility.healPercent)||.15)),description:abilityDescription('After taking damage, heal 15% of Max HP at the start of your next turn.')}
    :rawAbility&&rawAbility.id==='chrono-surge'&&rawAbility.trigger==='passive'
      ?{id:'chrono-surge',name:abilityName('Chrono Surge'),trigger:'passive',speedPercent:Math.max(0,Math.min(.5,Number.isFinite(Number(rawAbility.speedPercent))?Number(rawAbility.speedPercent):.10)),description:abilityDescription('Increases turn speed while equipped.')}
    :rawAbility&&rawAbility.id==='void-edge'&&rawAbility.trigger==='passive'
      ?{id:'void-edge',name:abilityName('Void Edge'),trigger:'passive',damagePercent:Math.max(0,Math.min(.75,Number.isFinite(Number(rawAbility.damagePercent))?Number(rawAbility.damagePercent):.12)),description:abilityDescription('Increases outgoing damage while equipped.')}
    :rawAbility&&rawAbility.id==='aegis-ward'&&rawAbility.trigger==='passive'
      ?{id:'aegis-ward',name:abilityName('Aegis Ward'),trigger:'passive',damageReduction:Math.max(0,Math.min(.25,Number.isFinite(Number(rawAbility.damageReduction))?Number(rawAbility.damageReduction):.08)),description:abilityDescription('Reduces incoming damage while equipped.')}
    :undefined;
  return {id:x.id.slice(0,160),name:x.name.slice(0,100),slot,quality:Math.max(0,Math.min(100,Number.isFinite(Number(x.quality))?Number(x.quality):0)),sourceFloor:finiteInt(x.sourceFloor,fallbackFloor,0,COMBAT_MAX_DEPTH-1),power:finiteInt(x.power,1,1,1_000_000),effect:x.id==='starter-weapon'?'Adds +4 damage. Critical chance +4 percentage points.':typeof x.effect==='string'?x.effect.slice(0,180):traitText(trait),trait,damageBonus:finiteInt(x.damageBonus,0,0,1_000_000),speedBonus:0,maxHealthBonus:finiteInt(x.maxHealthBonus,0,0,1_000_000),armorBonus:finiteInt(x.armorBonus,0,0,1_000_000),critChanceBonus:Math.max(0,Math.min(.75,Number.isFinite(Number(x.critChanceBonus))?Number(x.critChanceBonus):0)),...(majorAbility?{majorAbility}:{})};
}
function normalizeState(raw:string|null|undefined):CombatState {
  if(!raw)return createCombatState();
  let p:Partial<CombatState>;
  try { p=JSON.parse(raw) as Partial<CombatState>; if(!p||typeof p!=='object'||Array.isArray(p))return createCombatState(); } catch { return createCombatState(); }
  const storedGachaRank=p.skillGachaRank;
  const savedSkillLevels=(p.skillLevels&&typeof p.skillLevels==='object'?p.skillLevels:{}) as Partial<Record<CombatSkillId,number>>;
  const legacyUnlockedRank=Math.max(1,...COMBAT_SKILLS.filter(skill=>Number(savedSkillLevels[skill.id])>0).map(skill=>({Common:1,Uncommon:2,Rare:3,Epic:4,Mythic:5}[skill.rarity])));
  const s=Object.assign(createCombatState(),p);
  s.version=1;
  s.dungeonId=(['undercrypt','cinder-vault','glass-labyrinth'] as unknown[]).includes(s.dungeonId)?s.dungeonId:'undercrypt';
  s.runId=finiteInt(s.runId,1,1,Number.MAX_SAFE_INTEGER);s.depth=finiteInt(s.depth,1,1,COMBAT_MAX_DEPTH);
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
  s.arenaRating=finiteInt(s.arenaRating,1000,100,10000);s.arenaWins=finiteInt(s.arenaWins,0,0,Number.MAX_SAFE_INTEGER);s.arenaLosses=finiteInt(s.arenaLosses,0,0,Number.MAX_SAFE_INTEGER);s.arenaLastChallengeAt=finiteInt(s.arenaLastChallengeAt,0,0,Number.MAX_SAFE_INTEGER);
  s.coreLevel=finiteInt(s.coreLevel,1,1,1_000_000);s.coreHighestRarity=finiteInt(s.coreHighestRarity,2,2,1_000_000_000_000_000_000);
  s.autoTactic=(['balanced','aggressive','defensive','recovery'] as unknown[]).includes(s.autoTactic)?s.autoTactic:'balanced';
  s.scrap=finiteInt(s.scrap,0,0,Number.MAX_SAFE_INTEGER);s.autoScrapUnlocked=s.autoScrapUnlocked===true;s.autoScrapSettings=normalizeCombatAutoScrapSettings(s.autoScrapSettings);s.skillRolls=finiteInt(s.skillRolls,0,0,Number.MAX_SAFE_INTEGER);s.skillGachaRank=finiteInt(storedGachaRank,legacyUnlockedRank,1,SKILL_GACHA_RANK_MAX);s.skillPityEpic=finiteInt(s.skillPityEpic,0,0,9);s.skillPityMythic=finiteInt(s.skillPityMythic,0,0,39);s.orbFocusRarity=finiteInt(s.orbFocusRarity,2,2,1_000_000_000_000_000_000);s.orbFocusName=typeof s.orbFocusName==='string'?s.orbFocusName.slice(0,100):'Common Orb';s.combatUpgrades=Object.fromEntries(COMBAT_UPGRADES.map(upgrade=>[upgrade.id,finiteInt(s.combatUpgrades?.[upgrade.id],0,0,upgrade.maxRank)])) as CombatState['combatUpgrades'];s.sequence=finiteInt(s.sequence,0,0,Number.MAX_SAFE_INTEGER);s.lastAcceptedBeatAtMs=finiteInt(s.lastAcceptedBeatAtMs,0,0,Number.MAX_SAFE_INTEGER);s.combatBeats=finiteInt(s.combatBeats,0,0,Number.MAX_SAFE_INTEGER);
  s.playerActionsResolved=finiteInt(s.playerActionsResolved,0,0,Number.MAX_SAFE_INTEGER);s.enemyActionsResolved=finiteInt(s.enemyActionsResolved,0,0,Number.MAX_SAFE_INTEGER);
  s.energy=finiteInt(s.energy,3,0,10);s.maxEnergy=finiteInt(s.maxEnergy,5,1,10);s.guardBeats=finiteInt(s.guardBeats,0,0,10);s.encounterFirstStrikeUsed=s.encounterFirstStrikeUsed===true;s.pendingHealAmount=finiteInt(s.pendingHealAmount,0,0,1_000_000_000);
  const defaults=createCombatState();
  const persisted=p as Partial<CombatState>&{
    inventoryByDungeon?:Partial<Record<CombatDungeonId,unknown>>;
    equipmentByDungeon?:Partial<Record<CombatDungeonId,Record<string,unknown>>>;
  };
  // Current inventory is authoritative when present; merge in old dungeon bags so previously collected gear is retained.
  const rawInventory:unknown[]=[];
  if(Array.isArray(p.inventory))for(const item of p.inventory)rawInventory.push(item);
  for(const dungeon of ['undercrypt','cinder-vault','glass-labyrinth'] as const){
    const legacyBag=persisted.inventoryByDungeon?.[dungeon];
    if(Array.isArray(legacyBag))for(const item of legacyBag)rawInventory.push(item);
  }
  if(rawInventory.length===0)for(const item of defaults.inventory)rawInventory.push(item);
  const knownGearIds=new Set<string>();
  s.inventory=rawInventory.map(g=>normalizeGear(g,Math.max(0,s.depth-1))).filter((g):g is CombatGear=>{
    if(!g||knownGearIds.has(g.id))return false;
    knownGearIds.add(g.id);return true;
  });
  // A malformed stash must not leave the player with no usable build.
  if(s.inventory.length===0)s.inventory=defaults.inventory.map(item=>({...item}));
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
  const desired:Record<CombatGearSlot,string|null>={
    weapon:typeof savedEquipment?.weapon==='string'?savedEquipment.weapon:defaults.equipment.weapon,
    helmet:typeof savedEquipment?.helmet==='string'?savedEquipment.helmet:null,
    armor:typeof savedEquipment?.armor==='string'?savedEquipment.armor:typeof savedEquipment?.chest==='string'?savedEquipment.chest:defaults.equipment.armor,
    gloves:typeof savedEquipment?.gloves==='string'?savedEquipment.gloves:null,
    boots:typeof savedEquipment?.boots==='string'?savedEquipment.boots:null,
    ring:typeof savedEquipment?.ring==='string'?savedEquipment.ring:null,
    amulet:typeof savedEquipment?.amulet==='string'?savedEquipment.amulet:null,
  };
  const slots:CombatGearSlot[]=['weapon','armor','helmet','gloves','boots','ring','amulet'];
  const migratedEquipment={} as Record<CombatGearSlot,string|null>;
  for(const slot of slots){
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
  const seenRuneIds=new Set<string>();
  s.runes=(Array.isArray(p.runes)?p.runes:[]).map(normalizeRuneItem).filter((rune):rune is NonNullable<ReturnType<typeof normalizeRuneItem>>=>{
    if(!rune||seenRuneIds.has(rune.id))return false;
    seenRuneIds.add(rune.id);return true;
  }).slice(0,RUNE_INVENTORY_CAP);
  const ownedRuneIds=new Set(s.runes.map(rune=>rune.id));
  const savedEquippedRunes=Array.isArray(p.equippedRunes)?p.equippedRunes.filter((id):id is string=>typeof id==='string'&&ownedRuneIds.has(id)):[];
  s.equippedRunes=[...new Set(savedEquippedRunes)].slice(0,RUNE_EQUIPMENT_SLOTS);
  synchronizeCombatStats(s);
  const enemy=getEnemyForDungeonDepth(s.dungeonId,s.depth);s.enemyHp=finiteInt(s.enemyHp,enemy.maxHp,1,enemy.maxHp);
  return s;
}
function createGear(sourceFloor:number,requestedSlot?:CombatGearSlot,requestedQuality?:number):CombatGear {
  const floor=Math.max(0,Math.min(COMBAT_MAX_DEPTH-1,Math.floor(Number(sourceFloor)||0)));
  const scale=floor+1;
  const slots:CombatGearSlot[]=['weapon','armor','helmet','gloves','boots','ring','amulet'];
  const slot=requestedSlot??pick(slots);
  // Natural drops remain random; Forge can supply an exact requested quality.
  const quality=Number.isFinite(Number(requestedQuality))?Math.round(Math.max(0,Math.min(100,Number(requestedQuality)))*100)/100:Math.round(10_000*Math.pow(secureRandom(),4))/100;
  const firstWords=['Ashen','Hollow','Cinder','Riftbound','Starforged','Warden’s','Lost','Quiet','Infinity-Touched','Dread','Veiled','Frostbitten'];
  const secondWords=['Riftbound','Starforged','Moonfallen','Emberwrought','Graveborn','Voidwoven','Dawnbreak','Stormforged','Frostmarked','Kingslayer','Nightglass','Runebound'];
  const nouns:Record<CombatGearSlot,string[]>={weapon:['Cleaver','Brand','Knife','Axe','Fang','Edge','Spear','Greatblade'],helmet:['Helm','Visor','Crown','Circlet','Mask'],armor:['Cuirass','Plate','Mantle','Hauberk','Aegis'],gloves:['Grips','Gauntlets','Handguards','Bindings'],boots:['Greaves','Strideboots','Treads','Sabatons'],ring:['Signet','Band','Loop','Ring'],amulet:['Pendant','Talisman','Medallion','Amulet']};
  const weaponTraits:CombatTrait[]=['bleed','keen','first-strike'], armorTraits:CombatTrait[]=['bulwark','regeneration','desperation'];
  const trait=slot==='weapon'?pick(weaponTraits):pick(armorTraits);
  const power=Math.max(3,Math.round(Math.min(1_000_000,scale)*(.65+quality/80)));
  const isProtective=['helmet','armor','gloves','boots'].includes(slot);
  // Slots have a natural bias, but random affixes create flexible item builds.
  const damageBonus=slot==='weapon'?Math.max(1,Math.round(power*.8)):secureRandom()<.45?Math.max(1,Math.round(power*.7)):0;
  // Turn-speed bonuses are granted only through Major Abilities, not ordinary gear affixes.
  const speedBonus=0;
  const maxHealthBonus=slot==='armor'?Math.max(5,Math.round(power*4)):isProtective?Math.max(0,Math.round(power*1.4)):secureRandom()<.2?Math.max(1,Math.round(power*.9)):0;
  const armorBonus=isProtective?Math.max(1,Math.round(power*(slot==='armor' ? .65 : .55))):secureRandom()<.25?Math.max(1,Math.round(power*.3)):0;
  const critChanceBonus=slot==='ring'||slot==='amulet'?Math.min(.30,.05+quality*.0025):secureRandom()<.28?Math.min(.30,.06+quality*.0028):0;
  const majorAbilityChance=combatMajorAbilityChance(quality);
  const majorAbilityRoll=secureRandom();
  const majorAbility:CombatMajorAbility|undefined=majorAbilityRoll<majorAbilityChance
    ?(()=>{
      const kind=Math.floor(secureRandom()*4);
      if(kind===0){const speedPercent=Math.round((.10+quality*.0025)*1000)/1000;return {id:'chrono-surge',name:'Chrono Surge',trigger:'passive',speedPercent,description:'Increases turn speed by '+Math.round(speedPercent*100)+'% while equipped.'} as const;}
      if(kind===1)return {id:'second-dawn',name:'Second Dawn',trigger:'on-damage',healPercent:.15,description:'After taking damage, heal 15% of Max HP at the start of your next turn.'} as const;
      if(kind===2){const damagePercent=Math.round((.08+quality*.001)*1000)/1000;return {id:'void-edge',name:'Void Edge',trigger:'passive',damagePercent,description:'Increases outgoing damage by '+Math.round(damagePercent*100)+'% while equipped.'} as const;}
      const damageReduction=Math.round((.05+quality*.0005)*1000)/1000;return {id:'aegis-ward',name:'Aegis Ward',trigger:'passive',damageReduction,description:'Reduces incoming damage by '+Math.round(damageReduction*100)+'% while equipped.'} as const;
    })()
    :undefined;
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
/** Read a player's permanent Rune stash and main-game bonuses. */
export async function getCombatRunes():Promise<{runes:CombatState['runes'];equippedRunes:string[];bonuses:ReturnType<typeof runeBonusesFromLoadout>}>{
  const s=normalizeState(await redis.get(combatKey()));
  return {runes:s.runes,equippedRunes:s.equippedRunes,bonuses:runeBonusesFromLoadout(s.runes,s.equippedRunes)};
}
export async function equipCombatRune(runeIdValue:unknown,equip:boolean):Promise<{runes:CombatState['runes'];equippedRunes:string[];bonuses:ReturnType<typeof runeBonusesFromLoadout>}>{
  const runeId=typeof runeIdValue==='string'?runeIdValue.trim():'';
  if(!runeId||runeId.length>160)throw new Error('A valid Rune is required.');
  return mutate(s=>{
    const rune=s.runes.find(item=>item.id===runeId);
    if(!rune)throw new Error('Rune not owned.');
    if(equip){
      if(!s.equippedRunes.includes(runeId)){
        if(s.equippedRunes.length>=RUNE_EQUIPMENT_SLOTS)throw new Error('All Rune slots are full.');
        s.equippedRunes.push(runeId);
      }
    }else s.equippedRunes=s.equippedRunes.filter(id=>id!==runeId);
    return {runes:s.runes,equippedRunes:s.equippedRunes,bonuses:runeBonusesFromLoadout(s.runes,s.equippedRunes)};
  });
}
/** Read the shared Combat Marks wallet for the global HUD without creating/writing combat state. */
export async function getCombatMarksBalance():Promise<number>{
  return normalizeState(await redis.get(combatKey())).combatMarks;
}
export async function getCombatSnapshot():Promise<CombatSnapshot>{
  let coreProgression:{level?:unknown;highestRarity?:unknown;autoScrapLevel?:unknown;autoScrapSettings?:unknown}|null=null;
  try {
    const core=await loadRaw();
    coreProgression={level:core.level,highestRarity:core.highestRarity,autoScrapLevel:core.prestigeUpgrades?.autoScrap,autoScrapSettings:core.combatAutoScrap};
  } catch(error) {
    // Core-game progress is a bonus, not a prerequisite for loading combat.
    console.error('[Combat] Could not refresh core-game attunement; retaining saved values.',error);
  }
  const state=await mutate(s=>{
    if(coreProgression){
      s.coreLevel=finiteInt(coreProgression.level,s.coreLevel,1,1_000_000);
      s.coreHighestRarity=finiteInt(coreProgression.highestRarity,s.coreHighestRarity,2,1_000_000_000_000_000_000);
      s.autoScrapUnlocked=Number(coreProgression.autoScrapLevel)>0;
      s.autoScrapSettings=normalizeCombatAutoScrapSettings(coreProgression.autoScrapSettings);
      if(!s.autoScrapUnlocked)s.autoScrapSettings.enabled=false;
    }
    synchronizeCombatStats(s);
    return s;
  });
  const userId=String(context.userId??'').trim();
  if(userId){
    const profile=createArenaProfile(userId,arenaName(context.username),state,Date.now());
    await redis.hSet(ARENA_PROFILE_KEY,{[userId]:JSON.stringify(profile)}).catch((error: unknown)=>console.error('[Combat Arena] Profile registration failed.',error));
  }
  return snapshot(state);
}
function grantXp(s:CombatState,amount:number,actions:CombatAction[]):void {
  s.xp+=amount;
  while(s.xp>=s.xpToNext&&s.level<60){s.xp-=s.xpToNext;s.level+=1;s.xpToNext=Math.round(s.xpToNext*1.19);synchronizeCombatStats(s);s.health=Math.min(s.maxHealth,s.health+Math.round(s.maxHealth*.08));actions.push({actor:'player',kind:'level',text:'Delver reached Level '+s.level+'.'});}
}
export async function performCombatBeat(sequence:number,intent:CombatCommand,skillIdValue?:unknown):Promise<CombatSnapshot&{actions:CombatAction[];defeated:boolean;died:boolean;item?:CombatGear;orbRoll:CombatOrbRoll;abilityCast?:{id:CombatSkillId;rank:number;cooldown:number}}> {
  let orbLuck=1;
  try { orbLuck=luckMultiplier(await loadRaw()); }
  catch(error) { console.error('[Combat] Could not refresh Luck for the beat orb; using baseline Luck.',error); }
  return mutate(s=>{
    if(sequence!==s.sequence+1)throw new Error('stale combat sequence');
    const activeSkillId=typeof skillIdValue==='string'&&COMBAT_SKILLS.some(skill=>skill.id===skillIdValue)?skillIdValue as CombatSkillId:null;
    const activeSkill=intent==='ability'&&activeSkillId?COMBAT_SKILLS.find(skill=>skill.id===activeSkillId):null;
    if(intent==='ability'&&!activeSkill)throw new Error('Choose a valid equipped ability.');
    if(activeSkill){
      if(!s.equippedAbilities.includes(activeSkill.id)||(s.skillLevels[activeSkill.id]??0)<1)throw new Error('Ability is not equipped.');
      if((s.abilityCooldowns[activeSkill.id]??0)>s.sequence)throw new Error('Ability is on cooldown.');
      if(combatEnergyAfterRegen(s.energy,s.maxEnergy)<combatSkillEnergyCost(activeSkill.rarity))throw new Error('Not enough energy for this ability.');
    }
    const activeSkillRank=activeSkill?Math.max(1,Number(s.skillLevels[activeSkill.id])||1):0;
    const now=Date.now();
    const elapsed=s.lastAcceptedBeatAtMs>0?Math.max(0,now-s.lastAcceptedBeatAtMs):Number.POSITIVE_INFINITY;
    if(elapsed<COMBAT_BEAT_INTERVAL_MS)throw new Error('COMBAT_BEAT_TOO_SOON:'+Math.max(1,COMBAT_BEAT_INTERVAL_MS-elapsed));
    s.lastAcceptedBeatAtMs=now;
    const actions:CombatAction[]=[];synchronizeCombatStats(s);s.sequence+=1;s.combatBeats+=1;s.energy=combatEnergyAfterRegen(s.energy,s.maxEnergy);
    if(s.pendingHealAmount>0){
      const heal=Math.min(s.pendingHealAmount,Math.max(0,s.maxHealth-s.health));s.pendingHealAmount=0;
      if(heal>0){s.health=Math.min(s.maxHealth,s.health+heal);actions.push({actor:'player',kind:'ability',text:'Second Dawn restored '+heal.toLocaleString()+' HP from its delayed heal.'});}
    }
    let enemy=getEnemyForDungeonDepth(s.dungeonId,s.depth);const stats=combatStatsFor(s);
    // Each accepted beat receives its own server-side cryptographic orb roll; rarity drives all attacks that beat.
    const orbRarity=rollContinuum(orbLuck,secureRandom),orbInfo=getOrbInfo(orbRarity),damageMultiplier=combatOrbDamageMultiplier(orbRarity);
    const orbRoll:CombatOrbRoll={rarity:orbRarity,tier:String(orbInfo.tier),name:orbInfo.name,damageMultiplier,baseDamage:Math.max(1,Math.round(stats.damage*damageMultiplier))};
    actions.push({actor:'player',kind:'ability',text:'Orb roll: '+orbInfo.name+' · 1 / '+orbRarity.toLocaleString()+' · ×'+damageMultiplier.toFixed(2)+' damage.'});
    const resolvedIntent:CombatIntent=intent==='auto'?chooseAutoCombatIntent(s):intent==='ability'?'strike':intent;
    const playerActions=Math.min(12,Math.max(0,Math.floor(s.combatBeats*stats.speed/100)-s.playerActionsResolved));
    const enemyActions=Math.min(3,Math.max(0,Math.floor(s.combatBeats*enemy.speed/100)-s.enemyActionsResolved));
    if(activeSkill&&playerActions<1)throw new Error('No player action is ready for this ability.');
    s.playerActionsResolved+=playerActions;s.enemyActionsResolved+=enemyActions;
    let enemyHp=Math.max(1,s.enemyHp||enemy.maxHp),heavy=false,consumed=false,defeated=false,died=false;
    let item:CombatGear|undefined;
    let activeDamageMultiplier=1,activeGuaranteedCrit=false,activeExtraAttacks=0,activeFlurryMultiplier=1;
    let abilityCast:{id:CombatSkillId;rank:number;cooldown:number}|undefined;
    if(activeSkill){
      const energyCost=combatSkillEnergyCost(activeSkill.rarity);
      s.energy=Math.max(0,s.energy-energyCost);
      const cooldown=combatSkillCooldown(activeSkill.rarity,activeSkillRank);
      s.abilityCooldowns[activeSkill.id]=s.sequence+cooldown;
      abilityCast={id:activeSkill.id,rank:activeSkillRank,cooldown};
      const archetype=combatAbilityType(activeSkill),rankScale=Math.log2(activeSkillRank+1);
      if(archetype==='strike'){
        activeDamageMultiplier=1.2+activeSkill.value*2+rankScale*.15;
        actions.push({actor:'player',kind:'ability',text:activeSkill.name+' empowers the next strike ('+Math.round((activeDamageMultiplier-1)*100)+'% bonus damage).'});
      } else if(archetype==='flurry'){
        activeExtraAttacks=combatEffectiveFlurryBonusAttacks(1+Math.floor(rankScale),playerActions);
        activeFlurryMultiplier=combatFlurryAttackMultiplier(activeSkill.value);
        actions.push({actor:'player',kind:'ability',text:activeSkill.name+' adds '+activeExtraAttacks+' bonus strikes at '+Math.round(activeFlurryMultiplier*100)+'% damage each.'});
      } else if(archetype==='mend'){
        const healRatio=Math.min(.9,.10+activeSkill.value+rankScale*.06),before=s.health;
        s.health=Math.min(s.maxHealth,s.health+Math.max(1,Math.round(s.maxHealth*healRatio)));
        actions.push({actor:'player',kind:'ability',text:activeSkill.name+' restores '+(s.health-before)+' HP.'});
      } else if(archetype==='focus'){
        activeGuaranteedCrit=true;activeDamageMultiplier=1.65+activeSkill.value*2+rankScale*.15;
        actions.push({actor:'player',kind:'ability',text:activeSkill.name+' guarantees a critical strike.'});
      } else {
        const reward=combatBountyReward(activeSkill.value,activeSkillRank);
        const bountyMarks=Math.min(Number.MAX_SAFE_INTEGER-s.combatMarks,reward);
        s.combatMarks+=bountyMarks;
        actions.push({actor:'player',kind:'ability',text:activeSkill.name+' grants '+bountyMarks.toLocaleString()+' Combat Marks.'});
      }
    }
    if(resolvedIntent==='heavy'&&s.energy>=3&&playerActions>0){s.energy-=3;heavy=true;actions.push({actor:'player',kind:'ability',text:'Heavy strike prepared.'});}
    else if(resolvedIntent==='guard'&&s.energy>=2&&playerActions>0){s.energy-=2;s.guardBeats=1;consumed=true;actions.push({actor:'player',kind:'ability',text:'Guard raised. Incoming hits are softened.'});}
    else if(resolvedIntent==='mend'&&s.health>=s.maxHealth&&playerActions>0)actions.push({actor:'player',kind:'ability',text:'Already at full health. Basic attacks continue.'});
    else if(resolvedIntent==='mend'&&s.energy>=4&&playerActions>0&&s.health<s.maxHealth){s.energy-=4;const before=s.health;s.health=Math.min(s.maxHealth,s.health+Math.max(1,Math.round(s.maxHealth*.14)));consumed=true;actions.push({actor:'player',kind:'ability',text:'Mend restored '+(s.health-before)+' HP.'});}
    else if(resolvedIntent!=='strike')actions.push({actor:'player',kind:'ability',text:'Not enough energy or no action ready. Basic attacks continue.'});
    const attacks=Math.min(12,Math.max(0,playerActions-(consumed?1:0))+activeExtraAttacks),weapon=s.inventory.find(g=>g.id===s.equipment.weapon);
    for(let i=0;i<attacks;i++){
      if(enemyHp<=0)break;
      let multiplier=(heavy&&i===0?1.9:1)*(activeSkill&&i===0?activeDamageMultiplier:1)*(activeSkill&&combatAbilityType(activeSkill)==='flurry'&&i>=playerActions?activeFlurryMultiplier:1);
      if(!s.encounterFirstStrikeUsed){if(weapon?.trait==='first-strike')multiplier*=1+.5*gearQualityEffectiveness(weapon,Math.max(0,s.depth-1));s.encounterFirstStrikeUsed=true;}
      const crit=(activeSkill&&i===0&&activeGuaranteedCrit)||secureRandom()<stats.critChance;let damage=Math.max(1,Math.round(orbRoll.baseDamage*(crit?1.75:1)*multiplier));
      if(weapon?.trait==='bleed'&&secureRandom()<.18*gearQualityEffectiveness(weapon,Math.max(0,s.depth-1))){const bleed=Math.max(1,Math.round(orbRoll.baseDamage*.3*gearQualityEffectiveness(weapon,Math.max(0,s.depth-1))));damage+=bleed;actions.push({actor:'player',kind:'ability',text:'Bleed adds '+bleed+' damage.'});}
      enemyHp-=damage;actions.push({actor:'player',kind:'attack',damage,text:(crit?'Critical hit for ':'Strike for ')+damage+' damage.'});
      if(enemyHp<=0){
        defeated=true;actions.push({actor:'player',kind:'death',text:'The '+enemy.name+' falls.'});s.totalKills=Math.min(Number.MAX_SAFE_INTEGER,s.totalKills+1);
        const coins=Math.max(1,Math.round((12+s.depth*2.4)*stats.coinMultiplier*(s.dungeonId==='cinder-vault'?1.4:1)));
        const baseMarks=Math.max(1,2+Math.floor(Math.max(0,s.depth-1)/2)+(enemy.kind==='elite'?2:enemy.boss?8:0));
        const marks=Math.max(1,Math.round(baseMarks*combatMarkMultiplier(s)));
        const combinedReward=Math.min(Number.MAX_SAFE_INTEGER-s.combatMarks,coins+marks);
        s.combatMarks+=combinedReward;
        actions.push({actor:'player',kind:'loot',text:'Earned '+combinedReward.toLocaleString()+' Combat Marks from the kill.'});
        grantXp(s,Math.round((18+s.depth*4.2)*(s.dungeonId==='glass-labyrinth'?1.25:1)),actions);
        if((s.dungeonId==='cinder-vault'?s.depth%4===0:s.depth%5===0)||enemy.kind!=='common'||enemy.boss){
          item=createGear(Math.max(0,s.depth-1));
          if(s.autoScrapUnlocked&&s.autoScrapSettings.enabled&&item.quality<=s.autoScrapSettings.maxQuality){
            const gained=combatScrapValue(item);s.scrap=Math.min(Number.MAX_SAFE_INTEGER,s.scrap+gained);
            actions.push({actor:'player',kind:'loot',text:'Auto-scrapped '+item.name+' ('+item.quality.toFixed(2)+'% quality) for '+gained+' Scrap.'});
            item=undefined;
          } else {addCombatGearToInventory(s,item);actions.push({actor:'player',kind:'loot',text:'Gear found: '+item.name+' ('+item.quality.toFixed(2)+'% quality).'});}
        }
        const runeDropChance = enemy.boss ? 1 : enemy.kind === 'elite' ? 0.30 : 0.08;
        if(secureRandom()<runeDropChance){
          if(s.runes.length<RUNE_INVENTORY_CAP){
            const rune=createRuneDrop(s.depth,secureRandom,now);
            s.runes.push(rune);
            actions.push({actor:'player',kind:'loot',text:'Rune found: '+rune.name+' · '+rune.rarity+' · '+Object.entries(rune.stats).map(([stat,value])=>stat.toUpperCase()+' +'+(Number(value)*100).toFixed(2)+'%').join(', ')+'. Equip it in the Runes menu for permanent main-game bonuses.'});
          }else actions.push({actor:'player',kind:'loot',text:'Rune found, but your Rune stash is full. Make room in the Runes menu to collect more.'});
        }
        const regeneration=s.inventory.find(g=>Object.values(s.equipment).includes(g.id)&&g.trait==='regeneration');
        if(regeneration&&enemy.kind!=='common'){s.health=Math.min(s.maxHealth,s.health+Math.round(s.maxHealth*.02*gearQualityEffectiveness(regeneration,Math.max(0,s.depth-1))));actions.push({actor:'player',kind:'ability',text:'Regeneration restored 2% max HP.'});}
        s.bestDepth=Math.max(s.bestDepth,s.depth);
        s.dungeonBestDepths[s.dungeonId]=Math.max(s.dungeonBestDepths[s.dungeonId],s.bestDepth);
        s.combatBeats=0;s.playerActionsResolved=0;s.enemyActionsResolved=0;s.guardBeats=0;s.encounterFirstStrikeUsed=false;
        if(s.depth>=COMBAT_MAX_DEPTH){
          // Do not step beyond the normalized depth limit and farm a capped room forever.
          s.runId+=1;s.depth=1;resetCombatRunCarry(s);s.energy=Math.min(s.maxEnergy,3);s.enemyHp=getEnemyForDungeonDepth(s.dungeonId,1).maxHp;synchronizeCombatStats(s);s.health=s.maxHealth;
          actions.push({actor:'player',kind:'advance',text:'Depth limit reached. A new descent begins at Depth 1; all permanent progress remains.'});
        }else{
          s.depth+=1;s.bestDepth=Math.max(s.bestDepth,s.depth);s.dungeonBestDepths[s.dungeonId]=Math.max(s.dungeonBestDepths[s.dungeonId],s.bestDepth);s.energy=Math.min(s.maxEnergy,s.energy+1);
          enemy=getEnemyForDungeonDepth(s.dungeonId,s.depth);s.enemyHp=enemy.maxHp;actions.push({actor:'player',kind:'advance',text:'Descending to Depth '+s.depth+'.'});
        }
        break;
      }
    }
    let guardWasUsed=false;
    if(!defeated)for(let i=0;i<enemyActions;i++){
      let incoming=enemy.damage,strike='The '+enemy.name+' hits for ';
      if(enemy.boss&&s.combatBeats%4===0){incoming=Math.round(incoming*1.75);strike='The '+enemy.name+' cleaves for ';}
      else if(enemy.id.endsWith('ember-acolyte')&&s.combatBeats%3===0){incoming+=Math.round(s.maxHealth*.035);strike='The Ember Acolyte burns for ';}
      if(s.guardBeats>0){incoming=Math.round(incoming*.45);guardWasUsed=true;}
      incoming=Math.max(1,Math.round(incoming*(1-stats.damageReduction)));s.health=Math.max(0,s.health-incoming);
      actions.push({actor:'enemy',kind:'attack',damage:incoming,text:strike+incoming+' damage.'});
      const defensiveAbility=s.inventory.find(g=>g.majorAbility?.id==='second-dawn'&&g.majorAbility.trigger==='on-damage'&&Object.values(s.equipment).includes(g.id))?.majorAbility;
      if(defensiveAbility?.id==='second-dawn'&&s.pendingHealAmount===0){
        s.pendingHealAmount=Math.max(1,Math.round(s.maxHealth*defensiveAbility.healPercent));
        actions.push({actor:'player',kind:'ability',text:defensiveAbility.name+' triggered: '+Math.round(defensiveAbility.healPercent*100)+'% Max HP healing queued for your next turn.'});
      }
      if(s.health<=0){died=true;s.pendingHealAmount=0;actions.push({actor:'enemy',kind:'death',text:'Run '+s.runId+' ended at Depth '+s.depth+'. Permanent progress retained.'});s.runId+=1;s.depth=1;resetCombatRunCarry(s);s.combatBeats=0;s.playerActionsResolved=0;s.enemyActionsResolved=0;s.energy=Math.min(s.maxEnergy,3);s.guardBeats=0;s.encounterFirstStrikeUsed=false;s.enemyHp=getEnemyForDungeonDepth(s.dungeonId,1).maxHp;synchronizeCombatStats(s);s.health=s.maxHealth;actions.push({actor:'player',kind:'advance',text:'A new descent begins automatically at Depth 1.'});break;}
    }
    // If no enemy action fires, preserve Guard until the next actual incoming strike.
    if(guardWasUsed)s.guardBeats=0;
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
    const gained=combatScrapValue(item);state.scrap=Math.min(Number.MAX_SAFE_INTEGER,state.scrap+gained);
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
  const shouldEquip=equipValue===true;
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
  return {
    userId,
    username: arenaName(username),
    level: state.level,
    bestDepth: state.bestDepth,
    rating: state.arenaRating,
    wins: state.arenaWins,
    losses: state.arenaLosses,
    updatedAt,
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
    cooldownRemainingMs: Math.max(0, ARENA_CHALLENGE_COOLDOWN_MS - (now - state.arenaLastChallengeAt)),
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
      const opponentState = normalizeState(opponentRaw);
      const now = Date.now();
      const remaining = ARENA_CHALLENGE_COOLDOWN_MS - (now - ownState.arenaLastChallengeAt);
      if (remaining > 0) {
        await txn.unwatch(); closed = true;
        throw new Error('ARENA_COOLDOWN:' + remaining);
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
  const rarity = Number.isFinite(raw) ? Math.max(2, Math.min(1_000_000_000_000_000_000, Math.floor(raw))) : 2;
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
    if (state.dungeonId === nextDungeon) return snapshot(state);
    state.dungeonId = nextDungeon;
    state.depth = 1;
    state.bestDepth = state.dungeonBestDepths[nextDungeon];
    state.runId += 1;
    resetCombatRunCarry(state);
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

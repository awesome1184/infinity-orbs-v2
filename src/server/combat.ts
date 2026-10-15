import { context, redis } from './devvit-mock.js';
import type { CombatAction, CombatEnemy, CombatGear, CombatIntent, CombatSkillId, CombatSnapshot, CombatState, CombatTrait } from '../shared/combat.js';
import { COMBAT_INVENTORY_CAP, COMBAT_SKILLS, SKILL_RANK_CAP, addCombatGearToInventory, applyCombatSkillCopy, combatStatsFor, createCombatState, getEnemyForDepth, skillPullCost, synchronizeCombatStats } from '../shared/combat.js';

const MAX_CAS_ATTEMPTS=8, INVENTORY_CAP=COMBAT_INVENTORY_CAP;
function combatKey():string { const id=String(context.userId??'').trim(); if(!id) throw new Error('REDDIT_LOGIN_REQUIRED'); return 'infinity-orbs:combat:'+id; }
// Match the server RNG used by core orb rolls. Combat rewards must not rely on
// combatRandom(), which is not designed for security-sensitive server decisions.
function combatRandom():number {
  const sample=new Uint32Array(1);
  globalThis.crypto.getRandomValues(sample);
  return sample[0]! / 0x1_0000_0000;
}
function pick<T>(values:T[]):T { return values[Math.floor(combatRandom()*values.length)]!; }
function finiteInt(value:unknown,fallback:number,min:number,max:number):number { const n=Number(value); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback; }
function traitText(t:CombatTrait):string {
  if(t==='bleed')return '18% chance to add bonus bleed damage.';
  if(t==='keen')return '+4 percentage points of critical chance.';
  if(t==='first-strike')return 'First attack against each foe deals 50% extra damage.';
  if(t==='bulwark')return 'Reduces incoming damage by 4%.';
  if(t==='regeneration')return 'Recover 2% max HP after elite or boss kills.';
  return 'Gain +20 Speed while below 40% health.';
}
function normalizeGear(value:unknown):CombatGear|null {
  if(!value||typeof value!=='object')return null;
  const x=value as Record<string,unknown>, slot=x.slot==='weapon'?'weapon':x.slot==='armor'?'armor':null;
  const traits:CombatTrait[]=['bleed','keen','first-strike','bulwark','regeneration','desperation'];
  if(!slot||typeof x.id!=='string'||!x.id||typeof x.name!=='string')return null;
  const trait=traits.includes(x.trait as CombatTrait)?x.trait as CombatTrait:(slot==='weapon'?'keen':'bulwark');
  return {id:x.id.slice(0,160),name:x.name.slice(0,100),slot,quality:Math.max(0,Math.min(100,Number.isFinite(Number(x.quality))?Number(x.quality):0)),power:finiteInt(x.power,1,1,1_000_000),effect:typeof x.effect==='string'?x.effect.slice(0,180):traitText(trait),trait,damageBonus:finiteInt(x.damageBonus,0,0,1_000_000),speedBonus:finiteInt(x.speedBonus,0,0,400),maxHealthBonus:finiteInt(x.maxHealthBonus,0,0,1_000_000)};
}
function normalizeState(raw:string|null|undefined):CombatState {
  if(!raw)return createCombatState();
  let p:Partial<CombatState>;
  try { p=JSON.parse(raw) as Partial<CombatState>; if(!p||typeof p!=='object'||Array.isArray(p))return createCombatState(); } catch { return createCombatState(); }
  const s=Object.assign(createCombatState(),p);
  s.version=1;s.dungeonId='undercrypt';s.runId=finiteInt(s.runId,1,1,Number.MAX_SAFE_INTEGER);s.depth=finiteInt(s.depth,1,1,50000);
  s.bestDepth=Math.max(s.depth,finiteInt(s.bestDepth,1,1,50000));s.level=finiteInt(s.level,1,1,60);s.xp=finiteInt(s.xp,0,0,Number.MAX_SAFE_INTEGER);
  s.xpToNext=finiteInt(s.xpToNext,100,1,1_000_000_000);s.coins=finiteInt(s.coins,250,0,Number.MAX_SAFE_INTEGER);s.totalKills=finiteInt(s.totalKills,0,0,Number.MAX_SAFE_INTEGER);
  s.skillRolls=finiteInt(s.skillRolls,0,0,Number.MAX_SAFE_INTEGER);s.sequence=finiteInt(s.sequence,0,0,Number.MAX_SAFE_INTEGER);s.combatBeats=finiteInt(s.combatBeats,0,0,Number.MAX_SAFE_INTEGER);
  s.playerActionsResolved=finiteInt(s.playerActionsResolved,0,0,Number.MAX_SAFE_INTEGER);s.enemyActionsResolved=finiteInt(s.enemyActionsResolved,0,0,Number.MAX_SAFE_INTEGER);
  s.energy=finiteInt(s.energy,3,0,10);s.maxEnergy=finiteInt(s.maxEnergy,5,1,10);s.guardBeats=finiteInt(s.guardBeats,0,0,10);s.encounterFirstStrikeUsed=s.encounterFirstStrikeUsed===true;
  const inv=Array.isArray(s.inventory)?s.inventory.map(normalizeGear).filter((g):g is CombatGear=>Boolean(g)):[];
  s.inventory=inv.length?inv:createCombatState().inventory;
  const preferredWeaponId=typeof s.equipment?.weapon==='string'?s.equipment.weapon:null;
  const preferredArmorId=typeof s.equipment?.armor==='string'?s.equipment.armor:null;
  while(s.inventory.length>INVENTORY_CAP){
    let removable=-1;
    for(let index=s.inventory.length-1;index>=0;index--){
      const gear=s.inventory[index]!;
      if(gear.id!==preferredWeaponId&&gear.id!==preferredArmorId){removable=index;break;}
    }
    if(removable<0)break;
    s.inventory.splice(removable,1);
  }
  const w=s.inventory.find(g=>g.id===s.equipment?.weapon&&g.slot==='weapon'),a=s.inventory.find(g=>g.id===s.equipment?.armor&&g.slot==='armor');
  s.equipment={weapon:w?.id??s.inventory.find(g=>g.slot==='weapon')?.id??null,armor:a?.id??s.inventory.find(g=>g.slot==='armor')?.id??null};
  const levels:Partial<Record<CombatSkillId,number>>={};
  for(const skill of COMBAT_SKILLS){const rank=finiteInt(s.skillLevels?.[skill.id],0,0,SKILL_RANK_CAP);if(rank)levels[skill.id]=rank;}
  s.skillLevels=levels;synchronizeCombatStats(s);
  const enemy=getEnemyForDepth(s.depth);s.enemyHp=finiteInt(s.enemyHp,enemy.maxHp,1,enemy.maxHp);
  return s;
}
function createGear(depth:number):CombatGear {
  const slot=combatRandom()<.5?'weapon':'armor';
  // Fourth-power quality distribution is from Auto-Dungeons; 100% rolls are extremely rare.
  const quality=Math.round(1_000_000*Math.pow(combatRandom(),4))/10_000;
  const prefix=slot==='weapon'?['Ashen','Hollow','Cinder','Riftbound','Starforged','Warden’s','Lost','Quiet','Infinity-Touched']:['Delver’s','Warden’s','Old','Cinder','Riftweave','Ironbound','Boneguard','Hollow','Starweave'];
  const nouns=slot==='weapon'?['Cleaver','Brand','Knife','Axe','Fang','Edge','Spear','Greatblade']:['Hood','Plate','Scale','Mantle','Coat','Shell','Vest','Mail'];
  const weaponTraits:CombatTrait[]=['bleed','keen','first-strike'], armorTraits:CombatTrait[]=['bulwark','regeneration','desperation'];
  const trait=slot==='weapon'?pick(weaponTraits):pick(armorTraits);
  const power=Math.max(3,Math.round(Math.min(1_000_000,depth)*(.65+quality/80)));
  return {id:'gear-'+Date.now().toString(36)+'-'+Math.floor(combatRandom()*0x7fffffff).toString(36),name:pick(prefix)+' '+pick(nouns),slot,quality,power,trait,effect:traitText(trait),damageBonus:slot==='weapon'?Math.max(1,Math.round(power*.8)):0,speedBonus:slot==='weapon'?Math.min(400,Math.round(power*.25)):0,maxHealthBonus:slot==='armor'?Math.max(5,Math.round(power*4)):0};
}
function enemySnapshot(s:CombatState):CombatEnemy { const e=getEnemyForDepth(s.depth); return {...e,hp:Math.max(0,Math.min(e.maxHp,s.enemyHp||e.maxHp))}; }
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
export async function getCombatSnapshot():Promise<CombatSnapshot>{return snapshot(normalizeState(await redis.get(combatKey())));}
function grantXp(s:CombatState,amount:number,actions:CombatAction[]):void {
  s.xp+=amount;
  while(s.xp>=s.xpToNext&&s.level<60){s.xp-=s.xpToNext;s.level+=1;s.xpToNext=Math.round(s.xpToNext*1.19);synchronizeCombatStats(s);s.health=Math.min(s.maxHealth,s.health+Math.round(s.maxHealth*.08));actions.push({actor:'player',kind:'level',text:'Delver reached Level '+s.level+'.'});}
}
export async function performCombatBeat(sequence:number,intent:CombatIntent):Promise<CombatSnapshot&{actions:CombatAction[];defeated:boolean;died:boolean;item?:CombatGear}> {
  return mutate(s=>{
    if(sequence!==s.sequence+1)throw new Error('stale combat sequence');
    const actions:CombatAction[]=[];synchronizeCombatStats(s);s.sequence+=1;s.combatBeats+=1;s.energy=Math.min(s.maxEnergy,s.energy+1);
    let enemy=getEnemyForDepth(s.depth);const stats=combatStatsFor(s);
    const playerActions=Math.min(12,Math.max(0,Math.floor(s.combatBeats*stats.speed/100)-s.playerActionsResolved));
    const enemyActions=Math.min(3,Math.max(0,Math.floor(s.combatBeats*enemy.speed/100)-s.enemyActionsResolved));
    s.playerActionsResolved+=playerActions;s.enemyActionsResolved+=enemyActions;
    let enemyHp=Math.max(1,s.enemyHp||enemy.maxHp),heavy=false,consumed=false,defeated=false,died=false;
    let item:CombatGear|undefined;
    if(intent==='heavy'&&s.energy>=3&&playerActions>0){s.energy-=3;heavy=true;actions.push({actor:'player',kind:'ability',text:'Heavy strike prepared.'});}
    else if(intent==='guard'&&s.energy>=2&&playerActions>0){s.energy-=2;s.guardBeats=1;consumed=true;actions.push({actor:'player',kind:'ability',text:'Guard raised. Incoming hits are softened.'});}
    else if(intent==='mend'&&s.energy>=4&&playerActions>0&&s.health<s.maxHealth){s.energy-=4;const before=s.health;s.health=Math.min(s.maxHealth,s.health+Math.max(1,Math.round(s.maxHealth*.14)));consumed=true;actions.push({actor:'player',kind:'ability',text:'Mend restored '+(s.health-before)+' HP.'});}
    else if(intent!=='strike')actions.push({actor:'player',kind:'ability',text:'Not enough energy or no action ready. Basic attacks continue.'});
    const attacks=Math.max(0,playerActions-(consumed?1:0)),weapon=s.inventory.find(g=>g.id===s.equipment.weapon);
    for(let i=0;i<attacks;i++){
      if(enemyHp<=0)break;
      let multiplier=heavy&&i===0?1.9:1;
      if(!s.encounterFirstStrikeUsed){if(weapon?.trait==='first-strike')multiplier*=1.5;s.encounterFirstStrikeUsed=true;}
      const crit=combatRandom()<stats.critChance;let damage=Math.max(1,Math.round(stats.damage*(crit?1.75:1)*multiplier));
      if(weapon?.trait==='bleed'&&combatRandom()<.18){const bleed=Math.max(1,Math.round(stats.damage*.3));damage+=bleed;actions.push({actor:'player',kind:'ability',text:'Bleed adds '+bleed+' damage.'});}
      enemyHp-=damage;actions.push({actor:'player',kind:'attack',damage,text:(crit?'Critical hit for ':'Strike for ')+damage+' damage.'});
      if(enemyHp<=0){
        defeated=true;actions.push({actor:'player',kind:'death',text:'The '+enemy.name+' falls.'});s.totalKills=Math.min(Number.MAX_SAFE_INTEGER,s.totalKills+1);
        const coins=Math.max(1,Math.round((12+s.depth*2.4)*stats.coinMultiplier));s.coins=Math.min(Number.MAX_SAFE_INTEGER,s.coins+coins);actions.push({actor:'player',kind:'loot',text:'Collected '+coins.toLocaleString()+' Delver Coins.'});
        grantXp(s,Math.round(18+s.depth*4.2),actions);
        if(s.depth%3===0||enemy.kind!=='common'||enemy.boss){item=createGear(s.depth);addCombatGearToInventory(s,item);actions.push({actor:'player',kind:'loot',text:'Gear found: '+item.name+' ('+item.quality.toFixed(2)+'% quality).'});}
        const armor=s.inventory.find(g=>g.id===s.equipment.armor);
        if(armor?.trait==='regeneration'&&enemy.kind!=='common'){s.health=Math.min(s.maxHealth,s.health+Math.round(s.maxHealth*.02));actions.push({actor:'player',kind:'ability',text:'Armor regeneration restored 2% max HP.'});}
        s.bestDepth=Math.max(s.bestDepth,s.depth);s.depth+=1;s.bestDepth=Math.max(s.bestDepth,s.depth);s.combatBeats=0;s.playerActionsResolved=0;s.enemyActionsResolved=0;s.energy=Math.min(s.maxEnergy,s.energy+1);s.guardBeats=0;s.encounterFirstStrikeUsed=false;
        enemy=getEnemyForDepth(s.depth);s.enemyHp=enemy.maxHp;actions.push({actor:'player',kind:'advance',text:'Descending to Depth '+s.depth+'.'});break;
      }
    }
    if(!defeated)for(let i=0;i<enemyActions;i++){
      let incoming=enemy.damage,strike='The '+enemy.name+' hits for ';
      if(enemy.boss&&s.combatBeats%4===0){incoming=Math.round(incoming*1.75);strike='The Crypt Warden cleaves for ';}
      else if(enemy.id==='ember-acolyte'&&s.combatBeats%3===0){incoming+=Math.round(s.maxHealth*.035);strike='The Ember Acolyte burns for ';}
      if(s.guardBeats>0)incoming=Math.round(incoming*.45);
      incoming=Math.max(1,Math.round(incoming*(1-stats.damageReduction)));s.health=Math.max(0,s.health-incoming);
      actions.push({actor:'enemy',kind:'attack',damage:incoming,text:strike+incoming+' damage.'});
      if(s.health<=0){died=true;actions.push({actor:'enemy',kind:'death',text:'Run '+s.runId+' ended at Depth '+s.depth+'. Permanent progress retained.'});s.runId+=1;s.depth=1;s.health=s.maxHealth;s.combatBeats=0;s.playerActionsResolved=0;s.enemyActionsResolved=0;s.energy=Math.min(s.maxEnergy,3);s.guardBeats=0;s.encounterFirstStrikeUsed=false;s.enemyHp=getEnemyForDepth(1).maxHp;actions.push({actor:'player',kind:'advance',text:'A new descent begins automatically at Depth 1.'});break;}
    }
    if(s.guardBeats>0&&!defeated)s.guardBeats-=1;synchronizeCombatStats(s);
    return {...snapshot(s),actions,defeated,died,...(item?{item}:{})};
  });
}
export async function equipCombatItem(itemId:string):Promise<CombatSnapshot>{return mutate(s=>{const item=s.inventory.find(g=>g.id===itemId);if(!item)throw new Error('item not owned');s.equipment[item.slot]=item.id;synchronizeCombatStats(s);return snapshot(s);});}
export async function rollCombatSkill():Promise<CombatSnapshot&{skillRoll:{id:CombatSkillId;name:string;rarity:string;rank:number;duplicate:boolean;convertedCoins:number};cost:number}> {
  return mutate(s=>{
    const cost=skillPullCost(s.skillRolls);if(s.coins<cost)throw new Error('Not enough Delver Coins.');
    s.coins-=cost;s.skillRolls+=1;const chance=combatRandom();
    const rarity=chance<.55?'Common':chance<.80?'Uncommon':chance<.92?'Rare':chance<.98?'Epic':'Mythic';
    const pool=COMBAT_SKILLS.filter(skill=>skill.rarity===rarity),skill=pick(pool);if(!skill)throw new Error('Skill pool is unavailable.');
    const applied=applyCombatSkillCopy(s,skill.id,cost);
    return {...snapshot(s),skillRoll:{id:skill.id,name:skill.name,rarity,rank:applied.rank,duplicate:applied.duplicate,convertedCoins:applied.coinsRefunded},cost};
  });
}

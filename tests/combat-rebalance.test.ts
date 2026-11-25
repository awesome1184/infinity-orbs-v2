import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_MAX_DEPTH, combatGearQualityFromRoll, combatGearRarityForQuality, combatGearRarityOdds,
  combatActionsDue, combatTurnsCrossedThree, combatGearStatBudgetMultiplier, combatNextBeatDelayMs, combatRuneMajorAbilityChance,
  combatRuneMajorAbilityMultiplier, combatRuneMajorAbilityEffects, combatRuneMajorAbilitySummary, combatScrapValue, combatStatsFor, createCombatState,
  getEnemyForDungeonDepth, type CombatGear, type CombatRune,
} from '../src/shared/combat.js';

test('natural gear odds make high grades much rarer',()=>{
  const odds=combatGearRarityOdds();
  assert.ok(odds.Common>.85);
  assert.ok(odds.Mythic<.01);
  assert.ok(odds.Epic<.03);
  assert.equal(combatGearRarityForQuality(14.99),'Common');
  assert.equal(combatGearRarityForQuality(15),'Uncommon');
  assert.equal(combatGearRarityForQuality(40),'Rare');
  assert.equal(combatGearRarityForQuality(70),'Epic');
  assert.equal(combatGearRarityForQuality(90),'Mythic');
  assert.ok(combatGearQualityFromRoll(.99)<90);
  assert.equal(combatGearQualityFromRoll(1),100);
});

test('higher gear quality purchases a substantially larger stat budget',()=>{
  assert.ok(combatGearStatBudgetMultiplier(40)>combatGearStatBudgetMultiplier(15));
  assert.ok(combatGearStatBudgetMultiplier(90)>combatGearStatBudgetMultiplier(15)*5);
  assert.ok(combatGearStatBudgetMultiplier(100)>=5);
});

test('Scrap yields stay at one quarter of the original curve while scaling with depth and power',()=>{
  const starter={power:10,quality:10,sourceFloor:0};
  const originalCurve=Math.round(20+starter.power*1.1+starter.quality*.75);
  assert.ok(combatScrapValue(starter)<=Math.round(originalCurve*.25));
  assert.ok(combatScrapValue(starter)<Math.round(originalCurve*.5));
  assert.ok(combatScrapValue(starter)>=1);
  assert.ok(combatScrapValue({power:100,quality:40,sourceFloor:100})>combatScrapValue(starter));
});

test('Rune Major Ability chance and strength rise with rarity',()=>{
  assert.ok(combatRuneMajorAbilityChance('Cosmic')>combatRuneMajorAbilityChance('Common'));
  assert.ok(combatRuneMajorAbilityMultiplier('Cosmic')>combatRuneMajorAbilityMultiplier('Mythic'));
  assert.ok(combatRuneMajorAbilityMultiplier('Mythic')>combatRuneMajorAbilityMultiplier('Common'));
});

test('new Rune Major Abilities add whole-Shard chance and rarity-floored discovery rolls',()=>{
  const shardTithe:CombatRune={id:'tithe',name:'Shard Tithe',rarity:'Cosmic',stat:'shardChancePct',value:.035,level:1,sourceDepth:10,sourceDungeon:'undercrypt',majorAbility:{id:'shard-tithe',name:'Shard Tithe',valuePct:20,description:'whole Shards'}};
  const discovery:CombatRune={...shardTithe,id:'discovery',majorAbility:{id:'discovery-oracle',name:'Discovery Oracle',valuePct:20,description:'discovery rolls'}};
  const refinery:CombatRune={...shardTithe,id:'refinery',majorAbility:{id:'dry-streak-refinery',name:'Dry-Streak Refinery',valuePct:20,description:'dry-streak Shards'}};
  const effects=combatRuneMajorAbilityEffects([shardTithe,discovery,refinery],[shardTithe.id,discovery.id,refinery.id]);
  assert.equal(effects.shardTithePerRoll,0.00005);
  assert.equal(effects.discoveryOraclePct,20);
  assert.ok(effects.discoveryOracleBonusRolls>=1);
  assert.equal(effects.dryStreakRefineryRate,0.000005);
  assert.match(combatRuneMajorAbilitySummary(shardTithe.majorAbility!,1),/whole Shard/);
  assert.match(combatRuneMajorAbilitySummary(discovery.majorAbility!,1),/first-time rarity discovery/i);
  assert.match(combatRuneMajorAbilitySummary(refinery.majorAbility!,1),/100 rolls since your best rarity/i);
});

test('Auto cadence derives its deadline from the accepted server beat timestamp',()=>{
  assert.equal(combatNextBeatDelayMs(1000,0),0);
  assert.equal(combatNextBeatDelayMs(20000,10000),20150);
  assert.equal(combatNextBeatDelayMs(40000,10000),150);
});

test('Rune Major Abilities are main-game-only and do not change combat stats',()=>{
  const state=createCombatState();
  const rune:CombatRune={
    id:'rune-main-game-only-test',name:'Test Fate Rune',rarity:'Mythic',stat:'luckPct',value:4,level:10,
    sourceDepth:0,sourceDungeon:'undercrypt',
    majorAbility:{id:'fateweaver',name:'Fateweaver',valuePct:25,description:'Main-game Luck only.'},
  };
  state.runes=[rune];state.equippedRunes=[rune.id];
  const baseline=combatStatsFor({...state,runes:[],equippedRunes:[]});
  const equipped=combatStatsFor(state);
  assert.equal(equipped.damage,baseline.damage);
  assert.equal(equipped.maxHealth,baseline.maxHealth);
  assert.equal(equipped.speed,baseline.speed);
  assert.equal(equipped.critChance,baseline.critChance);
});
test('combat Speed controls recharge cadence and fast enemies can earn multiple actions',()=>{
  assert.equal(combatActionsDue(100,1,0),1, 'the opening action is ready');
  assert.equal(combatActionsDue(100,2,1),1, '100 Speed still gets its base action each beat');
  assert.equal(combatActionsDue(400,2,1),2, '400 Speed earns one bonus action after the base action');
  assert.equal(combatActionsDue(700,2,1),2, '700 Speed crosses one bonus threshold after the opener');
  assert.equal(combatActionsDue(80_000,2,1),100, 'large action bursts remain capped');
  assert.ok(getEnemyForDungeonDepth('undercrypt',100).speed>getEnemyForDungeonDepth('undercrypt',1).speed);
});
test('Third-Beat Recharge triggers only when completed player turns cross a multiple of three',()=>{
  assert.equal(combatTurnsCrossedThree(0,2),0);
  assert.equal(combatTurnsCrossedThree(2,3),1);
  assert.equal(combatTurnsCrossedThree(2,8),2);
  assert.equal(combatTurnsCrossedThree(8,7),0);
});
test('Expanded Reserves increases the actual Energy cap',()=>{
  const state=createCombatState();
  const weapon:CombatGear={id:'test-expanded-reserves-weapon',name:'Test Expanded Reserves',slot:'weapon',quality:100,sourceFloor:0,power:1,effect:'More Energy.',trait:'keen',damageBonus:0,speedBonus:0,maxHealthBonus:0,armorBonus:0,critChanceBonus:0};
  state.inventory.push(weapon);
  state.equipment.weapon=weapon.id;
  weapon.majorAbility={id:'expanded-reserves',name:'Expanded Reserves',trigger:'passive',maxEnergyFlat:5,description:'More Energy.'};
  assert.equal(combatStatsFor(state).maxEnergy,10);
});

test('late-game player stats and enemy progression reach large numbers without overflow',()=>{
  const state=createCombatState();state.level=60;state.depth=COMBAT_MAX_DEPTH;
  const stats=combatStatsFor(state);
  const shallowStats=combatStatsFor({...state,depth:1});
  const enemy=getEnemyForDungeonDepth('undercrypt',COMBAT_MAX_DEPTH);
  assert.equal(stats.speed,shallowStats.speed,'player Speed must not multiply with dungeon depth');
  assert.ok(Number.isFinite(stats.speed)&&stats.speed>=150&&stats.speed<1_000_000);
  assert.ok(stats.maxHealth>=1_000_000);
  assert.ok(stats.damage*10>=1_000_000);
  assert.ok(enemy.maxHp>1_000_000&&enemy.maxHp<1e15);
  assert.ok(Number.isFinite(enemy.damage)&&Number.isFinite(enemy.speed));
  assert.ok(enemy.damage>100_000);
});

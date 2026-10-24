import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_MAX_DEPTH, combatGearQualityFromRoll, combatGearRarityForQuality, combatGearRarityOdds,
  combatActionsDue, combatTurnsCrossedThree, combatGearStatBudgetMultiplier, combatNextBeatDelayMs, combatRuneMajorAbilityChance,
  combatRuneMajorAbilityMultiplier, combatRuneMajorAbilityEffects, combatRuneMajorAbilitySummary, combatScrapValue, combatStatsFor, createCombatState,
  getEnemyForDungeonDepth, type CombatRune,
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

test('Scrap is easier to obtain and scales further with depth and power',()=>{
  const starter={power:10,quality:10,sourceFloor:0};
  const previousFormula=Math.round(4+starter.power*.6+starter.quality*.1);
  assert.ok(combatScrapValue(starter)>=previousFormula*3);
  assert.ok(combatScrapValue({power:100,quality:40,sourceFloor:100})>combatScrapValue(starter));
});

test('Rune Major Ability chance and strength rise with rarity',()=>{
  assert.ok(combatRuneMajorAbilityChance('Cosmic')>combatRuneMajorAbilityChance('Common'));
  assert.ok(combatRuneMajorAbilityMultiplier('Cosmic')>combatRuneMajorAbilityMultiplier('Mythic'));
  assert.ok(combatRuneMajorAbilityMultiplier('Mythic')>combatRuneMajorAbilityMultiplier('Common'));
});

test('new Rune Major Abilities add fractional Shard rewards and rarity-floored discovery rolls',()=>{
  const shardTithe:CombatRune={id:'tithe',name:'Shard Tithe',rarity:'Cosmic',stat:'shardChancePct',value:.035,level:1,sourceDepth:10,sourceDungeon:'undercrypt',majorAbility:{id:'shard-tithe',name:'Shard Tithe',valuePct:20,description:'fractional Shards'}};
  const discovery:CombatRune={...shardTithe,id:'discovery',majorAbility:{id:'discovery-oracle',name:'Discovery Oracle',valuePct:20,description:'discovery rolls'}};
  const refinery:CombatRune={...shardTithe,id:'refinery',majorAbility:{id:'dry-streak-refinery',name:'Dry-Streak Refinery',valuePct:20,description:'dry-streak Shards'}};
  const effects=combatRuneMajorAbilityEffects([shardTithe,discovery,refinery],[shardTithe.id,discovery.id,refinery.id]);
  assert.equal(effects.shardTithePerRoll,0.001);
  assert.equal(effects.discoveryOraclePct,20);
  assert.ok(effects.discoveryOracleBonusRolls>=1);
  assert.equal(effects.dryStreakRefineryRate,0.0001);
  assert.match(combatRuneMajorAbilitySummary(shardTithe.majorAbility!,1),/fractional Shards/);
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
test('combat speed is reflected in action cadence and fast enemies can exceed three actions',()=>{
  assert.equal(combatActionsDue(100,1,0),1);
  assert.equal(combatActionsDue(350,1,0),3);
  assert.equal(combatActionsDue(700,1,0),7);
  assert.equal(combatActionsDue(20_000,1,0),100);
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
  const weapon=state.inventory.find(item=>item.slot==='weapon')!;
  weapon.quality=100;
  weapon.majorAbility={id:'expanded-reserves',name:'Expanded Reserves',trigger:'passive',maxEnergyFlat:5,description:'More Energy.'};
  assert.equal(combatStatsFor(state).maxEnergy,10);
});

test('late-game player stats and enemy progression reach large numbers without overflow',()=>{
  const state=createCombatState();state.level=60;state.depth=COMBAT_MAX_DEPTH;
  const stats=combatStatsFor(state);
  const enemy=getEnemyForDungeonDepth('undercrypt',COMBAT_MAX_DEPTH);
  assert.ok(stats.speed>=1_000_000);
  assert.ok(stats.maxHealth>=1_000_000);
  assert.ok(stats.damage*10>=1_000_000);
  assert.ok(enemy.maxHp>1_000_000&&enemy.maxHp<1e15);
  assert.ok(Number.isFinite(enemy.damage)&&Number.isFinite(enemy.speed));
  assert.ok(enemy.damage>100_000);
});

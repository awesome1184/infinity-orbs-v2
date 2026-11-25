import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_ABILITY_SLOTS, COMBAT_INVENTORY_CAP, COMBAT_SKILLS, COMBAT_UPGRADES, addCombatGearToInventory,
  combatForgeCost, combatScrapValue, combatSkillCopiesForNextRank, combatStatsFor, combatUpgradeCost,
  createCombatState, DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS, floorQualityRequirement, gearQualityEffectiveness,
  normalizeCombatAutoScrapSettings, resetCombatRunCarry, resolveCombatSkillRarity,
  skillGachaRankRequirement, skillRarityUnlocked, type CombatGear,
} from '../src/shared/combat.js';

function gear(id: string, sourceFloor: number, slot: 'weapon' | 'armor' = 'weapon', quality = 60): CombatGear {
  return { id, name:id, slot, quality, sourceFloor, power:(sourceFloor+1)*2, effect:'test gear',
    trait:slot==='weapon'?'keen':'bulwark', damageBonus:slot==='weapon'?20:0, speedBonus:0,
    maxHealthBonus:slot==='armor'?50:0 };
}
test('quality requirements are 0% at floor 0 and 60% at floor 50',()=>{
  assert.equal(floorQualityRequirement(0),0); assert.equal(floorQualityRequirement(25),30);
  assert.equal(floorQualityRequirement(50),60); assert.equal(floorQualityRequirement(100),100);
});
test('gear effectiveness follows the current floor target',()=>{
  assert.equal(gearQualityEffectiveness(gear('low',50,'weapon',30),50),.5);
  assert.equal(gearQualityEffectiveness(gear('expected',50,'weapon',60),50),1);
  assert.equal(gearQualityEffectiveness(gear('excellent',50,'weapon',80),50),1.25);
  assert.equal(gearQualityEffectiveness(gear('starter',0,'weapon',0),0),1);
});
test('gear inventory and equipped loadout persist when a new run starts',()=>{
  const state=createCombatState();
  const oldWeapon=gear('pre-existing-weapon',0,'weapon',60);
  state.inventory.push(oldWeapon);
  state.equipment.weapon=oldWeapon.id;
  const firstRunWeapon=oldWeapon.id;
  addCombatGearToInventory(state,gear('run-one-only',20,'weapon',75));
  state.equipment.weapon='run-one-only';

  // Run transitions reset the descent, not the player's owned gear or loadout.
  state.runId+=1;
  state.depth=1;
  assert.ok(state.inventory.some(item=>item.id==='run-one-only'));
  assert.equal(state.equipment.weapon,'run-one-only');
  assert.ok(state.inventory.some(item=>item.id===firstRunWeapon));
});

test('30-item carrying cap applies to each run while old inventory persists',()=>{
  const state=createCombatState();
  const oldInventoryGear=gear('pre-existing-stash-weapon',0,'weapon',60);
  state.inventory.push(oldInventoryGear);
  const starterIds=state.inventory.map(item=>item.id);
  for(let i=0;i<COMBAT_INVENTORY_CAP;i++)addCombatGearToInventory(state,gear('run-'+i,i+1,i===1?'armor':'weapon',80));
  assert.equal(state.runInventoryIds.length,COMBAT_INVENTORY_CAP);
  assert.equal(state.inventory.length,COMBAT_INVENTORY_CAP+starterIds.length);
  // The first earned weapon is auto-equipped; switch away from it so the cap test can prune it.
  state.equipment.weapon='pre-existing-stash-weapon';
  addCombatGearToInventory(state,gear('run-new-best',50,'weapon',95));
  assert.equal(state.runInventoryIds.length,COMBAT_INVENTORY_CAP);
  assert.ok(!state.inventory.some(item=>item.id==='run-0'));
  assert.ok(state.inventory.some(item=>item.id==='run-new-best'));
  for(const id of starterIds)assert.ok(state.inventory.some(item=>item.id===id));

  state.equipment.weapon='run-new-best';
  state.runId+=1;
  resetCombatRunCarry(state);
  assert.equal(state.runInventoryIds.length,0);
  assert.ok(state.inventory.some(item=>item.id==='run-new-best'));
  assert.equal(state.equipment.weapon,'run-new-best');
  addCombatGearToInventory(state,gear('next-run-pickup',51,'armor',90));
  assert.equal(state.runInventoryIds.length,1);
  assert.ok(state.inventory.some(item=>item.id==='run-new-best'));
});
test('Auto Scrap settings are configurable and safely bounded',()=>{
  assert.deepEqual(normalizeCombatAutoScrapSettings(undefined),DEFAULT_COMBAT_AUTO_SCRAP_SETTINGS);
  assert.deepEqual(normalizeCombatAutoScrapSettings({enabled:true,maxQuality:37.44}),{enabled:true,maxQuality:37.44});
  assert.deepEqual(normalizeCombatAutoScrapSettings({enabled:true,maxQuality:999}),{enabled:true,maxQuality:100});
  assert.deepEqual(normalizeCombatAutoScrapSettings({enabled:'yes',maxQuality:-20}),{enabled:false,maxQuality:0});
});

test('combat upgrade ranks have higher entry costs and increase further by rank',()=>{
  assert.deepEqual(COMBAT_UPGRADES.map(upgrade=>upgrade.baseCost),[23,23,32,35,40,60,52,80]);
  const state=createCombatState(),upgrade=COMBAT_UPGRADES[0]!;
  const first=combatUpgradeCost(state,upgrade.id);
  assert.equal(first,23);
  state.combatUpgrades[upgrade.id]=1;
  assert.ok(combatUpgradeCost(state,upgrade.id)>first);
});
test('rolled orb raises combat stats and Gacha has independent rank-weighted draws without pity',()=>{
  const state=createCombatState(),baseline=combatStatsFor(state);
  state.orbFocusRarity=1_000_000;state.orbFocusName='Astral Orb';
  const attuned=combatStatsFor(state);
  assert.ok(attuned.damage>baseline.damage);assert.ok(attuned.maxHealth>baseline.maxHealth);
  for(const rank of [1,10,20,30]){
    assert.equal(resolveCombatSkillRarity(.1,rank,0,0),resolveCombatSkillRarity(.1,rank,9,39));
  }
  assert.equal(COMBAT_SKILLS.length,35);
  assert.equal(skillRarityUnlocked('Mythic',4),false);
  assert.equal(skillRarityUnlocked('Mythic',5),false);
  assert.equal(skillRarityUnlocked('Mythic',9),true);
  assert.equal(skillGachaRankRequirement(1)?.requiredPulls,3);
  assert.equal(skillGachaRankRequirement(30),null);
  assert.equal(combatSkillCopiesForNextRank(20)>combatSkillCopiesForNextRank(10),true);
  assert.ok(combatScrapValue(gear('high-floor',50,'weapon',80))>combatScrapValue(gear('low-floor',0,'weapon',20)));
  assert.ok(combatForgeCost(50)>combatForgeCost(0));
  assert.equal(COMBAT_ABILITY_SLOTS,3);
});

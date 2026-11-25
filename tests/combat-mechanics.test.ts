import test from 'node:test';
import assert from 'node:assert/strict';
import { combatMarkMultiplier, addCombatGearToInventory, applyCombatSkillCopy, calculateCombatArenaRatingUpdate, chooseAutoCombatIntent, COMBAT_ABILITY_SLOTS, COMBAT_INVENTORY_CAP, COMBAT_MAX_DEPTH, COMBAT_SKILLS, combatAbilityType, combatActionsDue, combatBountyReward, combatEffectiveFlurryBonusAttacks, combatEnergyAfterRegen, combatFlurryAttackMultiplier, combatForgeCost, combatGearSpeedBonus, combatGearOtherStatMultiplier, combatGearSpeedShare, combatScrapValue, floorQualityRequirement, combatSkillCopiesForNextRank, combatSkillRankEffectiveness, combatSkillRarityOdds, combatStatsFor, coreProgressionCombatBonus, createCombatState, getEnemyForDepth, getEnemyForDungeonDepth, resolveCombatSkillRarity, skillGachaRankRequirement, skillPullCost, skillRarityUnlocked, STRATEGY_GUIDE_RANKS, tacticianManualDropChance, createCombatSkillRuntime, combatBossLuckBonus, combatBossesBeatenByDepth, combatTotalBossesBeaten, type CombatGear } from '../src/shared/combat.js';

test('new Delvers start without gear and rely on modest baseline stats', () => {
  const state=createCombatState();
  const stats=combatStatsFor(state);
  assert.equal(stats.damage,30);
  assert.equal(stats.speed,150);
  assert.equal(stats.maxHealth,500);
  assert.equal(state.inventory.length,0);
  assert.deepEqual(state.equipment,{weapon:null,armor:null,helmet:null,gloves:null,boots:null,ring:null,amulet:null});
  assert.equal(state.arenaRating,1000);
  assert.equal(state.arenaWins,0);
  assert.equal(state.arenaLosses,0);
  assert.deepEqual(state.dungeonBestDepths, { undercrypt: 1, 'cinder-vault': 1, 'glass-labyrinth': 1 });
});
test('every combat rarity has seven active abilities', () => {
  for(const rarity of ['Common','Uncommon','Rare','Epic','Mythic']) assert.equal(COMBAT_SKILLS.filter(skill=>skill.rarity===rarity).length,7);
  assert.equal(COMBAT_SKILLS.length,35);
  assert.equal(COMBAT_ABILITY_SLOTS,3);
});
test('skill catalog descriptions are distinct and Manual drops get rarer with Strategy Guide ranks',()=>{
  assert.equal(COMBAT_SKILLS.length,35);
  assert.equal(new Set(COMBAT_SKILLS.map(skill=>skill.id)).size,35);
  assert.equal(new Set(COMBAT_SKILLS.map(skill=>skill.effect)).size,35,'every skill communicates a distinct mechanic');
  assert.deepEqual([0,1,2,3,4,5].map(tacticianManualDropChance),[.025,.02,.015,.01,.0075,.005]);
  assert.ok([0,1,2,3,4].every(rank=>tacticianManualDropChance(rank)>tacticianManualDropChance(rank+1)), 'drop chance decreases every rank');
  assert.deepEqual(STRATEGY_GUIDE_RANKS.map(rank=>rank.rank),[1,2,3,4,5]);
  assert.deepEqual(STRATEGY_GUIDE_RANKS.map(rank=>rank.manualCost),[1,0,0,1,1]);
  assert.equal(createCombatSkillRuntime().shield,0);
});
test('equipped gear changes derived stats', () => {
  const state=createCombatState();
  const weapon:CombatGear={id:'test-stat-weapon',name:'Test Stat Weapon',slot:'weapon',quality:100,sourceFloor:0,power:1,effect:'test gear',trait:'keen',damageBonus:0,speedBonus:0,maxHealthBonus:0,armorBonus:0,critChanceBonus:0};
  state.inventory.push(weapon);
  state.equipment.weapon=weapon.id;
  const before=combatStatsFor(state);
  weapon.damageBonus+=10; weapon.speedBonus+=25;
  const after=combatStatsFor(state);
  assert.equal(after.damage,before.damage+10);
  assert.equal(after.speed,before.speed+25, 'ordinary gear Speed affixes increase player action frequency');
});
test('every tenth Undercrypt depth has a boss', () => {
  assert.equal(getEnemyForDepth(9).boss,false);
  assert.equal(getEnemyForDepth(10).boss,true);
  assert.equal(getEnemyForDepth(20).name,'Crypt Warden');
});
test('enemy speed scales continuously with depth and increases actions owed',()=>{
  const opening=getEnemyForDepth(1);
  const deeperSameEnemy=getEnemyForDepth(28);
  assert.equal(opening.id,deeperSameEnemy.id,'comparison uses the same enemy archetype');
  assert.ok(deeperSameEnemy.speed>opening.speed*1.25,'enemy Speed should rise visibly before the 15-floor mark');
  assert.ok(combatActionsDue(deeperSameEnemy.speed,10,0)>combatActionsDue(opening.speed,10,0),'scaled Speed must translate into more actions');
});
test('skill pull prices rise with Gacha rank and lifetime pulls', () => {
  assert.equal(skillPullCost(0,1),75);
  assert.ok(skillPullCost(0,2)>skillPullCost(0,1));
  assert.ok(skillPullCost(0,30)>skillPullCost(0,20));
  assert.ok(skillPullCost(10_000,2)>skillPullCost(0,2));
  assert.ok(Number.isSafeInteger(skillPullCost(Number.MAX_SAFE_INTEGER,30)));
});

test('quality curve stays anchored to run best after current depth resets',()=>{
  const state=createCombatState();
  state.depth=1;
  state.bestDepth=51;
  assert.equal(floorQualityRequirement(state.bestDepth-1),60);
  assert.equal(floorQualityRequirement(state.depth-1),0);
});

test('ability energy availability respects the post-regeneration maximum',()=>{
  assert.equal(combatEnergyAfterRegen(1,2),2);
  assert.equal(combatEnergyAfterRegen(2,2),2);
  assert.equal(combatEnergyAfterRegen(1,5),2);
  assert.equal(combatEnergyAfterRegen(8,5),5);
});

test('flurry and bounty outputs scale with ability value and rank',()=>{
  assert.equal(combatFlurryAttackMultiplier(8),1.08);
  assert.equal(combatFlurryAttackMultiplier(45),1.45);
  assert.equal(combatFlurryAttackMultiplier(-5),1);
  assert.equal(combatFlurryAttackMultiplier(500),2);
  assert.equal(combatEffectiveFlurryBonusAttacks(11,8),4,'eight base hits leave room for four bonus strikes');
  assert.equal(combatEffectiveFlurryBonusAttacks(2,3),2);
  assert.equal(combatEffectiveFlurryBonusAttacks(11,12),0,'a full 12-hit turn has no spare attack slots');
  const modest=combatBountyReward(.05,1),mythic=combatBountyReward(.25,1),ranked=combatBountyReward(.25,8);
  assert.ok(mythic>modest);
  assert.ok(ranked>mythic);
  assert.equal(mythic,Math.round((3+Math.log2(2)*2)*(1+.25*3))*11);
  assert.equal(COMBAT_MAX_DEPTH,50_000);
});

test('duplicate copies advance uncapped skill ranks with an increasing copy requirement', () => {
  const state = createCombatState();
  const baseStats = combatStatsFor(state);
  const first = applyCombatSkillCopy(state, 'surefoot', 75);
  assert.equal(first.rank, 1);
  assert.equal(first.rankedUp, true);
  assert.equal(first.progress, 0);
  assert.equal(state.skillLevels.surefoot, 1);
  const neededForRankTwo = combatSkillCopiesForNextRank(1);
  assert.equal(neededForRankTwo, 3);
  for(let copy=0;copy<neededForRankTwo-1;copy++){
    const result=applyCombatSkillCopy(state,'surefoot',75);
    assert.equal(result.rank,1);
    assert.equal(result.rankedUp,false);
  }
  const rankTwo=applyCombatSkillCopy(state,'surefoot',75);
  assert.equal(rankTwo.rank,2);
  assert.equal(rankTwo.rankedUp,true);
  assert.equal(combatSkillCopiesForNextRank(2),4);
  assert.ok(combatSkillCopiesForNextRank(20)>combatSkillCopiesForNextRank(10));
  assert.ok(combatSkillRankEffectiveness(20)>combatSkillRankEffectiveness(2));
  assert.deepEqual(combatStatsFor(state),baseStats,'owned but unequipped abilities must not passively stack stats');
});

test('skill copies are active ability types rather than passive stat modifiers',()=>{
  const definition=COMBAT_SKILLS.find(skill=>skill.id==='ember-lung')!;
  const healing=COMBAT_SKILLS.find(skill=>skill.id==='ironbark')!;
  const bounty=COMBAT_SKILLS.find(skill=>skill.id==='penny-hunter')!;
  assert.equal(combatAbilityType(definition),'strike');
  assert.equal(combatAbilityType(healing),'mend');
  assert.equal(combatAbilityType(bounty),'bounty');
});

test('ranked Gacha raises higher-rarity odds without pity overrides',()=>{
  assert.equal(skillRarityUnlocked('Common',1),true);
  assert.equal(skillRarityUnlocked('Uncommon',1),false);
  assert.equal(skillRarityUnlocked('Uncommon',2),true);
  assert.equal(skillRarityUnlocked('Rare',2),false);
  assert.equal(skillRarityUnlocked('Rare',3),true);
  assert.equal(skillRarityUnlocked('Epic',5),false);
  assert.equal(skillRarityUnlocked('Epic',6),true);
  assert.equal(skillRarityUnlocked('Mythic',1),false);
  assert.equal(skillRarityUnlocked('Mythic',8),false);
  assert.equal(skillRarityUnlocked('Mythic',9),true);
  const rankOne=combatSkillRarityOdds(1);
  const rankTen=combatSkillRarityOdds(10);
  const rankThirty=combatSkillRarityOdds(30);
  assert.equal(rankOne.Common,1);
  assert.equal(rankOne.Mythic,0);
  assert.ok(rankThirty.Mythic>rankTen.Mythic);
  assert.ok(rankTen.Mythic>rankOne.Mythic);
  assert.ok(rankThirty.Epic>rankTen.Epic);
  for (const rank of [1,10,20,30]) {
    for (const roll of [0,.1,.5,.9,.999]) {
      assert.equal(resolveCombatSkillRarity(roll,rank,0,0),resolveCombatSkillRarity(roll,rank,39,9));
    }
  }
  assert.deepEqual(skillGachaRankRequirement(1),{rank:2,requiredPulls:3,requiredMarks:25,unlocks:'Improved higher-rarity odds'});
  assert.ok(skillGachaRankRequirement(5));
  assert.equal(skillGachaRankRequirement(30),null);
});

test('Scrap rewards and Forge costs scale with gear/floor progression',()=>{
  const low={power:5,quality:20,sourceFloor:0};
  const high={power:500,quality:90,sourceFloor:100};
  assert.equal(combatScrapValue(low),10,'Scrap payouts use one quarter of the original curve');
  assert.ok(combatScrapValue(high)>combatScrapValue(low));
  assert.equal(combatForgeCost(0),10);
  assert.ok(combatForgeCost(50)>combatForgeCost(0));
});

test('run-haul overflow never evicts equipped gear acquired during the current run',()=>{
  const state=createCombatState();
  const item:CombatGear={id:'run-equipped-weapon',name:'Run-Worn Blade',slot:'weapon',quality:1,sourceFloor:0,power:1,effect:'test',trait:'keen',damageBonus:1,speedBonus:0,maxHealthBonus:0};
  addCombatGearToInventory(state,item);
  state.equipment.weapon=item.id;
  for(let index=1;index<COMBAT_INVENTORY_CAP;index++)addCombatGearToInventory(state,{...item,id:'run-gear-'+index,name:'Run gear '+index,sourceFloor:index,quality:80});
  addCombatGearToInventory(state,{...item,id:'new-run-best',name:'New run best',sourceFloor:100,quality:99});
  assert.equal(state.runInventoryIds.length,COMBAT_INVENTORY_CAP);
  assert.ok(state.inventory.some(gear=>gear.id===item.id));
  assert.equal(state.equipment.weapon,item.id);
});

test('the newest run pickup survives overflow even when its quality is lower than the old haul',()=>{
  const state=createCombatState();
  for(let index=0;index<COMBAT_INVENTORY_CAP;index++)addCombatGearToInventory(state,{id:'old-quality-'+index,name:'Old quality '+index,slot:index%2===0?'weapon':'armor',quality:90,sourceFloor:index+1,power:10,effect:'test',trait:index%2===0?'keen':'bulwark',damageBonus:0,speedBonus:0,maxHealthBonus:0});
  // Ensure the test's oldest item is not protected as equipped gear; the first natural drop auto-equips.
  state.equipment.weapon=null;
  state.equipment.armor=null;
  const newest:CombatGear={id:'fresh-low-quality',name:'Fresh low quality',slot:'weapon',quality:0,sourceFloor:0,power:1,effect:'test',trait:'keen',damageBonus:0,speedBonus:0,maxHealthBonus:0};
  addCombatGearToInventory(state,newest);
  assert.equal(state.runInventoryIds.length,COMBAT_INVENTORY_CAP);
  assert.ok(state.inventory.some(item=>item.id===newest.id));
  assert.ok(!state.inventory.some(item=>item.id==='old-quality-0'));
});

test('duplicate loot grants are idempotent and do not consume haul slots',()=>{
  const state=createCombatState();
  const original:CombatGear={id:'duplicate-loot-test',name:'Original test gear',slot:'weapon',quality:10,sourceFloor:0,power:10,effect:'Test item',trait:'keen',damageBonus:0,speedBonus:0,maxHealthBonus:0,armorBonus:0,critChanceBonus:0};
  state.inventory.push(original);
  const inventoryLength=state.inventory.length;
  addCombatGearToInventory(state,{...original,name:'duplicate copy'});
  assert.equal(state.inventory.length,inventoryLength);
  assert.equal(state.inventory[0]?.name,original.name);
  assert.equal(state.runInventoryIds.length,0);
});

test('run haul pruning preserves owned equipment and newest loot', () => {
  const state = createCombatState();
  const ownedWeapon:CombatGear={id:'owned-weapon',name:'Owned Weapon',slot:'weapon',quality:50,sourceFloor:0,power:10,effect:'Owned gear',trait:'keen',damageBonus:1,speedBonus:0,maxHealthBonus:0,armorBonus:0,critChanceBonus:0};
  const ownedArmor:CombatGear={id:'owned-armor',name:'Owned Armor',slot:'armor',quality:50,sourceFloor:0,power:10,effect:'Owned gear',trait:'bulwark',damageBonus:0,speedBonus:0,maxHealthBonus:10,armorBonus:0,critChanceBonus:0};
  state.inventory.push(ownedWeapon,ownedArmor);
  state.equipment.weapon=ownedWeapon.id;
  state.equipment.armor=ownedArmor.id;
  const equippedWeaponId = ownedWeapon.id;
  const equippedArmorId = ownedArmor.id;
  for (let index = 0; index < 30; index += 1) {
    addCombatGearToInventory(state, {
      id: 'old-loot-' + index,
      name: 'Old loot ' + index,
      slot: index % 2 === 0 ? 'weapon' : 'armor',
      quality: 10,
      sourceFloor: 0,
      power: 10,
      effect: 'Test item',
      trait: index % 2 === 0 ? 'keen' : 'bulwark',
      damageBonus: index % 2 === 0 ? 8 : 0,
      speedBonus: index % 2 === 0 ? 3 : 0,
      maxHealthBonus: index % 2 === 0 ? 0 : 20,
    });
  }
  const newest = {
    id: 'newest-loot',
    name: 'Newest loot',
    slot: 'weapon' as const,
    quality: 99.5,
    sourceFloor: 0,
    power: 50,
    effect: 'Test item',
    trait: 'first-strike' as const,
    damageBonus: 40,
    speedBonus: 12,
    maxHealthBonus: 0,
  };

  addCombatGearToInventory(state, newest);

  assert.equal(state.runInventoryIds.length, 30, 'only the current run haul is capped');
  assert.equal(state.inventory.length, 32, 'the permanent stash also keeps the two pre-existing items');
  assert.equal(state.inventory[0]?.id, newest.id);
  assert.ok(state.inventory.some(item => item.id === equippedWeaponId), 'equipped weapon must remain in inventory');
  assert.ok(state.inventory.some(item => item.id === equippedArmorId), 'equipped armor must remain in inventory');
  assert.ok(!state.inventory.some(item => item.id === 'old-loot-0'), 'oldest current-run pickup should be pruned first');
});


test('boss clears across all three dungeons grant additive Luck with 1.01^n self-stacking', () => {
  assert.equal(combatBossesBeatenByDepth(1), 0);
  assert.equal(combatBossesBeatenByDepth(10), 0, 'entering a boss depth does not count as a clear');
  assert.equal(combatBossesBeatenByDepth(11), 1);
  assert.equal(combatBossesBeatenByDepth(101), 10);
  assert.equal(combatBossesBeatenByDepth(COMBAT_MAX_DEPTH), Math.floor(COMBAT_MAX_DEPTH / 10) - 1);
  assert.equal(combatBossesBeatenByDepth(COMBAT_MAX_DEPTH, true), Math.floor(COMBAT_MAX_DEPTH / 10));

  assert.equal(combatBossLuckBonus(0), 0);
  assert.ok(Math.abs(combatBossLuckBonus(1) - 0.01) < 1e-12);
  assert.ok(Math.abs(combatBossLuckBonus(2) - 0.0201) < 1e-12);
  assert.ok(Math.abs((2 + combatBossLuckBonus(2)) - 2.0201) < 1e-12,
    'the boss bonus adds to other Luck sources rather than multiplying them');

  assert.equal(combatTotalBossesBeaten({
    dungeonId: 'undercrypt',
    bestDepth: 1,
    dungeonBestDepths: { undercrypt: 21, 'cinder-vault': 31, 'glass-labyrinth': 51 },
    dungeonBossesBeaten: { undercrypt: 1, 'cinder-vault': 1, 'glass-labyrinth': 1 },
  }), 10, 'the maximum cleared depth in each dungeon backfills old saves');

  assert.equal(combatTotalBossesBeaten({ version: 1, depth: 1, bestDepth: 251 }), 25,
    'legacy saves keep their Undercrypt progress');

  assert.equal(combatTotalBossesBeaten({
    dungeonId: 'cinder-vault',
    depthCapCleared: false,
    dungeonBestDepths: { undercrypt: COMBAT_MAX_DEPTH, 'cinder-vault': 31, 'glass-labyrinth': 21 },
    dungeonBossesBeaten: { undercrypt: 5000, 'cinder-vault': 1, 'glass-labyrinth': 1 },
  }), 5005, 'a completed final boss in a previously cleared dungeon stays counted after switching');
});


test('Arena rating uses bounded Elo-style updates', () => {
  const win = calculateCombatArenaRatingUpdate(1000, 1000, true);
  assert.deepEqual(win, { playerRating: 1012, opponentRating: 988, playerChange: 12, opponentChange: -12 });
  const loss = calculateCombatArenaRatingUpdate(1000, 1000, false);
  assert.deepEqual(loss, { playerRating: 988, opponentRating: 1012, playerChange: -12, opponentChange: 12 });
  const bounded = calculateCombatArenaRatingUpdate(10000, 100, true);
  assert.equal(bounded.playerRating, 10000);
  assert.equal(bounded.opponentRating, 100);
});


test('core-game level and highest-orb rarity improve combat without changing baseline builds', () => {
  const state = createCombatState();
  const baseline = combatStatsFor(state);
  assert.equal(coreProgressionCombatBonus(1, 2), 0);
  assert.equal(baseline.coreProgressionBonus, 0);

  state.coreLevel = 51;
  state.coreHighestRarity = 1_000_000;
  const progressed = combatStatsFor(state);
  assert.equal(coreProgressionCombatBonus(51, 1_000_000), 0.118);
  assert.ok(progressed.damage > baseline.damage);
  assert.ok(progressed.maxHealth > baseline.maxHealth);
  assert.equal(coreProgressionCombatBonus(1_000_000, 1_000_000_000_000_000_000), 0.25);
});


test('auto combat tactics choose safe, valid intents from health and energy', () => {
  const state = createCombatState();
  state.energy = 4;
  state.health = state.maxHealth * 0.30;
  state.autoTactic = 'balanced';
  assert.equal(chooseAutoCombatIntent(state), 'mend');

  state.energy = 2;
  state.health = state.maxHealth * 0.15;
  assert.equal(chooseAutoCombatIntent(state), 'guard');

  state.autoTactic = 'aggressive';
  state.health = state.maxHealth;
  state.energy = 3;
  assert.equal(chooseAutoCombatIntent(state), 'heavy');
  state.energy = 2;
  assert.equal(chooseAutoCombatIntent(state), 'strike');

  state.autoTactic = 'defensive';
  state.health = state.maxHealth * 0.60;
  state.energy = 4;
  assert.equal(chooseAutoCombatIntent(state), 'mend');
  state.energy = 2;
  state.health = state.maxHealth * 0.40;
  assert.equal(chooseAutoCombatIntent(state), 'guard');

  state.autoTactic = 'recovery';
  state.health = state.maxHealth * 0.80;
  state.energy = 4;
  assert.equal(chooseAutoCombatIntent(state), 'mend');
});


test('dungeon choices have separate enemy modifiers and distinct combat builds', () => {
  const undercrypt = getEnemyForDungeonDepth('undercrypt', 10);
  const cinder = getEnemyForDungeonDepth('cinder-vault', 10);
  const glass = getEnemyForDungeonDepth('glass-labyrinth', 10);
  assert.equal(cinder.name, 'Cinder Sovereign');
  assert.equal(glass.name, 'Prism Regent');
  assert.ok(cinder.maxHp > undercrypt.maxHp);
  assert.ok(cinder.damage > undercrypt.damage);
  assert.ok(glass.maxHp < undercrypt.maxHp);
  assert.ok(glass.speed > undercrypt.speed);

  const baseline = createCombatState();
  const cinderBuild = { ...baseline, dungeonId: 'cinder-vault' as const };
  const glassBuild = { ...baseline, dungeonId: 'glass-labyrinth' as const };
  assert.ok(combatStatsFor(cinderBuild).damage > combatStatsFor(baseline).damage);
  assert.ok(combatStatsFor(glassBuild).speed > combatStatsFor(baseline).speed);
  assert.ok(combatStatsFor(glassBuild).critChance > combatStatsFor(baseline).critChance);
});


test('Mark Magnet adds Combat Marks to the upgrade economy', () => {
  const state = createCombatState();
  const base = combatMarkMultiplier(state);
  state.combatUpgrades['mark-magnet'] = 3;
  assert.equal(combatMarkMultiplier(state), base + 0.30);
});

test('Warding Doctrine adds permanent damage reduction', () => {
  const state = createCombatState();
  const base = combatStatsFor(state).damageReduction;
  state.combatUpgrades['ward-training'] = 4;
  assert.ok(combatStatsFor(state).damageReduction >= base + 0.06 - 1e-9);
});

test('Starfall and Mark Harvest Major Abilities apply equipped bonuses', () => {
  const state = createCombatState();
  const weapon:CombatGear={id:'major-ability-test-weapon',name:'Major Ability Test Weapon',slot:'weapon',quality:100,sourceFloor:0,power:10,effect:'Test gear',trait:'keen',damageBonus:0,speedBonus:0,maxHealthBonus:0,armorBonus:0,critChanceBonus:0};
  state.inventory.push(weapon);
  state.equipment.weapon=weapon.id;
  const baseCrit = combatStatsFor(state).critChance;
  weapon.majorAbility = { id:'starfall', name:'Starfall', trigger:'passive', critChanceBonus:.08, description:'Adds critical-hit chance while equipped.' };
  assert.ok(combatStatsFor(state).critChance >= baseCrit + .08 - 1e-9);
  const baseMarks = combatMarkMultiplier(state);
  weapon.majorAbility = { id:'mark-harvest', name:'Mark Harvest', trigger:'passive', markBonusPercent:.25, description:'Increases Combat Marks earned from kills while equipped.' };
  assert.ok(combatMarkMultiplier(state) >= baseMarks + .25 - 1e-9);
});


test('every gear slot can roll Speed, with higher Speed trading away other stats', () => {
  const slots = ['weapon','armor','helmet','gloves','boots','ring','amulet'] as const;
  for (const slot of slots) {
    assert.ok(combatGearSpeedBonus(slot, 100, 0) > 0, slot + ' must grant Speed on a low-Speed roll');
    assert.ok(combatGearSpeedBonus(slot, 100, 0.99) > combatGearSpeedBonus(slot, 100, 0), slot + ' must support a high-Speed build');
  }
  assert.equal(combatGearSpeedBonus('weapon', 100, 0), 8);
  assert.equal(combatGearSpeedBonus('armor', 100, 0.99), 40);
  assert.equal(combatGearSpeedShare(0), 0.08);
  assert.ok(combatGearSpeedShare(0.99) > combatGearSpeedShare(0));
  assert.equal(combatGearOtherStatMultiplier(0), 1);
  assert.ok(combatGearOtherStatMultiplier(0.99) < 0.71, 'near-max-Speed gear should give up roughly 30% of other stats');
});

test('endgame enemy Speed keeps scaling in every dungeon without artificial ceilings', () => {
  const cinder = getEnemyForDungeonDepth('cinder-vault', 1700);
  const glass = getEnemyForDungeonDepth('glass-labyrinth', 1700);
  assert.ok(cinder.speed > 500, 'Cinder Vault must not clamp enemies to 500 Speed');
  assert.ok(glass.speed > 600, 'Glass Labyrinth must not clamp enemies to 600 Speed');
  assert.ok(getEnemyForDepth(COMBAT_MAX_DEPTH).speed > getEnemyForDepth(1700).speed, 'base enemy Speed must keep scaling through endgame');
});

test('player Speed has no artificial 10-million ceiling', () => {
  const state = createCombatState();
  const slots = ['weapon','armor','helmet','gloves','boots','ring','amulet'] as const;
  for (const slot of slots) {
    const id = 'uncapped-speed-' + slot;
    state.inventory.push({id,name:'Uncapped Speed Test',slot,quality:100,sourceFloor:0,power:1,effect:'Test',trait:slot==='weapon'?'keen':'bulwark',damageBonus:0,speedBonus:2_000_000,speedInvestmentRoll:0.99,maxHealthBonus:0,armorBonus:0,critChanceBonus:0});
    state.equipment[slot] = id;
  }
  assert.equal(combatStatsFor(state).speed, 14_000_150);
});

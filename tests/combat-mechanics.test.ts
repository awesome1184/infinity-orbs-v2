import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceGuardWindow, addCombatGearToInventory, applyCombatSkillCopy, calculateCombatArenaRatingUpdate, COMBAT_SKILLS, combatStatsFor, createCombatState, getEnemyForDepth, skillPullCost, undercryptOrbLuckMultiplier, undercryptWardensDefeated } from '../src/shared/combat.js';

test('starter combat build carries the Auto-Dungeons baseline', () => {
  const state=createCombatState();
  const stats=combatStatsFor(state);
  assert.equal(stats.damage,54);
  assert.equal(stats.speed,310);
  assert.equal(stats.maxHealth,1040);
  assert.equal(state.inventory.length,2);
  assert.equal(state.arenaRating,1000);
  assert.equal(state.arenaWins,0);
  assert.equal(state.arenaLosses,0);
});
test('every combat rarity has exactly five skills', () => {
  for(const rarity of ['Common','Uncommon','Rare','Epic','Mythic']) assert.equal(COMBAT_SKILLS.filter(skill=>skill.rarity===rarity).length,5);
  assert.equal(COMBAT_SKILLS.length,25);
});
test('equipped gear changes derived stats', () => {
  const state=createCombatState(), before=combatStatsFor(state);
  const weapon=state.inventory.find(item=>item.slot==='weapon');
  assert.ok(weapon);
  weapon.damageBonus+=10; weapon.speedBonus+=25;
  const after=combatStatsFor(state);
  assert.equal(after.damage,before.damage+10);
  assert.equal(after.speed,before.speed+25);
});
test('every tenth Undercrypt depth has a boss', () => {
  assert.equal(getEnemyForDepth(9).boss,false);
  assert.equal(getEnemyForDepth(10).boss,true);
  assert.equal(getEnemyForDepth(20).name,'Crypt Warden');
});
test('skill pull pricing does not decrease with repeated pulls', () => {
  let previous=skillPullCost(0);
  for(let pulls=1;pulls<60;pulls++){const current=skillPullCost(pulls);assert.ok(current>=previous);previous=current;}
});

test('duplicate skill copies increase rank and improve the associated stat', () => {
  const state = createCombatState();
  const speedValues: number[] = [];
  for (let expectedRank = 1; expectedRank <= 5; expectedRank += 1) {
    const result = applyCombatSkillCopy(state, 'surefoot', 75);
    assert.equal(result.rank, expectedRank);
    assert.equal(result.duplicate, expectedRank > 1);
    assert.equal(result.maxRank, expectedRank === 5);
    assert.equal(result.coinsRefunded, 0);
    speedValues.push(combatStatsFor(state).speed);
  }
  assert.deepEqual(speedValues, [318, 326, 334, 342, 350]);
  const capped = applyCombatSkillCopy(state, 'surefoot', 75);
  assert.equal(capped.rank, 5);
  assert.equal(capped.duplicate, true);
  assert.equal(capped.maxRank, true);
  assert.equal(state.skillLevels.surefoot, 5);
  assert.equal(combatStatsFor(state).speed, 350);
});

test('duplicate damage skill copies each increase derived damage', () => {
  const state = createCombatState();
  const damageValues: number[] = [];
  for (let expectedRank = 1; expectedRank <= 5; expectedRank += 1) {
    const result = applyCombatSkillCopy(state, 'ember-lung', 75);
    assert.equal(result.rank, expectedRank);
    damageValues.push(combatStatsFor(state).damage);
  }
  assert.deepEqual(damageValues, [55, 57, 58, 59, 61]);
});

test('extra copies at max rank refund coins without secretly increasing rank', () => {
  const state = createCombatState();
  state.skillLevels['infinite-bounty'] = 5;
  const pullCost = 200;
  state.coins -= pullCost; // The gacha deducts the pull cost before applying the copy.
  const result = applyCombatSkillCopy(state, 'infinite-bounty', pullCost);
  assert.equal(result.rank, 5);
  assert.equal(result.duplicate, true);
  assert.equal(result.maxRank, true);
  assert.equal(result.coinsRefunded, 150);
  assert.equal(state.coins, 200);
  assert.equal(state.skillLevels['infinite-bounty'], 5);
});

test('health, critical chance, and coin skills all scale with duplicate rank', () => {
  const healthState = createCombatState();
  let previousHealth = combatStatsFor(healthState).maxHealth;
  for (let rank = 1; rank <= 5; rank += 1) {
    const result = applyCombatSkillCopy(healthState, 'ironbark', 75);
    const currentHealth = combatStatsFor(healthState).maxHealth;
    assert.equal(result.rank, rank);
    assert.ok(currentHealth > previousHealth, 'health skill rank must raise maximum HP');
    previousHealth = currentHealth;
  }

  const critState = createCombatState();
  let previousCrit = combatStatsFor(critState).critChance;
  for (let rank = 1; rank <= 5; rank += 1) {
    applyCombatSkillCopy(critState, 'lucky-fang', 75);
    const currentCrit = combatStatsFor(critState).critChance;
    assert.ok(currentCrit > previousCrit, 'critical skill rank must raise critical chance');
    previousCrit = currentCrit;
  }

  const coinState = createCombatState();
  let previousCoins = combatStatsFor(coinState).coinMultiplier;
  for (let rank = 1; rank <= 5; rank += 1) {
    applyCombatSkillCopy(coinState, 'penny-hunter', 75);
    const currentCoins = combatStatsFor(coinState).coinMultiplier;
    assert.ok(currentCoins > previousCoins, 'coin skill rank must raise Delver Coin rewards');
    previousCoins = currentCoins;
  }
});


test('inventory pruning preserves equipped gear while keeping newest loot', () => {
  const state = createCombatState();
  const equippedWeaponId = state.equipment.weapon;
  const equippedArmorId = state.equipment.armor;
  for (let index = 0; index < 28; index += 1) {
    state.inventory.push({
      id: 'old-loot-' + index,
      name: 'Old loot ' + index,
      slot: index % 2 === 0 ? 'weapon' : 'armor',
      quality: 10,
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
    power: 50,
    effect: 'Test item',
    trait: 'first-strike' as const,
    damageBonus: 40,
    speedBonus: 12,
    maxHealthBonus: 0,
  };

  addCombatGearToInventory(state, newest);

  assert.equal(state.inventory.length, 30);
  assert.equal(state.inventory[0]?.id, newest.id);
  assert.ok(state.inventory.some(item => item.id === equippedWeaponId), 'equipped weapon must remain in inventory');
  assert.ok(state.inventory.some(item => item.id === equippedArmorId), 'equipped armor must remain in inventory');
  assert.ok(!state.inventory.some(item => item.id === 'old-loot-27'), 'oldest unequipped item should be pruned first');
});


test('Crypt Warden clears grant a permanent effective Luck multiplier with a hard cap', () => {
  assert.equal(undercryptWardensDefeated(1), 0);
  assert.equal(undercryptWardensDefeated(10), 0, 'reaching the boss depth does not count as a clear');
  assert.equal(undercryptWardensDefeated(11), 1, 'clearing the Depth 10 boss unlocks one stack');
  assert.equal(undercryptWardensDefeated(101), 10);
  assert.equal(undercryptWardensDefeated(251), 25);
  assert.equal(undercryptWardensDefeated(50000), 25);
  assert.equal(undercryptOrbLuckMultiplier(1), 1);
  assert.equal(undercryptOrbLuckMultiplier(11), 1.01);
  assert.equal(undercryptOrbLuckMultiplier(251), 1.25);
  assert.equal(undercryptOrbLuckMultiplier(50000), 1.25);
  assert.equal(undercryptOrbLuckMultiplier(Number.NaN), 1);
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


test('Guard remains active until a slow enemy has an action ready', () => {
  // A Guard command can happen on a player beat before a slow enemy's first turn.
  assert.equal(advanceGuardWindow(1, 0, false), 1);
  // The first enemy-action beat consumes the guard window.
  assert.equal(advanceGuardWindow(1, 1, false), 0);
  // Guard covers the incoming attacks scheduled for that enemy-action beat.
  assert.equal(advanceGuardWindow(1, 3, false), 0);
});

test('Guard window is consumed safely and cleared when the encounter ends', () => {
  assert.equal(advanceGuardWindow(0, 0, false), 0);
  assert.equal(advanceGuardWindow(2, 1, false), 1);
  assert.equal(advanceGuardWindow(2, 0, true), 0);
  assert.equal(advanceGuardWindow(1, 1, true), 0);
  assert.equal(advanceGuardWindow(Number.NaN, 1, false), 0);
  assert.equal(advanceGuardWindow(1, Number.NaN, false), 1);
});

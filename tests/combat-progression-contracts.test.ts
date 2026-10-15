import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMBAT_INVENTORY_CAP,
  COMBAT_SKILLS,
  SKILL_RANK_CAP,
  addCombatGearToInventory,
  applyCombatSkillCopy,
  combatStatsFor,
  createCombatState,
  undercryptOrbLuckMultiplier,
  undercryptWardensDefeated,
} from '../src/shared/combat.js';

test('skill gacha defines five distinct skills for each of five rarities', () => {
  assert.equal(COMBAT_SKILLS.length, 25);
  assert.equal(new Set(COMBAT_SKILLS.map(skill => skill.id)).size, 25);
  for (const rarity of ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythic']) {
    assert.equal(COMBAT_SKILLS.filter(skill => skill.rarity === rarity).length, 5, rarity);
  }
});

test('each duplicate raises its skill rank and increases the derived stat until Rank 5', () => {
  const state = createCombatState();
  const damageAfterRank: number[] = [];
  for (let expectedRank = 1; expectedRank <= SKILL_RANK_CAP; expectedRank += 1) {
    const copy = applyCombatSkillCopy(state, 'ember-lung', 100);
    assert.equal(copy.rank, expectedRank);
    assert.equal(copy.duplicate, expectedRank > 1);
    assert.equal(copy.maxRank, expectedRank === SKILL_RANK_CAP);
    damageAfterRank.push(combatStatsFor(state).damage);
  }
  for (let i = 1; i < damageAfterRank.length; i += 1) {
    assert.ok(damageAfterRank[i]! > damageAfterRank[i - 1]!, 'each rank should improve damage');
  }
  assert.equal(state.skillLevels['ember-lung'], SKILL_RANK_CAP);
});

test('a copy at maximum rank cannot raise the skill beyond the cap and refunds coins', () => {
  const state = createCombatState();
  for (let i = 0; i < SKILL_RANK_CAP; i += 1) {
    applyCombatSkillCopy(state, 'ember-lung', 100);
  }
  const beforeCoins = state.coins;
  const result = applyCombatSkillCopy(state, 'ember-lung', 100);
  assert.equal(result.rank, SKILL_RANK_CAP);
  assert.equal(result.duplicate, true);
  assert.equal(result.maxRank, true);
  assert.equal(result.coinsRefunded, 25);
  assert.equal(state.coins, beforeCoins + 25);
});

test('Undercrypt Luck unlocks only after a Warden is defeated and stops at +25%', () => {
  assert.equal(undercryptWardensDefeated(1), 0);
  assert.equal(undercryptWardensDefeated(10), 0);
  assert.equal(undercryptWardensDefeated(11), 1);
  assert.equal(undercryptOrbLuckMultiplier(1), 1);
  assert.equal(undercryptOrbLuckMultiplier(10), 1);
  assert.ok(Math.abs(undercryptOrbLuckMultiplier(11) - 1.01) < 1e-10);
  assert.equal(undercryptWardensDefeated(251), 25);
  assert.equal(undercryptOrbLuckMultiplier(251), 1.25);
  assert.equal(undercryptWardensDefeated(Number.NaN), 0);
});

test('inventory cap never removes the currently equipped weapon or armor', () => {
  const state = createCombatState();
  const weaponId = state.equipment.weapon;
  const armorId = state.equipment.armor;
  for (let i = 0; i < COMBAT_INVENTORY_CAP + 5; i += 1) {
    const weapon = i % 2 === 0;
    addCombatGearToInventory(state, {
      id: 'contract-test-gear-' + i,
      name: 'Contract Gear ' + i,
      slot: weapon ? 'weapon' : 'armor',
      quality: i % 101,
      power: i + 1,
      effect: 'Test item',
      trait: weapon ? 'keen' : 'bulwark',
      damageBonus: weapon ? i + 1 : 0,
      speedBonus: 0,
      maxHealthBonus: weapon ? 0 : (i + 1) * 4,
    });
  }
  assert.equal(state.inventory.length, COMBAT_INVENTORY_CAP);
  assert.ok(state.inventory.some(item => item.id === weaponId));
  assert.ok(state.inventory.some(item => item.id === armorId));
});

test('derived combat stats obey the explicit speed and critical chance caps', () => {
  const state = createCombatState();
  for (const skill of COMBAT_SKILLS) state.skillLevels[skill.id] = SKILL_RANK_CAP;
  const stats = combatStatsFor(state);
  assert.ok(stats.speed <= 800);
  assert.ok(stats.critChance <= 0.75);
  assert.ok(stats.damage >= 1);
  assert.ok(stats.maxHealth >= 1);
});

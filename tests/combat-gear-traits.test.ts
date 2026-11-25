import test from 'node:test';
import assert from 'node:assert/strict';
import { combatStatsFor, createCombatState, type CombatGear } from '../src/shared/combat.js';

function equipTestGear(state: ReturnType<typeof createCombatState>, id: string, slot: 'weapon' | 'armor', trait: CombatGear['trait']): CombatGear {
  const item: CombatGear = {
    id, name:id, slot, quality:100, sourceFloor:0, power:1, effect:'test gear', trait,
    damageBonus:0, speedBonus:0, maxHealthBonus:0, armorBonus:0, critChanceBonus:0,
  };
  state.inventory.push(item);
  state.equipment[slot]=item.id;
  return item;
}

test('keen weapon grants four percentage points of critical chance only while equipped', () => {
  const state = createCombatState();
  const weapon = equipTestGear(state, 'test-keen-weapon', 'weapon', 'keen');

  assert.equal(combatStatsFor(state).critChance, 0.12, 'equipped Keen weapon adds 4 points to the 8% base chance');

  weapon.trait = 'first-strike';
  assert.equal(combatStatsFor(state).critChance, 0.08, 'other weapon traits must not receive Keen critical chance');

  weapon.trait = 'keen';
  state.equipment.weapon = null;
  assert.equal(combatStatsFor(state).critChance, 0.08, 'an unequipped Keen weapon must not affect critical chance');
});

test('desperation armor adds 20 Speed below or at 40% HP, but not at zero HP or when unequipped', () => {
  const state = createCombatState();
  const armor = equipTestGear(state, 'test-desperation-armor', 'armor', 'desperation');

  state.health = Math.ceil(state.maxHealth * 0.41);
  assert.equal(combatStatsFor(state).speed, 150, 'the bonus must not activate above the 40% threshold');

  state.health = Math.floor(state.maxHealth * 0.40);
  assert.equal(combatStatsFor(state).speed, 170, 'the bonus activates at the 40% threshold');

  state.health = 1;
  assert.equal(combatStatsFor(state).speed, 170, 'the bonus remains active while alive at critical health');

  state.health = 0;
  assert.equal(combatStatsFor(state).speed, 150, 'a defeated player should not retain the low-health Speed bonus');

  state.health = 1;
  state.equipment.armor = null;
  assert.equal(combatStatsFor(state).speed, 150, 'unequipped Desperation armor must not affect Speed');
});

test('bulwark armor provides the advertised four percent damage reduction only while equipped', () => {
  const state = createCombatState();
  const armor = equipTestGear(state, 'test-bulwark-armor', 'armor', 'bulwark');

  assert.equal(combatStatsFor(state).damageReduction, 0.04);
  armor.trait = 'regeneration';
  assert.equal(combatStatsFor(state).damageReduction, 0);

  armor.trait = 'bulwark';
  state.equipment.armor = null;
  assert.equal(combatStatsFor(state).damageReduction, 0, 'an unequipped Bulwark item must not mitigate damage');
});

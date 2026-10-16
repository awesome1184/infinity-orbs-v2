import test from 'node:test';
import assert from 'node:assert/strict';
import { combatOrbDamageMultiplier, combatStatsFor, createCombatState } from '../src/shared/combat.js';

test('orb rarity scales base damage monotonically from a 1x baseline', () => {
  assert.equal(combatOrbDamageMultiplier(0), 1);
  assert.equal(combatOrbDamageMultiplier(2), 1);
  assert.ok(combatOrbDamageMultiplier(10) > combatOrbDamageMultiplier(2));
  assert.ok(combatOrbDamageMultiplier(100) > combatOrbDamageMultiplier(10));
  assert.equal(combatOrbDamageMultiplier(200), 3);
  assert.ok(combatOrbDamageMultiplier(Number.MAX_SAFE_INTEGER) <= 20);
});

test('equipped gear from different slots contributes its own combat bonuses', () => {
  const state = createCombatState();
  const withLoadout = combatStatsFor(state);
  assert.ok(state.equipment.helmet);
  assert.ok(state.equipment.ring);
  assert.ok(state.equipment.boots);
  assert.ok(withLoadout.armor > 0);

  const ring = state.inventory.find(item => item.id === state.equipment.ring);
  assert.ok(ring);
  state.equipment.ring = null;
  const withoutRing = combatStatsFor(state);
  assert.equal(withLoadout.damage - withoutRing.damage, ring.damageBonus);
  assert.ok(withLoadout.critChance > withoutRing.critChance);
});

test('legacy chest gear remains a valid equipment slot after the armor-slot migration', () => {
  const state = createCombatState();
  const chest = state.inventory.find(item => item.id === state.equipment.chest);
  assert.ok(chest);
  assert.equal(chest.slot, 'chest');
  assert.equal(state.equipment.armor, undefined);
});

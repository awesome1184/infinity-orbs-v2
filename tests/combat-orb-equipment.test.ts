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
  const withoutExtras = combatStatsFor(state);
  const ring = { id:'test-ring', name:'Quiet Ember Signet', slot:'ring' as const, quality:31, floor:3, power:5, effect:'Test ring.', trait:'keen' as const, damageBonus:2, speedBonus:0, maxHealthBonus:0, armorBonus:0, critChanceBonus:.02 };
  const helmet = { id:'test-helmet', name:'Ashen Riftbound Helm', slot:'helmet' as const, quality:72, floor:3, power:8, effect:'Test helmet.', trait:'bulwark' as const, damageBonus:0, speedBonus:0, maxHealthBonus:10, armorBonus:12, critChanceBonus:0 };
  state.inventory.push(ring,helmet);
  state.equipment.ring=ring.id;
  state.equipment.helmet=helmet.id;
  const withLoadout = combatStatsFor(state);
  assert.equal(withLoadout.damage-withoutExtras.damage,ring.damageBonus);
  assert.equal(withLoadout.armor-withoutExtras.armor,helmet.armorBonus);
  assert.ok(withLoadout.critChance>withoutExtras.critChance);
  state.equipment.ring=null;
  assert.ok(combatStatsFor(state).critChance<withLoadout.critChance);
});

test('starter armor is represented by the chest slot in the new loadout', () => {
  const state = createCombatState();
  const chest = state.inventory.find(item => item.id === state.equipment.chest);
  assert.ok(chest);
  assert.equal(chest.slot, 'chest');
});

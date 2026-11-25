import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMBAT_BEAT_INTERVAL_MS,
  COMBAT_UPGRADES,
  combatBeatIntervalMsFor,
  combatUpgradeCost,
  combatNextBeatDelayMs,
  createCombatState,
} from '../src/shared/combat.js';

test('Chrono Surge shortens the global combat beat timer', () => {
  const state = createCombatState();
  assert.equal(combatBeatIntervalMsFor(state), COMBAT_BEAT_INTERVAL_MS);

  const id = 'chrono-surge-test';
  state.inventory.push({
    id,
    name: 'Chrono Surge Test Gear',
    slot: 'weapon',
    quality: 100,
    sourceFloor: 0,
    power: 100,
    effect: 'test fixture',
    trait: 'keen',
    damageBonus: 0,
    speedBonus: 0,
    maxHealthBonus: 0,
    armorBonus: 0,
    critChanceBonus: 0,
    majorAbility: {
      id: 'chrono-surge',
      name: 'Chrono Surge',
      trigger: 'passive',
      speedPercent: 0.35,
      description: 'Speeds up combat beats.',
    },
  });
  state.equipment.weapon = id;

  const intervalMs = Math.round(COMBAT_BEAT_INTERVAL_MS / 1.35);
  assert.equal(combatBeatIntervalMsFor(state), intervalMs);
  assert.ok(intervalMs < COMBAT_BEAT_INTERVAL_MS);

  // The client scheduler receives the same derived interval as the server.
  assert.equal(
    combatNextBeatDelayMs(20_000, 10_000, 0, intervalMs),
    Math.max(0, 10_000 + intervalMs - 20_000),
  );
});


test('Turn Timer removes one second from the base combat beat interval per rank', () => {
  const state = createCombatState();
  assert.equal(combatBeatIntervalMsFor(state), 30_000);

  state.combatUpgrades['turn-timer'] = 1;
  assert.equal(combatBeatIntervalMsFor(state), 29_000);

  state.combatUpgrades['turn-timer'] = 10;
  assert.equal(combatBeatIntervalMsFor(state), 20_000);

  const id = 'chrono-surge-with-turn-timer';
  state.inventory.push({
    id,
    name: 'Chrono Surge Test Gear',
    slot: 'weapon',
    quality: 100,
    sourceFloor: 0,
    power: 100,
    effect: 'test fixture',
    trait: 'keen',
    damageBonus: 0,
    speedBonus: 0,
    maxHealthBonus: 0,
    armorBonus: 0,
    critChanceBonus: 0,
    majorAbility: {
      id: 'chrono-surge',
      name: 'Chrono Surge',
      trigger: 'passive',
      speedPercent: 0.35,
      description: 'Speeds up combat beats.',
    },
  });
  state.equipment.weapon = id;
  assert.equal(combatBeatIntervalMsFor(state), Math.round(20_000 / 1.35));
});

test('every Combat Shop upgrade rank keeps its exponential price curve', () => {
  const state = createCombatState();
  for (const upgrade of COMBAT_UPGRADES) {
    assert.equal(upgrade.maxRank, 10, upgrade.name + ' should have ten ranks');
    assert.ok(upgrade.costMultiplier > 1, upgrade.name + ' should get more expensive each rank');
    let previousCost = 0;
    for (let rank = 0; rank < upgrade.maxRank; rank += 1) {
      state.combatUpgrades[upgrade.id] = rank;
      const expected = Math.round(upgrade.baseCost * Math.pow(upgrade.costMultiplier, rank));
      const cost = combatUpgradeCost(state, upgrade.id);
      assert.equal(cost, expected, upgrade.name + ' rank ' + (rank + 1));
      assert.ok(cost > previousCost, upgrade.name + ' costs should strictly increase');
      previousCost = cost;
    }
  }
});

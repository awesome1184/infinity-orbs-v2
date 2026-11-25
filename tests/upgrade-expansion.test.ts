import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createInitialState,
  upgradeCost,
  upgradeUnlockLevel,
  orbFingersMultiplier,
  criticalDividendMultiplier,
  effectiveRollCritChance,
  offlineFoundryMultiplier,
} from '../src/shared/game.js';

test('new idle-game upgrades are absent from a fresh Level 1 economy and unlock later', () => {
  const state = createInitialState();

  assert.equal(state.level, 1);
  assert.equal(state.upgrades.offlineFoundry, 0);
  assert.equal(state.upgrades.orbFingers, 0);
  assert.equal(state.upgrades.criticalDividend, 0);

  assert.equal(upgradeUnlockLevel('speed'), 1);
  assert.equal(upgradeUnlockLevel('multi'), 1);
  assert.equal(upgradeUnlockLevel('luck'), 1);
  assert.equal(upgradeUnlockLevel('coinBonus'), 1);
  assert.equal(upgradeUnlockLevel('offlineFoundry'), 35);
  assert.equal(upgradeUnlockLevel('orbFingers'), 40);
  assert.equal(upgradeUnlockLevel('criticalDividend'), 45);
});

test('new upgrades have rising Coin costs and explicit level caps', () => {
  assert.equal(upgradeCost('offlineFoundry', 0), 1_380);
  assert.equal(upgradeCost('orbFingers', 0), 2_875);
  assert.equal(upgradeCost('criticalDividend', 0), 2_070);

  assert.ok(upgradeCost('offlineFoundry', 1) > upgradeCost('offlineFoundry', 0));
  assert.ok(upgradeCost('orbFingers', 1) > upgradeCost('orbFingers', 0));
  assert.ok(upgradeCost('criticalDividend', 1) > upgradeCost('criticalDividend', 0));

  assert.equal(upgradeCost('offlineFoundry', 10), Infinity);
  assert.equal(upgradeCost('orbFingers', 15), Infinity);
  assert.equal(upgradeCost('criticalDividend', 20), Infinity);
});

test('Orb Fingers scales with other owned upgrades and excludes itself and Auto Roll', () => {
  const state = createInitialState();
  assert.equal(orbFingersMultiplier(state), 1);

  state.upgrades.orbFingers = 1;
  state.upgrades.speed = 2;
  state.upgrades.multi = 1;
  state.upgrades.coinBonus = 4;
  state.upgrades.auto = 1;

  assert.equal(orbFingersMultiplier(state), 1.03);

  state.upgrades.orbFingers = 2;
  assert.equal(orbFingersMultiplier(state), 1.06);
});

test('Critical Dividend uses actual crit share and safely clamps it', () => {
  const state = createInitialState();
  state.upgrades.criticalDividend = 4;

  assert.equal(criticalDividendMultiplier(state, 0.4), 1.04);
  assert.equal(criticalDividendMultiplier(state, 2), 1.1);
  assert.equal(criticalDividendMultiplier(state, -1), 1);
  assert.equal(criticalDividendMultiplier(state, Number.NaN), 1);
});

test('shared crit chance helper respects the existing 40% ceiling', () => {
  const state = createInitialState();
  state.upgrades.critChance = 5;
  assert.equal(effectiveRollCritChance(state), 0.15);

  state.upgrades.critChance = 100;
  assert.equal(effectiveRollCritChance(state), 0.4);
});

test('Offline Foundry scales offline Coin payouts and remains capped at ten levels', () => {
  const state = createInitialState();
  assert.equal(offlineFoundryMultiplier(state), 1);

  state.upgrades.offlineFoundry = 5;
  assert.equal(offlineFoundryMultiplier(state), 1.5);

  state.upgrades.offlineFoundry = 10;
  assert.equal(offlineFoundryMultiplier(state), 2);

  state.upgrades.offlineFoundry = 100;
  assert.equal(offlineFoundryMultiplier(state), 2);
});

test('debug upgrade presets initialize, reset, and unlock every standard upgrade', () => {
  const debug = readFileSync(resolve(process.cwd(), 'src/server/debug.ts'), 'utf8');
  for (const [id, level] of [['offlineFoundry', 10], ['orbFingers', 15], ['criticalDividend', 20]] as const) {
    assert.equal(debug.split(`${id}: ${level}`).length - 1, 3,
      `${id} should appear in the full max fixture, max preset, and unlock route`);
  }
  assert.ok(debug.includes('offlineFoundry: 0, orbFingers: 0, criticalDividend: 0'));
});

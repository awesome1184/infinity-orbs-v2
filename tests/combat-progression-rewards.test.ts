import test from 'node:test';
import assert from 'node:assert/strict';

import { context, redis } from '../src/server/devvit-mock.js';
import { getCombatSnapshot, performCombatBeat } from '../src/server/combat.js';
import { createCombatState } from '../src/shared/combat.js';

function testPlayerId(label: string): string {
  return label + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

test('defeating an Undercrypt enemy persists one kill, depth, coins, and XP reward', async () => {
  const originalUserId = context.userId;
  const userId = testPlayerId('combat-reward');
  const key = 'infinity-orbs:combat:' + userId;
  const initial = createCombatState();
  initial.enemyHp = 1; // The first player hit guarantees a kill; no stochastic outcome is needed.

  context.userId = userId;
  try {
    await redis.set(key, JSON.stringify(initial));

    const result = await performCombatBeat(initial.sequence + 1, 'strike');

    assert.equal(result.defeated, true);
    assert.equal(result.state.sequence, initial.sequence + 1);
    assert.equal(result.state.totalKills, initial.totalKills + 1);
    assert.equal(result.state.depth, initial.depth + 1);
    assert.equal(result.state.bestDepth, initial.depth + 1);
    assert.equal(result.state.coins, initial.coins + 14);
    assert.equal(result.state.xp, initial.xp + 22);
    assert.ok(result.actions.some(action => action.text === 'Collected 14 Delver Coins.'));
    assert.ok(result.actions.some(action => action.text === 'Descending to Depth 2.'));

    const persisted = await getCombatSnapshot();
    assert.equal(persisted.state.sequence, initial.sequence + 1);
    assert.equal(persisted.state.totalKills, initial.totalKills + 1);
    assert.equal(persisted.state.coins, initial.coins + 14);
    assert.equal(persisted.state.xp, initial.xp + 22);
  } finally {
    await redis.del(key);
    context.userId = originalUserId;
  }
});

test('crossing an XP threshold applies level stats, carries XP excess, and emits one level-up event', async () => {
  const originalUserId = context.userId;
  const userId = testPlayerId('combat-level-up');
  const key = 'infinity-orbs:combat:' + userId;
  const initial = createCombatState();
  initial.enemyHp = 1;
  initial.xp = 99;
  initial.xpToNext = 100;
  initial.health = 900;

  context.userId = userId;
  try {
    await redis.set(key, JSON.stringify(initial));

    const result = await performCombatBeat(initial.sequence + 1, 'strike');

    assert.equal(result.state.level, 2);
    assert.equal(result.state.xp, 21, '22 XP should cross the 100 XP threshold and carry 21 excess XP');
    assert.equal(result.state.xpToNext, 119);
    assert.equal(result.state.maxHealth, 1070);
    assert.equal(result.state.baseDamage, 58);
    assert.equal(result.state.health, 986, 'level-up healing should be 8% of the new 1,070 max HP');
    assert.equal(result.actions.filter(action => action.text === 'Delver reached Level 2.').length, 1);

    const persisted = await getCombatSnapshot();
    assert.equal(persisted.state.level, 2);
    assert.equal(persisted.state.xp, 21);
    assert.equal(persisted.state.xpToNext, 119);
    assert.equal(persisted.state.health, 986);
  } finally {
    await redis.del(key);
    context.userId = originalUserId;
  }
});

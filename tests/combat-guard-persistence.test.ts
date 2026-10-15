import test from 'node:test';
import assert from 'node:assert/strict';
import { context, redis, reddit, configureDevvitRuntime } from '../src/server/devvit-mock.js';
import { performCombatBeat } from '../src/server/combat.js';
import { createCombatState, getEnemyForDepth } from '../src/shared/combat.js';

test('Guard persists through a beat where the slower enemy has no action', async () => {
  const originalNow = Date.now;
  const originalRandom = Math.random;
  const originalContext = context;
  let now = 1_800_000_200_000;
  Date.now = () => now;
  Math.random = () => 0.9; // No critical hits or random bleed procs.
  const userId = 'combat-guard-slow-enemy-regression';
  configureDevvitRuntime({
    redis,
    context: { ...originalContext, userId },
    reddit,
  });

  try {
    const state = createCombatState();
    const enemy = getEnemyForDepth(8); // Bell Knight speed is 90, so no action on beat 1.
    assert.equal(enemy.id, 'bell-knight');
    assert.equal(enemy.speed, 90);
    state.depth = 8;
    state.bestDepth = 8;
    state.enemyHp = enemy.maxHp;
    const weapon = state.inventory.find(item => item.id === state.equipment.weapon);
    assert.ok(weapon);
    weapon.damageBonus = 0;
    weapon.speedBonus = 0;
    await redis.set('infinity-orbs:combat:' + userId, JSON.stringify(state));

    const guardedBeat = await performCombatBeat(1, 'guard');
    assert.equal(guardedBeat.actions.filter(action => action.actor === 'enemy').length, 0);
    assert.equal(guardedBeat.state.guardBeats, 1, 'Guard must remain active while the enemy cannot act yet');

    now += 1_001;
    const enemyActionBeat = await performCombatBeat(2, 'strike');
    const enemyAttack = enemyActionBeat.actions.find(action => action.actor === 'enemy' && action.kind === 'attack');
    assert.ok(enemyAttack, 'the slower enemy should get its first action on beat 2');
    const guardedDamage = Math.max(1, Math.round(Math.round(enemy.damage * 0.45) * (1 - enemyActionBeat.stats.damageReduction)));
    assert.equal(enemyAttack.damage, guardedDamage, 'Guard must mitigate the first incoming hit');
    assert.equal(enemyActionBeat.state.guardBeats, 0, 'Guard expires after the enemy acts');
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
    configureDevvitRuntime({ redis, context: originalContext, reddit });
  }
});

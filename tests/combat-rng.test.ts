import test from 'node:test';
import assert from 'node:assert/strict';

import { context, redis } from '../src/server/devvit-mock.js';
import { performCombatBeat, rollCombatSkill } from '../src/server/combat.js';
import { createCombatState } from '../src/shared/combat.js';

test('combat crits, gear drops, and skill gacha do not use Math.random', async () => {
  const userId = `combat-rng-regression-${process.pid}-${Date.now()}`;
  const previousUserId = context.userId;
  context.userId = userId;
  const key = `infinity-orbs:combat:${userId}`;
  const state = createCombatState();
  state.depth = 3;
  state.bestDepth = 3;
  state.enemyHp = 1;
  await redis.set(key, JSON.stringify(state));

  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('Combat randomness must use Web Crypto.');
  };

  try {
    const beat = await performCombatBeat(1, 'strike');
    assert.equal(beat.defeated, true);
    assert.ok(beat.item, 'the depth-three kill should exercise gear generation');
    assert.ok(beat.item.quality >= 0 && beat.item.quality <= 100);
    assert.ok(beat.item.id.startsWith('gear-'));

    const skill = await rollCombatSkill();
    assert.equal(skill.state.skillRolls, 1);
    assert.ok(skill.skillRoll.id);
    assert.ok(skill.skillRoll.rank >= 1 && skill.skillRoll.rank <= 5);
  } finally {
    Math.random = originalRandom;
    context.userId = previousUserId;
    await redis.del(key);
  }
});

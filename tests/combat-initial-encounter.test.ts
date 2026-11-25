import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatState, getEnemyForDungeonDepth } from '../src/shared/combat.js';

test('new combat state begins against a common non-boss enemy', () => {
  const state = createCombatState();
  const enemy = getEnemyForDungeonDepth(state.dungeonId, state.depth);
  assert.equal(state.depth, 1);
  assert.equal(enemy.kind, 'common');
  assert.equal(enemy.boss, false);
});

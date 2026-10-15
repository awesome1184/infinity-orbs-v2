import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCombatSkillCopy,
  combatStatsFor,
  COMBAT_SKILLS,
  createCombatState,
  getEnemyForDepth,
  nextUndercryptWardenDepth,
  SKILL_RANK_CAP,
} from '../src/shared/combat.js';
import type { CombatSkillStat, CombatStats } from '../src/shared/combat.js';

const STAT_FIELD: Record<CombatSkillStat, keyof Pick<CombatStats, 'damage' | 'speed' | 'maxHealth' | 'critChance' | 'coinMultiplier'>> = {
  damagePct: 'damage',
  speedFlat: 'speed',
  healthPct: 'maxHealth',
  critChance: 'critChance',
  coinBonus: 'coinMultiplier',
};

test('every skill copy improves its defined combat stat through Rank 5', () => {
  for (const skill of COMBAT_SKILLS) {
    const state = createCombatState();
    const field = STAT_FIELD[skill.stat];
    let previousValue = combatStatsFor(state)[field];

    for (let rank = 1; rank <= SKILL_RANK_CAP; rank += 1) {
      const result = applyCombatSkillCopy(state, skill.id, 75);
      const currentValue = combatStatsFor(state)[field];

      assert.equal(result.rank, rank, `${skill.name}: expected Rank ${rank}`);
      assert.equal(result.duplicate, rank > 1, `${skill.name}: duplicate flag at Rank ${rank}`);
      assert.equal(result.maxRank, rank === SKILL_RANK_CAP, `${skill.name}: max-rank flag at Rank ${rank}`);
      assert.ok(currentValue > previousValue, `${skill.name} Rank ${rank} should increase ${field}`);
      previousValue = currentValue;
    }
  }
});

test('Warden navigation points at the current boss depth, not the following boss', () => {
  for (const depth of [10, 20, 30, 50000]) {
    assert.equal(getEnemyForDepth(depth).boss, true);
    assert.equal(nextUndercryptWardenDepth(depth), depth);
  }

  assert.equal(nextUndercryptWardenDepth(1), 10);
  assert.equal(nextUndercryptWardenDepth(9), 10);
  assert.equal(nextUndercryptWardenDepth(11), 20);
  assert.equal(nextUndercryptWardenDepth(19), 20);
  assert.equal(nextUndercryptWardenDepth(21), 30);
});

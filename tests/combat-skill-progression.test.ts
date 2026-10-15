import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_SKILLS,
  SKILL_RANK_CAP,
  applyCombatSkillCopy,
  combatStatsFor,
  createCombatState,
  getEnemyForDepth,
  nextUndercryptWardenDepth,
  undercryptOrbLuckMultiplier,
  undercryptWardensDefeated,
} from '../src/shared/combat.js';
import type { CombatSkillStat, CombatStats } from '../src/shared/combat.js';

const STAT_FIELD: Record<CombatSkillStat, keyof Pick<CombatStats, 'damage' | 'speed' | 'maxHealth' | 'critChance' | 'coinMultiplier'>> = {
  damagePct: 'damage',
  speedFlat: 'speed',
  healthPct: 'maxHealth',
  critChance: 'critChance',
  coinBonus: 'coinMultiplier',
};

test('the skill codex contains 25 distinct skills with five in each rarity', () => {
  assert.equal(COMBAT_SKILLS.length, 25);
  assert.equal(new Set(COMBAT_SKILLS.map(skill => skill.id)).size, 25);

  const counts = new Map<string, number>();
  for (const skill of COMBAT_SKILLS) {
    counts.set(skill.rarity, (counts.get(skill.rarity) ?? 0) + 1);
  }

  for (const rarity of ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythic']) {
    assert.equal(counts.get(rarity), 5, `expected five ${rarity} skills`);
  }
});

test('every skill copy increases its stat through Rank 5 and marks repeated copies as duplicates', () => {
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

test('a copy beyond Rank 5 refunds coins by rarity without raising rank or stats', () => {
  const refundRate: Record<string, number> = {
    Common: 0.25,
    Uncommon: 0.25,
    Rare: 0.25,
    Epic: 0.5,
    Mythic: 0.75,
  };

  for (const rarity of Object.keys(refundRate)) {
    const skill = COMBAT_SKILLS.find(candidate => candidate.rarity === rarity)!;
    const state = createCombatState();

    for (let rank = 0; rank < SKILL_RANK_CAP; rank += 1) {
      applyCombatSkillCopy(state, skill.id, 1_000);
    }

    const beforeCoins = state.coins;
    const beforeStats = combatStatsFor(state);
    const result = applyCombatSkillCopy(state, skill.id, 1_000);

    assert.equal(result.rank, SKILL_RANK_CAP);
    assert.equal(result.duplicate, true);
    assert.equal(result.maxRank, true);
    assert.equal(result.coinsRefunded, Math.round(1_000 * refundRate[rarity]!));
    assert.equal(state.coins, beforeCoins + result.coinsRefunded);
    assert.deepEqual(combatStatsFor(state), beforeStats);
  }
});

test('the Warden marker identifies the current boss depth instead of skipping to the next one', () => {
  for (const depth of [10, 20, 30, 50_000]) {
    assert.equal(getEnemyForDepth(depth).boss, true);
    assert.equal(nextUndercryptWardenDepth(depth), depth);
  }

  assert.equal(nextUndercryptWardenDepth(1), 10);
  assert.equal(nextUndercryptWardenDepth(9), 10);
  assert.equal(nextUndercryptWardenDepth(11), 20);
  assert.equal(nextUndercryptWardenDepth(19), 20);
  assert.equal(nextUndercryptWardenDepth(21), 30);
});

test('permanent Undercrypt orb luck is awarded only after clearing a Warden depth', () => {
  assert.equal(undercryptWardensDefeated(1), 0);
  assert.equal(undercryptWardensDefeated(10), 0);
  assert.equal(undercryptWardensDefeated(11), 1);
  assert.equal(undercryptOrbLuckMultiplier(11), 1.01);
  assert.equal(undercryptWardensDefeated(250), 24);
  assert.equal(undercryptWardensDefeated(251), 25);
  assert.equal(undercryptOrbLuckMultiplier(50_000), 1.25);
});

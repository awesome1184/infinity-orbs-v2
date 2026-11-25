import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PLAYER_LEVEL,
  LEVEL_EXPANSION_START,
  LEVEL_MILESTONES,
  applyLevelProgress,
  calculateLevelFromXp,
  createInitialState,
  getLevelBenefits,
  levelAdjustedXpReward,
  predictRollActivation,
  getLevelProgress,
  totalXpRequiredBeforeLevel,
  xpRequiredForLevel,
} from '../src/shared/game.js';

function legacyXpCost(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  const base = Math.floor(70 * Math.pow(safeLevel, 1.30));
  const lateGameMultiplier = safeLevel <= 25 ? 1 : 1 + (safeLevel - 25) * 0.10;
  return Math.floor(base * lateGameMultiplier);
}

test('the Paragon expansion preserves every XP cost through the old Level 1,000 cap', () => {
  assert.equal(MAX_PLAYER_LEVEL, 10_000);
  assert.equal(LEVEL_EXPANSION_START, 1_000);
  for (const level of [1, 5, 25, 26, 50, 100, 500, 999, 1_000]) {
    assert.equal(xpRequiredForLevel(level), legacyXpCost(level));
  }
});

test('Paragon XP costs continue smoothly and remain below the old runaway extension', () => {
  const level1000Cost = xpRequiredForLevel(1_000);
  assert.ok(xpRequiredForLevel(1_001) > level1000Cost);
  assert.ok(xpRequiredForLevel(1_001) / level1000Cost < 1.01);
  assert.ok(xpRequiredForLevel(10_000) > xpRequiredForLevel(5_000));
  assert.ok(xpRequiredForLevel(10_000) < legacyXpCost(10_000));
  assert.ok(xpRequiredForLevel(10_000) < Number.MAX_SAFE_INTEGER);
});

test('level XP thresholds and progress work in the expanded range', () => {
  const threshold = totalXpRequiredBeforeLevel(2_501);
  assert.equal(calculateLevelFromXp(threshold).level, 2_501);
  const at2500 = totalXpRequiredBeforeLevel(2_500);
  const progress = getLevelProgress(2_500, at2500 + Math.floor(xpRequiredForLevel(2_500) / 2), at2500);
  assert.equal(progress.level, 2_500);
  assert.equal(progress.progressPercent, 50);
});

test('each newly earned Paragon level still grants exactly one Mastery Point', () => {
  const state = createInitialState();
  state.level = 1_000;
  state.levelXpFloor = totalXpRequiredBeforeLevel(1_000);
  state.xp = totalXpRequiredBeforeLevel(1_003);
  state.masteryPoints = 27;

  assert.equal(applyLevelProgress(state), 3);
  assert.equal(state.level, 1_003);
  assert.equal(state.levelXpFloor, totalXpRequiredBeforeLevel(1_003));
  assert.equal(state.masteryPoints, 30);
});

test('new Paragon milestones unlock real roll, economy, cooldown, and Altar bonuses', () => {
  const milestoneLevels = LEVEL_MILESTONES.map(milestone => milestone.level);
  for (const level of [1_250, 1_500, 2_000, 2_500, 3_000, 4_000, 5_000, 7_500, 10_000]) {
    assert.ok(milestoneLevels.includes(level), 'missing milestone at level ' + level);
  }

  const at2000 = getLevelBenefits(2_000);
  const before2000 = getLevelBenefits(1_999);
  assert.ok(at2000.luckMultiplier - before2000.luckMultiplier >= 0.20);
  assert.equal(getLevelBenefits(2_500).bonusBalls, getLevelBenefits(2_499).bonusBalls + 1);
  assert.equal(getLevelBenefits(3_000).cooldownReductionMs, 250);
  assert.ok(getLevelBenefits(4_000).altarEffectMultiplier > getLevelBenefits(3_999).altarEffectMultiplier);
  assert.equal(getLevelBenefits(10_000).bonusBalls, 15);
});

test('the new level cap remains stable and does not overflow level calculations', () => {
  const state = createInitialState();
  state.level = MAX_PLAYER_LEVEL;
  state.levelXpFloor = totalXpRequiredBeforeLevel(MAX_PLAYER_LEVEL);
  state.xp = state.levelXpFloor + xpRequiredForLevel(MAX_PLAYER_LEVEL) * 5;
  state.masteryPoints = 12;
  assert.equal(applyLevelProgress(state), 0);
  assert.equal(state.level, MAX_PLAYER_LEVEL);
  assert.equal(state.masteryPoints, 12);
  assert.equal(calculateLevelFromXp(Number.MAX_SAFE_INTEGER).level, MAX_PLAYER_LEVEL);
});


test('level XP bonuses apply to quest and community rewards as well as roll XP', () => {
  assert.equal(levelAdjustedXpReward(1, 100), 100);
  assert.equal(levelAdjustedXpReward(5, 100), 115);
  assert.equal(levelAdjustedXpReward(1_000, 100), 138);
  assert.equal(levelAdjustedXpReward(1_250, 100), 152);
  assert.equal(levelAdjustedXpReward(10_000, 100), Math.round(100 * getLevelBenefits(10_000).xpMultiplier));
  assert.equal(levelAdjustedXpReward(10, -100), 0);
  assert.equal(levelAdjustedXpReward(10, Number.NaN), 0);
});

test('server and optimistic quest claims share the same level-adjusted XP calculation', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const server = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const client = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(server, /function applyXp\(s: PlayerState, amount: number\): void \{\s*s\.xp \+= levelAdjustedXpReward\(s\.level \|\| 1, amount\)/);
  assert.match(client, /xp: current\.xp \+ levelAdjustedXpReward\(current\.level \|\| 1, quest\.rewardXp \?\? 0\)/);
});

test('single-activation predictions apply the same player-level rarity scale as live rolls', () => {
  const levelOne = createInitialState();
  const levelTen = createInitialState();
  levelTen.level = 10;

  const levelOnePrediction = predictRollActivation(levelOne, 741_852_963, false, 1);
  const levelTenPrediction = predictRollActivation(levelTen, 741_852_963, false, 1);

  const levelOneRarity = levelOnePrediction.batch[0]?.rarity ?? 0;
  const levelTenRarity = levelTenPrediction.batch[0]?.rarity ?? 0;
  assert.ok(levelOneRarity >= 2);
  assert.ok(levelTenRarity > levelOneRarity * 2);
});

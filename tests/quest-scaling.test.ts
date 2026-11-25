import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialDailyQuests,
  createInitialWeeklyQuests,
  createInitialState,
  questDifficultyMultiplier,
  questRewardMultiplier,
  estimateQuestCoinsPerMinute,
} from '../src/shared/game.js';

test('quest difficulty scales gently with the highest Orb and has a hard ceiling', () => {
  assert.equal(questDifficultyMultiplier(2), 1);
  assert.equal(questDifficultyMultiplier(10_000), 1.05);
  assert.equal(questDifficultyMultiplier(1e6), 1.1);
  assert.equal(questDifficultyMultiplier(1e100), 1.2);
});

test('quest Coins use fixed time-based income budgets while Shards keep the capped rarity bonus', () => {
  assert.equal(questRewardMultiplier(2), 1);
  assert.equal(questRewardMultiplier(1e6), 1.2);
  assert.equal(questRewardMultiplier(1e100), 1.5);

  const daily = createInitialDailyQuests(1e6, 100);
  const dailyRolls = daily.find(quest => quest.id === 'daily-rolls-25');
  const dailyHundred = daily.find(quest => quest.id === 'daily-rolls-100');
  assert.equal(dailyRolls?.target, 28);
  assert.equal(daily.reduce((total, quest) => total + quest.rewardCoins, 0), 3_000);
  assert.equal(dailyHundred?.rewardShards, 1);

  const weekly = createInitialWeeklyQuests(1e6, 100);
  const weeklyRolls = weekly.find(quest => quest.id === 'weekly-grind');
  const weeklyEpic = weekly.find(quest => quest.id === 'weekly-epic');
  assert.equal(weeklyRolls?.target, 1100);
  assert.equal(weekly.reduce((total, quest) => total + quest.rewardCoins, 0), 24_000);
  assert.equal(weeklyRolls?.rewardShards, 6);
  assert.equal(weeklyEpic?.minRarity, 1100);
  assert.equal(weeklyEpic?.rewardShards, 4);

  const veryHigh = createInitialWeeklyQuests(1e100, 100);
  assert.equal(veryHigh.find(quest => quest.id === 'weekly-share')?.rewardShards, 3);
});

test('quest Coin budgets grow linearly with the current earning-rate estimate', () => {
  const player = createInitialState();
  const startingRate = estimateQuestCoinsPerMinute(player);
  assert.ok(startingRate > 0);
  const dailyA = createInitialDailyQuests(2, 10).reduce((sum, quest) => sum + quest.rewardCoins, 0);
  const dailyB = createInitialDailyQuests(2, 20).reduce((sum, quest) => sum + quest.rewardCoins, 0);
  const weeklyA = createInitialWeeklyQuests(2, 10).reduce((sum, quest) => sum + quest.rewardCoins, 0);
  const weeklyB = createInitialWeeklyQuests(2, 20).reduce((sum, quest) => sum + quest.rewardCoins, 0);
  assert.equal(dailyA, 300);
  assert.equal(dailyB, 600);
  assert.equal(weeklyA, 2_400);
  assert.equal(weeklyB, 4_800);
});

test('rarity quest thresholds and Share quest unlocks follow the same mild difficulty scale', () => {
  const daily = createInitialDailyQuests(1e6);
  const weekly = createInitialWeeklyQuests(1e6);
  assert.equal(daily.find(quest => quest.id === 'daily-rare-100')?.minRarity, 110);
  assert.equal(weekly.find(quest => quest.id === 'weekly-epic')?.minRarity, 1100);
  assert.equal(weekly.find(quest => quest.id === 'weekly-share')?.unlockRarity, 110);
});

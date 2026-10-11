import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  createInitialGlobalBoosters,
  activateGlobalBoosterStack,
  decayGlobalBoosterState,
  createInitialGuildCombo,
  activateGuildComboStack,
  decayGuildComboState,
  guildComboDurationMs,
  guildComboLuckMultiplier,
  guildComboSpeedMultiplier,
  guildComboCritChanceBonus,
  guildComboCritLuckBonus,
  guildComboRemainingMs,
  guildComboProgress,
  GUILD_COMBO_BASE_DURATION_MS,
  GUILD_COMBO_ACTIVATIONS_PER_TIER,
  GUILD_COMBO_MAX_TIER,
  grantFreeShards,
  grantRollShards,
  spendShards,
  FREE_SHARD_DAILY_CAP,
  onlinePlayerLuckMultiplier,
  luckMultiplier,
  frenzyClaimCountForRarity,
  frenzyOrbCountForRarity,
  FRENZY_LOG_BASE,
  bestCodexChain,
  applyLevelProgress,
  xpRequiredForLevel,
  SINGULARITY_TITHE_ROLLS_PER_DUST,
  singularityTitheDustForRolls,
} from '../src/shared/game.js';
import {
  createGuildTask,
  createInitialGuildTasks,
} from '../src/shared/social.js';

const NOW = 1_800_000_000_000;

test('Level progression awards one Mastery Point per level gained', () => {
  const state = createInitialState();
  state.xp =
    xpRequiredForLevel(1) +
    xpRequiredForLevel(2) +
    xpRequiredForLevel(3);
  const gained = applyLevelProgress(state);
  assert.equal(gained, 3);
  assert.equal(state.level, 4);
  assert.equal(state.masteryPoints, 3);
});

test('Legacy high-level accounts can progress after the XP curve changed', () => {
  const state = createInitialState();
  state.level = 320;
  state.xp = 100_000_000;
  delete state.levelXpFloor;

  const firstPass = applyLevelProgress(state, 1);
  assert.equal(firstPass, 0);
  assert.equal(state.level, 320);
  assert.equal(state.levelXpFloor, state.xp);

  state.xp += xpRequiredForLevel(320);
  const secondPass = applyLevelProgress(state, 1);
  assert.equal(secondPass, 1);
  assert.equal(state.level, 321);
  assert.equal(state.masteryPoints, 1);
});

test('Singularity Tithe awards dust every 200 processed rolls and counts batches', () => {
  assert.equal(SINGULARITY_TITHE_ROLLS_PER_DUST, 200);
  assert.equal(singularityTitheDustForRolls(199, 1, 1), 1);
  assert.equal(singularityTitheDustForRolls(198, 2, 2), 2);
  assert.equal(singularityTitheDustForRolls(200, 100, 1), 0);
});

test('fresh state starts with an inactive Guild Combo', () => {
  const state = createInitialGuildCombo(NOW);

  assert.equal(state.tier, 0);
  assert.equal(state.activationProgress, 0);
  assert.equal(state.endsAt, 0);
  assert.equal(guildComboRemainingMs(state, NOW), 0);
  assert.equal(guildComboLuckMultiplier(state, NOW), 1);
  assert.equal(guildComboSpeedMultiplier(state, NOW), 1);
  assert.equal(guildComboCritChanceBonus(state, NOW), 0);
  assert.equal(guildComboCritLuckBonus(state, NOW), 0);
});

test('one Guild Task completion activates Combo tier 1', () => {
  const state = activateGuildComboStack(createInitialGuildCombo(NOW), NOW);

  assert.equal(state.tier, 1);
  assert.equal(state.activationProgress, 1);
  assert.equal(guildComboRemainingMs(state, NOW), guildComboDurationMs(1));
  assert.equal(guildComboProgress(state, NOW), 25);
});

test('four Guild Task completions advance Combo to tier 2', () => {
  let state = createInitialGuildCombo(NOW);

  for (let i = 0; i < GUILD_COMBO_ACTIVATIONS_PER_TIER; i += 1) {
    state = activateGuildComboStack(state, NOW);
  }

  assert.equal(state.tier, 2);
  assert.equal(state.activationProgress, 0);
  assert.ok(state.endsAt > NOW);
  assert.ok(guildComboDurationMs(2) < guildComboDurationMs(1));
});

test('Guild Combo keeps adding time on repeated task completions', () => {
  const first = activateGuildComboStack(createInitialGuildCombo(NOW), NOW);
  const second = activateGuildComboStack(first, NOW);

  assert.equal(second.tier, 1);
  assert.equal(second.activationProgress, 2);
  assert.equal(second.endsAt, first.endsAt + guildComboDurationMs(1));
});

test('Guild Combo bonuses match the half-strength design', () => {
  const tier1 = {
    tier: 1,
    activationProgress: 0,
    endsAt: NOW + GUILD_COMBO_BASE_DURATION_MS,
    lastTickAt: NOW,
  };
  const tier10 = {
    tier: GUILD_COMBO_MAX_TIER,
    activationProgress: 0,
    endsAt: NOW + GUILD_COMBO_BASE_DURATION_MS,
    lastTickAt: NOW,
  };

  assert.equal(guildComboLuckMultiplier(tier1, NOW), 1.05);
  assert.equal(guildComboSpeedMultiplier(tier1, NOW), 0.975);
  assert.equal(guildComboCritChanceBonus(tier1, NOW), 0.01);
  assert.equal(guildComboCritLuckBonus(tier1, NOW), 0.05);

  assert.equal(guildComboLuckMultiplier(tier10, NOW), 1.5);
  assert.equal(guildComboSpeedMultiplier(tier10, NOW), 0.75);
  assert.equal(guildComboCritChanceBonus(tier10, NOW), 0.10);
  assert.equal(guildComboCritLuckBonus(tier10, NOW), 0.50);
});

test('Guild Combo expires and clears its tier and progress', () => {
  const active = activateGuildComboStack(createInitialGuildCombo(NOW), NOW);
  const decayed = decayGuildComboState(active, active.endsAt + 1);

  assert.deepEqual(decayed, {
    tier: 0,
    activationProgress: 0,
    endsAt: 0,
    lastTickAt: active.endsAt + 1,
  });
});

test('higher Guild Combo tiers drain faster', () => {
  const elapsed = 10_000;
  const tier1 = {
    tier: 1,
    activationProgress: 0,
    endsAt: NOW + 600_000,
    lastTickAt: NOW,
  };
  const tier4 = {
    tier: 4,
    activationProgress: 0,
    endsAt: NOW + 600_000,
    lastTickAt: NOW,
  };

  const d1 = decayGuildComboState(tier1, NOW + elapsed);
  const d4 = decayGuildComboState(tier4, NOW + elapsed);

  assert.ok(d1.endsAt > d4.endsAt);
  assert.equal(d1.endsAt, tier1.endsAt - Math.round(elapsed * 1 * 0.25));
  assert.equal(d4.endsAt, tier4.endsAt - Math.round(elapsed * 4 * 0.25));
});

test('Combo Reserve duration multiplier increases Combo time', () => {
  const base = guildComboDurationMs(3);
  const boosted = guildComboDurationMs(3, 1.10);

  assert.equal(boosted, Math.round(base * 1.10));
});

test('Guild Combo tier cannot exceed the configured maximum', () => {
  let state = createInitialGuildCombo(NOW);

  for (let i = 0; i < 100; i += 1) {
    state = activateGuildComboStack(state, NOW, GUILD_COMBO_MAX_TIER);
  }

  assert.equal(state.tier, GUILD_COMBO_MAX_TIER);
});

test('Guild task set starts with one task of each type', () => {
  const tasks = createInitialGuildTasks(1);

  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map(task => task.type).sort(), ['rare', 'rolls', 'value']);
  for (const task of tasks) {
    assert.equal(task.tier, 1);
    assert.equal(task.progress, 0);
    assert.ok(task.target > 0);
    assert.ok(task.reward > 0);
    assert.ok(task.guildXpReward > 0);
  }
});

test('Guild task difficulty and rewards scale upward by tier', () => {
  for (const type of ['rolls', 'value', 'rare'] as const) {
    const tier1 = createGuildTask(type, 1, 1);
    const tier2 = createGuildTask(type, 2, 1);
    const tier5 = createGuildTask(type, 5, 1);

    assert.ok(tier2.target > tier1.target, `${type}: tier 2 target should exceed tier 1`);
    assert.ok(tier5.target > tier2.target, `${type}: tier 5 target should exceed tier 2`);
    assert.ok(tier2.reward > tier1.reward, `${type}: tier 2 token reward should exceed tier 1`);
    assert.ok(tier5.reward > tier2.reward, `${type}: tier 5 token reward should exceed tier 2`);
    assert.ok(tier2.guildXpReward > tier1.guildXpReward, `${type}: tier 2 XP reward should exceed tier 1`);
  }
});

test('Guild task targets scale with Guild level', () => {
  const level1 = createGuildTask('rolls', 4, 1);
  const level25 = createGuildTask('rolls', 4, 25);

  assert.ok(level25.target > level1.target);
  assert.equal(level25.tier, level1.tier);
});

test('Guild task rewards remain capped', () => {
  const extreme = createGuildTask('rolls', 10_000, 10_000);

  assert.ok(extreme.reward <= 25_000);
  assert.ok(extreme.guildXpReward <= 10_000);
});

test('roll Shards respect the hard 50-per-day cap while free reward Shards bypass it', () => {
  const state = createInitialState(NOW);
  state.lastFreeShardReset = new Date(NOW).toISOString().slice(0, 10);
  state.freeShardsEarnedToday = 49;
  state.shards = 0;
  state.lifetimeShards = 0;

  assert.equal(grantRollShards(state, 10, NOW), 1);
  assert.equal(state.shards, 1);
  assert.equal(state.freeShardsEarnedToday, 50);
  assert.equal(grantRollShards(state, 10, NOW), 0);

  assert.equal(grantFreeShards(state, 10, NOW), 10);
  assert.equal(state.shards, 11);
  assert.equal(state.freeShardsEarnedToday, 50);
});

test('invalid Shard spend amounts are rejected before touching wallet state', () => {
  const state = createInitialState(NOW);
  state.shards = 8;
  state.purchasedShards = 3;

  assert.throws(() => spendShards(state, Number.NaN), /Invalid Shards amount/);
  assert.throws(() => spendShards(state, Number.POSITIVE_INFINITY), /Invalid Shards amount/);
  assert.throws(() => spendShards(state, Number.MAX_SAFE_INTEGER + 1), /Invalid Shards amount/);
  assert.equal(state.shards, 8);
  assert.equal(state.purchasedShards, 3);
});

test('Shard reward paths do not overflow the persisted balance's safe integer range', () => {
  const state = createInitialState(NOW);
  state.shards = Number.MAX_SAFE_INTEGER - 2;
  state.lifetimeShards = Number.MAX_SAFE_INTEGER - 1;
  state.lastFreeShardReset = new Date(NOW).toISOString().slice(0, 10);
  state.freeShardsEarnedToday = 0;

  assert.equal(grantFreeShards(state, 10, NOW), 2);
  assert.equal(state.shards, Number.MAX_SAFE_INTEGER);
  assert.equal(state.lifetimeShards, Number.MAX_SAFE_INTEGER);
  // The lifetime statistic saturates independently; if wallet space existed,
  // maxing the lifetime statistic alone would not block the spendable balance.
  assert.equal(grantRollShards(state, 10, NOW), 0);
  assert.equal(grantFreeShards(state, Number.POSITIVE_INFINITY, NOW), 0);
  assert.equal(state.shards, Number.MAX_SAFE_INTEGER);
  assert.equal(state.lifetimeShards, Number.MAX_SAFE_INTEGER);
});

test('malformed daily Shard counter fails closed without producing NaN', () => {
  const state = createInitialState(NOW);
  state.lastFreeShardReset = new Date(NOW).toISOString().slice(0, 10);
  state.freeShardsEarnedToday = 'broken' as unknown as number;
  state.shards = 0;
  state.lifetimeShards = 'broken' as unknown as number;

  assert.equal(grantRollShards(state, 7, NOW), 0);
  assert.equal(state.freeShardsEarnedToday, FREE_SHARD_DAILY_CAP);
  assert.equal(state.shards, 0);
  assert.equal(Number.isFinite(state.lifetimeShards), true);
});

test('non-finite roll Shard request grants zero while preserving a valid budget', () => {
  const state = createInitialState(NOW);
  state.lastFreeShardReset = new Date(NOW).toISOString().slice(0, 10);
  state.freeShardsEarnedToday = 12;
  state.shards = 4;
  state.lifetimeShards = 20;

  assert.equal(grantRollShards(state, Number.NaN, NOW), 0);
  assert.equal(grantRollShards(state, Number.POSITIVE_INFINITY, NOW), 0);
  assert.equal(state.freeShardsEarnedToday, 12);
  assert.equal(state.shards, 4);
  assert.equal(state.lifetimeShards, 20);
});

test('Orb Frenzy batch size follows logarithmic rarity scaling', () => {
  assert.equal(frenzyOrbCountForRarity(1), 1);
  assert.equal(frenzyOrbCountForRarity(2), Math.floor(Math.log(2) / Math.log(FRENZY_LOG_BASE)));
  assert.ok(frenzyOrbCountForRarity(1_000) > frenzyOrbCountForRarity(100));
  assert.ok(frenzyOrbCountForRarity(1_000_000) < 1_000_000);
  assert.ok(frenzyOrbCountForRarity(1e15) < 1_000);
});

test('Codex Devotion reports the best consecutive rarity chain', () => {
  const chain = bestCodexChain({
    '2': 1,
    '3': 4,
    '4': 2,
    '6': 1,
    '7': 1,
    '8': 1,
    '10': 1,
  });

  assert.deepEqual(chain, { start: 6, end: 8, length: 3 });
});

test('online population Luck is monotonic and sane', () => {
  assert.equal(onlinePlayerLuckMultiplier(1), 1);
  assert.equal(onlinePlayerLuckMultiplier(2), 1.05);
  assert.ok(onlinePlayerLuckMultiplier(100) > onlinePlayerLuckMultiplier(10));
  assert.equal(onlinePlayerLuckMultiplier(0), 1);
});

test('Astral Reserve adds exactly 2% Luck per level', () => {
  const state = createInitialState(NOW);
  // Isolate Astral Reserve from the active Daily Streak Community buff.
  state.dailyStreakCommunity = undefined;
  state.prestigeUpgrades.astralReserve = 0;
  assert.equal(luckMultiplier(state), 1);

  state.prestigeUpgrades.astralReserve = 1;
  assert.equal(luckMultiplier(state), 1.02);

  state.prestigeUpgrades.astralReserve = 5;
  assert.equal(luckMultiplier(state), 1.10);
});

test('Frenzy Volley counts each additional multiball at 20% efficiency', () => {
  const base = frenzyOrbCountForRarity(100);
  assert.equal(frenzyClaimCountForRarity(100, 1, 0), base);
  assert.equal(frenzyClaimCountForRarity(100, 2, 1), Math.floor(base * 1.20));
  assert.equal(frenzyClaimCountForRarity(100, 3, 1), Math.floor(base * 1.40));
});


test('Global Booster bar preserves the real tier of its latest four activation segments', () => {
  let booster = createInitialGlobalBoosters(NOW).luck;
  for (let i = 0; i < 4; i += 1) {
    booster = activateGlobalBoosterStack(booster, NOW, 10);
  }

  assert.equal(booster.tier, 2);
  assert.deepEqual(booster.segmentTiers, [1, 1, 1, 1]);

  booster = activateGlobalBoosterStack(booster, NOW + 1, 10);
  assert.deepEqual(booster.segmentTiers, [1, 1, 1, 2]);

  const decayed = decayGlobalBoosterState(booster, NOW + 2);
  assert.deepEqual(decayed.segmentTiers, [1, 1, 1, 2]);
});

test('Global Booster segment history is bounded and sanitized when reading stored state', () => {
  const state = decayGlobalBoosterState({
    tier: 2,
    activationProgress: 1,
    endsAt: NOW + 60_000,
    lastTickAt: NOW,
    segmentTiers: [2, 11, -1, 3, 5],
  }, NOW + 1);

  assert.deepEqual(state.segmentTiers, [11, 0, 3, 5]);
  assert.equal(decayGlobalBoosterState({
    tier: 0,
    activationProgress: 0,
    endsAt: 0,
    segmentTiers: [1, 2, 3, 4],
  }, NOW).segmentTiers?.length, 0);
});

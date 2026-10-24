import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  addCollectionValue,
  MAX_ORB_RARITY,
  formatRarity,
  getOrbTier,
  getOrbInfo,
  rollContinuum,
  calculatePrestigeDust,
  calculateCosmicDust,
  MAX_COSMIC_DUST,
  aftershockCriticalLuckBonus,
  unbrokenMomentumSpeedBonus,
  recordRollingSessionActivity,
  UNBROKEN_MOMENTUM_SESSION_GAP_MS,
  ALTAR_COIN_FLOOR_GROWTH,
  altarCoinFloor,
  calculateAltarMultipliers,
  cooldownMs,
  critMultiplier,
  effectiveOfflineTickMs,
  upgradeCost,
  createInitialGlobalBoosters,
  GLOBAL_BOOSTERS,
  PREMIUM_BOOSTERS,
  AUTOMATIONS,
  SHARD_SYNTHESIS_COST,
  formatShardAmount,
  roundShardAmount,
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
  resolveShardPityReward,
  SHARD_PITY_ROLLS_TO_REWARD,
  SHARD_PITY_REWARD,
  SHARD_PROC_REWARD,
  spendShards,
  onlinePlayerLuckMultiplier,
  luckMultiplier,
  frenzyClaimCountForRarity,
  frenzyOrbCountForRarity,
  FRENZY_LOG_BASE,
  bestCodexChain,
  nextCodexChainRarity,
  chainPatcherShardCost,
  CHAIN_PATCHER_COOLDOWN_MS,
  applyLevelProgress,
  xpRequiredForLevel,
} from '../src/shared/game.js';
import {
  createGuildTask,
  createInitialGuildTasks,
} from '../src/shared/social.js';

const NOW = 1_800_000_000_000;


test('the finite rarity ceiling stays numeric while over-cap rolls display as Infinity', () => {
  assert.equal(MAX_ORB_RARITY, Number.MAX_VALUE);
  assert.equal(rollContinuum(1, () => Number.MIN_VALUE), Number.POSITIVE_INFINITY);
  assert.equal(getOrbTier(MAX_ORB_RARITY), 'Endless');
  assert.equal(formatRarity(MAX_ORB_RARITY), '1.797693e308');
  assert.equal(formatRarity(Number.POSITIVE_INFINITY), 'Infinity');
  assert.equal(formatRarity(MAX_ORB_RARITY, true), 'Infinity');
  assert.equal(getOrbInfo(MAX_ORB_RARITY, true).tier, 'Infinity');
  assert.equal(formatRarity(Number.MAX_VALUE * (1 - Number.EPSILON)), '1.797693e308');
  assert.equal(formatRarity(1e15), '1.00e15');
});

test('Chain Patcher chooses the lowest adjacent rarity and prices 1/900 at 10 Shards', () => {
  const collection: Record<string, number> = {};
  for (let rarity = 2; rarity <= 899; rarity += 1) collection[String(rarity)] = 1;

  assert.equal(bestCodexChain(collection).length, 898);
  assert.equal(nextCodexChainRarity(collection), 900);
  assert.equal(chainPatcherShardCost(900), 100);
  assert.equal(chainPatcherShardCost(999), 100);
  assert.equal(chainPatcherShardCost(1_000), 110);
  assert.equal(nextCodexChainRarity({}), 2);
  assert.equal(chainPatcherShardCost(2), 10);
  assert.equal(CHAIN_PATCHER_COOLDOWN_MS, 24 * 60 * 60 * 1_000);
});

test('Chain Patcher extends the cheapest edge of the longest Codex chain', () => {
  const collection: Record<string, number> = {};
  for (let rarity = 900; rarity <= 905; rarity += 1) collection[String(rarity)] = 1;
  assert.equal(bestCodexChain(collection).length, 6);
  assert.equal(nextCodexChainRarity(collection), 899);
});

test('collection value accumulation saturates instead of losing precision or becoming non-finite', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(addCollectionValue(max - 2, 10), max);
  assert.equal(addCollectionValue(max + 10, 1), max);
  assert.equal(addCollectionValue(100, Number.POSITIVE_INFINITY), max);
  assert.equal(addCollectionValue(-1, 25), 25);
  assert.equal(addCollectionValue(Number.NaN, 25), 25);
  assert.equal(addCollectionValue(25, Number.NaN), 25);
});

test('Prestige Dust has a million-value minimum step and logarithmic diminishing returns', () => {
  assert.equal(calculatePrestigeDust(999_999), 0);
  assert.equal(calculatePrestigeDust(1_000_000), 1);
  assert.equal(calculatePrestigeDust(1_999_999), 1);
  assert.equal(calculatePrestigeDust(2_000_000), 2);
  assert.equal(calculatePrestigeDust(3_000_000), 3);
  assert.equal(calculatePrestigeDust(4_000_000), 3);
  assert.equal(calculatePrestigeDust(4_050_000), 4);
  assert.equal(calculatePrestigeDust(300_000_000), 58);
});

test('Cosmic Dust earnings never exceed the 50-Dust wallet cap', () => {
  const state=createInitialState();
  state.collectionValue=300_000_000;
  assert.equal(MAX_COSMIC_DUST,50);
  assert.equal(calculateCosmicDust(state),50);
  state.cosmicDust=49;
  assert.equal(calculateCosmicDust(state),1,'only remaining capacity can be earned');
  state.cosmicDust=50;
  assert.equal(calculateCosmicDust(state),0,'prestige should not consume a run without any Dust reward');
});

test('Aftershock turns the best record-breaking dry interval into permanent Critical Luck', () => {
  assert.equal(aftershockCriticalLuckBonus(0), 0);
  assert.equal(aftershockCriticalLuckBonus(9), 0);
  assert.equal(aftershockCriticalLuckBonus(10), 0.005);
  assert.equal(aftershockCriticalLuckBonus(80_000), 0.02);
  assert.equal(aftershockCriticalLuckBonus(1_000_000), 0.03);
  assert.equal(aftershockCriticalLuckBonus(Number.MAX_SAFE_INTEGER), 0.075);

  const state = createInitialState(NOW);
  const baseCriticalLuck = critMultiplier(state);
  state.aftershockRecord = 80_000;
  assert.equal(critMultiplier(state), baseCriticalLuck, 'Aftershock is inactive until purchased');
  state.masterySkills!.aftershock = 1;
  assert.equal(critMultiplier(state), baseCriticalLuck + 0.02, 'purchased Aftershock applies its record bonus');
});

test('Unbroken Momentum tracks uninterrupted sessions and grants capped Speed', () => {
  assert.equal(UNBROKEN_MOMENTUM_SESSION_GAP_MS, 5 * 60_000);
  assert.equal(unbrokenMomentumSpeedBonus(0), 0);
  assert.equal(unbrokenMomentumSpeedBonus(5 * 60_000 - 1), 0);
  const expectedFiveMinuteBonus = 0.20 * Math.log1p((5 / 60) / 20) / Math.log1p(48 / 20);
  assert.ok(Math.abs(unbrokenMomentumSpeedBonus(5 * 60_000) - expectedFiveMinuteBonus) < 1e-12);
  const expectedThirtyMinuteBonus = 0.20 * Math.log1p(0.5 / 20) / Math.log1p(48 / 20);
  assert.ok(Math.abs(unbrokenMomentumSpeedBonus(30 * 60_000) - expectedThirtyMinuteBonus) < 1e-12);
  assert.equal(unbrokenMomentumSpeedBonus(48 * 60 * 60_000), 0.20);
  assert.ok(Math.abs(unbrokenMomentumSpeedBonus(72 * 60 * 60_000) - 0.25) < 0.001);
  assert.equal(unbrokenMomentumSpeedBonus(120 * 60 * 60_000), 0.30);

  const state = createInitialState(NOW);
  recordRollingSessionActivity(state, NOW);
  recordRollingSessionActivity(state, NOW + 4 * 60_000);
  assert.equal(state.longestRollingSessionMs, 4 * 60_000);

  // A gap greater than five minutes starts a fresh session but never erases the record.
  recordRollingSessionActivity(state, NOW + 10 * 60_000);
  assert.equal(state.rollingSessionStartedAt, NOW + 10 * 60_000);
  assert.equal(state.longestRollingSessionMs, 4 * 60_000);
  recordRollingSessionActivity(state, NOW + 14 * 60_000);
  recordRollingSessionActivity(state, NOW + 16 * 60_000);
  assert.equal(state.longestRollingSessionMs, 6 * 60_000);

  const baseCooldown = cooldownMs(createInitialState(NOW));
  const lockedMomentumState = createInitialState(NOW);
  lockedMomentumState.longestRollingSessionMs = 30 * 60_000;
  assert.equal(cooldownMs(lockedMomentumState), baseCooldown, 'Momentum is inactive until purchased');

  const momentumState = createInitialState(NOW);
  momentumState.longestRollingSessionMs = 30 * 60_000;
  momentumState.prestigeUpgrades.unbrokenMomentum = 1;
  const momentumBonus = unbrokenMomentumSpeedBonus(momentumState.longestRollingSessionMs);
  assert.equal(cooldownMs(momentumState), Math.max(300, Math.round(baseCooldown / (1 + momentumBonus))));
});

test('Altar rank compounds at 1.05× per level and the coin floor grows by 1.5×', () => {
  assert.equal(ALTAR_COIN_FLOOR_GROWTH, 1.5);
  assert.equal(altarCoinFloor(0), 10_000);
  assert.equal(altarCoinFloor(1), 15_000);
  assert.equal(altarCoinFloor(2), 22_500);

  const state = createInitialState(NOW);
  state.sacrifices!.altarLevel = 1;
  assert.equal(calculateAltarMultipliers(state).coinMultiplier, 1.05);
  state.sacrifices!.altarLevel = 2;
  assert.ok(Math.abs(calculateAltarMultipliers(state).coinMultiplier - 1.1025) < 1e-10);
  assert.ok(Math.abs(calculateAltarMultipliers(state).totalAltarMultiplier - 1.1025) < 1e-10);
});

test('Cosmic Reserve multiplies Luck from unspent Cosmic Dust only', () => {
  const state = createInitialState(NOW);
  const withoutReserve = luckMultiplier(state);
  state.cosmicDust = 100;
  state.prestigeUpgrades.cosmicReserve = 5;
  const withSixX = luckMultiplier(state);
  assert.ok(Math.abs(withSixX - withoutReserve * 6) <= 0.03,
    '100 unspent Dust at level 5 should produce a 6x Luck multiplier');

  state.cosmicDust = 50;
  const withThreePointFiveX = luckMultiplier(state);
  assert.ok(Math.abs(withThreePointFiveX - withoutReserve * 3.5) <= 0.03,
    '50 unspent Dust at level 5 should produce a 3.5x Luck multiplier');
  state.cosmicDust = 0;
  assert.equal(luckMultiplier(state), withoutReserve);
  state.cosmicDust = 100;
  state.prestigeUpgrades.cosmicReserve = 0;
  assert.equal(luckMultiplier(state), withoutReserve);
});

test('Offline Generation Speed reaches its 60% reduction cap at level 8', () => {
  const state = createInitialState(NOW);
  const baseInterval = effectiveOfflineTickMs(state);
  state.upgrades.offlineRate = 7;
  const levelSeven = effectiveOfflineTickMs(state);
  state.upgrades.offlineRate = 8;
  const levelEight = effectiveOfflineTickMs(state);
  state.upgrades.offlineRate = 12;
  const aboveCap = effectiveOfflineTickMs(state);

  assert.equal(levelSeven, Math.max(10_000, Math.round(baseInterval * 0.44)));
  assert.equal(levelEight, Math.max(10_000, Math.round(baseInterval * 0.40)));
  assert.equal(aboveCap, levelEight);
  assert.ok(Number.isFinite(upgradeCost('offlineRate', 7)));
  assert.equal(upgradeCost('offlineRate', 8), Infinity);
});

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
    tier: 10,
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
  assert.equal(d1.endsAt, tier1.endsAt - Math.round(elapsed * 0.25 * Math.log2(2)));
  assert.equal(d4.endsAt, tier4.endsAt - Math.round(elapsed * 0.25 * Math.log2(5)));
});

test('Combo Reserve duration multiplier increases Combo time', () => {
  const base = guildComboDurationMs(3);
  const boosted = guildComboDurationMs(3, 1.10);

  assert.equal(boosted, Math.round(base * 1.10));
});

test('Guild Combo advances beyond tier 10 and remains bounded by the configured maximum', () => {
  let state = createInitialGuildCombo(NOW);

  for (let i = 0; i < 100; i += 1) {
    state = activateGuildComboStack(state, NOW, GUILD_COMBO_MAX_TIER);
  }
  assert.ok(state.tier > 10, 'Guild Combo should not stop at tier 10');

  for (let i = 100; i < GUILD_COMBO_MAX_TIER * GUILD_COMBO_ACTIVATIONS_PER_TIER; i += 1) {
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

test('Cosmic Reserve multiplies Luck by unspent Cosmic Dust at 1% per Dust per upgrade level', () => {
  const state = createInitialState(NOW);
  state.cosmicDust = 100;
  state.prestigeUpgrades.cosmicReserve = 0;
  const baseLuck = luckMultiplier(state);

  state.prestigeUpgrades.cosmicReserve = 1;
  assert.ok(Math.abs(luckMultiplier(state) / baseLuck - 2) < 0.03, 'level 1 should double Luck with 100 unspent Dust');
  state.prestigeUpgrades.cosmicReserve = 5;
  assert.ok(Math.abs(luckMultiplier(state) / baseLuck - 6) < 0.05, 'level 5 should multiply Luck by 6 with 100 unspent Dust');

  state.cosmicDust = 0;
  assert.equal(luckMultiplier(state), baseLuck, 'spent or zero Dust grants no Cosmic Reserve bonus');
});

test('Offline Generation Speed cannot be purchased past its 60% hard cap', () => {
  const state = createInitialState(NOW);
  state.upgrades.offlineRate = 8;
  const cappedTick = effectiveOfflineTickMs(state);
  state.upgrades.offlineRate = 100;
  assert.equal(effectiveOfflineTickMs(state), cappedTick);
  assert.ok(Number.isFinite(upgradeCost('offlineRate', 7)));
  assert.equal(upgradeCost('offlineRate', 8), Infinity);
});

test('roll Shards are uncapped, fractional, and tracked without integer rounding', () => {
  const state = createInitialState(NOW);
  state.lastFreeShardReset = new Date(NOW).toISOString().slice(0, 10);
  state.freeShardsEarnedToday = 49.75;
  state.shards = 0;
  state.lifetimeShards = 0;

  assert.equal(grantRollShards(state, 0.125, NOW), 0.125);
  assert.equal(state.shards, 0.125);
  assert.equal(state.freeShardsEarnedToday, 49.875);
  assert.equal(grantRollShards(state, 60.125, NOW), 60.125);
  assert.equal(state.shards, 60.25);
  assert.equal(state.freeShardsEarnedToday, 110);

  assert.equal(grantFreeShards(state, 0.005, NOW), 0.005);
  assert.equal(state.shards, 60.255);
  assert.equal(state.freeShardsEarnedToday, 110);
  assert.equal(state.lifetimeShards, 60.255);
});

test('whole-number Shard sinks preserve fractional remainder and purchased provenance', () => {
  const state = createInitialState(NOW);
  state.shards = 250.75;
  state.purchasedShards = 100;
  state.purchasedShardLots = { orderA: 100 };

  assert.equal(spendShards(state, 250), 250);
  assert.equal(state.shards, 0.75);
  assert.equal(state.purchasedShards, 0);
  assert.deepEqual(state.purchasedShardLots, {});
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

test("Shard reward paths do not overflow the persisted balance's safe integer range", () => {
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

test('malformed Shard telemetry is repaired without suppressing fractional rewards', () => {
  const state = createInitialState(NOW);
  state.lastFreeShardReset = new Date(NOW).toISOString().slice(0, 10);
  state.freeShardsEarnedToday = 'broken' as unknown as number;
  state.shards = 0;
  state.lifetimeShards = 'broken' as unknown as number;

  assert.equal(grantRollShards(state, 0.125, NOW), 0.125);
  assert.equal(state.freeShardsEarnedToday, 0.125);
  assert.equal(state.shards, 0.125);
  assert.equal(state.lifetimeShards, 0.125);
});

test('Shard proc pity rewards a fractional bonus after 100 misses and resets on proc', () => {
  const state = createInitialState(NOW);
  assert.equal(state.shardPityRolls, 0);
  for (let i = 0; i < SHARD_PITY_ROLLS_TO_REWARD - 1; i += 1) {
    assert.equal(resolveShardPityReward(state, false), 0);
  }
  assert.equal(state.shardPityRolls, SHARD_PITY_ROLLS_TO_REWARD - 1);
  assert.equal(resolveShardPityReward(state, false), SHARD_PITY_REWARD);
  assert.equal(state.shardPityRolls, 0);
  assert.equal(resolveShardPityReward(state, true), SHARD_PROC_REWARD);
  assert.equal(state.shardPityRolls, 0);
});

test('non-finite roll Shard requests grant zero while preserving reporting telemetry', () => {
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


test('Shard sinks are pricier, fractional values are formatted, and Global Booster costs ignore tier', () => {
  assert.deepEqual(Object.values(GLOBAL_BOOSTERS).map(booster => booster.costShards), [250, 250, 250]);
  assert.equal(PREMIUM_BOOSTERS.barrage.costShards, 1_000);
  assert.equal(AUTOMATIONS.autoUpgrade.costShards, 15_000);
  assert.equal(SHARD_SYNTHESIS_COST, 100);
  assert.equal(chainPatcherShardCost(900), 100);
  assert.equal(formatShardAmount(0.005), '0.005');
  assert.equal(formatShardAmount(3.125), '3.125');
  assert.equal(roundShardAmount(1.23456), 1.235);
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


test('Unbroken Momentum uses the requested logarithmic Speed curve', () => {
  const hour = 60 * 60 * 1000;
  assert.equal(unbrokenMomentumSpeedBonus(0), 0);
  assert.ok(Math.abs(unbrokenMomentumSpeedBonus(48 * hour) - 0.20) < 1e-10,
    '48 hours should grant exactly 20% permanent Speed');
  assert.ok(Math.abs(unbrokenMomentumSpeedBonus(72 * hour) - 0.25) < 0.001,
    '72 hours should grant approximately 25% permanent Speed');
  assert.equal(unbrokenMomentumSpeedBonus(1000 * hour), 0.30,
    'long sessions should respect the 30% cap');
});

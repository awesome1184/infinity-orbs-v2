import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { autoRollReadyAt, manualRollReadyAt, normalizeLastRollTimestamp } from '../src/shared/auto-roll-timing.js';
import {
  MAX_EFFECTIVE_ROLLS_PER_BATCH,
  MAX_SIMULATED_ROLLS_PER_BATCH,
  MAX_SIMULATED_ROLLS_PER_REQUEST,
  MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH,
  MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH,
  MAX_SIMULATED_OFFLINE_ROLLS_PER_BATCH,
  createRollBatchPlan,
  getRarityBounds,
  effectiveWeightAtSample,
  sampleBinomialCount,
  virtualRollOffsetAtSample,
} from '../src/shared/roll-batching.js';

function seededRandom(seed = 123456789): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test('100 million effective Orbs fit in one bounded online chunk', () => {
  const plan = createRollBatchPlan(100_000_000, 0, true, MAX_SIMULATED_ROLLS_PER_REQUEST);
  assert.equal(MAX_SIMULATED_ROLLS_PER_REQUEST, 4_096);
  assert.equal(MAX_SIMULATED_ROLLS_PER_BATCH, 50_000);
  assert.equal(MAX_EFFECTIVE_ROLLS_PER_BATCH, 100_000_000);
  assert.ok(plan.simulatedBaseCount <= MAX_SIMULATED_ROLLS_PER_REQUEST);
  let effectiveCount = 0;
  for (let index = 0; index < plan.simulatedBaseCount; index++) effectiveCount += effectiveWeightAtSample(plan, index);
  assert.equal(effectiveCount, 100_000_000);
});

test('300 million effective Orbs process in four bounded online chunks', () => {
  const totalEffective = 300_000_000;
  const ballsPerActivation = 150;
  const totalActivations = totalEffective / ballsPerActivation;
  const maxActivationsPerChunk = Math.floor((MAX_EFFECTIVE_ROLLS_PER_BATCH - 2) / ballsPerActivation);
  let remainingActivations = totalActivations;
  let processed = 0;
  let chunks = 0;
  let simulatedSamples = 0;

  while (remainingActivations > 0) {
    const chunkActivations = Math.min(remainingActivations, maxActivationsPerChunk);
    const chunkEffective = chunkActivations * ballsPerActivation;
    const plan = createRollBatchPlan(chunkEffective, 0, true, MAX_SIMULATED_ROLLS_PER_REQUEST);
    assert.ok(plan.simulatedBaseCount <= MAX_SIMULATED_ROLLS_PER_REQUEST);
    let chunkProcessed = 0;
    for (let index = 0; index < plan.simulatedBaseCount; index++) {
      chunkProcessed += effectiveWeightAtSample(plan, index);
    }
    assert.equal(chunkProcessed, chunkEffective);
    processed += chunkProcessed;
    simulatedSamples += plan.simulatedBaseCount;
    chunks += 1;
    remainingActivations -= chunkActivations;
  }

  assert.equal(chunks, 4); // Three full 99,999,900-Orb chunks plus the final remainder.
  assert.equal(processed, totalEffective);
  assert.ok(simulatedSamples <= 4 * MAX_SIMULATED_ROLLS_PER_REQUEST);
});



test('2.5 million Frenzy Orbs stay within a 4,096-sample request budget', () => {
  const plan = createRollBatchPlan(
    MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH,
    0,
    true,
    MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH,
  );
  assert.equal(MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH, 2_500_000);
  assert.equal(MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH, 4_096);
  assert.ok(plan.compressionWeight > 1);
  assert.ok(plan.simulatedBaseCount <= 4_096);

  let effectiveCount = 0;
  for (let index = 0; index < plan.simulatedBaseCount; index++) {
    effectiveCount += effectiveWeightAtSample(plan, index);
  }
  assert.equal(effectiveCount, 2_500_000);
});

test('rarity bounds handle large sample lists without argument spreading', () => {
  const samples = new Array<number>(100_000);
  for (let index = 0; index < samples.length; index++) {
    samples[index] = (index % 10_000) + 1;
  }

  assert.deepEqual(getRarityBounds(samples), { min: 1, max: 10_000 });
  assert.deepEqual(getRarityBounds([]), { min: 0, max: 0 });
});

test('weighted samples conserve the exact effective Orb count, including a partial tail', () => {
  for (const count of [1, 49_999, 50_000, 50_001, 123_456, 499_999, 500_000]) {
    const plan = createRollBatchPlan(count);
    let totalWeight = 0;
    for (let index = 0; index < plan.simulatedBaseCount; index++) {
      totalWeight += effectiveWeightAtSample(plan, index);
    }
    assert.equal(totalWeight, count, 'effective count mismatch for ' + count);
  }
});

test('the first three new-player Orbs stay uncompressed and preserve their exact indexes', () => {
  const plan = createRollBatchPlan(500_000, 3);
  assert.equal(effectiveWeightAtSample(plan, 0), 1);
  assert.equal(effectiveWeightAtSample(plan, 1), 1);
  assert.equal(effectiveWeightAtSample(plan, 2), 1);
  assert.equal(virtualRollOffsetAtSample(plan, 0), 0);
  assert.equal(virtualRollOffsetAtSample(plan, 1), 1);
  assert.equal(virtualRollOffsetAtSample(plan, 2), 2);
  assert.equal(virtualRollOffsetAtSample(plan, 3), 3);
  assert.equal(plan.simulatedBaseCount, 50_003); // 50k weighted samples plus 3 exact starter-guarantee Orbs.
});

test('large offline vault claims stay within a bounded sample budget and conserve every Orb', () => {
  const effectiveCount = 1_000_000;
  const plan = createRollBatchPlan(
    effectiveCount,
    3,
    true,
    MAX_SIMULATED_OFFLINE_ROLLS_PER_BATCH,
  );

  assert.equal(MAX_SIMULATED_OFFLINE_ROLLS_PER_BATCH, 4_096);
  assert.equal(plan.protectedOpeningCount, 3);
  assert.ok(plan.compressionWeight > 1);
  assert.ok(plan.simulatedBaseCount <= MAX_SIMULATED_OFFLINE_ROLLS_PER_BATCH + 3);

  let processedCount = 0;
  for (let index = 0; index < plan.simulatedBaseCount; index++) {
    processedCount += effectiveWeightAtSample(plan, index);
  }
  assert.equal(processedCount, effectiveCount);
  assert.equal(effectiveWeightAtSample(plan, 0), 1);
  assert.equal(effectiveWeightAtSample(plan, 1), 1);
  assert.equal(effectiveWeightAtSample(plan, 2), 1);
});

test('large low-probability proc counts stay within valid binomial bounds', () => {
  const rng = seededRandom();
  const successes = sampleBinomialCount(100_000, 0.005, rng);
  assert.ok(successes >= 400 && successes <= 600, 'unexpected proc count: ' + successes);
  assert.equal(sampleBinomialCount(500, 0, rng), 0);
  assert.equal(sampleBinomialCount(500, 1, rng), 500);
  assert.equal(sampleBinomialCount(10, 0.5, () => 0), 0);
  assert.equal(sampleBinomialCount(10, 0.5, () => 1), 10);
  assert.equal(sampleBinomialCount(10, 0.9, () => 0), 10);
  assert.equal(sampleBinomialCount(10, 0.9, () => 1), 0);
  const distributionRng = seededRandom(987654321);
  let distributionTotal = 0;
  const distributionSamples = 20_000;
  for (let index = 0; index < distributionSamples; index++) {
    distributionTotal += sampleBinomialCount(10, 0.3, distributionRng);
  }
  const sampledMean = distributionTotal / distributionSamples;
  assert.ok(Math.abs(sampledMean - 3) < 0.08, 'small-group binomial mean should remain close to n*p: ' + sampledMean);
});

test('server uses weighted sample counts for Luck, player totals, XP, Coins, and progress', () => {
  const server = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const multiRoll = server.slice(server.indexOf('export async function roll('), server.indexOf('export async function subscribeToSubredditForReward'));
  const apply = server.slice(server.indexOf('export async function applyRolls('), server.indexOf('\nasync function commitOfflineNotificationMarkerIfUnchanged'));
  const frenzy = server.slice(server.indexOf('export async function claimOrbFrenzy'), server.indexOf('export async function postFrenzyThankYouComment'));

  assert.match(apply, /const rarityBounds = getRarityBounds\(rarities\)/);
  assert.doesNotMatch(apply, /Math\.(?:min|max)\(\.\.\.rarities\)/);
  assert.ok(apply.includes('const sampleScale = sampleWeight * averageGroupMultiplier'));
  assert.ok(apply.includes('effectiveLuck * sampleScale * sampleScale'));
  assert.match(apply, /const isCompressedGroup = sampleWeight > 1/);
  assert.match(apply, /source === 'offline'[\s\S]{0,100}MAX_SIMULATED_OFFLINE_ROLLS_PER_BATCH/);
  assert.match(apply, /forcedRarity == null,[\s\S]{0,100}maxSimulatedRolls/);
  assert.match(apply, /rollContinuum\(\s*effectiveLuck,\s*rng,\s*runeLuckMultiplier,\s*runeRarityFloor/);
  assert.match(apply, /runeLuckMultiplier \* criticalMultiplier/);
  assert.match(apply, /runeLuckMultiplier \* supernovaMultiplier/);
  assert.match(apply, /const criticalTailWeight = normalCriticalGroupCount \* criticalMultiplier/);
  assert.match(apply, /const supernovaTailWeight = groupSupernovaCount \* supernovaMultiplier/);
  assert.match(apply, /s\.totalRolls \+= sampleWeight/);
  assert.match(apply, /xpForBaseOrb \* ordinaryGroupCount/);
  assert.match(apply, /xpForCriticalOrb \* normalCriticalGroupCount/);
  assert.match(apply, /const normalCriticalGroupCount = groupCriticalCount - groupSupernovaCount/);
  assert.ok(apply.includes('sampleBinomialCount(critCountInGroup, supernovaChance, rng)'));
  assert.match(apply, /xpForSupernovaOrb \* groupSupernovaCount/);
  assert.match(apply, /extraCoinsEstimate = addCoinAmount/);
  assert.match(apply, /extraCoinsForSupernovaOrbs = Math\.max\(1, Math\.round\(coinsForRarity\(supernovaRewardRarity\) \* 0\.20\)\)/);
  assert.match(apply, /rarities\.push\(rarityValue\);\s*rarityWeights\.push\(count\)/);
  assert.match(apply, /topBaseFinalValue \+ finalVal/);
  assert.match(apply, /xpForTopBaseline/);
  assert.match(apply, /lowCoinsForMaximumBaseline/);
  assert.match(apply, /lowRarityCoinsEstimate = addCoinAmount/);
  assert.match(apply, /sampleBinomialCount\(sampleWeight, combinedShardChance, rng\)/);
  assert.ok(multiRoll.includes('Math.floor((MAX_EFFECTIVE_ROLLS_PER_BATCH - 2) / ballsPerActivation)'));
  assert.match(apply, /MAX_SIMULATED_ROLLS_PER_REQUEST/);
  const effectiveCapStart = apply.indexOf("const maxSupportedRollCount = source === 'offline'");
  assert.ok(effectiveCapStart >= 0);
  assert.ok(apply.slice(effectiveCapStart, effectiveCapStart + 300).includes('MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH'));
  assert.match(apply, /MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH/);
  assert.match(frenzy, /MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH, remainingCount/);
  assert.match(frenzy, /writeFrenzyClaimProgress\(claimantId, postId, attemptId, count, absoluteProcessed, false\)/);
});


test('manual and Auto Roll cooldown clocks are independent', () => {
  const lastRollAt = 10_000;
  const manualCooldown = 15_000;
  const autoCooldown = 2_000;
  const retryUntil = 13_500;

  assert.equal(manualRollReadyAt(lastRollAt, manualCooldown), 25_000);
  assert.equal(autoRollReadyAt(lastRollAt, autoCooldown, retryUntil), 13_500);
  assert.equal(autoRollReadyAt(lastRollAt, autoCooldown, 0), 12_000);
  assert.equal(manualRollReadyAt(null, manualCooldown), 0);
  assert.equal(manualRollReadyAt(undefined, manualCooldown), 0);
});

test('invalid and future saved roll timestamps cannot strand a player on cooldown', () => {
  const now = 100_000;
  assert.equal(normalizeLastRollTimestamp(null, now), 0);
  assert.equal(normalizeLastRollTimestamp(-1, now), 0);
  assert.equal(normalizeLastRollTimestamp('1000', now), 0);
  assert.equal(normalizeLastRollTimestamp(now + 60_000, now), 0);
  assert.equal(normalizeLastRollTimestamp(now - 5_000, now), now - 5_000);
});

/**
 * Large online, offline, and Frenzy batches use weighted representative rolls. Each sample
 * stands in for several effective Orbs, with the matching squared Luck factor.
 */
export const MAX_SIMULATED_ROLLS_PER_BATCH = 50_000;
// Bound changed Codex fields included in one player-save transaction.
export const MAX_SIMULATED_ROLLS_PER_REQUEST = 4_096;
// Online roll chunks use bounded weighted samples and can commit 100 million effective Orbs per pass.
export const MAX_EFFECTIVE_ROLLS_PER_BATCH = 100_000_000;
// Offline claims write their Codex back into the player save. Keep the number
// of representative rarities low so a full vault cannot inflate one Redis save
// request beyond Devvit's request-size budget.
export const MAX_SIMULATED_OFFLINE_ROLLS_PER_BATCH = 4_096;
// A single Frenzy HTTP request is more expensive than a normal roll batch.
// Keep its total representative-sample work substantially lower.
export const MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH = 4_096;
export const MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH = 2_500_000;

/**
 * Find sample rarity bounds without spreading a potentially large array into
 * function arguments. Some server runtimes have a low argument/stack limit.
 */
export function getRarityBounds(values: readonly number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 0 };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}


export interface RollBatchPlan {
  effectiveCount: number;
  protectedOpeningCount: number;
  remainingEffectiveCount: number;
  compressionWeight: number;
  simulatedBaseCount: number;
}

export function createRollBatchPlan(
  effectiveCount: number,
  protectedOpeningCount = 0,
  compress = true,
  maxSimulatedRolls = MAX_SIMULATED_ROLLS_PER_BATCH,
): RollBatchPlan {
  const safeCount = Number.isSafeInteger(effectiveCount) ? Math.max(0, effectiveCount) : 0;
  const opening = Math.min(
    safeCount,
    Number.isSafeInteger(protectedOpeningCount) ? Math.max(0, protectedOpeningCount) : 0,
  );
  const remaining = safeCount - opening;
  const sampleLimit = Number.isSafeInteger(maxSimulatedRolls)
    ? Math.max(1, maxSimulatedRolls)
    : MAX_SIMULATED_ROLLS_PER_BATCH;
  const weight = compress && remaining > sampleLimit
    ? Math.ceil(remaining / sampleLimit)
    : 1;
  const sampleCount = remaining > 0 ? Math.ceil(remaining / weight) : 0;

  return {
    effectiveCount: safeCount,
    protectedOpeningCount: opening,
    remainingEffectiveCount: remaining,
    compressionWeight: weight,
    simulatedBaseCount: opening + sampleCount,
  };
}

export function effectiveWeightAtSample(plan: RollBatchPlan, sampleIndex: number): number {
  const index = Math.floor(Number(sampleIndex));
  if (!Number.isFinite(index) || index < 0 || index >= plan.simulatedBaseCount) return 0;
  if (index < plan.protectedOpeningCount) return 1;
  const compressedIndex = index - plan.protectedOpeningCount;
  return Math.max(
    0,
    Math.min(
      plan.compressionWeight,
      plan.remainingEffectiveCount - compressedIndex * plan.compressionWeight,
    ),
  );
}

export function virtualRollOffsetAtSample(plan: RollBatchPlan, sampleIndex: number): number {
  const index = Math.floor(Number(sampleIndex));
  if (!Number.isFinite(index) || index < 0 || index >= plan.simulatedBaseCount) return plan.effectiveCount;
  if (index < plan.protectedOpeningCount) return index;
  return plan.protectedOpeningCount
    + (index - plan.protectedOpeningCount) * plan.compressionWeight;
}

/** Approximate Binomial(n,p) in constant/expected-success time for batched procs. */
export function sampleBinomialCount(n: number, p: number, random: () => number): number {
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const probability = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
  if (count === 0 || probability === 0) return 0;
  if (probability >= 1) return count;

  // Compressed Orb groups are small. Inverse-CDF binomial sampling preserves
  // their exact distribution with one RNG draw per representative group.
  if (count <= 256) {
    const complement = probability > 0.5;
    const p = complement ? 1 - probability : probability;
    const raw = Number(random());
    const sample = Number.isFinite(raw)
      ? Math.max(0, Math.min(1 - Number.EPSILON, raw))
      : 0.5;
    let mass = Math.pow(1 - p, count);
    let cumulative = mass;
    let successes = 0;
    while (sample > cumulative && successes < count) {
      mass *= ((count - successes) / (successes + 1)) * (p / (1 - p));
      successes += 1;
      cumulative += mass;
    }
    const sampledCount = Math.min(count, successes);
    return complement ? count - sampledCount : sampledCount;
  }

  const mean = count * probability;
  const variance = mean * (1 - probability);
  if (variance >= 1) {
    const rawU1 = Number(random());
    const rawU2 = Number(random());
    const u1 = Number.isFinite(rawU1) ? Math.max(1e-12, Math.min(1 - Number.EPSILON, rawU1)) : 0.5;
    const u2 = Number.isFinite(rawU2) ? Math.max(0, Math.min(1, rawU2)) : 0.5;
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, Math.min(count, Math.round(mean + Math.sqrt(variance) * gaussian)));
  }

  // Geometric gaps are efficient for the very low Shard Proc probabilities.
  const logFailure = Math.log1p(-probability);
  let position = 0;
  let successes = 0;
  while (position <= count) {
    const raw = Number(random());
    const sample = Number.isFinite(raw) ? Math.max(1e-12, Math.min(1 - Number.EPSILON, raw)) : 0.5;
    position += Math.floor(Math.log(sample) / logFailure) + 1;
    if (position <= count) successes += 1;
  }
  return successes;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RIFT_RELIC_EQUIP_SLOTS,
  RIFT_RELIC_FORKED_EQUIP_SLOTS,
  emptyRiftRelicLevels,
  getRiftRelicEffects,
  normalizeEquippedRiftRelics,
  normalizeRiftRelicLevels,
  riftRelicCost,
  riftObserverLuckMultiplier,
  riftEffectiveTemporalDragMultiplier,
  riftRelicProgressCoinMultiplier,
} from '../src/shared/rift-relics.js';

test('Rift Relic levels are bounded and equipped loadouts contain only owned relics', () => {
  const levels = normalizeRiftRelicLevels({
    'clock-without-hands': 99,
    observer: -2,
    'loaded-die': 2.8,
    'rift-tithe': '3',
  });
  assert.equal(levels['clock-without-hands'], 3);
  assert.equal(levels.observer, 0);
  assert.equal(levels['loaded-die'], 2);
  assert.equal(levels['rift-tithe'], 3);
  assert.deepEqual(
    normalizeEquippedRiftRelics(['observer', 'clock-without-hands', 'clock-without-hands', 'loaded-die'], levels),
    ['clock-without-hands', 'loaded-die'],
  );
  assert.equal(RIFT_RELIC_EQUIP_SLOTS, 2);
  assert.equal(RIFT_RELIC_FORKED_EQUIP_SLOTS, 3);
  assert.equal(Object.values(emptyRiftRelicLevels()).every(level => level === 0), true);
});

test('Relic effects require each relic to be owned and equipped within the slot limit', () => {
  const levels = {
    ...emptyRiftRelicLevels(),
    'clock-without-hands': 3,
    'temporal-arbitrage': 3,
    'unlucky-star': 2,
    observer: 3,
    'loaded-die': 3,
    'fracture-cascade': 3,
    'mirror-array': 3,
    'stillness-engine': 3,
    'rift-tithe': 3,
  };
  const inactive = getRiftRelicEffects([], levels);
  assert.equal(inactive.temporalArbitrageEfficiency, 0);
  assert.equal(inactive.completionRewardMultiplier, 1);

  const tempo = getRiftRelicEffects(['clock-without-hands', 'temporal-arbitrage'], levels);
  assert.equal(tempo.temporalDragPenaltyReduction, 0.4);
  assert.equal(tempo.temporalArbitrageEfficiency, 0.2);

  const risk = getRiftRelicEffects(['unlucky-star'], levels);
  assert.equal(risk.luckExcessMultiplier, 0.5);
  assert.equal(risk.completionRewardMultiplier, 2.5);

  assert.equal(getRiftRelicEffects(['observer'], levels).observerRank, 3);
  assert.equal(getRiftRelicEffects(['loaded-die'], levels).loadedDieMultiplier, 40);
  assert.equal(getRiftRelicEffects(['fracture-cascade'], levels).fractureCascadeMultiplier, 1.75);
  assert.equal(getRiftRelicEffects(['mirror-array'], levels).multiballBonus, 3);
  assert.equal(getRiftRelicEffects(['stillness-engine'], levels).noAutomationCooldownReduction, 0.2);
  assert.equal(getRiftRelicEffects(['rift-tithe'], levels).progressCoinBonus, 0.75);

  const overfilled = getRiftRelicEffects(
    ['clock-without-hands', 'temporal-arbitrage', 'unlucky-star', 'observer'],
    levels,
  );
  assert.equal(overfilled.temporalDragPenaltyReduction, 0.4);
  assert.equal(overfilled.completionRewardMultiplier, 1);
  assert.equal(overfilled.observerRank, 0);
});
test('Relic crafting costs both currencies and increases each rank', () => {
  const first = riftRelicCost('clock-without-hands', 0);
  const second = riftRelicCost('clock-without-hands', 1);
  assert.deepEqual(first, { scrap: 120, riftPoints: 1 });
  assert.ok(second.scrap > first.scrap);
  assert.ok(second.riftPoints > first.riftPoints);
});

test('Observer Luck scales logarithmically toward the challenge objective', () => {
  const target = 1_000_000;
  assert.equal(riftObserverLuckMultiplier(1_000, target, 3), 1);
  assert.ok(Math.abs(riftObserverLuckMultiplier(target ** 0.9, target, 3) - 2) < 1e-10);
  assert.ok(Math.abs(riftObserverLuckMultiplier(target ** 0.99, target, 3) - 5) < 1e-10);
});

test('Clock Without Hands and Stillness Engine reduce the remaining Temporal Drag penalty multiplicatively', () => {
  assert.equal(riftEffectiveTemporalDragMultiplier(6, 0.4), 4);
  assert.ok(Math.abs(riftEffectiveTemporalDragMultiplier(6, 0.4, 0.2) - 3.4) < 1e-12);
  assert.equal(riftEffectiveTemporalDragMultiplier(1, 0.4, 0.2), 1);
});

test('Rift Tithe ramps Rift Coin rewards from neutral to its equipped maximum', () => {
  assert.equal(riftRelicProgressCoinMultiplier(2, 1_000_000, 0.75), 1);
  assert.ok(riftRelicProgressCoinMultiplier(1_000, 1_000_000, 0.75) > 1);
  assert.equal(riftRelicProgressCoinMultiplier(1_000_000, 1_000_000, 0.75), 1.75);
});

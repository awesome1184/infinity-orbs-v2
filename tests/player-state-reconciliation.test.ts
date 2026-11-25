import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAcceptPlayerStateSnapshot } from '../src/client/state-reconciliation.js';

const persistedState = {
  saveGeneration: 4,
  stateRevision: 27,
  coins: 1_000,
  shards: 12,
  xp: 400,
  level: 9,
  totalRolls: 120,
  freeRolls: 2,
  highestRarity: 25,
  collectionValue: 3_500,
  prestigeCount: 1,
};

const optimisticUpgradeState = {
  ...persistedState,
  coins: 750,
  upgrades: { luck: 4 },
};

test('same-revision balance changes remain blocked for ordinary delayed reads', () => {
  assert.equal(
    shouldAcceptPlayerStateSnapshot(persistedState, optimisticUpgradeState, 4, 27),
    false,
  );
});

test('an authoritative upgrade recovery can restore a rejected optimistic purchase at the same revision', () => {
  assert.equal(
    shouldAcceptPlayerStateSnapshot(persistedState, optimisticUpgradeState, 4, 27, true),
    true,
  );
});

test('upgrade recovery never permits an older durable revision', () => {
  assert.equal(
    shouldAcceptPlayerStateSnapshot(
      { ...persistedState, stateRevision: 26 },
      optimisticUpgradeState,
      4,
      27,
      true,
    ),
    false,
  );
});

test('newer revisions and newer save generations are accepted', () => {
  assert.equal(
    shouldAcceptPlayerStateSnapshot(
      { ...persistedState, stateRevision: 28 },
      optimisticUpgradeState,
      4,
      27,
    ),
    true,
  );
  assert.equal(
    shouldAcceptPlayerStateSnapshot(
      { ...persistedState, saveGeneration: 5, stateRevision: 0 },
      optimisticUpgradeState,
      4,
      27,
    ),
    true,
  );
});

test('older save generations remain blocked during recovery', () => {
  assert.equal(
    shouldAcceptPlayerStateSnapshot(
      { ...persistedState, saveGeneration: 3, stateRevision: 99 },
      optimisticUpgradeState,
      4,
      27,
      true,
    ),
    false,
  );
});

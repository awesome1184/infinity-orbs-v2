// [TESTER] Malformed daily telemetry markers must not suppress uncapped roll-Shard rewards.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  grantRollShards,
  todayKey,
} from '../src/shared/game.js';

test('malformed daily telemetry cannot block fractional or whole roll-Shard rewards', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  const state = createInitialState(now);
  state.shards = 0;
  state.lastFreeShardReset = 'corrupt-date';
  state.freeShardsEarnedToday = 50;

  const granted = grantRollShards(state, 0.125, now);

  assert.equal(granted, 0.125);
  assert.equal(state.shards, 0.125);
  assert.equal(state.freeShardsEarnedToday, 0.125);
});

test('a valid prior-day marker resets only the Shard telemetry counter', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  const state = createInitialState(now);
  state.shards = 0;
  state.lastFreeShardReset = todayKey(now - 24 * 60 * 60 * 1000);
  state.freeShardsEarnedToday = 50;

  const granted = grantRollShards(state, 0.125, now);

  assert.equal(granted, 0.125);
  assert.equal(state.shards, 0.125);
  assert.equal(state.freeShardsEarnedToday, 0.125);
  assert.equal(state.lastFreeShardReset, todayKey(now));
});

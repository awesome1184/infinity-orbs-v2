// [TESTER] Malformed date markers must not silently reopen a full daily roll-Shard budget.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInitialState,
  grantRollShards,
  FREE_SHARD_DAILY_CAP,
  todayKey,
} from '../src/shared/game.js';

test('a malformed daily reset marker fails closed when the roll-Shard cap is already full', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  const state = createInitialState(now);
  state.shards = 0;
  state.lastFreeShardReset = 'corrupt-date';
  state.freeShardsEarnedToday = FREE_SHARD_DAILY_CAP;

  const granted = grantRollShards(state, FREE_SHARD_DAILY_CAP, now);

  assert.equal(granted, 0);
  assert.equal(state.shards, 0);
  assert.equal(state.freeShardsEarnedToday, FREE_SHARD_DAILY_CAP);
});

test('a valid prior-day marker still resets the daily roll-Shard cap normally', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  const state = createInitialState(now);
  state.shards = 0;
  state.lastFreeShardReset = todayKey(now - 24 * 60 * 60 * 1000);
  state.freeShardsEarnedToday = FREE_SHARD_DAILY_CAP;

  const granted = grantRollShards(state, FREE_SHARD_DAILY_CAP, now);

  assert.equal(granted, FREE_SHARD_DAILY_CAP);
  assert.equal(state.shards, FREE_SHARD_DAILY_CAP);
  assert.equal(state.lastFreeShardReset, todayKey(now));
});

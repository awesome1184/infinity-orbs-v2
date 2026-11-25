import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('retired shared large-value snapshots expire after one minute', () => {
  const storage = source('src/server/redis-large-values.ts');
  assert.match(storage, /const LARGE_VALUE_RETIRED_TTL_SECONDS = 60;/);
  assert.doesNotMatch(storage, /LARGE_VALUE_RETIRED_TTL_SECONDS = 10 \* 60/);
});

test('leaderboard writes are throttled per player and marker commits with the snapshot', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /const LEADERBOARD_PROJECTION_INTERVAL_MS = 60_000;/);
  assert.match(social, /leaderboard:projection-throttle:v1:/);
  const start = social.indexOf('export async function recordLeaderboard(s: PlayerState)');
  const end = social.indexOf('function validateDailyStreakCommunityEvent', start);
  assert.ok(start >= 0 && end > start, 'recordLeaderboard boundaries must exist');
  const writer = social.slice(start, end);
  assert.match(writer, /redis\.watch\(leaderboardKey, throttleKey\)/);
  assert.match(writer, /redis\.get\(throttleKey\)/);
  assert.match(writer, /await txn\.set\(throttleKey,[\s\S]*?expiration:[\s\S]*?LEADERBOARD_PROJECTION_INTERVAL_MS/);
  assert.match(writer, /if \(Number\.isSafeInteger\(existingRevision\) && existingRevision >= next\.stateRevision!\)/);
  assert.ok(writer.indexOf('await txn.set(throttleKey') < writer.indexOf('await txn.exec()'),
    'the throttle marker must commit atomically with the leaderboard pointer');
});

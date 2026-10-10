import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createInitialState,
  predictRollActivation,
  grantRollShards,
  FREE_SHARD_DAILY_CAP,
  todayKey,
} from '../src/shared/game.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('a client prediction can display capped Shards that the server must not grant', () => {
  const now = Date.now();
  const state = createInitialState(now);
  state.shards = 0;
  state.upgrades.shardChance = 1000; // Guarantees a positive predicted proc.
  state.lastFreeShardReset = todayKey(now);
  state.freeShardsEarnedToday = FREE_SHARD_DAILY_CAP;

  const prediction = predictRollActivation(state, 1337, false, 1);

  assert.ok(prediction.shardsGained > 0, 'prediction should show a positive Shard award');
  assert.ok(prediction.state.shards > 0, 'optimistic predicted wallet should increase');

  // Model the authoritative server's cap check using the same grant helper used
  // by applyRolls(). Daily cap is exhausted, so the server wallet remains zero.
  const authoritative = createInitialState(now);
  authoritative.shards = 0;
  authoritative.lastFreeShardReset = todayKey(now);
  authoritative.freeShardsEarnedToday = FREE_SHARD_DAILY_CAP;
  const actuallyGranted = grantRollShards(authoritative, prediction.shardsGained, now);

  assert.equal(actuallyGranted, 0);
  assert.equal(authoritative.shards, 0);
  assert.notEqual(prediction.state.shards, authoritative.shards);
});

test('active client does not apply predicted roll rewards before the response', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const handleRoll = useCallback');
  const end = main.indexOf('// Auto roll watcher', start);
  assert.ok(start >= 0 && end > start, 'handleRoll function must exist');
  const handler = main.slice(start, end);

  assert.doesNotMatch(handler, /predictRollActivation\s*\(/);
  assert.match(handler, /getJson<RollResponse>\('\/api\/roll'/);
  assert.match(handler, /applyPlayerState\(res\.state\)/);
});

test('player snapshots reject older generations/revisions and same-revision Shard changes', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const applyPlayerState = useCallback');
  const end = main.indexOf('\n  }, []);', start);
  assert.ok(start >= 0 && end > start, 'applyPlayerState function must exist');
  const apply = main.slice(start, end);

  assert.match(apply, /!Number\.isSafeInteger\(nextServerGeneration\)[\s\S]*?!Number\.isSafeInteger\(nextServerRevision\)/);
  assert.match(apply, /if \(nextServerGeneration < appliedServerGenerationRef\.current\) return;/);
  assert.match(apply, /if \(nextServerRevision < appliedServerRevisionRef\.current\) return;/);
  assert.match(
    apply,
    /nextServerRevision === appliedServerRevisionRef\.current[\s\S]*?\(nextState\.shards \?\? 0\) !== \(currentState\.shards \?\? 0\)/,
  );
});

test('server snapshots normalize legacy missing revisions and reject malformed revision types', () => {
  const game = source('src/server/game.ts');
  const parserStart = game.indexOf('function parsePlayerStateValue');
  const parserEnd = game.indexOf('\nfunction parsePaymentPlayerState', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'player state parser must exist');
  const parser = game.slice(parserStart, parserEnd);
  assert.match(
    parser,
    /record\.stateRevision == null[\s\S]*?Number\.isSafeInteger\(record\.stateRevision\)/,
  );

  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('export async function getState', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw function must exist');
  const loader = game.slice(loadStart, loadEnd);
  assert.match(loader, /s\.stateRevision = 0;/);
  assert.match(loader, /fresh\.stateRevision = 0;/);
  assert.match(
    loader,
    /stateRevision: Math\.max\(0, Math\.floor\(Number\(parsed\.stateRevision \?\? 0\)\) \|\| 0\)/,
  );
});

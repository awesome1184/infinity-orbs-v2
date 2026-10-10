// [TESTER] Shards reset regression coverage for BOSS Round 69.
// Static source assertions supplement the deterministic helper-level cap scenario.
// They are not an executed React/Express race test.
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

test('prediction can show positive Shards when the authoritative daily cap grants zero', () => {
  const now = Date.now();
  const predictedSource = createInitialState(now);
  predictedSource.shards = 0;
  predictedSource.upgrades.shardChance = 1000; // Test-only setting forces proc chance to 100%.
  predictedSource.lastFreeShardReset = todayKey(now);
  predictedSource.freeShardsEarnedToday = FREE_SHARD_DAILY_CAP;

  const prediction = predictRollActivation(predictedSource, 1337, false, 1);

  assert.ok(prediction.shardsGained > 0);
  assert.ok(prediction.state.shards > 0);

  const authoritative = createInitialState(now);
  authoritative.shards = 0;
  authoritative.lastFreeShardReset = todayKey(now);
  authoritative.freeShardsEarnedToday = FREE_SHARD_DAILY_CAP;

  const granted = grantRollShards(authoritative, prediction.shardsGained, now);
  assert.equal(granted, 0);
  assert.equal(authoritative.shards, 0);

  // Confirm this is the actual source-level divergence the test models:
  // prediction directly adds shards while the server path uses the capped grant helper.
  const shared = source('src/shared/game.ts');
  const server = source('src/server/game.ts');
  assert.match(shared, /s\.shards = Math\.max\(0, \(s\.shards \?\? 0\) \+ shardsGained\)/);
  assert.match(server, /shardsGained = grantRollShards\(s, shardsGained\)/);
});

test('current roll handler does not mutate the wallet with a client prediction', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const handleRoll = useCallback');
  assert.ok(start >= 0, 'handleRoll must exist');
  assert.equal(
    main.includes('predictRollActivation('),
    false,
    'client main must not call the predictive reward simulator',
  );

  const end = main.indexOf('// Auto roll watcher', start);
  assert.ok(end > start, 'roll handler boundary must exist');
  const handler = main.slice(start, end);
  assert.match(handler, /getJson<RollResponse>\('\s*\/api\/roll'/);
  assert.match(handler, /applyPlayerState\(res\.state\)/);
});

test('an old /api/me snapshot cannot replace a newer committed Shard balance', () => {
  // Concrete stale response sequence:
  //   committed roll: generation 7, revision 11, shards 3
  //   delayed /api/me: generation 7, revision 10, shards 0
  // Equal-version conflicting snapshots are rejected too. This test verifies
  // the client source contract; it does not mount React and invoke the callback.
  const committedRoll = { saveGeneration: 7, stateRevision: 11, shards: 3 };
  const delayedMe = { saveGeneration: 7, stateRevision: 10, shards: 0 };
  const sameVersionConflict = { saveGeneration: 7, stateRevision: 11, shards: 0 };
  assert.ok(delayedMe.stateRevision < committedRoll.stateRevision);
  assert.equal(sameVersionConflict.stateRevision, committedRoll.stateRevision);
  assert.notEqual(sameVersionConflict.shards, committedRoll.shards);

  const main = source('src/client/main.tsx');
  const applyStart = main.indexOf('const applyPlayerState = useCallback');
  const refreshStart = main.indexOf('const refreshAll = useCallback');
  assert.ok(applyStart >= 0 && refreshStart > applyStart, 'snapshot application and refresh paths must exist');

  const apply = main.slice(applyStart, main.indexOf('\n  }, []);', applyStart));
  assert.match(apply, /!Number\.isSafeInteger\(nextServerGeneration\)/);
  assert.match(apply, /!Number\.isSafeInteger\(nextServerRevision\)/);
  assert.match(apply, /if \(nextServerGeneration < appliedServerGenerationRef\.current\) return;/);
  assert.match(apply, /if \(nextServerRevision < appliedServerRevisionRef\.current\) return;/);
  assert.match(
    apply,
    /nextServerRevision === appliedServerRevisionRef\.current[\s\S]*?\(nextState\.shards \?\? 0\) !== \(currentState\.shards \?\? 0\)/,
  );

  const refreshEnd = main.indexOf('\n  }, []);', refreshStart);
  assert.ok(refreshEnd > refreshStart, 'refreshAll boundary must exist');
  const refresh = main.slice(refreshStart, refreshEnd);
  assert.match(refresh, /const revisionAtStart = stateRevisionRef\.current/);
  assert.ok(refresh.includes("await getJsonWithTimeout<PlayerState>('/api/me')"));
  assert.match(refresh, /if \(revisionAtStart !== stateRevisionRef\.current\) return;[\s\S]*?applyPlayerState\(me\)/);
});

test('server load validates stored revisions and normalizes legacy/missing revisions', () => {
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
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw must exist');
  const loader = game.slice(loadStart, loadEnd);
  assert.match(loader, /s\.stateRevision = 0;/);
  assert.match(loader, /fresh\.stateRevision = 0;/);
  assert.match(
    loader,
    /stateRevision: Math\.max\(0, Math\.floor\(Number\(parsed\.stateRevision \?\? 0\)\) \|\| 0\)/,
  );
});

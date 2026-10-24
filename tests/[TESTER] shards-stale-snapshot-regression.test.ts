// [TESTER] Fractional Shard reward and stale-snapshot regression coverage.
// Static source assertions supplement deterministic helper-level uncapped scenarios.
// They are not an executed React/Express race test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createInitialState,
  predictRollActivation,
  grantRollShards,
  todayKey,
} from '../src/shared/game.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('prediction and authoritative grant both preserve fractional Shards beyond the old daily cap', () => {
  const now = Date.now();
  const predictedSource = createInitialState(now);
  predictedSource.shards = 0;
  predictedSource.upgrades.shardChance = 1000; // Test-only setting forces proc chance to 100%.
  predictedSource.lastFreeShardReset = todayKey(now);
  predictedSource.freeShardsEarnedToday = 50;

  const prediction = predictRollActivation(predictedSource, 1337, false, 1);

  assert.ok(prediction.shardsGained >= 0.001);
  assert.equal(prediction.state.shards, prediction.shardsGained);
  assert.ok(prediction.state.freeShardsEarnedToday > 50);

  const authoritative = createInitialState(now);
  authoritative.shards = 0;
  authoritative.lastFreeShardReset = todayKey(now);
  authoritative.freeShardsEarnedToday = 50;

  const granted = grantRollShards(authoritative, prediction.shardsGained, now);
  assert.equal(granted, prediction.shardsGained);
  assert.equal(authoritative.shards, prediction.shardsGained);
  assert.ok(authoritative.freeShardsEarnedToday > 50);

  // Both paths must use the same helper so the UI agrees with the uncapped wallet.
  const shared = source('src/shared/game.ts');
  const server = source('src/server/game.ts');
  assert.match(shared, /shardsGained = grantRollShards\(s, shardsGained, predictionNow\)/);
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
  const requestIndex = handler.indexOf("getJson<RollResponse>('/api/roll'");
  const applyIndex = handler.indexOf('applyPlayerState(res.state)', requestIndex);
  assert.ok(requestIndex >= 0 && applyIndex > requestIndex, 'authoritative state is applied after the roll response');
  assert.doesNotMatch(
    handler.slice(requestIndex, applyIndex),
    /setBatchSummary\s*\(|setLastOrb\s*\(|setLastBatch\s*\(/,
    'roll result UI must not apply predicted rewards before the server response',
  );
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

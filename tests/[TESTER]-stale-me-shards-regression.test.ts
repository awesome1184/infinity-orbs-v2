import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('normal roll Shards use the committed server result and the server daily cap', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const handleRoll = useCallback');
  const end = main.indexOf('\n  }, [', start);
  assert.ok(start >= 0 && end > start, 'handleRoll callback must exist');
  const roll = main.slice(start, end);

  const requestIndex = roll.indexOf("getJson<RollResponse>('/api/roll'");
  const applyIndex = roll.indexOf('applyPlayerState(res.state)', requestIndex);
  assert.ok(requestIndex >= 0 && applyIndex > requestIndex, 'normal roll must apply the response state after the API request');
  assert.doesNotMatch(roll, /predictRollActivation\s*\(/, 'roll handler must not show predicted rewards before the server responds');
  assert.doesNotMatch(roll.slice(requestIndex, applyIndex), /setBatchSummary\s*\(|setLastOrb\s*\(|setLastBatch\s*\(/, 'roll result UI must wait for the authoritative response');

  const server = source('src/server/game.ts');
  assert.match(server, /shardsGained = grantRollShards\(s, shardsGained\)/, 'server roll settlement must pass Shards through the daily cap');
  const shared = source('src/shared/game.ts');
  const grantStart = shared.indexOf('export function grantRollShards(');
  const grantEnd = shared.indexOf('\nexport function ', grantStart + 1);
  assert.ok(grantStart >= 0 && grantEnd > grantStart, 'grantRollShards must exist');
  const grant = shared.slice(grantStart, grantEnd);
  assert.match(grant, /FREE_SHARD_DAILY_CAP/);
  assert.match(grant, /Math\.min\(amount, available\)/, 'the authoritative grant must clamp against remaining daily allowance');
});

test('delayed initial /api/me response cannot overwrite a newer player snapshot', () => {
  const main = source('src/client/main.tsx');
  const refreshStart = main.indexOf('const refreshAll = useCallback(async () => {');
  const refreshEnd = main.indexOf('\n  }, []);', refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'refreshAll callback must exist');
  const refresh = main.slice(refreshStart, refreshEnd);

  const captureIndex = refresh.indexOf('const revisionAtStart = stateRevisionRef.current');
  const readIndex = refresh.indexOf("await getJsonWithTimeout<PlayerState>('/api/me')");
  const staleFenceIndex = refresh.indexOf('if (revisionAtStart !== stateRevisionRef.current) return;');
  const applyIndex = refresh.indexOf('applyPlayerState(me)');
  assert.ok(captureIndex >= 0 && captureIndex < readIndex, 'refresh must capture the client revision before issuing /api/me');
  assert.ok(readIndex < staleFenceIndex && staleFenceIndex < applyIndex, 'late /api/me result must be fenced before it can replace client state');

  const applyStart = main.indexOf('const applyPlayerState = useCallback');
  const applyEnd = main.indexOf('// Mutations are optimistic', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart, 'authoritative state applier must exist');
  const applier = main.slice(applyStart, applyEnd);
  assert.match(applier, /nextServerGeneration < appliedServerGenerationRef\.current/, 'older save generations must be ignored');
  assert.match(applier, /nextServerRevision < appliedServerRevisionRef\.current/, 'older revisions within a generation must be ignored');
  assert.match(applier, /stateRevisionRef\.current \+= 1;\s*setState\(mergedState\)/, 'accepted newer snapshots must invalidate in-flight initial reads');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { configureDevvitRuntime } from '../src/server/devvit-mock.js';
import { getArenaStatus, joinArenaQueue, leaveArenaQueue } from '../src/server/arena.js';

const values = new Map<string, string>();
const revisions = new Map<string, number>();
function bump(key: string) { revisions.set(key, (revisions.get(key) ?? 0) + 1); }
let userId = 'arena-player-a';

const redisMock = {
  get: async (key: string) => values.get(key) ?? null,
  set: async (key: string, value: string) => { values.set(key, value); bump(key); return 'OK'; },
  watch: async (...keys: string[]) => {
    const observed = new Map(keys.map(key => [key, revisions.get(key) ?? 0]));
    const writes: Array<{ key: string; value: string }> = [];
    return {
      multi: async () => undefined,
      set: async (key: string, value: string) => { writes.push({ key, value }); return 'QUEUED'; },
      exec: async () => {
        for (const key of keys) {
          if ((revisions.get(key) ?? 0) !== observed.get(key)) return null;
        }
        for (const write of writes) { values.set(write.key, write.value); bump(write.key); }
        return [];
      },
      unwatch: async () => undefined,
    };
  },
};
function useUser(id: string) {
  userId = id;
  configureDevvitRuntime({ redis: redisMock, context: { userId }, reddit: {} });
}
useUser(userId);

test('Arena queue matches two distinct players and stores private results per player', async () => {
  values.clear();
  revisions.clear();
  useUser('arena-player-a');
  const firstQueued = await joinArenaQueue();
  assert.equal(firstQueued.status, 'queued');
  assert.equal(firstQueued.queueSize, 1);

  useUser('arena-player-b');
  const secondJoin = await joinArenaQueue();
  assert.equal(secondJoin.status, 'matched');
  assert.equal(secondJoin.matches, 1);
  assert.ok(secondJoin.lastMatch);
  assert.equal(secondJoin.lastMatch?.opponentAlias.startsWith('Delver '), true);
  assert.equal(JSON.stringify(secondJoin.lastMatch).includes('arena-player-a'), false);

  useUser('arena-player-a');
  const firstResult = await getArenaStatus();
  assert.equal(firstResult.status, 'matched');
  assert.equal(firstResult.matches, 1);
  assert.equal(firstResult.lastMatch?.opponentAlias.startsWith('Delver '), true);
  assert.ok(['win', 'loss', 'draw'].includes(firstResult.lastMatch?.outcome ?? ''));
});

test('Arena queue joins are idempotent and leaving removes only the current player', async () => {
  values.clear();
  revisions.clear();
  useUser('arena-queue-only');
  const joined = await joinArenaQueue();
  const repeated = await joinArenaQueue();
  assert.equal(joined.status, 'queued');
  assert.equal(repeated.status, 'queued');
  assert.equal(repeated.queueSize, 1);
  assert.equal(repeated.queuePosition, 1);

  const left = await leaveArenaQueue();
  assert.equal(left.status, 'idle');
  assert.equal(left.queueSize, 0);
});

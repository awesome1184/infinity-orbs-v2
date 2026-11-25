import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGameBanRegistry, parseGameBanStatus } from '../src/server/game-ban-registry.js';

const activeBan = {
  userId: 'user-1',
  username: 'player-one',
  bannedAt: 1_000,
  bannedUntil: null,
  reason: 'test',
  bannedBy: 'admin',
};

test('game-ban status returns null for an absent registry and an unlisted user', () => {
  assert.equal(parseGameBanStatus(null, 'user-1', 2_000), null);
  assert.equal(parseGameBanStatus(JSON.stringify({}), 'user-1', 2_000), null);
});

test('game-ban status returns an active ban for the requested user', () => {
  assert.deepEqual(parseGameBanStatus(JSON.stringify({ 'user-1': activeBan }), 'user-1', 2_000), {
    ...activeBan,
    active: true,
  });
});

test('expired game bans read as inactive without mutating the registry', () => {
  const registry = { 'user-1': { ...activeBan, bannedUntil: 1_500 } };
  const raw = JSON.stringify(registry);
  assert.equal(parseGameBanStatus(raw, 'user-1', 2_000), null);
  assert.equal(raw, JSON.stringify(registry));
});

test('a malformed unrelated ban row does not block another player', () => {
  const registry = {
    'user-1': activeBan,
    'user-2': { userId: 'wrong-id', username: '', bannedAt: 'bad' },
  };
  assert.deepEqual(parseGameBanStatus(registry, 'user-1', 2_000), { ...activeBan, active: true });
});

test('a malformed record for the requesting user still fails closed', () => {
  const malformed = { ...activeBan, userId: 'wrong-id' };
  assert.throws(() => parseGameBanStatus({ 'user-1': malformed }, 'user-1', 2_000), /malformed record/i);
});

test('a malformed registry root still fails closed', () => {
  assert.throws(() => parseGameBanStatus('not-json', 'user-1', 2_000), /could not be read safely/i);
  assert.throws(() => parseGameBanStatus('[]', 'user-1', 2_000), /could not be read safely/i);
});

test('strict full-registry operations still reject malformed rows', () => {
  assert.throws(() => parseGameBanRegistry({
    'user-1': activeBan,
    'user-2': { userId: 'wrong-id' },
  }), /malformed record/i);
});

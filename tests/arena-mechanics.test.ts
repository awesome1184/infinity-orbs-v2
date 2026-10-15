import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaRatingDelta, simulateArenaDuel } from '../src/shared/arena.js';
import type { ArenaFighter } from '../src/shared/arena.js';

function fighter(userId: string, overrides: Partial<ArenaFighter> = {}): ArenaFighter {
  return {
    userId,
    alias: userId,
    rating: 1000,
    level: 1,
    bestDepth: 1,
    stats: { damage: 20, speed: 300, maxHealth: 100, critChance: 0, damageReduction: 0, coinMultiplier: 1 },
    weaponTrait: null,
    armorTrait: null,
    ...overrides,
  };
}

test('arena rating rewards an upset more than an expected win', () => {
  const upset = arenaRatingDelta(800, 1400, 1);
  const expected = arenaRatingDelta(1400, 800, 1);
  assert.ok(upset > expected);
  assert.ok(upset > 0);
  assert.ok(arenaRatingDelta(1200, 1200, 0.5) === 0);
});

test('arena duel resolves with server-derived combat stats and keeps health bounded', () => {
  const strong = fighter('strong', {
    stats: { damage: 90, speed: 800, maxHealth: 500, critChance: 0.1, damageReduction: 0.1, coinMultiplier: 1 },
  });
  const weak = fighter('weak', {
    stats: { damage: 8, speed: 100, maxHealth: 100, critChance: 0, damageReduction: 0, coinMultiplier: 1 },
  });
  const result = simulateArenaDuel(strong, weak, () => 0.99);
  assert.equal(result.winnerUserId, 'strong');
  assert.ok(result.healthA >= 0 && result.healthA <= result.maxHealthA);
  assert.ok(result.healthB >= 0 && result.healthB <= result.maxHealthB);
  assert.ok(result.rounds >= 1 && result.rounds <= 50);
});

test('arena duel has a hard round limit and breaks exact health ties', () => {
  const a = fighter('a', { stats: { damage: 1, speed: 100, maxHealth: 100, critChance: 0, damageReduction: 0, coinMultiplier: 1 } });
  const b = fighter('b', { stats: { damage: 1, speed: 100, maxHealth: 100, critChance: 0, damageReduction: 0, coinMultiplier: 1 } });
  const result = simulateArenaDuel(a, b, () => 0.5);
  assert.equal(result.rounds, 50);
  assert.equal(result.winnerUserId, null);
});

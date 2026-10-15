import assert from 'node:assert/strict';
import test from 'node:test';
import { tickCombatGuard } from '../src/shared/combat.js';

test('Guard stays armed when no enemy action resolves during the beat', () => {
  assert.equal(tickCombatGuard(1, 0), 1);
});

test('Guard expires after the enemy gets an action', () => {
  assert.equal(tickCombatGuard(1, 1), 0);
});

test('Guard carries into the next room when the enemy is defeated before acting', () => {
  assert.equal(tickCombatGuard(1, 2, true), 1);
});

test('Guard is beat-based and decrements once even when multiple enemy actions resolve', () => {
  assert.equal(tickCombatGuard(2, 3), 1);
});

test('Guard ticking clamps invalid or exhausted values safely', () => {
  assert.equal(tickCombatGuard(0, 2), 0);
  assert.equal(tickCombatGuard(-2, 1), 0);
  assert.equal(tickCombatGuard(Number.NaN, 1), 0);
  assert.equal(tickCombatGuard(1, Number.NaN), 1);
});

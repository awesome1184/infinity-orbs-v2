import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatNumber } from '../src/shared/game.js';

test('large coin balances use exponential notation at the 64-bit integer scale', () => {
  assert.equal(formatNumber(9.223372036854776e18), '9.22e18');
  assert.equal(formatNumber(Number.MAX_SAFE_INTEGER), '9.01e15');
});

test('the primary coin wallet uses the shared compact number formatter', () => {
  const header = readFileSync(resolve(process.cwd(), 'src/client/components/Header.tsx'), 'utf8');
  assert.match(header, /formatNumber\(state\.coins\)/);
  assert.doesNotMatch(header, /fmt\(state\.coins\)/);
});

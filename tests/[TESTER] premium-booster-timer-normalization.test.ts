// [TESTER] Persisted Premium Booster timers must be bounded numeric timestamps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createInitialState,
  isPremiumBoosterActive,
  premiumBoosterRemainingMs,
} from '../src/shared/game.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('malformed or unsafe persisted Premium Booster timers do not activate bonuses', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  const state = createInitialState(now);
  state.activeBoosters = {
    fortune: '9999999999999' as unknown as number,
    ascension: 1e308,
  };

  assert.equal(isPremiumBoosterActive(state, 'fortune', now), false);
  assert.equal(isPremiumBoosterActive(state, 'ascension', now), false);
  assert.equal(premiumBoosterRemainingMs(state, 'fortune', now), 0);
  assert.equal(premiumBoosterRemainingMs(state, 'ascension', now), 0);
});

test('loadRaw sanitizes the nested Premium Booster timer map before applying effects', () => {
  const game = source('src/server/game.ts');
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('\nfunction applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw boundary must exist');
  const loader = game.slice(loadStart, loadEnd);
  assert.match(
    loader,
    /activeBoosters:\s*normalizeActiveBoosters\(parsed\.activeBoosters/,
    'corrupted nested timer values must not survive the parsed-state spread',
  );

  const shared = source('src/shared/game.ts');
  const activeStart = shared.indexOf('export function isPremiumBoosterActive');
  const activeEnd = shared.indexOf('\nexport function premiumBoosterRemainingMs', activeStart);
  assert.ok(activeStart >= 0 && activeEnd > activeStart, 'active helper boundary must exist');
  const activeHelper = shared.slice(activeStart, activeEnd);
  assert.match(
    activeHelper,
    /typeof expiry === 'number'[\s\S]*?Number\.isSafeInteger\(expiry\)/,
    'shared helper must reject string-coerced and unsafe timers defensively',
  );
});


test('the saved Turbo Roll expiry is normalized and cannot be extended from malformed data', () => {
  const shared = source('src/shared/game.ts');
  const cooldownStart = shared.indexOf('export function cooldownMs');
  const cooldownEnd = shared.indexOf('\nexport function rollsPerActivation', cooldownStart);
  assert.ok(cooldownStart >= 0 && cooldownEnd > cooldownStart, 'cooldownMs boundary must exist');
  const cooldown = shared.slice(cooldownStart, cooldownEnd);
  assert.match(
    cooldown,
    /typeof s\.turboRollUntil === 'number'[\s\S]*?Number\.isSafeInteger\(s\.turboRollUntil\)/,
    'a string/unsafe future date must not activate Turbo Roll cooldown reduction',
  );

  const game = source('src/server/game.ts');
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('\nfunction applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw boundary must exist');
  const loader = game.slice(loadStart, loadEnd);
  assert.match(
    loader,
    /turboRollUntil:\s*finiteNonNegativeInteger\(parsed\.turboRollUntil/,
    'stored Turbo Roll expiry must not survive without validation',
  );
});

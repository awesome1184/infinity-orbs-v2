// [TESTER] Persisted Premium Booster timers must be bounded numeric timestamps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createInitialState,
  isPremiumBoosterActive,
  premiumBoosterRemainingMs,
  frenzyCooldownRemaining,
  frenzyClaimCooldownRemaining,
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


test('malformed stored Frenzy cooldown timestamps cannot bypass owner/claim limits', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);

  // Missing is valid for a new account, but present malformed data must not
  // be interpreted as "never used" and grant another external Frenzy action.
  assert.equal(frenzyCooldownRemaining(undefined, now), 0);
  assert.equal(frenzyClaimCooldownRemaining(undefined, now), 0);
  assert.ok(frenzyCooldownRemaining('corrupt' as unknown as number, now) > 0);
  assert.ok(frenzyClaimCooldownRemaining('corrupt' as unknown as number, now) > 0);

  const game = source('src/server/game.ts');
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('\nfunction applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw boundary must exist');
  const loader = game.slice(loadStart, loadEnd);
  assert.match(loader, /lastFrenzyAt:\s*[^,\n]*normalize|lastFrenzyAt:\s*finiteNonNegativeInteger/);
  assert.match(loader, /lastFrenzyClaimAt:\s*[^,\n]*normalize|lastFrenzyClaimAt:\s*finiteNonNegativeInteger/);
});


test('malformed lastShareAt cannot bypass the anti-spam guard before a Reddit post', () => {
  const game = source('src/server/game.ts');
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('\nfunction applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw boundary must exist');
  const loader = game.slice(loadStart, loadEnd);
  assert.match(
    loader,
    /lastShareAt:\s*[^,\n]*finiteNonNegativeInteger/,
    'lastShareAt must be sanitized before the API uses its cooldown',
  );

  const shareStart = game.indexOf('export async function recordShareAction');
  const shareEnd = game.indexOf('\nexport async function ', shareStart + 1);
  assert.ok(shareStart >= 0 && shareEnd > shareStart, 'recordShareAction boundary must exist');
  const share = game.slice(shareStart, shareEnd);
  assert.match(
    share,
    /Number\.isSafeInteger\(s\.lastShareAt\)[\s\S]*?30_000/,
    'share cooldown must fail closed for a malformed timestamp',
  );
});

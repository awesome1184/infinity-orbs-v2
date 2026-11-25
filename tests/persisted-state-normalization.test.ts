// [BOSS][TESTER] Regression coverage for malformed persisted automation flags and timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createInitialState,
  normalizeActiveBoosters,
  normalizeAutomations,
  isPremiumBoosterActive,
  premiumBoosterRemainingMs,
  cooldownMs,
  frenzyCooldownRemaining,
  frenzyClaimCooldownRemaining,
} from '../src/shared/game.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function loadRawBody(game: string): string {
  const start = game.indexOf('export async function loadRaw');
  const end = game.indexOf('\nexport async function getState', start);
  assert.ok(start >= 0 && end > start, 'loadRaw must have a current-source boundary');
  return game.slice(start, end);
}

test('automation flags accept strict true only, not truthy strings or numbers', () => {
  assert.deepEqual(normalizeAutomations({
    autoQuestClaim: 'false',
    autoStreakClaim: true,
    autoCommunityClaim: 1,
    autoOfflineClaim: 'true',
    autoUpgrade: false,
  }), {
    autoQuestClaim: false,
    autoStreakClaim: true,
    autoCommunityClaim: false,
    autoOfflineClaim: false,
    autoUpgrade: false,
  });

  const game = source('src/server/game.ts');
  const loader = loadRawBody(game);
  assert.match(loader, /automations:\s*normalizeAutomations\(parsed\.automations\)/);
  const start = game.indexOf('async function processAutomation');
  const end = game.indexOf('\nfunction flairTextColorForBackground', start);
  assert.ok(start >= 0 && end > start, 'processAutomation must exist');
  assert.match(game.slice(start, end), /s\.automations\?\.autoStreakClaim === true/);
  assert.match(game.slice(start, end), /s\.automations\?\.autoQuestClaim === true/);
  assert.match(game.slice(start, end), /s\.automations\?\.autoCommunityClaim === true/);
  assert.match(game.slice(start, end), /s\.automations\?\.autoOfflineClaim === true/);
  assert.match(game.slice(start, end), /s\.automations\?\.autoUpgrade === true/);
});

test('Premium Booster timers reject string, fractional, negative, and unsafe expiries', () => {
  assert.deepEqual(normalizeActiveBoosters({
    fortune: 123456,
    hyperdrive: '9999999999999',
    ascension: 1e308,
    prosperity: -1,
    barrage: 1.5,
  }), { fortune: 123456 });

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

  const game = source('src/server/game.ts');
  const loader = loadRawBody(game);
  assert.match(loader, /activeBoosters:\s*normalizeActiveBoosters\(parsed\.activeBoosters\)/);
  assert.match(loader, /automations:\s*normalizeAutomations\(parsed\.automations\)/);
});

test('malformed Turbo Roll expiry cannot shorten the actual cooldown', () => {
  const now = Date.now();
  const baseline = createInitialState(now);
  baseline.turboRollUntil = 0;
  const baselineCooldown = cooldownMs(baseline);

  const asString = createInitialState(now);
  asString.turboRollUntil = '9999999999999' as unknown as number;
  assert.equal(cooldownMs(asString), baselineCooldown);

  const unsafe = createInitialState(now);
  unsafe.turboRollUntil = 1e308;
  assert.equal(cooldownMs(unsafe), baselineCooldown);

  const game = source('src/server/game.ts');
  const loader = loadRawBody(game);
  assert.match(loader, /turboRollUntil:\s*normalizeSafeInteger\(parsed\.turboRollUntil,\s*base\.turboRollUntil\)/);
  const shared = source('src/shared/game.ts');
  const cooldownStart = shared.indexOf('export function cooldownMs');
  const cooldownEnd = shared.indexOf('\nexport function rollsPerActivation', cooldownStart);
  assert.ok(cooldownStart >= 0 && cooldownEnd > cooldownStart, 'cooldownMs boundary must exist');
  assert.match(
    shared.slice(cooldownStart, cooldownEnd),
    /typeof s\.turboRollUntil === 'number'[\s\S]*?Number\.isSafeInteger\(s\.turboRollUntil\)/,
  );
});

test('malformed persisted Frenzy timestamps cannot bypass the post or claim cooldown', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  assert.equal(frenzyCooldownRemaining(undefined, now), 0);
  assert.equal(frenzyClaimCooldownRemaining(undefined, now), 0);
  assert.ok(frenzyCooldownRemaining('corrupt' as unknown as number, now) > 0);
  assert.ok(frenzyClaimCooldownRemaining('corrupt' as unknown as number, now) > 0);

  const game = source('src/server/game.ts');
  const loader = loadRawBody(game);
  assert.match(loader, /lastFrenzyAt:\s*normalizeCooldownTimestamp\(parsed\.lastFrenzyAt/);
  assert.match(loader, /lastFrenzyClaimAt:\s*normalizeCooldownTimestamp\(parsed\.lastFrenzyClaimAt/);
  assert.match(loader, /lastShareAt:\s*normalizeCooldownTimestamp\(parsed\.lastShareAt/);
});

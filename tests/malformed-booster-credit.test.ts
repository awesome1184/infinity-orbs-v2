// [TESTER] Regression assertions for malformed saved Global Booster credits.
// Strict saved-credit validation now protects both load and activation paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('loadRaw normalizes malformed Global Booster credit balances', () => {
  const game = source('src/server/game.ts');
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('\nfunction applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw boundary must exist');
  const loader = game.slice(loadStart, loadEnd);

  assert.match(
    loader,
    /globalBoosterCredits:\s*normalizeSafeInteger\(parsed\.globalBoosterCredits,\s*base\.globalBoosterCredits/,
    'a string/NaN/unsafe stored balance must not survive cleanParsed into the active PlayerState',
  );
});

test('credit activation rejects malformed balances before touching shared Booster state', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function claimWorldBoosterActivation');
  const end = game.indexOf('\nexport async function activateGlobalBooster', start);
  assert.ok(start >= 0 && end > start, 'claimWorldBoosterActivation boundary must exist');
  const claim = game.slice(start, end);
  const creditBranch = claim.indexOf('if (useCredit)');
  const sharedActivation = claim.indexOf('await prepareGlobalBoosterActivation');
  assert.ok(creditBranch >= 0 && sharedActivation > creditBranch);

  const guard = claim.slice(creditBranch, sharedActivation);
  assert.match(
    guard,
    /Number\.isSafeInteger\(creditBalance\)[\s\S]*?\(creditBalance as number\)\s*<\s*0/,
    'reject malformed/non-integer credits before comparison and decrement',
  );
  assert.match(
    guard,
    /s\.globalBoosterCredits\s*=\s*\(creditBalance as number\)\s*-\s*1/,
    'decrement only a validated numeric credit balance',
  );
});

// [BOSS][TESTER] Regression contracts for persisted counters that must stay in safe numeric domains.
// These are source-contract checks, supplemented by examples of unsafe JavaScript integer behavior.
// Run in a real Node >=24 checkout with npm test; the project test suite has not yet run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function loadRawBody(game: string): string {
  const start = game.indexOf('export async function loadRaw');
  const end = game.indexOf('\nexport async function getState', start);
  assert.ok(start >= 0 && end > start, 'loadRaw must have a current-source boundary');
  return game.slice(start, end);
}

test('corrupt offline-roll counters are clamped before automation or manual claims process a batch', () => {
  const rollCount = 1e308;
  let counter = 2 ** 53;
  const beforeIncrement = counter;
  counter += 1;
  assert.equal(counter, beforeIncrement, 'JavaScript cannot increment an integer past 2^53 by one');
  assert.equal(counter < rollCount, true, 'an unchecked enormous count could keep a batch loop running');

  const game = source('src/server/game.ts');
  const loader = loadRawBody(game);
  assert.match(
    loader,
    /offlineRolls:\s*Math\.min\(MAX_OFFLINE_ROLLS,\s*finiteNonNegativeInteger\(parsed\.offlineRolls,\s*base\.offlineRolls\)\)/,
    'loadRaw must clamp the persisted offline vault to its supported range',
  );

  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('\nfunction flairTextColorForBackground', automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart, 'processAutomation must exist');
  assert.match(
    game.slice(automationStart, automationEnd),
    /Number\.isSafeInteger\(s\.offlineRolls\)[\s\S]*?offlineRollCap\(s\)[\s\S]*?applyRolls\(s, batches/,
    'automatic claims must validate and cap batches before applying rolls',
  );

  const claimStart = game.indexOf('export async function claimOffline');
  const claimEnd = game.indexOf('\nexport async function buyUpgrade', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart, 'claimOffline must exist');
  assert.match(
    game.slice(claimStart, claimEnd),
    /Number\.isSafeInteger\(s\.offlineRolls\)[\s\S]*?offlineRollCap\(s\)[\s\S]*?applyRolls\(s, batches/,
    'manual claims need the same counter protection independently of automation',
  );
});


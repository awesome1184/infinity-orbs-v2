// [TESTER] Corrupt offline-roll counters must be bounded before any batch loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('an impossible offline-roll count can never reach the Orb loop', () => {
  const rollCount = 1e308;
  let i = 2 ** 53;
  const beforeIncrement = i;
  i++;
  assert.equal(i, beforeIncrement, 'JavaScript cannot increment an integer past 2^53 by one');
  assert.equal(i < rollCount, true, 'the Orb loop condition remains true for the malformed count');

  const game = source('src/server/game.ts');
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('\nfunction applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw boundary must exist');
  const loader = game.slice(loadStart, loadEnd);
  assert.match(
    loader,
    /offlineRolls\s*:\s*[^,\n]*(?:offlineRollCap|finiteNonNegativeInteger)/,
    'loadRaw must normalize offlineRolls instead of preserving arbitrary values via cleanParsed',
  );

  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('\nfunction flairTextColorForBackground', automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart, 'processAutomation boundary must exist');
  const automation = game.slice(automationStart, automationEnd);
  assert.match(
    automation,
    /Number\.isSafeInteger\(s\.offlineRolls\)[\s\S]*?offlineRollCap\(s\)[\s\S]*?applyRolls\(s, batches/,
    'auto-offline claims must reject or cap malformed values before applyRolls',
  );
});

test('manual offline claim bounds its batch independently of the automation path', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOffline');
  const end = game.indexOf('\nexport async function buyUpgrade', start);
  assert.ok(start >= 0 && end > start, 'claimOffline boundary must exist');
  const claim = game.slice(start, end);
  assert.match(
    claim,
    /Number\.isSafeInteger\(s\.offlineRolls\)[\s\S]*?offlineRollCap\(s\)[\s\S]*?applyRolls\(s, batches/,
    'manual offline claim must not trust an arbitrary stored batch size',
  );
});

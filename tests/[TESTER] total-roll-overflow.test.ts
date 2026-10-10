// [TESTER] Boundary regression: a valid total-roll counter must never be persisted as unsafe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('two-orb activation at MAX_SAFE_INTEGER - 1 exposes the parser-bricking boundary', () => {
  let totalRolls = Number.MAX_SAFE_INTEGER - 1;
  totalRolls += 1;
  assert.equal(Number.isSafeInteger(totalRolls), true);
  totalRolls += 1;
  assert.equal(totalRolls, 9007199254740992);
  assert.equal(Number.isSafeInteger(totalRolls), false);

  const game = source('src/server/game.ts');
  const applyStart = game.indexOf('async function applyRolls');
  const applyEnd = game.indexOf('\nexport async function roll(', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart, 'authoritative applyRolls boundary must exist');
  const apply = game.slice(applyStart, applyEnd);

  assert.match(
    apply,
    /Number\.MAX_SAFE_INTEGER\s*-\s*s\.totalRolls/,
    'the server must preflight the full processed Orb count against the remaining safe counter capacity',
  );
  assert.match(
    apply,
    /Number\.isSafeInteger\(s\.totalRolls\)/,
    'the persisted counter must be a safe integer before per-Orb increments begin',
  );
});

test('save refuses any core totalRolls value its own parser would reject', () => {
  const game = source('src/server/game.ts');
  const saveStart = game.indexOf('export async function save(');
  const saveEnd = game.indexOf('\nexport async function loadRaw', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart, 'save boundary must exist');
  const save = game.slice(saveStart, saveEnd);

  assert.match(
    save,
    /Number\.isSafeInteger\(s\.totalRolls\)[\s\S]*?Number\.MAX_SAFE_INTEGER/,
    'save must fail closed rather than persist a counter loadRaw would later reject',
  );
});

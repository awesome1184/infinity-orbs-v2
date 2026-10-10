// [TESTER] Regression for unbounded Singularity Tithe lifetime-roll counters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('an out-of-range Tithe counter cannot stop advancing and suppress Dust forever', () => {
  const before = Math.max(0, Math.floor(1e308));
  const rollCount = 200;
  const after = before + rollCount;
  const milestonesBefore = Math.floor(before / 200);
  const milestonesAfter = Math.floor(after / 200);
  const dustEarned = Math.max(0, milestonesAfter - milestonesBefore);

  assert.equal(after, before);
  assert.equal(dustEarned, 0);

  const game = source('src/server/game.ts');
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('\nfunction applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw boundary must exist');
  const loader = game.slice(loadStart, loadEnd);
  assert.match(
    loader,
    /singularityTitheSingleRolls:\s*finiteNonNegativeInteger\(parsed\.singularityTitheSingleRolls/,
    'Tithe lifetime-roll counter must be normalized to a supported integer range',
  );

  const applyStart = game.indexOf('async function applyRolls');
  const applyEnd = game.indexOf('\nexport async function roll(', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart, 'applyRolls boundary must exist');
  const apply = game.slice(applyStart, applyEnd);
  assert.match(
    apply,
    /Number\.isSafeInteger\(s\.singularityTitheSingleRolls\)/,
    'counter must be validated before it is used in milestone arithmetic',
  );
});

test('Frenzy reward progression validates the same Tithe counter invariant', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOrbFrenzy');
  const end = game.indexOf('\n\nfunction sampleBinomial', start);
  assert.ok(start >= 0 && end > start, 'claimOrbFrenzy boundary must exist');
  const claim = game.slice(start, end);
  const titheAt = claim.indexOf('singularityTitheSingleRolls');
  assert.ok(titheAt >= 0, 'Frenzy claim must account for Tithe progress');
  const beforeTithe = claim.slice(Math.max(0, titheAt - 600), titheAt + 700);
  assert.match(
    beforeTithe,
    /Number\.isSafeInteger\(s\.singularityTitheSingleRolls\)/,
    'Frenzy must not diverge from normal roll validation for the shared Tithe counter',
  );
});

// [TESTER] Persisted automation flags must be strict booleans, not truthy coercions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('loadRaw discards malformed automation values instead of treating strings as enabled', () => {
  // These JS semantics are why the schema guard is needed.
  assert.equal(Boolean('false'), true);
  assert.equal(Boolean('0'), true);

  const game = source('src/server/game.ts');
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('\nfunction applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadRaw boundary must exist');
  const loader = game.slice(loadStart, loadEnd);

  assert.match(
    loader,
    /automations:\s*normalizeAutomations\(parsed\.automations/,
    'automations must be reconstructed from recognized keys and strict boolean values',
  );

  const shared = source('src/shared/game.ts');
  assert.match(
    shared,
    /export const AUTOMATIONS:\s*Record<AutomationId,/,
    'the canonical automation allowlist remains available for normalization',
  );
});

test('automation processing checks only validated boolean flags', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function processAutomation');
  const end = game.indexOf('\nfunction flairTextColorForBackground', start);
  assert.ok(start >= 0 && end > start, 'processAutomation boundary must exist');
  const automation = game.slice(start, end);

  assert.match(automation, /s\.automations\?\.autoStreakClaim === true/);
  assert.match(automation, /s\.automations\?\.autoQuestClaim === true/);
  assert.match(automation, /s\.automations\?\.autoCommunityClaim === true/);
  assert.match(automation, /s\.automations\?\.autoOfflineClaim === true/);
  assert.match(automation, /s\.automations\?\.autoUpgrade === true/);
});

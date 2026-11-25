import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { calculateCosmicDust, createInitialState } from '../src/shared/game.js';

const source = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Cosmic Dust prestige earnings have no 50-Dust gameplay cap', () => {
  const state = createInitialState();
  state.collectionValue = 300_000_000;

  assert.equal(calculateCosmicDust(state), 58);
  for (const balance of [49, 50, 51, 100, 10_000]) {
    state.cosmicDust = balance;
    assert.equal(calculateCosmicDust(state), 58, `existing balance ${balance} must not reduce new prestige earnings`);
  }
});

test('Cosmic Dust earnings respect only the safe-integer storage boundary', () => {
  const state = createInitialState();
  state.collectionValue = 300_000_000;

  state.cosmicDust = Number.MAX_SAFE_INTEGER - 10;
  assert.equal(calculateCosmicDust(state), 10);
  state.cosmicDust = Number.MAX_SAFE_INTEGER;
  assert.equal(calculateCosmicDust(state), 0);
});

test('Prestige and Astral Forge do not enforce the old 50-Dust cap', () => {
  const shared = source('src/shared/game.ts');
  const server = source('src/server/game.ts');
  const client = source('src/client/main.tsx');
  const profile = source('src/client/components/ProfileAndPrestige.tsx');

  assert.doesNotMatch(shared, /MAX_COSMIC_DUST/);
  assert.match(shared, /Number\.MAX_SAFE_INTEGER - existingDust/);

  assert.doesNotMatch(server, /MAX_COSMIC_DUST|Cosmic Dust is capped at/);
  assert.match(server, /s\.cosmicDust = \(s\.cosmicDust \?\? 0\) \+ dustEarned/);
  const forgeStart = server.indexOf('export async function synthesizeDust');
  const forgeEnd = server.indexOf('export async function buyCosmetic', forgeStart);
  assert.ok(forgeStart >= 0 && forgeEnd > forgeStart);
  const forge = server.slice(forgeStart, forgeEnd);
  assert.match(forge, /s\.cosmicDust = currentDust \+ 1/);
  assert.doesNotMatch(forge, /50|cap/i);

  assert.doesNotMatch(client, /MAX_COSMIC_DUST/);
  assert.doesNotMatch(profile, /MAX_COSMIC_DUST|Cosmic Dust Cap Reached|Cosmic Dust is capped/);
  assert.match(profile, /There is no gameplay cap on your Dust balance/);
});

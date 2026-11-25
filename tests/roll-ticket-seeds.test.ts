import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRollRandomSource } from '../src/shared/roll-rng.js';

test('roll seed streams are deterministic', () => {
  const seed = '0123456789abcdef'.repeat(4);
  const a = createRollRandomSource(seed);
  const b = createRollRandomSource(seed);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(a.next(), b.next());
    assert.equal(a.nextRarity(), b.nextRarity());
  }
});

test('ticket seeds are retained, ordered, and replayed for the committed result', () => {
  const game = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(game, /seeds: string\[\]/);
  assert.match(game, /requestedSeed !== ticket\.seeds\[ticketIndex\]/);
  assert.match(game, /createRollRandomSource\(ticketUse\.ticket\.seeds\[ticketUse\.index\]\)/);
  assert.match(main, /setLastOrb\(prediction\.orb\)/);
  assert.match(main, /ticketSeed,/);
});

test('Auto Roll uses the current saved cooldown and a self-rescheduling timer', () => {
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  const start = main.indexOf('// Auto Roll uses a single scheduled wake-up');
  const end = main.indexOf('// Standard upgrades are applied optimistically', start);
  assert.ok(start >= 0 && end > start);
  const effect = main.slice(start, end);
  assert.match(effect, /stateRef\.current/);
  assert.match(effect, /cooldownMs\(latest, true, liveBalance\)/);
  assert.match(effect, /autoRollCooldownRetryUntilRef\.current/);
  assert.match(effect, /window\.setTimeout/);
  assert.doesNotMatch(effect, /setInterval/);
});
test('roll ticket preview simulation runs outside the player mutation lock', () => {
  const game = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const start = game.indexOf('export async function getRollTicket():');
  const end = game.indexOf('async function loadRollTicketForUse(', start);
  assert.ok(start >= 0 && end > start);
  const ticketHandler = game.slice(start, end);
  const lockCallbackEnd = ticketHandler.indexOf('  });');
  const previewStart = ticketHandler.indexOf('await createRollTicketPreviews');
  assert.ok(lockCallbackEnd >= 0 && previewStart > lockCallbackEnd,
    'preview simulation must run after the player mutation lock is released');
  assert.match(ticketHandler, /Preview generation failed; continuing without instant preview/);
});

test('dev cooldown reset releases the player lock before issuing a ticket', () => {
  const debug = readFileSync(resolve(process.cwd(), 'src/server/debug.ts'), 'utf8');
  const modal = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const routeStart = debug.indexOf("debugRouter.post('/reset-cooldown'");
  const routeEnd = debug.indexOf("debugRouter.post('/unlock-upgrades'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = debug.slice(routeStart, routeEnd);
  const lockRelease = route.indexOf('    });');
  const ticketRequest = route.indexOf('const ticket = await getRollTicket()');
  assert.ok(lockRelease >= 0 && ticketRequest > lockRelease,
    'getRollTicket must not be called while the reset route holds the player lock');

  const rollStart = modal.indexOf('const rollOnce = async');
  const rollEnd = modal.indexOf('const rollDetail =', rollStart);
  assert.ok(rollStart >= 0 && rollEnd > rollStart);
  const rollOnce = modal.slice(rollStart, rollEnd);
  assert.match(rollOnce, /ticketSeed/);
  assert.match(rollOnce, /ticketIndex: ticket\.nextIndex/);
});

test('admin collection replacement marks old and incoming Codex keys for persistence', () => {
  const game = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const debug = readFileSync(resolve(process.cwd(), 'src/server/debug.ts'), 'utf8');
  assert.ok(game.includes('export function markCodexRarityWrite(state: PlayerState, rarityKey: string)'));
  assert.ok(debug.includes('  markCodexRarityWrite,'));
  const stateRouteStart = debug.indexOf("debugRouter.post('/state'");
  const stateRouteEnd = debug.indexOf("debugRouter.post('/preset'", stateRouteStart);
  assert.ok(stateRouteStart >= 0 && stateRouteEnd > stateRouteStart);
  const route = debug.slice(stateRouteStart, stateRouteEnd);
  assert.ok(route.includes('Object.keys(s.collection ?? {})'));
  assert.ok(route.includes('Object.keys(next)'));
  assert.ok(route.includes('markCodexRarityWrite(s, rarityKey)'));
});

test('admin mechanic sweep follows unlocked nav, isolated deterministic force-rolls, valuation, and rarity gates', () => {
  const modal = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  assert.ok(modal.includes("getAttribute('aria-label') === 'Upgrades'"));
  assert.ok(modal.includes("getAttribute('aria-label') === 'Roll'"));
  assert.ok(modal.includes('const seedSingleBallForceRoll = async'));
  assert.ok(modal.includes('await seedSingleBallForceRoll(9)'));
  assert.ok(modal.includes('randomValue: 0.999999'));
  assert.ok(modal.includes('Cosmic Valuation should multiply deterministic Collection Value by 1.05'));
  assert.ok(modal.includes('CONTINUUM_TIERS.length !== 27'));
  assert.ok(modal.includes('visibleContinuumTiers(1_000_000)'));
  assert.ok(modal.includes('visibleContinuumTiers(1e15)'));
  assert.ok(modal.includes('rarity: 12345, randomValue: 0.999999'));
  assert.ok(modal.includes('rarity: 777, randomValue: 0.999999'));
});

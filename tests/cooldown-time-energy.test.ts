import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

import {
  createInitialState,
  cooldownMs,
  theoreticalCooldownMs,
  cooldownReclaimerEnergyPerActivationMs,
  grantCooldownReclaimerTimeEnergy,
  timeEnergyActivationsAvailable,
  TIME_ENERGY_MAX_MS,
  TIME_ENERGY_MAX_ACTIVATIONS_PER_USE,
} from '../src/shared/game.js';

const NOW = 1_800_000_000_000;

function buildSub300State() {
  const state = createInitialState(NOW);
  state.upgrades.speed = 20;
  state.masterySkills!.chronoFlow = 20;
  state.prestigeUpgrades.permSpeed = 5;
  state.prestigeUpgrades.steadyHands = 5;
  state.prestigeUpgrades.temporalCompression = 5;
  state.dailyStreakCommunity = {
    ...state.dailyStreakCommunity!,
    speedMultiplier: 0.05,
  };
  return state;
}

test('Chrono Flow can push theoretical cooldown below 300ms while live rolls retain the 300ms floor', () => {
  const state = buildSub300State();
  state.masterySkills!.cooldownReclaimer = 1;
  const theoretical = theoreticalCooldownMs(state);
  assert.ok(theoretical > 0 && theoretical < 300, `expected sub-300ms theory, got ${theoretical}ms`);
  assert.equal(cooldownMs(state), 300, 'actual activations must keep the 300ms safety floor');
});

test('Cooldown Reclaimer earns 1% of live cooldown per level, even at the 300ms floor', () => {
  const state = buildSub300State();
  assert.equal(cooldownMs(state), 300);

  state.masterySkills!.cooldownReclaimer = 1;
  assert.equal(cooldownReclaimerEnergyPerActivationMs(state), 3);

  state.masterySkills!.cooldownReclaimer = 5;
  assert.equal(cooldownReclaimerEnergyPerActivationMs(state), 15);

  state.masterySkills!.cooldownReclaimer = 10;
  assert.equal(cooldownReclaimerEnergyPerActivationMs(state), 30);
});

test('Cooldown Reclaimer scales from the actual cooldown when it is above the live floor', () => {
  const state = createInitialState(NOW);
  state.masterySkills!.cooldownReclaimer = 5;
  const currentCooldown = cooldownMs(state);
  assert.ok(currentCooldown > 300, `expected cooldown above the floor, got ${currentCooldown}ms`);
  assert.equal(
    cooldownReclaimerEnergyPerActivationMs(state),
    Math.floor(currentCooldown * 0.05),
  );
});

test('Cooldown Reclaimer does not award Time Energy unless the skill is purchased', () => {
  const state = buildSub300State();
  state.masterySkills!.cooldownReclaimer = 0;
  assert.equal(cooldownReclaimerEnergyPerActivationMs(state), 0);
});

test('Time Energy funds as many whole activations as the current cooldown can afford', () => {
  assert.equal(timeEnergyActivationsAvailable(4_000, 2_000), 2);
  assert.equal(timeEnergyActivationsAvailable(3_999, 2_000), 1);
  assert.equal(timeEnergyActivationsAvailable(1_999, 2_000), 0);
  assert.equal(timeEnergyActivationsAvailable(4_500, 2_000), 2);
  assert.equal(timeEnergyActivationsAvailable(TIME_ENERGY_MAX_MS, 300), TIME_ENERGY_MAX_ACTIVATIONS_PER_USE);
  assert.equal(TIME_ENERGY_MAX_ACTIVATIONS_PER_USE, 3_333_333);
  assert.equal(timeEnergyActivationsAvailable(-1, 2_000), 0);
  assert.equal(timeEnergyActivationsAvailable(4_000, 0), 0);
});

test('Time Energy requests spend one current cooldown per activation and do not regenerate energy', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('export async function roll(');
  const end = server.indexOf('export async function subscribeToSubredditForReward', start);
  const handler = server.slice(start, end);
  assert.match(handler, /timeEnergyActivationsAvailable\(s\.timeEnergy \?\? 0, cd\)/);
  assert.match(handler, /const freeRollActivations = usingTimeEnergy\s*\? timeEnergyActivations/);
  assert.match(handler, /s\.timeEnergy = Math\.max\(0, \(s\.timeEnergy \?\? 0\) - \(cd \* freeRollActivations\)\)/);
  assert.match(handler, /if \(!usingTimeEnergy && !usingFreeRoll && !usingChainPatcher\)/);
  assert.match(handler, /const reclaimed = reclaimedPerActivation \* activations/);
  assert.match(handler, /const reclaimedPerActivation = cooldownReclaimerEnergyPerActivationMs\(s, isAuto, liveBalance\)/);
});

test('Time Energy awards are capped and require completed eligible activations', () => {
  const state = createInitialState(NOW);
  state.masterySkills!.cooldownReclaimer = 5;
  const perActivation = cooldownReclaimerEnergyPerActivationMs(state);
  assert.ok(perActivation > 0);

  assert.equal(grantCooldownReclaimerTimeEnergy(state, 3, perActivation), perActivation * 3);
  assert.equal(state.timeEnergy, perActivation * 3);
  assert.equal(grantCooldownReclaimerTimeEnergy(state, -1, perActivation), 0);
  assert.equal(grantCooldownReclaimerTimeEnergy(state, 1.5, perActivation), 0);

  state.timeEnergy = TIME_ENERGY_MAX_MS - 5;
  assert.equal(grantCooldownReclaimerTimeEnergy(state, 10_000, perActivation), 5);
  assert.equal(state.timeEnergy, TIME_ENERGY_MAX_MS);

  state.masterySkills!.cooldownReclaimer = 0;
  state.timeEnergy = 0;
  assert.equal(grantCooldownReclaimerTimeEnergy(state, 100), 0);
  assert.equal(state.timeEnergy, 0);
});

test('manual and automatic Offline Orb claims award Time Energy per stored activation', () => {
  const server = source('src/server/game.ts');
  const automationStart = server.indexOf('async function processAutomation');
  const automationEnd = server.indexOf('function flairTextColorForBackground', automationStart);
  const automation = server.slice(automationStart, automationEnd);
  assert.match(automation, /await applyRolls\(s, batches, undefined, 'offline'\);\s*grantCooldownReclaimerTimeEnergy\(s, batches, reclaimedPerActivation\)/);

  const manualStart = server.indexOf('export async function claimOffline()');
  const manualEnd = server.indexOf('export async function buyUpgrade(', manualStart);
  const manual = server.slice(manualStart, manualEnd);
  assert.match(manual, /await applyRolls\(s, batches, undefined, 'offline'\);\s*grantCooldownReclaimerTimeEnergy\(s, batches, reclaimedPerActivation\)/);
});

test('Frenzy start and claim bank Time Energy without multiplying by Multiball', () => {
  const server = source('src/server/game.ts');
  const startStart = server.indexOf('export async function startOrbFrenzy');
  const startEnd = server.indexOf('export async function getOrbFrenzyHandoff', startStart);
  const frenzyStart = server.slice(startStart, startEnd);
  assert.match(frenzyStart, /const reclaimedPerActivation = cooldownReclaimerEnergyPerActivationMs\(s, false, liveBalance\)/);
  assert.match(frenzyStart, /grantCooldownReclaimerTimeEnergy\(s, 1, reclaimedPerActivation\)/);

  const claimStart = server.indexOf('export async function claimOrbFrenzy');
  const claimEnd = server.indexOf('export async function postFrenzyThankYouComment', claimStart);
  const frenzyClaim = server.slice(claimStart, claimEnd);
  assert.match(frenzyClaim, /const frenzyRollsPerActivation = rollsPerActivation\(s\)/);
  assert.match(frenzyClaim, /Math\.floor\(count \/ Math\.max\(1, frenzyRollsPerActivation\)\)/);
  assert.match(frenzyClaim, /grantCooldownReclaimerTimeEnergy\(s, frenzyActivations, reclaimedPerActivation\)/);
});

test('large Time Energy spends expose real server progress and retain the overlay through the durable save', () => {
  const server = source('src/server/game.ts');
  const app = source('src/server/app.ts');
  const main = source('src/client/main.tsx');
  const batching = source('src/shared/roll-batching.ts');

  assert.match(server, /while \(remainingActivations > 0\)/);
  assert.match(server, /MAX_EFFECTIVE_ROLLS_PER_BATCH - 2/);
  assert.match(server, /createRollBatchPlan\(/);
  assert.match(server, /writeTimeEnergyRollProgress\(/);
  assert.match(server, /async \(chunkProcessed: number\) =>/);
  assert.match(server, /Mark complete only after the player save/);
  assert.match(app, /app\.get\('\/api\/time-energy\/progress'/);
  assert.match(main, /TIME_ENERGY_CALCULATING_MIN_ORBS = 5_000/);
  assert.match(main, /data-testid="time-energy-calculating-backdrop"/);
  assert.match(main, /\/api\/time-energy\/progress/);
  assert.match(main, /timeEnergyProgressPercent/);
  assert.match(main, /await finishTimeEnergyCalculating\(\)/);
  assert.doesNotMatch(main, /io-time-energy-progress-indeterminate/);
  assert.match(batching, /const weight = compress && remaining > sampleLimit/);
});

test('admin Time Energy test grant is restricted by the trusted admin router and fills the bank to one million seconds', () => {
  const debug = source('src/server/debug.ts');
  const ui = source('src/client/components/DevDebugModal.tsx');
  assert.match(debug, /debugRouter\.post\('\/time-energy\/grant-test'/);
  assert.match(debug, /s\.timeEnergy = TIME_ENERGY_MAX_MS/);
  assert.match(debug, /grantedSeconds: TIME_ENERGY_MAX_MS \/ 1_000/);
  assert.match(ui, /\/api\/dev\/time-energy\/grant-test/);
  assert.match(ui, /Set Time Energy to 1,000,000 Seconds/);
});

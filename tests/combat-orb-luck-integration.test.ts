import test from 'node:test';
import assert from 'node:assert/strict';

import { context, redis } from '../src/server/devvit-mock.js';
import { applyRolls } from '../src/server/game.js';
import { createInitialState } from '../src/shared/game.js';
import { combatTotalBossesBeaten } from '../src/shared/combat.js';

function fixedLuckSample(): () => number {
  // 0.5 is above the maximum 40% critical chance and gives a clean rarity
  // boundary when comparing the same level with and without boss-clear Luck.
  return () => 0.5;
}

async function rollOnceWithCurrentCombatSave() {
  const state = createInitialState(Date.now());
  state.level = 100;
  state.totalRolls = 100;
  return applyRolls(state, 1, undefined, 'online', 1, fixedLuckSample());
}

test('boss clears across all three dungeons increase real orb-roll Luck; invalid saves fail neutral', async () => {
  const userId = `combat-orb-luck-${process.pid}-${Date.now()}`;
  const previousUserId = context.userId;
  const combatKey = `infinity-orbs:combat:${userId}`;
  context.userId = userId;

  try {
    await redis.del(combatKey);
    const withoutCombatSave = await rollOnceWithCurrentCombatSave();

    await redis.set(combatKey, '{not valid JSON');
    const withMalformedCombatSave = await rollOnceWithCurrentCombatSave();

    await redis.set(combatKey, JSON.stringify({
      version: 1,
      dungeonId: 'glass-labyrinth',
      depth: 1,
      bestDepth: 1,
      dungeonBestDepths: { undercrypt: 51, 'cinder-vault': 101, 'glass-labyrinth': 101 },
      dungeonBossesBeaten: { undercrypt: 5, 'cinder-vault': 10, 'glass-labyrinth': 10 },
    }));
    const combatFixture = JSON.parse(String(await redis.get(combatKey)));
    assert.equal(combatTotalBossesBeaten(combatFixture), 25, 'boss counts from each dungeon must be included');
    const afterClearingBosses = await rollOnceWithCurrentCombatSave();

    assert.equal(
      withMalformedCombatSave.bestOrb.rarity,
      withoutCombatSave.bestOrb.rarity,
      'missing or corrupt combat state must not fabricate a Luck bonus',
    );
    assert.ok(
      afterClearingBosses.bestOrb.rarity > withoutCombatSave.bestOrb.rarity,
      'boss clear counts from all three dungeons should affect the central roll calculation',
    );
  } finally {
    context.userId = previousUserId;
    await redis.del(combatKey);
  }
});


test('high-rarity Orb rolls do not guarantee Shards; successful procs pay one whole Shard', async () => {
  const userId = `shard-economy-roll-${process.pid}-${Date.now()}`;
  const previousUserId = context.userId;
  const combatKey = `infinity-orbs:combat:${userId}`;
  context.userId = userId;

  try {
    await redis.del(combatKey);
    const missState = createInitialState(Date.now());
    missState.totalRolls = 100;
    missState.level = 1000;
    missState.highestRarity = 1_000_000;
    const miss = await applyRolls(missState, 1, 1_000_000, 'online', 1, () => 0.99, true);
    assert.equal(miss.bestOrb.rarity, 1_000_000);
    assert.equal(miss.shardsGained, 0, 'a high-rarity Orb does not automatically mint Shards');

    const procState = createInitialState(Date.now());
    procState.totalRolls = 100;
    procState.level = 1000;
    procState.highestRarity = 1_000_000;
    const proc = await applyRolls(procState, 1, 1_000_000, 'online', 1, () => 0, true);
    assert.equal(proc.bestOrb.rarity, 1_000_000);
    assert.equal(proc.shardsGained, 1, 'a normal proc grants one whole Shard');
  } finally {
    context.userId = previousUserId;
    await redis.del(combatKey);
  }
});

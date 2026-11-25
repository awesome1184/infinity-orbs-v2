import test from 'node:test';
import assert from 'node:assert/strict';
import { context, redis } from '../src/server/devvit-mock.js';
import { forgeCombatGear, getCombatSnapshot, performCombatBeat } from '../src/server/combat.js';
import { combatForgeCost, combatTotalBossesBeaten, createCombatState, getEnemyForDepth } from '../src/shared/combat.js';

/**
 * Give each server-level test its own persisted combat key and restore the mock
 * identity after the test so these tests cannot leak combat state into others.
 */
async function withCombatPlayer<T>(userId: string, run: (key: string) => Promise<T>): Promise<T> {
  const previousUserId = context.userId;
  const key = 'infinity-orbs:combat:' + userId;
  context.userId = userId;
  await redis.del(key);
  try {
    return await run(key);
  } finally {
    await redis.del(key);
    context.userId = previousUserId;
  }
}

test('combat beats persist their sequence and reject duplicate/stale requests', async () => {
  await withCombatPlayer('combat-sequence-regression-player', async () => {
    const before = await getCombatSnapshot();
    assert.equal(before.state.sequence, 0);

    // Two tabs can race with the same sequence. The Redis WATCH/MULTI/EXEC
    // compare-and-set must permit only one to commit the beat.
    const racingBeats = await Promise.allSettled([
      performCombatBeat(1, 'strike'),
      performCombatBeat(1, 'strike'),
    ]);
    assert.equal(racingBeats.filter(attempt => attempt.status === 'fulfilled').length, 1);
    assert.equal(racingBeats.filter(attempt => attempt.status === 'rejected').length, 1);
    const rejectedBeat = racingBeats.find(attempt => attempt.status === 'rejected');
    assert.ok(rejectedBeat && rejectedBeat.status === 'rejected');
    assert.match(
      String(rejectedBeat.reason instanceof Error ? rejectedBeat.reason.message : rejectedBeat.reason),
      /stale combat sequence/,
    );

    const persisted = await getCombatSnapshot();
    assert.equal(persisted.state.sequence, 1, 'only one racing request may commit sequence 1');

    await assert.rejects(
      () => performCombatBeat(1, 'strike'),
      /stale combat sequence/,
      'replaying an already accepted sequence must not resolve another beat',
    );

    const afterReplay = await getCombatSnapshot();
    assert.equal(afterReplay.state.sequence, 1, 'a rejected replay must not advance combat state');
  });
});

test('Forge item level uses the highest saved dungeon depth, while pricing keeps the current depth', async () => {
  await withCombatPlayer('combat-forge-highest-depth-regression-player', async key => {
    const state = createCombatState();
    state.depth = 4;
    state.bestDepth = 4;
    state.dungeonBestDepths = { undercrypt: 4, 'cinder-vault': 151, 'glass-labyrinth': 31 };
    state.scrap = 100;
    await redis.set(key, JSON.stringify(state));

    const result = await forgeCombatGear('weapon', 0);
    assert.equal(result.forgeResult.item.sourceFloor, 150, 'forged gear should match the highest unlocked depth across dungeons');
    assert.equal(result.forgeResult.cost, combatForgeCost(3), 'the price curve should still use the active depth');
  });
});

test('defeating a boss in each dungeon increments a persistent lifetime count', async () => {
  await withCombatPlayer('combat-boss-count-three-dungeons-regression-player', async key => {
    let state = createCombatState();
    const dungeons = ['undercrypt', 'cinder-vault', 'glass-labyrinth'] as const;

    for (const dungeonId of dungeons) {
      state.dungeonId = dungeonId;
      state.depth = 10;
      state.bestDepth = 10;
      state.depthCapCleared = false;
      state.dungeonBestDepths[dungeonId] = 10;
      state.enemyHp = 1;
      state.health = state.maxHealth;
      state.playerSpeedCharge = 1;
      state.enemySpeedCharge = 0;
      state.playerSpeedBeats = 1;
      state.combatBeats = 0;
      state.playerActionsResolved = 0;
      state.enemyActionsResolved = 0;
      state.guardBeats = 0;
      state.lastAcceptedBeatAtMs = 0;
      await redis.set(key, JSON.stringify(state));

      const result = await performCombatBeat(state.sequence + 1, 'strike');
      assert.equal(result.defeated, true, dungeonId + ' boss should be defeated by the prepared lethal hit');
      assert.equal(result.state.dungeonBossesBeaten[dungeonId], 1, dungeonId + ' should get its own clear count');
      state = result.state;
    }

    assert.equal(combatTotalBossesBeaten(state), 3, 'all three dungeon boss counts contribute to main-game Luck');
  });
});

test('death resets the run while retaining permanent combat progress', async () => {
  await withCombatPlayer('combat-death-persistence-regression-player', async key => {
    const state = createCombatState();
    state.runId = 9;
    state.depth = 10;
    state.bestDepth = 10;
    state.health = 1;
    state.coins = 1_234;
    state.totalKills = 99;
    state.level = 7;
    state.xp = 42;
    state.sequence = 0;
    state.combatBeats = 0;
    // Force the death-reset path to run before a random high-rarity Orb can kill the boss.
    state.playerActionsResolved = 100;
    state.enemyActionsResolved = 0;
    state.playerSpeedCharge = 0;
    state.enemySpeedCharge = 1; // Arrange the enemy's attack now; this test targets persistence after death.
    state.skillLevels = { 'surefoot': 2 };
    // Seed one pre-existing item explicitly: new Delvers no longer receive free starter gear.
    state.inventory = [{
      id:'starter-weapon', name:'Delver Knife', slot:'weapon', quality:35, sourceFloor:0, power:8,
      effect:'Adds +4 damage. Critical chance +4 percentage points.', trait:'keen',
      damageBonus:4, speedBonus:0, maxHealthBonus:0, armorBonus:0, critChanceBonus:0,
    }];
    state.equipment.weapon='starter-weapon';
    state.enemyHp = getEnemyForDepth(10).maxHp;

    await redis.set(key, JSON.stringify(state));

    const result = await performCombatBeat(1, 'strike');

    assert.equal(result.died, true, 'the low-health Delver should be defeated by the boss beat');
    assert.equal(result.state.runId, 10, 'death should start a new run');
    assert.equal(result.state.depth, 1, 'the new run should begin at Depth 1');
    assert.equal(result.state.health, result.state.maxHealth, 'the new run should start at full health');
    assert.equal(result.state.bestDepth, 10, 'best depth is permanent');
    assert.equal(result.state.coins, 0, 'legacy Combat Coins are cleared after wallet consolidation');
    assert.equal(result.state.totalKills, 99, 'lifetime kills are permanent');
    assert.equal(result.state.level, 7, 'combat level is permanent');
    assert.equal(result.state.xp, 42, 'stored combat XP is retained when the run ends');
    assert.equal(result.state.skillLevels.surefoot, 2, 'skill ranks are permanent');
    assert.ok(result.state.inventory.some(item => item.id === 'starter-weapon'), 'collected gear must survive death');
    assert.equal(result.state.sequence, 1, 'the death-causing beat must still be committed');
    assert.equal(result.state.enemyHp, getEnemyForDepth(1).maxHp, 'the new run should load the Depth 1 enemy');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { context, redis } from '../src/server/devvit-mock.js';
import { equipCombatRune, equipCombatSkill, getCombatSnapshot, hasCompletedCombatTutorial, performCombatBeat, rollCombatSkill, setCombatDungeon } from '../src/server/combat.js';
import { COMBAT_BEAT_INTERVAL_MS, calculateCombatArenaRatingUpdate, getEnemyForDungeonDepth } from '../src/shared/combat.js';

async function withPlayer<T>(userId: string, run: (key: string) => Promise<T>): Promise<T> {
  const priorUserId = context.userId;
  const priorUsername = context.username;
  const key = 'infinity-orbs:combat:' + userId;
  try {
    context.userId = userId;
    context.username = 'CombatSecurityTest';
    await redis.del(key);
    await redis.hDel('infinity-orbs:combat:arena:profiles', userId);
    return await run(key);
  } finally {
    await redis.del(key);
    await redis.hDel('infinity-orbs:combat:arena:profiles', userId);
    context.userId = priorUserId;
    context.username = priorUsername;
  }
}

test('combat loot, skill gacha, and crit paths work without Math.random', async () => {
  await withPlayer('combat-rng-regression-player', async key => {
    const initial = await getCombatSnapshot();
    const state = initial.state;
    state.dungeonId = 'undercrypt';
    state.depth = 3; // Elite encounter guarantees a gear-drop path.
    state.bestDepth = 3;
    state.dungeonBestDepths.undercrypt = 3;
    state.enemyHp = 1; // Keep this regression deterministic and exercise gear generation.
    state.sequence = 0;
    state.lastAcceptedBeatAtMs = 0;
    await redis.set(key, JSON.stringify(state));

    const originalRandom = Math.random;
    Math.random = () => { throw new Error('Math.random must not be used by combat'); };
    try {
      const skill = await rollCombatSkill();
      assert.ok(skill.skillRoll.rank >= 1);
      const beat = await performCombatBeat(1, 'strike');
      assert.equal(beat.defeated, true);
      assert.ok(beat.item, 'defeating an elite should exercise secure gear generation');
    } finally {
      Math.random = originalRandom;
    }
  });
});

test('server rejects early beats without advancing sequence or overwriting state', async () => {
  await withPlayer('combat-cadence-regression-player', async key => {
    const initial = await getCombatSnapshot();
    const state = initial.state;
    state.lastAcceptedBeatAtMs = 0;
    state.sequence = 0;
    state.depth = 1;
    state.bestDepth = 1;
    state.dungeonBestDepths.undercrypt = 1;
    state.enemyHp = getEnemyForDungeonDepth('undercrypt', 1).maxHp;
    await redis.set(key, JSON.stringify(state));

    await performCombatBeat(1, 'strike');
    const before = JSON.parse((await redis.get(key))!) as { sequence: number; lastAcceptedBeatAtMs: number };
    before.lastAcceptedBeatAtMs = Date.now(); // Make the early-request boundary deterministic under slow CI.
    await redis.set(key, JSON.stringify(before));

    await assert.rejects(
      performCombatBeat(2, 'strike'),
      /COMBAT_BEAT_TOO_SOON:/,
    );
    const persisted = JSON.parse((await redis.get(key))!) as { sequence: number; lastAcceptedBeatAtMs: number };
    assert.equal(persisted.sequence, before.sequence);
    assert.equal(persisted.lastAcceptedBeatAtMs, before.lastAcceptedBeatAtMs);
  });
});

test('Guard is applied before a slower enemy attack and mitigates that attack', async () => {
  await withPlayer('combat-guard-regression-player', async key => {
    const initial = await getCombatSnapshot();
    const state = initial.state;
    state.dungeonId = 'undercrypt';
    state.depth = 4; // Ironbound has low Speed; each beat resolves exactly one scheduled actor.
    state.bestDepth = 4;
    state.dungeonBestDepths.undercrypt = 4;
    state.equipment.weapon = null;
    state.enemyHp = getEnemyForDungeonDepth('undercrypt', 4).maxHp;
    state.sequence = 0;
    state.combatBeats = 1;
    state.playerSpeedBeats = 1;
    // Both actors are ready: ties resolve for the player, then the enemy acts on the following beat.
    state.playerSpeedCharge = 1;
    state.enemySpeedCharge = 1;
    state.playerActionsResolved = 1;
    state.enemyActionsResolved = 1;
    state.guardBeats = 0;
    state.lastAcceptedBeatAtMs = 0;
    await redis.set(key, JSON.stringify(state));

    const guarded = await performCombatBeat(1, 'guard');
    assert.equal(
      guarded.actions.some(action => action.actor === 'enemy' && action.kind === 'attack'),
      false,
      'a whole-number beat resolves only the scheduled player action',
    );
    assert.equal(guarded.state.guardBeats, 1, 'Guard persists until the enemy receives its turn');

    // Skip only the wall-clock cooldown so this regression tests the scheduled turn order.
    await redis.set(key, JSON.stringify({...guarded.state,lastAcceptedBeatAtMs:0}));
    const attacked = await performCombatBeat(2, 'strike');
    const incoming = attacked.actions.find(action => action.actor === 'enemy' && action.kind === 'attack');
    assert.ok(incoming, 'the enemy resolves its scheduled turn on the following beat');
    assert.ok(
      (incoming.damage ?? Number.POSITIVE_INFINITY) < getEnemyForDungeonDepth('undercrypt', 4).damage,
      'Guard must soften the incoming attack when the enemy turn arrives',
    );
    assert.equal(attacked.state.guardBeats, 0, 'Guard is consumed only after mitigating a real enemy attack');
  });
});

test('Arena Elo updates conserve points at all rating boundaries', () => {
  const samples = [
    [100, 100, true], [100, 100, false], [10_000, 10_000, true],
    [10_000, 10_000, false], [100, 10_000, true], [100, 10_000, false],
    [10_000, 100, true], [10_000, 100, false], [9999, 100, false],
    [101, 9999, true], [1000, 1000, true], [1000, 1000, false],
  ] as const;
  for (const [player, opponent, won] of samples) {
    const update = calculateCombatArenaRatingUpdate(player, opponent, won);
    assert.ok(update.playerRating >= 100 && update.playerRating <= 10_000);
    assert.ok(update.opponentRating >= 100 && update.opponentRating <= 10_000);
    assert.equal(update.playerRating + update.opponentRating, player + opponent);
    assert.equal(update.playerChange + update.opponentChange, 0);
  }
});

test('corrupt persisted combat saves fail closed and remain byte-for-byte intact',async()=>{
  await withPlayer('combat-corrupt-state-regression-player',async key=>{
    for(const raw of ['', '{broken-json', '[]', '"not-an-object"', '{}', '{"unknownField":true}']){
      await redis.set(key,raw);
      await assert.rejects(getCombatSnapshot(),/Combat state is corrupted; refusing to overwrite it/);
      await assert.rejects(hasCompletedCombatTutorial(),/Combat state is corrupted; refusing to overwrite it/);
      assert.equal(await redis.get(key),raw,'a read must never replace the damaged save with starter state');
    }
  });
});

test('an intentionally empty gear inventory stays empty after normalization',async()=>{
  await withPlayer('combat-empty-inventory-regression-player',async key=>{
    const initial=await getCombatSnapshot();
    const state=initial.state;
    state.inventory=[];
    state.runInventoryIds=[];
    state.equipment={weapon:null,armor:null,helmet:null,gloves:null,boots:null,ring:null,amulet:null};
    await redis.set(key,JSON.stringify(state));
    const loaded=await getCombatSnapshot();
    assert.deepEqual(loaded.state.inventory,[]);
    assert.deepEqual(loaded.state.equipment,{weapon:null,armor:null,helmet:null,gloves:null,boots:null,ring:null,amulet:null});
  });
});

test('explicitly unequipped legacy gear is not silently re-equipped on reload',async()=>{
  await withPlayer('combat-unequipped-gear-regression-player',async key=>{
    const initial=await getCombatSnapshot();
    const state=initial.state;
    // Simulate an existing save that owns its old starter pieces but intentionally unequips them.
    state.inventory=[
      {id:'starter-weapon',name:'Delver Knife',slot:'weapon',quality:35,sourceFloor:0,power:8,effect:'Adds +4 damage. Critical chance +4 percentage points.',trait:'keen',damageBonus:4,speedBonus:0,maxHealthBonus:0,armorBonus:0,critChanceBonus:0},
      {id:'starter-armor',name:'Worn Leathers',slot:'armor',quality:28,sourceFloor:0,power:5,effect:'Adds +40 max HP and reduces incoming damage by 4%.',trait:'bulwark',damageBonus:0,speedBonus:0,maxHealthBonus:40,armorBonus:0,critChanceBonus:0},
    ];
    state.equipment.weapon=null;
    state.equipment.armor=null;
    await redis.set(key,JSON.stringify(state));
    const loaded=await getCombatSnapshot();
    assert.equal(loaded.state.equipment.weapon,null);
    assert.equal(loaded.state.equipment.armor,null);
    assert.ok(loaded.state.inventory.some(item=>item.id==='starter-weapon'));
    assert.ok(loaded.state.inventory.some(item=>item.id==='starter-armor'));
  });
});

test('Rune equip endpoint rejects non-boolean intent instead of treating it as an unequip',async()=>{
  await withPlayer('combat-rune-toggle-regression-player',async key=>{
    const initial=await getCombatSnapshot();
    const state=initial.state;
    const rune={id:'rune-toggle-regression',name:'Test Fate Rune',rarity:'Common' as const,stat:'luckPct' as const,value:1,sourceDepth:0,sourceDungeon:'undercrypt' as const};
    state.runes=[rune];
    state.equippedRunes=[rune.id];
    await redis.set(key,JSON.stringify(state));
    const before=await redis.get(key);
    await assert.rejects(equipCombatRune(rune.id,'false'),/Choose whether to equip or unequip the Rune/);
    assert.equal(await redis.get(key),before,'rejected input must not write any state');
  });
});

test('combat Skill equip endpoint rejects malformed toggle intent without changing state',async()=>{
  await withPlayer('combat-skill-toggle-regression-player',async key=>{
    const initial=await getCombatSnapshot();
    const state=initial.state;
    state.skillLevels={'ember-lung':1};
    state.equippedAbilities=['ember-lung'];
    await redis.set(key,JSON.stringify(state));
    const before=await redis.get(key);
    await assert.rejects(equipCombatSkill('ember-lung','false'),/Choose whether to equip or unequip the ability/);
    assert.equal(await redis.get(key),before,'invalid request must not unequip the skill');
  });
});

test('death clears pending kill rewards and run-bound modifiers',async()=>{
  await withPlayer('combat-run-reset-regression-player',async key=>{
    const initial=await getCombatSnapshot();
    const state=initial.state;
    state.depth=4;
    state.bestDepth=4;
    state.dungeonBestDepths.undercrypt=4;
    state.health=1;
    state.enemyHp=getEnemyForDungeonDepth('undercrypt',4).maxHp;
    state.sequence=0;
    state.combatBeats=1;
    state.playerActionsResolved=100;
    state.enemyActionsResolved=0;
    state.playerSpeedCharge=0;
    state.enemySpeedCharge=1; // Arrange the enemy's attack now; this test targets death-state cleanup.
    state.guardBeats=0;
    state.lastAcceptedBeatAtMs=0;
    state.skillRuntime.nextKillMarkBonus=123;
    state.skillRuntime.nextKillXpBonus=456;
    state.skillRuntime.nextRuneDropBonus=.2;
    state.skillRuntime.royalTitheKills=2;
    state.skillRuntime.bountyStreak=3;
    await redis.set(key,JSON.stringify(state));
    const result=await performCombatBeat(1,'strike');
    assert.equal(result.died,true,'the prepared low-health player should be defeated by the slow enemy');
    assert.equal(result.state.skillRuntime.nextKillMarkBonus,0);
    assert.equal(result.state.skillRuntime.nextKillXpBonus,0);
    assert.equal(result.state.skillRuntime.nextRuneDropBonus,0);
    assert.equal(result.state.skillRuntime.royalTitheKills,0);
    assert.equal(result.state.skillRuntime.bountyStreak,0);
  });
});

test('switching dungeons clears encounter-only combat effects and queued rewards',async()=>{
  await withPlayer('combat-dungeon-reset-regression-player',async key=>{
    const initial=await getCombatSnapshot();
    const state=initial.state;
    state.pendingHealAmount=900;
    state.skillRuntime.burnTicks=3;
    state.skillRuntime.burnDamage=77;
    state.skillRuntime.armorBreakBeats=2;
    state.skillRuntime.shield=1200;
    state.skillRuntime.delayedDamage=400;
    state.skillRuntime.delayedDamageReadyAtSequence=state.sequence+1;
    state.skillRuntime.lastAttackDamage=500;
    state.skillRuntime.storedDamage=600;
    state.skillRuntime.executeMarked=true;
    state.skillRuntime.evadeNext=true;
    state.skillRuntime.phoenixReady=true;
    state.skillRuntime.nextKillMarkBonus=100;
    state.skillRuntime.nextKillXpBonus=200;
    state.skillRuntime.nextRuneDropBonus=.2;
    state.skillRuntime.royalTitheKills=2;
    state.skillRuntime.bountyStreak=4;
    await redis.set(key,JSON.stringify(state));
    const result=await setCombatDungeon('cinder-vault');
    assert.equal(result.state.dungeonId,'cinder-vault');
    assert.equal(result.state.pendingHealAmount,0);
    for(const field of ['burnTicks','burnDamage','armorBreakBeats','shield','delayedDamage','delayedDamageReadyAtSequence','lastAttackDamage','storedDamage','nextKillMarkBonus','nextKillXpBonus','nextRuneDropBonus','royalTitheKills','bountyStreak'] as const){
      assert.equal(result.state.skillRuntime[field],0,field+' should not carry into the new dungeon');
    }
    assert.equal(result.state.skillRuntime.executeMarked,false);
    assert.equal(result.state.skillRuntime.evadeNext,false);
    assert.equal(result.state.skillRuntime.phoenixReady,false);
  });
});

test('malformed-but-present inventory fields never restore starter gear',async()=>{
  await withPlayer('combat-malformed-inventory-regression-player',async key=>{
    const malformedInventories:unknown[]=[null,{},'not-an-inventory',[{id:'broken-gear'}]];
    for(const malformedInventory of malformedInventories){
      const base=await getCombatSnapshot();
      const state=JSON.parse(JSON.stringify(base.state)) as Record<string,unknown>;
      state.inventory=malformedInventory;
      state.runInventoryIds=[];
      await redis.set(key,JSON.stringify(state));
      const loaded=await getCombatSnapshot();
      assert.deepEqual(loaded.state.inventory,[],'malformed present inventory must not produce replacement starter gear');
    }
  });
});

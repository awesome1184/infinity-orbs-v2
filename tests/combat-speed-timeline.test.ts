import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMBAT_MAX_DEPTH,
  combatActionTimeline,
  combatNextActor,
  combatTurnStep,
  combatHighestDepthReached,
} from '../src/shared/combat.js';
import { ORB_TIER_NAMES, getOrbInfo } from '../src/shared/game.js';

function simulateTurns(
  playerSpeed: number,
  enemySpeed: number,
  count: number,
  initialPlayerCharge = 0,
  initialEnemyCharge = 0,
): { actors: Array<'player' | 'enemy'>; playerCharge: number; enemyCharge: number } {
  let playerCharge = initialPlayerCharge;
  let enemyCharge = initialEnemyCharge;
  const actors: Array<'player' | 'enemy'> = [];
  for (let turn = 0; turn < count; turn += 1) {
    const step = combatTurnStep(playerSpeed, enemySpeed, playerCharge, enemyCharge);
    actors.push(step.actor);
    playerCharge = step.playerSpeedCharge;
    enemyCharge = step.enemySpeedCharge;
  }
  return { actors, playerCharge, enemyCharge };
}

test('300 player Speed versus 100 enemy Speed resolves player, player, player, enemy', () => {
  assert.deepEqual(simulateTurns(300, 100, 8).actors, [
    'player', 'player', 'player', 'enemy',
    'player', 'player', 'player', 'enemy',
  ]);
});

test('each combat beat projects exactly one action in a whole-number slot', () => {
  const first = combatTurnStep(900, 650, 0, 0);
  assert.equal(first.actor, 'player');
  assert.deepEqual(combatActionTimeline(900, 650, 1, 0, 0, 1, 1), [
    { actor: 'player', actionIndex: 0, time: 0 },
  ]);

  const second = combatTurnStep(900, 650, first.playerSpeedCharge, first.enemySpeedCharge);
  assert.equal(second.actor, 'enemy');
  assert.deepEqual(combatActionTimeline(900, 650, 2, first.playerSpeedCharge, first.enemySpeedCharge, 1, 1), [
    { actor: 'enemy', actionIndex: 0, time: 0 },
  ]);
});

test('turn order uses integer slots without fractional beat labels or microbeat timestamps', () => {
  const server = readFileSync(resolve(process.cwd(), 'src/server/combat.ts'), 'utf8');
  const ui = readFileSync(resolve(process.cwd(), 'src/client/components/CombatSection.tsx'), 'utf8');
  assert.ok(!server.includes('1e-6'), 'bonus strikes must not be sorted with fractional micro-beats');
  assert.ok(!ui.includes('event.time.toFixed(2)'), 'the turn visualizer must not show decimal beat times');
  assert.ok(ui.includes('Turn {event.time}'), 'the visualizer labels whole-number turns');
});

test('opening initiative follows the faster Speed value; ties favor the Delver', () => {
  assert.equal(combatNextActor(300, 200, 0, 0), 'player');
  assert.equal(combatNextActor(200, 300, 0, 0), 'enemy');
  assert.equal(combatNextActor(100, 100, 0, 0), 'player');
});

test('a faster enemy receives the corresponding number of discrete turns', () => {
  assert.deepEqual(simulateTurns(310, 800, 4).actors, ['enemy', 'enemy', 'player', 'enemy']);
});

test('player charge carries into a new encounter while enemy charge restarts', () => {
  const firstEncounter = simulateTurns(310, 100, 3);
  assert.deepEqual(firstEncounter.actors, ['player', 'player', 'player']);
  assert.ok(firstEncounter.enemyCharge > 0.9, 'the enemy was nearly ready when the third player action landed');

  // A defeated enemy loses its accumulated charge; the player's charge is retained.
  const nextEncounter = simulateTurns(310, 150, 3, firstEncounter.playerCharge, 0);
  assert.deepEqual(nextEncounter.actors, ['player', 'player', 'enemy']);

  const server = readFileSync(resolve(process.cwd(), 'src/server/combat.ts'), 'utf8');
  const enemyReset = server.split('\n').find(line => line.includes('s.combatBeats=0;s.enemyActionsResolved=0;'));
  assert.ok(enemyReset?.includes('s.enemySpeedCharge=0'));
  assert.ok(!enemyReset?.includes('s.playerSpeedCharge=0'), 'player charge must persist across enemy defeats');
  assert.ok(server.includes('s.playerSpeedBeats=0;s.playerSpeedCharge=0;s.enemySpeedCharge=0;s.enemyTurnsToSkip=0;s.combatBeats=0;s.playerActionsResolved=0;s.enemyActionsResolved=0'));
});

test('every orb rarity has an expanded, duplicate-free name pool', () => {
  for (const [tier, names] of Object.entries(ORB_TIER_NAMES)) {
    assert.ok(names.length >= 14, `${tier} should have at least fourteen names`);
    assert.equal(new Set(names).size, names.length, `${tier} names should be unique`);
  }
  assert.ok(getOrbInfo(100).name.length > 0);
  assert.equal(getOrbInfo(100).name, getOrbInfo(100).name, 'ordinary names stay deterministic');
  assert.ok(getOrbInfo(1e17).name.length > 0, 'large-rarity name selection remains defined');
});

test('combat Orb rolls ignore main-game Luck and the orb panel explains Luck and damage', () => {
  const server = readFileSync(resolve(process.cwd(), 'src/server/combat.ts'), 'utf8');
  const ui = readFileSync(resolve(process.cwd(), 'src/client/components/CombatSection.tsx'), 'utf8');
  assert.ok(server.includes('rollContinuum(1,secureRandom)'));
  assert.ok(!server.includes('rollContinuum(orbLuck,secureRandom)'));
  assert.ok(ui.includes('Combat Orb rolls use neutral 1× Luck'));
  assert.ok(ui.includes('totalDamageThisBeat'));
  assert.ok(ui.includes('TOTAL DAMAGE'));
});

test('Combat mode blocks main-game rolls, queues skills, and uses a stable gear inspector', () => {
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  const ui = readFileSync(resolve(process.cwd(), 'src/client/components/CombatSection.tsx'), 'utf8');
  assert.ok(main.includes('if (combatModeRef.current) return;'));
  assert.ok(main.includes('!splashEntered || combatMode || !autoRoll'));
  assert.ok(ui.includes('const queueAbility='));
  assert.ok(ui.includes('Queued for next beat'));
  assert.ok(ui.includes('createPortal('));
  assert.ok(ui.includes('io-combat-beat-state'));
  assert.ok(main.includes('io-combat-leaving'));
  assert.ok(ui.includes('io-combat-leaving'));
});

test('Auto Fight countdown tracks reconciled server timestamps instead of stale render state', () => {
  const ui = readFileSync(resolve(process.cwd(), 'src/client/components/CombatSection.tsx'), 'utf8');
  assert.ok(
    ui.includes('Date.now()-(Number(current?.lastAcceptedBeatAtMs)||0)'),
    'the countdown must read the same mutable timestamp the retry scheduler reconciles',
  );
  assert.ok(
    ui.includes('stateRef.current={...current,lastAcceptedBeatAtMs:Math.max(0,Date.now()+Math.max(0,remaining)-combatBeatIntervalMsFor(current))}'),
    'an early server rejection must reconcile against the same ability-adjusted interval',
  );
});

test('the leaderboard depth metric uses the best saved depth across every dungeon', () => {
  assert.equal(combatHighestDepthReached({
    depth: 4,
    bestDepth: 12,
    dungeonBestDepths: { undercrypt: 12, 'cinder-vault': 87, 'glass-labyrinth': 33 },
  }), 87);
  assert.equal(combatHighestDepthReached({ depth: COMBAT_MAX_DEPTH + 20 }), COMBAT_MAX_DEPTH);
  assert.equal(combatHighestDepthReached({ depth: 0, bestDepth: -3, dungeonBestDepths: { undercrypt: Infinity } }), 0);
  assert.equal(combatHighestDepthReached(null), 0);
});

test('Social leaderboard displays a saved-data-backed Highest Depth Reached board', () => {
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  const ui = readFileSync(resolve(process.cwd(), 'src/client/components/GuildsAndSocial.tsx'), 'utf8');

  assert.ok(social.includes('infinity-orbs:combat:'));
  assert.ok(social.includes('combatHighestDepthReached(combatSave)'));
  assert.ok(social.includes('highestDepthReached: sortLeaderboard('));
  assert.ok(ui.includes("label: 'Highest Depth Reached'"));
  assert.ok(ui.includes("case 'highestDepthReached': return"));
});

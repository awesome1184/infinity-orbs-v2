import assert from 'node:assert/strict';
import test from 'node:test';
import { combatActionTimeline, combatNextActor, combatTurnStep } from '../src/shared/combat.js';

function scheduledTurns(playerSpeed: number, enemySpeed: number, count: number): Array<'player' | 'enemy'> {
  let playerCharge = 0;
  let enemyCharge = 0;
  const turns: Array<'player' | 'enemy'> = [];

  for (let turn = 0; turn < count; turn += 1) {
    const step = combatTurnStep(playerSpeed, enemySpeed, playerCharge, enemyCharge);
    turns.push(step.actor);
    playerCharge = step.playerSpeedCharge;
    enemyCharge = step.enemySpeedCharge;
  }

  return turns;
}

test('300 player Speed versus 100 enemy Speed gives three player turns per enemy turn', () => {
  assert.deepEqual(scheduledTurns(300, 100, 8), [
    'player', 'player', 'player', 'enemy',
    'player', 'player', 'player', 'enemy',
  ]);
});

test('equal Speed alternates after resolving a player-favored tie', () => {
  assert.deepEqual(scheduledTurns(100, 100, 6), [
    'player', 'enemy', 'player', 'enemy', 'player', 'enemy',
  ]);
});

test('a combatant with zero Speed does not act while the other has Speed', () => {
  assert.deepEqual(scheduledTurns(0, 100, 3), ['enemy', 'enemy', 'enemy']);
  assert.deepEqual(scheduledTurns(100, 0, 3), ['player', 'player', 'player']);
});

test('turn charge is preserved and the next scheduled action is a whole-number slot', () => {
  let playerCharge = 0;
  let enemyCharge = 0;
  for (let turn = 0; turn < 3; turn += 1) {
    const step = combatTurnStep(300, 100, playerCharge, enemyCharge);
    assert.equal(step.actor, 'player');
    playerCharge = step.playerSpeedCharge;
    enemyCharge = step.enemySpeedCharge;
  }
  assert.equal(combatNextActor(300, 100, playerCharge, enemyCharge), 'enemy');
  assert.deepEqual(combatActionTimeline(300, 100, 4, playerCharge, enemyCharge, 1, 1, 4), [
    { actor: 'enemy', actionIndex: 0, time: 0 },
  ]);
});

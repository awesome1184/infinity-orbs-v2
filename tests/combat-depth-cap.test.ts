import test from 'node:test';
import assert from 'node:assert/strict';
import { context, redis } from '../src/server/devvit-mock.js';
import { performCombatBeat } from '../src/server/combat.js';
import { createCombatState } from '../src/shared/combat.js';

test('defeating the deepest supported enemy keeps current and best depth capped', async () => {
  const previousUserId = context.userId;
  const userId = 'combat-depth-cap-test-' + Date.now().toString(36);
  const key = 'infinity-orbs:combat:' + userId;
  context.userId = userId;

  const state = createCombatState();
  state.depth = 50_000;
  state.bestDepth = 50_000;
  state.level = 60;
  state.enemyHp = 1;
  state.sequence = 0;
  state.combatBeats = 0;
  state.playerActionsResolved = 0;
  state.enemyActionsResolved = 0;

  // This regression covers terminal-depth persistence, not late-game balance.
  // Give the fixture enough valid Speed gear to land its lethal test hit before
  // the depth-scaled boss acts; do not weaken real speed-based action ordering.
  for (const slot of ['boots', 'gloves'] as const) {
    const id = 'depth-cap-speed-' + slot;
    state.inventory.push({
      id,
      name: 'Depth Cap Speed Test Gear',
      slot,
      quality: 100,
      sourceFloor: 49_999,
      power: 1_000_000,
      effect: 'Test-only Speed gear.',
      trait: 'keen',
      damageBonus: 0,
      speedBonus: 1_000_000,
      maxHealthBonus: 0,
      armorBonus: 0,
      critChanceBonus: 0,
    });
    state.equipment[slot] = id;
  }

  try {
    await redis.set(key, JSON.stringify(state));
    const result = await performCombatBeat(1, 'strike');
    assert.equal(result.defeated, true);
    assert.equal(result.state.depth, 50_000);
    assert.equal(result.state.bestDepth, 50_000);
    assert.equal(result.enemy.name, 'Crypt Warden');
    assert.ok(result.actions.some(action =>
      action.kind === 'advance' && action.text.includes('Maximum supported depth reached'),
    ));

    const savedRaw = await redis.get(key);
    assert.ok(savedRaw, 'combat state should persist');
    const saved = JSON.parse(savedRaw) as { depth: number; bestDepth: number };
    assert.equal(saved.depth, 50_000);
    assert.equal(saved.bestDepth, 50_000);
    assert.equal((saved as { depthCapCleared?: boolean }).depthCapCleared, true);

    // The cleared final boss must not be repeatedly farmable at the capped depth.
    await assert.rejects(
      () => performCombatBeat(2, 'strike'),
      /Maximum supported depth reached/,
    );
    const afterRejectedBeat = JSON.parse((await redis.get(key)) ?? '{}') as { depth: number; sequence: number };
    assert.equal(afterRejectedBeat.depth, 50_000);
    assert.equal(afterRejectedBeat.sequence, 1);
  } finally {
    await redis.del(key);
    context.userId = previousUserId;
  }
});

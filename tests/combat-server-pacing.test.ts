import test from 'node:test';
import assert from 'node:assert/strict';
import { context, redis, reddit, configureDevvitRuntime } from '../src/server/devvit-mock.js';
import { getCombatSnapshot, performCombatBeat } from '../src/server/combat.js';

test('server rejects combat fast-forwarding and preserves the next valid sequence', async () => {
  const originalNow = Date.now;
  const originalContext = context;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  configureDevvitRuntime({
    redis,
    context: { ...originalContext, userId: 'combat-pacing-regression-player' },
    reddit,
  });

  try {
    const first = await performCombatBeat(1, 'strike');
    assert.equal(first.state.sequence, 1);
    assert.equal(first.state.lastBeatAt, now);

    await assert.rejects(performCombatBeat(2, 'strike'), /combat beat cooling down/);
    const afterRejectedBeat = await getCombatSnapshot();
    assert.equal(afterRejectedBeat.state.sequence, 1, 'a rejected beat must not advance sequence');
    assert.equal(afterRejectedBeat.state.lastBeatAt, now, 'a rejected beat must not rewrite the cooldown timestamp');

    now += 999;
    await assert.rejects(performCombatBeat(2, 'strike'), /combat beat cooling down/);
    now += 1;

    const second = await performCombatBeat(2, 'strike');
    assert.equal(second.state.sequence, 2);
    assert.equal(second.state.lastBeatAt, now);
  } finally {
    Date.now = originalNow;
    configureDevvitRuntime({ redis, context: originalContext, reddit });
  }
});

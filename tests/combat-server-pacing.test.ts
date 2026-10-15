import test from 'node:test';
import assert from 'node:assert/strict';
import { context, redis, reddit, configureDevvitRuntime } from '../src/server/devvit-mock.js';
import { getCombatSnapshot, performCombatBeat } from '../src/server/combat.js';
import { createCombatState } from '../src/shared/combat.js';
import { createApp } from '../src/server/app.js';

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

    // A slightly-ahead instance clock must not pin the saved cooldown forever.
    const futureUserId = 'combat-pacing-future-clock-player';
    const futureState = createCombatState();
    futureState.lastBeatAt = now + 2_000;
    await redis.set('infinity-orbs:combat:' + futureUserId, JSON.stringify(futureState));
    configureDevvitRuntime({
      redis,
      context: { ...originalContext, userId: futureUserId },
      reddit,
    });
    await assert.rejects(performCombatBeat(1, 'strike'), /combat beat cooling down/);
    now = futureState.lastBeatAt + 1_000;
    const afterClockSkew = await performCombatBeat(1, 'strike');
    assert.equal(afterClockSkew.state.sequence, 1);
    assert.equal(afterClockSkew.state.lastBeatAt, now);
  } finally {
    Date.now = originalNow;
    configureDevvitRuntime({ redis, context: originalContext, reddit });
  }
});


test('combat beat API reports an early sequence as HTTP 429', async () => {
  const originalNow = Date.now;
  const originalContext = context;
  let now = 1_800_000_100_000;
  Date.now = () => now;
  configureDevvitRuntime({
    redis,
    context: { ...originalContext, userId: 'combat-pacing-route-player' },
    reddit,
  });
  const server = createApp().listen(0);

  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = 'http://127.0.0.1:' + address.port + '/api/combat/beat';
    const send = (sequence: number) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequence, intent: 'strike' }),
    });

    const first = await send(1);
    assert.equal(first.status, 200);
    const early = await send(2);
    assert.equal(early.status, 429);
    assert.deepEqual(await early.json(), { error: 'combat beat cooling down' });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    Date.now = originalNow;
    configureDevvitRuntime({ redis, context: originalContext, reddit });
  }
});

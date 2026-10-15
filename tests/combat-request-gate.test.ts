import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatRequestGate } from '../src/client/components/combat-request-gate.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('combat request gate serializes a player mutation after the active beat', async () => {
  const gate = createCombatRequestGate();
  const beatHold = deferred();
  const mutationHold = deferred();
  const mutationStarted = deferred();
  let active = 0;
  let peakActive = 0;

  const enter = () => {
    active += 1;
    peakActive = Math.max(peakActive, active);
  };
  const leave = () => { active -= 1; };

  const beat = gate.runBeat(async () => {
    enter();
    try {
      await beatHold.promise;
      return 'beat';
    } finally {
      leave();
    }
  });

  const mutation = gate.runMutation(async () => {
    enter();
    mutationStarted.resolve();
    try {
      await mutationHold.promise;
      return 'mutation';
    } finally {
      leave();
    }
  });

  // Timer ticks must be skipped, not queued behind a player action.
  assert.equal(await gate.runBeat(async () => 'stale beat'), undefined);
  assert.equal(await gate.runMutation(async () => 'duplicate mutation'), undefined);
  assert.equal(peakActive, 1);

  beatHold.resolve();
  assert.equal(await beat, 'beat');
  await mutationStarted.promise;
  assert.equal(active, 1);
  assert.equal(peakActive, 1);
  assert.equal(await gate.runBeat(async () => 'overlapping beat'), undefined);

  mutationHold.resolve();
  assert.equal(await mutation, 'mutation');
  assert.equal(gate.isBusy(), false);
  assert.equal(await gate.runBeat(async () => 'next beat'), 'next beat');
  assert.equal(peakActive, 1);
});

test('combat request gate releases after a failed mutation', async () => {
  const gate = createCombatRequestGate();
  await assert.rejects(
    gate.runMutation(async () => { throw new Error('expected failure'); }),
    /expected failure/,
  );
  assert.equal(gate.isBusy(), false);
  assert.equal(await gate.runBeat(async () => 'recovered'), 'recovered');
});

test('combat request gate keeps one beat exclusive when a second tick arrives', async () => {
  const gate = createCombatRequestGate();
  const hold = deferred();
  let calls = 0;

  const first = gate.runBeat(async () => {
    calls += 1;
    await hold.promise;
    return 'first';
  });
  const skipped = await gate.runBeat(async () => {
    calls += 1;
    return 'second';
  });

  assert.equal(skipped, undefined);
  assert.equal(calls, 1);
  hold.resolve();
  assert.equal(await first, 'first');
  assert.equal(gate.isBusy(), false);
});

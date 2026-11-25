import test from 'node:test';
import assert from 'node:assert/strict';
import { context, redis } from '../src/server/devvit-mock.js';
import { challengeCombatArena, getCombatArenaOpponents } from '../src/server/combat.js';

test('Arena challenges update win/loss records and enforce the challengers cooldown', async () => {
  const previousUserId = context.userId;
  const previousUsername = context.username;
  const arenaRegistryKey = 'infinity-orbs:combat:arena:profiles';
  const opponentId = 'arena-rating-regression-opponent';
  const challengerId = 'arena-rating-regression-challenger';
  const opponentKey = 'infinity-orbs:combat:' + opponentId;
  const challengerKey = 'infinity-orbs:combat:' + challengerId;

  // Keep the test independent of prior local runs and restore the mock identity
  // even when an assertion fails.
  await redis.del(arenaRegistryKey);
  await redis.del(opponentKey);
  await redis.del(challengerKey);

  try {
    context.userId = opponentId;
    context.username = 'ArenaOpponent';
    const opponentRegistration = await getCombatArenaOpponents();
    assert.equal(opponentRegistration.self.wins, 0);

    context.userId = challengerId;
    context.username = 'ArenaChallenger';
    const listing = await getCombatArenaOpponents();
    assert.ok(listing.opponents.some(profile => profile.userId === opponentId));
    assert.equal(listing.cooldownRemainingMs, 0);

    await assert.rejects(
      () => challengeCombatArena(challengerId),
      /ARENA_SELF_CHALLENGE/,
      'a player must not challenge their own build',
    );

    const beforeOpponent = JSON.parse((await redis.get(opponentKey)) ?? '{}') as {
      arenaRating?: number;
      arenaWins?: number;
      arenaLosses?: number;
    };
    const result = await challengeCombatArena(opponentId);
    const afterOpponent = JSON.parse((await redis.get(opponentKey)) ?? '{}') as {
      arenaRating?: number;
      arenaWins?: number;
      arenaLosses?: number;
    };
    const afterChallenger = JSON.parse((await redis.get(challengerKey)) ?? '{}') as {
      arenaRating?: number;
      arenaWins?: number;
      arenaLosses?: number;
      arenaLastChallengeAt?: number;
    };

    assert.ok(['you', 'opponent'].includes(result.arenaResult.winner));
    assert.ok(result.arenaResult.rounds >= 1 && result.arenaResult.rounds <= 100);
    assert.equal(result.state.arenaRating, 1000, 'legacy rating points are no longer changed by PvP');
    assert.equal(afterOpponent.arenaRating ?? 1000, beforeOpponent.arenaRating ?? 1000, 'opponent legacy rating remains untouched');
    assert.equal(afterChallenger.arenaRating ?? 1000, 1000, 'challenger legacy rating remains untouched');
    assert.equal((afterChallenger.arenaWins ?? 0) + (afterChallenger.arenaLosses ?? 0), 1);
    assert.equal((afterOpponent.arenaWins ?? 0) + (afterOpponent.arenaLosses ?? 0), 1);
    assert.ok((afterChallenger.arenaLastChallengeAt ?? 0) > 0);
    assert.equal(beforeOpponent.arenaRating, 1000);

    await assert.rejects(
      () => challengeCombatArena(opponentId),
      /ARENA_COOLDOWN:/,
      'a repeated challenge during the cooldown must not produce another result',
    );

    const afterRejectedRetry = JSON.parse((await redis.get(challengerKey)) ?? '{}') as {
      arenaWins?: number;
      arenaLosses?: number;
    };
    assert.equal((afterRejectedRetry.arenaWins ?? 0) + (afterRejectedRetry.arenaLosses ?? 0), 1,
      'a rejected retry must not update the players records');
  } finally {
    await redis.del(arenaRegistryKey);
    await redis.del(opponentKey);
    await redis.del(challengerKey);
    context.userId = previousUserId;
    context.username = previousUsername;
  }
});

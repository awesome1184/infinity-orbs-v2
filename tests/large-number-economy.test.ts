import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addCoinAmount,
  addCollectionValue,
  altarCoinFloor,
  coinsForRarity,
  createInitialState,
  formatNumber,
  normalizeCoinAmount,
  upgradeCost,
} from '../src/shared/game.js';
import { context, redis } from '../src/server/devvit-mock.js';
import { buyUpgradeBatch, loadRaw, save } from '../src/server/game.js';

test('Coin balances and rewards can grow beyond the JavaScript safe-integer threshold', () => {
  const beyondSafeInteger = 1e30;
  const normalizedLargeBalance = normalizeCoinAmount(beyondSafeInteger);
  assert.equal(normalizedLargeBalance, Math.floor(beyondSafeInteger));
  const combinedBalance = addCoinAmount(Number.MAX_SAFE_INTEGER, beyondSafeInteger);
  assert.ok(Number.isFinite(combinedBalance));
  assert.ok(combinedBalance > normalizedLargeBalance);
  const accumulated = addCoinAmount(1e200, 2e200);
  assert.ok(Number.isFinite(accumulated));
  assert.ok(accumulated > Number.MAX_SAFE_INTEGER);
});

test('Coin and collection totals saturate only at the largest finite Number', () => {
  assert.equal(normalizeCoinAmount(Number.POSITIVE_INFINITY), Number.MAX_VALUE);
  assert.equal(addCoinAmount(Number.MAX_VALUE * 0.75, Number.MAX_VALUE), Number.MAX_VALUE);
  assert.equal(addCollectionValue(1e200, 2e200), 3e200);
  assert.equal(addCollectionValue(Number.MAX_VALUE, 1e200), Number.MAX_VALUE);
});

test('Altar Coin requirements can scale beyond the safe-integer threshold', () => {
  assert.ok(altarCoinFloor(100) > Number.MAX_SAFE_INTEGER);
  assert.equal(altarCoinFloor(100_000), Number.MAX_VALUE);
});

test('rarity-derived Coin rewards remain above 64-bit-safe integer scale', () => {
  const coins = coinsForRarity(1e308);
  assert.ok(Number.isFinite(coins));
  assert.ok(coins > Number.MAX_SAFE_INTEGER);
});

test('large finite Coin balances retain scientific-notation display', () => {
  assert.equal(formatNumber(1e100), '1.00e100');
  assert.equal(formatNumber(Number.MAX_VALUE), '1.80e308');
});

test('save, load, and admin grant paths preserve Coin balances above MAX_SAFE_INTEGER', () => {
  const server = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const debug = readFileSync(resolve(process.cwd(), 'src/server/debug.ts'), 'utf8');
  assert.match(server, /coins:\s*normalizeCoinAmount\(parsed\.coins\)/);
  assert.match(server, /lifetimeCoins:\s*normalizeCoinAmount\(parsed\.lifetimeCoins\s*\?\?\s*parsed\.coins\)/);
  assert.match(server, /s\.coins = normalizeCoinAmount\(s\.coins\)/);
  assert.match(server, /const currentCoins = normalizeCoinAmount\(s\.coins\)/);
  assert.match(debug, /s\.coins = coinDelta >= 0[\s\S]*?addCoinAmount\(s\.coins, coinDelta\)/);
});

test('repeatable upgrades remain persisted when their costs exceed MAX_SAFE_INTEGER', async () => {
  const previousUserId = context.userId;
  const previousUsername = context.username;
  const userId = 'coin-boundary-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  context.userId = userId;
  context.username = 'CoinBoundaryTester';

  try {
    let boundaryLevel = 0;
    while (upgradeCost('multi', boundaryLevel) <= Number.MAX_SAFE_INTEGER) {
      boundaryLevel += 1;
    }
    const boundaryCost = upgradeCost('multi', boundaryLevel);
    assert.ok(Number.isFinite(boundaryCost), 'the first cost above MAX_SAFE_INTEGER should still be finite');
    assert.ok(boundaryCost > Number.MAX_SAFE_INTEGER);

    const state = createInitialState();
    const startingCoins = boundaryCost * 4;
    assert.ok(Number.isFinite(startingCoins));
    state.coins = startingCoins;
    state.lifetimeCoins = startingCoins;
    state.upgrades.multi = boundaryLevel;
    state.level = 1;
    state.lastSeenAt = Date.now();
    state.saveGeneration = 0;
    state.stateRevision = 0;
    await save(state);

    const purchase = await buyUpgradeBatch(['multi']);
    assert.equal(purchase.purchased.length, 1, purchase.stoppedReason ?? 'large-cost upgrade should be accepted');
    assert.equal(purchase.purchased[0].cost, boundaryCost);
    assert.equal(purchase.purchased[0].level, boundaryLevel + 1);

    // The critical regression: loadRaw must not clamp the newly purchased level
    // back to the last level whose price happened to fit inside MAX_SAFE_INTEGER.
    const reloaded = await loadRaw({ registerActivity: false });
    assert.equal(reloaded.upgrades.multi, boundaryLevel + 1);
    assert.equal(reloaded.coins, purchase.state.coins);
    assert.ok(reloaded.coins < startingCoins, 'the large Coin cost must remain deducted after reload');
  } finally {
    await redis.del('player:' + userId).catch(() => undefined);
    await redis.del('player-generation:' + userId).catch(() => undefined);
    await redis.del('io:player-mutation-lock:' + userId).catch(() => undefined);
    await redis.hDel('io:player-registry', userId).catch(() => undefined);
    context.userId = previousUserId;
    context.username = previousUsername;
  }
});


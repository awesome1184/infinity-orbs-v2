import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nextCodexChainRarity } from '../src/shared/game.js';
import {
  CODEX_MIGRATION_BATCH_SIZE,
  CODEX_SHARD_COUNT,
  CODEX_STORAGE_VERSION,
  codexShardIndex,
  codexShardKey,
  groupCodexFields,
  codexRarityBucket,
  nextCodexRarityBucket,
  previousCodexRarityBucket,
} from '../src/shared/collection-storage.js';

test('Codex rarity keys use stable, generation-scoped shards', () => {
  assert.equal(CODEX_STORAGE_VERSION, 2);
  assert.equal(CODEX_SHARD_COUNT, 16);
  for (const key of ['2', '3', '10', '100', '1000', '1e+100', 'Infinity']) {
    assert.equal(codexShardIndex(key), codexShardIndex(key));
    assert.ok(codexShardIndex(key) >= 0 && codexShardIndex(key) < CODEX_SHARD_COUNT);
  }
  assert.notEqual(codexShardKey('player-a', 0, 1), codexShardKey('player-b', 0, 1));
  assert.notEqual(codexShardKey('player-a', 0, 1), codexShardKey('player-a', 1, 1));
});

test('Codex preserves exact rarities through 1/10,000 and uses four significant digits above it', () => {
  assert.equal(codexRarityBucket(9_999), 9_999);
  assert.equal(codexRarityBucket(10_000), 10_000);
  assert.equal(codexRarityBucket(10_001), 10_010);
  assert.equal(codexRarityBucket(10_009), 10_010);
  assert.equal(codexRarityBucket(10_010), 10_010);
  assert.equal(codexRarityBucket(329_300_123), 329_300_000);
  assert.equal(codexRarityBucket(329_399_999), 329_300_000);
  assert.equal(codexRarityBucket(329_400_000), 329_400_000);
  assert.equal(nextCodexRarityBucket(9_999), 10_000);
  assert.equal(nextCodexRarityBucket(10_000), 10_010);
  assert.equal(nextCodexRarityBucket(99_990), 100_000);
  assert.equal(nextCodexRarityBucket(100_000), 100_100);
  assert.equal(nextCodexRarityBucket(329_300_000), 329_400_000);
  assert.equal(nextCodexChainRarity({ '329300000': 1 }), 329_400_000);
  assert.equal(previousCodexRarityBucket(10_010), 10_000);
  assert.equal(previousCodexRarityBucket(100_000), 99_990);
  assert.equal(previousCodexRarityBucket(329_400_000), 329_300_000);
});

test('Codex updates write only changed rarity counts', () => {
  const grouped = groupCodexFields([['2', 14], ['100', 7], ['Infinity', 1]]);
  const flattened = grouped.flatMap(item => Object.entries(item.fields));
  assert.equal(flattened.length, 3);
  assert.deepEqual(Object.fromEntries(flattened), { '2': '14', '100': '7', Infinity: '1' });
  assert.ok(grouped.every(item => Object.keys(item.fields).length > 0));
  assert.ok(CODEX_MIGRATION_BATCH_SIZE <= 512);
});

test('normal player save stores Codex deltas outside the large player JSON', () => {
  const game = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const save = game.slice(game.indexOf('export async function save('), game.indexOf('\nfunction serverRandom'));
  const load = game.slice(game.indexOf('export async function loadRaw('), game.indexOf('\nfunction applyXp'));
  const payment = game.slice(game.indexOf('export async function grantPurchasedPack'), game.indexOf('export async function loadRaw'));
  assert.match(save, /pendingCodexRarityWrites/);
  assert.match(save, /txn\.hSet\(codexWriteKeys\[index\], codexWrites\[index\]\.fields\)/);
  assert.match(save, /serializePlayerStateForRedis\(nextState\)/);
  assert.match(load, /readCodexShards\(userId, generation\)/);
  assert.match(game, /ensureCodexStorageVersion\(userId, generation, state\)/);
  assert.equal((payment.match(/serializePlayerStateForRedis\(state\)/g) ?? []).length, 2);
  assert.match(load, /migrateLegacyCodex\(userId, generation, restoredCollection\)/);
  assert.match(game, /markCodexRarityWrite\(s, key\)/);
});


test('client snapshots preserve Codex Devotion projections after stripping the full collection', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
  const mastery = readFileSync(resolve(process.cwd(), 'src/client/components/MasterySection.tsx'), 'utf8');
  const strip = app.slice(app.indexOf('const stripPlayerCollection'), app.indexOf('// Persistent player data'));
  assert.match(strip, /copy\.codexChain = codexChain\.length/);
  assert.match(strip, /copy\.codexChainStart = codexChain\.start/);
  assert.match(strip, /copy\.codexChainEnd = codexChain\.end/);
  assert.match(strip, /copy\.codexDevotionLuckPercent = codexDevotionLuckPercent\(/);
  assert.match(strip, /copy\.collection = \{\}/);
  assert.match(mastery, /Number\.isFinite\(Number\(state\.codexChain\)\)/);
  assert.match(mastery, /codexDevotionLuckPercent\(currentLevel, codexChainLength\)/);
});

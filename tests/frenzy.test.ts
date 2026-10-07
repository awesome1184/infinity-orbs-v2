import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createInitialState,
  frenzyOrbCountForRarity,
  frenzyClaimCountForRarity,
  grantFrenzyOwnerShards,
  FRENZY_OWNER_SHARD_REWARD,
  FRENZY_PROMPT_DELAY_MS,
  FRENZY_CLAIM_MAX_ORBS,
  canShowDailyFrenzyPrompt,
  todayKey,
} from '../src/shared/game.js';

const NOW = 1_800_000_000_000;

test('Frenzy claim size is multiplied by Multi Roll', () => {
  const base = frenzyOrbCountForRarity(1_000_000);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 1), base);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 4), base * 4);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 0), base);
});

test('Frenzy Volley keeps its existing bonus on top of the Multi Roll multiplier', () => {
  const base = frenzyOrbCountForRarity(10_000);
  const multi = 5;
  assert.equal(
    frenzyClaimCountForRarity(10_000, multi, 1),
    Math.floor(base * multi * 1.8),
  );
});

test('Frenzy claim size is capped safely', () => {
  assert.equal(
    frenzyClaimCountForRarity(1e100, 1e100),
    FRENZY_CLAIM_MAX_ORBS,
  );
});

test('Frenzy owner reward bypasses the normal 50-Shard daily cap', () => {
  const state = createInitialState(NOW);
  state.shards = 50;
  state.lifetimeShards = 50;
  state.lastFreeShardReset = todayKey(NOW);
  state.freeShardsEarnedToday = 50;

  const granted = grantFrenzyOwnerShards(state);

  assert.equal(granted, FRENZY_OWNER_SHARD_REWARD);
  assert.equal(state.shards, 55);
  assert.equal(state.lifetimeShards, 55);
  assert.equal(state.freeShardsEarnedToday, 50);
});

test('Frenzy prompt is delayed by three minutes and is daily', () => {
  assert.equal(FRENZY_PROMPT_DELAY_MS, 3 * 60_000);

  const today = todayKey(NOW);
  assert.equal(canShowDailyFrenzyPrompt(today, NOW), false);
  assert.equal(canShowDailyFrenzyPrompt('yesterday', NOW), true);
});

test('posted Frenzy opens the actual game entrypoint from the claim button', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  assert.match(source, /requestExpandedMode\(event\.nativeEvent, ['"]game['"]\)/);
  assert.match(source, /Click below to claim it\. You can only claim one a day\./);
  assert.match(source, /io-frenzy-rarity-number/);
  assert.match(source, /Your Multi Roll multiplies the Frenzy size/);
  assert.match(source, /bypasses the 50 Shard daily cap/);
});

test('posted Frenzy rarity uses the rarity color and roll-up animation', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  const styles = readFileSync(resolve(process.cwd(), 'src/client/styles.css'), 'utf8');
  assert.match(source, /getOrbInfo\(info\.rarity\)/);
  assert.match(source, /style=\{\{ color \}\}/);
  assert.match(styles, /@keyframes io-frenzy-number-roll/);
  assert.match(styles, /\.io-frenzy-rarity-number/);
});

test('starting a Frenzy creates a dedicated public Frenzy post', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /entry: 'frenzy'/);
  assert.match(source, /postId = String\(post\?\.id/);
  assert.match(source, /FRENZY_OWNER_SHARD_REWARD/);
});

test('Frenzy claims expose one-per-day eligibility and test self-claim', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /canClaim: !claimedToday/);
  assert.match(source, /selfClaimTest/);
  assert.match(source, /data\.adminTest === true/);
});


test('daily Frenzy prompt appears after the delay and explains the owner reward', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(source, /FRENZY_PROMPT_DELAY_MS/);
  assert.match(source, /Post today’s Frenzy/);
  assert.match(source, /\+\{FRENZY_OWNER_SHARD_REWARD\} Shards/);
  assert.match(source, /bypasses the 50 Shard daily cap/);
  assert.match(source, /localStorage\.setItem\(storageKey, '1'\)/);
});

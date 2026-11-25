import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAdminSaveCommands } from '../src/shared/admin-save-commands.js';

function state() {
  return {
    username: 'sample',
    stateRevision: 4,
    saveGeneration: 2,
    coins: 100,
    shards: 5,
    totalRolls: 20,
    level: 3,
    xp: 120,
    highestRarity: 10,
    lastRollAt: null,
    activeCosmetic: 'default',
    collection: { '10': 4 },
    upgrades: { speed: 2, luck: 1 },
    prestigeUpgrades: { instantReveal: 0 },
    masterySkills: { continuumLuck: 0 },
    automations: { autoUpgrade: false },
    streak: { count: 3 },
    dailyQuests: [{ progress: 1, claimed: false }],
  };
}

test('Execute As applies multiple save commands to a copy and reports each write', () => {
  const original = state();
  const result = applyAdminSaveCommands(original, [
    '# Grant some test resources',
    'set coins 1e40',
    'add shards 5',
    'set upgrades.speed 12',
    'set automations.autoUpgrade true',
    'subtract streak.count 1',
  ].join('\n'));

  assert.equal(result.state.coins, 1e40);
  assert.equal(result.state.shards, 10);
  assert.equal(result.state.upgrades.speed, 12);
  assert.equal(result.state.automations.autoUpgrade, true);
  assert.equal(result.state.streak.count, 2);
  assert.equal(original.coins, 100);
  assert.equal(result.results.length, 5);
});

test('Execute As rejects internal metadata, external Codex storage, and prototype paths', () => {
  for (const command of [
    'set username admin',
    'set stateRevision 0',
    'set saveGeneration 0',
    'set collection.10 100',
    'set upgrades.__proto__.speed 999',
    'set upgrades.constructor 999',
  ]) {
    assert.throws(() => applyAdminSaveCommands(state(), command));
  }
});

test('Execute As rejects unsafe numeric balances and invalid arithmetic', () => {
  assert.throws(() => applyAdminSaveCommands(state(), 'set shards -1'), /non-negative/);
  assert.throws(() => applyAdminSaveCommands(state(), 'subtract coins 101'), /finite and non-negative/);
  assert.throws(() => applyAdminSaveCommands(state(), 'add activeCosmetic 1'), /numeric/);
  assert.throws(() => applyAdminSaveCommands(state(), 'set coins Infinity'));
});

test('Execute As supports numeric paths into existing save arrays', () => {
  const result = applyAdminSaveCommands(state(), 'add dailyQuests.0.progress 2');
  assert.equal(result.state.dailyQuests[0].progress, 3);
});

test('Execute As can assign values to nullable top-level save fields', () => {
  const result = applyAdminSaveCommands(state(), 'set lastRollAt 0');
  assert.equal(result.state.lastRollAt, 0);
});

test('Execute As can initialize optional nested save objects without replacing other fields', () => {
  const result = applyAdminSaveCommands(state(), 'set activeBoosters.fortune 123456789');
  assert.deepEqual(result.state.activeBoosters, { fortune: 123456789 });
});

test('Execute As supports deleting optional nested fields but never required save roots', () => {
  const result = applyAdminSaveCommands(state(), 'delete upgrades.luck');
  assert.equal('luck' in result.state.upgrades, false);
  assert.throws(() => applyAdminSaveCommands(state(), 'delete coins'), /cannot be deleted/);
});

test('Execute As enforces command-count and script-size limits', () => {
  assert.throws(() => applyAdminSaveCommands(state(), Array.from({ length: 51 }, () => 'add coins 1').join('\n')), /at most 50/);
  assert.throws(() => applyAdminSaveCommands(state(), 'set coins ' + '1'.repeat(12_100)), /too long/);
});

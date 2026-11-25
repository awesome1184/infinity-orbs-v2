import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminCliCommand } from '../src/shared/admin-cli.js';
import {
  DEFAULT_LIVE_BALANCE_CONFIG,
  LIVE_BALANCE_SETTINGS,
  normalizeLiveBalanceConfig,
  validateLiveBalanceValue,
} from '../src/shared/live-balance.js';

test('live balance registry contains unique, bounded settings with documented defaults', () => {
  const keys = LIVE_BALANCE_SETTINGS.map(setting => setting.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(DEFAULT_LIVE_BALANCE_CONFIG['roll.baseCooldownMs'], 15_000);
  assert.deepEqual(DEFAULT_LIVE_BALANCE_CONFIG['rewards.coinMultiplier'], 1);
  assert.deepEqual(DEFAULT_LIVE_BALANCE_CONFIG['offline.generationMultiplier'], 1);
  for (const setting of LIVE_BALANCE_SETTINGS) {
    assert.ok(setting.min <= setting.defaultValue && setting.defaultValue <= setting.max);
    assert.ok(setting.step > 0);
  }
});

test('live balance normalization falls back to defaults for missing or invalid values', () => {
  const normalized = normalizeLiveBalanceConfig({
    'roll.baseCooldownMs': 8_000,
    'rewards.coinMultiplier': 1.5,
    'rewards.xpMultiplier': Number.NaN,
    'offline.generationMultiplier': 999,
    unknownKey: 5,
  });
  assert.equal(normalized['roll.baseCooldownMs'], 8_000);
  assert.equal(normalized['rewards.coinMultiplier'], 1.5);
  assert.equal(normalized['rewards.xpMultiplier'], 1);
  assert.equal(normalized['offline.generationMultiplier'], 1);
  assert.equal(Object.keys(normalized).length, LIVE_BALANCE_SETTINGS.length);
});

test('live balance values enforce a whitelist and per-setting bounds', () => {
  assert.equal(validateLiveBalanceValue('roll.baseCooldownMs', 8_000), 8_000);
  assert.equal(validateLiveBalanceValue('rewards.coinMultiplier', 1.25), 1.25);
  assert.equal(validateLiveBalanceValue('rewards.coinMultiplier', 0), 0);
  assert.throws(() => validateLiveBalanceValue('roll.baseCooldownMs', 60_001), /between/);
  assert.throws(() => validateLiveBalanceValue('roll.minimumCooldownMs', 100), /between/);
  assert.throws(() => validateLiveBalanceValue('roll.baseCooldownMs', Number.NaN), /finite/);
  assert.throws(() => validateLiveBalanceValue('arbitrary.path', 1), /Unknown balance setting/);
});

test('Admin CLI supports global balance inspection and safe mutation commands', () => {
  assert.deepEqual(parseAdminCliCommand('balance list'), { kind: 'balance', action: 'list' });
  assert.deepEqual(parseAdminCliCommand('balance history'), { kind: 'balance', action: 'history' });
  assert.deepEqual(parseAdminCliCommand('balance get roll.baseCooldownMs'), {
    kind: 'balance', action: 'get', key: 'roll.baseCooldownMs',
  });
  assert.deepEqual(parseAdminCliCommand('balance set roll.baseCooldownMs 8000'), {
    kind: 'balance', action: 'set', key: 'roll.baseCooldownMs', value: 8000,
  });
  assert.deepEqual(parseAdminCliCommand('balance preview rewards.coinMultiplier 1.5'), {
    kind: 'balance', action: 'preview', key: 'rewards.coinMultiplier', value: 1.5,
  });
  assert.deepEqual(parseAdminCliCommand('balance reset rewards.coinMultiplier'), {
    kind: 'balance', action: 'reset', key: 'rewards.coinMultiplier',
  });
  assert.deepEqual(parseAdminCliCommand('balance reset all'), {
    kind: 'balance', action: 'reset-all',
  });
  assert.deepEqual(parseAdminCliCommand('balance rollback 12'), {
    kind: 'balance', action: 'rollback', revision: 12,
  });
});

test('Admin CLI rejects unknown, out-of-range, non-finite, and malformed balance commands', () => {
  assert.throws(() => parseAdminCliCommand('balance set roll.baseCooldownMs 70000'), /between/);
  assert.throws(() => parseAdminCliCommand('balance set rewards.coinMultiplier NaN'), /finite/);
  assert.throws(() => parseAdminCliCommand('balance set no.such.setting 2'), /Unknown balance setting/);
  assert.throws(() => parseAdminCliCommand('balance get no.such.setting'), /Unknown balance setting/);
  assert.throws(() => parseAdminCliCommand('balance reset no.such.setting'), /Unknown balance setting/);
  assert.throws(() => parseAdminCliCommand('balance rollback 0'), /positive whole number/);
  assert.throws(() => parseAdminCliCommand('balance set roll.baseCooldownMs -1'), /finite, non-negative/);
  assert.throws(() => parseAdminCliCommand('balance'), /accept only set, add, subtract, and delete/);
});

test('all live balance commands are global, not player-targeted save operations', () => {
  for (const command of [
    'balance list',
    'balance get roll.baseCooldownMs',
    'balance preview roll.baseCooldownMs 5000',
    'balance set roll.baseCooldownMs 5000',
    'balance reset roll.baseCooldownMs',
    'balance reset all',
    'balance history',
    'balance rollback 2',
  ]) {
    assert.equal(parseAdminCliCommand(command).kind, 'balance', command);
  }
});

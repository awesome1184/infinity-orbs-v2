import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminCliCommand } from '../src/shared/admin-cli.js';

test('CLI can disable menus globally with a developer reason and re-enable them', () => {
  assert.deepEqual(parseAdminCliCommand('menus disable'), {
    kind: 'menus',
    enabled: false,
    reason: 'The developer has disabled the menus.',
  });
  assert.deepEqual(parseAdminCliCommand('menus off "Maintenance window"'), {
    kind: 'menus',
    enabled: false,
    reason: 'Maintenance window',
  });
  assert.deepEqual(parseAdminCliCommand('menus enable'), {
    kind: 'menus',
    enabled: true,
    reason: '',
  });
});

test('CLI supports global developer announcements', () => {
  assert.deepEqual(parseAdminCliCommand('announce "We are performing maintenance."'), {
    kind: 'announcement',
    message: 'We are performing maintenance.',
  });
  assert.deepEqual(parseAdminCliCommand('announce clear'), {
    kind: 'announcement',
    message: '',
  });
});

test('CLI maps player grants and cooldown actions to guarded save commands', () => {
  assert.deepEqual(parseAdminCliCommand('give coins 250'), {
    kind: 'player-save',
    commands: 'add coins 250\nadd lifetimeCoins 250',
    invalidateRollTicket: false,
  });
  assert.deepEqual(parseAdminCliCommand('give shards 10'), {
    kind: 'player-save',
    commands: 'add shards 10\nadd lifetimeShards 10',
    invalidateRollTicket: false,
  });
  assert.deepEqual(parseAdminCliCommand('give coins 1e50'), {
    kind: 'player-save',
    commands: 'add coins 1e+50\nadd lifetimeCoins 1e+50',
    invalidateRollTicket: false,
  });
  assert.deepEqual(parseAdminCliCommand('cooldown ready'), {
    kind: 'player-save',
    commands: 'set lastRollAt 0',
    invalidateRollTicket: true,
  });
});

test('CLI maps upgrade, mastery, prestige, booster, and offline commands', () => {
  assert.equal(parseAdminCliCommand('upgrade speed 20').kind, 'player-save');
  assert.equal(parseAdminCliCommand('upgrade speed 20').commands, 'set upgrades.speed 20');
  assert.equal(parseAdminCliCommand('mastery continuumLuck 50').commands, 'set masterySkills.continuumLuck 50');
  assert.equal(parseAdminCliCommand('prestige-upgrade permLuck 10').commands, 'set prestigeUpgrades.permLuck 10');
  assert.match(parseAdminCliCommand('boost fortune 30').commands, /^set activeBoosters\.fortune \d+$/);
  assert.equal(parseAdminCliCommand('offline add 25').commands, 'add offlineRolls 25');
  assert.equal(parseAdminCliCommand('offline set 0').commands, 'set offlineRolls 0');
});

test('CLI passes bounded save-command batches through without evaluating code', () => {
  const parsed = parseAdminCliCommand([
    '# Player save batch',
    'set coins 1e30',
    'add shards 5',
    'set upgrades.speed 20',
  ].join('\n'));
  assert.equal(parsed.kind, 'player-save');
  assert.equal(parsed.commands, 'set coins 1e30\nadd shards 5\nset upgrades.speed 20');
  assert.throws(() => parseAdminCliCommand('run process.exit(1)'), /accept only set, add, subtract, and delete/);
  assert.throws(() => parseAdminCliCommand('menus disable\nset coins 0'), /accept only set, add, subtract, and delete/);
});

test('CLI enforces positive and bounded grant arguments', () => {
  assert.throws(() => parseAdminCliCommand('give coins 0'), /greater than zero/);
  assert.throws(() => parseAdminCliCommand('give shards 1.5'), /whole numbers/);
  assert.throws(() => parseAdminCliCommand('offline add -10'), /finite, non-negative/);
  assert.throws(() => parseAdminCliCommand('give coins -10'), /finite, non-negative/);
  assert.throws(() => parseAdminCliCommand('boost fortune 20000'), /between 1 and 10,080/);
  const longReason = parseAdminCliCommand('menus disable ' + 'x'.repeat(400));
  assert.equal(longReason.kind, 'menus');
  if (longReason.kind === 'menus') assert.equal(longReason.reason.length, 300);
});

test('CLI supports global feature switches with defaults, reasons, and status listing', () => {
  assert.deepEqual(parseAdminCliCommand('feature combat disable'), {
    kind: 'feature', feature: 'combat', enabled: false, reason: 'The developer has disabled combat.',
  });
  assert.deepEqual(parseAdminCliCommand('feature guilds off "Guild maintenance"'), {
    kind: 'feature', feature: 'guilds', enabled: false, reason: 'Guild maintenance',
  });
  assert.deepEqual(parseAdminCliCommand('feature combat enable'), {
    kind: 'feature', feature: 'combat', enabled: true, reason: '',
  });
  assert.deepEqual(parseAdminCliCommand('features'), { kind: 'feature-list' });
  assert.throws(() => parseAdminCliCommand('feature trading disable'), /Unknown global feature/);
  assert.throws(() => parseAdminCliCommand('feature combat enable reason'), /Do not provide a reason/);
});

test('global feature request mapping separates read and write controls', async () => {
  const { globalFeatureForRequest, globalFeaturesForRequest } = await import('../src/shared/admin-cli.js');
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/roll'), ['gameplay', 'player-actions', 'rolling']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/auto-roll'), ['gameplay', 'player-actions', 'rolling', 'automation', 'auto-roll']);
  assert.deepEqual(globalFeaturesForRequest('GET', '/api/roll-ticket'), ['gameplay', 'rolling']);
  assert.deepEqual(globalFeaturesForRequest('GET', '/api/time-energy/progress'), ['gameplay', 'rolling', 'time-energy']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/dungeon'), ['gameplay', 'player-actions', 'combat', 'dungeons']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/forge'), ['gameplay', 'player-actions', 'combat', 'gear', 'gear-forge']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/gear/scrap'), ['gameplay', 'player-actions', 'combat', 'gear', 'gear-scrapping']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/auto-scrap'), ['gameplay', 'player-actions', 'combat', 'gear', 'gear-auto-scrap']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/skills/roll'), ['gameplay', 'player-actions', 'combat', 'skills']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/runes/equip'), ['gameplay', 'player-actions', 'combat', 'runes']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/runes/auto-sacrifice/run'), ['gameplay', 'player-actions', 'combat', 'runes', 'rune-auto-sacrifice']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/arena/challenge'), ['gameplay', 'player-actions', 'combat', 'arena']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/tactics'), ['gameplay', 'player-actions', 'combat', 'combat-tactics']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/upgrades/buy'), ['gameplay', 'player-actions', 'combat', 'combat-upgrades']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/combat/strategy-guide/buy'), ['gameplay', 'player-actions', 'combat', 'strategy-guide']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/guilds/create'), ['gameplay', 'player-actions', 'social', 'guilds', 'guild-membership']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/guilds/perk'), ['gameplay', 'player-actions', 'social', 'guilds', 'guild-perks']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/guilds/trust'), ['gameplay', 'player-actions', 'social', 'guilds', 'guild-trust']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/guilds/kick'), ['gameplay', 'player-actions', 'social', 'guilds', 'guild-moderation']);
  assert.deepEqual(globalFeaturesForRequest('GET', '/api/chat'), ['gameplay', 'social', 'chat']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/chat'), ['gameplay', 'player-actions', 'social', 'chat', 'chat-posting']);
  assert.deepEqual(globalFeaturesForRequest('GET', '/api/leaderboards'), ['gameplay', 'leaderboards']);
  assert.deepEqual(globalFeaturesForRequest('GET', '/api/collection'), ['gameplay', 'collection']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/streak/claim'), ['gameplay', 'player-actions', 'rewards', 'daily-rewards']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/quests/claim'), ['gameplay', 'player-actions', 'rewards', 'quests']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/prestige/upgrade'), ['gameplay', 'player-actions', 'prestige', 'prestige-upgrades']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/prestige/synthesize'), ['gameplay', 'player-actions', 'prestige', 'prestige-synthesis']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/chain-patcher/buy'), ['gameplay', 'player-actions', 'upgrades', 'chain-patcher']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/altar/sacrifice'), ['gameplay', 'player-actions', 'upgrades', 'altar']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/frenzy/start'), ['gameplay', 'player-actions', 'events', 'frenzy', 'frenzy-setup']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/frenzy/claim'), ['gameplay', 'player-actions', 'events', 'frenzy', 'frenzy-rewards']);
  assert.deepEqual(globalFeaturesForRequest('GET', '/api/world-event'), ['gameplay', 'events', 'world-events']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/global-boosters/activate'), ['gameplay', 'player-actions', 'global-boosters', 'global-booster-activation']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/notifications'), ['gameplay', 'player-actions', 'notifications']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/feedback'), ['gameplay', 'feedback']);
  assert.deepEqual(globalFeaturesForRequest('GET', '/api/products'), ['gameplay', 'purchases', 'product-catalog']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/payments/reconcile'), ['gameplay', 'player-actions', 'purchases', 'purchase-reconciliation']);
  assert.deepEqual(globalFeaturesForRequest('GET', '/api/online'), ['gameplay', 'presence']);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/upgrade/batch'), ['gameplay', 'player-actions', 'upgrades', 'bulk-upgrades']);
  assert.equal(globalFeatureForRequest('POST', '/api/roll'), 'rolling');
  assert.equal(globalFeatureForRequest('POST', '/api/auto-roll'), 'auto-roll');
  assert.equal(globalFeatureForRequest('GET', '/api/roll'), null);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/frenzy/simulator/create'), []);
});

test('global feature gate leaves admin, moderation reports, and telemetry available', async () => {
  const { globalFeaturesForRequest } = await import('../src/shared/admin-cli.js');
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/dev/cli/execute'), []);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/chat/report'), []);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/activity/heartbeat'), []);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/impressions'), []);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/impressions/conversion'), []);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/diagnostics/upgrade-rollback'), []);
  assert.deepEqual(globalFeaturesForRequest('POST', '/api/frenzy/simulator/create'), []);
});

import { getLiveBalanceSetting, validateLiveBalanceValue } from './live-balance.js';
/**
 * Admin Console command grammar. Intentionally not a JavaScript interpreter.
 * The caller still has to pass the server-side admin gate before this parser
 * is reached.
 */

export const GLOBAL_FEATURES = [
  { id: 'gameplay', label: 'Gameplay', description: 'Master switch for all classified player-facing game actions and sections' },
  { id: 'player-actions', label: 'Player actions', description: 'Read-only mode: blocks player-triggered mutations while leaving read endpoints available' },
  { id: 'rolling', label: 'Rolling', description: 'Manual orb rolls and roll-ticket requests' },
  { id: 'auto-roll', label: 'Auto rolling', description: 'Automated rolling' },
  { id: 'offline', label: 'Offline rewards', description: 'Offline roll claims' },
  { id: 'time-energy', label: 'Time Energy', description: 'Time Energy progress and refill status' },
  { id: 'upgrades', label: 'Upgrades', description: 'Regular upgrades and purchase-based progression' },
  { id: 'bulk-upgrades', label: 'Bulk upgrades', description: 'Buy-all and batch upgrade endpoints' },
  { id: 'chain-patcher', label: 'Chain Patcher', description: 'Chain Patcher purchases' },
  { id: 'altar', label: 'Altar', description: 'Altar sacrifice actions' },
  { id: 'mastery', label: 'Mastery', description: 'Mastery skill upgrades' },
  { id: 'boosters', label: 'Boosters and automation', description: 'Personal boosters, automation, and Turbo' },
  { id: 'personal-boosters', label: 'Personal boosters', description: 'Activation of personal timed boosters' },
  { id: 'automation', label: 'Automation', description: 'Automation purchases and automated actions' },
  { id: 'turbo', label: 'Turbo', description: 'Turbo activation' },
  { id: 'cosmetics', label: 'Cosmetics', description: 'Cosmetic purchases and unlocks' },
  { id: 'prestige', label: 'Prestige', description: 'Prestige resets, permanent upgrades, and synthesis' },
  { id: 'prestige-upgrades', label: 'Prestige upgrades', description: 'Permanent Prestige upgrade purchases' },
  { id: 'prestige-synthesis', label: 'Prestige synthesis', description: 'Prestige synthesis actions' },
  { id: 'combat', label: 'Combat', description: 'All combat actions and combat data' },
  { id: 'dungeons', label: 'Dungeons', description: 'Dungeon encounters and progression' },
  { id: 'gear', label: 'Combat gear', description: 'Gear equip, forge, scrap, and auto-scrap' },
  { id: 'gear-equipping', label: 'Gear equipping', description: 'Equip and swap combat gear' },
  { id: 'gear-forge', label: 'Gear forging', description: 'Forge combat gear' },
  { id: 'gear-scrapping', label: 'Gear scrapping', description: 'Scrap or salvage combat gear' },
  { id: 'gear-auto-scrap', label: 'Gear auto-scrap', description: 'Automatic gear scrapping settings and runs' },
  { id: 'skills', label: 'Combat skills', description: 'Combat skill rolls, equipment, and rank-ups' },
  { id: 'runes', label: 'Combat runes', description: 'Rune equipment, sacrifice, and auto-sacrifice' },
  { id: 'rune-auto-sacrifice', label: 'Rune auto-sacrifice', description: 'Rune auto-sacrifice settings and execution' },
  { id: 'combat-tactics', label: 'Combat tactics', description: 'Combat tactic selection and configuration' },
  { id: 'combat-upgrades', label: 'Combat upgrades', description: 'Combat-specific upgrade purchases' },
  { id: 'strategy-guide', label: 'Strategy guide', description: 'Combat strategy guide purchases' },
  { id: 'arena', label: 'Combat arena', description: 'Arena opponents and challenges' },
  { id: 'social', label: 'Social systems', description: 'Master switch for guilds, chat, sharing, and community interactions' },
  { id: 'guilds', label: 'Guilds', description: 'Guild creation, membership, perks, trust, and moderation actions' },
  { id: 'guild-membership', label: 'Guild membership', description: 'Guild creation, joining, and leaving' },
  { id: 'guild-perks', label: 'Guild perks', description: 'Guild perk purchases and upgrades' },
  { id: 'guild-trust', label: 'Guild trust', description: 'Guild trust and reputation actions' },
  { id: 'guild-moderation', label: 'Guild moderation', description: 'Guild member removal and moderation actions' },
  { id: 'chat', label: 'Global Chat', description: 'Viewing and posting Global Chat messages; reports remain available' },
  { id: 'chat-posting', label: 'Chat posting', description: 'Sending messages to Global Chat without disabling read access' },
  { id: 'sharing', label: 'Sharing', description: 'Reddit sharing actions' },
  { id: 'social-visits', label: 'Social visits', description: 'Player-to-player social visit actions' },
  { id: 'presence', label: 'Online presence', description: 'Online player count and presence status' },
  { id: 'rewards', label: 'Rewards', description: 'Master switch for claimable player rewards' },
  { id: 'daily-rewards', label: 'Daily rewards', description: 'Daily streak claims' },
  { id: 'quests', label: 'Quests', description: 'Daily and weekly quest claims' },
  { id: 'community-rewards', label: 'Community rewards', description: 'Follow and community reward claims' },
  { id: 'events', label: 'Events', description: 'Master switch for Frenzy and world events' },
  { id: 'frenzy', label: 'Frenzy', description: 'Frenzy status, creation, claiming, and event interactions' },
  { id: 'frenzy-setup', label: 'Frenzy setup', description: 'Starting and arming Frenzy events' },
  { id: 'frenzy-rewards', label: 'Frenzy rewards', description: 'Claiming or acknowledging Frenzy rewards' },
  { id: 'world-events', label: 'World events', description: 'World-event status and interactions' },
  { id: 'alignment', label: 'Celestial Alignment', description: 'Alignment status and choices' },
  { id: 'global-boosters', label: 'Global boosters', description: 'Global booster status and activation' },
  { id: 'global-booster-activation', label: 'Global booster activation', description: 'Activating global boosters without hiding their status' },
  { id: 'notifications', label: 'Notifications', description: 'Player notification preferences' },
  { id: 'popups', label: 'Popups', description: 'Player popup configuration and tracking' },
  { id: 'tutorials', label: 'Tutorials', description: 'First-roll and combat tutorial state' },
  { id: 'first-roll-tutorial', label: 'First-roll tutorial', description: 'First-roll tutorial status and completion' },
  { id: 'combat-tutorial', label: 'Combat tutorial', description: 'Combat tutorial status and completion' },
  { id: 'leaderboards', label: 'Leaderboards', description: 'Leaderboard and ranking views' },
  { id: 'collection', label: 'Collection', description: 'Codex and collection views' },
  { id: 'feedback', label: 'Feedback', description: 'Player feedback submissions' },
  { id: 'purchases', label: 'Purchases', description: 'Product catalog and purchase reconciliation' },
  { id: 'product-catalog', label: 'Product catalog', description: 'Viewing the product catalog' },
  { id: 'purchase-reconciliation', label: 'Purchase reconciliation', description: 'Reconciling product purchases and entitlements' },
] as const;

export type GlobalFeatureId = typeof GLOBAL_FEATURES[number]['id'];

export type ParsedAdminCliCommand =
  | { kind: 'menus'; enabled: boolean; reason: string }
  | { kind: 'announcement'; message: string }
  | { kind: 'feature'; feature: GlobalFeatureId; enabled: boolean; reason: string }
  | { kind: 'feature-list' }
  | { kind: 'balance'; action: 'list' | 'history' }
  | { kind: 'balance'; action: 'get' | 'reset'; key: string }
  | { kind: 'balance'; action: 'set' | 'preview'; key: string; value: number }
  | { kind: 'balance'; action: 'reset-all' }
  | { kind: 'balance'; action: 'rollback'; revision: number }
  | { kind: 'player-save'; commands: string; invalidateRollTicket: boolean };

const DEFAULT_MENU_DISABLED_REASON = 'The developer has disabled the menus.';
const MAX_CLI_SCRIPT_LENGTH = 12_000;
const MAX_CLI_COMMANDS = 50;


export function globalFeaturesForRequest(method: string, path: string): GlobalFeatureId[] {
  const verb = String(method ?? '').toUpperCase();
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb);
  const isRead = verb === 'GET' || verb === 'HEAD';
  if (!isWrite && !isRead) return [];

  const normalizedPath = String(path ?? '').split('?')[0]!.replace(/^\/api(?=\/)/, '');
  if (normalizedPath === '/chat/report' || normalizedPath.startsWith('/dev/')) return [];

  const game = (...features: GlobalFeatureId[]): GlobalFeatureId[] => ['gameplay', ...features];
  const gameWrite = (...features: GlobalFeatureId[]): GlobalFeatureId[] => ['gameplay', 'player-actions', ...features];

  // Rolling and read-side progress endpoints.
  if (normalizedPath === '/roll' && isWrite) return gameWrite('rolling');
  if (normalizedPath === '/roll-ticket' && isRead) return game('rolling');
  if (normalizedPath === '/auto-roll' && isWrite) return gameWrite('rolling', 'automation', 'auto-roll');
  if (normalizedPath === '/time-energy/progress' && isRead) return game('rolling', 'time-energy');

  // Combat tutorial and subsystems. Keep read snapshots available in read-only mode.
  if (normalizedPath === '/combat/tutorial/status' && isRead) return game('combat', 'tutorials', 'combat-tutorial');
  if (normalizedPath === '/combat/tutorial/complete' && isWrite) return gameWrite('combat', 'tutorials', 'combat-tutorial');
  if (normalizedPath.startsWith('/combat/runes/auto-sacrifice/')) {
    return isWrite ? gameWrite('combat', 'runes', 'rune-auto-sacrifice') : game('combat', 'runes', 'rune-auto-sacrifice');
  }
  if (normalizedPath.startsWith('/combat/runes/')) {
    return isWrite ? gameWrite('combat', 'runes') : game('combat', 'runes');
  }
  if (normalizedPath.startsWith('/combat/skills/')) {
    return isWrite ? gameWrite('combat', 'skills') : game('combat', 'skills');
  }
  if (normalizedPath.startsWith('/combat/arena/')) {
    return isWrite ? gameWrite('combat', 'arena') : game('combat', 'arena');
  }
  if (normalizedPath === '/combat/dungeon' && isWrite) return gameWrite('combat', 'dungeons');
  if (normalizedPath === '/combat/tactics' && isWrite) return gameWrite('combat', 'combat-tactics');
  if (normalizedPath === '/combat/upgrades/buy' && isWrite) return gameWrite('combat', 'combat-upgrades');
  if (normalizedPath === '/combat/strategy-guide/buy' && isWrite) return gameWrite('combat', 'strategy-guide');
  if (normalizedPath === '/combat/equip' && isWrite) return gameWrite('combat', 'gear', 'gear-equipping');
  if (normalizedPath === '/combat/gear/scrap' && isWrite) return gameWrite('combat', 'gear', 'gear-scrapping');
  if (normalizedPath === '/combat/forge' && isWrite) return gameWrite('combat', 'gear', 'gear-forge');
  if (normalizedPath === '/combat/auto-scrap' && isWrite) return gameWrite('combat', 'gear', 'gear-auto-scrap');
  if (normalizedPath.startsWith('/combat/')) return isWrite ? gameWrite('combat') : game('combat');

  // Social parent covers community interaction; narrow switches isolate each action.
  if (normalizedPath === '/guilds' || normalizedPath.startsWith('/guilds/')) {
    if (!isWrite) return game('social', 'guilds');
    if (['/guilds/create', '/guilds/join', '/guilds/leave'].includes(normalizedPath)) {
      return gameWrite('social', 'guilds', 'guild-membership');
    }
    if (normalizedPath === '/guilds/perk') return gameWrite('social', 'guilds', 'guild-perks');
    if (normalizedPath === '/guilds/trust') return gameWrite('social', 'guilds', 'guild-trust');
    if (normalizedPath === '/guilds/kick') return gameWrite('social', 'guilds', 'guild-moderation');
    return gameWrite('social', 'guilds');
  }
  if (normalizedPath === '/chat' || normalizedPath === '/chat/status') {
    return isWrite ? gameWrite('social', 'chat', 'chat-posting') : game('social', 'chat');
  }
  if (normalizedPath === '/share' && isWrite) return gameWrite('social', 'sharing');
  if (normalizedPath === '/social/visit' && isWrite) return gameWrite('social', 'social-visits');
  if ((normalizedPath === '/follow-reward/status' && isRead) || (normalizedPath === '/follow-reward' && isWrite)) {
    return isWrite
      ? gameWrite('social', 'rewards', 'community-rewards')
      : game('social', 'rewards', 'community-rewards');
  }
  if (normalizedPath === '/community/reward/claim' && isWrite) return gameWrite('social', 'rewards', 'community-rewards');

  // Reward claims and progression systems.
  if (normalizedPath === '/streak/claim' && isWrite) return gameWrite('rewards', 'daily-rewards');
  if (normalizedPath === '/quests/claim' && isWrite) return gameWrite('rewards', 'quests');
  if (normalizedPath === '/prestige/upgrade' && isWrite) return gameWrite('prestige', 'prestige-upgrades');
  if (normalizedPath === '/prestige/synthesize' && isWrite) return gameWrite('prestige', 'prestige-synthesis');
  if ((normalizedPath === '/prestige' || normalizedPath.startsWith('/prestige/')) && isWrite) return gameWrite('prestige');
  if (normalizedPath === '/mastery/upgrade' && isWrite) return gameWrite('upgrades', 'mastery');
  if (normalizedPath === '/boosters/activate' && isWrite) return gameWrite('upgrades', 'boosters', 'personal-boosters');
  if (normalizedPath === '/automation/buy' && isWrite) return gameWrite('upgrades', 'boosters', 'automation');
  if (normalizedPath === '/turbo/activate' && isWrite) return gameWrite('upgrades', 'boosters', 'automation', 'turbo');
  if (normalizedPath === '/cosmetics/buy' && isWrite) return gameWrite('upgrades', 'cosmetics');
  if (['/upgrade/batch', '/upgrade/all'].includes(normalizedPath) && isWrite) return gameWrite('upgrades', 'bulk-upgrades');
  if (normalizedPath === '/upgrade' && isWrite) return gameWrite('upgrades');
  if (normalizedPath === '/chain-patcher/buy' && isWrite) return gameWrite('upgrades', 'chain-patcher');
  if (normalizedPath === '/altar/sacrifice' && isWrite) return gameWrite('upgrades', 'altar');

  // Events, global buffs, and player-choice systems.
  if (normalizedPath === '/world-event' && isRead) return game('events', 'world-events');
  if (normalizedPath.startsWith('/frenzy/') && !normalizedPath.startsWith('/frenzy/simulator/')) {
    if (isWrite && ['/frenzy/start', '/frenzy/arm'].includes(normalizedPath)) {
      return gameWrite('events', 'frenzy', 'frenzy-setup');
    }
    if (isWrite && ['/frenzy/claim', '/frenzy/offline-reward/ack', '/frenzy/thank-you'].includes(normalizedPath)) {
      return gameWrite('events', 'frenzy', 'frenzy-rewards');
    }
    return isWrite ? gameWrite('events', 'frenzy') : game('events', 'frenzy');
  }
  if (['/global-boosters', '/global-booster-announcement'].includes(normalizedPath) && isRead) {
    return game('global-boosters');
  }
  if (normalizedPath === '/global-boosters/activate' && isWrite) {
    return gameWrite('global-boosters', 'global-booster-activation');
  }
  if (normalizedPath === '/alignment/status' && isRead) return game('alignment');
  if (normalizedPath === '/alignment/choose' && isWrite) return gameWrite('alignment');

  // Player-facing utility and community surfaces.
  if (normalizedPath === '/offline/claim' && isWrite) return gameWrite('offline');
  if (normalizedPath === '/notifications' && (isRead || isWrite)) {
    return isWrite ? gameWrite('notifications') : game('notifications');
  }
  if ((normalizedPath === '/popups/config' && isRead) || (normalizedPath === '/popups/track' && isWrite)) {
    return game('popups');
  }
  if (normalizedPath === '/tutorial/first-roll/status' && isRead) return game('tutorials', 'first-roll-tutorial');
  if (normalizedPath === '/tutorial/first-roll/complete' && isWrite) {
    return gameWrite('tutorials', 'first-roll-tutorial');
  }
  if (normalizedPath === '/feedback' && isWrite) return game('feedback');

  // Read-only pages and purchase entry points.
  if (['/leaderboard', '/leaderboards'].includes(normalizedPath) && isRead) return game('leaderboards');
  if (normalizedPath === '/collection' && isRead) return game('collection');
  if (normalizedPath === '/online' && isRead) return game('presence');
  if (normalizedPath === '/products' && isRead) return game('purchases', 'product-catalog');
  if (normalizedPath === '/payments/reconcile' && isWrite) {
    return gameWrite('purchases', 'purchase-reconciliation');
  }

  return [];
}

/** Backwards-compatible single-feature helper for callers and focused tests. */
export function globalFeatureForRequest(method: string, path: string): GlobalFeatureId | null {
  const features = globalFeaturesForRequest(method, path);
  return features.length ? features[features.length - 1]! : null;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )) return trimmed.slice(1, -1);
  return trimmed;
}

function numericText(value: string, label: string): number {
  const number = Number(value);
  if (!value.trim() || !Number.isFinite(number) || number < 0) {
    throw new Error(label + ' must be a finite, non-negative number.');
  }
  return number;
}

function assertPlayerScript(script: string): void {
  const lines = script.split(/\r?\n/);
  const active = lines.map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (active.length < 1) throw new Error('Enter at least one player command.');
  if (active.length > MAX_CLI_COMMANDS) throw new Error('A command batch may contain at most 50 lines.');
  for (const line of active) {
    if (!/^(?:set|add|subtract|sub|delete|del)\s+[^\s]+(?:\s+[\s\S]+)?$/i.test(line)) {
      throw new Error('Player command batches accept only set, add, subtract, and delete lines.');
    }
  }
}

export function parseAdminCliCommand(source: string): ParsedAdminCliCommand {
  const input = String(source ?? '');
  if (!input.trim()) throw new Error('Enter a command.');
  if (input.length > MAX_CLI_SCRIPT_LENGTH) throw new Error('The command is too long.');

  const lines = input.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!lines.length) throw new Error('Enter a command.');
  if (lines.length > MAX_CLI_COMMANDS) throw new Error('A command batch may contain at most 50 lines.');

  if (lines.length === 1) {
    const line = lines[0]!;
    if (/^(?:features(?:\s+list)?|feature\s+list)$/i.test(line)) return { kind: 'feature-list' };

    if (/^balance\s+(?:list|keys|help)$/i.test(line)) return { kind: 'balance', action: 'list' };
    if (/^balance\s+history$/i.test(line)) return { kind: 'balance', action: 'history' };
    if (/^balance\s+reset\s+all$/i.test(line)) return { kind: 'balance', action: 'reset-all' };

    const balanceGetMatch = /^balance\s+get\s+(\S+)$/i.exec(line);
    if (balanceGetMatch) {
      if (!getLiveBalanceSetting(balanceGetMatch[1]!)) throw new Error('Unknown balance setting "' + balanceGetMatch[1] + '". Use "balance list" to see supported settings.');
      return { kind: 'balance', action: 'get', key: balanceGetMatch[1]! };
    }

    const balanceResetMatch = /^balance\s+reset\s+(\S+)$/i.exec(line);
    if (balanceResetMatch) {
      if (!getLiveBalanceSetting(balanceResetMatch[1]!)) throw new Error('Unknown balance setting "' + balanceResetMatch[1] + '". Use "balance list" to see supported settings.');
      return { kind: 'balance', action: 'reset', key: balanceResetMatch[1]! };
    }

    const balanceValueMatch = /^balance\s+(set|preview)\s+(\S+)\s+(\S+)$/i.exec(line);
    if (balanceValueMatch) {
      const value = numericText(balanceValueMatch[3]!, 'Balance value');
      validateLiveBalanceValue(balanceValueMatch[2]!, value);
      return {
        kind: 'balance',
        action: balanceValueMatch[1]!.toLowerCase() as 'set' | 'preview',
        key: balanceValueMatch[2]!,
        value,
      };
    }

    const balanceRollbackMatch = /^balance\s+rollback\s+(\d+)$/i.exec(line);
    if (balanceRollbackMatch) {
      const revision = Number(balanceRollbackMatch[1]);
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Balance revision must be a positive whole number.');
      return { kind: 'balance', action: 'rollback', revision };
    }

    const maintenanceMatch = /^maintenance\s+(on|off|enable|disable)(?:\s+([\s\S]+))?$/i.exec(line);
    if (maintenanceMatch) {
      const maintenanceEnabled = /^(on|enable)$/i.test(maintenanceMatch[1]!);
      const reason = maintenanceEnabled
        ? (unquote(maintenanceMatch[2] ?? '') || 'The game is temporarily under maintenance.').slice(0, 300)
        : '';
      return { kind: 'feature', feature: 'gameplay', enabled: !maintenanceEnabled, reason };
    }

    const readOnlyMatch = /^read-only\s+(on|off|enable|disable)(?:\s+([\s\S]+))?$/i.exec(line);
    if (readOnlyMatch) {
      const readOnlyEnabled = /^(on|enable)$/i.test(readOnlyMatch[1]!);
      const reason = readOnlyEnabled
        ? (unquote(readOnlyMatch[2] ?? '') || 'The game is temporarily in read-only mode.').slice(0, 300)
        : '';
      return { kind: 'feature', feature: 'player-actions', enabled: !readOnlyEnabled, reason };
    }

    const featureMatch = /^feature\s+([a-z-]+)\s+(disable|off|enable|on)(?:\s+([\s\S]+))?$/i.exec(line);
    if (featureMatch) {
      const featureName = featureMatch[1]!.toLowerCase();
      const definition = GLOBAL_FEATURES.find(item => item.id === featureName);
      if (!definition) throw new Error('Unknown global feature "' + featureName + '". Use "features" to list valid switches.');
      const enabled = /^(enable|on)$/i.test(featureMatch[2]!);
      const suppliedReason = unquote(featureMatch[3] ?? '');
      if (enabled && suppliedReason) throw new Error('Do not provide a reason when enabling a feature.');
      const reason = enabled ? '' : (suppliedReason || 'The developer has disabled ' + definition.label.toLowerCase() + '.').slice(0, 300);
      return { kind: 'feature', feature: definition.id, enabled, reason };
    }

    const menuMatch = /^menus?\s+(disable|off|enable|on)(?:\s+([\s\S]+))?$/i.exec(line);
    if (menuMatch) {
      const enabled = /^(enable|on)$/i.test(menuMatch[1]!);
      const reason = enabled ? '' : (unquote(menuMatch[2] ?? '') || DEFAULT_MENU_DISABLED_REASON).slice(0, 300);
      return { kind: 'menus', enabled, reason };
    }

    const announceMatch = /^(?:announce|announcement)\s+([\s\S]+)$/i.exec(line);
    if (announceMatch) {
      const raw = unquote(announceMatch[1]!);
      return { kind: 'announcement', message: /^(clear|off|none)$/i.test(raw) ? '' : raw.slice(0, 1200) };
    }

    if (/^cooldown\s+ready$/i.test(line)) {
      return { kind: 'player-save', commands: 'set lastRollAt 0', invalidateRollTicket: true };
    }

    const offlineMatch = /^offline\s+(add|set)\s+(\S+)$/i.exec(line);
    if (offlineMatch) {
      const offlineAmount = numericText(offlineMatch[2]!, 'Offline rolls');
      if (!Number.isSafeInteger(offlineAmount)) throw new Error('Offline rolls must be whole numbers.');
      return {
        kind: 'player-save',
        commands: (offlineMatch[1]!.toLowerCase() === 'add' ? 'add offlineRolls ' : 'set offlineRolls ') + offlineMatch[2],
        invalidateRollTicket: false,
      };
    }

    const giveMatch = /^give\s+(coins?|shards?|dust|offline|rolls)\s+(\S+)$/i.exec(line);
    if (giveMatch) {
      const resource = giveMatch[1]!.toLowerCase();
      const amount = numericText(giveMatch[2]!, 'Grant amount');
      if (amount <= 0) throw new Error('Grant amount must be greater than zero.');
      if (['shard', 'shards', 'rolls', 'offline'].includes(resource) && !Number.isSafeInteger(amount)) {
        throw new Error('Shard, roll, and offline grants must be whole numbers.');
      }
      const commands = resource === 'coin' || resource === 'coins'
        ? 'add coins ' + amount + '\nadd lifetimeCoins ' + amount
        : resource === 'shard' || resource === 'shards'
          ? 'add shards ' + amount + '\nadd lifetimeShards ' + amount
          : resource === 'dust'
            ? 'add cosmicDust ' + amount
            : resource === 'rolls'
              ? 'add totalRolls ' + amount
              : 'add offlineRolls ' + amount;
      return { kind: 'player-save', commands, invalidateRollTicket: false };
    }

    const upgradeMatch = /^upgrade\s+([A-Za-z][A-Za-z0-9_-]*)\s+([\d.]+)$/i.exec(line);
    if (upgradeMatch) {
      numericText(upgradeMatch[2]!, 'Upgrade level');
      return { kind: 'player-save', commands: 'set upgrades.' + upgradeMatch[1] + ' ' + upgradeMatch[2], invalidateRollTicket: false };
    }

    const masteryMatch = /^mastery\s+([A-Za-z][A-Za-z0-9_-]*)\s+([\d.]+)$/i.exec(line);
    if (masteryMatch) {
      numericText(masteryMatch[2]!, 'Mastery level');
      return { kind: 'player-save', commands: 'set masterySkills.' + masteryMatch[1] + ' ' + masteryMatch[2], invalidateRollTicket: false };
    }

    const prestigeMatch = /^prestige-upgrade\s+([A-Za-z][A-Za-z0-9_-]*)\s+([\d.]+)$/i.exec(line);
    if (prestigeMatch) {
      numericText(prestigeMatch[2]!, 'Prestige upgrade level');
      return { kind: 'player-save', commands: 'set prestigeUpgrades.' + prestigeMatch[1] + ' ' + prestigeMatch[2], invalidateRollTicket: false };
    }

    const boosterMatch = /^boost\s+(fortune|hyperdrive|barrage|prosperity|ascension)\s+(\d+)$/i.exec(line);
    if (boosterMatch) {
      const minutes = numericText(boosterMatch[2]!, 'Booster duration');
      if (minutes <= 0 || minutes > 10_080) throw new Error('Booster duration must be between 1 and 10,080 minutes.');
      const expiry = Date.now() + minutes * 60_000;
      return { kind: 'player-save', commands: 'set activeBoosters.' + boosterMatch[1]!.toLowerCase() + ' ' + expiry, invalidateRollTicket: false };
    }
  }

  const playerScript = lines.join('\n');
  assertPlayerScript(playerScript);
  return { kind: 'player-save', commands: playerScript, invalidateRollTicket: false };
}

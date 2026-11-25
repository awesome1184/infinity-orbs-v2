/**
 * Deliberately small admin save-edit command language.
 *
 * This is not JavaScript and never evaluates code. Every write is restricted to
 * persisted gameplay fields, with internal identity/revision/storage metadata
 * kept under server control.
 */

const EDITABLE_SAVE_ROOTS = new Set([
  'coins', 'shards', 'cosmicDust', 'level', 'xp', 'levelXpFloor',
  'totalRolls', 'manualRolls', 'totalCrits', 'lifetimeCoins', 'lifetimeShards',
  'highestRarity', 'highestRarityIsInfinity', 'collectionValue', 'lifetimeCollectionValue',
  'lastRollAt', 'timeEnergy', 'alignmentNextAt', 'alignmentPendingAt', 'alignmentPendingForced',
  'alignmentActiveInstances', 'alignmentActiveChoice', 'alignmentActiveUntil', 'lastSeenAt',
  'offlineRolls', 'claimedAchievements', 'upgrades', 'prestigeCount', 'prestigeUpgrades',
  'streak', 'dailyQuests', 'weeklyQuests', 'lastDailyReset', 'lastWeeklyReset', 'rollsSinceBest',
  'aftershockRecord', 'rollingSessionStartedAt', 'rollingSessionLastRollAt',
  'longestRollingSessionMs', 'highestDryStreak', 'freeRolls', 'activeCosmetic',
  'unlockedCosmetics', 'turboRollUntil', 'activeBoosters', 'automations', 'combatAutoScrap',
  'communityRewardClaimedAt', 'freeShardsEarnedToday', 'shardPityRolls', 'lastFreeShardReset',
  'purchasedShards', 'globalBoosterCredits', 'lastFrenzyDate', 'lastFrenzyAt',
  'lastFrenzyClaimDate', 'lastFrenzyClaimAt', 'frenzyClaimsToday',
  'pendingFrenzyOfflineClaimCount', 'pendingFrenzyOfflineShards', 'communityRewardClaimedTier',
  'currentRunRolls', 'questsCompleted', 'guildContribution', 'sacrifices', 'masteryPoints',
  'masterySkills', 'socialActivityDate', 'lastShareAt',
]);

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_COMMANDS = 50;
const MAX_SCRIPT_LENGTH = 12_000;
const MAX_VALUE_LENGTH = 16_000;
const MAX_PATH_DEPTH = 6;

export interface AdminSaveCommandResult {
  line: number;
  action: 'set' | 'add' | 'subtract' | 'delete';
  path: string;
  before: unknown;
  after: unknown;
}

export interface AdminSaveCommandBatchResult<T extends Record<string, unknown> = Record<string, unknown>> {
  state: T;
  results: AdminSaveCommandResult[];
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeDisplay(value: unknown): unknown {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 360 ? text.slice(0, 360) + '…' : JSON.parse(text);
}

function parseCommandValue(source: string): unknown {
  const text = source.trim();
  if (!text) throw new Error('A value is required.');
  if (text.length > MAX_VALUE_LENGTH) throw new Error('A command value is too large.');
  try {
    return JSON.parse(text);
  } catch {
    if (/^(?:true|false|null)$/i.test(text)) return text.toLowerCase() === 'true' ? true : text.toLowerCase() === 'false' ? false : null;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
      const numeric = Number(text);
      if (!Number.isFinite(numeric)) throw new Error('Numeric values must be finite.');
      return numeric;
    }
    // Unquoted single-token strings are convenient for enum-like fields.
    if (/^[A-Za-z0-9_:/+-]+$/.test(text)) return text;
    throw new Error('Use valid JSON for strings containing spaces, arrays, and objects.');
  }
}

function assertSafeJsonValue(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error('Command values may be nested at most 8 levels.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > 2_000) throw new Error('String values may not exceed 2,000 characters.');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error('Numbers must be finite and non-negative.');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) throw new Error('Arrays may contain at most 500 items.');
    for (const item of value) assertSafeJsonValue(item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 500) throw new Error('Objects may contain at most 500 fields.');
    for (const [key, child] of entries) {
      if (FORBIDDEN_PATH_SEGMENTS.has(key)) throw new Error('Unsafe object key: ' + key);
      assertSafeJsonValue(child, depth + 1);
    }
    return;
  }
  throw new Error('Only JSON-compatible values may be written.');
}

function parsePath(pathText: string): string[] {
  const path = pathText.trim();
  const parts = path.split('.');
  if (!path || parts.length > MAX_PATH_DEPTH || parts.some(part =>
    !/^(?:[A-Za-z][A-Za-z0-9_-]*|\d{1,4})$/.test(part) || FORBIDDEN_PATH_SEGMENTS.has(part)
  )) {
    throw new Error('Invalid save path. Use dot notation such as upgrades.speed.');
  }
  if (!EDITABLE_SAVE_ROOTS.has(parts[0]!)) {
    throw new Error('That save field is protected or is not editable through Execute As.');
  }
  return parts;
}

function getParent(root: Record<string, unknown>, parts: string[]): { parent: Record<string, unknown> | unknown[]; key: string; value: unknown } {
  let current: Record<string, unknown> | unknown[] = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]!;
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) throw new Error('Array paths must use a numeric index.');
      const position = Number(part);
      if (position >= current.length) throw new Error('Array index is out of range: ' + part);
      const child = current[position];
      if (child === null || typeof child !== 'object') throw new Error('Save path does not exist: ' + parts.slice(0, index + 1).join('.'));
      current = child as Record<string, unknown> | unknown[];
    } else {
      let child = current[part];
      if (child === undefined) {
        if (/^\d+$/.test(parts[index + 1]!)) throw new Error('Array paths must use an existing array.');
        child = {};
        current[part] = child;
      }
      if (child === null || typeof child !== 'object') throw new Error('Save path parent is not an object: ' + parts.slice(0, index + 1).join('.'));
      current = child as Record<string, unknown> | unknown[];
    }
  }
  const key = parts[parts.length - 1]!;
  if (Array.isArray(current)) {
    if (!/^\d+$/.test(key)) throw new Error('Array paths must use a numeric index.');
    const index = Number(key);
    if (index >= current.length) throw new Error('Array index is out of range: ' + key);
    return { parent: current, key, value: current[index] };
  }
  return { parent: current, key, value: Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined };
}

function assign(parent: Record<string, unknown> | unknown[], key: string, value: unknown): void {
  if (Array.isArray(parent)) parent[Number(key)] = value;
  else parent[key] = value;
}

function validateCoreSave(state: Record<string, unknown>): void {
  if (typeof state.coins !== 'number' || !Number.isFinite(state.coins) || state.coins < 0) {
    throw new Error('The resulting save has an invalid Coin balance.');
  }
  if (typeof state.shards !== 'number' || !Number.isSafeInteger(state.shards) || state.shards < 0) {
    throw new Error('The resulting save has an invalid Shard balance. Shards must be whole numbers.');
  }
  if (!Number.isSafeInteger(state.totalRolls) || Number(state.totalRolls) < 0) {
    throw new Error('The resulting save has an invalid lifetime roll counter.');
  }
}

export function applyAdminSaveCommands<T extends Record<string, unknown>>(
  sourceState: T,
  script: string,
): AdminSaveCommandBatchResult<T> {
  const source = String(script ?? '');
  if (!source.trim()) throw new Error('Enter at least one command.');
  if (source.length > MAX_SCRIPT_LENGTH) throw new Error('The command script is too long.');
  const lines = source.split(/\r?\n/);
  const activeLines = lines
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(item => item.raw && !item.raw.startsWith('#'));
  if (activeLines.length === 0) throw new Error('Enter at least one command.');
  if (activeLines.length > MAX_COMMANDS) throw new Error('A script may contain at most ' + MAX_COMMANDS + ' commands.');

  const state = jsonClone(sourceState);
  const results: AdminSaveCommandResult[] = [];

  for (const item of activeLines) {
    const match = /^(set|add|subtract|sub|delete|del)\s+([^\s]+)(?:\s+([\s\S]+))?$/i.exec(item.raw);
    if (!match) throw new Error('Line ' + item.line + ': expected set, add, subtract, or delete.');
    const rawAction = match[1]!.toLowerCase();
    const action: AdminSaveCommandResult['action'] = rawAction === 'sub' ? 'subtract' : rawAction === 'del' ? 'delete' : rawAction as AdminSaveCommandResult['action'];
    const parts = parsePath(match[2]!);
    if (parts.length === 1 && action === 'delete') throw new Error('Required top-level save fields cannot be deleted.');
    const { parent, key, value: before } = getParent(state, parts);

    if (action === 'delete') {
      if (match[3]) throw new Error('Delete does not take a value.');
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else delete parent[key];
      results.push({ line: item.line, action, path: parts.join('.'), before: safeDisplay(before), after: null });
      continue;
    }

    const valueText = match[3];
    if (!valueText) throw new Error('Line ' + item.line + ': a value is required.');
    let after: unknown;
    if (action === 'set') {
      after = parseCommandValue(valueText);
      assertSafeJsonValue(after);
      if (parts.length === 1 && before !== undefined && before !== null && after !== null && typeof after !== typeof before) {
        // Nullable and optional fields may be initialized; otherwise retain the field's existing type.
        throw new Error('This save field must keep its current value type.');
      }
      assign(parent, key, after);
    } else {
      const amount = Number(valueText.trim());
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Add/subtract amounts must be finite non-negative numbers.');
      if (typeof before !== 'number' || !Number.isFinite(before)) throw new Error('Add/subtract requires an existing numeric save field.');
      const numericAfter = action === 'add' ? before + amount : before - amount;
      if (!Number.isFinite(numericAfter) || numericAfter < 0) throw new Error('The resulting value must remain finite and non-negative.');
      after = numericAfter;
      assign(parent, key, numericAfter);
    }
    results.push({ line: item.line, action, path: parts.join('.'), before: safeDisplay(before), after: safeDisplay(after) });
  }

  validateCoreSave(state);
  return { state, results };
}

/**
 * Whitelisted live balance settings shared by the game client and server.
 * Values are configuration only; they cannot replace or execute game logic.
 */

export const LIVE_BALANCE_SETTINGS = [
  {
    key: 'roll.baseCooldownMs',
    label: 'Base roll cooldown',
    description: 'Base cooldown before personal speed, boosters, and other modifiers.',
    defaultValue: 15_000,
    min: 1_000,
    max: 60_000,
    step: 100,
    unit: 'ms',
  },
  {
    key: 'roll.minimumCooldownMs',
    label: 'Minimum roll cooldown',
    description: 'Final safety floor after every cooldown reduction.',
    defaultValue: 300,
    min: 300,
    max: 5_000,
    step: 50,
    unit: 'ms',
  },
  {
    key: 'roll.speedPerLevelMs',
    label: 'Speed reduction per level',
    description: 'Cooldown milliseconds removed per standard Speed upgrade level.',
    defaultValue: 150,
    min: 0,
    max: 1_000,
    step: 10,
    unit: 'ms',
  },
  {
    key: 'roll.autoCooldownMultiplier',
    label: 'Auto Roll cooldown multiplier',
    description: 'Applied to Auto Roll only after its normal speed modifiers.',
    defaultValue: 1,
    min: 0.1,
    max: 5,
    step: 0.05,
    unit: '×',
  },
  {
    key: 'rewards.coinMultiplier',
    label: 'Coin reward multiplier',
    description: 'Multiplies all Coins earned from Orb roll batches.',
    defaultValue: 1,
    min: 0,
    max: 100,
    step: 0.05,
    unit: '×',
  },
  {
    key: 'rewards.xpMultiplier',
    label: 'XP reward multiplier',
    description: 'Multiplies XP earned from Orb roll batches, after existing bonuses.',
    defaultValue: 1,
    min: 0,
    max: 100,
    step: 0.05,
    unit: '×',
  },
  {
    key: 'rewards.shardChanceMultiplier',
    label: 'Shard proc chance multiplier',
    description: 'Multiplies the normal Shard chance before the existing hard cap and pity system.',
    defaultValue: 1,
    min: 0,
    max: 100,
    step: 0.05,
    unit: '×',
  },
  {
    key: 'offline.generationMultiplier',
    label: 'Offline roll generation',
    description: 'Scales how quickly Offline Rolls accumulate. Values above 1 are faster.',
    defaultValue: 1,
    min: 0.1,
    max: 10,
    step: 0.05,
    unit: '×',
  },
] as const;

export type LiveBalanceKey = typeof LIVE_BALANCE_SETTINGS[number]['key'];
export type LiveBalanceConfig = Record<LiveBalanceKey, number>;
export type LiveBalanceSetting = typeof LIVE_BALANCE_SETTINGS[number];

export const DEFAULT_LIVE_BALANCE_CONFIG: LiveBalanceConfig = Object.fromEntries(
  LIVE_BALANCE_SETTINGS.map(setting => [setting.key, setting.defaultValue]),
) as LiveBalanceConfig;

const LIVE_BALANCE_SETTING_BY_KEY = new Map<string, LiveBalanceSetting>(
  LIVE_BALANCE_SETTINGS.map(setting => [setting.key, setting]),
);

export function getLiveBalanceSetting(key: string): LiveBalanceSetting | null {
  return LIVE_BALANCE_SETTING_BY_KEY.get(String(key ?? '').trim()) ?? null;
}

export function validateLiveBalanceValue(key: string, rawValue: unknown): number {
  const setting = getLiveBalanceSetting(key);
  if (!setting) {
    throw new Error('Unknown balance setting "' + key + '". Use "balance list" to see supported settings.');
  }
  const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isFinite(value)) throw new Error(setting.key + ' must be a finite number.');
  if (value < setting.min || value > setting.max) {
    throw new Error(setting.key + ' must be between ' + setting.min + ' and ' + setting.max + ' ' + setting.unit + '.');
  }
  const decimals = String(setting.step).includes('.') ? String(setting.step).split('.')[1]!.length : 0;
  return Number(value.toFixed(Math.max(0, decimals + 2)));
}

export function normalizeLiveBalanceConfig(value: unknown): LiveBalanceConfig {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalized = { ...DEFAULT_LIVE_BALANCE_CONFIG };
  for (const setting of LIVE_BALANCE_SETTINGS) {
    const candidate = source[setting.key];
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) continue;
    if (candidate < setting.min || candidate > setting.max) continue;
    normalized[setting.key] = validateLiveBalanceValue(setting.key, candidate);
  }
  return normalized;
}

export function formatLiveBalanceValue(key: string, value: number): string {
  const setting = getLiveBalanceSetting(key);
  if (!setting) return String(value);
  return setting.unit === 'ms'
    ? Math.round(value).toLocaleString() + ' ms'
    : String(Number(value.toFixed(3))) + setting.unit;
}

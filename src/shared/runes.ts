export const RUNE_RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'] as const;
export type RuneRarity = typeof RUNE_RARITIES[number];
export type RuneStat = 'luck' | 'coins' | 'xp' | 'shards';

export const RUNE_EQUIPMENT_SLOTS = 3;
export const RUNE_INVENTORY_CAP = 250;

export interface RuneItem {
  id: string;
  name: string;
  rarity: RuneRarity;
  sourceDepth: number;
  obtainedAt: number;
  stats: Partial<Record<RuneStat, number>>;
}

export interface RuneBonuses {
  /** Multiplies the main game's effective Luck before its continuum roll. */
  luckMultiplier: number;
  /** Multiplies normal main-game Coin rewards. */
  coinMultiplier: number;
  /** Multiplies normal main-game XP rewards. */
  xpMultiplier: number;
  /** Adds to the main-game shard proc chance, before its existing 100% cap. */
  shardChanceBonus: number;
  equippedCount: number;
}

export const EMPTY_RUNE_BONUSES: RuneBonuses = {
  luckMultiplier: 1,
  coinMultiplier: 1,
  xpMultiplier: 1,
  shardChanceBonus: 0,
  equippedCount: 0,
};

const RUNE_STAT_BASE: Record<RuneRarity, number> = {
  Common: 0.01,
  Uncommon: 0.02,
  Rare: 0.035,
  Epic: 0.06,
  Legendary: 0.1,
  Mythic: 0.16,
};
const RUNE_SHARD_BASE: Record<RuneRarity, number> = {
  Common: 0.001,
  Uncommon: 0.002,
  Rare: 0.0035,
  Epic: 0.006,
  Legendary: 0.01,
  Mythic: 0.015,
};
const RUNE_NAMES = [
  'Ashen', 'Astral', 'Aether', 'Prism', 'Echoing', 'Umbral', 'Verdant',
  'Luminous', 'Ancient', 'Solar', 'Voidtouched', 'Frostbound', 'Starlit',
] as const;
const RUNE_STATS: RuneStat[] = ['luck', 'coins', 'xp', 'shards'];

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(minimum, Math.min(maximum, n)) : fallback;
}

function isRuneRarity(value: unknown): value is RuneRarity {
  return typeof value === 'string' && (RUNE_RARITIES as readonly string[]).includes(value);
}

/** Validate old saved drops before they can contribute to permanent player bonuses. */
export function normalizeRuneItem(value: unknown): RuneItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 160) return null;
  if (!isRuneRarity(raw.rarity)) return null;
  const rawStats = raw.stats && typeof raw.stats === 'object' && !Array.isArray(raw.stats)
    ? raw.stats as Record<string, unknown>
    : {};
  const stats: Partial<Record<RuneStat, number>> = {};
  for (const stat of RUNE_STATS) {
    if (rawStats[stat] === undefined) continue;
    const cap = stat === 'shards' ? 0.05 : 0.5;
    const amount = boundedNumber(rawStats[stat], 0, 0, cap);
    if (amount > 0) stats[stat] = Math.round(amount * 10000) / 10000;
  }
  if (Object.keys(stats).length === 0) return null;
  return {
    id: raw.id.trim(),
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : 'Unknown Rune',
    rarity: raw.rarity,
    sourceDepth: Math.floor(boundedNumber(raw.sourceDepth, 1, 1, 50_000)),
    obtainedAt: Math.floor(boundedNumber(raw.obtainedAt, 0, 0, Number.MAX_SAFE_INTEGER)),
    stats,
  };
}

/** Called only by the server with cryptographic randomness supplied by Combat. */
export function createRuneDrop(depthValue: unknown, random: () => number, now = Date.now()): RuneItem {
  const sample = () => Math.max(0, Math.min(0.999999999, Number(random()) || 0));
  const rarityRoll = sample();
  const rarity: RuneRarity = rarityRoll < 0.55 ? 'Common'
    : rarityRoll < 0.82 ? 'Uncommon'
      : rarityRoll < 0.94 ? 'Rare'
        : rarityRoll < 0.985 ? 'Epic'
          : rarityRoll < 0.998 ? 'Legendary' : 'Mythic';
  const sourceDepth = Math.floor(boundedNumber(depthValue, 1, 1, 50_000));
  const depthScale = Math.min(2.5, 1 + Math.log10(sourceDepth + 1) * 0.12);
  const statCount = rarity === 'Common' || rarity === 'Uncommon' ? 1
    : rarity === 'Rare' || rarity === 'Epic' ? 2 : 3;
  const candidates = [...RUNE_STATS];
  const stats: Partial<Record<RuneStat, number>> = {};
  for (let i = 0; i < statCount; i++) {
    const index = Math.min(candidates.length - 1, Math.floor(sample() * candidates.length));
    const stat = candidates.splice(index, 1)[0];
    if (!stat) break;
    const variance = 0.8 + sample() * 0.4;
    const base = stat === 'shards' ? RUNE_SHARD_BASE[rarity] : RUNE_STAT_BASE[rarity];
    const cap = stat === 'shards' ? 0.05 : 0.5;
    stats[stat] = Math.round(Math.min(cap, base * depthScale * variance) * 10000) / 10000;
  }
  const adjective = RUNE_NAMES[Math.min(RUNE_NAMES.length - 1, Math.floor(sample() * RUNE_NAMES.length))];
  const nonce = Math.floor(sample() * Number.MAX_SAFE_INTEGER).toString(36);
  return {
    id: 'rune-' + now.toString(36) + '-' + nonce,
    name: adjective + ' Rune',
    rarity,
    sourceDepth,
    obtainedAt: Math.floor(boundedNumber(now, Date.now(), 0, Number.MAX_SAFE_INTEGER)),
    stats,
  };
}

export function runeBonusesFromLoadout(runesValue: unknown, equippedValue: unknown): RuneBonuses {
  if (!Array.isArray(runesValue) || !Array.isArray(equippedValue)) return { ...EMPTY_RUNE_BONUSES };
  const runes = runesValue.map(normalizeRuneItem).filter((rune): rune is RuneItem => Boolean(rune));
  const owned = new Map(runes.map(rune => [rune.id, rune]));
  const ids = [...new Set(equippedValue.filter((id): id is string => typeof id === 'string' && owned.has(id)))].slice(0, RUNE_EQUIPMENT_SLOTS);
  const sums: Record<RuneStat, number> = { luck: 0, coins: 0, xp: 0, shards: 0 };
  for (const id of ids) {
    const rune = owned.get(id);
    if (!rune) continue;
    for (const stat of RUNE_STATS) sums[stat] += rune.stats[stat] ?? 0;
  }
  return {
    luckMultiplier: Math.min(4, 1 + sums.luck),
    coinMultiplier: Math.min(3, 1 + sums.coins),
    xpMultiplier: Math.min(3, 1 + sums.xp),
    shardChanceBonus: Math.min(0.25, sums.shards),
    equippedCount: ids.length,
  };
}

export function runeStatLabel(stat: RuneStat, value: number): string {
  const pct = (Math.max(0, Number(value) || 0) * 100).toFixed(2).replace(/\\.?0+$/, '');
  if (stat === 'luck') return '+' + pct + '% Luck';
  if (stat === 'coins') return '+' + pct + '% Coins';
  if (stat === 'xp') return '+' + pct + '% XP';
  return '+' + pct + ' percentage points of Shard Chance';
}

export function runeStatsSummary(rune: RuneItem): string {
  return RUNE_STATS.filter(stat => (rune.stats[stat] ?? 0) > 0)
    .map(stat => runeStatLabel(stat, rune.stats[stat] ?? 0))
    .join(' · ');
}

export function runeBonusesSummary(bonuses: RuneBonuses): string[] {
  const rows: string[] = [];
  if (bonuses.luckMultiplier > 1) rows.push('+' + ((bonuses.luckMultiplier - 1) * 100).toFixed(2).replace(/\\.?0+$/, '') + '% Luck');
  if (bonuses.coinMultiplier > 1) rows.push('+' + ((bonuses.coinMultiplier - 1) * 100).toFixed(2).replace(/\\.?0+$/, '') + '% Coins');
  if (bonuses.xpMultiplier > 1) rows.push('+' + ((bonuses.xpMultiplier - 1) * 100).toFixed(2).replace(/\\.?0+$/, '') + '% XP');
  if (bonuses.shardChanceBonus > 0) rows.push('+' + (bonuses.shardChanceBonus * 100).toFixed(2).replace(/\\.?0+$/, '') + ' percentage points of Shard Chance');
  if (!rows.length) rows.push('No bonuses yet — win battles to find your first Rune.');
  return rows;
}

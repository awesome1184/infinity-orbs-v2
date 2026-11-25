/**
 * Keep the growing Codex out of player save requests. Versioned shard names
 * let a precision migration verify replacement data before old hashes retire.
 */
export const CODEX_STORAGE_VERSION = 2;
export const CODEX_SHARD_COUNT = 16;
export const CODEX_MIGRATION_BATCH_SIZE = 384;
export const CODEX_EXACT_RARITY_LIMIT = 10_000;
export const CODEX_SIGNIFICANT_DIGITS = 4;

export function codexRarityBucket(rarityValue: unknown): number {
  const raw = Number(rarityValue);
  if (!Number.isFinite(raw) || raw < 2) return 2;
  const rarity = Math.floor(raw);
  if (rarity <= CODEX_EXACT_RARITY_LIMIT) return rarity;
  const step = Math.pow(10, Math.floor(Math.log10(rarity)) - (CODEX_SIGNIFICANT_DIGITS - 1));
  let bucket = Math.floor(rarity / step) * step;
  // Keep the exact 1/10,000 entry separate. The first higher bucket begins
  // at 10,010 so no >10,000 discovery is mixed into the exact 10,000 count.
  if (bucket <= CODEX_EXACT_RARITY_LIMIT) bucket = CODEX_EXACT_RARITY_LIMIT + step;
  return Number.isFinite(bucket) && bucket >= 2 ? bucket : rarity;
}

export function nextCodexRarityBucket(rarityValue: unknown): number | null {
  const rarity = codexRarityBucket(rarityValue);
  const next = rarity <= CODEX_EXACT_RARITY_LIMIT
    ? rarity + 1
    : rarity + Math.pow(10, Math.floor(Math.log10(rarity)) - (CODEX_SIGNIFICANT_DIGITS - 1));
  return Number.isFinite(next) && next > rarity ? codexRarityBucket(next) : null;
}

export function previousCodexRarityBucket(rarityValue: unknown): number | null {
  const rarity = codexRarityBucket(rarityValue);
  if (rarity <= 2) return null;
  if (rarity <= CODEX_EXACT_RARITY_LIMIT) return rarity - 1;
  const exponent = Math.floor(Math.log10(rarity));
  const decade = Math.pow(10, exponent);
  const step = Math.pow(10, exponent - (CODEX_SIGNIFICANT_DIGITS - 1));
  const previous = rarity - (rarity === decade ? step / 10 : step);
  return Number.isFinite(previous) && previous >= 2 ? codexRarityBucket(previous) : null;
}

export function normalizeCodexCollection(collection: Record<string, number> | null | undefined): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [rarityKey, rawCount] of Object.entries(collection ?? {})) {
    const count = Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 0) continue;
    if (rarityKey === 'Infinity') {
      normalized.Infinity = Math.min(Number.MAX_SAFE_INTEGER, (normalized.Infinity ?? 0) + count);
      continue;
    }
    const rarity = Number(rarityKey);
    if (!Number.isFinite(rarity) || !Number.isInteger(rarity) || rarity < 2) continue;
    const bucket = String(codexRarityBucket(rarity));
    normalized[bucket] = Math.min(Number.MAX_SAFE_INTEGER, (normalized[bucket] ?? 0) + count);
  }
  return normalized;
}

export function codexShardIndex(rarityKey: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < rarityKey.length; index += 1) {
    hash ^= rarityKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % CODEX_SHARD_COUNT;
}

export function codexShardKey(userId: string, generation: number, shard: number): string {
  const safeGeneration = Math.max(0, Math.floor(Number(generation) || 0));
  const safeShard = Math.max(0, Math.min(CODEX_SHARD_COUNT - 1, Math.floor(Number(shard) || 0)));
  return `player:codex:v${CODEX_STORAGE_VERSION}:${userId}:g${safeGeneration}:s${safeShard}`;
}

export function legacyCodexShardKey(userId: string, generation: number, shard: number): string {
  const safeGeneration = Math.max(0, Math.floor(Number(generation) || 0));
  const safeShard = Math.max(0, Math.min(CODEX_SHARD_COUNT - 1, Math.floor(Number(shard) || 0)));
  return `player:codex:${userId}:g${safeGeneration}:s${safeShard}`;
}

export interface CodexShardFields {
  shard: number;
  fields: Record<string, string>;
}

export function groupCodexFields(entries: Iterable<readonly [string, number]>): CodexShardFields[] {
  const grouped = Array.from({ length: CODEX_SHARD_COUNT }, () => ({} as Record<string, string>));
  for (const [rarity, count] of entries) grouped[codexShardIndex(rarity)][rarity] = String(count);
  return grouped.flatMap((fields, shard) => Object.keys(fields).length ? [{ shard, fields }] : []);
}

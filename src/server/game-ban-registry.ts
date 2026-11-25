export interface GameBanRecord {
  userId: string;
  username: string;
  bannedAt: number;
  bannedUntil: number | null;
  reason: string;
  bannedBy: string;
}

export interface GameBanStatus extends GameBanRecord {
  active: true;
}

function parseRegistryObject(raw: unknown): Record<string, unknown> {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Game ban list could not be read safely. No changes were applied.');
  }
  return parsed as Record<string, unknown>;
}

function parseGameBanRecord(keyName: string, value: unknown): GameBanRecord {
  if (
    !keyName ||
    !value || typeof value !== 'object' || Array.isArray(value) ||
    typeof (value as any).userId !== 'string' ||
    (value as any).userId.trim() !== keyName ||
    typeof (value as any).username !== 'string' ||
    !(value as any).username.trim() ||
    !Number.isSafeInteger((value as any).bannedAt) ||
    Number((value as any).bannedAt) < 0 ||
    !(
      (value as any).bannedUntil === null ||
      (
        Number.isSafeInteger((value as any).bannedUntil) &&
        Number((value as any).bannedUntil) > Number((value as any).bannedAt)
      )
    ) ||
    typeof (value as any).reason !== 'string' ||
    typeof (value as any).bannedBy !== 'string'
  ) {
    throw new Error('Game ban list contains a malformed record. No changes were applied.');
  }
  return value as GameBanRecord;
}

/** Strict parser used when listing or mutating the full registry. */
export function parseGameBanRegistry(raw: unknown): Record<string, GameBanRecord> {
  if (raw == null) return Object.create(null) as Record<string, GameBanRecord>;
  const parsed = parseRegistryObject(raw);
  const bans = Object.create(null) as Record<string, GameBanRecord>;
  for (const [keyName, value] of Object.entries(parsed)) {
    bans[keyName] = parseGameBanRecord(keyName, value);
  }
  return bans;
}

/**
 * Read only the requesting user's row. A malformed unrelated row must not
 * prevent every other player from entering the game. This path performs no
 * WATCH/MULTI transaction; expired records are ignored here and are cleaned
 * by the administrative list/mutation path.
 */
export function parseGameBanStatus(raw: unknown, userId: string, now = Date.now()): GameBanStatus | null {
  if (!userId || raw == null) return null;
  const parsed = parseRegistryObject(raw);
  if (!Object.prototype.hasOwnProperty.call(parsed, userId)) return null;
  const ban = parseGameBanRecord(userId, parsed[userId]);
  if (ban.bannedUntil !== null && ban.bannedUntil <= now) return null;
  return { ...ban, active: true };
}

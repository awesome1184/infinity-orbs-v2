import { context, redis } from './devvit-mock.js';
import { getCombatSnapshot } from './combat.js';
import type { CombatTrait } from '../shared/combat.js';
import type { ArenaFighter, ArenaMatchResult, ArenaOutcome, ArenaPlayerRecord, ArenaStatus } from '../shared/arena.js';
import { arenaRatingDelta, simulateArenaDuel } from '../shared/arena.js';

const ARENA_KEY = 'infinity-orbs:arena:state';
const MAX_CAS_ATTEMPTS = 8;
const MAX_QUEUE_SIZE = 500;
const QUEUE_EXPIRY_MS = 5 * 60 * 1000;
const MAX_STORED_PLAYERS = 5000;
const VALID_TRAITS: CombatTrait[] = ['bleed', 'keen', 'first-strike', 'bulwark', 'regeneration', 'desperation'];

interface QueueEntry { fighter: ArenaFighter; queuedAt: number; }
interface ArenaStore { queue: QueueEntry[]; players: Record<string, ArenaPlayerRecord>; }

function currentUserId(): string {
  const userId = String(context.userId ?? '').trim();
  if (!userId) throw new Error('REDDIT_LOGIN_REQUIRED');
  return userId.slice(0, 200);
}

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function safeFloat(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function aliasFor(userId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'Delver ' + (1000 + (hash >>> 0) % 9000);
}

function defaultRecord(now = Date.now()): ArenaPlayerRecord {
  return { rating: 1000, wins: 0, losses: 0, draws: 0, matches: 0, updatedAt: now, lastMatch: null };
}

function normalizeRecord(raw: unknown): ArenaPlayerRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultRecord();
  const p = raw as Record<string, unknown>;
  const rating = safeInt(p.rating, 1000, 100, 3000);
  const last = p.lastMatch && typeof p.lastMatch === 'object' && !Array.isArray(p.lastMatch)
    ? p.lastMatch as ArenaMatchResult
    : null;
  return {
    rating,
    wins: safeInt(p.wins, 0, 0, Number.MAX_SAFE_INTEGER),
    losses: safeInt(p.losses, 0, 0, Number.MAX_SAFE_INTEGER),
    draws: safeInt(p.draws, 0, 0, Number.MAX_SAFE_INTEGER),
    matches: safeInt(p.matches, 0, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: safeInt(p.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    lastMatch: last && ['win', 'loss', 'draw'].includes(last.outcome) && typeof last.id === 'string' ? last : null,
  };
}

function validFighter(raw: unknown): raw is ArenaFighter {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const x = raw as Record<string, any>;
  const stats = x.stats;
  return typeof x.userId === 'string' && x.userId.length > 0 && x.userId.length <= 200 &&
    typeof x.alias === 'string' && x.alias.length <= 40 &&
    Number.isSafeInteger(x.rating) && x.rating >= 100 && x.rating <= 3000 &&
    Number.isSafeInteger(x.level) && x.level >= 1 && x.level <= 60 &&
    Number.isSafeInteger(x.bestDepth) && x.bestDepth >= 1 &&
    !!stats && typeof stats === 'object' &&
    ['damage', 'speed', 'maxHealth', 'critChance', 'damageReduction', 'coinMultiplier'].every(key => Number.isFinite(stats[key])) &&
    (x.weaponTrait === null || VALID_TRAITS.includes(x.weaponTrait)) &&
    (x.armorTrait === null || VALID_TRAITS.includes(x.armorTrait));
}

function normalizeStore(raw: string | null | undefined): ArenaStore {
  if (!raw) return { queue: [], players: {} };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const queue = Array.isArray(parsed.queue)
      ? parsed.queue.filter((entry): entry is QueueEntry => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
          const item = entry as Record<string, unknown>;
          return validFighter(item.fighter) && Number.isSafeInteger(item.queuedAt) && Number(item.queuedAt) >= 0;
        }).slice(-MAX_QUEUE_SIZE)
      : [];
    const playersRaw = parsed.players && typeof parsed.players === 'object' && !Array.isArray(parsed.players)
      ? parsed.players as Record<string, unknown>
      : {};
    const players: Record<string, ArenaPlayerRecord> = {};
    for (const [id, value] of Object.entries(playersRaw).slice(-MAX_STORED_PLAYERS)) {
      if (id && id.length <= 200) players[id] = normalizeRecord(value);
    }
    return { queue, players };
  } catch {
    return { queue: [], players: {} };
  }
}

function pruneQueue(store: ArenaStore, now: number): void {
  store.queue = store.queue.filter(entry => now - entry.queuedAt <= QUEUE_EXPIRY_MS);
}

function recordFor(store: ArenaStore, userId: string, now: number): ArenaPlayerRecord {
  store.players[userId] ??= defaultRecord(now);
  return store.players[userId]!;
}

function capPlayerRecords(store: ArenaStore, protectedIds: string[]): void {
  const ids = Object.keys(store.players);
  if (ids.length <= MAX_STORED_PLAYERS) return;
  const protectedSet = new Set([...protectedIds, ...store.queue.map(entry => entry.fighter.userId)]);
  const removable = ids
    .filter(id => !protectedSet.has(id))
    .sort((a, b) => (store.players[a]?.updatedAt ?? 0) - (store.players[b]?.updatedAt ?? 0));
  while (Object.keys(store.players).length > MAX_STORED_PLAYERS && removable.length) {
    delete store.players[removable.shift()!];
  }
}

async function mutateArenaStore<T>(operation: (store: ArenaStore) => T): Promise<T> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const txn = await redis.watch(ARENA_KEY);
    let closed = false;
    try {
      const store = normalizeStore(await redis.get(ARENA_KEY));
      const result = operation(store);
      await txn.multi();
      await txn.set(ARENA_KEY, JSON.stringify(store));
      const commit = await txn.exec();
      closed = true;
      if (commit !== null) return result;
    } finally {
      if (!closed) await txn.unwatch().catch(() => undefined);
    }
  }
  throw new Error('Arena state changed repeatedly. Please retry.');
}

async function fighterForCurrentUser(userId: string, rating: number): Promise<ArenaFighter> {
  const snapshot = await getCombatSnapshot();
  const weapon = snapshot.state.inventory.find(item => item.id === snapshot.state.equipment.weapon && item.slot === 'weapon');
  const armor = snapshot.state.inventory.find(item => item.id === snapshot.state.equipment.armor && item.slot === 'armor');
  return {
    userId,
    alias: aliasFor(userId),
    rating,
    level: snapshot.state.level,
    bestDepth: snapshot.state.bestDepth,
    stats: snapshot.stats,
    weaponTrait: weapon?.trait ?? null,
    armorTrait: armor?.trait ?? null,
  };
}

function statusFromStore(store: ArenaStore, userId: string, now: number): ArenaStatus {
  const player = normalizeRecord(store.players[userId]);
  const activeQueue = store.queue.filter(entry => now - entry.queuedAt <= QUEUE_EXPIRY_MS);
  const index = activeQueue.findIndex(entry => entry.fighter.userId === userId);
  const entry = index >= 0 ? activeQueue[index]! : null;
  return {
    status: player.lastMatch ? 'matched' : entry ? 'queued' : 'idle',
    rating: player.rating,
    wins: player.wins,
    losses: player.losses,
    draws: player.draws,
    matches: player.matches,
    queueSize: activeQueue.length,
    queuePosition: index >= 0 ? index + 1 : null,
    queuedAt: entry?.queuedAt ?? null,
    lastMatch: player.lastMatch,
  };
}

function resultFor(
  id: string,
  outcome: ArenaOutcome,
  own: ArenaFighter,
  opponent: ArenaFighter,
  duel: { rounds: number; healthA: number; healthB: number; maxHealthA: number; maxHealthB: number },
  ownIsA: boolean,
  ratingBefore: number,
  ratingAfter: number,
  completedAt: number,
): ArenaMatchResult {
  const ownHealth = ownIsA ? duel.healthA : duel.healthB;
  const opponentHealth = ownIsA ? duel.healthB : duel.healthA;
  const ownMax = ownIsA ? duel.maxHealthA : duel.maxHealthB;
  const opponentMax = ownIsA ? duel.maxHealthB : duel.maxHealthA;
  return {
    id,
    outcome,
    opponentAlias: opponent.alias,
    opponentLevel: opponent.level,
    opponentBestDepth: opponent.bestDepth,
    rounds: duel.rounds,
    remainingHealth: ownHealth,
    maxHealth: ownMax,
    opponentRemainingHealth: opponentHealth,
    opponentMaxHealth: opponentMax,
    ratingBefore,
    ratingAfter,
    ratingDelta: ratingAfter - ratingBefore,
    completedAt,
  };
}

function completeMatch(store: ArenaStore, a: ArenaFighter, b: ArenaFighter, now: number): void {
  const duel = simulateArenaDuel(a, b);
  const winner = duel.winnerUserId;
  const outcomeA: ArenaOutcome = winner === null ? 'draw' : winner === a.userId ? 'win' : 'loss';
  const outcomeB: ArenaOutcome = winner === null ? 'draw' : winner === b.userId ? 'win' : 'loss';
  const recordA = recordFor(store, a.userId, now);
  const recordB = recordFor(store, b.userId, now);
  const scoreA: 0 | 0.5 | 1 = outcomeA === 'win' ? 1 : outcomeA === 'draw' ? 0.5 : 0;
  const scoreB: 0 | 0.5 | 1 = outcomeB === 'win' ? 1 : outcomeB === 'draw' ? 0.5 : 0;
  const oldA = recordA.rating;
  const oldB = recordB.rating;
  recordA.rating = Math.max(100, Math.min(3000, oldA + arenaRatingDelta(oldA, oldB, scoreA)));
  recordB.rating = Math.max(100, Math.min(3000, oldB + arenaRatingDelta(oldB, oldA, scoreB)));
  recordA.matches += 1;
  recordB.matches += 1;
  if (outcomeA === 'win') { recordA.wins += 1; recordB.losses += 1; }
  else if (outcomeA === 'loss') { recordA.losses += 1; recordB.wins += 1; }
  else { recordA.draws += 1; recordB.draws += 1; }
  recordA.updatedAt = now;
  recordB.updatedAt = now;
  const id = now.toString(36) + '-' + Math.floor(Math.random() * 0x7fffffff).toString(36);
  recordA.lastMatch = resultFor(id, outcomeA, a, b, duel, true, oldA, recordA.rating, now);
  recordB.lastMatch = resultFor(id, outcomeB, b, a, duel, false, oldB, recordB.rating, now);
  capPlayerRecords(store, [a.userId, b.userId]);
}

export async function getArenaStatus(): Promise<ArenaStatus> {
  const userId = currentUserId();
  const store = normalizeStore(await redis.get(ARENA_KEY));
  return statusFromStore(store, userId, Date.now());
}

export async function joinArenaQueue(): Promise<ArenaStatus> {
  const userId = currentUserId();
  const now = Date.now();
  const baseFighter = await fighterForCurrentUser(userId, 1000);
  return mutateArenaStore(store => {
    pruneQueue(store, now);
    const existing = store.queue.find(entry => entry.fighter.userId === userId);
    if (existing) {
      capPlayerRecords(store, [userId]);
      return statusFromStore(store, userId, now);
    }

    const record = recordFor(store, userId, now);
    if (store.queue.length >= MAX_QUEUE_SIZE) {
      throw new Error('Arena queue is full. Please try again shortly.');
    }
    record.lastMatch = null;
    const fighter: ArenaFighter = { ...baseFighter, rating: record.rating };
    const candidateIndexes = store.queue
      .map((entry, index) => ({ entry, index, ratingGap: Math.abs(entry.fighter.rating - fighter.rating) }))
      .filter(candidate => candidate.entry.fighter.userId !== userId)
      .filter(candidate => candidate.ratingGap <= 250 || now - candidate.entry.queuedAt >= 45_000)
      .sort((a, b) => a.ratingGap - b.ratingGap || a.entry.queuedAt - b.entry.queuedAt);

    const opponent = candidateIndexes[0];
    if (opponent) {
      const other = opponent.entry.fighter;
      store.queue = store.queue.filter(entry =>
        entry.fighter.userId !== userId && entry.fighter.userId !== other.userId,
      );
      completeMatch(store, fighter, other, now);
    } else {
      store.queue.push({ fighter, queuedAt: now });
      record.updatedAt = now;
    }
    capPlayerRecords(store, [userId]);
    return statusFromStore(store, userId, now);
  });
}

export async function leaveArenaQueue(): Promise<ArenaStatus> {
  const userId = currentUserId();
  const now = Date.now();
  return mutateArenaStore(store => {
    pruneQueue(store, now);
    store.queue = store.queue.filter(entry => entry.fighter.userId !== userId);
    return statusFromStore(store, userId, now);
  });
}

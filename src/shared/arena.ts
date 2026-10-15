import type { CombatStats, CombatTrait } from './combat.js';

export type ArenaOutcome = 'win' | 'loss' | 'draw';

export interface ArenaFighter {
  userId: string;
  alias: string;
  rating: number;
  level: number;
  bestDepth: number;
  stats: CombatStats;
  weaponTrait: CombatTrait | null;
  armorTrait: CombatTrait | null;
}

export interface ArenaMatchResult {
  id: string;
  outcome: ArenaOutcome;
  opponentAlias: string;
  opponentLevel: number;
  opponentBestDepth: number;
  rounds: number;
  remainingHealth: number;
  maxHealth: number;
  opponentRemainingHealth: number;
  opponentMaxHealth: number;
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  completedAt: number;
}

export interface ArenaPlayerRecord {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  updatedAt: number;
  lastMatch: ArenaMatchResult | null;
}

export interface ArenaStatus {
  status: 'idle' | 'queued' | 'matched';
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  queueSize: number;
  queuePosition: number | null;
  queuedAt: number | null;
  lastMatch: ArenaMatchResult | null;
}

export interface ArenaDuelResult {
  winnerUserId: string | null;
  rounds: number;
  healthA: number;
  healthB: number;
  maxHealthA: number;
  maxHealthB: number;
}

const MAX_ROUNDS = 50;
const MIN_RATING = 100;
const MAX_RATING = 3000;

export function arenaRatingDelta(
  rating: number,
  opponentRating: number,
  score: 0 | 0.5 | 1,
  kFactor = 24,
): number {
  const safeRating = Math.max(MIN_RATING, Math.min(MAX_RATING, Math.floor(Number(rating) || 1000)));
  const safeOpponent = Math.max(MIN_RATING, Math.min(MAX_RATING, Math.floor(Number(opponentRating) || 1000)));
  const safeK = Math.max(1, Math.min(64, Math.floor(Number(kFactor) || 24)));
  const expected = 1 / (1 + Math.pow(10, (safeOpponent - safeRating) / 400));
  return Math.round(safeK * (score - expected));
}

function clampHealth(value: number, max: number): number {
  return Math.max(0, Math.min(max, Number.isFinite(value) ? value : max));
}

function safeRandom(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0.5;
}

function actionsPerRound(fighter: ArenaFighter, health: number, maxHealth: number): number {
  const desperation = fighter.armorTrait === 'desperation' && health / maxHealth < 0.4 ? 20 : 0;
  return Math.max(1, Math.min(8, Math.floor((fighter.stats.speed + desperation) / 100)));
}

/** Resolves an opt-in PvP duel entirely on the server from server-derived combat stats. */
export function simulateArenaDuel(
  a: ArenaFighter,
  b: ArenaFighter,
  random: () => number = Math.random,
): ArenaDuelResult {
  const maxHealthA = Math.max(1, Math.min(1_000_000_000, Math.floor(a.stats.maxHealth)));
  const maxHealthB = Math.max(1, Math.min(1_000_000_000, Math.floor(b.stats.maxHealth)));
  let healthA = maxHealthA;
  let healthB = maxHealthB;
  let rounds = 0;
  let firstStrikeA = false;
  let firstStrikeB = false;

  const attack = (attacker: ArenaFighter, defender: ArenaFighter, defenderHealth: number, isFirstStrike: boolean) => {
    let multiplier = isFirstStrike && attacker.weaponTrait === 'first-strike' ? 1.5 : 1;
    const critical = safeRandom(random) < Math.max(0, Math.min(0.75, attacker.stats.critChance));
    if (critical) multiplier *= 1.75;
    let damage = Math.max(1, Math.round(Math.max(1, Math.min(1_000_000_000, attacker.stats.damage)) * multiplier));
    if (attacker.weaponTrait === 'bleed' && safeRandom(random) < 0.18) {
      damage += Math.max(1, Math.round(attacker.stats.damage * 0.3));
    }
    damage = Math.max(1, Math.round(damage * (1 - Math.max(0, Math.min(0.75, defender.stats.damageReduction)))));
    return Math.max(0, defenderHealth - damage);
  };

  for (let round = 1; round <= MAX_ROUNDS && healthA > 0 && healthB > 0; round += 1) {
    rounds = round;
    const countA = actionsPerRound(a, healthA, maxHealthA);
    const countB = actionsPerRound(b, healthB, maxHealthB);
    const aFirst = a.stats.speed === b.stats.speed ? safeRandom(random) < 0.5 : a.stats.speed > b.stats.speed;
    for (let action = 0; action < Math.max(countA, countB) && healthA > 0 && healthB > 0; action += 1) {
      const strikeA = () => {
        healthB = attack(a, b, healthB, !firstStrikeA);
        firstStrikeA = true;
      };
      const strikeB = () => {
        healthA = attack(b, a, healthA, !firstStrikeB);
        firstStrikeB = true;
      };
      if (aFirst) {
        if (action < countA) strikeA();
        if (healthA > 0 && healthB > 0 && action < countB) strikeB();
      } else {
        if (action < countB) strikeB();
        if (healthA > 0 && healthB > 0 && action < countA) strikeA();
      }
    }
  }

  const scoreA = healthA / maxHealthA;
  const scoreB = healthB / maxHealthB;
  const winnerUserId = healthA <= 0 && healthB <= 0
    ? null
    : healthA > 0 && healthB <= 0
      ? a.userId
      : healthB > 0 && healthA <= 0
        ? b.userId
        : Math.abs(scoreA - scoreB) < 0.000001
          ? null
          : scoreA > scoreB ? a.userId : b.userId;

  return {
    winnerUserId,
    rounds,
    healthA: clampHealth(healthA, maxHealthA),
    healthB: clampHealth(healthB, maxHealthB),
    maxHealthA,
    maxHealthB,
  };
}

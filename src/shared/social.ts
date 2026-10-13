import { weekKey, weekEndMs, type GuildComboState } from './game.js';

export type GuildRole = 'owner' | 'officer' | 'member';
export type ChallengeType = 'rolls' | 'value' | 'rare';

export interface GuildMember {
  username: string;
  userId?: string;
  contribution: number;
  role: GuildRole;
  trusted?: boolean;
  joinedAt?: number;
  lastLoginAt?: number;
}

export interface GuildChallenge {
  type: ChallengeType;
  target: number;
  progress: number;
  reward: number;
  label: string;
}

export interface GuildTask {
  id: string;
  type: ChallengeType;
  tier: number;
  target: number;
  progress: number;
  reward: number;
  guildXpReward: number;
  label: string;
}

export interface GuildMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
  userId?: string;
}

export interface GuildChatMuteRecord {
  userId: string;
  username: string;
  mutedAt: number;
  mutedBy: string;
}

export interface GuildPerks {
  luckRank: number; // +2% luck per rank
  speedRank: number; // -40ms roll cooldown per rank
  vaultRank: number; // +100 offline capacity per rank
  shardRank?: number; // +0.2% shard drop chance per rank
  critRank?: number; // +1.5% critical roll chance per rank
  coinRank?: number; // +10% coins earned per rank
  memberCapacityRank?: number; // +1 maximum member per rank, max 40
  tokenYieldRank?: number; // Legacy alias for taskBountyRank.
  taskBountyRank?: number; // +5% Guild Tokens from completed Guild Tasks per rank.
  comboRank?: number; // +5% Guild Combo time per rank.
  guildXpRank?: number; // +10% Guild XP generated per rank
}

export type GuildPerkId =
  | 'luckRank'
  | 'speedRank'
  | 'vaultRank'
  | 'shardRank'
  | 'critRank'
  | 'coinRank'
  | 'memberCapacityRank'
  | 'tokenYieldRank'
  | 'taskBountyRank'
  | 'comboRank'
  | 'guildXpRank';

export interface GuildBoss {
  id: string;
  name: string;
  tier: number;
  maxHp: number;
  currentHp: number;
  rewardTokens?: number; // Legacy field; no longer granted.
  rewardShards?: number; // Legacy field; no longer granted by the boss.
  rewardGuildXp?: number;
  defeated: boolean;
  contributors: Record<string, number>; // username -> damage
}

export interface Guild {
  id: string;
  name: string;
  tag: string;
  level: number;
  xp: number;
  tokens: number;
  members: GuildMember[];
  createdAt: number;
  challenge: GuildChallenge;
  tasks?: GuildTask[];
  taskCompletions?: number;
  combo?: GuildComboState;
  boss?: GuildBoss;
  perks?: GuildPerks;
  chat?: GuildMessage[];
  bannerEffect?: string;
  taxRate?: number; // 0-10% of earned Coins converted to Guild XP
}

export interface LeaderboardEntry {
  username: string;
  value: number;
  highestRarity: number;
  totalRolls: number;
  level?: number;
  title?: string;
  guildTag?: string;
  /** Timestamp of the player's first/most recent qualifying share. Required for leaderboard eligibility. */
  sharedAt?: number;
  userId?: string;
  /** Revision of the authoritative PlayerState used to build this legacy projection. */
  stateRevision?: number;
  highestDryStreak?: number;
  currentDryStreak?: number;
  playtimeMs?: number;
}

export type LeaderboardId =
  | 'collectionValue'
  | 'mostRolls'
  | 'highestDryStreak'
  | 'currentDryStreak'
  | 'bestOrb'
  | 'mostPlaytime';

export type LeaderboardBoards = Record<LeaderboardId, LeaderboardEntry[]>;

export interface GlobalChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  userId?: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  rewardCoins: number;
  rewardShards?: number;
  unlocked: boolean;
  claimed: boolean;
  category?: 'rolling' | 'rarity' | 'upgrades' | 'prestige';
}

export interface WorldEvent {
  id: string;
  title: string;
  description: string;
  goal: number;
  currentProgress: number;
  buffDescription: string;
  buffMultiplier: number;
  endsAt: number;
  tier: number;
  completed: boolean;
  /** Highest community reward tier completed this week. */
  completedTier?: number;
  weekId?: number;
}

export const ACHIEVEMENTS: Omit<Achievement, 'unlocked' | 'claimed'>[] = [
  { id: 'first-roll', name: 'First Roll', description: 'Perform 1 roll.', rewardCoins: 50, category: 'rolling' },
  { id: 'ten-rolls', name: 'Getting Started', description: 'Perform 10 rolls.', rewardCoins: 150, category: 'rolling' },
  { id: 'roll-100', name: 'Roll 100', description: 'Perform 100 rolls.', rewardCoins: 500, rewardShards: 2, category: 'rolling' },
  { id: 'roll-1000', name: 'Roll 1,000', description: 'Perform 1,000 rolls.', rewardCoins: 2500, rewardShards: 10, category: 'rolling' },
  { id: 'auto', name: 'Auto Roll', description: 'Unlock Auto Roll.', rewardCoins: 300, category: 'upgrades' },
  { id: 'speed-5s', name: 'Speed I', description: 'Reach a 5-second or lower cooldown.', rewardCoins: 400, category: 'upgrades' },
  { id: 'speed-1s', name: 'Speed II', description: 'Reach a 1-second cooldown.', rewardCoins: 2000, rewardShards: 5, category: 'upgrades' },
  { id: 'multi-10', name: 'Multi Roll ×10', description: 'Unlock Multi Roll ×10.', rewardCoins: 1500, rewardShards: 5, category: 'upgrades' },
  { id: 'rare-100', name: 'Find 1/100', description: 'Find a 1/100 or higher orb.', rewardCoins: 250, category: 'rarity' },
  { id: 'epic-1000', name: 'Find 1/1,000', description: 'Find a 1/1,000 or higher orb.', rewardCoins: 1000, rewardShards: 5, category: 'rarity' },
  { id: 'legendary-10000', name: 'Find 1/10,000', description: 'Find a 1/10,000 or higher orb.', rewardCoins: 3500, rewardShards: 15, category: 'rarity' },
  { id: 'mythic-100k', name: 'Find 1/100,000', description: 'Find a 1/100,000 or higher orb.', rewardCoins: 12000, rewardShards: 35, category: 'rarity' },
  { id: 'divine-1m', name: 'Find 1/1,000,000', description: 'Find a 1/1,000,000 or higher orb.', rewardCoins: 50000, rewardShards: 100, category: 'rarity' },
  { id: 'collection-100k', name: '100k Value', description: 'Reach 100,000 Collection Value.', rewardCoins: 3000, rewardShards: 10, category: 'rarity' },
  { id: 'collection-1m', name: '1M Value', description: 'Reach 1,000,000 Collection Value.', rewardCoins: 15000, rewardShards: 50, category: 'rarity' },
  { id: 'first-prestige', name: 'Prestige I', description: 'Complete your first Prestige.', rewardCoins: 10000, rewardShards: 25, category: 'prestige' },
];

export const CHALLENGE_POOL: GuildChallenge[] = [
  { type: 'rolls', target: 500, progress: 0, reward: 250, label: 'Perform 500 guild rolls' },
  { type: 'value', target: 50_000, progress: 0, reward: 500, label: 'Accumulate 50,000 collection value' },
  { type: 'rare', target: 5, progress: 0, reward: 750, label: 'Find five 1/100+ orbs' },
];

const GUILD_TASK_BASES: Record<ChallengeType, {
  target: number;
  reward: number;
  guildXpReward: number;
  label: (target: number) => string;
}> = {
  rolls: {
    target: 500,
    reward: 125,
    guildXpReward: 75,
    label: target => `Perform ${target.toLocaleString()} guild rolls`,
  },
  value: {
    target: 50_000,
    reward: 175,
    guildXpReward: 90,
    label: target => `Accumulate ${target.toLocaleString()} collection value`,
  },
  rare: {
    target: 5,
    reward: 250,
    guildXpReward: 120,
    label: target => `Find ${target.toLocaleString()} orbs at 1/100+ rarity`,
  },
};

export function createGuildTask(
  type: ChallengeType,
  tier = 1,
  guildLevel = 1,
): GuildTask {
  const safeTier = Math.max(1, Math.floor(Number(tier) || 1));
  const safeLevel = Math.max(1, Math.floor(Number(guildLevel) || 1));
  const levelScale = 1 + Math.min(2.5, Math.sqrt(Math.max(0, safeLevel - 1)) * 0.05);
  const typeScale = type === 'rolls' ? 1.35 : type === 'value' ? 1.45 : 1.30;
  const base = GUILD_TASK_BASES[type];

  const target = Math.max(1, Math.floor(
    base.target * Math.pow(typeScale, safeTier - 1) * levelScale,
  ));
  const reward = Math.max(1, Math.floor(
    Math.min(25_000, base.reward * Math.pow(1.22, safeTier - 1)),
  ));
  const guildXpReward = Math.max(25, Math.floor(
    Math.min(10_000, base.guildXpReward * Math.pow(1.18, safeTier - 1)),
  ));

  return {
    id: `guild-task-${type}-t${safeTier}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    tier: safeTier,
    target,
    progress: 0,
    reward,
    guildXpReward,
    label: base.label(target),
  };
}

export function createInitialGuildTasks(guildLevel = 1): GuildTask[] {
  return [
    createGuildTask('rolls', 1, guildLevel),
    createGuildTask('value', 1, guildLevel),
    createGuildTask('rare', 1, guildLevel),
  ];
}

export function createInitialGuildBoss(tier = 1): GuildBoss {
  const names = [
    'Chronos Leviathan',
    'Void Behemoth',
    'Supernova Titan',
    'Astral Colossus',
    'Infinite Eclipse',
  ];
  const name = names[(tier - 1) % names.length];
  const maxHp = 500_000 * Math.pow(2, tier - 1);
  return {
    id: `boss-t${tier}-${Date.now()}`,
    name,
    tier,
    maxHp,
    currentHp: maxHp,
    rewardTokens: 0,
    rewardShards: 10 * tier,
    rewardGuildXp: 250 * tier,
    defeated: false,
    contributors: {},
  };
}

export function challengeForWeek() {
  const week = weekKey();
  return { ...CHALLENGE_POOL[week % CHALLENGE_POOL.length] };
}

const currentWeekNumber = weekKey();

export const COMMUNITY_WORLD_EVENT: WorldEvent = {
  id: 'world-event-1',
  title: 'Weekly Community Milestone',
  description: 'Community rolls contributed this week toward dynamic tier goals.',
  goal: 100_000,
  currentProgress: 14_250,
  buffDescription: '+15% Global Luck Active',
  buffMultiplier: 1.15,
  endsAt: weekEndMs(),
  tier: 1,
  completed: false,
  completedTier: 0,
  weekId: currentWeekNumber,
};

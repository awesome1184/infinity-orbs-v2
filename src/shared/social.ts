import { weekKey, weekEndMs, type GuildComboState } from './game.js';

export type GuildRole = 'owner' | 'officer' | 'member';
export type ChallengeType = 'rolls' | 'value' | 'rare';

/**
 * Guild task targets grow exponentially. Keep the generated tier finite while
 * allowing Collection Value goals well beyond Number.MAX_SAFE_INTEGER.
 */
export const MAX_GUILD_TASK_TIER = 100;

/**
 * Legacy curated-name helpers remain for compatibility with older saved data.
 * New Guilds use direct custom names and Reddit user flair for member attribution.
 */
export const GUILD_NAME_FIRST_WORDS = [
  'Ashen', 'Bright', 'Cinder', 'Dread', 'Ember', 'Frost',
  'Gilded', 'Hollow', 'Ironbound', 'Jade', 'Kindled', 'Lunar',
  'Mystic', 'Nether', 'Obsidian', 'Primal', 'Quartz', 'Radiant',
  'Shadowed', 'Thorned', 'Umbral', 'Verdant', 'Wraith', 'Xenial',
  'Yonder', 'Zealous',
] as const;

export const GUILD_NAME_SECOND_WORDS = [
  'Astral', 'Blazing', 'Celestial', 'Dawnbound', 'Everlight', 'Farseeing',
  'Grim', 'Hallowed', 'Infinite', 'Jagged', 'Kingsfall', 'Lightforged',
  'Moonfallen', 'Nightborn', 'Oathbound', 'Phoenix', 'Quicksilver', 'Riftwoven',
  'Starforged', 'Timeworn', 'Unbroken', 'Voidwoven', 'Windborne', 'Xenith',
  'Yearning', 'Zephyr',
] as const;

export const GUILD_NAME_NOUNS = [
  'Alliance', 'Bastion', 'Covenant', 'Dominion', 'Enclave', 'Fellowship',
  'Guard', 'Horde', 'Imperium', 'Junction', 'Keep', 'Legion',
  'Monastery', 'Nexus', 'Order', 'Pact', 'Quorum', 'Realm',
  'Sanctuary', 'Tribunal', 'Union', 'Vanguard', 'Watch', 'Xanadu',
  'Yard', 'Zeal',
] as const;

export function composeGuildName(firstWord: string, secondWord: string, noun: string): string {
  const approvedFirst = (GUILD_NAME_FIRST_WORDS as readonly string[]).includes(firstWord);
  const approvedSecond = (GUILD_NAME_SECOND_WORDS as readonly string[]).includes(secondWord);
  const approvedNoun = (GUILD_NAME_NOUNS as readonly string[]).includes(noun);
  return approvedFirst && approvedSecond && approvedNoun
    ? firstWord + ' ' + secondWord + ' ' + noun
    : '';
}

export function isApprovedGuildName(name: string): boolean {
  const parts = name.trim().split(/\s+/);
  return parts.length === 3 &&
    composeGuildName(parts[0] ?? '', parts[1] ?? '', parts[2] ?? '') === name.trim();
}

export function guildTagForName(name: string): string {
  if (!isApprovedGuildName(name)) return '';
  return name.trim().split(/\s+/).map(part => part[0]?.toUpperCase() ?? '').join('');
}

/**
 * Three-letter Guild tags that must never be assigned. Keep this list limited
 * to unmistakable hate-group identifiers and common profanity/sexual slurs.
 */
export const BLOCKED_GUILD_TAGS = [
  'ASS', 'CUM', 'FAG', 'FCK', 'FUC', 'FUK', 'KKK', 'NAZ', 'NIG', 'PIS', 'SHT', 'WTF',
] as const;

const BLOCKED_GUILD_TAG_SET: ReadonlySet<string> = new Set(BLOCKED_GUILD_TAGS);

/** Check both the fixed safety blocklist and tags already used by other Guilds. */
export function isGuildTagAllowed(tag: string, takenTags?: ReadonlySet<string>): boolean {
  const normalizedTag = typeof tag === 'string' ? tag.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(normalizedTag) || BLOCKED_GUILD_TAG_SET.has(normalizedTag)) return false;
  if (takenTags && Array.from(takenTags).some(taken => String(taken).trim().toUpperCase() === normalizedTag)) return false;
  return true;
}

/**
 * Return only word choices whose initials remain safe and unused when paired
 * with the other two currently selected Guild name parts.
 */
export function getAvailableGuildNameOptions(
  part: 'first' | 'second' | 'noun',
  firstWord: string,
  secondWord: string,
  noun: string,
  takenTags?: ReadonlySet<string>,
): string[] {
  const options: readonly string[] = part === 'first'
    ? GUILD_NAME_FIRST_WORDS
    : part === 'second'
      ? GUILD_NAME_SECOND_WORDS
      : GUILD_NAME_NOUNS;

  return options.filter(option => {
    const name = composeGuildName(
      part === 'first' ? option : firstWord,
      part === 'second' ? option : secondWord,
      part === 'noun' ? option : noun,
    );
    return isGuildTagAllowed(guildTagForName(name), takenTags);
  });
}

/** Apply the same bounded, control-safe normalization to every Guild name path. */
export function normalizeGuildName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
    .trim();
}

/** Format the Reddit user flair as a guild identity followed by the member's best orb tier. */
export function buildGuildUserFlair(guildName: unknown, highestOrbTier: unknown): string {
  const name = normalizeGuildName(guildName);
  const tier = typeof highestOrbTier === 'string'
    ? highestOrbTier.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    : '';
  if (!name) return tier.slice(0, 64);
  if (!tier) return name.slice(0, 64);
  const suffix = ` - ${tier}`;
  const availableNameLength = Math.max(0, 64 - suffix.length);
  const safeName = name.slice(0, availableNameLength).trimEnd();
  return safeName ? safeName + suffix : tier.slice(0, 64);
}

/** Normalize a non-negative Collection Value amount without a safe-integer ceiling. */
export function normalizeGuildValueProgress(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/** Add approximate large Collection Value amounts, saturating only at Number.MAX_VALUE. */
export function addGuildValueProgress(current: unknown, amount: unknown): number {
  const sum = normalizeGuildValueProgress(current) + normalizeGuildValueProgress(amount);
  return Number.isFinite(sum) ? sum : Number.MAX_VALUE;
}

/** Above MAX_SAFE_INTEGER JavaScript numbers lose unit precision, but finite integer progress remains usable. */
export function isGuildValueProgress(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isFinite(value) &&
    Number.isInteger(value) && value >= minimum;
}

export interface GuildMember {
  username: string;
  userId?: string;
  contribution: number;
  role: GuildRole;
  trusted?: boolean;
  joinedAt?: number;
  lastLoginAt?: number;
}

/** Match an account by immutable Reddit ID whenever the saved member has one. */
export function guildMemberMatchesIdentity(
  member: Pick<GuildMember, 'username' | 'userId'>,
  requestedUsername: string,
  requestedUserId?: string,
): boolean {
  if (typeof member.userId === 'string' && member.userId.length > 0) {
    return typeof requestedUserId === 'string' && requestedUserId.length > 0 && member.userId === requestedUserId;
  }
  return member.username === requestedUsername;
}

/** Ensure a guild still has an owner after its current owner departs. */
export function promoteGuildOwnerIfNeeded(members: GuildMember[]): void {
  if (members.length === 0 || members.some(member => member.role === 'owner')) return;
  const successor = [...members].sort((a, b) => b.contribution - a.contribution)[0];
  if (!successor) return;
  successor.role = 'owner';
  successor.trusted = true;
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
  shardRank?: number; // +0.00125% shard drop chance per rank before the shared cap
  critRank?: number; // +1.5% critical roll chance per rank
  coinRank?: number; // +10% coins earned per rank
  memberCapacityRank?: number; // +1 maximum member per rank, max 40
  tokenYieldRank?: number; // Legacy alias for taskBountyRank.
  taskBountyRank?: number; // +5% Guild Tokens from completed Guild Tasks per rank.
  comboRank?: number; // +5% Guild Combo time per rank.
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
;

export interface Guild {
  id: string;
  name: string;
  /** Legacy approval metadata; removed from Guild records by the custom-name restore migration. */
  nameStatus?: 'pending' | 'approved' | 'rejected';
  tag: string;
  tokens: number;
  members: GuildMember[];
  createdAt: number;
  challenge: GuildChallenge;
  tasks?: GuildTask[];
  taskCompletions?: number;
  combo?: GuildComboState;
  perks?: GuildPerks;
  chat?: GuildMessage[];
  bannerEffect?: string;
}

/** Legacy queued request shape, read once by the custom-name restore migration. */
export interface GuildNameRequest {
  requestId: string;
  guildId: string;
  requestedName: string;
  submittedBy: string;
  submittedByUserId: string;
  submittedAt: number;
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
  /** Entry retained from an older leaderboard projection when its account ID is unavailable. */
  legacyOnly?: boolean;
  /** Revision of the authoritative PlayerState used to build this legacy projection. */
  stateRevision?: number;
  highestDryStreak?: number;
  currentDryStreak?: number;
  playtimeMs?: number;
  chainLength?: number;
  /** Best dungeon depth reached, merged across all saved dungeon progress. */
  bestDepth?: number;
}

export type LeaderboardId =
  | 'collectionValue'
  | 'mostRolls'
  | 'highestDryStreak'
  | 'currentDryStreak'
  | 'bestOrb'
  | 'mostPlaytime'
  | 'chainLength'
  | 'highestDepthReached';

export type LeaderboardBoards = Record<LeaderboardId, LeaderboardEntry[]>;

export interface GlobalChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
  userId?: string;
  /** Computed by the server from the authoritative Reddit author name. */
  isAdmin?: boolean;
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
  label: (target: number) => string;
}> = {
  rolls: {
    target: 500,
    reward: 125,
    label: target => `Perform ${target.toLocaleString()} guild rolls`,
  },
  value: {
    target: 50_000,
    reward: 175,
    label: target => `Accumulate ${target.toLocaleString()} collection value`,
  },
  rare: {
    target: 5,
    reward: 250,
    label: target => `Find ${target.toLocaleString()} orbs at 1/100+ rarity`,
  },
};

export function countGuildTaskRareOrbs(
  rarities: readonly number[],
  weights: readonly number[],
  minimumRarity = 100,
): number {
  const threshold = Number.isFinite(minimumRarity) ? Math.max(2, minimumRarity) : 100;
  const count = Math.min(rarities.length, weights.length);
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const rarity = Number(rarities[index]);
    const weight = Number(weights[index]);
    if (!Number.isFinite(rarity) || rarity < threshold || !Number.isFinite(weight) || weight <= 0) continue;
    total = Math.min(Number.MAX_SAFE_INTEGER, total + Math.max(0, Math.floor(weight)));
  }
  return total;
}

export function createGuildTask(
  type: ChallengeType,
  tier = 1,
): GuildTask {
  const safeTier = Math.min(MAX_GUILD_TASK_TIER, Math.max(1, Math.floor(Number(tier) || 1)));
  // Value goals deliberately reach ~1.5e85 at Tier 100. Rolls and rare-Orb
  // tasks keep their existing, much gentler curves.
  const typeScale = type === 'rolls' ? 1.35 : type === 'value' ? 6.5 : 1.30;
  const base = GUILD_TASK_BASES[type];

  const target = Math.max(1, Math.floor(
    base.target * Math.pow(typeScale, safeTier - 1),
  ));
  const reward = Math.max(1, Math.floor(
    Math.min(25_000, base.reward * Math.pow(1.22, safeTier - 1)),
  ));

  return {
    id: `guild-task-${type}-t${safeTier}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    tier: safeTier,
    target,
    progress: 0,
    reward,
    label: base.label(target),
  };
}

export function createInitialGuildTasks(): GuildTask[] {
  return [
    createGuildTask('rolls', 1),
    createGuildTask('value', 1),
    createGuildTask('rare', 1),
  ];
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

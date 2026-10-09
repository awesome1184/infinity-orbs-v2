import { context, redis, reddit } from './devvit-mock.js';
import { withPlayerMutationLockFor } from './player-lock.js';
import type {
  Guild,
  LeaderboardEntry,
  Achievement,
  GuildMessage,
  GuildPerkId,
  GuildTask,
  WorldEvent,
  GlobalChatMessage,
} from '../shared/social.js';
import {
  ACHIEVEMENTS,
  createGuildTask,
  createInitialGuildTasks,
  CHALLENGE_POOL,
  challengeForWeek,
  COMMUNITY_WORLD_EVENT,
  createInitialGuildBoss,
} from '../shared/social.js';
import type { DailyStreakCommunityEvent, PlayerState } from '../shared/game.js';
import {
  cooldownMs,
  createInitialState,
  createInitialDailyStreakCommunity,
  grantFreeShards,
  weekEndMs,
  weekKey,
  createInitialGuildCombo,
  decayGuildComboState,
  activateGuildComboStack,
  type GuildComboState,
} from '../shared/game.js';

const user = () => context.userId ?? 'unknown';
const username = () => context.username ?? `reddit-user-${user().slice(-8)}`;
const key = (name: string) => `io:${name}`;
const GUILDS_KEY = key('guilds');
const PLAYER_REGISTRY_KEY = key('player-registry');
const GUILD_CHAT_MUTES_KEY = key('guild-chat-mutes:v1');
const GUILD_TOKEN_RESET_KEY = key('guild-token-reset:v1');
const GUILD_UPGRADE_RESET_KEY = key('guild-upgrade-reset:v1');

function parseStoredJson<T>(raw: unknown): T | null {
  if (raw == null) return null;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  if (typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    // Be tolerant of Redis/adapter responses that wrap the stored value.
    if ('value' in value) return parseStoredJson<T>(value.value);
    if ('data' in value) return parseStoredJson<T>(value.data);
    return raw as T;
  }

  return null;
}

async function ensureRedisStringKey(keyName: string, fallback: string): Promise<void> {
  const existing = await redis.get(keyName);
  if (existing == null) {
    // Another request may initialize this key after our GET. NX prevents this
    // fallback write from overwriting a real value created in that interval.
    await redis.set(keyName, fallback, { nx: true });
  }
}

function parseGuildList(raw: unknown): Guild[] {
  const parsed = parseStoredJson<unknown>(raw);
  if (!Array.isArray(parsed)) return [];
  return normalizeGuilds(parsed.filter(item => item && typeof item === 'object') as Guild[]);
}

function parseLeaderboardList(raw: unknown): LeaderboardEntry[] {
  const parsed = parseStoredJson<unknown>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(item => item && typeof item === 'object') as LeaderboardEntry[];
}
const COMMUNITY_EVENT_KEY = key('community_event');

function normalizeGuilds(guilds: Guild[], now = Date.now()): Guild[] {
  const currentWeek = weekKey(now);
  for (const g of guilds) {
    if (!g.perks) {
      g.perks = {
        luckRank: 0,
        speedRank: 0,
        vaultRank: 0,
        shardRank: 0,
        critRank: 0,
        coinRank: 0,
        memberCapacityRank: 0,
        tokenYieldRank: 0,
        taskBountyRank: 0,
        comboRank: 0,
        guildXpRank: 0,
      };
    } else {
      if (g.perks.memberCapacityRank == null) {
        g.perks.memberCapacityRank = Math.min(40, Math.max(0, g.members.length - 10));
      }
      const legacyTaskBounty = Math.max(0, Math.floor(Number(g.perks.tokenYieldRank ?? 0) || 0));
      const currentTaskBounty = Math.max(0, Math.floor(Number(g.perks.taskBountyRank ?? 0) || 0));
      g.perks.taskBountyRank = Math.max(legacyTaskBounty, currentTaskBounty);
      g.perks.tokenYieldRank = g.perks.taskBountyRank;
      g.perks.comboRank ??= 0;
      g.perks.guildXpRank ??= 0;
    }
    g.taxRate = Math.max(0, Math.min(10, Math.floor(Number(g.taxRate ?? 0) || 0)));
    for (const member of g.members) {
      if (member.role === 'owner') member.trusted = true;
      member.userId = member.userId || undefined;
    }
    if (!g.boss || (g as any).bossWeek !== currentWeek) {
      g.boss = createInitialGuildBoss(Math.max(1, Math.min(10, g.level || 1)));
      (g as any).bossWeek = currentWeek;
    }
    if (!Array.isArray(g.tasks) || g.tasks.length < 3) {
      const generated = createInitialGuildTasks(g.level || 1);
      if (g.challenge) {
        generated[0] = {
          ...generated[0],
          type: g.challenge.type,
          target: Math.max(1, Math.floor(g.challenge.target || generated[0].target)),
          progress: Math.max(0, Math.min(
            Math.max(1, Math.floor(g.challenge.target || generated[0].target)),
            Math.floor(g.challenge.progress || 0),
          )),
          reward: Math.max(1, Math.floor(g.challenge.reward || generated[0].reward)),
          label: g.challenge.label || generated[0].label,
        };
      }
      g.tasks = generated;
    } else {
      g.tasks = g.tasks.slice(0, 3).map((task, index) => {
        const type: GuildTask['type'] =
          task.type === 'rolls' || task.type === 'value' || task.type === 'rare'
            ? task.type
            : generatedFallbackTaskType(index);
        const generated = createGuildTask(
          type,
          Math.max(1, Math.floor(Number(task.tier ?? 1) || 1)),
          g.level || 1,
        );
        const target = Math.max(1, Math.floor(Number(task.target ?? generated.target) || generated.target));
        return {
          ...generated,
          ...task,
          id: task.id || generated.id,
          type,
          tier: Math.max(1, Math.floor(Number(task.tier ?? generated.tier) || generated.tier)),
          target,
          progress: Math.max(0, Math.min(target, Math.floor(Number(task.progress ?? 0) || 0))),
          reward: Math.max(1, Math.floor(Number(task.reward ?? generated.reward) || generated.reward)),
          guildXpReward: Math.max(1, Math.floor(Number(task.guildXpReward ?? generated.guildXpReward) || generated.guildXpReward)),
          label: String(task.label || generated.label),
        };
      });
    }

    while (g.tasks.length < 3) {
      g.tasks.push(createGuildTask(generatedFallbackTaskType(g.tasks.length), 1, g.level || 1));
    }

    g.taskCompletions = Math.max(0, Math.floor(Number(g.taskCompletions ?? 0) || 0));

    // A combo is also the timer for the escalating task cycle. Once it expires,
    // the entire task set starts over at tier 1 instead of leaving the guild
    // permanently stuck with the old difficulty.
    const comboEndsAt = Math.max(0, Math.floor(Number(g.combo?.endsAt ?? 0) || 0));
    const comboTier = Math.max(0, Math.floor(Number(g.combo?.tier ?? 0) || 0));
    const comboExpired = comboTier > 0 && comboEndsAt > 0 && comboEndsAt <= now;
    if (comboExpired) {
      g.tasks = createInitialGuildTasks(g.level || 1);
    }
    g.combo = decayGuildComboState(g.combo, now);

    const firstTask = g.tasks[0];
    g.challenge = {
      type: firstTask.type,
      target: firstTask.target,
      progress: Math.min(firstTask.target, firstTask.progress),
      reward: firstTask.reward,
      label: firstTask.label,
    };
    (g as any).challengeWeek = currentWeek;
  }
  return guilds;
}

function generatedFallbackTaskType(index: number): GuildTask['type'] {
  return index === 0 ? 'rolls' : index === 1 ? 'value' : 'rare';
}

function memberMatches(member: Guild['members'][number], requestedUsername?: string): boolean {
  const currentUsername = username();
  return Boolean(
    (member.userId && member.userId === user()) ||
    member.username === requestedUsername ||
    member.username === currentUsername,
  );
}

function currentGuild(guilds: Guild[]): Guild | undefined {
  return guilds.find(g => g.members.some(member => memberMatches(member)));
}

function maxGuildMembers(guild: Guild): number {
  return 10 + Math.min(40, Math.max(0, Math.floor(guild.perks?.memberCapacityRank ?? 0)));
}

function isTrustedMember(guild: Guild, member: Guild['members'][number]): boolean {
  return member.role === 'owner' || member.role === 'officer' || member.trusted === true;
}

function guildPerkMax(perk: GuildPerkId): number {
  if (perk === 'memberCapacityRank') return 40;
  if (perk === 'tokenYieldRank' || perk === 'taskBountyRank' || perk === 'guildXpRank') return 20;
  if (perk === 'comboRank') return 10;
  return 10;
}

function guildPerkCost(perk: GuildPerkId, currentRank: number): number {
  const base = perk === 'memberCapacityRank' ? 250 : perk === 'comboRank' ? 150 : 100;
  const exponent = perk === 'memberCapacityRank' ? 1.45 : perk === 'comboRank' ? 1.55 : 1.65;
  return Math.max(1, Math.round(base * Math.pow(currentRank + 1, exponent)));
}

async function updateGuilds<T>(mutator: (guilds: Guild[]) => Promise<T> | T): Promise<T> {
  // The transaction client queues the pre-MULTI GET for EXEC. If the key does not
  // exist, Valkey returns nil for that command and the adapter cannot transform
  // the transaction result. Initialize the collection once so the watched GET
  // always has a concrete string reply.
  await ensureRedisStringKey(GUILDS_KEY, '[]');

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(GUILDS_KEY);
    const raw = await redis.get(GUILDS_KEY);
    const guilds: Guild[] = parseGuildList(raw);
    try {
      const result = await mutator(guilds);
      await txn.multi();
      await txn.set(GUILDS_KEY, JSON.stringify(guilds));
      const committed = await txn.exec();
      if (committed !== null) return result;
    } catch (error) {
      await txn.unwatch();
      throw error;
    }
  }
  throw new Error('Guild data changed while processing the request. Please retry.');
}


async function loadGuilds(): Promise<Guild[]> {
  const raw = await redis.get(GUILDS_KEY);
  const rawParsed = parseStoredJson<unknown>(raw);
  const rawGuilds = Array.isArray(rawParsed)
    ? rawParsed.filter(item => item && typeof item === 'object') as Guild[]
    : [];
  const guilds = normalizeGuilds(rawGuilds);
  const now = Date.now();
  const expiredCombo = rawGuilds.some(g => {
    const tier = Math.max(0, Math.floor(Number(g.combo?.tier ?? 0) || 0));
    const endsAt = Math.max(0, Math.floor(Number(g.combo?.endsAt ?? 0) || 0));
    return tier > 0 && endsAt > 0 && endsAt <= now;
  });

  // One-time update migration: reset every Guild Upgrade rank to its base value.
  // A shared lock plus a fresh marker check prevents a request that observed the
  // old missing marker from running this destructive migration a second time.
  const upgradeResetDone = await redis.get(GUILD_UPGRADE_RESET_KEY);
  if (!upgradeResetDone && guilds.length > 0) {
    const migrated = await withPlayerMutationLockFor('__guild-upgrade-reset-migration__', async () => {
      if (await redis.get(GUILD_UPGRADE_RESET_KEY)) return false;
      const latestGuilds = parseGuildList(await redis.get(GUILDS_KEY));
      if (latestGuilds.length === 0) return false;
      await updateGuilds(current => {
        for (const guild of current) {
          guild.perks = {
            luckRank: 0,
            speedRank: 0,
            vaultRank: 0,
            shardRank: 0,
            critRank: 0,
            coinRank: 0,
            memberCapacityRank: 0,
            tokenYieldRank: 0,
            taskBountyRank: 0,
            comboRank: 0,
            guildXpRank: 0,
          };
        }
        return current;
      });
      await redis.set(GUILD_UPGRADE_RESET_KEY, '1');
      return true;
    });
    if (migrated) return parseGuildList(await redis.get(GUILDS_KEY));
  }

  // One-time economy migration: clear all existing Guild Token treasury balances.
  // Serialize the migration and re-check its marker after acquiring the lock so
  // a delayed request cannot erase tokens earned after another request migrated.
  const resetDone = await redis.get(GUILD_TOKEN_RESET_KEY);
  if (!resetDone && guilds.length > 0) {
    const migrated = await withPlayerMutationLockFor('__guild-token-reset-migration__', async () => {
      if (await redis.get(GUILD_TOKEN_RESET_KEY)) return false;
      const latestGuilds = parseGuildList(await redis.get(GUILDS_KEY));
      if (latestGuilds.length === 0) return false;
      await updateGuilds(current => {
        for (const guild of current) guild.tokens = 0;
        return current;
      });
      await redis.set(GUILD_TOKEN_RESET_KEY, '1');
      return true;
    });
    if (migrated) return parseGuildList(await redis.get(GUILDS_KEY));
  }

  if (expiredCombo) {
    // Persist the expiry reset so a later read cannot resurrect the old task tiers.
    for (let attempt = 0; attempt < 4; attempt++) {
      const txn = await redis.watch(GUILDS_KEY);
      const latestRaw = await redis.get(GUILDS_KEY);
      const latestParsed = parseStoredJson<unknown>(latestRaw);
      const latestRawGuilds = Array.isArray(latestParsed)
        ? latestParsed.filter(item => item && typeof item === 'object') as Guild[]
        : [];
      const latest = normalizeGuilds(latestRawGuilds);
      const latestExpired = latestRawGuilds.some(g => {
        const tier = Math.max(0, Math.floor(Number(g.combo?.tier ?? 0) || 0));
        const endsAt = Math.max(0, Math.floor(Number(g.combo?.endsAt ?? 0) || 0));
        return tier > 0 && endsAt > 0 && endsAt <= Date.now();
      });
      if (!latestExpired) {
        await txn.unwatch();
        return latest;
      }

      normalizeGuilds(latest, Date.now());
      await txn.multi();
      await txn.set(GUILDS_KEY, JSON.stringify(latest));
      const committed = await txn.exec();
      if (committed !== null) return latest;
    }
    throw new Error('Guild data changed while processing combo expiry. Please retry.');
  }

  return guilds;
}

export interface GuildChatSpyGuild {
  id: string;
  name: string;
  tag: string;
  memberCount: number;
  messages: GuildMessage[];
}

export async function listGuildChatSpy(): Promise<{
  guilds: GuildChatSpyGuild[];
  mutes: import('../shared/social.js').GuildChatMuteRecord[];
}> {
  const guilds = await loadGuilds();
  const rawMutes = await redis.hGetAll(GUILD_CHAT_MUTES_KEY);
  const mutes: import('../shared/social.js').GuildChatMuteRecord[] = [];

  if (rawMutes && typeof rawMutes === 'object') {
    for (const [userId, raw] of Object.entries(rawMutes as Record<string, string>)) {
      if (!raw) continue;
      const parsed = parseStoredJson<import('../shared/social.js').GuildChatMuteRecord>(raw);
      if (!parsed || !parsed.userId || !parsed.username) continue;
      mutes.push({
        userId: parsed.userId || userId,
        username: parsed.username,
        mutedAt: Number(parsed.mutedAt ?? 0) || 0,
        mutedBy: parsed.mutedBy || 'Admin',
      });
    }
  }

  mutes.sort((a, b) => b.mutedAt - a.mutedAt);

  return {
    guilds: guilds.map(guild => ({
      id: guild.id,
      name: guild.name,
      tag: guild.tag,
      memberCount: guild.members.length,
      messages: Array.isArray(guild.chat) ? guild.chat : [],
    })),
    mutes,
  };
}

export async function isGuildChatMuted(userId = user()): Promise<boolean> {
  if (!userId || userId === 'unknown') return false;
  const raw = await redis.hGet(GUILD_CHAT_MUTES_KEY, userId);
  return Boolean(raw);
}

export async function muteGuildChatUser(
  userId: string,
  targetUsername: string,
  mutedBy = username(),
): Promise<import('../shared/social.js').GuildChatMuteRecord> {
  const record: import('../shared/social.js').GuildChatMuteRecord = {
    userId: String(userId),
    username: String(targetUsername).trim().replace(/^u\//i, ''),
    mutedAt: Date.now(),
    mutedBy: String(mutedBy).trim() || 'Admin',
  };
  await redis.hSet(GUILD_CHAT_MUTES_KEY, {
    [record.userId]: JSON.stringify(record),
  });

  // A mute is a full chat moderation action: block future messages and remove
  // all retained historical messages from both Guild Chat and Global Chat.
  await purgeChatMessagesForUser(record.userId, record.username);
  return record;
}

export async function unmuteGuildChatUser(userId: string): Promise<boolean> {
  const existing = await redis.hGet(GUILD_CHAT_MUTES_KEY, userId);
  if (!existing) return false;
  await redis.hSet(GUILD_CHAT_MUTES_KEY, { [userId]: '' });
  return true;
}

async function hideGuildLastLogins(guild: Guild): Promise<Guild> {
  return {
    ...guild,
    members: guild.members.map(member => {
      const { lastLoginAt: _lastLoginAt, ...safeMember } = member;
      return safeMember;
    }),
  };
}

async function hydrateGuildLastLogins(guild: Guild, actor: Guild['members'][number]): Promise<Guild> {
  if (!isTrustedMember(guild, actor)) return hideGuildLastLogins(guild);

  const rawRegistry = await redis.hGetAll(PLAYER_REGISTRY_KEY);
  const records = rawRegistry && typeof rawRegistry === 'object'
    ? rawRegistry as Record<string, string>
    : {};

  return {
    ...guild,
    members: guild.members.map(member => {
      const activity = member.userId
        ? parseStoredJson<Partial<{ lastLoginAt: number; lastSeenAt: number }>>(records[member.userId])
        : null;
      const lastLoginAt = Number(
        activity?.lastLoginAt ??
        activity?.lastSeenAt ??
        member.lastLoginAt ??
        0,
      ) || 0;
      return lastLoginAt > 0 ? { ...member, lastLoginAt } : { ...member };
    }),
  };
}

export async function guildInfo() {
  const guilds = await loadGuilds();
  const mine = currentGuild(guilds);
  const visibleGuilds = guilds
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 20)
    .map(guild => ({
      ...guild,
      members: guild.members.map(member => {
        const { lastLoginAt: _lastLoginAt, ...safeMember } = member;
        return safeMember;
      }),
    }));

  let visibleMine: Guild | null = null;
  if (mine) {
    const actor = mine.members.find(member => memberMatches(member));
    visibleMine = actor
      ? await hydrateGuildLastLogins(mine, actor)
      : await hideGuildLastLogins(mine);
  }

  return {
    guilds: visibleGuilds,
    mine: visibleMine,
  };
}

export async function getPlayerGuildPerks(uname: string, uid?: string) {
  const guilds = await loadGuilds();
  const mine = guilds.find(g => g.members.some(m => (uid && m.userId === uid) || m.username === uname));
  return mine?.perks ?? {
    luckRank: 0,
    speedRank: 0,
    vaultRank: 0,
    shardRank: 0,
    critRank: 0,
    coinRank: 0,
    memberCapacityRank: 0,
    tokenYieldRank: 0,
    taskBountyRank: 0,
    comboRank: 0,
    guildXpRank: 0,
  };
}

export async function getPlayerGuildCombo(uname: string, uid?: string): Promise<GuildComboState> {
  const guilds = await loadGuilds();
  const mine = guilds.find(g => g.members.some(m => (uid && m.userId === uid) || m.username === uname));
  return decayGuildComboState(mine?.combo);
}

export async function buyGuildPerk(perk: GuildPerkId) {
  return updateGuilds(guilds => {
    const guild = currentGuild(guilds);
    if (!guild) throw new Error('You are not in a guild.');
    const member = guild.members.find(m => memberMatches(m));
    if (!member || !isTrustedMember(guild, member)) {
      throw new Error('You are not trusted to purchase Guild Upgrades.');
    }

    if (!guild.perks) guild.perks = {
      luckRank: 0, speedRank: 0, vaultRank: 0, shardRank: 0,
      critRank: 0, coinRank: 0, memberCapacityRank: 0, tokenYieldRank: 0,
      taskBountyRank: 0, comboRank: 0, guildXpRank: 0,
    };

    if (perk === 'tokenYieldRank') perk = 'taskBountyRank';
    const current = Math.max(0, Math.floor(
      perk === 'taskBountyRank'
        ? (guild.perks.taskBountyRank ?? guild.perks.tokenYieldRank ?? 0)
        : (guild.perks[perk] ?? 0),
    ));
    const max = guildPerkMax(perk);
    if (current >= max) throw new Error(`Perk is already max level (${max}).`);

    const cost = guildPerkCost(perk, current);
    if ((guild.tokens ?? 0) < cost) {
      throw new Error(`Guild needs ${cost.toLocaleString()} Guild Tokens.`);
    }

    guild.tokens -= cost;
    guild.perks[perk] = current + 1;
    if (perk === 'taskBountyRank') guild.perks.tokenYieldRank = current + 1;

    const perkNames: Record<GuildPerkId, string> = {
      luckRank: 'Luck Aura',
      speedRank: 'Speed Blessing',
      vaultRank: 'Vault Expansion',
      shardRank: 'Shard Attunement',
      critRank: 'Critical Alignment',
      coinRank: 'Prosperity Sigil',
      memberCapacityRank: 'Member Capacity',
      tokenYieldRank: 'Task Bounty',
      taskBountyRank: 'Task Bounty',
      comboRank: 'Combo Reserve',
      guildXpRank: 'Guild Growth',
    };

    if (!guild.chat) guild.chat = [];
    guild.chat.push({
      id: `msg-${Date.now()}`,
      username: 'System',
      text: `${username()} upgraded ${perkNames[perk]} to Level ${guild.perks[perk]}.`,
      timestamp: Date.now(),
      isSystem: true,
    });
    if (guild.chat.length > 50) guild.chat.shift();

    return { guild, perk, level: guild.perks[perk], cost };
  });
}

export async function setGuildTrust(targetUsername: string, trusted: boolean) {
  return updateGuilds(guilds => {
    const guild = currentGuild(guilds);
    if (!guild) throw new Error('You are not in a guild.');
    const actor = guild.members.find(m => memberMatches(m));
    if (!actor || actor.role !== 'owner') {
      throw new Error('Only the guild owner can change Trust status.');
    }
    const target = guild.members.find(m => m.username === targetUsername);
    if (!target) throw new Error('Guild member not found.');
    if (target.role === 'owner') {
      target.trusted = true;
    } else {
      target.trusted = trusted;
    }
    return target;
  });
}

export async function kickGuildMember(targetUsername: string) {
  const requested = String(targetUsername ?? '').trim().replace(/^u\//i, '').toLowerCase();
  if (!requested) throw new Error('Guild member username is required.');

  return updateGuilds(guilds => {
    const guild = currentGuild(guilds);
    if (!guild) throw new Error('You are not in a guild.');

    const actor = guild.members.find(member => memberMatches(member));
    if (!actor) throw new Error('Guild membership could not be verified.');

    const target = guild.members.find(member => member.username.toLowerCase() === requested);
    if (!target) throw new Error('Guild member not found.');
    if (target.username === actor.username || (target.userId && target.userId === actor.userId)) {
      throw new Error('You cannot kick yourself.');
    }
    if (target.role === 'owner') throw new Error('The guild owner cannot be kicked.');

    if (actor.role !== 'owner') {
      if (!isTrustedMember(guild, actor)) {
        throw new Error('Only trusted members can kick Guild members.');
      }
      if (target.role === 'officer' || target.trusted === true) {
        throw new Error('Trusted members can only kick non-trusted members.');
      }
    }

    guild.members = guild.members.filter(member =>
      !(member.username === target.username || (member.userId && target.userId && member.userId === target.userId)),
    );

    if (!guild.chat) guild.chat = [];
    guild.chat.push({
      id: 'msg-' + Date.now() + '-kick',
      username: 'System',
      text: actor.username + ' kicked ' + target.username + ' from the guild.',
      timestamp: Date.now(),
      isSystem: true,
    });
    if (guild.chat.length > 50) guild.chat.shift();

    return { success: true, username: target.username };
  });
}


export async function setGuildTaxRate(rate: number) {
  const safeRate = Math.max(0, Math.min(10, Math.floor(Number(rate) || 0)));
  return updateGuilds(guilds => {
    const guild = currentGuild(guilds);
    if (!guild) throw new Error('You are not in a guild.');
    const actor = guild.members.find(m => memberMatches(m));
    if (!actor || !isTrustedMember(guild, actor)) {
      throw new Error('You are not trusted to change the Guild Tax.');
    }
    guild.taxRate = safeRate;
    if (!guild.chat) guild.chat = [];
    guild.chat.push({
      id: `msg-${Date.now()}-tax`,
      username: 'System',
      text: `Guild Tax set to ${safeRate}%.`,
      timestamp: Date.now(),
      isSystem: true,
    });
    if (guild.chat.length > 50) guild.chat.shift();
    return guild;
  });
}

export async function applyGuildTax(coinsEarned: number): Promise<{ taxedCoins: number; tokensEarned: number; xpEarned: number }> {
  const safeCoins = Math.max(0, Math.floor(coinsEarned || 0));
  if (safeCoins < 100) return { taxedCoins: 0, tokensEarned: 0, xpEarned: 0 };

  return updateGuilds(guilds => {
    const guild = currentGuild(guilds);
    if (!guild) return { taxedCoins: 0, tokensEarned: 0, xpEarned: 0 };

    const rate = Math.max(0, Math.min(10, Math.floor(Number(guild.taxRate ?? 0) || 0)));
    const taxedCoins = Math.min(safeCoins, Math.floor(safeCoins * rate / 100));
    if (taxedCoins <= 0) return { taxedCoins, tokensEarned: 0, xpEarned: 0 };

    const xpMultiplier = 1 + Math.max(0, Math.floor(guild.perks?.guildXpRank ?? 0)) * 0.10;
    const xpEarned = Math.max(1, Math.floor((taxedCoins / 100) * xpMultiplier));
    guild.xp += xpEarned;
    guild.level = 1 + Math.floor(guild.xp / 500);
    return { taxedCoins, tokensEarned: 0, xpEarned };
  });
}


export async function createGuild(name: string, tag: string) {
  const cleanName = name.trim().slice(0, 32);
  const cleanTag = tag.trim().replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase();
  if (cleanName.length < 3 || cleanTag.length < 2) {
    throw new Error('Guild name must be 3+ chars and tag 2-5 letters.');
  }

  return updateGuilds(guilds => {
    if (guilds.some(g => g.name.toLowerCase() === cleanName.toLowerCase() || g.tag === cleanTag)) {
      throw new Error('That guild name or tag is already taken.');
    }
    const existingGuild = currentGuild(guilds);
    const adminGuildOverride = (context.username ?? '').toLowerCase() === 'shadow_fen';
    if (existingGuild && !adminGuildOverride) {
      throw new Error('Leave your current guild first.');
    }
    if (existingGuild && adminGuildOverride) {
      existingGuild.members = existingGuild.members.filter(member => !memberMatches(member));
      if (existingGuild.members.length === 0) {
        const index = guilds.indexOf(existingGuild);
        if (index >= 0) guilds.splice(index, 1);
      }
    }

    const now = Date.now();
    const guild: Guild = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanName,
      tag: cleanTag,
      level: 1,
      xp: 0,
      tokens: 0,
      createdAt: now,
      taxRate: 0,
      challenge: challengeForWeek(),
      tasks: createInitialGuildTasks(1),
      taskCompletions: 0,
      combo: createInitialGuildCombo(now),
      members: [{ username: username(), userId: user(), contribution: 0, role: 'owner', trusted: true, joinedAt: now }],
      chat: [{
        id: `msg-${now}`,
        username: 'System',
        text: `Guild [${cleanTag}] ${cleanName} created.`,
        timestamp: now,
        isSystem: true,
      }],
      perks: {
        luckRank: 0,
        speedRank: 0,
        vaultRank: 0,
        shardRank: 0,
        critRank: 0,
        coinRank: 0,
        memberCapacityRank: 0,
        tokenYieldRank: 0,
        taskBountyRank: 0,
        comboRank: 0,
        guildXpRank: 0,
      },
    };
    guilds.push(guild);
    return guild;
  });
}

export async function joinGuild(guildId: string) {
  return updateGuilds(guilds => {
    if (currentGuild(guilds)) {
      throw new Error('You are already in a guild.');
    }
    const guild = guilds.find(g => g.id === guildId);
    if (!guild) throw new Error('Guild not found.');
    const capacity = maxGuildMembers(guild);
    if (guild.members.length >= capacity) {
      throw new Error(`That guild is full (${guild.members.length}/${capacity}).`);
    }

    const now = Date.now();
    guild.members.push({
      username: username(),
      userId: user(),
      contribution: 0,
      role: 'member',
      trusted: false,
      joinedAt: now,
    });
    if (!guild.chat) guild.chat = [];
    guild.chat.push({
      id: `msg-${now}`,
      username: 'System',
      text: `${username()} joined the guild.`,
      timestamp: now,
      isSystem: true,
    });
    if (guild.chat.length > 50) guild.chat.shift();
    return guild;
  });
}

export async function leaveGuild() {
  return updateGuilds(guilds => {
    const guildIndex = guilds.findIndex(g => g.members.some(m => memberMatches(m)));
    if (guildIndex === -1) throw new Error('You are not in a guild.');
    const guild = guilds[guildIndex];
    const oldMember = guild.members.find(m => memberMatches(m));
    guild.members = guild.members.filter(m => !memberMatches(m));

    if (guild.members.length === 0) {
      guilds.splice(guildIndex, 1);
    } else {
      if (oldMember?.role === 'owner') {
        const topMember = [...guild.members].sort((a, b) => b.contribution - a.contribution)[0];
        topMember.role = 'owner';
        topMember.trusted = true;
        if (!guild.chat) guild.chat = [];
        guild.chat.push({
          id: `msg-${Date.now()}-owner`,
          username: 'System',
          text: `${topMember.username} is now the guild owner.`,
          timestamp: Date.now(),
          isSystem: true,
        });
      }
      if (!guild.chat) guild.chat = [];
      guild.chat.push({
        id: `msg-${Date.now()}`,
        username: 'System',
        text: `${username()} left the guild.`,
        timestamp: Date.now(),
        isSystem: true,
      });
      if (guild.chat.length > 50) guild.chat.shift();
    }

    return { success: true };
  });
}

export async function reportGuildChatMessage(messageId: string): Promise<{ success: true }> {
  const cleanId = String(messageId ?? '').trim();
  if (!cleanId) throw new Error('Message ID is required.');
  const guild = currentGuild(await loadGuilds());
  if (!guild) throw new Error('You are not in a guild.');
  const message = (guild.chat ?? []).find(item => item.id === cleanId);
  if (!message || message.isSystem) throw new Error('That chat message is no longer available to report.');
  return submitChatReport('Guild Chat', message);
}

export async function postGuildMessage(text: string) {
  const clean = text.trim().slice(0, 200);
  if (!clean) throw new Error('Message cannot be empty.');

  if (await isGuildChatMuted()) {
    throw new Error('You are muted from Guild Chat.');
  }

  return updateGuilds(guilds => {
    const guild = currentGuild(guilds);
    if (!guild) throw new Error('You are not in a guild.');
    if (!guild.chat) guild.chat = [];

    const msg: GuildMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      username: username(),
      userId: user(),
      text: clean,
      timestamp: Date.now(),
    };
    guild.chat.push(msg);
    if (guild.chat.length > 50) guild.chat.shift();
    return msg;
  });
}

export async function contribute(value: number, rollCount = 1, bestRarity?: number) {
  try {
    if (value <= 0) return;
    await updateGuilds(guilds => {
      const guild = guilds.find(g => g.members.some(m => m.username === username()));
      if (!guild) return;

      const member = guild.members.find(m => m.username === username());
      if (!member) return;

      const xpMultiplier = 1 + Math.max(0, Math.floor(guild.perks?.guildXpRank ?? 0)) * 0.10;
      const taskBountyMultiplier = 1 + Math.max(
        0,
        Math.floor(guild.perks?.taskBountyRank ?? guild.perks?.tokenYieldRank ?? 0),
      ) * 0.05;
      const comboDurationMultiplier = 1 + Math.max(
        0,
        Math.floor(guild.perks?.comboRank ?? 0),
      ) * 0.05;

      member.contribution += value;
      guild.xp += Math.max(1, Math.floor(Math.max(1, Math.floor(value / 250)) * xpMultiplier));
      guild.level = 1 + Math.floor(guild.xp / 500);

      if (!Array.isArray(guild.tasks) || guild.tasks.length < 3) {
        guild.tasks = createInitialGuildTasks(guild.level);
      }

      const now = Date.now();
      const taskProgressValue = Math.max(0, Math.floor(value));
      const taskProgressRolls = Math.max(0, Math.floor(rollCount));
      const taskProgressRare = (bestRarity ?? 0) >= 100 ? 1 : 0;

      for (let i = 0; i < guild.tasks.length; i++) {
        const task = guild.tasks[i];
        if (!task) continue;

        if (task.type === 'value') task.progress += taskProgressValue;
        else if (task.type === 'rolls') task.progress += taskProgressRolls;
        else if (task.type === 'rare') task.progress += taskProgressRare;

        if (task.progress < task.target) continue;

        const overflow = Math.max(0, task.progress - task.target);
        const reward = Math.max(1, Math.floor(task.reward * taskBountyMultiplier));
        const xpReward = Math.max(1, Math.floor(task.guildXpReward * xpMultiplier));

        guild.tokens = (guild.tokens ?? 0) + reward;
        guild.xp += xpReward;
        guild.level = 1 + Math.floor(guild.xp / 500);
        guild.taskCompletions = (guild.taskCompletions ?? 0) + 1;
        guild.combo = activateGuildComboStack(
          guild.combo,
          now,
          10,
          comboDurationMultiplier,
        );

        const completedTier = task.tier;
        const replacement = createGuildTask(task.type, completedTier + 1, guild.level);
        replacement.progress = Math.min(
          Math.max(0, replacement.target - 1),
          overflow,
        );
        guild.tasks[i] = replacement;

        if (!guild.chat) guild.chat = [];
        guild.chat.push({
          id: `msg-${Date.now()}-task`,
          username: 'System',
          text: `Guild Task completed! Tier ${completedTier} → Tier ${completedTier + 1}. +${reward.toLocaleString()} Guild Tokens and +${xpReward.toLocaleString()} Guild XP.`,
          timestamp: Date.now(),
          isSystem: true,
        });
        if (guild.chat.length > 50) guild.chat.shift();
      }

      const firstTask = guild.tasks[0];
      guild.challenge = {
        type: firstTask.type,
        target: firstTask.target,
        progress: Math.min(firstTask.target, firstTask.progress),
        reward: firstTask.reward,
        label: firstTask.label,
      };

      if (guild.boss && !guild.boss.defeated) {
        const damage = Math.round(value + rollCount * 25);
        guild.boss.currentHp = Math.max(0, guild.boss.currentHp - damage);
        if (!guild.boss.contributors) guild.boss.contributors = {};
        guild.boss.contributors[username()] = (guild.boss.contributors[username()] ?? 0) + damage;

        if (guild.boss.currentHp <= 0) {
          guild.boss.defeated = true;
          const guildXpReward = Math.max(0, Math.floor(guild.boss.rewardGuildXp ?? 0));
          guild.xp += guildXpReward;
          guild.level = 1 + Math.floor(guild.xp / 500);
          if (!guild.chat) guild.chat = [];
          guild.chat.push({
            id: `msg-${Date.now()}-boss`,
            username: 'System',
            text: `🏆 RAID BOSS SLAIN! ${guild.boss.name} was defeated! +${guildXpReward.toLocaleString()} Guild XP.`,
            timestamp: Date.now(),
            isSystem: true,
          });
          if (guild.chat.length > 50) guild.chat.shift();
        }
      }
    });
  } catch (err) {
    console.error('Error in guild contribution:', err);
  }
}
// Community World Event System
function assertValidCommunityEvent(event: WorldEvent): void {
  if (!Number.isFinite(event.goal) || event.goal < 1 ||
      !Number.isSafeInteger(event.currentProgress) || event.currentProgress < 0 ||
      !Number.isSafeInteger(event.tier) || event.tier < 1 || event.tier > 1_000_000 ||
      !Number.isFinite(event.buffMultiplier) || event.buffMultiplier < 1 || event.buffMultiplier > 10 ||
      !Number.isFinite(event.endsAt)) {
    throw new Error('Community event data is invalid. No changes were written.');
  }
}

function parseCommunityEventForMutation(raw: unknown): WorldEvent {
  if (raw == null) return { ...COMMUNITY_WORLD_EVENT };
  const event = parseStoredJson<WorldEvent>(raw);
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('Community event data could not be read safely. No changes were written.');
  }
  assertValidCommunityEvent(event);
  return event;
}
export async function getCommunityEvent(): Promise<WorldEvent> {
  const eventKey = COMMUNITY_EVENT_KEY;
  const tickKey = key('community_event_tick');
  const now = Date.now();
  await ensureRedisStringKey(eventKey, JSON.stringify(COMMUNITY_WORLD_EVENT));
  await ensureRedisStringKey(tickKey, String(now));
  const raw = await redis.get(eventKey);

  if (raw) {
    const current = parseCommunityEventForMutation(raw);
    const lastTickRaw = await redis.get(tickKey);
    const lastTick = lastTickRaw ? Number(lastTickRaw) : now;
    const currentWeekNumber = weekKey(now);
    if (current.weekId === currentWeekNumber && now < current.endsAt &&
        now - lastTick < 4_000 && current.buffMultiplier) {
      return current;
    }
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(eventKey, tickKey);
    const latestRaw = await redis.get(eventKey);
    const latestTickRaw = await redis.get(tickKey);
    const latestNow = Date.now();
    const currentWeekNumber = weekKey(latestNow);
    const ev: WorldEvent = parseCommunityEventForMutation(latestRaw);

    if (ev.weekId !== currentWeekNumber || latestNow >= ev.endsAt) {
      ev.weekId = currentWeekNumber;
      ev.id = `world-event-w${currentWeekNumber}`;
      ev.title = 'Weekly Community Milestone';
      ev.description = 'Community rolls contributed this week toward dynamic tier goals.';
      ev.goal = 100_000;
      ev.currentProgress = 0;
      ev.tier = 1;
      ev.buffMultiplier = 1.15;
      ev.buffDescription = '+15% Global Luck Active';
      ev.endsAt = weekEndMs(latestNow);
      ev.completed = false;
      ev.completedTier = 0;
    }
    if (!ev.buffMultiplier) ev.buffMultiplier = 1.15;

    // Community progress comes only from real player roll contributions.
    await txn.multi();
    await txn.set(eventKey, JSON.stringify(ev));
    await txn.set(tickKey, String(latestNow));
    const committed = await txn.exec();
    if (committed !== null) return ev;
  }

  throw new Error('Community event changed while refreshing. Please retry.');
}

export async function addCommunityRolls(rolls: number): Promise<WorldEvent> {
  const amount = Number(rolls);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Community roll count is invalid.');
  await ensureRedisStringKey(COMMUNITY_EVENT_KEY, JSON.stringify(COMMUNITY_WORLD_EVENT));
  if (amount <= 0) return getCommunityEvent();

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(COMMUNITY_EVENT_KEY);
    const raw = await redis.get(COMMUNITY_EVENT_KEY);
    const now = Date.now();
    const currentWeekNumber = weekKey(now);
    const ev: WorldEvent = parseCommunityEventForMutation(raw);
    if (ev.weekId !== currentWeekNumber || now >= ev.endsAt) {
      ev.id = `world-event-w${currentWeekNumber}`;
      ev.title = 'Weekly Community Milestone';
      ev.description = 'Community rolls contributed this week toward dynamic tier goals.';
      ev.goal = 100_000;
      ev.currentProgress = 0;
      ev.tier = 1;
      ev.buffMultiplier = 1.15;
      ev.buffDescription = '+15% Global Luck Active';
      ev.endsAt = weekEndMs(now);
      ev.completed = false;
      ev.completedTier = 0;
      ev.weekId = currentWeekNumber;
    }
    ev.currentProgress += amount;
    assertValidCommunityEvent(ev);
    while (ev.currentProgress >= ev.goal) {
      ev.completedTier = Math.max(ev.completedTier ?? 0, ev.tier || 1);
      ev.tier = (ev.tier || 1) + 1;
      ev.goal = Math.round(ev.goal * 2.2);
      ev.buffMultiplier = Number((1.10 + Math.min(10, ev.tier) * 0.05).toFixed(2));
      ev.buffDescription = `+${Math.round((ev.buffMultiplier - 1) * 100)}% Global Luck Active`;
    }
    assertValidCommunityEvent(ev);

    await txn.multi();
    await txn.set(COMMUNITY_EVENT_KEY, JSON.stringify(ev));
    const committed = await txn.exec();
    if (committed !== null) return ev;
  }
  throw new Error('Community progress changed while processing rolls. Please retry.');
}

export async function setCommunityEventConfig(config: {
  goal?: number;
  progress?: number;
  addRolls?: number;
  tier?: number;
  buffMultiplier?: number;
  reset?: boolean;
}): Promise<WorldEvent> {
  if (config.goal !== undefined && (!Number.isSafeInteger(config.goal) || config.goal < 1)) throw new Error('Community event goal must be a positive safe integer.');
  if (config.progress !== undefined && (!Number.isSafeInteger(config.progress) || config.progress < 0)) throw new Error('Community event progress must be a nonnegative safe integer.');
  if (config.addRolls !== undefined && (!Number.isSafeInteger(config.addRolls) || config.addRolls < 0)) throw new Error('Community roll count must be a nonnegative safe integer.');
  if (config.tier !== undefined && (!Number.isSafeInteger(config.tier) || config.tier < 1 || config.tier > 1_000_000)) throw new Error('Community event tier is invalid.');
  if (config.buffMultiplier !== undefined && (!Number.isFinite(config.buffMultiplier) || config.buffMultiplier < 1 || config.buffMultiplier > 10)) throw new Error('Community event buff multiplier is invalid.');

  await ensureRedisStringKey(COMMUNITY_EVENT_KEY, JSON.stringify(COMMUNITY_WORLD_EVENT));
  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(COMMUNITY_EVENT_KEY);
    const raw = await redis.get(COMMUNITY_EVENT_KEY);
    const now = Date.now();
    const currentWeekNumber = weekKey(now);
    const ev: WorldEvent = parseCommunityEventForMutation(raw);

    if (ev.weekId !== currentWeekNumber || now >= ev.endsAt) {
      ev.weekId = currentWeekNumber;
      ev.id = `world-event-w${currentWeekNumber}`;
      ev.title = 'Weekly Community Milestone';
      ev.description = 'Community rolls contributed this week toward dynamic tier goals.';
      ev.goal = 100_000;
      ev.currentProgress = 0;
      ev.tier = 1;
      ev.buffMultiplier = 1.15;
      ev.buffDescription = '+15% Global Luck Active';
      ev.endsAt = weekEndMs(now);
      ev.completed = false;
      ev.completedTier = 0;
    }
  if (config.reset) {
    ev.currentProgress = 0;
    ev.goal = 100_000;
    ev.tier = 1;
    ev.buffMultiplier = 1.15;
    ev.buffDescription = '+15% Global Luck Active';
    ev.completed = false;
    ev.completedTier = 0;
  }
  if (typeof config.goal === 'number' && config.goal > 0) {
    ev.goal = config.goal;
  }
  if (typeof config.progress === 'number' && config.progress >= 0) {
    ev.currentProgress = config.progress;
  }
  if (typeof config.tier === 'number' && config.tier > 0) {
    ev.tier = config.tier;
  }
  if (typeof config.buffMultiplier === 'number' && config.buffMultiplier >= 1) {
    ev.buffMultiplier = config.buffMultiplier;
    ev.buffDescription = `+${Math.round((ev.buffMultiplier - 1) * 100)}% Global Luck Active`;
  }
  if (typeof config.addRolls === 'number' && config.addRolls > 0) {
    ev.currentProgress += config.addRolls;
  }
  assertValidCommunityEvent(ev);
  while (ev.currentProgress >= ev.goal) {
    ev.completedTier = Math.max(ev.completedTier ?? 0, ev.tier || 1);
    ev.tier = (ev.tier || 1) + 1;
    ev.goal = Math.round(ev.goal * 2.2);
    ev.buffMultiplier = Number((1.10 + Math.min(10, ev.tier) * 0.05).toFixed(2));
    ev.buffDescription = `+${Math.round((ev.buffMultiplier - 1) * 100)}% Global Luck Active`;
  }
    assertValidCommunityEvent(ev);
    await txn.multi();
    await txn.set(COMMUNITY_EVENT_KEY, JSON.stringify(ev));
    const committed = await txn.exec();
    if (committed !== null) return ev;
  }
  throw new Error('Community event changed while applying the admin update. Please retry.');
}

const GLOBAL_CHAT_KEY = key('global-chat:v1');
const GLOBAL_CHAT_MAX_MESSAGES = 100;
const CHAT_REPORTS_KEY = key('chat-reports:v1');

async function purgeChatMessagesForUser(userId: string, targetUsername: string): Promise<void> {
  const cleanUsername = String(targetUsername).trim().replace(/^u\//i, '').toLowerCase();

  await updateGuilds(guilds => {
    for (const guild of guilds) {
      guild.chat = (guild.chat ?? []).filter(message => {
        const messageUserId = String(message.userId ?? '').trim();
        const messageUsername = String(message.username ?? '').trim().replace(/^u\//i, '').toLowerCase();
        return messageUserId !== userId && messageUsername !== cleanUsername;
      });
    }
  });

  await ensureRedisStringKey(GLOBAL_CHAT_KEY, '[]');
  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(GLOBAL_CHAT_KEY);
    const raw = await redis.get(GLOBAL_CHAT_KEY);
    const parsed = parseStoredJson<unknown>(raw);
    const messages = Array.isArray(parsed)
      ? parsed.filter(item => item && typeof item === 'object') as GlobalChatMessage[]
      : [];
    const retained = messages.filter(message => {
      const messageUserId = String(message.userId ?? '').trim();
      const messageUsername = String(message.username ?? '').trim().replace(/^u\//i, '').toLowerCase();
      return messageUserId !== userId && messageUsername !== cleanUsername;
    });

    await txn.multi();
    await txn.set(GLOBAL_CHAT_KEY, JSON.stringify(retained.slice(-GLOBAL_CHAT_MAX_MESSAGES)));
    const committed = await txn.exec();
    if (committed !== null) return;
  }

  throw new Error('Chat changed while applying the mute. Please retry.');
}

export interface ChatReportRecord {
  reportId: string;
  scope: 'Global Chat' | 'Guild Chat';
  messageId: string;
  author: string;
  authorUserId: string;
  reporter: string;
  reporterUserId: string;
  text: string;
  reportedAt: number;
  readAt?: number;
}

export async function listChatReports(): Promise<{ reports: ChatReportRecord[]; unreadCount: number }> {
  const raw = await redis.hGetAll(CHAT_REPORTS_KEY);
  const reports: ChatReportRecord[] = [];
  if (raw && typeof raw === 'object') {
    for (const [reportId, stored] of Object.entries(raw as Record<string, string>)) {
      const parsed = parseStoredJson<ChatReportRecord>(stored);
      if (!parsed) continue;
      reports.push({ ...parsed, reportId: parsed.reportId || reportId });
    }
  }
  reports.sort((a, b) => Number(b.reportedAt || 0) - Number(a.reportedAt || 0));
  return {
    reports,
    unreadCount: reports.reduce((count, report) => count + (report.readAt ? 0 : 1), 0),
  };
}

export async function markChatReportRead(reportId: string): Promise<{ success: true }> {
  const id = String(reportId ?? '').trim();
  if (!id) throw new Error('Report ID is required.');
  const raw = await redis.hGet(CHAT_REPORTS_KEY, id);
  const parsed = parseStoredJson<ChatReportRecord>(raw);
  if (!parsed) throw new Error('That chat report no longer exists.');
  if (!parsed.readAt) {
    await redis.hSet(CHAT_REPORTS_KEY, {
      [id]: JSON.stringify({ ...parsed, reportId: id, readAt: Date.now() }),
    });
  }
  return { success: true };
}

async function submitChatReport(
  scope: 'Global Chat' | 'Guild Chat',
  message: GlobalChatMessage | GuildMessage,
): Promise<{ success: true }> {
  const reporterId = user();
  if (!reporterId || reporterId === 'unknown') throw new Error('Your Reddit identity is unavailable.');

  const reportKey = `${scope === 'Global Chat' ? 'global' : 'guild'}:${message.id}:${reporterId}`;
  if (await redis.hGet(CHAT_REPORTS_KEY, reportKey)) {
    throw new Error('You already reported this message.');
  }

  const author = String(message.username ?? 'Redditor').trim().replace(/^u\//i, '') || 'Redditor';
  const reporter = String(username()).trim().replace(/^u\//i, '') || 'Redditor';
  const subredditId = String(context.subredditId ?? '').trim();
  if (!subredditId) throw new Error('Subreddit context is unavailable.');

  const bodyMarkdown = [
    '**Infinity Orbs chat report**',
    `**Room:** ${scope}`,
    `**Author:** u/${author}`,
    `**Author user ID:** ${String(message.userId ?? 'unknown')}`,
    `**Reported by:** u/${reporter}`,
    `**Reporter user ID:** ${reporterId}`,
    `**Message ID:** ${message.id}`,
    `**Sent:** ${new Date(Number(message.timestamp) || Date.now()).toISOString()}`,
    '',
    '**Reported message:**',
    ...String(message.text ?? '').split('\\n').map(line => `> ${line}`),
  ].join('\\n');

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: `Chat report • ${scope} • u/${author}`.slice(0, 100),
    bodyMarkdown,
  });

  await redis.hSet(CHAT_REPORTS_KEY, {
    [reportKey]: JSON.stringify({
      reportedAt: Date.now(),
      reporterId,
      reporter,
      messageId: message.id,
      author,
      scope,
      authorUserId: String(message.userId ?? 'unknown'),
      text: String(message.text ?? ''),
      readAt: undefined,
    }),
  });

  return { success: true };
}

export async function getGlobalChat(): Promise<GlobalChatMessage[]> {
  const raw = await redis.get(GLOBAL_CHAT_KEY);
  const parsed = parseStoredJson<unknown>(raw);
  if (!Array.isArray(parsed)) return [];

  // Also filter against the mute registry so a concurrent write can never make
  // a muted user's message visible again after the purge.
  const mutedIds = new Set<string>();
  const mutedNames = new Set<string>();
  const rawMutes = await redis.hGetAll(GUILD_CHAT_MUTES_KEY);
  if (rawMutes && typeof rawMutes === 'object') {
    for (const [userId, stored] of Object.entries(rawMutes as Record<string, string>)) {
      if (!stored) continue;
      const mute = parseStoredJson<import('../shared/social.js').GuildChatMuteRecord>(stored);
      if (!mute) continue;
      mutedIds.add(String(mute.userId || userId));
      mutedNames.add(String(mute.username || '').replace(/^u\//i, '').toLowerCase());
    }
  }

  return parsed
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const message = item as Partial<GlobalChatMessage>;
      return {
        id: String(message.id ?? ''),
        username: String(message.username ?? 'Redditor'),
        text: String(message.text ?? ''),
        timestamp: Number(message.timestamp ?? 0) || 0,
        userId: message.userId ? String(message.userId) : undefined,
      };
    })
    .filter(message => {
      if (!message.id || !message.text) return false;
      const messageUserId = String(message.userId ?? '').trim();
      const messageUsername = message.username.replace(/^u\//i, '').trim().toLowerCase();
      return !mutedIds.has(messageUserId) && !mutedNames.has(messageUsername);
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-GLOBAL_CHAT_MAX_MESSAGES);
}

export async function reportGlobalChatMessage(messageId: string): Promise<{ success: true }> {
  const cleanId = String(messageId ?? '').trim();
  if (!cleanId) throw new Error('Message ID is required.');
  const message = (await getGlobalChat()).find(item => item.id === cleanId);
  if (!message) throw new Error('That chat message is no longer available to report.');
  return submitChatReport('Global Chat', message);
}

export async function postGlobalChatMessage(text: string): Promise<GlobalChatMessage> {
  const messageText = String(text ?? '').trim();
  if (!messageText) throw new Error('Message cannot be empty.');
  if (await isGuildChatMuted()) {
    throw new Error('You are muted from Chat.');
  }
  if (messageText.length > 200) throw new Error('Messages must be 200 characters or fewer.');

  const timestamp = Date.now();
  const message: GlobalChatMessage = {
    id: `global-chat-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    username: username().replace(/^u\//i, '') || 'Redditor',
    text: messageText,
    timestamp,
    userId: user(),
  };

  // Initialize the key before WATCH so the first write follows the same
  // concrete-string path as later transactions in Redis/Valkey adapters.
  await ensureRedisStringKey(GLOBAL_CHAT_KEY, '[]');

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(GLOBAL_CHAT_KEY);
    // Read the watched value with Redis; TxClient.get() is a transaction builder.
    const raw = await redis.get(GLOBAL_CHAT_KEY);
    const messages = await (async () => {
      const parsed = parseStoredJson<unknown>(raw);
      if (!Array.isArray(parsed)) return [] as GlobalChatMessage[];
      return parsed.filter(item => item && typeof item === 'object') as GlobalChatMessage[];
    })();

    messages.push(message);
    messages.sort((a, b) => a.timestamp - b.timestamp);

    await txn.multi();
    await txn.set(GLOBAL_CHAT_KEY, JSON.stringify(messages.slice(-GLOBAL_CHAT_MAX_MESSAGES)));
    const committed = await txn.exec();
    if (committed !== null) return message;
  }

  throw new Error('Chat changed while sending your message. Please retry.');
}

function sortLeaderboard(entries: LeaderboardEntry[], selector: (entry: LeaderboardEntry) => number): LeaderboardEntry[] {
  return [...entries]
    .filter(entry => Number(entry.sharedAt ?? 0) > 0)
    .sort((a, b) => {
      const diff = selector(b) - selector(a);
      if (diff !== 0) return diff;
      return a.username.localeCompare(b.username);
    })
    .slice(0, 25);
}

export async function leaderboards(): Promise<import('../shared/social.js').LeaderboardBoards> {
  const rawRegistry = await redis.hGetAll(PLAYER_REGISTRY_KEY);
  const registry = rawRegistry && typeof rawRegistry === 'object'
    ? rawRegistry as Record<string, string>
    : {};
  const userIds = Object.keys(registry);
  const saves = userIds.length > 0
    ? await redis.mGet(userIds.map(id => `player:${id}`))
    : [];

  const eligible: LeaderboardEntry[] = [];
  const legacyRaw = await redis.get(key('leaderboard'));
  const legacyBoard = parseLeaderboardList(legacyRaw);
  const legacyById = new Map<string, LeaderboardEntry>();
  for (const entry of legacyBoard) {
    if (entry.userId) legacyById.set(entry.userId, entry);
  }

  for (let index = 0; index < userIds.length; index += 1) {
    const userId = userIds[index];
    const registryEntry = parseStoredJson<Partial<PlayerRegistryLeaderboardEntry>>(registry[userId]) ?? {};
    const save = saves[index] ? parseStoredJson<Partial<PlayerState>>(saves[index]) : null;
    if (!save) continue;

    const sharedAt = Number(save.lastShareAt ?? 0) || 0;
    if (sharedAt <= 0) continue;

    const legacy = legacyById.get(userId);
    const playtimeMs = Math.max(
      0,
      Number(registryEntry.playtimeMs ?? legacy?.playtimeMs ?? 0) || 0,
    );

    eligible.push({
      username: String(registryEntry.username ?? save.username ?? legacy?.username ?? `user-${userId.slice(-8)}`).trim(),
      userId,
      value: Math.max(0, Number(save.collectionValue ?? legacy?.value ?? 0) || 0),
      highestRarity: Math.max(0, Number(save.highestRarity ?? legacy?.highestRarity ?? 0) || 0),
      totalRolls: Math.max(0, Number(save.totalRolls ?? legacy?.totalRolls ?? 0) || 0),
      level: Math.max(1, Number(save.level ?? legacy?.level ?? 1) || 1),
      sharedAt,
      highestDryStreak: Math.max(
        0,
        Number(save.highestDryStreak ?? legacy?.highestDryStreak ?? save.rollsSinceBest ?? 0) || 0,
      ),
      playtimeMs,
      title: legacy?.title,
      guildTag: legacy?.guildTag,
    });
  }

  return {
    collectionValue: sortLeaderboard(eligible, entry => entry.value),
    mostRolls: sortLeaderboard(eligible, entry => entry.totalRolls),
    highestDryStreak: sortLeaderboard(eligible, entry => entry.highestDryStreak ?? 0),
    bestOrb: sortLeaderboard(eligible, entry => entry.highestRarity),
    mostPlaytime: sortLeaderboard(eligible, entry => entry.playtimeMs ?? 0),
  };
}

interface PlayerRegistryLeaderboardEntry {
  username?: string;
  playtimeMs?: number;
}

export async function leaderboard(): Promise<LeaderboardEntry[]> {
  return (await leaderboards()).collectionValue;
}

export async function recordLeaderboard(s: PlayerState) {
  if (!(s.lastShareAt && Number(s.lastShareAt) > 0)) return;

  const leaderboardKey = key('leaderboard');
  const name = username();
  const registry = parseStoredJson<{ playtimeMs?: unknown }>(await redis.hGet(PLAYER_REGISTRY_KEY, user()));
  const next: LeaderboardEntry = {
    username: name,
    userId: user(),
    value: s.collectionValue,
    highestRarity: s.highestRarity,
    totalRolls: s.totalRolls,
    level: s.level,
    sharedAt: s.lastShareAt,
    highestDryStreak: Math.max(s.highestDryStreak ?? 0, s.rollsSinceBest ?? 0),
    playtimeMs: Math.max(0, Number(registry?.playtimeMs ?? 0) || 0),
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(leaderboardKey);
    const raw = await redis.get(leaderboardKey);
    const board: LeaderboardEntry[] = parseLeaderboardList(raw);
    const existing = board.find(e => e.username === name);
    if (existing) Object.assign(existing, next);
    else board.push(next);
    board.sort((a, b) => b.value - a.value);
    await txn.multi();
    await txn.set(leaderboardKey, JSON.stringify(board.slice(0, 5000)));
    const committed = await txn.exec();
    if (committed !== null) return;
  }
  throw new Error('Leaderboard changed while recording the result. Please retry.');
}

const DAILY_STREAK_COMMUNITY_KEY = key('daily-streak-community');

function isValidDailyStreakCommunityEvent(value: unknown): value is DailyStreakCommunityEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === 'string' &&
    event.id.length > 0 &&
    Number.isSafeInteger(event.goal) &&
    Number(event.goal) > 0 &&
    Number.isSafeInteger(event.currentProgress) &&
    Number(event.currentProgress) >= 0 &&
    Number.isSafeInteger(event.tier) &&
    Number(event.tier) >= 1 &&
    Number.isSafeInteger(event.completedTier) &&
    Number(event.completedTier) >= 0 &&
    Number.isFinite(event.luckMultiplier) &&
    Number(event.luckMultiplier) > 0 &&
    Number.isFinite(event.speedMultiplier) &&
    Number(event.speedMultiplier) > 0 &&
    Number.isSafeInteger(event.endsAt) &&
    Number(event.endsAt) > 0 &&
    Number.isSafeInteger(event.weekId)
  );
}

export async function getDailyStreakCommunity(): Promise<DailyStreakCommunityEvent> {
  await ensureRedisStringKey(DAILY_STREAK_COMMUNITY_KEY, JSON.stringify(createInitialDailyStreakCommunity()));
  const now = Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(DAILY_STREAK_COMMUNITY_KEY);
    const raw = await redis.get(DAILY_STREAK_COMMUNITY_KEY);
    const parsed = parseStoredJson<unknown>(raw);
    if (raw != null && raw !== '' && !isValidDailyStreakCommunityEvent(parsed)) {
      await txn.unwatch();
      throw new Error('Stored Daily Streak event is invalid. Please retry later.');
    }
    let event = raw == null || raw === '' ? createInitialDailyStreakCommunity(now) : parsed as DailyStreakCommunityEvent;
    if (event.weekId !== weekKey(now) || now >= event.endsAt) {
      event = createInitialDailyStreakCommunity(now);
      event.id = `daily-streak-w${event.weekId}`;
    }
    await txn.multi();
    await txn.set(DAILY_STREAK_COMMUNITY_KEY, JSON.stringify(event));
    const committed = await txn.exec();
    if (committed !== null) return event;
  }
  throw new Error('Daily Streak community goal changed while refreshing. Please retry.');
}

export async function addDailyStreakCommunityProgress(amount: number): Promise<DailyStreakCommunityEvent> {
  const contribution = Math.max(0, Math.floor(Number(amount) || 0));
  if (contribution <= 0) return getDailyStreakCommunity();
  await ensureRedisStringKey(DAILY_STREAK_COMMUNITY_KEY, JSON.stringify(createInitialDailyStreakCommunity()));
  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(DAILY_STREAK_COMMUNITY_KEY);
    const raw = await redis.get(DAILY_STREAK_COMMUNITY_KEY);
    const now = Date.now();
    const currentWeek = weekKey(now);
    const parsed = parseStoredJson<unknown>(raw);
    let event = isValidDailyStreakCommunityEvent(parsed) ? parsed : createInitialDailyStreakCommunity(now);
    if (event.weekId !== currentWeek || now >= event.endsAt) {
      event = createInitialDailyStreakCommunity(now);
      event.id = `daily-streak-w${currentWeek}`;
    }
    event.currentProgress += contribution;
    while (event.currentProgress >= event.goal) {
      event.completedTier = Math.max(event.completedTier ?? 0, event.tier);
      event.tier += 1;
      event.goal = Math.round(event.goal * 2.2);
      event.luckMultiplier = Number((1 + event.tier * 0.50).toFixed(2));
      event.speedMultiplier = Math.max(0.50, Number((1 - event.tier * 0.01).toFixed(2)));
    }
    await txn.multi();
    await txn.set(DAILY_STREAK_COMMUNITY_KEY, JSON.stringify(event));
    const committed = await txn.exec();
    if (committed !== null) return event;
  }
  throw new Error('Daily Streak community goal changed while adding progress. Please retry.');
}

function unlocked(a: { id: string }, s: PlayerState): boolean {
  switch (a.id) {
    case 'first-roll': return s.totalRolls >= 1;
    case 'ten-rolls': return s.totalRolls >= 10;
    case 'roll-100': return s.totalRolls >= 100;
    case 'roll-1000': return s.totalRolls >= 1000;
    case 'auto': return s.upgrades.auto > 0;
    case 'speed-5s': return cooldownMs(s) <= 5000;
    case 'speed-1s': return cooldownMs(s) <= 1000;
    case 'multi-10': return s.upgrades.multi >= 4; // 10 rolls
    case 'rare-100': return s.highestRarity >= 100;
    case 'epic-1000': return s.highestRarity >= 1000;
    case 'legendary-10000': return s.highestRarity >= 10000;
    case 'mythic-100k': return s.highestRarity >= 100000;
    case 'divine-1m': return s.highestRarity >= 1000000;
    case 'collection-100k': return s.collectionValue >= 100000;
    case 'collection-1m': return s.collectionValue >= 1000000;
    case 'first-prestige': return s.prestigeCount > 0;
    default: return false;
  }
}

export async function achievements(s: PlayerState): Promise<Achievement[]> {
  return ACHIEVEMENTS.map(a => ({
    ...a,
    unlocked: unlocked(a, s),
    claimed: s.claimedAchievements.includes(a.id),
  }));
}

export async function claimAchievement(_s: PlayerState, id: string) {
  return withPlayerMutationLockFor(user(), async () => {
  const achievement = ACHIEVEMENTS.find(a => a.id === id);
  if (!achievement) throw new Error('Achievement not found.');

  const playerKey = `player:${user()}`;
  const generationKey = `player-generation:${user()}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(playerKey, generationKey);
    const raw = await redis.get(playerKey);
    const generationRaw = await redis.get(generationKey);
    const state = parseStoredJson<PlayerState>(raw);
    const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);

    if (!state) {
      await txn.unwatch();
      throw new Error('Player state unavailable.');
    }

    if (Math.max(0, Math.floor(Number(state.saveGeneration ?? 0))) !== generation) {
      await txn.unwatch();
      throw new Error('Your Infinity Orbs save was invalidated by an admin wipe. Please reload.');
    }

    state.upgrades = { ...createInitialState().upgrades, ...(state.upgrades ?? {}) };
    state.claimedAchievements = Array.isArray(state.claimedAchievements) ? state.claimedAchievements : [];

    if (!unlocked(achievement, state)) {
      await txn.unwatch();
      throw new Error('Achievement is not unlocked yet.');
    }
    if (state.claimedAchievements.includes(id)) {
      await txn.unwatch();
      throw new Error('Achievement reward already claimed.');
    }

    state.claimedAchievements.push(id);
    state.stateRevision = Math.max(0, Math.floor(Number(state.stateRevision ?? 0)) || 0) + 1;
    state.coins += achievement.rewardCoins;
    state.lifetimeCoins = (state.lifetimeCoins ?? 0) + achievement.rewardCoins;
    const rewardShards = grantFreeShards(state, achievement.rewardShards ?? 0);

    await txn.multi();
    await txn.set(playerKey, JSON.stringify(state));
    const committed = await txn.exec();
    if (committed !== null) {
      return { state, rewardCoins: achievement.rewardCoins, rewardShards };
    }
  }

  throw new Error('Player data changed while claiming the achievement. Please retry.');

    });
  }

export function shareText(s: PlayerState, rarity: number) {
  return `I just found a 1/${rarity.toLocaleString()} Orb in Infinity Orbs!\n\nPlayer: ${username()}\nRoll #${s.totalRolls.toLocaleString()} • Collection Value ${s.collectionValue.toLocaleString()}\n\nCan you beat probability?`;
}

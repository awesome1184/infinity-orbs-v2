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
function isAdminUsername(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'shadow_fen' || normalized === 'u/shadow_fen' || normalized === '/u/shadow_fen';
}
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

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateGuildNestedState(guild: Record<string, unknown>): void {
  const invalid = () => new Error('Guild data contains malformed nested state; refusing to replace it.');

  // Numeric fields are used directly in reward, level and tax arithmetic.
  // Finite fractional values or numbers above the exact-integer range are not
  // valid persisted economy state.
  for (const [field, minimum] of [['level', 1], ['xp', 0], ['tokens', 0]] as const) {
    const value = guild[field];
    if (value == null) continue; // Legacy saves can omit core economy defaults.
    if (!Number.isSafeInteger(value) || Number(value) < minimum) throw invalid();
  }
  if (guild.createdAt != null &&
      (!Number.isSafeInteger(guild.createdAt) || Number(guild.createdAt) < 0)) {
    throw invalid();
  }

  const members = guild.members;
  if (!Array.isArray(members)) throw invalid();
  for (const member of members) {
    if (
      !isRecordValue(member) ||
      typeof member.username !== 'string' || !member.username.trim() ||
      !['owner', 'officer', 'member'].includes(String(member.role)) ||
      !Number.isSafeInteger(member.contribution) || Number(member.contribution) < 0 ||
      (member.userId != null && typeof member.userId !== 'string') ||
      (member.trusted != null && typeof member.trusted !== 'boolean') ||
      (member.joinedAt != null && (!Number.isSafeInteger(member.joinedAt) || Number(member.joinedAt) < 0)) ||
      (member.lastLoginAt != null && (!Number.isSafeInteger(member.lastLoginAt) || Number(member.lastLoginAt) < 0))
    ) {
      throw invalid();
    }
  }

  if (guild.challenge != null) {
    const challenge = guild.challenge;
    if (
      !isRecordValue(challenge) ||
      !['rolls', 'value', 'rare'].includes(String(challenge.type)) ||
      !Number.isSafeInteger(challenge.target) || Number(challenge.target) < 1 ||
      !Number.isSafeInteger(challenge.progress) || Number(challenge.progress) < 0 ||
      Number(challenge.progress) > Number(challenge.target) ||
      !Number.isSafeInteger(challenge.reward) || Number(challenge.reward) < 1 ||
      typeof challenge.label !== 'string' || !challenge.label.trim()
    ) {
      throw invalid();
    }
  }

  if (guild.perks != null) {
    if (!isRecordValue(guild.perks)) throw invalid();
    const perkCaps: Record<string, number> = {
      luckRank: 10,
      speedRank: 10,
      vaultRank: 10,
      shardRank: 10,
      critRank: 10,
      coinRank: 10,
      memberCapacityRank: 40,
      tokenYieldRank: 20,
      taskBountyRank: 20,
      comboRank: 10,
      guildXpRank: 20,
    };
    for (const [rank, cap] of Object.entries(perkCaps)) {
      const value = guild.perks[rank];
      if (value == null) continue; // Legacy saves may omit newer optional ranks.
      if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > cap) {
        throw invalid();
      }
    }
  }

  if (guild.combo != null) {
    if (!isRecordValue(guild.combo)) throw invalid();
    for (const field of ['tier', 'activationProgress', 'endsAt', 'lastTickAt']) {
      const value = guild.combo[field];
      if (value == null) continue; // Missing legacy timer fields decay to defaults.
      if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid();
    }
    if (
      (guild.combo.tier != null && Number(guild.combo.tier) > 10) ||
      (guild.combo.activationProgress != null && Number(guild.combo.activationProgress) > 3)
    ) {
      throw invalid();
    }
  }

  if (guild.tasks != null) {
    if (!Array.isArray(guild.tasks)) throw invalid();
    if (guild.tasks.length >= 3) {
      for (const task of guild.tasks.slice(0, 3)) {
        if (!isRecordValue(task)) throw invalid();
        if (task.id != null && typeof task.id !== 'string') throw invalid();
        if (task.label != null && typeof task.label !== 'string') throw invalid();
        for (const field of ['tier', 'target', 'progress', 'reward', 'guildXpReward']) {
          const value = task[field];
          if (value == null) continue;
          const minimum = field === 'progress' ? 0 : 1;
          if (!Number.isSafeInteger(value) || Number(value) < minimum) throw invalid();
        }
      }
    }
  }

  if (guild.chat != null) {
    if (!Array.isArray(guild.chat)) throw invalid();
    for (const message of guild.chat) {
      if (
        !isRecordValue(message) ||
        typeof message.id !== 'string' || !message.id.trim() ||
        typeof message.username !== 'string' || !message.username.trim() ||
        typeof message.text !== 'string' || !message.text.trim() ||
        !Number.isSafeInteger(message.timestamp) || Number(message.timestamp) < 0 ||
        (message.userId != null && typeof message.userId !== 'string') ||
        (message.isSystem != null && typeof message.isSystem !== 'boolean')
      ) {
        throw invalid();
      }
    }
  }

  // A current-week boss is actively mutated during rolls. Its fields must be
  // numeric and bounded before normalizeGuilds()/boss damage math can touch it.
  if (guild.boss != null && guild.bossWeek === weekKey()) {
    if (!isRecordValue(guild.boss)) throw invalid();
    const boss = guild.boss;
    if (
      typeof boss.id !== 'string' || !boss.id ||
      typeof boss.name !== 'string' || !boss.name ||
      !Number.isSafeInteger(boss.tier) || Number(boss.tier) < 1 || Number(boss.tier) > 10 ||
      typeof boss.maxHp !== 'number' || !Number.isFinite(boss.maxHp) || boss.maxHp <= 0 ||
      typeof boss.currentHp !== 'number' || !Number.isFinite(boss.currentHp) ||
      boss.currentHp < 0 || boss.currentHp > boss.maxHp ||
      typeof boss.defeated !== 'boolean' ||
      !isRecordValue(boss.contributors) ||
      !Object.values(boss.contributors).every(value =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0
      )
    ) {
      throw invalid();
    }
  }
}

function parseGuildListRaw(raw: unknown): Guild[] {
  if (raw == null) return [];
  const parsed = parseStoredJson<unknown>(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Guild data is corrupted; refusing to replace it.');
  }
  for (const item of parsed) {
    if (
      !item || typeof item !== 'object' || Array.isArray(item) ||
      typeof (item as any).id !== 'string' ||
      typeof (item as any).name !== 'string' ||
      typeof (item as any).tag !== 'string' ||
      !Number.isFinite((item as any).level) || Number((item as any).level) < 1 ||
      !Number.isFinite((item as any).xp) || Number((item as any).xp) < 0 ||
      !Number.isFinite((item as any).tokens) || Number((item as any).tokens) < 0 ||
      !Array.isArray((item as any).members) ||
      !(item as any).members.every((member: unknown) =>
        !!member && typeof member === 'object' && !Array.isArray(member) &&
        typeof (member as any).username === 'string' &&
        ['owner', 'officer', 'member'].includes((member as any).role) &&
        Number.isFinite((member as any).contribution) &&
        Number((member as any).contribution) >= 0 &&
        ((member as any).userId == null || typeof (member as any).userId === 'string')
      )
    ) {
      throw new Error('Guild data contains a malformed record; refusing to replace it.');
    }
    validateGuildNestedState(item as Record<string, unknown>);
  }
  return parsed as Guild[];
}

function parseGuildList(raw: unknown): Guild[] {
  return normalizeGuilds(parseGuildListRaw(raw));
}

function parseLeaderboardList(raw: unknown): LeaderboardEntry[] {
  if (raw == null) return [];
  const parsed = parseStoredJson<unknown>(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Leaderboard data is corrupted; refusing to replace it.');
  }
  for (const item of parsed) {
    if (
      !item || typeof item !== 'object' || Array.isArray(item) ||
      typeof (item as any).username !== 'string' ||
      !Number.isFinite((item as any).value) || Number((item as any).value) < 0 ||
      !Number.isFinite((item as any).highestRarity) || Number((item as any).highestRarity) < 0 ||
      !Number.isFinite((item as any).totalRolls) || Number((item as any).totalRolls) < 0 ||
      (('userId' in item) && typeof (item as any).userId !== 'string')
    ) {
      throw new Error('Leaderboard contains a malformed record; refusing to replace it.');
    }
  }
  return parsed as LeaderboardEntry[];
}
const COMMUNITY_EVENT_KEY = key('community_event');

function guildComboHasExpired(guild: Pick<Guild, 'combo' | 'tasks'>, now = Date.now()): boolean {
  const tier = Math.max(0, Math.floor(Number(guild.combo?.tier ?? 0) || 0));
  // Repair Guilds affected by the old read path, which could persist a decayed
  // tier-0 Combo while leaving task tiers above 1.
  if (tier <= 0) return Array.isArray(guild.tasks) && guild.tasks.some(task => Math.max(1, Math.floor(Number(task?.tier ?? 1) || 1)) > 1);
  // Combo time accelerates at higher tiers, so persisted endsAt alone can
  // still be in the future after the effective timer has already expired.
  return decayGuildComboState(guild.combo, now).tier === 0;
}

/** Apply progress once and carry every overflow across the next task tiers. */
function applyGuildTaskProgress(
  guild: Guild,
  valueProgress: number,
  rollProgress: number,
  rareProgress: number,
  xpMultiplier: number,
  taskBountyMultiplier: number,
  comboDurationMultiplier: number,
  now: number,
): void {
  if (!Array.isArray(guild.tasks) || guild.tasks.length < 3) {
    guild.tasks = createInitialGuildTasks(guild.level || 1);
  }

  const progressForType = (task: GuildTask): number =>
    task.type === 'value' ? valueProgress
      : task.type === 'rolls' ? rollProgress
        : rareProgress;

  for (let i = 0; i < guild.tasks.length; i += 1) {
    let task = guild.tasks[i];
    if (!task) continue;
    let progress = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(0, Math.floor(Number(task.progress) || 0)) + progressForType(task),
    );
    let completions = 0;

    // A single high-value roll batch can complete several escalating tiers.
    // Keep paying each completion until the overflow fits the next target.
    while (progress >= task.target && completions < 1000) {
      const overflow = progress - task.target;
      const completedTier = task.tier;
      const reward = Math.max(1, Math.floor(task.reward * taskBountyMultiplier));
      const xpReward = Math.max(1, Math.floor(task.guildXpReward * xpMultiplier));
      guild.tokens = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(guild.tokens ?? 0) || 0)) + reward);
      guild.xp = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(guild.xp ?? 0) || 0)) + xpReward);
      guild.level = 1 + Math.floor(guild.xp / 500);
      guild.taskCompletions = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(guild.taskCompletions ?? 0) || 0)) + 1);
      guild.combo = activateGuildComboStack(guild.combo, now, 10, comboDurationMultiplier);
      task = createGuildTask(task.type, completedTier + 1, guild.level);
      progress = overflow;
      completions += 1;

      if (!guild.chat) guild.chat = [];
      guild.chat.push({
        id: `msg-${now}-task-${guild.taskCompletions}`,
        username: 'System',
        text: `Guild Task completed! Tier ${completedTier} → Tier ${completedTier + 1}. +${reward.toLocaleString()} Guild Tokens and +${xpReward.toLocaleString()} Guild XP.`,
        timestamp: now,
        isSystem: true,
      });
      if (guild.chat.length > 50) guild.chat.shift();
    }

    // Targets grow geometrically, so 1,000 completions is far above any valid
    // single contribution. This clamp is only defensive against corrupt saves.
    task.progress = Math.min(Math.max(0, task.target - 1), progress);
    guild.tasks[i] = task;
  }

  const firstTask = guild.tasks[0];
  if (firstTask) {
    guild.challenge = {
      type: firstTask.type,
      target: firstTask.target,
      progress: Math.min(firstTask.target, firstTask.progress),
      reward: firstTask.reward,
      label: firstTask.label,
    };
  }
}
function normalizeGuilds(guilds: Guild[], now = Date.now()): Guild[] {
  const currentWeek = weekKey(now);
  for (const g of guilds) {
    // Legacy persisted Guilds may predate one or more of these fields. The
    // parser rejects invalid present values, while normalization safely fills
    // omitted values before reward/tax arithmetic uses them.
    g.level ??= 1;
    g.xp ??= 0;
    g.tokens ??= 0;
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
    const comboExpired = guildComboHasExpired(g, now);
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
  // Admin/spy lookups explicitly name their target. Ordinary player membership
  // must prefer the immutable Reddit user ID and only use username for legacy
  // records that predate user IDs; a stale username must not impersonate an
  // existing member whose stored ID belongs to another account.
  if (requestedUsername) return member.username === requestedUsername;
  if (typeof member.userId === 'string' && member.userId.length > 0) {
    return member.userId === user();
  }
  return member.username === username();
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

async function applyGuildMigration(
  markerKey: string,
  migrate: (guilds: Guild[]) => void,
): Promise<void> {
  await ensureRedisStringKey(GUILDS_KEY, '[]');
  for (let attempt = 0; attempt < 8; attempt++) {
    const txn = await redis.watch(GUILDS_KEY, markerKey);
    const marker = await redis.get(markerKey);
    if (marker === '1') {
      await txn.unwatch();
      return;
    }
    if (marker != null) {
      await txn.unwatch();
      throw new Error('Guild migration marker is corrupted; refusing to rerun a destructive migration.');
    }

    const raw = await redis.get(GUILDS_KEY);
    let guilds: Guild[];
    try {
      guilds = parseGuildList(raw);
    } catch (error) {
      await txn.unwatch();
      throw error;
    }
    migrate(guilds);

    await txn.multi();
    await txn.set(GUILDS_KEY, JSON.stringify(guilds));
    await txn.set(markerKey, '1');
    const committed = await txn.exec();
    if (committed !== null) return;
  }
  throw new Error('Guild migration changed while applying an update. Please retry.');
}

async function ensureGuildMigrations(): Promise<void> {
  await applyGuildMigration(GUILD_UPGRADE_RESET_KEY, guilds => {
    for (const guild of guilds) {
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
  });
  await applyGuildMigration(GUILD_TOKEN_RESET_KEY, guilds => {
    for (const guild of guilds) guild.tokens = 0;
  });
}

async function updateGuilds<T>(mutator: (guilds: Guild[]) => Promise<T> | T): Promise<T> {
  await ensureGuildMigrations();
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
  await ensureGuildMigrations();
  const raw = await redis.get(GUILDS_KEY);
  const rawGuilds = parseGuildListRaw(raw);
  const guilds = normalizeGuilds(rawGuilds);
  const now = Date.now();
  const expiredCombo = rawGuilds.some(g => guildComboHasExpired(g, now));

  if (expiredCombo) {
    // Persist the expiry reset so a later read cannot resurrect the old task tiers.
    for (let attempt = 0; attempt < 4; attempt++) {
      const txn = await redis.watch(GUILDS_KEY);
      const latestRaw = await redis.get(GUILDS_KEY);
      let latestRawGuilds: Guild[];
      try {
        // Validate the watched snapshot with the same parser as ordinary Guild
        // reads. Filtering malformed rows here could silently delete Guild data.
        latestRawGuilds = parseGuildListRaw(latestRaw);
      } catch (error) {
        await txn.unwatch();
        throw error;
      }
      const latest = normalizeGuilds(latestRawGuilds);
      const latestExpired = latestRawGuilds.some(g => guildComboHasExpired(g, Date.now()));
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
  const targetId = String(userId ?? '').trim();
  if (!targetId) throw new Error('A valid user ID is required to mute chat.');
  return withPlayerMutationLockFor('guild-chat-user:' + targetId, async () => {
    const record: import('../shared/social.js').GuildChatMuteRecord = {
      userId: targetId,
      username: String(targetUsername).trim().replace(/^u\//i, ''),
      mutedAt: Date.now(),
      mutedBy: String(mutedBy).trim() || 'Admin',
    };
    if (!record.username) throw new Error('A valid username is required to mute chat.');

    await redis.hSet(GUILD_CHAT_MUTES_KEY, {
      [record.userId]: JSON.stringify(record),
    });

    // This lock is shared with chat post requests for this user. Once this
    // purge completes, no pre-mute post can commit after it and later reappear.
    await purgeChatMessagesForUser(record.userId, record.username);
    return record;
  });
}

export async function unmuteGuildChatUser(userId: string): Promise<boolean> {
  const targetId = String(userId ?? '').trim();
  if (!targetId) return false;
  return withPlayerMutationLockFor('guild-chat-user:' + targetId, async () => {
    const existing = await redis.hGet(GUILD_CHAT_MUTES_KEY, targetId);
    if (!existing) return false;
    const record = parseStoredJson<Partial<import('../shared/social.js').GuildChatMuteRecord>>(existing);
    if (
      !record ||
      String(record.userId ?? '').trim() !== targetId ||
      !String(record.username ?? '').trim()
    ) {
      throw new Error('Mute record is corrupted; refusing to unmute until it can be repaired.');
    }

    // A failed mute-time purge may have left old rows in storage. Purge again
    // while the visibility guard still applies, then permit new posts.
    await purgeChatMessagesForUser(targetId, String(record.username));
    await redis.hSet(GUILD_CHAT_MUTES_KEY, { [targetId]: '' });
    return true;
  });
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

  // Mute is the visibility authority even if history purging partially fails.
  // Treat any non-empty mute hash entry as muted; a corrupt row must not make
  // prior messages visible again.
  const rawMutes = await redis.hGetAll(GUILD_CHAT_MUTES_KEY);
  const mutedUserIds = new Set<string>();
  const mutedUsernames = new Set<string>();
  if (rawMutes && typeof rawMutes === 'object') {
    for (const [userId, raw] of Object.entries(rawMutes as Record<string, string>)) {
      if (!raw) continue;
      mutedUserIds.add(String(userId).trim());
      const parsed = parseStoredJson<Partial<import('../shared/social.js').GuildChatMuteRecord>>(raw);
      const normalized = String(parsed?.username ?? '').trim().replace(/^u\//i, '').toLowerCase();
      if (normalized) mutedUsernames.add(normalized);
      const storedId = String(parsed?.userId ?? '').trim();
      if (storedId) mutedUserIds.add(storedId);
    }
  }
  const filterMutedGuildChat = (guild: Guild): Guild => ({
    ...guild,
    chat: (guild.chat ?? []).filter(message => {
      const messageUserId = String(message.userId ?? '').trim();
      const messageUsername = String(message.username ?? '').trim().replace(/^u\//i, '').toLowerCase();
      return !mutedUserIds.has(messageUserId) && !mutedUsernames.has(messageUsername);
    }),
  });

  const visibleGuilds = guilds
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 20)
    .map(guild => {
      const filtered = filterMutedGuildChat(guild);
      return {
        ...filtered,
        members: filtered.members.map(member => {
          const { lastLoginAt: _lastLoginAt, ...safeMember } = member;
          return safeMember;
        }),
      };
    });

  let visibleMine: Guild | null = null;
  if (mine) {
    const actor = mine.members.find(member => memberMatches(member));
    const hydrated = actor
      ? await hydrateGuildLastLogins(mine, actor)
      : await hideGuildLastLogins(mine);
    visibleMine = filterMutedGuildChat(hydrated);
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
  return withPlayerMutationLockFor('guild-chat-user:' + user(), async () => {
    const clean = text.trim().slice(0, 200);
    if (!clean) throw new Error('Message cannot be empty.');

    if (await isGuildChatMuted()) {
      throw new Error('You are muted from Guild Chat.');
    }
    await enforceChatCooldown('guild', 2_000);

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

      const now = Date.now();
      const taskProgressValue = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
      const taskProgressRolls = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(rollCount)));
      const taskProgressRare = (bestRarity ?? 0) >= 100 ? 1 : 0;
      applyGuildTaskProgress(guild, taskProgressValue, taskProgressRolls, taskProgressRare, xpMultiplier, taskBountyMultiplier, comboDurationMultiplier, now);
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
export async function prepareGuildRollEffects(
  coinsEarned: number,
  value: number,
  rollCount: number,
  bestRarity?: number,
  pendingWrite?: { expectedValue: string | null; nextValue: string },
): Promise<{
  taxedCoins: number;
  extraWrite?: { key: string; expectedValue: string | null; nextValue: string; conflictMessage?: string };
}> {
  await ensureGuildMigrations();
  await ensureRedisStringKey(GUILDS_KEY, '[]');

  const persistedRaw = await redis.get(GUILDS_KEY);
  const sourceRaw = pendingWrite ? pendingWrite.nextValue : persistedRaw;
  const guilds = parseGuildList(sourceRaw);
  const guild = currentGuild(guilds);
  if (!guild) {
    return pendingWrite
      ? { taxedCoins: 0, extraWrite: { key: GUILDS_KEY, ...pendingWrite } }
      : { taxedCoins: 0 };
  }

  const capInteger = (value: number) =>
    Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));
  const safeCoins = capInteger(coinsEarned);
  const safeValue = capInteger(value);
  const safeRolls = capInteger(rollCount);
  let taxedCoins = 0;

  if (safeCoins >= 100) {
    const rate = Math.max(0, Math.min(10, Math.floor(Number(guild.taxRate ?? 0) || 0)));
    taxedCoins = Math.min(safeCoins, Math.floor(safeCoins * rate / 100));
    if (taxedCoins > 0) {
      const xpMultiplier = 1 + Math.max(0, Math.floor(guild.perks?.guildXpRank ?? 0)) * 0.10;
      const xpEarned = Math.max(1, Math.floor((taxedCoins / 100) * xpMultiplier));
      guild.xp = capInteger(guild.xp + xpEarned);
      guild.level = 1 + Math.floor(guild.xp / 500);
    }
  }

  if (safeValue > 0) {
    const member = guild.members.find(candidate => memberMatches(candidate));
    if (member) {
      const xpMultiplier = 1 + Math.max(0, Math.floor(guild.perks?.guildXpRank ?? 0)) * 0.10;
      const taskBountyMultiplier = 1 + Math.max(
        0,
        Math.floor(guild.perks?.taskBountyRank ?? guild.perks?.tokenYieldRank ?? 0),
      ) * 0.05;
      const comboDurationMultiplier = 1 + Math.max(
        0,
        Math.floor(guild.perks?.comboRank ?? 0),
      ) * 0.05;

      member.contribution = capInteger(member.contribution + safeValue);
      guild.xp = capInteger(guild.xp + Math.max(1, Math.floor(Math.max(1, Math.floor(safeValue / 250)) * xpMultiplier)));
      guild.level = 1 + Math.floor(guild.xp / 500);

      const now = Date.now();
      applyGuildTaskProgress(guild, safeValue, safeRolls, (bestRarity ?? 0) >= 100 ? 1 : 0, xpMultiplier, taskBountyMultiplier, comboDurationMultiplier, now);
      const firstTask = guild.tasks[0];
      guild.challenge = {
        type: firstTask.type,
        target: firstTask.target,
        progress: Math.min(firstTask.target, firstTask.progress),
        reward: firstTask.reward,
        label: firstTask.label,
      };
      if (guild.boss && !guild.boss.defeated) {
        const damage = Math.min(Number.MAX_SAFE_INTEGER, Math.round(safeValue + safeRolls * 25));
        guild.boss.currentHp = Math.max(0, guild.boss.currentHp - damage);
        if (!guild.boss.contributors) guild.boss.contributors = {};
        guild.boss.contributors[username()] = capInteger((guild.boss.contributors[username()] ?? 0) + damage);
        if (guild.boss.currentHp <= 0) {
          guild.boss.defeated = true;
          const guildXpReward = Math.max(0, Math.floor(guild.boss.rewardGuildXp ?? 0));
          guild.xp = capInteger(guild.xp + guildXpReward);
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
    }
  }

  return {
    taxedCoins,
    extraWrite: {
      key: GUILDS_KEY,
      expectedValue: pendingWrite
        ? pendingWrite.expectedValue
        : persistedRaw == null ? null : String(persistedRaw),
      nextValue: JSON.stringify(guilds),
      conflictMessage: 'Guild data changed before the roll saved. Please retry.',
    },
  };
}

// Community World Event System

function assertSafeProgressionNumbers(label: string, goal: unknown, progress: unknown, tier: unknown): void {
  // These fields feed a tier loop; Infinity, NaN, zero or negative goals can
  // make that loop non-terminating. Keep progress below MAX_SAFE_INTEGER so
  // the next goal always has room to grow and escape the loop.
  const maxProgress = Number.MAX_SAFE_INTEGER - 1;
  if (
    !Number.isSafeInteger(goal) || Number(goal) < 1 ||
    Number(goal) > Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(progress) || Number(progress) < 0 ||
    Number(progress) > maxProgress ||
    !Number.isSafeInteger(tier) || Number(tier) < 1 ||
    Number(tier) > maxProgress
  ) {
    throw new Error(`${label} progression data is invalid.`);
  }
}

function validateCommunityEventConfig(config: {
  goal?: number;
  progress?: number;
  addRolls?: number;
  tier?: number;
  buffMultiplier?: number;
}): void {
  const max = Number.MAX_SAFE_INTEGER - 1;
  const integerOption = (name: string, value: number | undefined, min: number, cap = max) => {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < min || value > cap)) {
      throw new Error(`Community event ${name} must be a finite safe integer in range.`);
    }
  };
  integerOption('goal', config.goal, 1);
  integerOption('progress', config.progress, 0);
  integerOption('addRolls', config.addRolls, 0);
  integerOption('tier', config.tier, 1);
  if (
    config.buffMultiplier !== undefined &&
    (!Number.isFinite(config.buffMultiplier) || config.buffMultiplier < 1 || config.buffMultiplier > 1_000)
  ) {
    throw new Error('Community event multiplier must be finite and between 1 and 1000.');
  }
}

function assertValidCommunityEvent(event: WorldEvent): void {
  if (
    !event ||
    typeof event !== 'object' ||
    Array.isArray(event) ||
    typeof event.id !== 'string' ||
    event.id.trim().length === 0 ||
    typeof event.title !== 'string' ||
    typeof event.description !== 'string' ||
    typeof event.buffDescription !== 'string' ||
    !Number.isSafeInteger(event.goal) ||
    event.goal < 1 ||
    event.goal > Number.MAX_SAFE_INTEGER - 1 ||
    !Number.isSafeInteger(event.currentProgress) ||
    event.currentProgress < 0 ||
    event.currentProgress > Number.MAX_SAFE_INTEGER - 1 ||
    !Number.isSafeInteger(event.tier) ||
    event.tier < 1 ||
    event.tier > Number.MAX_SAFE_INTEGER - 1 ||
    !Number.isFinite(event.buffMultiplier) ||
    event.buffMultiplier < 1 ||
    event.buffMultiplier > 1_000 ||
    !Number.isSafeInteger(event.endsAt) ||
    event.endsAt < 0 ||
    typeof event.completed !== 'boolean' ||
    (event.completedTier !== undefined &&
      (!Number.isSafeInteger(event.completedTier) ||
        event.completedTier < 0 ||
        event.completedTier > Number.MAX_SAFE_INTEGER - 1)) ||
    (event.weekId !== undefined && !Number.isSafeInteger(event.weekId))
  ) {
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

  if (raw != null) {
    const current = parseCommunityEventForMutation(raw);
    assertSafeProgressionNumbers('Community event', current.goal, current.currentProgress, current.tier);
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
    let parsedLatest: WorldEvent | null = null;
    if (latestRaw != null) {
      try {
        parsedLatest = parseCommunityEventForMutation(latestRaw);
      } catch (error) {
        await txn.unwatch();
        throw error;
      }
    }
    const ev: WorldEvent = parsedLatest ?? { ...COMMUNITY_WORLD_EVENT };
    if (parsedLatest) {
      try {
        assertSafeProgressionNumbers('Community event', ev.goal, ev.currentProgress, ev.tier);
        assertValidCommunityEvent(ev);
      } catch (error) {
        await txn.unwatch();
        throw error;
      }
    }

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

function nextCommunityMilestoneProgression(
  goal: number,
  tier: number,
  label: string,
): { goal: number; tier: number } {
  // The next tier must remain <= MAX_SAFE_INTEGER - 1, the supported
  // progression ceiling. Returning MAX_SAFE_INTEGER here would persist an
  // event that the subsequent validation/read path cannot safely accept.
  if (!Number.isSafeInteger(goal) || goal < 1 || !Number.isSafeInteger(tier) || tier < 1 || tier >= Number.MAX_SAFE_INTEGER - 1) {
    throw new Error(`${label} milestone cannot advance safely; no progress was saved.`);
  }
  const nextGoal = Math.round(goal * 2.2);
  if (!Number.isSafeInteger(nextGoal) || nextGoal <= goal) {
    throw new Error(`${label} goal exceeds the safe progression range; no progress was saved.`);
  }
  return { goal: nextGoal, tier: tier + 1 };
}

export async function prepareCommunityRolls(
  rolls: number,
  pendingWrite?: { expectedValue: string | null; nextValue: string },
): Promise<{
  event: WorldEvent;
  key: string;
  expectedValue: string | null;
  nextValue: string;
}> {
  const amount = Number(rolls);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER - 1) {
    throw new Error('Community roll contribution must be a finite safe integer.');
  }
  await ensureRedisStringKey(COMMUNITY_EVENT_KEY, JSON.stringify(COMMUNITY_WORLD_EVENT));
  const persistedRaw = await redis.get(COMMUNITY_EVENT_KEY);
  const sourceRaw = pendingWrite ? pendingWrite.nextValue : persistedRaw;
  const parsedEvent = sourceRaw == null ? null : parseCommunityEventForMutation(sourceRaw);

  const now = Date.now();
  const currentWeekNumber = weekKey(now);
  const ev: WorldEvent = parsedEvent
    ? { ...parsedEvent }
    : { ...COMMUNITY_WORLD_EVENT };
  if (parsedEvent) {
    assertSafeProgressionNumbers('Community event', ev.goal, ev.currentProgress, ev.tier);
    assertValidCommunityEvent(ev);
  }
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
  // Prove the stored goal can advance before preparing another event write.
  nextCommunityMilestoneProgression(ev.goal, ev.tier || 1, 'Community event');
  // Keep the aggregate presentation counter below the safe-integer ceiling.
  // If a saturated goal can no longer advance safely, the progression helper
  // rejects the mutation before this prepared value is persisted.
  ev.currentProgress = Math.min(Number.MAX_SAFE_INTEGER - 1, ev.currentProgress + amount);
  assertSafeProgressionNumbers('Community event', ev.goal, ev.currentProgress, ev.tier);
  while (ev.currentProgress >= ev.goal) {
    const next = nextCommunityMilestoneProgression(ev.goal, ev.tier || 1, 'Community event');
    ev.completedTier = Math.max(ev.completedTier ?? 0, ev.tier || 1);
    ev.goal = next.goal;
    ev.tier = next.tier;
    ev.buffMultiplier = Number((1.10 + Math.min(10, ev.tier) * 0.05).toFixed(2));
    ev.buffDescription = `+${Math.round((ev.buffMultiplier - 1) * 100)}% Global Luck Active`;
  }

  return {
    event: ev,
    key: COMMUNITY_EVENT_KEY,
    expectedValue: pendingWrite
      ? pendingWrite.expectedValue
      : persistedRaw == null ? null : String(persistedRaw),
    nextValue: JSON.stringify(ev),
  };
}

export async function addCommunityRolls(rolls: number): Promise<WorldEvent> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const prepared = await prepareCommunityRolls(rolls);
    const txn = await redis.watch(prepared.key);
    const current = await redis.get(prepared.key);
    if ((current == null ? null : String(current)) !== prepared.expectedValue) {
      await txn.unwatch();
      continue;
    }
    await txn.multi();
    await txn.set(prepared.key, prepared.nextValue);
    const committed = await txn.exec();
    if (committed !== null) return prepared.event;
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
  validateCommunityEventConfig(config);
  await ensureRedisStringKey(COMMUNITY_EVENT_KEY, JSON.stringify(COMMUNITY_WORLD_EVENT));
  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(COMMUNITY_EVENT_KEY);
    const raw = await redis.get(COMMUNITY_EVENT_KEY);
    const now = Date.now();
    const currentWeekNumber = weekKey(now);
    let parsedEvent: WorldEvent | null = null;
    if (raw != null) {
      try {
        parsedEvent = parseCommunityEventForMutation(raw);
      } catch (error) {
        if (!config.reset) {
          await txn.unwatch();
          throw error;
        }
        // An explicit authenticated admin reset is the repair path for a
        // malformed event. Keep WATCH active so the replacement only commits
        // if the corrupt snapshot has not changed since it was read.
        console.error('[Community Event] Admin reset replacing malformed event data.', error);
      }
    }
    const ev: WorldEvent = parsedEvent ?? { ...COMMUNITY_WORLD_EVENT };
    if (parsedEvent) {
      try {
        assertSafeProgressionNumbers('Community event', ev.goal, ev.currentProgress, ev.tier);
        assertValidCommunityEvent(ev);
      } catch (error) {
        await txn.unwatch();
        throw error;
      }
    }

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
  try {
    assertSafeProgressionNumbers('Community event', ev.goal, ev.currentProgress, ev.tier);
    nextCommunityMilestoneProgression(ev.goal, ev.tier || 1, 'Community event');
  } catch (error) {
    await txn.unwatch();
    throw error;
  }
  try {
    while (ev.currentProgress >= ev.goal) {
      const next = nextCommunityMilestoneProgression(ev.goal, ev.tier || 1, 'Community event');
      ev.completedTier = Math.max(ev.completedTier ?? 0, ev.tier || 1);
      ev.goal = next.goal;
      ev.tier = next.tier;
      ev.buffMultiplier = Number((1.10 + Math.min(10, ev.tier) * 0.05).toFixed(2));
      ev.buffDescription = `+${Math.round((ev.buffMultiplier - 1) * 100)}% Global Luck Active`;
    }
  } catch (error) {
    await txn.unwatch();
    throw error;
  }
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
const CHAT_REPORT_RESERVATION_PREFIX = key('chat-report-reservation:v1:');
const CHAT_COOLDOWN_PREFIX = key('chat-cooldown:v1:');

async function enforceChatCooldown(scope: string, cooldownMs: number): Promise<void> {
  const userId = user();
  if (!userId || userId === 'unknown') throw new Error('Your Reddit identity is unavailable.');
  const cooldownKey = CHAT_COOLDOWN_PREFIX + scope + ':' + userId;
  const token = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  // SET NX is atomic across server instances. Readback distinguishes the
  // request that acquired the cooldown from concurrent/later requests.
  await redis.set(cooldownKey, token, {
    nx: true,
    expiration: new Date(Date.now() + Math.max(1_000, cooldownMs)),
  });
  if (await redis.get(cooldownKey) !== token) {
    throw new Error('You are sending messages too quickly. Please wait a moment.');
  }
}


function parseGlobalChatList(raw: unknown): GlobalChatMessage[] {
  if (raw == null) return [];
  const parsed = parseStoredJson<unknown>(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Global Chat history is corrupted; refusing to overwrite it.');
  }
  if (!parsed.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const message = item as Record<string, unknown>;
    return (
      typeof message.id === 'string' && message.id.trim().length > 0 &&
      typeof message.username === 'string' && message.username.trim().length > 0 &&
      typeof message.text === 'string' && message.text.trim().length > 0 &&
      message.text.length <= 200 &&
      Number.isSafeInteger(message.timestamp) && Number(message.timestamp) >= 0 &&
      (message.userId == null || typeof message.userId === 'string')
    );
  })) {
    throw new Error('Global Chat history contains malformed messages; refusing to overwrite it.');
  }
  return parsed as GlobalChatMessage[];
}

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
    const messages = parseGlobalChatList(raw);
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
  /** Pending means the durable admin record exists, but the Modmail outcome/status update may be ambiguous. */
  status?: 'pending' | 'sent';
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

async function releaseChatReportReservationAfterReceiptFailure(
  reportKey: string,
  reservationKey: string,
  reservationToken: string,
): Promise<void> {
  // Watch both keys: deleting the reservation is safe only while our token still
  // owns it and no durable report receipt appeared after the failed HSET.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txn = await redis.watch(reservationKey, CHAT_REPORTS_KEY);
    const [currentToken, storedReport] = await Promise.all([
      redis.get(reservationKey),
      redis.hGet(CHAT_REPORTS_KEY, reportKey),
    ]);
    if (String(currentToken ?? '') !== reservationToken || storedReport != null) {
      await txn.unwatch();
      return;
    }
    await txn.multi();
    await txn.del(reservationKey);
    if (await txn.exec() !== null) return;
  }
  throw new Error('Chat report reservation changed repeatedly during receipt recovery.');
}

async function submitChatReport(
  scope: 'Global Chat' | 'Guild Chat',
  message: GlobalChatMessage | GuildMessage,
): Promise<{ success: true }> {
  const reporterId = user();
  if (!reporterId || reporterId === 'unknown') throw new Error('Your Reddit identity is unavailable.');
  await enforceChatCooldown('report', 5_000);

  const reportKey = `${scope === 'Global Chat' ? 'global' : 'guild'}:${message.id}:${reporterId}`;
  if (await redis.hGet(CHAT_REPORTS_KEY, reportKey)) {
    throw new Error('You already reported this message.');
  }

  const author = String(message.username ?? 'Redditor').trim().replace(/^u\//i, '') || 'Redditor';
  const reporter = String(username()).trim().replace(/^u\//i, '') || 'Redditor';
  const subredditId = String(context.subredditId ?? '').trim();
  if (!subredditId) throw new Error('Subreddit context is unavailable.');

  // The per-user cooldown throttles report volume, but it is not a dedupe key:
  // a slow Modmail call can outlive it. Reserve this exact message/reporter
  // pair for a day before the external side effect so concurrent retries cannot
  // create a second conversation while the durable report receipt is pending.
  const reservationKey = CHAT_REPORT_RESERVATION_PREFIX + encodeURIComponent(reportKey);
  const reservationToken = `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await redis.set(reservationKey, reservationToken, {
    nx: true,
    expiration: new Date(Date.now() + 24 * 60 * 60_000),
  });
  if (await redis.get(reservationKey) !== reservationToken) {
    throw new Error('A report for this message was already submitted or is still being processed.');
  }

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
    ...String(message.text ?? '').split(/\r?\n/).map(line => `> ${line}`),
  ].join('\n');

  // Persist the report for the admin panel before the external side effect.
  // If Modmail succeeds but its follow-up Redis write fails, the pending record
  // remains visible and the durable hash entry prevents a duplicate report.
  const report: ChatReportRecord = {
    reportId: reportKey,
    scope,
    messageId: message.id,
    author,
    authorUserId: String(message.userId ?? 'unknown'),
    reporter,
    reporterUserId: reporterId,
    text: String(message.text ?? ''),
    reportedAt: Date.now(),
    status: 'pending',
  };
  try {
    await redis.hSet(CHAT_REPORTS_KEY, {
      [reportKey]: JSON.stringify(report),
    });
  } catch (error) {
    // Modmail has not been called yet. Release the reservation only after a
    // WATCH-confirmed read proves no durable report receipt exists; if HSET
    // committed ambiguously, retain the dedupe marker and leave the record for
    // admin review instead of risking a duplicate report.
    try {
      await releaseChatReportReservationAfterReceiptFailure(
        reportKey,
        reservationKey,
        reservationToken,
      );
    } catch (recoveryError) {
      console.error('[Chat Report] Could not reconcile failed pending receipt write.', recoveryError);
    }
    throw error;
  }

  await reddit.modMail.createModInboxConversation({
    subredditId,
    subject: `Chat report • ${scope} • u/${author}`.slice(0, 100),
    bodyMarkdown,
  });

  // The admin record is already durable. Treat a failed status projection as
  // recoverable rather than telling the reporter to retry an external action
  // that may already have succeeded.
  try {
    await redis.hSet(CHAT_REPORTS_KEY, {
      [reportKey]: JSON.stringify({ ...report, status: 'sent' }),
    });
  } catch (error) {
    console.error('[Chat Report] Modmail may have been sent; pending report was preserved.', error);
  }

  return { success: true };
}

export async function getGlobalChat(): Promise<GlobalChatMessage[]> {
  const raw = await redis.get(GLOBAL_CHAT_KEY);
  const parsed = parseGlobalChatList(raw);

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
    .filter(message => {
      const messageUserId = String(message.userId ?? '').trim();
      const messageUsername = message.username.replace(/^u\//i, '').trim().toLowerCase();
      return !mutedIds.has(messageUserId) && !mutedNames.has(messageUsername);
    })
    .map(message => ({ ...message, isAdmin: isAdminUsername(message.username) }))
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
  return withPlayerMutationLockFor('guild-chat-user:' + user(), async () => {
    const messageText = String(text ?? '').trim();
    if (!messageText) throw new Error('Message cannot be empty.');
    if (await isGuildChatMuted()) {
      throw new Error('You are muted from Chat.');
    }
    if (messageText.length > 200) throw new Error('Messages must be 200 characters or fewer.');
    await enforceChatCooldown('global', 2_000);

    const timestamp = Date.now();
    const message: GlobalChatMessage = {
      id: `global-chat-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      username: username().replace(/^u\//i, '') || 'Redditor',
      text: messageText,
      timestamp,
      userId: user(),
      isAdmin: isAdminUsername(username()),
    };

    // Initialize the key before WATCH so the first write follows the same
    // concrete-string path as later transactions in Redis/Valkey adapters.
    await ensureRedisStringKey(GLOBAL_CHAT_KEY, '[]');

    for (let attempt = 0; attempt < 6; attempt++) {
      const txn = await redis.watch(GLOBAL_CHAT_KEY);
      // Read the watched value with Redis; TxClient.get() is a transaction builder.
      const raw = await redis.get(GLOBAL_CHAT_KEY);
      const messages = parseGlobalChatList(raw);

      messages.push(message);
      messages.sort((a, b) => a.timestamp - b.timestamp);

      await txn.multi();
      await txn.set(GLOBAL_CHAT_KEY, JSON.stringify(messages.slice(-GLOBAL_CHAT_MAX_MESSAGES)));
      const committed = await txn.exec();
      if (committed !== null) return message;
    }

    throw new Error('Chat changed while sending your message. Please retry.');
  });
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
  // Legacy entries are only a fallback for the read projection. A corrupted
  // board must not make the entire player-derived leaderboard unavailable.
  let legacyBoard: LeaderboardEntry[] = [];
  try {
    legacyBoard = parseLeaderboardList(legacyRaw);
  } catch (error) {
    console.error('[Leaderboard] Ignoring corrupt legacy projection:', error);
  }
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
      currentDryStreak: Math.max(0, Number(save.rollsSinceBest ?? 0) || 0),
      playtimeMs,
      title: legacy?.title,
      guildTag: legacy?.guildTag,
    });
  }

  return {
    collectionValue: sortLeaderboard(eligible, entry => entry.value),
    mostRolls: sortLeaderboard(eligible, entry => entry.totalRolls),
    highestDryStreak: sortLeaderboard(eligible, entry => entry.highestDryStreak ?? 0),
    currentDryStreak: sortLeaderboard(eligible, entry => entry.currentDryStreak ?? 0),
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
  const userId = user();
  const incomingRevision = Math.max(0, Math.floor(Number(s.stateRevision ?? 0)) || 0);
  // Projection tasks run asynchronously. Prefer the newest durable save when
  // an older callback resumes after a later mutation has already committed.
  const persistedRaw = await redis.get(`player:${userId}`);
  const persisted = parseStoredJson<Partial<PlayerState>>(persistedRaw);
  const persistedRevision = Number(persisted?.stateRevision);
  const source: PlayerState =
    persisted && Number.isSafeInteger(persistedRevision) && persistedRevision > incomingRevision
      ? persisted as PlayerState
      : s;
  if (!(source.lastShareAt && Number(source.lastShareAt) > 0)) return;

  const leaderboardKey = key('leaderboard');
  const name = username();
  const registry = parseStoredJson<{ playtimeMs?: unknown }>(await redis.hGet(PLAYER_REGISTRY_KEY, userId));
  const next: LeaderboardEntry = {
    username: name,
    userId,
    value: source.collectionValue,
    highestRarity: source.highestRarity,
    totalRolls: source.totalRolls,
    level: source.level,
    sharedAt: source.lastShareAt,
    stateRevision: Math.max(0, Math.floor(Number(source.stateRevision ?? 0)) || 0),
    highestDryStreak: Math.max(source.highestDryStreak ?? 0, source.rollsSinceBest ?? 0),
    playtimeMs: Math.max(0, Number(registry?.playtimeMs ?? 0) || 0),
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(leaderboardKey);
    const raw = await redis.get(leaderboardKey);
    const board: LeaderboardEntry[] = parseLeaderboardList(raw);
    const existing = board.find(e => (next.userId && e.userId === next.userId) || e.username === name);
    if (existing) {
      const existingRevision = Number(existing.stateRevision);
      // WATCH protects list writes, not source freshness. An earlier async
      // projection can finish later, so never replace a newer saved revision.
      if (!Number.isSafeInteger(existingRevision) || existingRevision <= next.stateRevision!) {
        Object.assign(existing, next);
      }
    } else board.push(next);
    board.sort((a, b) => b.value - a.value);
    await txn.multi();
    await txn.set(leaderboardKey, JSON.stringify(board.slice(0, 5000)));
    const committed = await txn.exec();
    if (committed !== null) return;
  }
  throw new Error('Leaderboard changed while recording the result. Please retry.');
}


function validateDailyStreakCommunityEvent(event: DailyStreakCommunityEvent): void {
  assertSafeProgressionNumbers('Daily Streak community', event.goal, event.currentProgress, event.tier);
  if (
    !event || typeof event.id !== 'string' ||
    !Number.isSafeInteger(event.completedTier) || event.completedTier < 0 ||
    !Number.isFinite(event.luckMultiplier) || event.luckMultiplier < 0 || event.luckMultiplier > 1_000_000 ||
    !Number.isFinite(event.speedMultiplier) || event.speedMultiplier < 0.5 || event.speedMultiplier > 1 ||
    !Number.isSafeInteger(event.endsAt) || event.endsAt < 0 ||
    !Number.isSafeInteger(event.weekId) || event.weekId < 0
  ) {
    throw new Error('Daily Streak community data is corrupted.');
  }
}

const DAILY_STREAK_COMMUNITY_KEY = key('daily-streak-community');

export async function getDailyStreakCommunity(): Promise<DailyStreakCommunityEvent> {
  await ensureRedisStringKey(DAILY_STREAK_COMMUNITY_KEY, JSON.stringify(createInitialDailyStreakCommunity()));
  const now = Date.now();
  const currentWeek = weekKey(now);

  // The common read path must not WATCH/MULTI/SET an unchanged global event.
  // Rewriting the same value invalidates concurrent claim/contribution WATCHes
  // and lets high-frequency /api/me calls starve legitimate progress updates.
  const currentRaw = await redis.get(DAILY_STREAK_COMMUNITY_KEY);
  if (currentRaw != null) {
    const current = parseStoredJson<DailyStreakCommunityEvent>(currentRaw);
    if (!current) throw new Error('Daily Streak community data is corrupted.');
    validateDailyStreakCommunityEvent(current);
    if (current.weekId === currentWeek && now < current.endsAt) return current;
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const txn = await redis.watch(DAILY_STREAK_COMMUNITY_KEY);
    const raw = await redis.get(DAILY_STREAK_COMMUNITY_KEY);
    const parsedEvent = raw == null ? null : parseStoredJson<DailyStreakCommunityEvent>(raw);
    if (raw != null && !parsedEvent) {
      await txn.unwatch();
      throw new Error('Daily Streak community data is corrupted.');
    }
    let event = parsedEvent ?? createInitialDailyStreakCommunity(now);
    if (parsedEvent) {
      try {
        validateDailyStreakCommunityEvent(event);
      } catch (error) {
        await txn.unwatch();
        throw error;
      }
    }
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

export async function prepareDailyStreakCommunityProgress(amount: number): Promise<{
  event: DailyStreakCommunityEvent;
  key: string;
  expectedValue: string | null;
  nextValue: string;
}> {
  const contribution = Number(amount);
  if (!Number.isSafeInteger(contribution) || contribution < 0 || contribution > Number.MAX_SAFE_INTEGER - 1) {
    throw new Error('Daily Streak contribution must be a finite safe integer.');
  }
  await ensureRedisStringKey(DAILY_STREAK_COMMUNITY_KEY, JSON.stringify(createInitialDailyStreakCommunity()));

  const raw = await redis.get(DAILY_STREAK_COMMUNITY_KEY);
  const now = Date.now();
  const currentWeek = weekKey(now);
  const parsedEvent = raw == null ? null : parseStoredJson<DailyStreakCommunityEvent>(raw);
  if (raw != null && !parsedEvent) {
    throw new Error('Daily Streak community data is corrupted.');
  }

  let event = parsedEvent ?? createInitialDailyStreakCommunity(now);
  if (parsedEvent) validateDailyStreakCommunityEvent(event);
  if (event.weekId !== currentWeek || now >= event.endsAt) {
    event = createInitialDailyStreakCommunity(now);
    event.id = `daily-streak-w${currentWeek}`;
  }

  // Fail closed before preparing a claim if the persisted milestone cannot
  // derive another safe goal/tier. This keeps the loop finite and avoids writes.
  nextCommunityMilestoneProgression(event.goal, event.tier || 1, 'Daily Streak community');
  event.currentProgress += contribution;
  validateDailyStreakCommunityEvent(event);
  while (event.currentProgress >= event.goal) {
    const next = nextCommunityMilestoneProgression(event.goal, event.tier || 1, 'Daily Streak community');
    event.completedTier = Math.max(event.completedTier ?? 0, event.tier || 1);
    event.goal = next.goal;
    event.tier = next.tier;
    event.luckMultiplier = Number((1 + event.tier * 0.50).toFixed(2));
    event.speedMultiplier = Math.max(0.50, Number((1 - event.tier * 0.01).toFixed(2)));
  }
  validateDailyStreakCommunityEvent(event);

  return {
    event,
    key: DAILY_STREAK_COMMUNITY_KEY,
    expectedValue: raw == null ? null : String(raw),
    nextValue: JSON.stringify(event),
  };
}

export async function addDailyStreakCommunityProgress(amount: number): Promise<DailyStreakCommunityEvent> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const prepared = await prepareDailyStreakCommunityProgress(amount);
    const txn = await redis.watch(prepared.key);
    const current = await redis.get(prepared.key);
    if ((current == null ? null : String(current)) !== prepared.expectedValue) {
      await txn.unwatch();
      continue;
    }
    await txn.multi();
    await txn.set(prepared.key, prepared.nextValue);
    const committed = await txn.exec();
    if (committed !== null) return prepared.event;
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

    if (
      typeof state.coins !== 'number' || !Number.isFinite(state.coins) || state.coins < 0 ||
      (state.lifetimeCoins != null && (
        typeof state.lifetimeCoins !== 'number' ||
        !Number.isFinite(state.lifetimeCoins) ||
        state.lifetimeCoins < 0
      ))
    ) {
      await txn.unwatch();
      throw new Error('Player Coin balance is invalid; no achievement reward was applied.');
    }
    if (!Number.isSafeInteger(achievement.rewardCoins) || achievement.rewardCoins < 0) {
      await txn.unwatch();
      throw new Error('Achievement Coin reward is invalid.');
    }

    const currentCoins = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(state.coins)));
    const requestedGain = Math.min(Number.MAX_SAFE_INTEGER, achievement.rewardCoins);
    const rewardCoins = Math.min(requestedGain, Number.MAX_SAFE_INTEGER - currentCoins);
    const lifetimeCoins = Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.max(0, Math.floor(state.lifetimeCoins ?? currentCoins)),
    );

    state.claimedAchievements.push(id);
    state.stateRevision = Math.max(0, Math.floor(Number(state.stateRevision ?? 0)) || 0) + 1;
    state.coins = currentCoins + rewardCoins;
    state.lifetimeCoins = Math.min(Number.MAX_SAFE_INTEGER, lifetimeCoins + rewardCoins);
    const rewardShards = grantFreeShards(state, achievement.rewardShards ?? 0);

    await txn.multi();
    await txn.set(playerKey, JSON.stringify(state));
    const committed = await txn.exec();
    if (committed !== null) {
      return { state, rewardCoins, rewardShards };
    }
  }

  throw new Error('Player data changed while claiming the achievement. Please retry.');

    });
  }

export function shareText(s: PlayerState, rarity: number) {
  return `I just found a 1/${rarity.toLocaleString()} Orb in Infinity Orbs!\n\nPlayer: ${username()}\nRoll #${s.totalRolls.toLocaleString()} • Collection Value ${s.collectionValue.toLocaleString()}\n\nCan you beat probability?`;
}

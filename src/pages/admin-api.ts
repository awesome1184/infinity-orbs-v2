import * as game from '../server/game.js';
import * as social from '../server/social.js';
import * as combat from '../server/combat.js';
import * as riftChallenges from '../server/rift-challenges.js';
import * as rules from '../shared/game.js';
import * as combatRules from '../shared/combat.js';
import { redis } from '../server/devvit-mock.js';
import { context } from './devvit-client.js';
import { withPlayerMutationLock } from '../server/player-lock.js';
import { retireRedisLargeValue } from '../server/redis-large-values.js';
import { getServerMonitorSnapshot, estimateKnownRedisStorage } from '../server/server-monitor.js';
import { auditKnownRedisStorage } from '../server/redis-storage-audit.js';
import { getImpressionDashboard } from '../server/impressions.js';
import { APP_VERSION } from '../shared/version.js';
import { parseAdminCliCommand } from '../shared/admin-cli.js';
import { applyAdminSaveCommands } from '../shared/admin-save-commands.js';

type JsonRecord = Record<string, any>;

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value ?? null), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function fail(message: string, status = 400): Response {
  return response({ error: message }, status);
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return Math.max(0, integer(value, fallback));
}

function normalizedUsername(value: unknown): string {
  return String(value ?? '').trim().replace(/^\/?u\//i, '').toLowerCase();
}

function requireCurrentProfile(value: unknown): string {
  const requested = normalizedUsername(value || context.username);
  const current = normalizedUsername(context.username);
  if (!requested || requested !== current) {
    throw new Error('GitHub Pages testing has access only to the current local test profile. Other Reddit accounts are not available here.');
  }
  return String(context.userId ?? '');
}

function setMaxProgression(state: Awaited<ReturnType<typeof game.loadRaw>>): void {
  const now = Date.now();
  state.coins = 1_000_000_000_000;
  state.shards = 100_000;
  state.cosmicDust = 100_000;
  state.xp = 1_000_000_000;
  state.level = rules.calculateLevelFromXp(state.xp).level;
  state.totalRolls = 1_000_000;
  state.totalCrits = 100_000;
  state.lifetimeCoins = Math.max(state.lifetimeCoins ?? 0, state.coins);
  state.lifetimeShards = Math.max(state.lifetimeShards ?? 0, state.shards);
  state.highestRarity = 100_000_000;
  state.collectionValue = 1_000_000_000_000;
  state.lifetimeCollectionValue = Math.max(state.lifetimeCollectionValue ?? 0, state.collectionValue);
  state.offlineRolls = 1_000;
  state.rollsSinceBest = 0;
  state.prestigeCount = 10;
  state.masteryPoints = 10_000;
  state.currentRunRolls = state.totalRolls;
  state.questsCompleted = 1_000;
  state.guildContribution = Math.max(state.guildContribution ?? 0, 1_000_000);
  state.lastRollAt = 0;
  state.lastSeenAt = now;
  state.lastFrenzyDate = '';
  state.lastFrenzyClaimDate = '';
  state.turboRollUntil = now + 24 * 60 * 60 * 1000;
  state.upgrades = {
    speed: 20, multi: 20, clusterRoll: 20, auto: 1, luck: 20,
    coinBonus: 20, shardChance: 20, xpBonus: 20, critChance: 20,
    critPower: 20, offlineRate: 8, valueBonus: 20, offlineFoundry: 10,
    orbFingers: 15, criticalDividend: 20,
  };
  for (const [id, info] of Object.entries(rules.PRESTIGE_UPGRADES)) {
    state.prestigeUpgrades[id as keyof typeof state.prestigeUpgrades] = info.maxLevel;
  }
  for (const [id, info] of Object.entries(rules.MASTERY_SKILLS)) {
    (state.masterySkills as Record<string, number>)[id] = info.maxLevel;
  }
  state.automations = {
    autoQuestClaim: true, autoStreakClaim: true, autoCommunityClaim: true,
    autoOfflineClaim: true, autoUpgrade: true,
  };
  state.activeBoosters = {
    fortune: now + 60 * 60 * 1000,
    hyperdrive: now + 60 * 60 * 1000,
    barrage: now + 60 * 60 * 1000,
    prosperity: now + 60 * 60 * 1000,
    ascension: now + 60 * 60 * 1000,
  };
  state.unlockedCosmetics = rules.COSMETICS_LIST.map(item => item.id);
  state.activeCosmetic = state.unlockedCosmetics[0] ?? 'default';
  for (const rarity of [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000]) {
    state.collection[String(rarity)] = 1_000;
  }
  for (const quest of [...state.dailyQuests, ...state.weeklyQuests]) {
    quest.unlocked = true;
    quest.progress = quest.target;
    quest.claimed = false;
  }
}

async function saveCurrentState(state: Awaited<ReturnType<typeof game.loadRaw>>): Promise<void> {
  await game.save(state);
  await social.recordLeaderboard(state);
}

async function resetCurrentProfile(): Promise<Awaited<ReturnType<typeof game.loadRaw>>> {
  return withPlayerMutationLock(async () => {
    const userId = String(context.userId ?? '').trim();
    if (!userId) throw new Error('REDDIT_LOGIN_REQUIRED');
    const username = context.username ?? 'Pages Admin';
    const generationKey = 'player-generation:' + userId;
    const playerKey = 'player:' + userId;
    const combatKey = 'infinity-orbs:combat:' + userId;
    const riftArchiveKey = 'io:rift-challenge:v1:' + userId;

    // Fence the reset from every save or combat write that began before it.
    // A fresh revision-zero save must never go through the ordinary save CAS.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const txn = await redis.watch(generationKey, playerKey, combatKey, riftArchiveKey);
      const rawGeneration = await redis.get(generationKey);
      const previousPlayerRaw = await redis.get(playerKey);
      const previousCombatRaw = await redis.get(combatKey);
      const parsedGeneration = Number.parseInt(String(rawGeneration ?? '0'), 10);
      const currentGeneration = Number.isSafeInteger(parsedGeneration) && parsedGeneration >= 0
        ? parsedGeneration
        : 0;
      if (currentGeneration >= Number.MAX_SAFE_INTEGER) {
        await txn.unwatch();
        throw new Error('Player save generation is exhausted and cannot be reset safely.');
      }

      const fresh = rules.createInitialState();
      fresh.username = username;
      fresh.saveGeneration = currentGeneration + 1;
      fresh.stateRevision = 0;

      await txn.multi();
      await txn.set(generationKey, String(fresh.saveGeneration));
      await txn.set(playerKey, JSON.stringify(fresh));
      await txn.del(combatKey);
      await txn.del(riftArchiveKey);
      const committed = await txn.exec();
      if (committed !== null) {
        await game.cleanupPreviousPlayerSave(userId, previousPlayerRaw).catch(error => {
          console.warn('[Pages Admin Reset] Previous player-save chunks could not be retired:', error);
        });
        await retireRedisLargeValue(combatKey, previousCombatRaw).catch(error => {
          console.warn('[Pages Admin Reset] Previous Combat chunks could not be retired:', error);
        });
        await redis.del('io:roll-ticket:' + userId).catch(() => undefined);
        await social.recordLeaderboard(fresh);
        return fresh;
      }
    }

    throw new Error('Player data changed repeatedly while resetting. Please retry.');
  });
}

async function combatLabSnapshot() {
  const current = await combat.getCombatSnapshot();
  const state = current.state;
  const depths = [1, 100, 1_000, 10_000, combatRules.COMBAT_MAX_DEPTH];
  const projections = depths.map(depth => {
    const projected = { ...state, depth, equipment: { ...state.equipment } } as typeof state;
    const stats = combatRules.combatStatsFor(projected);
    const enemy = combatRules.getEnemyForDungeonDepth(state.dungeonId, depth);
    const maxOrbCritDamage = Math.round(stats.damage * combatRules.combatOrbDamageMultiplier(Number.MAX_VALUE) * 1.75);
    return {
      depth, damage: stats.damage, speed: stats.speed, maxHealth: stats.maxHealth,
      maxOrbCritDamage, enemyHp: enemy.maxHp, enemyDamage: enemy.damage, enemySpeed: enemy.speed,
    };
  });
  const rarityOdds = combatRules.combatGearRarityOdds();
  const statBudgets = Object.fromEntries([0, 15, 40, 70, 90, 100].map(quality => [
    String(quality), combatRules.combatGearStatBudgetMultiplier(quality),
  ]));
  const end = projections[projections.length - 1]!;
  const speedProbe = {
    ...state,
    inventory: [],
    equipment: Object.fromEntries(Object.keys(state.equipment).map(slot => [slot, null])) as typeof state.equipment,
  };
  const speedAtDepthOne = combatRules.combatStatsFor({ ...speedProbe, depth: 1 }).speed;
  const speedAtMaxDepth = combatRules.combatStatsFor({ ...speedProbe, depth: combatRules.COMBAT_MAX_DEPTH }).speed;
  const qualityValid = state.inventory.every(item => Number.isFinite(item.quality) && item.quality >= 0 && item.quality <= 100);
  const equipmentValid = Object.entries(state.equipment).every(([slot, id]) =>
    !id || state.inventory.some(item => item.id === id && item.slot === slot));
  const runeRefsValid = (state.equippedRunes ?? []).every(id => state.runes.some(rune => rune.id === id));
  const checks = [
    { label: 'Gear quality is within 0–100', passed: qualityValid, detail: qualityValid ? 'All saved equipment has valid quality.' : 'Invalid equipment quality found.' },
    { label: 'Equipped gear references are valid', passed: equipmentValid, detail: equipmentValid ? 'Every equipped item exists in the expected slot.' : 'A gear slot points to a missing or mismatched item.' },
    { label: 'Equipped Rune references are valid', passed: runeRefsValid, detail: runeRefsValid ? 'Every equipped Rune exists in inventory.' : 'A Rune slot references a missing Rune.' },
    { label: 'High gear grades are genuinely rare', passed: rarityOdds.Common > .85 && rarityOdds.Mythic < .01, detail: 'Common ' + (rarityOdds.Common * 100).toFixed(2) + '% · Mythic ' + (rarityOdds.Mythic * 100).toFixed(2) + '% theoretical natural-drop odds.' },
    { label: 'High-quality gear owns a larger stat budget', passed: combatRules.combatGearStatBudgetMultiplier(90) > combatRules.combatGearStatBudgetMultiplier(15) * 5, detail: '90% quality is ' + (combatRules.combatGearStatBudgetMultiplier(90) / combatRules.combatGearStatBudgetMultiplier(15)).toFixed(1) + '× the budget of 15% quality.' },
    { label: 'Player Speed is independent of dungeon depth', passed: speedAtDepthOne === speedAtMaxDepth, detail: 'No-gear baseline: depth 1 ' + Math.round(speedAtDepthOne).toLocaleString() + ' → depth ' + combatRules.COMBAT_MAX_DEPTH.toLocaleString() + ' ' + Math.round(speedAtMaxDepth).toLocaleString() + ' Speed.' },
    { label: 'Late-game HP reaches millions', passed: end.maxHealth >= 1_000_000, detail: 'Depth ' + combatRules.COMBAT_MAX_DEPTH.toLocaleString() + ' projection: ' + Math.round(end.maxHealth).toLocaleString() + ' maximum HP.' },
    { label: 'Late-game high-orb crit damage reaches millions', passed: end.maxOrbCritDamage >= 1_000_000, detail: 'Depth ' + combatRules.COMBAT_MAX_DEPTH.toLocaleString() + ' projection: ' + Math.round(end.maxOrbCritDamage).toLocaleString() + ' critical damage.' },
    { label: 'Rune Major Ability data is valid', passed: state.runes.every(rune => !rune.majorAbility || (typeof rune.majorAbility.name === 'string' && typeof rune.majorAbility.description === 'string')), detail: state.runes.filter(rune => rune.majorAbility).length + ' Runes currently have Major Abilities.' },
  ];
  return {
    ...current,
    balance: { generatedAt: Date.now(), rarityOdds, statBudgets, projections, checks },
  };
}

async function applyStatePatch(body: JsonRecord) {
  const state = await game.loadRaw();
  const numericFields = [
    'coins', 'cosmicDust', 'xp', 'totalRolls', 'totalCrits', 'lifetimeCoins',
    'highestRarity', 'collectionValue', 'lifetimeCollectionValue', 'offlineRolls',
    'prestigeCount', 'rollsSinceBest', 'turboRollUntil', 'onlinePlayers',
    'purchasedShards', 'currentRunRolls', 'questsCompleted', 'guildContribution',
    'masteryPoints', 'aftershockRecord', 'rollingSessionStartedAt',
    'rollingSessionLastRollAt', 'longestRollingSessionMs', 'communityRewardClaimedAt',
    'communityRewardClaimedTier', 'chainPatcherNextRarity', 'chainPatcherCooldownUntil',
    'level', 'levelXpFloor', 'globalBoosterCredits',
  ];
  for (const field of numericFields) {
    if (field in body) (state as any)[field] = nonNegativeInteger(body[field]);
  }
  for (const field of ['shards', 'lifetimeShards', 'freeShardsEarnedToday']) {
    if (field in body) (state as any)[field] = rules.roundShardAmount(body[field]);
  }
  if ('shardPityRolls' in body) {
    state.shardPityRolls = Math.min(rules.SHARD_PITY_ROLLS_TO_REWARD - 1, nonNegativeInteger(body.shardPityRolls));
  }
  if ('lastRollAt' in body) state.lastRollAt = body.lastRollAt === null ? null : nonNegativeInteger(body.lastRollAt);
  if ('lastSeenAt' in body) state.lastSeenAt = nonNegativeInteger(body.lastSeenAt);
  if ('lastShareAt' in body) state.lastShareAt = body.lastShareAt === null ? undefined : nonNegativeInteger(body.lastShareAt);
  if ('autoRollEnabled' in body) state.autoRollEnabled = Boolean(body.autoRollEnabled);
  for (const field of ['lastFrenzyDate', 'lastFrenzyClaimDate', 'lastDailyReset', 'lastWeeklyReset', 'lastFreeShardReset']) {
    if (typeof body[field] === 'string') (state as any)[field] = body[field];
  }
  if (body.upgrades && typeof body.upgrades === 'object') {
    for (const id of Object.keys(state.upgrades)) {
      if (id in body.upgrades) state.upgrades[id as keyof typeof state.upgrades] = nonNegativeInteger(body.upgrades[id]);
    }
  }
  if (body.prestigeUpgrades && typeof body.prestigeUpgrades === 'object') {
    for (const id of Object.keys(state.prestigeUpgrades)) {
      if (id in body.prestigeUpgrades) state.prestigeUpgrades[id as keyof typeof state.prestigeUpgrades] = nonNegativeInteger(body.prestigeUpgrades[id]);
    }
  }
  if (body.masterySkills && typeof body.masterySkills === 'object') {
    for (const id of Object.keys(state.masterySkills ?? {})) {
      if (id in body.masterySkills) (state.masterySkills as Record<string, number>)[id] = nonNegativeInteger(body.masterySkills[id]);
    }
  }
  if (body.automations && typeof body.automations === 'object') {
    state.automations = { ...(state.automations ?? {}) };
    for (const id of ['autoQuestClaim', 'autoStreakClaim', 'autoCommunityClaim', 'autoOfflineClaim', 'autoUpgrade']) {
      if (id in body.automations) state.automations[id as keyof NonNullable<typeof state.automations>] = Boolean(body.automations[id]);
    }
  }
  if (body.activeBoosters && typeof body.activeBoosters === 'object') {
    const ids = ['fortune', 'hyperdrive', 'barrage', 'prosperity', 'ascension'] as const;
    state.activeBoosters = Object.keys(body.activeBoosters).length === 0 ? {} : { ...(state.activeBoosters ?? {}) };
    for (const id of ids) if (id in body.activeBoosters) state.activeBoosters[id] = nonNegativeInteger(body.activeBoosters[id]);
  }
  if (body.sacrifices && typeof body.sacrifices === 'object') {
    state.sacrifices = {
      coinsSacrificed: nonNegativeInteger(body.sacrifices.coinsSacrificed, state.sacrifices?.coinsSacrificed ?? 0),
      shardsSacrificed: nonNegativeInteger(body.sacrifices.shardsSacrificed, state.sacrifices?.shardsSacrificed ?? 0),
      altarLevel: nonNegativeInteger(body.sacrifices.altarLevel, state.sacrifices?.altarLevel ?? 0),
      luckSurgeUntil: nonNegativeInteger(body.sacrifices.luckSurgeUntil, state.sacrifices?.luckSurgeUntil ?? 0),
    };
  }
  if (Array.isArray(body.unlockedCosmetics)) {
    state.unlockedCosmetics = body.unlockedCosmetics.filter((item: unknown) => typeof item === 'string').slice(0, 500);
  }
  if (body.collection && typeof body.collection === 'object') {
    const next: Record<string, number> = {};
    for (const [rarity, value] of Object.entries(body.collection)) {
      const count = nonNegativeInteger(value);
      if (count > 0) next[String(rarity)] = count;
    }
    const affected = new Set([...Object.keys(state.collection ?? {}), ...Object.keys(next)]);
    for (const rarity of affected) game.markCodexRarityWrite(state, rarity);
    state.collection = next;
  }
  if ('xp' in body) state.level = rules.calculateLevelFromXp(state.xp).level;
  if (body.questState === 'ready') {
    for (const quest of [...state.dailyQuests, ...state.weeklyQuests]) {
      quest.unlocked = true; quest.progress = quest.target; quest.claimed = false;
    }
  }
  if (body.questState === 'reset') {
    for (const quest of [...state.dailyQuests, ...state.weeklyQuests]) {
      quest.progress = 0; quest.claimed = false;
    }
  }
  await saveCurrentState(state);
  return state;
}

async function applyPreset(preset: string) {
  const state = await game.loadRaw();
  const fresh = rules.createInitialState();
  if (preset === 'fresh') {
    Object.assign(state, fresh);
    state.username = context.username ?? state.username;
  } else if (preset === 'max') {
    setMaxProgression(state);
  } else if (preset === 'frenzy-ready') {
    state.lastFrenzyDate = ''; state.lastFrenzyClaimDate = ''; state.lastRollAt = 0;
  } else if (preset === 'offline-ready') {
    state.offlineRolls = 1_000; state.lastSeenAt = Date.now();
  } else if (preset === 'quests-ready') {
    for (const quest of [...state.dailyQuests, ...state.weeklyQuests]) {
      quest.unlocked = true; quest.progress = quest.target; quest.claimed = false;
    }
  } else if (preset === 'prestige-ready') {
    state.collectionValue = Math.max(state.collectionValue, 250_000_000);
    state.lifetimeCollectionValue = Math.max(state.lifetimeCollectionValue, state.collectionValue);
    state.lastRollAt = 0;
  } else if (preset === 'booster-test') {
    const now = Date.now();
    state.activeBoosters = {
      fortune: now + 60 * 60 * 1000, hyperdrive: now + 60 * 60 * 1000,
      barrage: now + 60 * 60 * 1000, prosperity: now + 60 * 60 * 1000,
      ascension: now + 60 * 60 * 1000,
    };
    state.lastRollAt = 0;
  } else if (preset === 'upgrades-max') {
    state.upgrades = {
      speed: 20, multi: 20, clusterRoll: 20, auto: 1, luck: 20,
      coinBonus: 20, shardChance: 20, xpBonus: 20, critChance: 20,
      critPower: 20, offlineRate: 8, valueBonus: 20, offlineFoundry: 10,
      orbFingers: 15, criticalDividend: 20,
    };
  } else if (preset === 'upgrades-reset') {
    state.upgrades = {
      speed: 0, multi: 0, clusterRoll: 0, auto: 1, luck: 0,
      coinBonus: 0, shardChance: 0, xpBonus: 0, critChance: 0,
      critPower: 0, offlineRate: 0, valueBonus: 0, offlineFoundry: 0,
      orbFingers: 0, criticalDividend: 0,
    };
  } else if (preset === 'prestige-max') {
    for (const [id, info] of Object.entries(rules.PRESTIGE_UPGRADES)) {
      state.prestigeUpgrades[id as keyof typeof state.prestigeUpgrades] = info.maxLevel;
    }
  } else if (preset === 'prestige-reset') {
    for (const id of Object.keys(state.prestigeUpgrades)) {
      state.prestigeUpgrades[id as keyof typeof state.prestigeUpgrades] = 0;
    }
  } else if (preset === 'mastery-max') {
    for (const [id, info] of Object.entries(rules.MASTERY_SKILLS)) {
      (state.masterySkills as Record<string, number>)[id] = info.maxLevel;
    }
  } else if (preset === 'mastery-reset') {
    for (const id of Object.keys(state.masterySkills ?? {})) (state.masterySkills as Record<string, number>)[id] = 0;
    state.masteryPoints = 0;
  } else if (preset === 'automations-on') {
    state.automations = { autoQuestClaim: true, autoStreakClaim: true, autoCommunityClaim: true, autoOfflineClaim: true, autoUpgrade: true };
  } else if (preset === 'automations-off') {
    state.automations = {};
  } else if (preset === 'boosters-off') {
    state.activeBoosters = {};
  } else if (preset === 'collection-clear') {
    for (const rarity of Object.keys(state.collection ?? {})) game.markCodexRarityWrite(state, rarity);
    state.collection = {}; state.collectionValue = 0; state.highestRarity = 0; state.rollsSinceBest = 0;
  } else if (preset === 'quests-reset') {
    for (const quest of [...state.dailyQuests, ...state.weeklyQuests]) { quest.progress = 0; quest.claimed = false; }
  } else if (preset === 'streak-reset') {
    state.streak = { count: 1, lastClaimDate: '', longestStreak: 1 };
  } else if (preset === 'offline-clear') {
    state.offlineRolls = 0;
  } else {
    throw new Error('Unknown admin preset.');
  }
  await saveCurrentState(state);
  return { ok: true, preset, state };
}

export async function handlePagesAdminRequest(url: URL, method: string, body: JsonRecord): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/dev/, '') || '/';
  const query = url.searchParams;
  try {
    // This is a static, browser-only test environment. Admin access is deliberately
    // enabled for local test profiles; every mutation is scoped to this browser's
    // local save. No Reddit API, notification delivery, or remote account action
    // is available from this adapter.
    if (method === 'GET') {
      switch (path) {
        case '/status': {
          const [gameBan] = await Promise.all([game.getGameBanStatus()]);
          return response({
            isAdmin: true, username: context.username ?? null, userId: context.userId ?? null,
            subredditName: context.subredditName ?? null, postId: context.postId ?? null,
            gameModerationVersion: 'pages-local-admin-v1', gameBan,
          });
        }
        case '/context':
          return response({ username: context.username ?? null, userId: context.userId ?? null, subredditName: context.subredditName ?? null, postId: context.postId ?? null });
        case '/execute-as/save': {
          const username = String(query.get('username') ?? '');
          const userId = requireCurrentProfile(username);
          const state = await game.loadRaw({ registerActivity: false });
          return response({ ok: true, username: context.username, userId, save: state, codexStoredSeparately: false });
        }
        case '/server-monitor':
          return response(getServerMonitorSnapshot());
        case '/server-monitor/storage':
          return response(await estimateKnownRedisStorage(redis));
        case '/server-monitor/storage/audit':
          return response(await auditKnownRedisStorage(redis));
        case '/impressions':
          return response(await getImpressionDashboard());
        case '/combat-lab/state':
          return response(await combatLabSnapshot());
        case '/rift/status': {
          const username = String(query.get('username') ?? context.username ?? '').trim().replace(/^\/?u\//i, '');
          const userId = requireCurrentProfile(username);
          return response({ username, userId, ...(await riftChallenges.getRiftChallengeAdminStatus(userId)) });
        }
        case '/payment-logs':
          return response({ logs: await game.getPaymentDebugLogs(Math.max(1, Math.min(200, integer(query.get('limit'), 200)))) });
        case '/save-logs':
          return response({ logs: await game.getSaveDebugLogs(context.userId, Math.max(1, Math.min(500, integer(query.get('limit'), 500)))) });
        case '/global-boosters-log':
          return response({ logs: await game.getGlobalBoosterActivationLog(Math.max(1, Math.min(300, integer(query.get('limit'), 100)))) });
        case '/global-booster-logs':
          return response({ logs: await game.getGlobalBoosterDebugLogs(Math.max(1, Math.min(300, integer(query.get('limit'), 300)))) });
        case '/follow-reward':
        case '/follow-stats':
          return response(await game.getFollowPromptStats());
        case '/ccu':
          return response(await game.getCcuPeaks());
        case '/notifications/stats': {
          try { return response(await game.getNotificationStats()); }
          catch {
            return response({ optedInPlayers: 0, updatesEnabledPlayers: 0, offlineOrbsEnabledPlayers: 0, totalPlayers: 0, percentage: 0, updatesPercentage: 0, offlineOrbsPercentage: 0, localOnly: true });
          }
        }
        case '/popups': {
          const [config, stats] = await Promise.all([game.getPopupConfig(), game.getPopupStats()]);
          return response({ config, stats, generatedAt: Date.now() });
        }
        case '/alignment/stats':
          return response({ ...(await game.getCelestialAlignmentChoiceStats()), generatedAt: Date.now() });
        case '/announcement':
          return response(await game.getDeveloperAnnouncement());
        case '/chat-reports':
          return response(await social.listChatReports());
        case '/guild-chat-spy':
          return response(await social.listGuildChatSpy());
        case '/players': {
          const [players, activity, notificationStats] = await Promise.all([
            game.listPlayers(), game.getPlayerActivityStats(),
            game.getNotificationStats().catch(() => null),
          ]);
          return response({ players, activity, notificationStats });
        }
        case '/leaderboard-diagnostics': {
          const [registry, leaderboard] = await Promise.all([redis.hGetAll('io:player-registry'), social.leaderboard()]);
          const ids = Object.keys(registry ?? {});
          return response({
            generatedAt: Date.now(), appVersion: APP_VERSION,
            runningContext: { username: context.username ?? null, subredditName: context.subredditName ?? null, postId: context.postId ?? null },
            storage: { registry: { key: 'io:player-registry', readOk: true, shape: 'hash', fieldCount: ids.length, localProfiles: ids.filter(id => id.startsWith('github-pages-test-')).length } },
            computed: { playerCount: ids.length, leaderboardEntries: leaderboard.length, localOnly: true },
          });
        }
        case '/stat-spy': {
          requireCurrentProfile(query.get('username'));
          const [state, currentCcu, fakeCcuBonus, combatSnapshot] = await Promise.all([
            game.loadRaw({ registerActivity: false }), game.getOnlinePlayers(),
            game.getFakeCcuBonus(), combat.getCombatSnapshot(),
          ]);
          const effectiveCcu = currentCcu + fakeCcuBonus;
          return response({
            username: context.username, userId: context.userId, generatedAt: Date.now(),
            summary: {
              level: state.level, xp: state.xp, totalRolls: state.totalRolls,
              highestRarity: state.highestRarity, coins: state.coins, shards: state.shards,
              cosmicDust: state.cosmicDust, prestigeCount: state.prestigeCount,
              currentCcu, fakeCcuBonus, effectiveCcu,
            },
            stats: [],
            allocations: {
              upgrades: state.upgrades, prestigeUpgrades: state.prestigeUpgrades,
              masterySkills: state.masterySkills, guildPerks: state.guildPerks ?? {},
              globalBoosters: await game.getGlobalBoosters(), activeBoosters: state.activeBoosters ?? {},
            },
            playerSave: state, calculatedPlayerState: state,
            combat: {
              saveExists: true, inCombat: combatSnapshot.state.health > 0 && combatSnapshot.enemy.hp > 0,
              status: 'Local combat save', statusNote: 'This view is limited to the current browser profile.',
              dungeonId: combatSnapshot.state.dungeonId, depth: combatSnapshot.state.depth,
              bestDepth: combatSnapshot.state.bestDepth, dungeonBestDepths: combatSnapshot.state.dungeonBestDepths,
              playerHp: combatSnapshot.state.health, playerMaxHp: combatSnapshot.stats.maxHealth,
              enemy: combatSnapshot.enemy, stats: combatSnapshot.stats, gear: [],
              equippedSkills: [], equippedRunes: [], runeBonuses: { luckPct: 0, coinGainPct: 0, shardChancePct: 0, xpGainPct: 0 }, runeLuckMultiplier: 1,
              lastAcceptedBeatAtMs: combatSnapshot.state.lastAcceptedBeatAtMs, state: combatSnapshot.state,
            },
          });
        }
        case '/player-spy': {
          requireCurrentProfile(query.get('username'));
          const logs = await game.getPlayerSpyLogs(String(context.userId ?? ''), Math.max(1, Math.min(500, integer(query.get('limit'), 500))));
          return response({ username: context.username, userId: context.userId, logCount: logs.length, logs, generatedAt: Date.now() });
        }
        case '/moderation/save': {
          requireCurrentProfile(query.get('username'));
          const state = await game.loadRaw({ registerActivity: false });
          const ban = await game.getGameBanStatus();
          const generation = Number(await redis.get('player-generation:' + context.userId)) || 0;
          return response({
            username: context.username, userId: context.userId, generation, ban, exists: true,
            save: { level: state.level, xp: state.xp, saveGeneration: state.saveGeneration ?? 0, coins: state.coins, shards: state.shards, totalRolls: state.totalRolls, highestRarity: state.highestRarity },
          });
        }
        case '/mechanics': {
          const state = await game.loadRaw({ registerActivity: false });
          return response({
            ok: true,
            mechanics: {
              luckMultiplier: rules.luckMultiplier(state),
              cooldownMs: rules.cooldownMs(state, false),
              autoCooldownMs: rules.cooldownMs(state, true),
              rollsPerActivation: rules.rollsPerActivation(state),
              offlineRollCap: rules.offlineRollCap(state),
              effectiveOfflineTickMs: rules.effectiveOfflineTickMs(state),
              critMultiplier: rules.critMultiplier(state),
              effectiveCritChance: Math.min(0.40,
                (state.upgrades.critChance ?? 0) * 0.03 +
                (state.masterySkills?.critMastery ?? 0) * 0.03 +
                (state.guildPerks?.critRank ?? 0) * 0.015 +
                rules.globalBoosterCritChanceBonus(state.globalBoosters?.crit) +
                rules.guildComboCritChanceBonus(state.guildCombo)),
              shardProcChance: Math.min(0.5, (
                (state.upgrades.shardChance ?? 0) * 0.0015 +
                (state.masterySkills?.shardAttunement ?? 0) * 0.001 +
                (state.guildPerks?.shardRank ?? 0) * 0.0005 +
                (state.prestigeUpgrades?.shardResonator ?? 0) * 0.0025 +
                rules.getLevelBenefits(Math.max(1, state.level || 1)).shardChance
              ) * 0.5),
              apexFortuneChance: Math.min(0.45, Math.max(0, Number(state.masterySkills?.apexFortune ?? 0)) * 0.03),
              altar: rules.calculateAltarMultipliers(state),
              basePrestigeDust: rules.calculatePrestigeDust(state.collectionValue ?? 0),
              prestigeDust: rules.calculateCosmicDust(state),
              autoUnlocked: rules.autoUnlocked(state),
              synthesisUnlocked: (state.prestigeUpgrades?.shardSynthesis ?? 0) >= 1 && (state.level ?? 1) >= 20,
            },
            state,
          });
        }
        case '/moderation/banned':
          return response({ users: await game.listGameBans() });
        default:
          if (path.startsWith('/notifications/campaign/')) {
            const id = decodeURIComponent(path.slice('/notifications/campaign/'.length));
            const campaign = await game.getManualPushNotificationCampaign(id);
            return campaign ? response(campaign) : fail('Notification campaigns are unavailable in the local Pages build.', 404);
          }
          return fail('Unknown Pages Admin Console endpoint: ' + path, 404);
      }
    }

    if (method !== 'POST') return fail('Method not supported by the Pages Admin Console.', 405);

    switch (path) {
      case '/cli/execute': {
        const parsed = parseAdminCliCommand(String(body.command ?? ''));
        if (parsed.kind === 'balance') {
          return response({
            ok: true,
            scope: 'everyone',
            localOnly: true,
            balance: await game.executeLiveBalanceCommand(parsed, context.username ?? 'Pages Admin'),
          });
        }
        if (parsed.kind === 'menus') {
          return response({
            ok: true,
            scope: 'everyone',
            localOnly: true,
            menuControl: await game.setGlobalMenuControl(parsed.enabled, parsed.reason, context.username ?? 'Pages Admin'),
          });
        }
        if (parsed.kind === 'feature') {
          return response({
            ok: true,
            scope: 'everyone',
            localOnly: true,
            featureControl: await game.setGlobalFeatureControl(parsed.feature, parsed.enabled, parsed.reason, context.username ?? 'Pages Admin'),
          });
        }
        if (parsed.kind === 'feature-list') {
          return response({
            ok: true,
            scope: 'everyone',
            localOnly: true,
            featureControls: await game.getGlobalFeatureControls(),
          });
        }
        if (parsed.kind === 'announcement') {
          return response({
            ok: true,
            scope: 'everyone',
            localOnly: true,
            announcement: await game.setDeveloperAnnouncement(parsed.message, context.username ?? 'Pages Admin'),
          });
        }
        const username = String(body.username ?? '');
        const userId = requireCurrentProfile(username);
        const result = await withPlayerMutationLock(async () => {
          const current = await game.loadRaw({ registerActivity: false, source: 'main' });
          const applied = applyAdminSaveCommands(current as unknown as Record<string, unknown>, parsed.commands);
          const nextState = applied.state as unknown as Awaited<ReturnType<typeof game.loadRaw>>;
          nextState.username = context.username;
          await saveCurrentState(nextState);
          if (parsed.invalidateRollTicket) await redis.del('io:roll-ticket:' + userId);
          return {
            ok: true,
            scope: 'player',
            username: context.username,
            userId,
            stateRevision: Math.max(0, Math.floor(Number(current.stateRevision ?? 0)) || 0) + 1,
            results: applied.results,
            invalidatedRollTicket: parsed.invalidateRollTicket,
            localOnly: true,
          };
        });
        return response(result);
      }
      case '/execute-as/execute': {
        const username = String(body.username ?? '');
        requireCurrentProfile(username);
        const result = await withPlayerMutationLock(async () => {
          const current = await game.loadRaw({ registerActivity: false, source: 'main' });
          const applied = applyAdminSaveCommands(current as unknown as Record<string, unknown>, String(body.commands ?? ''));
          const nextState = applied.state as unknown as Awaited<ReturnType<typeof game.loadRaw>>;
          nextState.username = context.username;
          await saveCurrentState(nextState);
          return {
            ok: true,
            username: context.username,
            userId: context.userId,
            stateRevision: Math.max(0, Math.floor(Number(current.stateRevision ?? 0)) || 0) + 1,
            results: applied.results,
            codexStoredSeparately: false,
            localOnly: true,
          };
        });
        return response(result);
      }
      case '/combat-lab/action':
        return response(await combat.adminCombatLabAction(body));
      case '/rift/grant': {
        const username = String(body.username ?? context.username ?? '').trim().replace(/^\/?u\//i, '');
        const userId = requireCurrentProfile(username);
        const result = await riftChallenges.adminGrantRiftProgress(userId, {
          points: body.points,
          minutes: body.minutes,
        });
        return response({ ok: true, username, userId, ...result });
      }
      case '/diagnostic-logs/clear-all':
        return response(await game.clearAllDiagnosticLogs());
      case '/payment-logs/clear':
        await game.clearPaymentDebugLogs();
        return response({ ok: true });
      case '/save-logs/clear':
        await game.clearSaveDebugLogs();
        return response({ ok: true });
      case '/global-booster-logs/clear':
        await game.clearGlobalBoosterDebugLogs();
        return response({ ok: true });
      case '/global-boosters-log/clear':
        await game.clearGlobalBoosterActivationLog();
        return response({ ok: true });
      case '/global-booster':
        return response({ state: await game.setGlobalBoosterDebugState(String(body.id) as any, integer(body.tier), integer(body.minutes)) });
      case '/global-booster-credits/grant': {
        const amount = Math.max(0, Math.min(1_000_000, integer(body.amount, 1)));
        const state = await game.loadRaw();
        state.globalBoosterCredits = Math.min(Number.MAX_SAFE_INTEGER, (state.globalBoosterCredits ?? 0) + amount);
        await saveCurrentState(state);
        return response({ ok: true, localOnly: true, granted: amount, state });
      }
      case '/ccu/fake':
        return response({ ok: true, fakeCcuBonus: await game.setFakeCcuBonus(integer(body.bonus)) });
      case '/push-test':
      case '/notifications/send':
        return fail('Real push notification delivery is not available on GitHub Pages. No notifications were sent.', 501);
      case '/popups/config': {
        const config = await game.setPopupConfig(body);
        return response({ ok: true, config, stats: await game.getPopupStats() });
      }
      case '/alignment/force':
        return response(await game.forceCelestialAlignmentPromptForCurrentUser());
      case '/announcement':
        return response({ announcement: await game.setDeveloperAnnouncement(String(body.message ?? ''), context.username ?? 'Pages Admin') });
      case '/chat-reports/read':
        return response(await social.markChatReportRead(String(body.reportId ?? '')));
      case '/guild-authority':
        return response({ ok: true, ...(await social.adminSetGuildAuthority(String(body.guildId ?? '').trim(), body.authority)) });
      case '/guild-chat/mute': {
        const userId = requireCurrentProfile(body.username);
        return response({ ok: true, action: 'guild-chat-mute', mute: await social.muteGuildChatUser(userId, context.username ?? 'PagesTester', context.username ?? 'Pages Admin') });
      }
      case '/guild-chat/unmute': {
        const userId = requireCurrentProfile(body.username);
        const changed = await social.unmuteGuildChatUser(userId);
        return response({ ok: true, action: 'guild-chat-unmute', username: context.username, userId, changed });
      }
      case '/chat/register-current-post':
        return fail('Reddit post registration is unavailable on GitHub Pages. This action has no local equivalent.', 501);
      case '/event':
        return response({ event: await social.setCommunityEventConfig({
          goal: body.goal, progress: body.progress, addRolls: body.addRolls,
          tier: body.tier, buffMultiplier: body.buffMultiplier, reset: body.reset,
        }) });
      case '/currency': {
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          const coins = integer(body.coins);
          state.coins = coins >= 0 ? rules.addCoinAmount(state.coins, coins) : Math.max(0, state.coins + coins);
          state.shards = Math.max(0, (state.shards ?? 0) + integer(body.shards));
          state.cosmicDust = Math.max(0, (state.cosmicDust ?? 0) + integer(body.dust));
          await saveCurrentState(state);
          return { ok: true, state };
        }));
      }
      case '/time-energy/grant-test':
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          state.timeEnergy = rules.TIME_ENERGY_MAX_MS;
          await saveCurrentState(state);
          return { ok: true, grantedSeconds: rules.TIME_ENERGY_MAX_MS / 1_000, state };
        }));
      case '/state':
        return response(await withPlayerMutationLock(() => applyStatePatch(body)).then(state => ({ ok: true, state })));
      case '/preset':
        return response(await withPlayerMutationLock(() => applyPreset(String(body.preset ?? '').trim())));
      case '/reset-cooldown': {
        await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          state.lastRollAt = 0;
          await game.save(state);
          if (context.userId) await redis.del('io:roll-ticket:' + context.userId);
        });
        return response({ ok: true, ...(await game.getRollTicket()) });
      }
      case '/unlock-upgrades':
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          state.upgrades = {
            speed: 20, multi: 20, clusterRoll: 20, auto: 1, luck: 20,
            coinBonus: 20, shardChance: 20, xpBonus: 20, critChance: 20,
            critPower: 20, offlineRate: 8, valueBonus: 20, offlineFoundry: 10,
            orbFingers: 15, criticalDividend: 20,
          };
          await saveCurrentState(state);
          return { ok: true, state };
        }));
      case '/unlock-everything':
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          setMaxProgression(state);
          await saveCurrentState(state);
          return { ok: true, state };
        }));
      case '/add-offline':
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          state.offlineRolls = Math.min(1_000, Math.max(0, (state.offlineRolls ?? 0) + integer(body.amount, 50)));
          await game.save(state);
          return { ok: true, state };
        }));
      case '/offline-set':
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          state.offlineRolls = Math.min(1_000, nonNegativeInteger(body.amount));
          await game.save(state);
          return { ok: true, state };
        }));
      case '/reset-daily':
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          state.lastFrenzyDate = ''; state.lastFrenzyClaimDate = '';
          state.lastDailyReset = ''; state.lastWeeklyReset = ''; state.lastFreeShardReset = '';
          state.streak.lastClaimDate = ''; state.freeShardsEarnedToday = 0;
          for (const quest of [...state.dailyQuests, ...state.weeklyQuests]) {
            quest.progress = 0; quest.claimed = false;
          }
          await game.save(state);
          return { ok: true, state };
        }));
      case '/queue-force-roll': {
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          const forcedRarity = Number(body.rarity);
          if (!Number.isSafeInteger(forcedRarity) || forcedRarity < 2 || forcedRarity > rules.MAX_ORB_RARITY) {
            throw new Error('Choose a whole-number rarity target between 2 and the maximum Orb rarity.');
          }
          const pending = Math.floor(Number(state.chainPatcherNextRarity ?? 0) || 0);
          if (state.adminGuaranteedRollQueued === true) {
            throw new Error('A guaranteed admin roll is already queued. Use it before queueing another.');
          }
          if (pending >= 2 && pending <= rules.MAX_ORB_RARITY) {
            throw new Error('Chain Patcher is already charged. Use it before queueing an admin guaranteed roll.');
          }
          if (pending !== 0) {
            throw new Error('Chain Patcher save data is invalid; repair it before queueing a guaranteed roll.');
          }
          state.chainPatcherNextRarity = forcedRarity;
          state.adminGuaranteedRollQueued = true;
          state.autoRollEnabled = false;
          await saveCurrentState(state);
          return { ok: true, queued: true, targetRarity: forcedRarity, state };
        }));
      }
      case '/force-roll': {
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          const forcedRarity = Math.max(2, integer(body.rarity, 1_000));
          const source = body.source === 'offline' ? 'offline' : 'online';
          const hasRandomValue = body.randomValue !== undefined;
          const randomValue = Number(body.randomValue);
          if (hasRandomValue && (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1)) {
            throw new Error('randomValue must be a number from 0 inclusive to 1 exclusive.');
          }
          const randomOverride = hasRandomValue ? () => randomValue : undefined;
          const exactRarity = body.exactRarity !== false;
          const result = await game.applyRolls(state, 1, forcedRarity, source, undefined, randomOverride, exactRarity);
          const now = Date.now();
          state.lastRollAt = now; state.lastSeenAt = now;
          await saveCurrentState(state);
          return {
            orb: result.bestOrb, batch: result.batch, totalValueGained: result.totalVal,
            totalRollValue: result.totalVal, coinsGained: result.coinsGained,
            shardsGained: result.shardsGained, xpGained: result.xpGained,
            state, rollsRemainingUntilNext: rules.cooldownMs(state), source,
            dramaticReveal: result.bestOrb.rarity >= 100, rollsProcessed: result.batch.length,
          };
        }));
      }
      case '/frenzy/start':
        return response(await game.startOrbFrenzy({
          bypassDailyLimit: true,
          forcedRarity: body.rarity == null ? undefined : Math.max(2, integer(body.rarity)),
          adminTest: true,
        }));
      case '/frenzy/claim': {
        const postId = String(body.postId ?? context.postId ?? '').trim();
        return response(await game.claimOrbFrenzy({ allowAdminTestOwner: true, postId }));
      }
      case '/frenzy/reset':
        return response(await withPlayerMutationLock(async () => {
          const state = await game.loadRaw();
          state.lastFrenzyDate = ''; state.lastFrenzyClaimDate = '';
          await game.save(state);
          return { ok: true, state };
        }));
      case '/moderation/self-game-ban':
      case '/moderation/ban': {
        requireCurrentProfile(body.username);
        const duration = body.durationDays === '' || body.durationDays == null ? undefined : Math.max(1, integer(body.durationDays));
        const ban = await game.banGameUser({
          userId: String(context.userId ?? ''), username: String(context.username ?? ''),
          durationDays: duration, reason: String(body.reason ?? 'GitHub Pages local test action').slice(0, 300),
          bannedBy: context.username ?? 'Pages Admin',
        });
        return response({ ok: true, action: 'game-ban', ban });
      }
      case '/moderation/unban': {
        const userId = requireCurrentProfile(body.username);
        return response({ ok: true, action: 'game-unban', username: context.username, userId, changed: await game.unbanGameUser(userId) });
      }
      case '/moderation/wipe-game':
      case '/moderation/hard-reset':
      case '/moderation/wipe-and-unban':
      case '/moderation/wipe-and-ban':
      case '/reset-all': {
        const userId = requireCurrentProfile(body.username || context.username);
        const shouldBan = path === '/moderation/wipe-and-ban';
        if (shouldBan) {
          await game.banGameUser({
            userId, username: String(context.username ?? ''),
            durationDays: body.durationDays === '' || body.durationDays == null ? undefined : Math.max(1, integer(body.durationDays)),
            reason: String(body.reason ?? 'GitHub Pages local test action').slice(0, 300),
            bannedBy: context.username ?? 'Pages Admin',
          });
        }
        const state = await resetCurrentProfile();
        if (path !== '/moderation/wipe-and-ban') await game.unbanGameUser(userId);
        return response({ ok: true, action: path.slice(1), username: context.username, userId, state });
      }
      default:
        return fail('Unknown Pages Admin Console endpoint: ' + path, 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown Pages Admin Console error.');
    const status = message.includes('current local test profile') ? 403 : 400;
    return fail(message, status);
  }
}

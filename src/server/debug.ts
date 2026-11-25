import { Router } from 'express';
import {
  applyRolls,
  markCodexRarityWrite,
  claimOrbFrenzy,
  loadRaw,
  save,
  listPlayers,
  startOrbFrenzy,
  getGameBanStatus,
  listGameBans,
  banGameUser,
  unbanGameUser,
  getDeveloperAnnouncement,
  setDeveloperAnnouncement,
  getPaymentDebugLogs,
  clearPaymentDebugLogs,
  getSaveDebugLogs,
  clearSaveDebugLogs,
  setGlobalBoosterDebugState,
  appendGlobalBoosterDebugLog,
  getGlobalBoosterDebugLogs,
  clearGlobalBoosterDebugLogs,
  appendGlobalBoosterActivationLog,
  getGlobalBoosterActivationLog,
  clearGlobalBoosterActivationLog,
  getCcuPeaks,
  setFakeCcuBonus,
  sendPushNotificationTest,
  getPlayerSpyLogs,
  clearPlayerSpyLogs,
  clearAllDiagnosticLogs,
  getFollowPromptStats,
  getPopupConfig,
  setPopupConfig,
  getPopupStats,
  getGlobalBoosters,
  getFakeCcuBonus,
  getOnlinePlayers,
  getPlayerActivityStats,
  getNotificationStats,
  startManualPushNotificationCampaign,
  getManualPushNotificationCampaign,
  getRollTicket,
  getCelestialAlignmentChoiceStats,
  forceCelestialAlignmentPromptForCurrentUser,
  readPlayerSaveForUser,
  createPlayerSaveWritePlanForUser,
  setGlobalMenuControl,
  getGlobalFeatureControls,
  setGlobalFeatureControl,
  executeLiveBalanceCommand,
  discardPlayerSaveWritePlan,
  cleanupPreviousPlayerSave,
} from './game.js';
import { withPlayerMutationLock, withPlayerMutationLockFor } from './player-lock.js';
import {
  createRedisLargeValueWritePlan,
  readRedisLargeValue,
  retireRedisLargeValue,
  discardRedisLargeValueWritePlan,
} from './redis-large-values.js';
import { adminCombatLabAction, getCombatSnapshot, getCombatSnapshotForUser, performCombatBeat } from './combat.js';
import { getRiftChallengeAdminStatus, adminGrantRiftProgress } from './rift-challenges.js';
import { COMBAT_MAX_DEPTH, COMBAT_SKILLS, combatBossLuckBonus, combatGearRarityOdds, combatGearStatBudgetMultiplier, combatOrbDamageMultiplier, combatRuneBonuses, combatRuneLuckMultiplier, combatRuneMajorAbilityStrengthPct, combatRuneScaledValue, combatStatsFor, combatTotalBossesBeaten, getEnemyForDungeonDepth, type CombatRuneBonuses, type CombatState } from '../shared/combat.js';
import { context, redis, reddit } from './devvit-mock.js';
import {
  setCommunityEventConfig,
  listGuildChatSpy,
  muteGuildChatUser,
  unmuteGuildChatUser,
  listChatReports,
  markChatReportRead,
  adminSetGuildAuthority,
  getPlayerGuildPerks,
  getPlayerGuildCombo,
  getCommunityEvent,
  leaderboards,
} from './social.js';
import {
  cooldownMs,
  createInitialState,
  addCoinAmount,
  calculateLevelFromXp,
  COSMETICS_LIST,
  PRESTIGE_UPGRADES,
  MASTERY_SKILLS,
  luckMultiplier,
  rollsPerActivation,
  offlineRollCap,
  effectiveOfflineTickMs,
  calculateAltarMultipliers,
  roundShardAmount,
  SHARD_PITY_ROLLS_TO_REWARD,
  calculateCosmicDust,
  calculatePrestigeDust,
  aftershockCriticalLuckBonus,
  critMultiplier,
  ROLL_SHARD_PROC_CHANCE_CAP,
  autoUnlocked,
  getLevelBenefits,
  LEVEL_MILESTONES,
  onlinePlayerLuckMultiplier,
  highestCodexChain,
  globalBoosterLuckMultiplier,
  globalBoosterSpeedMultiplier,
  globalBoosterCritChanceBonus,
  globalBoosterCritLuckBonus,
  guildComboLuckMultiplier,
  guildComboSpeedMultiplier,
  guildComboCritChanceBonus,
  guildComboCritLuckBonus,
  isPremiumBoosterActive,
  TIME_ENERGY_MAX_MS,
  MAX_ORB_RARITY,
  type PlayerState,
} from '../shared/game.js';
import { recordLeaderboard } from './social.js';
import { getImpressionDashboard } from './impressions.js';
import { estimateKnownRedisStorage, getServerMonitorSnapshot } from './server-monitor.js';
import { auditKnownRedisStorage } from './redis-storage-audit.js';
import { APP_VERSION } from '../shared/version.js';
import { applyAdminSaveCommands } from '../shared/admin-save-commands.js';
import { parseAdminCliCommand } from '../shared/admin-cli.js';

const DEBUG_USERS = new Set([
  'shadow_fen',
]);

// Bump this whenever the game-moderation transport changes so an admin can
// immediately tell whether the running Devvit bundle contains the Redis-only
// game-ban implementation instead of an older Reddit-moderation build.
const GAME_MODERATION_VERSION = 'redis-game-ban-v3';

function normalizeUsername(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^\/u\//i, '')
    .replace(/^u\//i, '')
    .toLowerCase();
}

export function isDebugUser(): boolean {
  return DEBUG_USERS.has(normalizeUsername(context.username));
}

export const debugRouter = Router();

// Never trust the client to decide whether the admin console is available.
// Every admin endpoint is protected server-side.
debugRouter.use((_req, res, next) => {
  if (!isDebugUser()) return res.status(404).json({ error: 'Not found.' });
  next();
});

debugRouter.get('/server-monitor', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json(getServerMonitorSnapshot());
});

debugRouter.get('/server-monitor/storage', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    res.json(await estimateKnownRedisStorage(redis));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Could not estimate Redis storage usage.' });
  }
});

debugRouter.get('/server-monitor/storage/audit', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    res.json(await auditKnownRedisStorage(redis));
  } catch (error) {
    console.error('[Redis Storage Audit] Read-only audit failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Could not audit Redis storage.' });
  }
});

debugRouter.get('/impressions', async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getImpressionDashboard());
  } catch (error) {
    console.error('[Admin Impressions] Failed to load aggregate metrics:', error);
    res.status(500).json({ error: 'Could not load impression analytics.' });
  }
});

function combatLabReport(state:CombatState) {
  const depths=[1,100,1000,10000,COMBAT_MAX_DEPTH];
  const projections=depths.map(depth=>{
    const projected={...state,depth,equipment:{...state.equipment}} as CombatState;
    const stats=combatStatsFor(projected);
    const enemy=getEnemyForDungeonDepth(state.dungeonId,depth);
    const maxOrbCritDamage=Math.round(stats.damage*combatOrbDamageMultiplier(Number.MAX_VALUE)*1.75);
    return {depth,damage:stats.damage,speed:stats.speed,maxHealth:stats.maxHealth,maxOrbCritDamage,enemyHp:enemy.maxHp,enemyDamage:enemy.damage,enemySpeed:enemy.speed};
  });
  const rarityOdds=combatGearRarityOdds();
  const statBudgets=Object.fromEntries([0,15,40,70,90,100].map(quality=>[String(quality),combatGearStatBudgetMultiplier(quality)]));
  const end=projections[projections.length-1]!;
  const speedProbeState={...state,inventory:[],equipment:Object.fromEntries(Object.keys(state.equipment).map(slot=>[slot,null])) as CombatState['equipment']};
  const speedAtDepthOne=combatStatsFor({...speedProbeState,depth:1}).speed;
  const speedAtMaxDepth=combatStatsFor({...speedProbeState,depth:COMBAT_MAX_DEPTH}).speed;
  const playerSpeedDepthInvariant=speedAtDepthOne===speedAtMaxDepth;
  const qualityValid=state.inventory.every(item=>Number.isFinite(item.quality)&&item.quality>=0&&item.quality<=100);
  const equipmentValid=Object.entries(state.equipment).every(([slot,id])=>!id||state.inventory.some(item=>item.id===id&&item.slot===slot));
  const runeRefsValid=(state.equippedRunes??[]).every(id=>state.runes.some(rune=>rune.id===id));
  const checks=[
    {label:'Gear quality is within 0–100',passed:qualityValid,detail:qualityValid?'All saved equipment has valid quality.':'Invalid equipment quality found.'},
    {label:'Equipped gear references are valid',passed:equipmentValid,detail:equipmentValid?'Every equipped item exists in the expected slot.':'A gear slot points to a missing or mismatched item.'},
    {label:'Equipped Rune references are valid',passed:runeRefsValid,detail:runeRefsValid?'Every equipped Rune exists in inventory.':'A Rune slot references a missing Rune.'},
    {label:'High gear grades are genuinely rare',passed:rarityOdds.Common>.85&&rarityOdds.Mythic<.01,detail:'Common '+(rarityOdds.Common*100).toFixed(2)+'% · Mythic '+(rarityOdds.Mythic*100).toFixed(2)+'% theoretical natural-drop odds.'},
    {label:'High-quality gear owns a larger stat budget',passed:combatGearStatBudgetMultiplier(90)>combatGearStatBudgetMultiplier(15)*5,detail:'90% quality is '+(combatGearStatBudgetMultiplier(90)/combatGearStatBudgetMultiplier(15)).toFixed(1)+'× the budget of 15% quality.'},
    {label:'Player Speed is independent of dungeon depth',passed:playerSpeedDepthInvariant,detail:'No-gear baseline: depth 1 '+Math.round(speedAtDepthOne).toLocaleString()+' → depth '+COMBAT_MAX_DEPTH.toLocaleString()+' '+Math.round(speedAtMaxDepth).toLocaleString()+' Speed.'},
    {label:'Late-game HP reaches millions',passed:end.maxHealth>=1_000_000,detail:'Depth 50,000 projection: '+Math.round(end.maxHealth).toLocaleString()+' maximum HP.'},
    {label:'Late-game high-orb crit damage reaches millions',passed:end.maxOrbCritDamage>=1_000_000,detail:'Depth 50,000 projection: '+Math.round(end.maxOrbCritDamage).toLocaleString()+' critical damage.'},
    {label:'Rune Major Ability data is valid',passed:state.runes.every(rune=>!rune.majorAbility||(typeof rune.majorAbility.name==='string'&&typeof rune.majorAbility.description==='string')),detail:state.runes.filter(rune=>rune.majorAbility).length+' Runes currently have Major Abilities.'},
  ];
  return {generatedAt:Date.now(),rarityOdds,statBudgets,projections,checks};
}
debugRouter.get('/combat-lab/state',async(_req,res)=>{
  try{const current=await getCombatSnapshot();res.json({...current,balance:combatLabReport(current.state)});}
  catch(error){res.status(500).json({error:error instanceof Error?error.message:'Could not inspect combat state.'});}
});
debugRouter.post('/combat-lab/action',async(req,res)=>{
  try{
    const action=String(req.body?.action??'');
    if(action==='force-beat'){
      const current=await getCombatSnapshot();
      const result=await performCombatBeat(current.state.sequence+1,'auto',undefined,true);
      return res.json({...result,labMessage:'Forced one immediate server-resolved beat. Normal gameplay cooldown rules remain enabled.'});
    }
    return res.json(await adminCombatLabAction(req.body));
  }catch(error){
    const message=error instanceof Error?error.message:'Combat Lab action failed.';
    return res.status(400).json({error:message});
  }
});

debugRouter.post('/diagnostic-logs/clear-all', async (_req, res) => {
  try {
    const result = await clearAllDiagnosticLogs();
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Could not clear diagnostic logs.' });
  }
});

debugRouter.get('/payment-logs', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit ?? 200) || 200)));
    res.json({ logs: await getPaymentDebugLogs(limit) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load payment debug logs.' });
  }
});

debugRouter.post('/payment-logs/clear', async (_req, res) => {
  try {
    await clearPaymentDebugLogs();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to clear payment debug logs.' });
  }
});

debugRouter.get('/save-logs', async (req, res) => {
  try {
    const username = String(req.query?.username ?? '').trim();
    const userId = username ? await resolveUserId(targetUsername(username)) : undefined;
    const limit = Math.max(1, Math.min(500, Math.floor(Number(req.query?.limit ?? 500) || 500)));
    const logs = await getSaveDebugLogs(userId, limit);
    res.json({
      username: username || null,
      userId: userId ?? null,
      logCount: logs.length,
      logs,
      generatedAt: Date.now(),
    });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to load save diagnostics.' });
  }
});

debugRouter.post('/save-logs/clear', async (_req, res) => {
  try {
    await clearSaveDebugLogs();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to clear save diagnostics.' });
  }
});

debugRouter.get('/global-boosters-log', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Math.floor(Number(req.query.limit ?? 100) || 100)));
    res.json({ logs: await getGlobalBoosterActivationLog(limit) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load Global Boosters Log.' });
  }
});

debugRouter.post('/global-boosters-log/clear', async (_req, res) => {
  try {
    await clearGlobalBoosterActivationLog();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to clear Global Boosters Log.' });
  }
});

debugRouter.get('/global-booster-logs', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(300, Math.floor(Number(req.query.limit ?? 300) || 300)));
    res.json({ logs: await getGlobalBoosterDebugLogs(limit) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load Global Booster logs.' });
  }
});

debugRouter.post('/global-booster-logs/clear', async (_req, res) => {
  try {
    await clearGlobalBoosterDebugLogs();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to clear Global Booster logs.' });
  }
});

debugRouter.post('/global-booster', async (req, res) => {
  try {
    const id = String(req.body?.id ?? '');
    const state = await setGlobalBoosterDebugState(id as any, req.body?.tier, req.body?.minutes);
    res.json({ ok: true, id, state });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to set Global Booster.' });
  }
});

debugRouter.post('/global-booster-credits/grant', async (req, res) => {
  const operationId = String(req.body?.operationId ?? '').trim();
  try {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)) {
      return res.status(400).json({ error: 'A valid grant operation ID is required.' });
    }
    const scope = String(req.body?.scope ?? 'user');
    const amount = Math.max(1, Math.min(1_000_000, Math.floor(Number(req.body?.amount) || 1)));

    if (scope === 'user') {
      const username = targetUsername(req.body?.username);
      const userId = await resolveUserId(username);
      const result = await grantGlobalBoosterCreditsToUser(userId, username, amount, operationId);
      await appendGlobalBoosterCreditGrantLog(scope, amount, operationId, [result]).catch(error => {
        console.error('[Admin Global Boosters] Grant succeeded but audit logging failed:', error);
      });
      return res.json({
        ok: true,
        scope,
        amount,
        operationId,
        affectedUsers: 1,
        results: [result],
      });
    }

    if (scope === 'online' || scope === 'all') {
      const manifest = await getOrCreateGlobalBoosterCreditGrantManifest(
        operationId,
        scope,
        amount,
      );
      const targetPlayers = manifest.userIds;
      const results: Array<{ userId: string; username: string; before: number; after: number; alreadyApplied?: boolean }> = [];
      const failures: Array<{ userId: string; username: string; error: string }> = [];

      for (const player of targetPlayers) {
        try {
          results.push(await grantGlobalBoosterCreditsToUser(player.userId, player.username, amount, operationId));
        } catch (error) {
          failures.push({
            userId: player.userId,
            username: player.username,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await appendGlobalBoosterCreditGrantLog(scope, amount, operationId, results, failures).catch(error => {
        console.error('[Admin Global Boosters] Batch completed but audit logging failed:', error);
      });
      const response = {
        ok: failures.length === 0,
        partial: failures.length > 0,
        scope,
        amount,
        operationId,
        affectedUsers: results.length,
        attemptedUsers: targetPlayers.length,
        results,
        failures,
      };
      if (failures.length > 0) return res.status(207).json(response);
      return res.json(response);
    }

    return res.status(400).json({ error: 'Invalid Global Booster grant scope.' });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to grant free Global Booster credits.', operationId: operationId || null });
  }
});

debugRouter.get('/follow-reward', async (_req, res) => {
  try {
    res.json(await getFollowPromptStats());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load follow statistics.' });
  }
});

debugRouter.get('/ccu', async (_req, res) => {
  try {
    res.json(await getCcuPeaks());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load CCU statistics.' });
  }
});

debugRouter.post('/ccu/fake', async (req, res) => {
  try {
    const bonus = await setFakeCcuBonus(Number(req.body?.bonus ?? 0));
    res.json({ ok: true, fakeCcuBonus: bonus });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to set fake CCU.' });
  }
});

debugRouter.post('/push-test', async (_req, res) => {
  try {
    await sendPushNotificationTest();
    res.json({ ok: true, message: 'Push test notification enqueued.' });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to send push test notification.' });
  }
});

debugRouter.get('/notifications/stats', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    res.json(await getNotificationStats());
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'Could not load notification audience statistics.' });
  }
});

debugRouter.post('/notifications/send', async (req, res) => {
  try {
    const result = await startManualPushNotificationCampaign();
    res.status(202).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not start notification broadcast.' });
  }
});

debugRouter.get('/notifications/campaign/:id', async (req, res) => {
  try {
    const campaign = await getManualPushNotificationCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Notification campaign was not found.' });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load notification campaign.' });
  }
});

debugRouter.get('/follow-stats', async (_req, res) => {
  try {
    res.json(await getFollowPromptStats());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load follow statistics.' });
  }
});

debugRouter.get('/popups', async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const [config, stats] = await Promise.all([getPopupConfig(), getPopupStats()]);
    res.json({ config, stats, generatedAt: Date.now() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load popup analytics.' });
  }
});

debugRouter.get('/rift/status', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const username = targetUsername(req.query?.username);
    const userId = await resolveUserId(username);
    res.json({ username, userId, ...(await getRiftChallengeAdminStatus(userId)) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not inspect Rift progression.' });
  }
});

debugRouter.post('/rift/grant', async (req, res) => {
  try {
    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    const result = await adminGrantRiftProgress(userId, {
      points: req.body?.points,
      minutes: req.body?.minutes,
    });
    res.json({ ok: true, username, userId, ...result });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not grant Rift progress.' });
  }
});

debugRouter.post('/popups/config', async (req, res) => {
  try {
    const config = await setPopupConfig(req.body && typeof req.body === 'object' ? req.body : {});
    res.json({ ok: true, config, stats: await getPopupStats() });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to update popup settings.' });
  }
});

debugRouter.get('/alignment/stats', async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...(await getCelestialAlignmentChoiceStats()), generatedAt: Date.now() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Could not load Alignment choice statistics.' });
  }
});

debugRouter.post('/alignment/force', async (_req, res) => {
  try {
    res.json(await forceCelestialAlignmentPromptForCurrentUser());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not queue the Alignment chooser.' });
  }
});

debugRouter.get('/status', async (_req, res) => {
  res.json({
    isAdmin: true,
    username: context.username ?? null,
    userId: context.userId ?? null,
    subredditName: context.subredditName ?? null,
    postId: context.postId ?? null,
    gameModerationVersion: GAME_MODERATION_VERSION,
    gameBan: await getGameBanStatus(),
  });
});

function finiteInteger(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  return Math.max(0, finiteInteger(value, fallback));
}

function targetUsername(value: unknown): string {
  const name = normalizeUsername(value);
  if (!name) throw new Error('A Reddit username is required.');
  return name;
}

const GLOBAL_BOOSTER_CREDIT_MAX = Number.MAX_SAFE_INTEGER;
const GLOBAL_BOOSTER_CREDIT_BATCH_PREFIX = 'io:admin-global-booster-credit-batch:';

type GlobalBoosterCreditGrantScope = 'online' | 'all';
interface GlobalBoosterCreditGrantManifest {
  version: 1;
  operationId: string;
  scope: GlobalBoosterCreditGrantScope;
  amount: number;
  createdAt: number;
  userIds: Array<{ userId: string; username: string }>;
}

function parseAdminPlayerSave(raw: unknown): Record<string, any> {
  if (raw == null) return createInitialState() as unknown as Record<string, any>;
  if (typeof raw !== 'string') throw new Error('The target player save could not be read safely.');

  const unwrap = (value: unknown, depth = 0): Record<string, any> | null => {
    if (depth > 6 || value == null) return null;

    if (typeof value === 'string') {
      try {
        return unwrap(JSON.parse(value), depth + 1);
      } catch {
        return null;
      }
    }
    if (typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const looksLikePlayerState =
      'coins' in record &&
      'shards' in record &&
      'totalRolls' in record;

    if (looksLikePlayerState) {
      const validCoreState =
        typeof record.coins === 'number' &&
        Number.isFinite(record.coins) &&
        record.coins >= 0 &&
        typeof record.shards === 'number' &&
        Number.isFinite(record.shards) &&
        record.shards >= 0 &&
        record.shards <= Number.MAX_SAFE_INTEGER &&
        Math.abs(record.shards * 1_000 - Math.round(record.shards * 1_000)) < 1e-6 &&
        Number.isSafeInteger(record.totalRolls) &&
        Number(record.totalRolls) >= 0 &&
        (
          record.stateRevision == null ||
          (Number.isSafeInteger(record.stateRevision) && Number(record.stateRevision) >= 0)
        );
      return validCoreState ? record as Record<string, any> : null;
    }

    for (const key of ['value', 'state', 'player', 'data', 'payload', 'result']) {
      if (!(key in record)) continue;
      const nested = unwrap(record[key], depth + 1);
      if (nested) return nested;
    }
    return null;
  };

  const state = unwrap(raw);
  if (!state) throw new Error('The target player save could not be read safely.');
  return state;
}

async function readPlayerSaveForAdmin(userId: string): Promise<Record<string, any>> {
  const storedRaw = await redis.get('player:' + userId);
  const raw = await readPlayerSaveForUser(userId, storedRaw);
  return parseAdminPlayerSave(raw);
}

debugRouter.get('/execute-as/save', async (req, res) => {
  try {
    const username = targetUsername(req.query.username);
    const userId = await resolveUserId(username);
    const state = await withPlayerMutationLockFor(userId, async () => {
      const save = await readPlayerSaveForAdmin(userId);
      const visible = { ...save };
      // The Codex is stored separately in Redis hashes. Never imply that this
      // partial player-save projection contains the collection itself.
      delete visible.collection;
      return visible;
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json({ ok: true, username, userId, save: state, codexStoredSeparately: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load the target player save.';
    res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
  }
});

debugRouter.post('/cli/execute', async (req, res) => {
  try {
    const parsed = parseAdminCliCommand(String(req.body?.command ?? ''));
    if (parsed.kind === 'balance') {
      const balance = await executeLiveBalanceCommand(parsed, context.username ?? 'Developer');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.json({ ok: true, scope: 'everyone', balance });
    }
    if (parsed.kind === 'menus') {
      const menuControl = await setGlobalMenuControl(
        parsed.enabled,
        parsed.reason,
        context.username ?? 'Developer',
      );
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.json({ ok: true, scope: 'everyone', menuControl });
    }
    if (parsed.kind === 'feature') {
      const featureControl = await setGlobalFeatureControl(
        parsed.feature, parsed.enabled, parsed.reason, context.username ?? 'Developer',
      );
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.json({ ok: true, scope: 'everyone', featureControl });
    }
    if (parsed.kind === 'feature-list') {
      const featureControls = await getGlobalFeatureControls();
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.json({ ok: true, scope: 'everyone', featureControls });
    }
    if (parsed.kind === 'announcement') {
      const announcement = await setDeveloperAnnouncement(
        parsed.message,
        context.username ?? 'Developer',
      );
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.json({ ok: true, scope: 'everyone', announcement });
    }

    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    const playerKey = 'player:' + userId;
    const generationKey = 'player-generation:' + userId;
    const result = await withPlayerMutationLockFor(userId, async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const txn = await redis.watch(playerKey, generationKey);
        let transactionClosed = false;
        let writePlan: Awaited<ReturnType<typeof createPlayerSaveWritePlanForUser>> | null = null;
        let writeCommitted = false;
        try {
          const generationRaw = await redis.get(generationKey);
          const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
          const storedRaw = await redis.get(playerKey);
          const raw = await readPlayerSaveForUser(userId, storedRaw);
          const state = parseAdminPlayerSave(raw);
          const storedGeneration = Math.max(0, Number(state.saveGeneration ?? generation) || 0);
          if (storedGeneration !== generation) {
            throw new Error('The target player save generation changed. Reload the target before executing commands.');
          }
          const currentRevision = Number(state.stateRevision ?? 0);
          if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || currentRevision >= Number.MAX_SAFE_INTEGER) {
            throw new Error('The target player save revision is invalid or exhausted.');
          }
          state.username = String(state.username || username).slice(0, 100);
          state.saveGeneration = generation;
          const applied = applyAdminSaveCommands(state, parsed.commands);
          applied.state.username = String(state.username || username).slice(0, 100);
          applied.state.saveGeneration = generation;
          applied.state.stateRevision = currentRevision + 1;

          writePlan = await createPlayerSaveWritePlanForUser(
            userId,
            applied.state as unknown as PlayerState,
          );
          await txn.multi();
          await txn.set(playerKey, writePlan.storedValue);
          const committed = await txn.exec();
          transactionClosed = true;
          if (committed !== null) {
            writeCommitted = true;
            await cleanupPreviousPlayerSave(userId, storedRaw);
            if (parsed.invalidateRollTicket) await redis.del('io:roll-ticket:' + userId);
            console.info('[Admin CLI]', JSON.stringify({
              actor: context.username ?? 'unknown',
              target: username,
              targetUserId: userId,
              stateRevision: applied.state.stateRevision,
              commands: applied.results.map(item => ({ action: item.action, path: item.path })),
              invalidatedRollTicket: parsed.invalidateRollTicket,
            }));
            return {
              ok: true,
              scope: 'player',
              username,
              userId,
              stateRevision: applied.state.stateRevision,
              results: applied.results,
              invalidatedRollTicket: parsed.invalidateRollTicket,
            };
          }
        } finally {
          if (!transactionClosed) await txn.unwatch().catch(() => undefined);
          if (writePlan && !writeCommitted) await discardPlayerSaveWritePlan(writePlan);
        }
      }
      throw new Error('The target player save changed repeatedly. No commands were committed; retry the command.');
    });

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Admin CLI command failed.';
    res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
  }
});

debugRouter.post('/execute-as/execute', async (req, res) => {
  let userId = '';
  try {
    const username = targetUsername(req.body?.username);
    const commands = String(req.body?.commands ?? '');
    userId = await resolveUserId(username);
    const playerKey = 'player:' + userId;
    const generationKey = 'player-generation:' + userId;
    const result = await withPlayerMutationLockFor(userId, async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const txn = await redis.watch(playerKey, generationKey);
        let transactionClosed = false;
        let writePlan: Awaited<ReturnType<typeof createPlayerSaveWritePlanForUser>> | null = null;
        let writeCommitted = false;
        try {
          const generationRaw = await redis.get(generationKey);
          const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
          const storedRaw = await redis.get(playerKey);
          const raw = await readPlayerSaveForUser(userId, storedRaw);
          const state = parseAdminPlayerSave(raw);
          const storedGeneration = Math.max(0, Number(state.saveGeneration ?? generation) || 0);
          if (storedGeneration !== generation) {
            throw new Error('The target player save generation changed. Reload the save before executing commands.');
          }

          const currentRevision = Number(state.stateRevision ?? 0);
          if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || currentRevision >= Number.MAX_SAFE_INTEGER) {
            throw new Error('The target player save revision is invalid or exhausted.');
          }
          state.username = String(state.username || username).slice(0, 100);
          state.saveGeneration = generation;
          const applied = applyAdminSaveCommands(state, commands);
          applied.state.username = String(state.username || username).slice(0, 100);
          applied.state.saveGeneration = generation;
          applied.state.stateRevision = currentRevision + 1;

          writePlan = await createPlayerSaveWritePlanForUser(
            userId,
            applied.state as unknown as PlayerState,
          );
          await txn.multi();
          await txn.set(playerKey, writePlan.storedValue);
          const committed = await txn.exec();
          transactionClosed = true;
          if (committed !== null) {
            writeCommitted = true;
            await cleanupPreviousPlayerSave(userId, storedRaw);
            console.info('[Admin Execute As]', JSON.stringify({
              actor: context.username ?? 'unknown',
              target: username,
              targetUserId: userId,
              stateRevision: applied.state.stateRevision,
              commands: applied.results.map(item => ({ action: item.action, path: item.path })),
            }));
            return {
              ok: true,
              username,
              userId,
              stateRevision: applied.state.stateRevision,
              results: applied.results,
              codexStoredSeparately: true,
            };
          }
        } finally {
          if (!transactionClosed) await txn.unwatch().catch(() => undefined);
          if (writePlan && !writeCommitted) await discardPlayerSaveWritePlan(writePlan);
        }
      }
      throw new Error('The target player save changed repeatedly. No commands were committed; reload and retry.');
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Execute As failed.';
    res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
  }
});

function parseGlobalBoosterCreditGrantManifest(
  raw: unknown,
  operationId: string,
  scope: GlobalBoosterCreditGrantScope,
  amount: number,
): GlobalBoosterCreditGrantManifest {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('The saved Global Booster batch manifest is corrupted; refusing to change recipients.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The saved Global Booster batch manifest is invalid; refusing to change recipients.');
  }
  const record = value as Record<string, unknown>;
  const rows = record.userIds;
  if (
    record.version !== 1 ||
    record.operationId !== operationId ||
    record.scope !== scope ||
    record.amount !== amount ||
    !Number.isSafeInteger(record.createdAt) ||
    !Array.isArray(rows) ||
    !rows.every(row =>
      row !== null &&
      typeof row === 'object' &&
      !Array.isArray(row) &&
      typeof (row as Record<string, unknown>).userId === 'string' &&
      String((row as Record<string, unknown>).userId).trim().length > 0 &&
      typeof (row as Record<string, unknown>).username === 'string' &&
      String((row as Record<string, unknown>).username).trim().length > 0
    )
  ) {
    throw new Error('The saved Global Booster batch manifest does not match this operation; refusing to change recipients.');
  }
  return {
    version: 1,
    operationId,
    scope,
    amount,
    createdAt: record.createdAt as number,
    userIds: (rows as Array<{ userId: string; username: string }>).map(row => ({
      userId: row.userId.trim(),
      username: normalizeUsername(row.username),
    })),
  };
}

async function getOrCreateGlobalBoosterCreditGrantManifest(
  operationId: string,
  scope: GlobalBoosterCreditGrantScope,
  amount: number,
): Promise<GlobalBoosterCreditGrantManifest> {
  const manifestKey = GLOBAL_BOOSTER_CREDIT_BATCH_PREFIX + encodeURIComponent(operationId);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const existingStored = await redis.get(manifestKey);
    const existing = await readRedisLargeValue(manifestKey, existingStored);
    if (existing != null) {
      return parseGlobalBoosterCreditGrantManifest(existing, operationId, scope, amount);
    }

    const txn = await redis.watch(manifestKey);
    let transactionClosed = false;
    let writePlan: Awaited<ReturnType<typeof createRedisLargeValueWritePlan>> | null = null;
    let writeCommitted = false;
    try {
      const watchedStored = await redis.get(manifestKey);
      const watched = await readRedisLargeValue(manifestKey, watchedStored);
      if (watched != null) {
        await txn.unwatch();
        transactionClosed = true;
        return parseGlobalBoosterCreditGrantManifest(watched, operationId, scope, amount);
      }

      const players = await listRegisteredPlayerIds();
    const selectedPlayers = scope === 'online'
      ? players.filter(player => player.active)
      : players;
    const manifest: GlobalBoosterCreditGrantManifest = {
      version: 1,
      operationId,
      scope,
      amount,
      createdAt: Date.now(),
      userIds: selectedPlayers.map(player => ({
        userId: String(player.userId ?? '').trim(),
        username: normalizeUsername(player.username),
      })).filter(player => player.userId.length > 0 && player.username.length > 0),
    };

      writePlan = await createRedisLargeValueWritePlan(manifestKey, JSON.stringify(manifest));
      await txn.multi();
      await txn.set(manifestKey, writePlan.storedValue);
      const committed = await txn.exec();
      transactionClosed = true;
      if (committed !== null) {
        writeCommitted = true;
        await retireRedisLargeValue(manifestKey, watchedStored);
        return manifest;
      }
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
      if (writePlan && !writeCommitted) await discardRedisLargeValueWritePlan(writePlan);
    }
  }
  throw new Error('Could not persist the Global Booster batch recipient manifest. Retry the same operation ID.');
}

async function grantGlobalBoosterCreditsToUser(
  userId: string,
  username: string,
  amount: number,
  operationId: string,
): Promise<{ userId: string; username: string; before: number; after: number; alreadyApplied?: boolean }> {
  const id = String(userId ?? '').trim();
  if (!id) throw new Error('The target player ID is missing.');
  const safeUsername = targetUsername(username);
  const safeAmount = Math.max(1, Math.min(GLOBAL_BOOSTER_CREDIT_MAX, Math.floor(Number(amount) || 1)));
  const playerKey = 'player:' + id;
  const generationKey = 'player-generation:' + id;
  // Keep idempotency receipts outside the player save so a wipe cannot erase
  // the proof that this admin operation has already granted the recipient.
  const receiptKey = 'io:admin-global-booster-credit-grant:' +
    encodeURIComponent(operationId) + ':' + encodeURIComponent(id);

  return withPlayerMutationLockFor(id, async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const txn = await redis.watch(playerKey, generationKey, receiptKey);
      const generationRaw = await redis.get(generationKey);
      const generation = Math.max(0, Number.parseInt(String(generationRaw ?? '0'), 10) || 0);
      const storedRaw = await redis.get(playerKey);
      const raw = await readPlayerSaveForUser(id, storedRaw);
      const rawReceipt = await redis.get(receiptKey);

      if (rawReceipt != null) {
        let previousReceipt: any;
        try {
          previousReceipt = typeof rawReceipt === 'string' ? JSON.parse(rawReceipt) : rawReceipt;
        } catch {
          await txn.unwatch();
          throw new Error('The grant idempotency receipt is corrupted; refusing a possibly duplicate grant.');
        }
        if (
          !previousReceipt ||
          typeof previousReceipt !== 'object' ||
          !Number.isSafeInteger(previousReceipt.amount) ||
          !Number.isSafeInteger(previousReceipt.before) ||
          !Number.isSafeInteger(previousReceipt.after)
        ) {
          await txn.unwatch();
          throw new Error('The grant idempotency receipt is malformed; refusing a possibly duplicate grant.');
        }
        await txn.unwatch();
        if (previousReceipt.amount !== safeAmount) {
          throw new Error('This grant operation ID was already used with a different amount.');
        }
        return {
          userId: id,
          username: safeUsername,
          before: previousReceipt.before,
          after: previousReceipt.after,
          alreadyApplied: true,
        };
      }

      let state: Record<string, any>;
      try {
        state = parseAdminPlayerSave(raw);
      } catch (error) {
        await txn.unwatch();
        throw error;
      }

      if (raw == null) {
        // A missing save follows loadRaw()'s fresh-state path. The watched
        // generation key is authoritative after a wipe; do not strand admin
        // grants on an otherwise valid account whose save has not been recreated.
        state.saveGeneration = generation;
        state.stateRevision = 0;
      }

      const storedGeneration = Math.max(0, Number(state.saveGeneration ?? generation) || 0);
      if (storedGeneration !== generation) {
        await txn.unwatch();
        throw new Error('The target player save changed generation. Refresh the admin console and try again.');
      }

      const rawCredits = state.globalBoosterCredits ?? 0;
      if (!Number.isSafeInteger(rawCredits) || Number(rawCredits) < 0 || Number(rawCredits) > GLOBAL_BOOSTER_CREDIT_MAX) {
        await txn.unwatch();
        throw new Error('The target player Global Booster credit balance is invalid; no grant was applied.');
      }
      const before = Number(rawCredits);
      const after = before + safeAmount;
      if (!Number.isSafeInteger(after) || after > GLOBAL_BOOSTER_CREDIT_MAX) {
        await txn.unwatch();
        throw new Error('The target player does not have enough credit capacity for the full requested grant.');
      }
      state.globalBoosterCredits = after;
      state.username = safeUsername;
      state.saveGeneration = generation;
      const currentRevision = Number(state.stateRevision ?? 0);
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || currentRevision >= Number.MAX_SAFE_INTEGER) {
        await txn.unwatch();
        throw new Error('The target player save revision is invalid; no grant was applied.');
      }
      state.stateRevision = currentRevision + 1;

      const receipt = JSON.stringify({ amount: safeAmount, before, after, createdAt: Date.now() });
      let writePlan: Awaited<ReturnType<typeof createPlayerSaveWritePlanForUser>> | null = null;
      let transactionClosed = false;
      let writeCommitted = false;
      try {
        writePlan = await createPlayerSaveWritePlanForUser(
          id,
          state as unknown as import('../shared/game.js').PlayerState,
        );
        await txn.multi();
        await txn.set(playerKey, writePlan.storedValue);
        await txn.set(receiptKey, receipt);
        const committed = await txn.exec();
        transactionClosed = true;
        if (committed !== null) {
          writeCommitted = true;
          await cleanupPreviousPlayerSave(id, storedRaw);
          return { userId: id, username: safeUsername, before, after };
        }
      } finally {
        if (!transactionClosed) await txn.unwatch().catch(() => undefined);
        if (writePlan && !writeCommitted) await discardPlayerSaveWritePlan(writePlan);
      }
    }

    throw new Error('The target player save changed too frequently. Retry the same grant operation.');
  });
}

async function appendGlobalBoosterCreditGrantLog(
  scope: string,
  amount: number,
  operationId: string,
  results: Array<{ userId: string; username: string; before: number; after: number; alreadyApplied?: boolean }>,
  failures: Array<{ userId: string; username: string; error: string }> = [],
): Promise<void> {
  await appendGlobalBoosterDebugLog('admin:grant-credits', {
    scope,
    amount,
    operationId,
    affectedUsers: results.length,
    replayedUsers: results.filter(result => result.alreadyApplied).length,
    failedUsers: failures.length,
    usernames: results.slice(0, 25).map(result => result.username),
    failures: failures.slice(0, 25),
  });
}

async function listRegisteredPlayerIds(): Promise<Array<{ userId: string; username: string; active: boolean }>> {
  const players = await listPlayers();
  return players
    .filter(player => !player.legacyOnly && Boolean(player.userId))
    .map(player => ({
      userId: player.userId,
      username: player.username,
      active: player.active,
    }));
}


async function removeLeaderboardEntry(username: string): Promise<void> {
  const leaderboardKey = 'io:leaderboard';
  const normalized = normalizeUsername(username);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const txn = await redis.watch(leaderboardKey);
    const storedRaw = await redis.get(leaderboardKey);
    if (storedRaw == null) {
      await txn.unwatch();
      return;
    }

    let raw: string | null;
    let parsed: unknown;
    try {
      raw = await readRedisLargeValue(leaderboardKey, storedRaw);
      parsed = raw == null ? null : JSON.parse(raw);
    } catch {
      await txn.unwatch();
      throw new Error('Leaderboard data is corrupted; refusing to replace it during account cleanup.');
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every(entry => entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.username === 'string')
    ) {
      await txn.unwatch();
      throw new Error('Leaderboard data is malformed; refusing to replace it during account cleanup.');
    }

    const board = parsed as Array<{ username: string }>;
    const next = board.filter(entry => normalizeUsername(entry.username) !== normalized);
    if (next.length === board.length) {
      await txn.unwatch();
      return;
    }

    let writePlan: Awaited<ReturnType<typeof createRedisLargeValueWritePlan>> | null = null;
    let transactionClosed = false;
    let writeCommitted = false;
    try {
      writePlan = await createRedisLargeValueWritePlan(leaderboardKey, JSON.stringify(next));
      await txn.multi();
      await txn.set(leaderboardKey, writePlan.storedValue);
      const committed = await txn.exec();
      transactionClosed = true;
      if (committed !== null) {
        writeCommitted = true;
        await retireRedisLargeValue(leaderboardKey, storedRaw);
        return;
      }
    } finally {
      if (!transactionClosed) await txn.unwatch().catch(() => undefined);
      if (writePlan && !writeCommitted) await discardRedisLargeValueWritePlan(writePlan);
    }
  }

  throw new Error('Leaderboard changed too frequently during account cleanup. Please retry.');
}

async function resolveUserId(username: string): Promise<string> {
  if (normalizeUsername(context.username) === normalizeUsername(username) && context.userId) {
    return context.userId;
  }
  const user = await reddit.getUserByUsername(username);
  const id = user?.id;
  if (!id) throw new Error(`Reddit user "u/${username}" was not found.`);
  return id;
}

export async function resetPlayerGenerationAndSave(
  userId: string,
  username: string,
): Promise<{ state: ReturnType<typeof createInitialState>; generation: number }> {
  const generationKey = `player-generation:${userId}`;
  const playerKey = `player:${userId}`;
  const combatStateKey = `infinity-orbs:combat:${userId}`;
  const riftArchiveKey = `io:rift-challenge:v1:${userId}`;

  // Reset the main save and its independent Combat save in one transaction.
  // Watching the combat key prevents a concurrent combat write from being silently overwritten.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const txn = await redis.watch(generationKey, playerKey, combatStateKey, riftArchiveKey);
    const rawGeneration = await redis.get(generationKey);
    const previousPlayerSaveRaw = await redis.get(playerKey);
    const previousCombatStateRaw = await redis.get(combatStateKey);
    const parsedGeneration = Number.parseInt(String(rawGeneration ?? '0'), 10);
    const currentGeneration =
      Number.isSafeInteger(parsedGeneration) && parsedGeneration >= 0
        ? parsedGeneration
        : 0;

    if (currentGeneration >= Number.MAX_SAFE_INTEGER) {
      await txn.unwatch();
      throw new Error('Player save generation is exhausted and cannot be reset safely.');
    }

    const generation = currentGeneration + 1;
    const fresh = createInitialState();
    fresh.username = username;
    fresh.saveGeneration = generation;
    fresh.stateRevision = 0;

    await txn.multi();
    await txn.set(generationKey, String(generation));
    await txn.set(playerKey, JSON.stringify(fresh));
    await txn.del(combatStateKey);
    await txn.del(riftArchiveKey);
    const committed = await txn.exec();
    if (committed !== null) {
      await cleanupPreviousPlayerSave(userId, previousPlayerSaveRaw).catch(error => {
        console.warn('[Wipe] Previous player-save chunks could not be retired:', error);
      });
      await retireRedisLargeValue(combatStateKey, previousCombatStateRaw).catch(error => {
        console.warn('[Wipe] Previous Combat chunks could not be retired:', error);
      });
      return { state: fresh, generation };
    }
  }

  throw new Error('Player data changed repeatedly while resetting. Please retry.');
}

async function wipeUser(username: string, clearBanAfterWipe = true): Promise<{ username: string; userId: string; generation: number }> {
  const name = targetUsername(username);
  const userId = await resolveUserId(name);
  const playerSaveKey = `player:${userId}`;

  return withPlayerMutationLockFor(userId, async () => {
  const { generation } = await resetPlayerGenerationAndSave(userId, name);
  // Leaderboards are projections. A damaged projection must not make an already
  // durable account reset appear to fail or prevent the unban step from running.
  await removeLeaderboardEntry(name).catch(error => {
    console.error('[Wipe] Leaderboard cleanup failed after the player reset committed:', error);
  });
  // A plain wipe is a full account reset. Remove any existing game ban so the
  // wiped player can immediately start a fresh save. The wipe-and-ban route passes
  // false here because it commits the new ban before the reset begins.
  if (clearBanAfterWipe) await unbanGameUser(userId);

  const persisted = await redis.get(playerSaveKey);
  if (persisted == null) {
    throw new Error(`Wipe failed: player save for u/${name} was not persisted.`);
  }

  return { username: name, userId, generation };
  });
}

function setMaxProgression(s: Awaited<ReturnType<typeof loadRaw>>): void {
  const now = Date.now();

  s.coins = 1_000_000_000_000;
  s.shards = 100_000;
  s.cosmicDust = 100_000;
  s.xp = 1_000_000_000;
  s.level = calculateLevelFromXp(s.xp).level;
  s.totalRolls = 1_000_000;
  s.totalCrits = 100_000;
  s.lifetimeCoins = Math.max(s.lifetimeCoins ?? 0, s.coins);
  s.lifetimeShards = Math.max(s.lifetimeShards ?? 0, s.shards);
  s.highestRarity = 100_000_000;
  s.collectionValue = 1_000_000_000_000;
  s.lifetimeCollectionValue = Math.max(s.lifetimeCollectionValue ?? 0, s.collectionValue);
  s.offlineRolls = 1_000;
  s.rollsSinceBest = 0;
  s.prestigeCount = 10;
  s.masteryPoints = 10_000;
  s.currentRunRolls = s.totalRolls;
  s.questsCompleted = 1_000;
  s.guildContribution = Math.max(s.guildContribution ?? 0, 1_000_000);
  s.lastRollAt = 0;
  s.lastSeenAt = now;
  s.lastFrenzyDate = '';
  s.lastFrenzyClaimDate = '';
  s.turboRollUntil = now + 24 * 60 * 60 * 1000;

  s.upgrades = {
    speed: 20,
    multi: 20,
    clusterRoll: 20,
    auto: 1,
    luck: 20,
    coinBonus: 20,
    shardChance: 20,
    xpBonus: 20,
    critChance: 20,
    critPower: 20,
    offlineRate: 8,
    valueBonus: 20,
    offlineFoundry: 10,
    orbFingers: 15,
    criticalDividend: 20,
  };

  for (const [id, info] of Object.entries(PRESTIGE_UPGRADES)) {
    s.prestigeUpgrades[id as keyof typeof s.prestigeUpgrades] = info.maxLevel;
  }
  for (const [id, info] of Object.entries(MASTERY_SKILLS)) {
    (s.masterySkills as Record<string, number>)[id] = info.maxLevel;
  }

  s.automations = {
    autoQuestClaim: true,
    autoStreakClaim: true,
    autoCommunityClaim: true,
    autoOfflineClaim: true,
    autoUpgrade: true,
  };

  s.activeBoosters = {
    fortune: now + 60 * 60 * 1000,
    hyperdrive: now + 60 * 60 * 1000,
    barrage: now + 60 * 60 * 1000,
    prosperity: now + 60 * 60 * 1000,
    ascension: now + 60 * 60 * 1000,
  };

  s.unlockedCosmetics = COSMETICS_LIST.map(c => c.id);
  s.activeCosmetic = s.unlockedCosmetics[0] ?? 'default';

  for (const rarity of [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000]) {
    s.collection[String(rarity)] = 1_000;
  }

  for (const quest of [...s.dailyQuests, ...s.weeklyQuests]) {
    quest.unlocked = true;
    quest.progress = quest.target;
    quest.claimed = false;
  }
}

// Read-only identity/context endpoint.
debugRouter.get('/announcement', async (_req, res) => {
  try {
    res.json(await getDeveloperAnnouncement());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load developer announcement.' });
  }
});

debugRouter.post('/announcement', async (req, res) => {
  try {
    const announcement = await setDeveloperAnnouncement(
      String(req.body?.message ?? ''),
      context.username ?? 'Developer',
    );
    res.json({ announcement });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to update developer announcement.' });
  }
});

debugRouter.get('/chat-reports', async (_req, res) => {
  try {
    res.json(await listChatReports());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load chat reports.' });
  }
});

debugRouter.post('/chat-reports/read', async (req, res) => {
  try {
    res.json(await markChatReportRead(String(req.body?.reportId ?? '')));
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to mark chat report as read.' });
  }
});

debugRouter.post('/guild-authority', async (req, res) => {
  try {
    const guildId = String(req.body?.guildId ?? '').trim();
    const authority = req.body?.authority;
    if (authority !== 'owner' && authority !== 'trusted') {
      return res.status(400).json({ error: 'Authority must be owner or trusted.' });
    }
    const result = await adminSetGuildAuthority(guildId, authority);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to change admin Guild authority.' });
  }
});

debugRouter.get('/guild-chat-spy', async (_req, res) => {
  try {
    res.json(await listGuildChatSpy());
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load Guild Chat spy data.' });
  }
});

debugRouter.post('/guild-chat/mute', async (req, res) => {
  try {
    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    const mute = await muteGuildChatUser(userId, username, context.username ?? 'shadow_fen');
    res.json({ ok: true, action: 'guild-chat-mute', mute });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to mute Guild Chat user.' });
  }
});

debugRouter.post('/guild-chat/unmute', async (req, res) => {
  try {
    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    const changed = await unmuteGuildChatUser(userId);
    res.json({ ok: true, action: 'guild-chat-unmute', username, userId, changed });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Failed to unmute Guild Chat user.' });
  }
});

debugRouter.get('/players', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    const [players, activity, notificationStats] = await Promise.all([
      listPlayers(),
      getPlayerActivityStats(),
      getNotificationStats().catch(error => {
        console.warn('[Admin Notifications] Audience count unavailable while loading player list.', error);
        return null;
      }),
    ]);
    res.json({ players, activity, notificationStats });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load player list.' });
  }
});
/**
 * Read-only diagnostic snapshot for the leaderboard and admin player list.
 * Includes counts and a few redacted examples, never raw Redis values or full IDs.
 * This route is behind the server-side shadow_fen admin guard above.
 */
debugRouter.get('/leaderboard-diagnostics', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const generatedAt = Date.now();
  const parseStoredValue = (raw: unknown): unknown => {
    let value = raw;
    for (let depth = 0; depth < 4; depth += 1) {
      if (typeof value !== 'string') {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const record = value as Record<string, unknown>;
          if ('value' in record) { value = record.value; continue; }
          if ('data' in record) { value = record.data; continue; }
        }
        return value;
      }
      try { value = JSON.parse(value); }
      catch { return { __invalidJson: true }; }
    }
    return value;
  };
  const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const redactId = (value: unknown) => {
    const id = typeof value === 'string' ? value : '';
    return id ? '…' + id.slice(-8) : null;
  };

  const report: Record<string, unknown> = {
    generatedAt,
    appVersion: APP_VERSION,
    runningContext: {
      username: context.username ?? null,
      subredditName: context.subredditName ?? context.subreddit?.name ?? null,
      postId: context.postId ?? null,
    },
    storage: {},
    computed: {},
  };

  let registry: Record<string, string> = {};
  try {
    const raw = await redis.hGetAll('io:player-registry');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      report.storage = {
        ...(report.storage as object),
        registry: { key: 'io:player-registry', readOk: true, shape: 'not-a-hash-object', fieldCount: 0 },
      };
    } else {
      registry = raw as Record<string, string>;
      let parseableEntries = 0;
      let malformedEntries = 0;
      let missingUsername = 0;
      let missingLastSeenAt = 0;
      const samples: Array<{ idSuffix: string; username: string | null; validEntry: boolean }> = [];
      for (const [userId, stored] of Object.entries(registry)) {
        const value = parseStoredValue(stored);
        const valid = value !== null && typeof value === 'object' &&
          !Array.isArray(value) && !('__invalidJson' in (value as Record<string, unknown>));
        if (valid) {
          parseableEntries += 1;
          const entry = value as Record<string, unknown>;
          if (typeof entry.username !== 'string' || !entry.username.trim()) missingUsername += 1;
          if (!Number.isFinite(Number(entry.lastSeenAt)) || Number(entry.lastSeenAt) <= 0) missingLastSeenAt += 1;
          if (samples.length < 5) samples.push({
            idSuffix: redactId(userId) ?? '',
            username: typeof entry.username === 'string' ? entry.username.slice(0, 50) : null,
            validEntry: true,
          });
        } else {
          malformedEntries += 1;
          if (samples.length < 5) samples.push({ idSuffix: redactId(userId) ?? '', username: null, validEntry: false });
        }
      }
      report.storage = {
        ...(report.storage as object),
        registry: {
          key: 'io:player-registry',
          readOk: true,
          shape: 'hash',
          fieldCount: Object.keys(registry).length,
          parseableEntries,
          malformedEntries,
          missingUsername,
          missingLastSeenAt,
          sampleEntries: samples,
        },
      };
    }
  } catch (error) {
    report.storage = {
      ...(report.storage as object),
      registry: { key: 'io:player-registry', readOk: false, error: errorMessage(error) },
    };
  }

  try {
    const raw = await redis.get('io:leaderboard');
    const parsed = parseStoredValue(raw);
    if (raw == null) {
      report.storage = {
        ...(report.storage as object),
        legacyLeaderboard: { key: 'io:leaderboard', readOk: true, exists: false, shape: 'missing', entryCount: 0 },
      };
    } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && '__invalidJson' in parsed) {
      report.storage = {
        ...(report.storage as object),
        legacyLeaderboard: { key: 'io:leaderboard', readOk: true, exists: true, shape: 'invalid-json', entryCount: 0 },
      };
    } else if (Array.isArray(parsed)) {
      let withId = 0;
      let withoutId = 0;
      let invalidRecords = 0;
      let invalidMetrics = 0;
      let withSharedAt = 0;
      const ids = new Set<string>();
      const usernames = new Set<string>();
      let duplicateIds = 0;
      let duplicateUsernames = 0;
      const samples: Array<{ username: string | null; idSuffix: string | null; hasSharedAt: boolean; value: number | null }> = [];
      for (const candidate of parsed) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          invalidRecords += 1;
          continue;
        }
        const entry = candidate as Record<string, unknown>;
        const username = typeof entry.username === 'string' ? entry.username.trim() : '';
        const userId = typeof entry.userId === 'string' ? entry.userId.trim() : '';
        if (!username) invalidRecords += 1;
        if (userId) {
          withId += 1;
          if (ids.has(userId)) duplicateIds += 1;
          ids.add(userId);
        } else withoutId += 1;
        if (username) {
          const normalized = username.replace(/^u\//i, '').toLowerCase();
          if (usernames.has(normalized)) duplicateUsernames += 1;
          usernames.add(normalized);
        }
        if (!Number.isFinite(Number(entry.value)) ||
            !Number.isFinite(Number(entry.highestRarity)) ||
            !Number.isFinite(Number(entry.totalRolls))) invalidMetrics += 1;
        if (Number(entry.sharedAt) > 0) withSharedAt += 1;
        if (samples.length < 8) samples.push({
          username: username ? username.slice(0, 50) : null,
          idSuffix: redactId(userId),
          hasSharedAt: Number(entry.sharedAt) > 0,
          value: Number.isFinite(Number(entry.value)) ? Number(entry.value) : null,
        });
      }
      let savedAccounts = 0;
      let saveReadError: string | null = null;
      const idsToCheck = Array.from(ids).slice(0, 1000);
      if (idsToCheck.length > 0) {
        try {
          const saves = await redis.mGet(idsToCheck.map(id => 'player:' + id));
          savedAccounts = saves.filter((value: unknown) => value != null).length;
        } catch (error) {
          saveReadError = errorMessage(error);
        }
      }
      report.storage = {
        ...(report.storage as object),
        legacyLeaderboard: {
          key: 'io:leaderboard',
          readOk: true,
          exists: true,
          shape: 'array',
          entryCount: parsed.length,
          entriesWithUserId: withId,
          entriesWithoutUserId: withoutId,
          malformedRecords: invalidRecords,
          recordsWithInvalidMetrics: invalidMetrics,
          entriesWithSharedAt: withSharedAt,
          duplicateUserIds: duplicateIds,
          duplicateUsernames,
          uniqueUserIdsWithSaveChecked: idsToCheck.length,
          matchingPlayerSaves: savedAccounts,
          saveReadError,
          sampleEntries: samples,
        },
      };
    } else {
      report.storage = {
        ...(report.storage as object),
        legacyLeaderboard: {
          key: 'io:leaderboard',
          readOk: true,
          exists: true,
          shape: parsed === null ? 'unrecognized' : typeof parsed,
          entryCount: 0,
        },
      };
    }
  } catch (error) {
    report.storage = {
      ...(report.storage as object),
      legacyLeaderboard: { key: 'io:leaderboard', readOk: false, error: errorMessage(error) },
    };
  }

  const [playerResult, boardsResult] = await Promise.all([
    listPlayers().then(players => ({
      ok: true,
      count: players.length,
      activeCount: players.filter(player => player.active).length,
      registryRecoveredCount: players.filter(player => player.registryRecovered === true).length,
      legacyOnlyCount: players.filter(player => player.legacyOnly === true).length,
      samplePlayers: players.slice(0, 8).map(player => ({
        username: player.username,
        idSuffix: redactId(player.userId),
        active: player.active,
        legacyOnly: player.legacyOnly === true,
        registryRecovered: player.registryRecovered === true,
      })),
    })).catch(error => ({ ok: false, error: errorMessage(error) })),
    leaderboards().then(boards => ({
      ok: true,
      counts: Object.fromEntries(Object.entries(boards).map(([name, entries]) => [name, Array.isArray(entries) ? entries.length : null])),
      sampleEntries: Object.fromEntries(Object.entries(boards).map(([name, entries]) => [
        name,
        Array.isArray(entries) ? entries.slice(0, 3).map(entry => ({
          username: entry.username,
          idSuffix: redactId(entry.userId),
          legacyOnly: entry.legacyOnly === true,
          value: entry.value,
          totalRolls: entry.totalRolls,
          highestRarity: entry.highestRarity,
          sharedAt: entry.sharedAt ?? null,
        })) : [],
      ])),
    })).catch(error => ({ ok: false, error: errorMessage(error) })),
  ]);
  report.computed = { playerList: playerResult, leaderboards: boardsResult };
  res.json(report);
});



type StatSpySource = {
  label: string;
  level?: number;
  value: number;
  unit: 'pct' | 'mult' | 'ms' | 'count' | 'chance' | 'capacity' | 'rarity';
  kind: 'base' | 'add' | 'multiply' | 'reduction' | 'special';
  active?: boolean;
  detail?: string;
};

type StatSpyStat = {
  id: string;
  label: string;
  total: number;
  unit: 'pct' | 'mult' | 'ms' | 'count' | 'chance' | 'capacity' | 'rarity';
  detail?: string;
  sources: StatSpySource[];
};

async function loadPlayerForStatSpy(userId: string, username: string): Promise<PlayerState> {
  const raw = await readPlayerSaveForUser(userId, await redis.get('player:' + userId));
  if (raw == null) throw new Error('No Infinity Orbs save exists for u/' + username + '.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The stored save for u/' + username + ' is not valid player data.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The stored save for u/' + username + ' is not valid player data.');
  }

  const saved = parsed as Partial<PlayerState>;
  const base = createInitialState();
  const [guildPerks, guildCombo, globalBoosters] = await Promise.all([
    getPlayerGuildPerks(username, userId),
    getPlayerGuildCombo(username, userId),
    getGlobalBoosters(),
  ]);

  return {
    ...base,
    ...saved,
    username,
    upgrades: { ...base.upgrades, ...(saved.upgrades ?? {}) },
    prestigeUpgrades: { ...base.prestigeUpgrades, ...(saved.prestigeUpgrades ?? {}) },
    masterySkills: { ...base.masterySkills, ...(saved.masterySkills ?? {}) } as Record<string, number>,
    collection: saved.collection ?? {},
    sacrifices: { ...base.sacrifices, ...(saved.sacrifices ?? {}) },
    guildPerks,
    guildCombo,
    globalBoosters,
  } as PlayerState;
}

function statSource(
  label: string,
  value: number,
  unit: StatSpySource['unit'],
  kind: StatSpySource['kind'],
  options: Pick<StatSpySource, 'level' | 'active' | 'detail'> = {},
): StatSpySource {
  return { label, value, unit, kind, ...options };
}

function equippedRuneStatSources(
  combat: CombatState,
  stat: keyof CombatRuneBonuses,
): StatSpySource[] {
  const equippedIds = new Set(Array.isArray(combat.equippedRunes) ? combat.equippedRunes : []);
  const sources: StatSpySource[] = [];
  const runes = Array.isArray(combat.runes) ? combat.runes : [];
  for (const rune of runes) {
    if (!rune || typeof rune.id !== 'string' || !equippedIds.has(rune.id)) continue;
    if (rune.stat === stat) {
      const value = combatRuneScaledValue(rune);
      if (value > 0) {
        sources.push(statSource(
          String(rune.name || rune.id) + ' · ' + String(rune.rarity || 'Rune'),
          value,
          'pct',
          'special',
          { level: Number(rune.level) || 1, detail: 'Equipped Rune main stat · ' + String(rune.stat) + ' · ' + String(rune.sourceDungeon || 'unknown dungeon') + ' depth ' + Number(rune.sourceDepth || 0) },
        ));
      }
    }
    const ability = rune.majorAbility;
    const abilityStat = ability?.id === 'fateweaver'
      ? 'luckPct'
      : ability?.id === 'midas-engine'
        ? 'coinGainPct'
        : ability?.id === 'memory-well'
          ? 'xpGainPct'
          : null;
    if (ability && abilityStat === stat && Number(ability.valuePct) > 0) {
      const value = combatRuneMajorAbilityStrengthPct(ability, rune.level, rune.rarity);
      if (value > 0) {
        sources.push(statSource(
          String(ability.name || ability.id) + ' · ' + String(rune.name || rune.id),
          value,
          'pct',
          'special',
          { level: Number(rune.level) || 1, detail: 'Equipped Rune Major Ability · ' + String(ability.description || ability.id) },
        ));
      }
    }
  }
  return sources.length
    ? sources
    : [statSource('No equipped Rune source', 0, 'pct', 'special', { active: false, detail: 'No equipped Rune contributes to this stat.' })];
}

function buildStatSpyStats(
  s: PlayerState,
  currentCcu: number,
  fakeCcuBonus: number,
  communityLuckBonus: number,
  runeBonuses: CombatRuneBonuses,
  combatBossBonus: number,
  combatState: CombatState,
): StatSpyStat[] {
  const level = Math.max(1, Math.floor(Number(s.level) || 1));
  const levelBenefits = getLevelBenefits(level);
  const upgrades = s.upgrades ?? createInitialState().upgrades;
  const prestige = s.prestigeUpgrades ?? createInitialState().prestigeUpgrades;
  const mastery = s.masterySkills ?? createInitialState().masterySkills!;
  const guild = s.guildPerks ?? {
    luckRank: 0, speedRank: 0, vaultRank: 0, shardRank: 0, critRank: 0, coinRank: 0,
  };

  const altar = calculateAltarMultipliers(s);
  const globalLuck = globalBoosterLuckMultiplier(s.globalBoosters?.luck);
  const globalSpeed = globalBoosterSpeedMultiplier(s.globalBoosters?.speed);
  const globalCritChance = globalBoosterCritChanceBonus(s.globalBoosters?.crit);
  const globalCritPower = globalBoosterCritLuckBonus(s.globalBoosters?.crit);
  const comboLuck = guildComboLuckMultiplier(s.guildCombo);
  const comboSpeed = guildComboSpeedMultiplier(s.guildCombo);
  const comboCritChance = guildComboCritChanceBonus(s.guildCombo);
  const comboCritPower = guildComboCritLuckBonus(s.guildCombo);
  const effectiveCcu = Math.max(1, Math.floor(currentCcu + fakeCcuBonus));
  const codexChain = highestCodexChain(s.collection);

  // Compute the same pity stack logic used by luckMultiplier.
  const dryRolls = Math.max(0, Number(s.rollsSinceBest ?? 0));
  const pityInterval = Math.max(6, 18 - (Number(mastery.pityAccelerant ?? 0) * 2));
  const pityStacks = Math.floor(dryRolls / pityInterval);
  const pityLuckPct = (Number(prestige.resonanceMeter ?? 0) * 1) * pityStacks;

  const levelBaseLuckPct = Math.max(0, level - 1);
  const milestoneLuckPct = LEVEL_MILESTONES.reduce(
    (sum, milestone) => level >= milestone.level
      ? sum + Math.max(0, (milestone.bonusLuckMultiplier ?? 1) - 1) * 100
      : sum,
    0,
  );

  const masteryLuckPct = Number(mastery.continuumLuck ?? 0) * 3;
  const codexDevotionPct = Number(mastery.celestialSurge ?? 0) * codexChain * 0.3;
  const guildLuckPct = Number(guild.luckRank ?? 0) * 3;
  const onlineLuckPct = Math.max(0, onlinePlayerLuckMultiplier(effectiveCcu) - 1) * 100;
  const fortuneActive = isPremiumBoosterActive(s, 'fortune');
  const fortunePct = fortuneActive ? 300 : 0;
  const globalLuckPct = Math.max(0, globalLuck - 1) * 100;
  const astralReservePct = Number(prestige.astralReserve ?? 0) * 2;
  const cosmicReserveLevel = Math.max(0, Math.min(5, Math.floor(Number(prestige.cosmicReserve ?? 0) || 0)));
  const unspentCosmicDust = Math.max(0, Math.floor(Number(s.cosmicDust ?? 0) || 0));
  const cosmicReserveMultiplier = 1 + unspentCosmicDust * cosmicReserveLevel * 0.01;

  // luckMultiplier() applies permanent Luck, the Altar, and Cosmic Reserve as multiplicative layers.
  const permanentLuckFactor = Math.pow(1.05, Math.max(0, Number(prestige.permLuck ?? 0)));
  // Match the production base-Luck calculation. This includes Daily Streak Community,
  // all current multipliers, and every source already handled by luckMultiplier().
  // World-event and combat-boss Luck are separate additive bonuses in applyRolls.
  const finalLuckCandidate = luckMultiplier(s) + communityLuckBonus + combatBossBonus;
  const finalLuck = Number.isFinite(finalLuckCandidate)
    ? Math.max(1, finalLuckCandidate)
    : Number.MAX_VALUE;
  const apexFortuneLevel = Math.max(0, Number(mastery.apexFortune ?? 0));
  const apexFortuneChance = Math.min(0.45, apexFortuneLevel * 0.03);
  const runeLuckMultiplier = combatRuneLuckMultiplier(runeBonuses.luckPct);
  const runeCoinMultiplier = 1 + runeBonuses.coinGainPct / 100;
  const runeXpMultiplier = 1 + runeBonuses.xpGainPct / 100;

  const luckSources: StatSpySource[] = [
    statSource('Base', 1, 'mult', 'base'),
    statSource('Luck upgrade', Number(upgrades.luck ?? 0) * 5, 'pct', 'add', { level: Number(upgrades.luck ?? 0), detail: '+5% per level' }),
    statSource('Level progression', levelBaseLuckPct, 'pct', 'add', { level, detail: '+1% per level after Lv 1' }),
    statSource('Level milestones', milestoneLuckPct, 'pct', 'add', { level, detail: 'Milestone bonuses currently unlocked' }),
    statSource('Continuum Attunement', masteryLuckPct, 'pct', 'add', { level: Number(mastery.continuumLuck ?? 0), detail: '+3% per level' }),
    statSource('Codex Devotion', codexDevotionPct, 'pct', 'add', { level: Number(mastery.celestialSurge ?? 0), detail: 'Chain length ' + codexChain + ' (' + (Number(mastery.celestialSurge ?? 0) * codexChain) + ' chain-levels)' }),
    statSource('Guild Luck', guildLuckPct, 'pct', 'add', { level: Number(guild.luckRank ?? 0), detail: '+3% per rank' }),
    statSource('Dry Streak Luck', pityLuckPct, 'pct', 'add', { level: Number(prestige.resonanceMeter ?? 0), detail: pityStacks + ' active pity stack(s), every ' + pityInterval + ' dry rolls' }),
    statSource('Online population', onlineLuckPct, 'pct', 'add', { detail: 'Current CCU ' + effectiveCcu + ' (' + currentCcu + ' real + ' + fakeCcuBonus + ' test)' }),
    statSource('Fortune Surge', fortunePct, 'pct', 'add', { active: fortuneActive, detail: 'Active premium booster adds +300%' }),
    statSource('Global Luck', globalLuckPct, 'pct', 'add', { level: Number(s.globalBoosters?.luck?.tier ?? 0), active: globalLuck > 1, detail: '+10% per active global tier' }),
    statSource('Guild Combo Luck', Math.max(0, comboLuck - 1) * 100, 'pct', 'add', { level: Number(s.guildCombo?.tier ?? 0), active: comboLuck > 1, detail: '+5% per active combo tier' }),
    statSource('Astral Reserve', astralReservePct, 'pct', 'add', { level: Number(prestige.astralReserve ?? 0), detail: '+2% per level' }),
    statSource('Cosmic Reserve', cosmicReserveMultiplier, 'mult', 'multiply', { level: cosmicReserveLevel, active: cosmicReserveLevel > 0 && unspentCosmicDust > 0, detail: '×(1 + ' + unspentCosmicDust.toLocaleString() + ' unspent Dust × ' + cosmicReserveLevel + '%). Spent Dust removes its bonus.' }),
    statSource('Permanent Luck layer', permanentLuckFactor, 'mult', 'multiply', { level: Number(prestige.permLuck ?? 0), detail: '×1.05 per prestige level' }),
    statSource('Altar layer', altar.totalAltarMultiplier, 'mult', 'multiply', { detail: 'Coin sacrifice × Shard infusion × Luck Surge' }),
    statSource('Daily Streak Community', Math.max(0, Number(s.dailyStreakCommunity?.luckMultiplier ?? 1) - 1) * 100, 'pct', 'add', { active: Number(s.dailyStreakCommunity?.luckMultiplier ?? 1) > 1, detail: 'Player-specific Daily Streak community bonus included in the base Luck formula' }),
    statSource('World Event Luck', communityLuckBonus * 100, 'pct', 'add', { active: communityLuckBonus > 0, detail: 'Current world/community event bonus added after normal Luck' }),
    statSource('Combat Boss Records', combatBossBonus * 100, 'pct', 'add', { active: combatBossBonus > 0, detail: 'Persistent Luck bonus from total bosses beaten across Combat dungeons' }),
  ];

  const manualCooldown = cooldownMs(s, false);
  const autoCooldown = cooldownMs(s, true);
  const speedSources: StatSpySource[] = [
    statSource('Base cooldown', 15_000, 'ms', 'base'),
    statSource('Speed upgrade', Number(upgrades.speed ?? 0) * 150, 'ms', 'reduction', { level: Number(upgrades.speed ?? 0), detail: '-150ms per level' }),
    statSource('Permanent Speed Floor', Number(prestige.permSpeed ?? 0) * 300, 'ms', 'reduction', { level: Number(prestige.permSpeed ?? 0), detail: '-300ms to cooldown and floor per level' }),
    statSource('Guild Speed', Number(guild.speedRank ?? 0) * 100, 'ms', 'reduction', { level: Number(guild.speedRank ?? 0), detail: 'Floor reduction only' }),
    statSource('Chrono Flow', Number(mastery.chronoFlow ?? 0) * 120, 'ms', 'reduction', { level: Number(mastery.chronoFlow ?? 0), detail: 'Reduces active cooldown and minimum floor' }),
    statSource('Steady Hands', Number(prestige.steadyHands ?? 0) * 100, 'ms', 'reduction', { level: Number(prestige.steadyHands ?? 0), detail: '-100ms per level' }),
    statSource('Temporal Compression', Number(prestige.temporalCompression ?? 0) * 75, 'ms', 'reduction', { level: Number(prestige.temporalCompression ?? 0), detail: '-75ms per level' }),
    statSource('Level milestone speed', levelBenefits.cooldownReductionMs, 'ms', 'reduction', { level, detail: 'Unlocked at level milestones' }),
    statSource('Auto-Roll Speed', 1 - (Number(prestige.autoOverclock ?? 0) * 0.05), 'mult', 'multiply', { level: Number(prestige.autoOverclock ?? 0), detail: '×0.95 auto cooldown per level' }),
    statSource('Turbo', Number(prestige.chronoOverdrive ?? 0) > 0 ? 0.65 : 0.75, 'mult', 'multiply', { active: Boolean(s.turboRollUntil && Date.now() < s.turboRollUntil), detail: Number(prestige.chronoOverdrive ?? 0) > 0 ? '×0.65 while active with Turbo Duration' : '×0.75 while active' }),
    statSource('Hyperdrive', 0.25, 'mult', 'multiply', { active: isPremiumBoosterActive(s, 'hyperdrive'), detail: '×0.25 while active' }),
    statSource('Global Speed', globalSpeed, 'mult', 'multiply', { level: Number(s.globalBoosters?.speed?.tier ?? 0), active: globalSpeed < 1, detail: '0.95× per tier, capped at 0.35×' }),
    statSource('Guild Combo Speed', comboSpeed, 'mult', 'multiply', { level: Number(s.guildCombo?.tier ?? 0), active: comboSpeed < 1, detail: 'Half Global Speed effect: -2.5 percentage points per tier' }),
  ];

  const ballsSources: StatSpySource[] = [
    statSource('Base activation', 1, 'count', 'base'),
    statSource('Multi upgrade', Number(upgrades.multi ?? 0), 'count', 'add', { level: Number(upgrades.multi ?? 0), detail: '+1 per level' }),
    statSource('Cluster Roll', Number(upgrades.clusterRoll ?? 0), 'count', 'add', { level: Number(upgrades.clusterRoll ?? 0), detail: '+1 per level' }),
    statSource('Astral Barrage', Number(prestige.astralBarrage ?? 0), 'count', 'add', { level: Number(prestige.astralBarrage ?? 0), detail: '+1 per level' }),
    statSource('Celestial Volley', Number(mastery.celestialVolley ?? 0), 'count', 'add', { level: Number(mastery.celestialVolley ?? 0), detail: '+1 per level' }),
    statSource('Level bonus balls', levelBenefits.bonusBalls, 'count', 'add', { level, detail: 'From unlocked level milestones' }),
    statSource('Astral Arsenal', Number(prestige.astralArsenal ?? 0), 'count', 'add', { level: Number(prestige.astralArsenal ?? 0), detail: '+1 per level' }),
    statSource('Barrage booster', 25, 'count', 'add', { active: isPremiumBoosterActive(s, 'barrage'), detail: '+25 while active' }),
  ];

  const rawCritChance = Number(upgrades.critChance ?? 0) * 0.03 +
    Number(mastery.critMastery ?? 0) * 0.03 +
    Number(guild.critRank ?? 0) * 0.015 +
    globalCritChance +
    comboCritChance;
  const critChance = Math.min(0.40, rawCritChance);
  const critPower = critMultiplier(s);

  const coinMultiplier =
    levelBenefits.coinsMultiplier *
    (1 + Number(upgrades.coinBonus ?? 0) * 0.15) *
    (1 + Number(mastery.prosperity ?? 0) * 0.12) *
    (1 + Number(guild.coinRank ?? 0) * 0.10) *
    runeCoinMultiplier;

  const offlineCoinMultiplier =
    (1 + Number(prestige.offlineFortune ?? 0) * 0.25) *
    (1 + Number(prestige.offlineOverdrive ?? 0) * 0.50);

  const shardChance = Math.min(
    ROLL_SHARD_PROC_CHANCE_CAP,
    (
      Number(upgrades.shardChance ?? 0) * 0.0015 +
      Number(mastery.shardAttunement ?? 0) * 0.001 +
      Number(guild.shardRank ?? 0) * 0.0005 +
      Number(prestige.shardResonator ?? 0) * 0.0025 +
      levelBenefits.shardChance +
      Math.min(100, runeBonuses.shardChancePct) / 100
    ) * 0.025,
  );

  const xpMultiplier =
    (1 + Number(upgrades.xpBonus ?? 0) * 0.20) *
    levelBenefits.xpMultiplier *
    (isPremiumBoosterActive(s, 'ascension') ? 10 : 1) *
    runeXpMultiplier;

  const valueMultiplier =
    1 +
    Number(upgrades.valueBonus ?? 0) * 0.10 +
    Number(prestige.cosmicValuation ?? 0) * 0.05;

  const vaultSources: StatSpySource[] = [
    statSource('Base vault', 30, 'capacity', 'base'),
    statSource('Auto upgrade', Number(upgrades.auto ?? 0) * 20, 'capacity', 'add', { level: Number(upgrades.auto ?? 0), detail: '+20 capacity per Auto level' }),
    statSource('Speed upgrade', Number(upgrades.speed ?? 0) * 4, 'pct', 'multiply', { level: Number(upgrades.speed ?? 0), detail: '+4% vault-capacity multiplier per level' }),
    statSource('Vault Expansion', Number(prestige.vaultCap ?? 0) * 250, 'capacity', 'add', { level: Number(prestige.vaultCap ?? 0), detail: '+250 per level' }),
    statSource('Guild Vault', Number(guild.vaultRank ?? 0) * 100, 'capacity', 'add', { level: Number(guild.vaultRank ?? 0), detail: '+100 per rank' }),
    statSource('Vault Architecture', Number(mastery.infiniteVault ?? 0) * 200, 'capacity', 'add', { level: Number(mastery.infiniteVault ?? 0), detail: '+200 per level' }),
    statSource('Deep Vault', Number(prestige.deepVault ?? 0) * 250, 'capacity', 'add', { level: Number(prestige.deepVault ?? 0), detail: '+250 per level' }),
  ];

  const prestigeDustMultiplier =
    1 +
    Number(mastery.cosmicAttunement ?? 0) * 0.08;

  const stats: StatSpyStat[] = [
    {
      id: 'luck',
      label: 'Effective Luck',
      total: finalLuck,
      unit: 'mult',
      detail: 'Production base Luck before the per-activation Apex Fortune proc and before the separate direct Combat Rune rarity multiplier.',
      sources: luckSources,
    },
    {
      id: 'luckTail',
      label: 'Luck Rarity-Tail Factor',
      total: Math.min(25, Math.pow(finalLuck, 0.08)),
      unit: 'mult',
      detail: 'The actual factor applied by the Continuum rarity distribution from Effective Luck. It changes rarity odds rather than multiplying the final Orb rarity; hard-capped at 25×.',
      sources: [
        statSource('Effective base Luck', finalLuck, 'mult', 'special', { detail: 'Input to the Continuum tail function: min(25, Luck^0.08)' }),
        statSource('Rarity-tail hard cap', 25, 'mult', 'special', { detail: 'The Continuum factor cannot exceed 25×' }),
      ],
    },
    {
      id: 'runeLuck',
      label: 'Combat Rune Rarity Multiplier',
      total: runeLuckMultiplier,
      unit: 'mult',
      detail: 'Applied directly to the continuous rarity sample before its integer floor. This is separate from Luck-shaped tail odds.',
      sources: [
        ...equippedRuneStatSources(combatState, 'luckPct'),
        statSource('Total equipped Rune Luck', runeLuckMultiplier, 'mult', 'special', { active: runeBonuses.luckPct > 0, detail: '+' + runeBonuses.luckPct.toLocaleString() + '% effective Rune Luck, including Fateweaver abilities' }),
      ],
    },
    {
      id: 'apexFortune',
      label: 'Apex Fortune Proc Chance',
      total: apexFortuneChance,
      unit: 'chance',
      detail: 'Only on multi-roll activations; a successful proc doubles Luck for that activation. It is not permanently baked into the base Luck total.',
      sources: [
        statSource('Apex Fortune mastery', apexFortuneLevel * 3, 'pct', 'special', { level: apexFortuneLevel, active: apexFortuneChance > 0, detail: '+3 percentage points per level; capped at 45%' }),
        statSource('Luck on successful proc', 2, 'mult', 'special', { active: apexFortuneChance > 0, detail: 'Doubles base Luck for that activation' }),
      ],
    },
    {
      id: 'cooldown',
      label: 'Roll Cooldown',
      total: manualCooldown,
      unit: 'ms',
      detail: 'Manual cooldown; Auto cooldown is shown separately below.',
      sources: speedSources.concat([
        statSource('Auto cooldown', autoCooldown, 'ms', 'special', { detail: 'Final Auto-Roll cooldown with all active Auto modifiers' }),
      ]),
    },
    {
      id: 'autoCooldown',
      label: 'Auto-Roll Cooldown',
      total: autoCooldown,
      unit: 'ms',
      detail: 'Final cooldown used by Auto Roll.',
      sources: speedSources,
    },
    {
      id: 'balls',
      label: 'Orbs per Activation',
      total: rollsPerActivation(s),
      unit: 'count',
      detail: 'Includes permanent, mastery, level, and active barrage sources.',
      sources: ballsSources,
    },
    {
      id: 'critChance',
      label: 'Critical Chance',
      total: critChance,
      unit: 'chance',
      detail: 'Hard capped at 40%.',
      sources: [
        statSource('Crit Chance upgrade', Number(upgrades.critChance ?? 0) * 3, 'pct', 'add', { level: Number(upgrades.critChance ?? 0), detail: '+3 percentage points per level' }),
        statSource('Critical Overdrive', Number(mastery.critMastery ?? 0) * 3, 'pct', 'add', { level: Number(mastery.critMastery ?? 0), detail: '+3 percentage points per level' }),
        statSource('Guild Crit', Number(guild.critRank ?? 0) * 1.5, 'pct', 'add', { level: Number(guild.critRank ?? 0), detail: '+1.5 percentage points per rank' }),
        statSource('Global Crit', globalCritChance * 100, 'pct', 'add', { level: Number(s.globalBoosters?.crit?.tier ?? 0), active: globalCritChance > 0, detail: '+2 percentage points per active tier' }),
        statSource('Guild Combo Crit', comboCritChance * 100, 'pct', 'add', { level: Number(s.guildCombo?.tier ?? 0), active: comboCritChance > 0, detail: '+1 percentage point per active combo tier' }),
      ],
    },
    {
      id: 'critPower',
      label: 'Critical Multiplier',
      total: critPower,
      unit: 'mult',
      sources: [
        statSource('Base critical', 2, 'mult', 'base'),
        statSource('Crit Power upgrade', Number(upgrades.critPower ?? 0) * 0.25, 'mult', 'add', { level: Number(upgrades.critPower ?? 0), detail: '+0.25× per level' }),
        statSource('Critical Overdrive', Number(mastery.critMastery ?? 0) * 0.30, 'mult', 'add', { level: Number(mastery.critMastery ?? 0), detail: '+0.30× per level' }),
        statSource('Aftershock', Number(mastery.aftershock ?? 0) > 0 ? aftershockCriticalLuckBonus(s.aftershockRecord) : 0, 'mult', 'add', { level: Number(mastery.aftershock ?? 0), active: Number(mastery.aftershock ?? 0) > 0, detail: 'Permanent Critical Luck from the best dry interval between all-time rarity records' }),
        statSource('Global Crit', globalCritPower, 'mult', 'add', { level: Number(s.globalBoosters?.crit?.tier ?? 0), active: globalCritPower > 0, detail: '+0.10× per active tier' }),
        statSource('Guild Combo Crit', comboCritPower, 'mult', 'add', { level: Number(s.guildCombo?.tier ?? 0), active: comboCritPower > 0, detail: '+0.05× per active combo tier' }),
      ],
    },
    {
      id: 'supernova',
      label: 'Supernova Critical Amplification Chance',
      total: Math.min(1, Math.max(0, Number(prestige.supernova ?? 0)) * 0.10),
      unit: 'chance',
      detail: 'When a critical roll is selected, this chance multiplies its full critical strength by 5×.',
      sources: [
        statSource('Supernova upgrade', Number(prestige.supernova ?? 0) * 10, 'pct', 'special', { level: Number(prestige.supernova ?? 0), active: Number(prestige.supernova ?? 0) > 0, detail: '+10 percentage points per upgrade level, up to 100%' }),
        statSource('Critical strength when triggered', 5, 'mult', 'special', { active: Number(prestige.supernova ?? 0) > 0, detail: 'Multiplies the full normal critical multiplier by 5' }),
      ],
    },
    {
      id: 'coins',
      label: 'Coin Multiplier',
      total: coinMultiplier,
      unit: 'mult',
      detail: 'Normal roll coin multiplier, before special low-rarity salvage/transmutation effects.',
      sources: [
        statSource('Base coins', 1, 'mult', 'base'),
        statSource('Level coins', levelBenefits.coinsMultiplier, 'mult', 'multiply', { level, detail: '+3% per level, with milestone multipliers' }),
        statSource('Coin Bonus upgrade', 1 + Number(upgrades.coinBonus ?? 0) * 0.15, 'mult', 'multiply', { level: Number(upgrades.coinBonus ?? 0), detail: '+15% per level' }),
        statSource('Midas Touch', 1 + Number(mastery.prosperity ?? 0) * 0.12, 'mult', 'multiply', { level: Number(mastery.prosperity ?? 0), detail: '+12% per level' }),
        statSource('Guild Coin', 1 + Number(guild.coinRank ?? 0) * 0.10, 'mult', 'multiply', { level: Number(guild.coinRank ?? 0), detail: '+10% per rank' }),
        ...equippedRuneStatSources(combatState, 'coinGainPct'),
        statSource('Equipped Rune Coin Multiplier', runeCoinMultiplier, 'mult', 'multiply', { active: runeBonuses.coinGainPct > 0, detail: '+' + runeBonuses.coinGainPct.toLocaleString() + '% from equipped Rune stats and Midas Engine abilities' }),
        statSource('Offline coin layer', offlineCoinMultiplier, 'mult', 'multiply', { detail: 'Only applies to offline roll rewards' }),
      ],
    },
    {
      id: 'xp',
      label: 'XP Multiplier',
      total: xpMultiplier,
      unit: 'mult',
      sources: [
        statSource('Base XP', 1, 'mult', 'base'),
        statSource('XP Bonus upgrade', 1 + Number(upgrades.xpBonus ?? 0) * 0.20, 'mult', 'multiply', { level: Number(upgrades.xpBonus ?? 0), detail: '+20% per level' }),
        statSource('Level XP', levelBenefits.xpMultiplier, 'mult', 'multiply', { level, detail: 'Unlocked milestone multipliers' }),
        statSource('Ascension', 10, 'mult', 'multiply', { active: isPremiumBoosterActive(s, 'ascension'), detail: '×10 while active' }),
        ...equippedRuneStatSources(combatState, 'xpGainPct'),
        statSource('Equipped Rune XP Multiplier', runeXpMultiplier, 'mult', 'multiply', { active: runeBonuses.xpGainPct > 0, detail: '+' + runeBonuses.xpGainPct.toLocaleString() + '% from equipped Rune stats and Memory Well abilities' }),
      ],
    },
    {
      id: 'shardChance',
      label: 'Bonus Shard Chance',
      total: shardChance,
      unit: 'chance',
      detail: 'Actual primary Shard-proc probability per Orb after the 2.5% conversion factor; hard-capped at 0.25% per Orb. There is no Shard pity.',
      sources: [
        statSource('Shard Chance upgrade', Number(upgrades.shardChance ?? 0) * 0.0015 * 0.025 * 100, 'pct', 'add', { level: Number(upgrades.shardChance ?? 0), detail: '+0.15 points to the pre-scale factor per level; effective chance is then ×2.5%' }),
        statSource('Shard Resonance', Number(mastery.shardAttunement ?? 0) * 0.001 * 0.025 * 100, 'pct', 'add', { level: Number(mastery.shardAttunement ?? 0), detail: '+0.10 points to the pre-scale factor per level; effective chance is then ×2.5%' }),
        statSource('Guild Shard', Number(guild.shardRank ?? 0) * 0.0005 * 0.025 * 100, 'pct', 'add', { level: Number(guild.shardRank ?? 0), detail: '+0.05 points to the pre-scale factor per rank; effective chance is then ×2.5%' }),
        statSource('Shard Resonator', Number(prestige.shardResonator ?? 0) * 0.0025 * 0.025 * 100, 'pct', 'add', { level: Number(prestige.shardResonator ?? 0), detail: '+0.25 points to the pre-scale factor per level; effective chance is then ×2.5%' }),
        statSource('Level shard chance', levelBenefits.shardChance * 0.025 * 100, 'pct', 'add', { level, detail: 'Unlocked level contribution, then scaled by 2.5%' }),
        ...equippedRuneStatSources(combatState, 'shardChancePct').map(source => ({
          ...source,
          value: source.value * 0.025,
          detail: (source.detail ?? '') + ' · Rune contribution is not level-scaled; per-rune values contribute to a combined 100% cap before ×2.5% scaling',
        })),
        statSource('Combined equipped Rune Shard chance', Math.min(100, runeBonuses.shardChancePct) * 0.025, 'pct', 'special', { active: runeBonuses.shardChancePct > 0, detail: 'All equipped Rune Shard stats are combined (capped at 100%) before the ×2.5% conversion' }),
        statSource('Final cap', ROLL_SHARD_PROC_CHANCE_CAP * 100, 'pct', 'special', { detail: 'Maximum final primary-proc chance is 0.25% per Orb' }),
      ],
    },
    {
      id: 'value',
      label: 'Collection Value Multiplier',
      total: valueMultiplier,
      unit: 'mult',
      sources: [
        statSource('Base value', 1, 'mult', 'base'),
        statSource('Value Bonus upgrade', Number(upgrades.valueBonus ?? 0) * 10, 'pct', 'add', { level: Number(upgrades.valueBonus ?? 0), detail: '+10 percentage points per level' }),
        statSource('Cosmic Valuation', Number(prestige.cosmicValuation ?? 0) * 5, 'pct', 'add', { level: Number(prestige.cosmicValuation ?? 0), detail: '+5 percentage points per level' }),
      ],
    },
    {
      id: 'vault',
      label: 'Offline Roll Capacity',
      total: Math.min(1_000, offlineRollCap(s)),
      unit: 'capacity',
      detail: 'Hard cap is 1,000 stored offline rolls.',
      sources: vaultSources,
    },
    {
      id: 'offlineRate',
      label: 'Offline Roll Interval',
      total: effectiveOfflineTickMs(s),
      unit: 'ms',
      detail: 'Time between generated offline rolls; lower is faster.',
      sources: [
        statSource('Base interval', 60_000, 'ms', 'base'),
        statSource('Offline Rate upgrade', Number(upgrades.offlineRate ?? 0) * 8, 'pct', 'reduction', { level: Number(upgrades.offlineRate ?? 0), detail: 'Reduces interval by 8% per level, subject to 60% reduction cap' }),
        statSource('Offline Overdrive', Math.max(0, 1 - Math.pow(1.5, -Math.min(3, Number(prestige.offlineOverdrive ?? 0)))) * 100, 'pct', 'multiply', { level: Number(prestige.offlineOverdrive ?? 0), detail: '50% faster per level, up to 3 levels' }),
      ],
    },
    {
      id: 'minimumRarity',
      label: 'Minimum Orb Rarity',
      total: 2 + Number(prestige.luckyFloor ?? 0),
      unit: 'rarity',
      sources: [
        statSource('Base minimum', 2, 'rarity', 'base'),
        statSource('Lucky Floor', Number(prestige.luckyFloor ?? 0), 'rarity', 'add', { level: Number(prestige.luckyFloor ?? 0), detail: '+1 minimum rarity per level' }),
      ],
    },
    {
      id: 'prestigeDust',
      label: 'Prestige Cosmic Dust Multiplier',
      total: prestigeDustMultiplier,
      unit: 'mult',
      sources: [
        statSource('Base dust', 1, 'mult', 'base'),
        statSource('Cosmic Affinity', Number(mastery.cosmicAttunement ?? 0) * 8, 'pct', 'add', { level: Number(mastery.cosmicAttunement ?? 0), detail: '+8 percentage points per level' }),
      ],
    },
    {
      id: 'frenzyVolley',
      label: 'Frenzy Volley Efficiency',
      total: 1 + (Number(prestige.frenzyVolley ?? 0) > 0 ? Math.max(0, (rollsPerActivation(s) - 1) * 0.20) : 0),
      unit: 'mult',
      detail: 'Special Frenzy scaling applied to additional multiballs.',
      sources: [
        statSource('Base Frenzy', 1, 'mult', 'base'),
        statSource('Frenzy Volley', Number(prestige.frenzyVolley ?? 0) > 0 ? 0.20 : 0, 'pct', 'add', { level: Number(prestige.frenzyVolley ?? 0), detail: '+20% efficiency per additional multiball while unlocked' }),
      ],
    },
  ];

  return stats;
}

debugRouter.get('/stat-spy', async (req, res) => {
  try {
    const username = targetUsername(req.query?.username);
    const userId = await resolveUserId(username);
    const [state, currentCcu, fakeCcuBonus, communityEvent, combatSnapshot, rawPlayerSave] = await Promise.all([
      loadPlayerForStatSpy(userId, username),
      getOnlinePlayers(),
      getFakeCcuBonus(userId),
      getCommunityEvent(),
      getCombatSnapshotForUser(userId),
      readPlayerSaveForUser(userId, await redis.get('player:' + userId)),
    ]);
    // No active event means neutral ×1 Luck, not the old fallback +15%.
    const communityLuckBonus = Math.max(0, Number(communityEvent?.buffMultiplier ?? 1) - 1);
    state.onlinePlayers = Math.max(1, Math.floor(currentCcu + fakeCcuBonus));
    const runeBonuses = combatRuneBonuses(combatSnapshot.state.runes, combatSnapshot.state.equippedRunes);
    const combatBossBonus = combatBossLuckBonus(combatTotalBossesBeaten(combatSnapshot.state));
    const stats = buildStatSpyStats(state, currentCcu, fakeCcuBonus, communityLuckBonus, runeBonuses, combatBossBonus, combatSnapshot.state);
    let storedPlayerSave: unknown = null;
    if (typeof rawPlayerSave === 'string' && rawPlayerSave.trim()) {
      try {
        storedPlayerSave = JSON.parse(rawPlayerSave) as unknown;
      } catch {
        storedPlayerSave = { error: 'Could not parse the stored player save.' };
      }
    }

    const combatState = combatSnapshot.state;
    const enemy = combatSnapshot.enemy;
    const gear = Object.entries(combatState.equipment).map(([slot, itemId]) => ({
      slot,
      itemId: itemId ?? null,
      item: itemId ? combatState.inventory.find(item => item.id === itemId && item.slot === slot) ?? null : null,
    }));
    const equippedSkills = (Array.isArray(combatState.equippedAbilities) ? combatState.equippedAbilities : []).map(id => {
      const definition = COMBAT_SKILLS.find(skill => skill.id === id);
      return {
        id,
        name: definition?.name ?? id,
        rarity: definition?.rarity ?? 'Unknown',
        effect: definition?.effect ?? 'No skill definition found.',
        rank: Number(combatState.skillLevels?.[id] ?? 0),
        cooldownUntilSequence: combatState.abilityCooldowns?.[id] ?? null,
      };
    });
    const equippedRuneIds = new Set(Array.isArray(combatState.equippedRunes) ? combatState.equippedRunes : []);
    const equippedRunes = (Array.isArray(combatState.runes) ? combatState.runes : [])
      .filter(rune => equippedRuneIds.has(rune.id));
    const inCombat = combatSnapshot.saveExists && Number(combatState.health) > 0 && Number(enemy.hp) > 0;
    const combatStatus = !combatSnapshot.saveExists
      ? 'No saved Combat state'
      : Number(combatState.health) <= 0
        ? 'Player defeated'
        : Number(enemy.hp) <= 0
          ? 'Enemy defeated / transition pending'
          : 'Live encounter saved';
    res.json({
      username,
      userId,
      generatedAt: Date.now(),
      summary: {
        level: Number(state.level ?? 1),
        xp: Number(state.xp ?? 0),
        totalRolls: Number(state.totalRolls ?? 0),
        highestRarity: Number(state.highestRarity ?? 0),
        coins: Number(state.coins ?? 0),
        shards: Number(state.shards ?? 0),
        cosmicDust: Number(state.cosmicDust ?? 0),
        prestigeCount: Number(state.prestigeCount ?? 0),
        currentCcu,
        fakeCcuBonus,
        effectiveCcu: Math.max(1, Math.floor(currentCcu + fakeCcuBonus)),
      },
      stats,
      // Full persisted save plus the hydrated calculation state, which also
      // includes live guild/global-buff data needed to explain current stats.
      playerSave: storedPlayerSave,
      calculatedPlayerState: state,
      allocations: {
        upgrades: state.upgrades,
        prestigeUpgrades: state.prestigeUpgrades,
        masterySkills: state.masterySkills,
        guildPerks: state.guildPerks,
        globalBoosters: state.globalBoosters,
        activeBoosters: state.activeBoosters ?? {},
      },
      combat: {
        saveExists: combatSnapshot.saveExists,
        inCombat,
        status: combatStatus,
        statusNote: 'In-combat status is inferred from saved player/enemy HP. The server does not persist whether the Combat UI tab is currently open.',
        dungeonId: combatState.dungeonId,
        depth: combatState.depth,
        bestDepth: combatState.bestDepth,
        dungeonBestDepths: combatState.dungeonBestDepths,
        playerHp: combatState.health,
        playerMaxHp: combatState.maxHealth,
        enemy: {
          name: enemy.name,
          kind: enemy.kind,
          boss: enemy.boss,
          room: enemy.room,
          hp: enemy.hp,
          maxHp: enemy.maxHp,
          damage: enemy.damage,
          speed: enemy.speed,
        },
        stats: combatSnapshot.stats,
        gear,
        equippedSkills,
        equippedRunes,
        runeBonuses,
        runeLuckMultiplier: combatRuneLuckMultiplier(runeBonuses.luckPct),
        lastAcceptedBeatAtMs: combatState.lastAcceptedBeatAtMs,
        state: combatState,
        save: combatSnapshot.persistedSave,
      },
    });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Could not load Stat Spy data.' });
  }
});

debugRouter.get('/player-spy', async (req, res) => {
  try {
    const username = targetUsername(req.query?.username);
    const userId = await resolveUserId(username);
    const limit = Math.max(1, Math.min(500, Math.floor(Number(req.query?.limit ?? 500) || 500)));
    const logs = await getPlayerSpyLogs(userId, limit);
    res.json({
      username,
      userId,
      logCount: logs.length,
      logs,
      generatedAt: Date.now(),
    });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Could not load Player Spy logs.' });
  }
});

debugRouter.post('/player-spy/clear', async (req, res) => {
  try {
    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    await clearPlayerSpyLogs(userId);
    res.json({ ok: true, username, userId });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Could not clear Player Spy logs.' });
  }
});

debugRouter.get('/moderation/save', async (req, res) => {
  try {
    const name = targetUsername(req.query?.username);
    const userId = await resolveUserId(name);
    const generationRaw = await redis.get('player-generation:' + userId);
    const raw = await readPlayerSaveForUser(userId, await redis.get('player:' + userId));
    let save: Record<string, unknown> | null = null;
    if (raw) {
      try {
        save = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        save = null;
      }
    }
    const bans = await listGameBans();
    const ban = bans.find(entry => entry.userId === userId) ?? null;
    res.json({
      username: name,
      userId,
      generation: Number.parseInt(String(generationRaw ?? '0'), 10) || 0,
      ban,
      exists: raw != null,
      save: save
        ? {
            level: Number(save.level ?? 1),
            xp: Number(save.xp ?? 0),
            saveGeneration: Number(save.saveGeneration ?? 0),
            coins: Number(save.coins ?? 0),
            shards: Number(save.shards ?? 0),
            totalRolls: Number(save.totalRolls ?? 0),
            highestRarity: Number(save.highestRarity ?? 0),
          }
        : null,
    });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Could not inspect player save.' });
  }
});

debugRouter.post('/moderation/hard-reset', async (req, res) => {
  try {
    const result = await wipeUser(req.body?.username);
    res.json({ ok: true, action: 'hard-reset', ...result });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Could not reset player save.' });
  }
});

debugRouter.get('/context', (_req, res) => {
  res.json({
    username: context.username ?? null,
    userId: context.userId ?? null,
    subredditName: context.subredditName ?? null,
    postId: context.postId ?? null,
  });
});

// Community event controls.
debugRouter.post('/event', async (req, res) => {
  try {
    const { goal, progress, addRolls, tier, buffMultiplier, reset } = req.body || {};
    const updated = await setCommunityEventConfig({ goal, progress, addRolls, tier, buffMultiplier, reset });
    res.json({ event: updated });
  } catch (e: any) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to update community event.' });
  }
});

// Currency controls.
debugRouter.get('/mechanics', async (_req, res) => {
  try {
    const s = await loadRaw({ registerActivity: false });
    res.json({
      ok: true,
      mechanics: {
        luckMultiplier: luckMultiplier(s),
        cooldownMs: cooldownMs(s, false),
        autoCooldownMs: cooldownMs(s, true),
        rollsPerActivation: rollsPerActivation(s),
        offlineRollCap: offlineRollCap(s),
        effectiveOfflineTickMs: effectiveOfflineTickMs(s),
        critMultiplier: critMultiplier(s),
        effectiveCritChance: Math.min(
          0.40,
          (s.upgrades.critChance ?? 0) * 0.03 +
            (s.masterySkills?.critMastery ?? 0) * 0.03 +
            (s.guildPerks?.critRank ?? 0) * 0.015 +
            globalBoosterCritChanceBonus(s.globalBoosters?.crit) +
            guildComboCritChanceBonus(s.guildCombo),
        ),
        shardProcChance: Math.min(
          0.5,
          (
            (s.upgrades.shardChance ?? 0) * 0.0015 +
            (s.masterySkills?.shardAttunement ?? 0) * 0.001 +
            (s.guildPerks?.shardRank ?? 0) * 0.0005 +
            (s.prestigeUpgrades?.shardResonator ?? 0) * 0.0025 +
            getLevelBenefits(Math.max(1, s.level || 1)).shardChance
          ) * 0.5,
        ),
        apexFortuneChance: Math.min(0.45, Math.max(0, Number(s.masterySkills?.apexFortune ?? 0)) * 0.03),
        altar: calculateAltarMultipliers(s),
        basePrestigeDust: calculatePrestigeDust(s.collectionValue ?? 0),
        prestigeDust: calculateCosmicDust(s),
        autoUnlocked: autoUnlocked(s),
        synthesisUnlocked: (s.prestigeUpgrades?.shardSynthesis ?? 0) >= 1 && (s.level ?? 1) >= 20,
      },
      state: s,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to inspect game mechanics.' });
  }
});

debugRouter.post('/currency', async (req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const { coins = 0, shards = 0, dust = 0 } = req.body || {};
    const s = await loadRaw();
    const coinDelta = finiteInteger(coins);
    s.coins = coinDelta >= 0
      ? addCoinAmount(s.coins, coinDelta)
      : Math.max(0, s.coins + coinDelta);
    s.shards = Math.max(0, (s.shards ?? 0) + finiteInteger(shards));
    s.cosmicDust = Math.max(0, (s.cosmicDust ?? 0) + finiteInteger(dust));
    await save(s);
    res.json({ ok: true, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Deliberate single-player test preset. The debug router is server-gated to
 * u/shadow_fen, and the grant fills the bank to its normal one-million-second cap.
 */
debugRouter.post('/time-energy/grant-test', async (_req, res) => {
  try {
    await withPlayerMutationLock(async () => {
      const s = await loadRaw();
      s.timeEnergy = TIME_ENERGY_MAX_MS;
      await save(s);
      res.json({ ok: true, grantedSeconds: TIME_ENERGY_MAX_MS / 1_000, state: s });
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Could not grant test Time Energy.' });
  }
});

// Set a single top-level state field, plus selected nested state groups.
// This intentionally uses an allowlist rather than Object.assign(req.body), so
// admin tooling cannot accidentally overwrite payment receipts or other metadata.
debugRouter.post('/state', async (req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const s = await loadRaw();
    const body = req.body || {};

    const numericFields = [
      'coins', 'cosmicDust', 'xp', 'totalRolls', 'totalCrits',
      'lifetimeCoins', 'highestRarity', 'collectionValue',
      'lifetimeCollectionValue', 'offlineRolls', 'prestigeCount', 'rollsSinceBest',
      'turboRollUntil', 'onlinePlayers', 'purchasedShards',
      'currentRunRolls', 'questsCompleted', 'guildContribution', 'masteryPoints',
      'aftershockRecord', 'rollingSessionStartedAt',
      'rollingSessionLastRollAt', 'longestRollingSessionMs',
      'communityRewardClaimedAt', 'communityRewardClaimedTier',
      'chainPatcherNextRarity', 'chainPatcherCooldownUntil',
      'level', 'levelXpFloor', 'globalBoosterCredits',
    ];

    for (const field of numericFields) {
      if (field in body) (s as any)[field] = nonNegativeInteger(body[field]);
    }
    // Shards support thousandth-unit precision; admin edits must preserve it too.
    for (const field of ['shards', 'lifetimeShards', 'freeShardsEarnedToday']) {
      if (field in body) (s as any)[field] = roundShardAmount(body[field]);
    }
    if ('shardPityRolls' in body) s.shardPityRolls = Math.min(SHARD_PITY_ROLLS_TO_REWARD - 1, nonNegativeInteger(body.shardPityRolls));

    if ('lastRollAt' in body) {
      s.lastRollAt = body.lastRollAt === null ? null : nonNegativeInteger(body.lastRollAt);
    }
    if ('lastSeenAt' in body) s.lastSeenAt = nonNegativeInteger(body.lastSeenAt);
    if ('lastShareAt' in body) s.lastShareAt = body.lastShareAt === null ? undefined : nonNegativeInteger(body.lastShareAt);
    if ('autoRollEnabled' in body) s.autoRollEnabled = Boolean(body.autoRollEnabled);
    for (const field of ['lastFrenzyDate', 'lastFrenzyClaimDate', 'lastDailyReset', 'lastWeeklyReset', 'lastFreeShardReset']) {
      if (typeof body[field] === 'string') (s as any)[field] = body[field];
    }

    if (body.upgrades && typeof body.upgrades === 'object') {
      for (const id of Object.keys(s.upgrades)) {
        if (id in body.upgrades) s.upgrades[id as keyof typeof s.upgrades] = nonNegativeInteger(body.upgrades[id]);
      }
    }

    if (body.prestigeUpgrades && typeof body.prestigeUpgrades === 'object') {
      for (const id of Object.keys(s.prestigeUpgrades)) {
        if (id in body.prestigeUpgrades) s.prestigeUpgrades[id as keyof typeof s.prestigeUpgrades] =
          nonNegativeInteger(body.prestigeUpgrades[id]);
      }
    }

    if (body.masterySkills && typeof body.masterySkills === 'object') {
      for (const id of Object.keys(s.masterySkills ?? {})) {
        if (id in body.masterySkills) (s.masterySkills as Record<string, number>)[id] =
          nonNegativeInteger(body.masterySkills[id]);
      }
    }

    if (body.automations && typeof body.automations === 'object') {
      s.automations = { ...(s.automations ?? {}) };
      for (const id of ['autoQuestClaim', 'autoStreakClaim', 'autoCommunityClaim', 'autoOfflineClaim', 'autoUpgrade']) {
        if (id in body.automations) s.automations[id as keyof NonNullable<typeof s.automations>] = Boolean(body.automations[id]);
      }
    }

    if (body.activeBoosters && typeof body.activeBoosters === 'object') {
      const boosterIds = ['fortune', 'hyperdrive', 'barrage', 'prosperity', 'ascension'] as const;
      // An explicit empty object is the admin/test reset command; partial updates merge.
      s.activeBoosters = Object.keys(body.activeBoosters).length === 0 ? {} : { ...(s.activeBoosters ?? {}) };
      for (const id of boosterIds) {
        if (id in body.activeBoosters) s.activeBoosters[id] = nonNegativeInteger(body.activeBoosters[id]);
      }
    }

    if (body.sacrifices && typeof body.sacrifices === 'object') {
      s.sacrifices = {
        coinsSacrificed: nonNegativeInteger(body.sacrifices.coinsSacrificed, s.sacrifices?.coinsSacrificed ?? 0),
        shardsSacrificed: nonNegativeInteger(body.sacrifices.shardsSacrificed, s.sacrifices?.shardsSacrificed ?? 0),
        altarLevel: nonNegativeInteger(body.sacrifices.altarLevel, s.sacrifices?.altarLevel ?? 0),
        luckSurgeUntil: nonNegativeInteger(body.sacrifices.luckSurgeUntil, s.sacrifices?.luckSurgeUntil ?? 0),
      };
    }

    if (Array.isArray(body.unlockedCosmetics)) {
      s.unlockedCosmetics = body.unlockedCosmetics.filter((v: unknown) => typeof v === 'string').slice(0, 500);
    }

    if (body.collection && typeof body.collection === 'object') {
      const next: Record<string, number> = {};
      for (const [key, value] of Object.entries(body.collection)) {
        const amount = nonNegativeInteger(value);
        if (amount > 0) next[String(key)] = amount;
      }

      // Current Codex data lives in generation-scoped Redis hashes, not in the
      // player JSON. Mark both removed and incoming keys so admin fixtures can
      // replace a collection (including clearing it) through the same save path
      // used by live rolls. Missing keys are written as zero in their shard.
      const affectedRarities = new Set([
        ...Object.keys(s.collection ?? {}),
        ...Object.keys(next),
      ]);
      for (const rarityKey of affectedRarities) markCodexRarityWrite(s, rarityKey);
      s.collection = next;
    }

    if ('xp' in body) s.level = calculateLevelFromXp(s.xp).level;
    if (body.questState === 'ready') {
      for (const quest of [...s.dailyQuests, ...s.weeklyQuests]) {
        quest.unlocked = true;
        quest.progress = quest.target;
        quest.claimed = false;
      }
    }
    if (body.questState === 'reset') {
      for (const quest of [...s.dailyQuests, ...s.weeklyQuests]) {
        quest.progress = 0;
        quest.claimed = false;
      }
    }

    await save(s);
    await recordLeaderboard(s);
    res.json({ ok: true, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to set state.' });
  }
});

debugRouter.post('/preset', async (req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const preset = String(req.body?.preset ?? '').trim();
    const s = await loadRaw();
    const fresh = createInitialState();

    if (preset === 'fresh') {
      Object.assign(s, fresh);
      s.username = context.username ?? s.username;
    } else if (preset === 'max') {
      setMaxProgression(s);
    } else if (preset === 'frenzy-ready') {
      s.lastFrenzyDate = '';
      s.lastFrenzyClaimDate = '';
      s.lastRollAt = 0;
    } else if (preset === 'offline-ready') {
      s.offlineRolls = 1_000;
      s.lastSeenAt = Date.now();
    } else if (preset === 'quests-ready') {
      for (const quest of [...s.dailyQuests, ...s.weeklyQuests]) {
        quest.unlocked = true;
        quest.progress = quest.target;
        quest.claimed = false;
      }
    } else if (preset === 'prestige-ready') {
      s.collectionValue = Math.max(s.collectionValue, 250_000_000);
      s.lifetimeCollectionValue = Math.max(s.lifetimeCollectionValue, s.collectionValue);
      s.lastRollAt = 0;
    } else if (preset === 'booster-test') {
      const now = Date.now();
      s.activeBoosters = {
        fortune: now + 60 * 60 * 1000,
        hyperdrive: now + 60 * 60 * 1000,
        barrage: now + 60 * 60 * 1000,
        prosperity: now + 60 * 60 * 1000,
        ascension: now + 60 * 60 * 1000,
      };
      s.lastRollAt = 0;
    } else if (preset === 'upgrades-max') {
      s.upgrades = {
        speed: 20, multi: 20, clusterRoll: 20, auto: 1, luck: 20,
        coinBonus: 20, shardChance: 20, xpBonus: 20, critChance: 20,
        critPower: 20, offlineRate: 8, valueBonus: 20,
        offlineFoundry: 10, orbFingers: 15, criticalDividend: 20,
      };
    } else if (preset === 'upgrades-reset') {
      s.upgrades = {
        speed: 0, multi: 0, clusterRoll: 0, auto: 1, luck: 0,
        coinBonus: 0, shardChance: 0, xpBonus: 0, critChance: 0,
        critPower: 0, offlineRate: 0, valueBonus: 0,
        offlineFoundry: 0, orbFingers: 0, criticalDividend: 0,
      };
    } else if (preset === 'prestige-max') {
      for (const [id, info] of Object.entries(PRESTIGE_UPGRADES)) {
        s.prestigeUpgrades[id as keyof typeof s.prestigeUpgrades] = info.maxLevel;
      }
    } else if (preset === 'prestige-reset') {
      for (const id of Object.keys(s.prestigeUpgrades)) {
        s.prestigeUpgrades[id as keyof typeof s.prestigeUpgrades] = 0;
      }
    } else if (preset === 'mastery-max') {
      for (const [id, info] of Object.entries(MASTERY_SKILLS)) {
        (s.masterySkills as Record<string, number>)[id] = info.maxLevel;
      }
    } else if (preset === 'mastery-reset') {
      for (const id of Object.keys(s.masterySkills ?? {})) {
        (s.masterySkills as Record<string, number>)[id] = 0;
      }
      s.masteryPoints = 0;
    } else if (preset === 'automations-on') {
      s.automations = {
        autoQuestClaim: true, autoStreakClaim: true, autoCommunityClaim: true,
        autoOfflineClaim: true, autoUpgrade: true,
      };
    } else if (preset === 'automations-off') {
      s.automations = {};
    } else if (preset === 'boosters-off') {
      s.activeBoosters = {};
    } else if (preset === 'collection-clear') {
      s.collection = {};
      s.collectionValue = 0;
      s.highestRarity = 0;
      s.rollsSinceBest = 0;
    } else if (preset === 'quests-reset') {
      for (const quest of [...s.dailyQuests, ...s.weeklyQuests]) {
        quest.progress = 0;
        quest.claimed = false;
      }
    } else if (preset === 'streak-reset') {
      s.streak = { count: 1, lastClaimDate: '', longestStreak: 1 };
    } else if (preset === 'offline-clear') {
      s.offlineRolls = 0;
    } else {
      throw new Error('Unknown admin preset.');
    }

    await save(s);
    await recordLeaderboard(s);
    res.json({ ok: true, preset, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to apply preset.' });
  }
});

debugRouter.post('/reset-cooldown', async (_req, res) => {
  try {
    // Commit the reset and invalidate the old ticket under one player lock.
    // Issue the replacement ticket after releasing it: getRollTicket() takes
    // the same lock internally, so calling it from inside this callback would
    // deadlock the player's mutation queue.
    const state = await withPlayerMutationLock(async () => {
      const s = await loadRaw();
      s.lastRollAt = 0;
      await save(s);

      const userId = String(context.userId ?? '').trim();
      if (userId) await redis.del('io:roll-ticket:' + userId);
      return s;
    });

    const ticket = await getRollTicket();
    res.json({ ok: true, state, ...ticket });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

debugRouter.post('/unlock-upgrades', async (_req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const s = await loadRaw();
    s.upgrades = {
      speed: 20,
      multi: 20,
      clusterRoll: 20,
      auto: 1,
      luck: 20,
      coinBonus: 20,
      shardChance: 20,
      xpBonus: 20,
      critChance: 20,
      critPower: 20,
      offlineRate: 8,
      valueBonus: 20,
      offlineFoundry: 10,
      orbFingers: 15,
      criticalDividend: 20,
    };
    await save(s);
    res.json({ ok: true, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

debugRouter.post('/unlock-everything', async (_req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const s = await loadRaw();
    setMaxProgression(s);
    await save(s);
    await recordLeaderboard(s);
    res.json({ ok: true, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to unlock everything.' });
  }
});

debugRouter.post('/add-offline', async (req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const amount = finiteInteger(req.body?.amount ?? 50);
    const s = await loadRaw();
    s.offlineRolls = Math.min(1_000, Math.max(0, (s.offlineRolls ?? 0) + amount));
    await save(s);
    res.json({ ok: true, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

debugRouter.post('/offline-set', async (req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const s = await loadRaw();
    s.offlineRolls = Math.min(1_000, nonNegativeInteger(req.body?.amount));
    await save(s);
    res.json({ ok: true, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

debugRouter.post('/reset-daily', async (_req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const s = await loadRaw();
    s.lastFrenzyDate = '';
    s.lastFrenzyClaimDate = '';
    s.lastDailyReset = '';
    s.lastWeeklyReset = '';
    s.lastFreeShardReset = '';
    s.streak.lastClaimDate = '';
    s.freeShardsEarnedToday = 0;
    for (const quest of [...s.dailyQuests, ...s.weeklyQuests]) {
      quest.progress = 0;
      quest.claimed = false;
    }
    await save(s);
    res.json({ ok: true, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

debugRouter.post('/force-roll', async (req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const s = await loadRaw();
    const forcedRarity = Math.max(2, finiteInteger(req.body?.rarity, 1_000));
    const source = req.body?.source === 'offline' ? 'offline' : 'online';
    const hasRandomValue = req.body?.randomValue !== undefined;
    const randomValue = Number(req.body?.randomValue);
    if (hasRandomValue && (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1)) {
      throw new Error('randomValue must be a number from 0 inclusive to 1 exclusive.');
    }
    const randomOverride = hasRandomValue ? () => randomValue : undefined;
    const exactRarity = req.body?.exactRarity !== false;
    const { bestOrb, batch, totalVal, coinsGained, shardsGained, xpGained } =
      await applyRolls(s, 1, forcedRarity, source, undefined, randomOverride, exactRarity);
    const now = Date.now();
    s.lastRollAt = now;
    s.lastSeenAt = now;
    await save(s);
    await recordLeaderboard(s);

    res.json({
      orb: bestOrb,
      batch,
      totalValueGained: totalVal,
      totalRollValue: totalVal,
      coinsGained,
      shardsGained,
      xpGained,
      state: s,
      rollsRemainingUntilNext: cooldownMs(s),
      source,
      dramaticReveal: bestOrb.rarity >= 100,
      rollsProcessed: batch.length,
    });
        });} catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


debugRouter.post('/queue-force-roll', async (req, res) => {
  try {
    await withPlayerMutationLock(async () => {
      const s = await loadRaw();
      const forcedRarity = Number(req.body?.rarity);
      if (!Number.isSafeInteger(forcedRarity) || forcedRarity < 2 || forcedRarity > MAX_ORB_RARITY) {
        throw new Error('Choose a whole-number rarity target between 2 and the maximum Orb rarity.');
      }
      const pending = Math.floor(Number(s.chainPatcherNextRarity ?? 0) || 0);
      if (s.adminGuaranteedRollQueued === true) {
        throw new Error('A guaranteed admin roll is already queued. Use it before queueing another.');
      }
      if (pending >= 2 && pending <= MAX_ORB_RARITY) {
        throw new Error('Chain Patcher is already charged. Use it before queueing an admin guaranteed roll.');
      }
      if (pending !== 0) {
        throw new Error('Chain Patcher save data is invalid; repair it before queueing a guaranteed roll.');
      }

      // Reuse the normal next-manual-roll exact-rarity slot. The subsequent
      // /api/roll request performs rewards, progression, and Rift completion.
      s.chainPatcherNextRarity = forcedRarity;
      s.adminGuaranteedRollQueued = true;
      s.autoRollEnabled = false;
      await save(s);
      res.json({ ok: true, queued: true, targetRarity: forcedRarity, state: s });
    });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Could not queue the guaranteed roll.' });
  }
});

debugRouter.post('/frenzy/start', async (req, res) => {
  try {
    const forcedRarity = req.body?.rarity == null ? undefined : Math.max(2, finiteInteger(req.body.rarity));
    const result = await startOrbFrenzy({ bypassDailyLimit: true, forcedRarity, adminTest: true });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to trigger admin Frenzy.' });
  }
});

debugRouter.post('/frenzy/claim', async (req, res) => {
  try {
    const postId = String(req.body?.postId ?? '').trim();
    if (!postId) throw new Error('Frenzy post ID is required.');
    res.json(await claimOrbFrenzy({ allowAdminTestOwner: true, postId }));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to claim admin Frenzy.' });
  }
});

debugRouter.post('/frenzy/reset', async (_req, res) => {
  try {
      await withPlayerMutationLock(async () => {
    const s = await loadRaw();
    s.lastFrenzyDate = '';
    s.lastFrenzyClaimDate = '';
    await save(s);
    res.json({ ok: true, state: s });
        });} catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});


// Game moderation. These actions affect Infinity Orbs accounts only.
// No subreddit moderation API is used here.
debugRouter.get('/moderation/banned', async (_req, res) => {
  try {
    const users = await listGameBans();
    res.json({ users });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load banned game accounts.' });
  }
});

debugRouter.post('/moderation/self-game-ban', async (req, res) => {
  try {
    if (!context.userId) throw new Error('The current game session has no user ID.');
    const durationValue = req.body?.durationDays;
    const durationDays = durationValue === '' || durationValue == null
      ? undefined
      : Math.max(1, finiteInteger(durationValue));
    const ban = await banGameUser({
      userId: context.userId,
      username: normalizeUsername(context.username),
      durationDays,
      reason: String(req.body?.reason ?? 'Self-ban test').slice(0, 300),
      bannedBy: context.username ?? 'shadow_fen',
    });
    res.json({ ok: true, action: 'self-game-ban', ban });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to ban the current game account.' });
  }
});

debugRouter.post('/moderation/ban', async (req, res) => {
  try {
    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    const durationValue = req.body?.durationDays;
    const durationDays = durationValue === '' || durationValue == null
      ? undefined
      : Math.max(1, finiteInteger(durationValue));
    const ban = await banGameUser({
      userId,
      username,
      durationDays,
      reason: String(req.body?.reason ?? 'Game moderation action').slice(0, 300),
      bannedBy: context.username ?? 'shadow_fen',
    });
    res.json({ ok: true, action: 'game-ban', ban });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to ban game account.' });
  }
});

debugRouter.post('/moderation/unban', async (req, res) => {
  try {
    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    const changed = await unbanGameUser(userId);
    res.json({ ok: true, action: 'game-unban', username, userId, changed });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to unban game account.' });
  }
});

debugRouter.post('/moderation/wipe-game', async (req, res) => {
  try {
    const result = await wipeUser(req.body?.username);
    res.json({ ok: true, action: 'wipe-game', ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to wipe player data.' });
  }
});

debugRouter.post('/moderation/wipe-and-unban', async (req, res) => {
  try {
    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    const result = await wipeUser(username);
    await unbanGameUser(userId);
    res.json({ ok: true, action: 'wipe-and-unban', ...result });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to wipe and unban game account.' });
  }
});

debugRouter.post('/moderation/wipe-and-ban', async (req, res) => {
  let banApplied = false;
  try {
    const username = targetUsername(req.body?.username);
    const userId = await resolveUserId(username);
    const durationValue = req.body?.durationDays;
    const durationDays = durationValue === '' || durationValue == null
      ? undefined
      : Math.max(1, finiteInteger(durationValue));

    // Ban first, then wipe without unbanning. If reset fails, the safer partial
    // outcome is a still-banned account, never a wiped account briefly unlocked.
    const ban = await banGameUser({
      userId,
      username,
      durationDays,
      reason: String(req.body?.reason ?? 'Game moderation action').slice(0, 300),
      bannedBy: context.username ?? 'shadow_fen',
    });
    banApplied = true;
    const result = await wipeUser(username, false);
    res.json({ ok: true, action: 'wipe-and-ban', ...result, ban });
  } catch (e: any) {
    res.status(500).json({
      error: e?.message || 'Failed to wipe and ban game account.',
      banApplied,
    });
  }
});

// Reset the current admin's save. Keep this separate from targeted wipes so the
// console's most destructive action is still obvious.
debugRouter.post('/reset-all', async (_req, res) => {
  try {
    await withPlayerMutationLock(async () => {
      const userId = String(context.userId ?? '').trim();
      if (!userId) throw new Error('REDDIT_LOGIN_REQUIRED');

      const { state: fresh } = await resetPlayerGenerationAndSave(
        userId,
        context.username ?? `reddit-user-${userId.slice(-8)}`,
      );
      await redis.del(`io:roll-ticket:${userId}`).catch((error: unknown) => {
        console.error('[Reset All] Roll-ticket cleanup failed after the player reset committed:', error);
      });
      await removeLeaderboardEntry(fresh.username ?? context.username ?? '').catch(error => {
        console.error('[Reset All] Leaderboard cleanup failed after the player reset committed:', error);
      });

      res.json({ ok: true, state: fresh });
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to reset player state.' });
  }
});

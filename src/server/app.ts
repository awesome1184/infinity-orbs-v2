import express from 'express';
import * as analyticsServer from '@devvit/analytics/server/reddit';

// The analytics runtime exposes this adapter, but the published subpath typings omit it.
// The deployment preflight separately verifies the runtime export before upload.
const createTelemetryRouter = (
  analyticsServer as typeof analyticsServer & {
    createTelemetryRouter: () => ReturnType<typeof express.Router>;
  }
).createTelemetryRouter;
import { debugRouter, isDebugUser } from './debug.js';
import { recordPostImpression, recordPlayerActivityForImpressions, recordMainGamePostConversion } from './impressions.js';
import {
  getMe,
  getRollTicket,
  roll,
  buyUpgrade,
  buyUpgradeBatch,
  buyAllUpgrades,
  buyChainPatcher,
  claimOffline,
  subscribeToSubredditFromPrompt,
  claimFollowReward,
  getFollowPromptStats,
  claimDailyStreak,
  claimQuest,
  prestige,
  buyPrestigeUpgrade,
  updateCombatAutoScrapSettings,
  synthesizeDust,
  buyCosmetic,
  activateTurbo,
  activatePremiumBooster,

  buyAutomation,
  claimCommunityReward,
  getOnlinePlayers,
  getGlobalBoosters,
  activateGlobalBooster,
  claimOrbFrenzy,
  postFrenzyThankYouComment,
  getOrbFrenzyInfo,
  getOrbFrenzyClaimProgress,
  getTimeEnergyRollProgress,
  getOrbFrenzyHandoff,
  armOrbFrenzyClaim,
  acknowledgeFrenzyOfflineReward,
  startOrbFrenzy,
  grantPurchasedPack,
  refundPurchasedPack,
  appendPaymentDebugLog,
  getDeveloperAnnouncement,
  getGlobalMenuControl,
  getGlobalFeatureControl,
  getLiveBalanceSnapshot,
  getGlobalBoosterAnnouncement,
  loadRaw,
  recordSocialVisit,
  reserveShareCooldown,
  recordShareQuestProgress,
  save,
  setAutoRollEnabled,
  sacrificeToAltar,
  upgradeMasterySkill,
  getCelestialAlignmentStatus,
  chooseCelestialAlignment,
  getCollectionPage,
  processOfflineFullNotification,
  processManualPushNotificationCampaign,
  processPendingGameUpdateQueue,
  getNotificationPreferences,
  setNotificationPreferences,
  getPopupConfig,
  recordPopupEvent,
  acknowledgeFrenzyShardPopup,
  getFollowRewardStatus,
  settleOffline,
  recordPlayerHeartbeat,
  hasCompletedFirstRollTutorial,
  markFirstRollTutorialSeen,
} from './game.js';
import {
  createGuild,
  guildInfo,
  joinGuild,
  leaveGuild,
  buyGuildPerk,
  setGuildTrust,
  kickGuildMember,
  leaderboard,
  leaderboards,
  recordLeaderboard,
  shareText,
  getCommunityEvent,
  getGlobalChat,
  getGlobalChatStatus,
  registerCurrentPostAsGlobalChatDestination,
  postGlobalChatMessage,
  recordGlobalChatComment,
  resolveGlobalChatCommentAuthor,
  reportGlobalChatMessage,
} from './social.js';
import { context, reddit, redis } from './devvit-mock.js';
import { getPostFlairOptions } from './post-flair.js';

const combatFocusSyncQueues = new Map<string, Promise<unknown>>();

function queueCombatOrbFocusSync(rarity: number, name?: string): void {
  const scope = String(context.username ?? 'anonymous').trim().toLowerCase() || 'anonymous';
  const previous = combatFocusSyncQueues.get(scope) ?? Promise.resolve();
  let next: Promise<unknown>;
  next = previous
    .catch(() => undefined)
    .then(() => setCombatOrbFocus(rarity, name))
    .catch(error => console.error('[Combat Orb Focus] Background sync failed.', error))
    .finally(() => {
      if (combatFocusSyncQueues.get(scope) === next) combatFocusSyncQueues.delete(scope);
    });
  combatFocusSyncQueues.set(scope, next);
}
import { withPlayerMutationLock } from './player-lock.js';
import { beginServerRequest, recordUpgradeBatchDiagnostic } from './server-monitor.js';
import { auditKnownRedisStorage } from './redis-storage-audit.js';
import * as devvitServer from '@devvit/web/server';
import { PURCHASE_PACKS, spendShards, FEATURE_UNLOCK_LEVELS, calculateLevelFromXp, formatRarity, MASTERY_SKILLS, MAX_ORB_RARITY, nextCodexChainRarity, bestCodexChain, codexDevotionLuckPercent, type FeatureId, type MasterySkillId, type UpgradeId } from '../shared/game.js';
import { APP_VERSION } from '../shared/version.js';
import { getRiftChallengeDefinition } from '../shared/rift-challenges.js';
import { globalFeaturesForRequest } from '../shared/admin-cli.js';
import { getCombatSnapshot, getCombatMarksBalance, performCombatBeat, equipCombatItem, scrapCombatItem, forgeCombatGear, equipCombatSkill, rollCombatSkill, rankUpCombatSkillGacha, buyCombatUpgrade, setCombatOrbFocus, getCombatArenaOpponents, challengeCombatArena, setCombatAutoTactic, setCombatDungeon, equipCombatRune, sacrificeCombatRuneInto, updateCombatRuneAutoSacrificeSettings, processCombatRuneAutoSacrifice, hasCompletedCombatTutorial, markCombatTutorialSeen, buyCombatStrategyGuideRank } from './combat.js';
import { getRiftChallengeStatus, startRiftChallenge, rollRiftChallenge, buyRiftChallengeUpgrade, buyRiftPerk, setRiftTemporalDrag, chooseRiftMutation, activateRiftEmergencyProtocol, abandonRiftChallenge, markRiftGameOpened, registerRiftCompletionPost, getRiftCompletionPostInfo, awardRiftCompletionKudos, simulateRiftCompletionKudos } from './rift-challenges.js';

const payments = (devvitServer as typeof devvitServer & {
  payments: {
    getProducts(): Promise<unknown>;
    getOrders(filters: { limit: number; sku?: string; buyer?: string; status?: string }): Promise<unknown>;
  };
}).payments;

type PaymentProduct = {
  sku?: unknown;
};

type PaymentOrder = {
  id?: unknown;
  userId?: unknown;
  user?: unknown;
  buyer?: unknown;
  buyerUserId?: unknown;
  status?: unknown;
  products?: PaymentProduct[];
};

function paymentRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parsePaymentPayload(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

/** Non-guessable tokens are required for locks and idempotency receipts. */
function createSecureId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return prefix + '-' + cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return prefix + '-' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure identifier generation is unavailable.');
}

const secureRequestToken = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
};

function normalizePaymentOrder(value: unknown, depth = 0): PaymentOrder {
  const parsed = parsePaymentPayload(value);
  const record = paymentRecord(parsed);
  if (!record || depth > 4) return {};

  // Devvit sends the Order directly, but accepting common envelopes makes the
  // handler resilient to runtime/proxy serialization differences.
  if (
    'id' in record ||
    'products' in record ||
    'userId' in record ||
    'status' in record ||
    'buyerUserId' in record
  ) {
    return record as PaymentOrder;
  }

  for (const key of ['order', 'data', 'payload', 'result']) {
    if (key in record) {
      const nested = normalizePaymentOrder(record[key], depth + 1);
      if (Object.keys(nested).length > 0) return nested;
    }
  }

  return record as PaymentOrder;
}

function paymentString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function paymentBuyerFromObject(value: unknown): string {
  const record = paymentRecord(value);
  if (!record) return '';

  for (const key of ['userId', 'buyerUserId', 'id']) {
    const candidate = paymentString(record[key]);
    if (candidate) return candidate;
  }

  return '';
}

function paymentProductSku(order: PaymentOrder): string {
  if (!Array.isArray(order.products) || order.products.length !== 1) return '';
  return paymentString(order.products[0]?.sku);
}

function paymentOrderStatus(order: PaymentOrder): string {
  return paymentString(order.status).toUpperCase();
}

function paymentOrderId(order: PaymentOrder): string {
  return paymentString(order.id);
}

async function verifyPaymentOrder(
  orderId: string,
  candidateUserId: string,
  allowedStatuses: string[] = ['PAID'],
): Promise<{ sku: string; status: string } | null> {
  const id = String(orderId ?? '').trim();
  const buyer = String(candidateUserId ?? '').trim();
  if (!id || !buyer) return null;

  try {
    const rawOrders = await payments.getOrders({ limit: 50, buyer });
    const orders = Array.isArray(rawOrders)
      ? rawOrders
      : rawOrders && typeof rawOrders === 'object' && Array.isArray((rawOrders as { orders?: unknown }).orders)
        ? (rawOrders as { orders: unknown[] }).orders
        : [];
    for (const rawOrder of orders) {
      if (!rawOrder || typeof rawOrder !== 'object') continue;
      const candidate = rawOrder as PaymentOrder;
      if (paymentOrderId(candidate) !== id) continue;
      const sku = paymentProductSku(candidate);
      const status = paymentOrderStatus(candidate);
      // Fail closed when provider status is absent as well as when it is not
      // an explicitly permitted state. Never grant from an envelope-only SKU.
      if (!sku || !allowedStatuses.includes(status)) return null;
      return { sku, status };
    }
  } catch (error) {
    await appendPaymentDebugLog('buyer:provider-order-check-failed', {
      orderId: id,
      candidateUserId: buyer,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

async function resolvePaymentBuyerId(
  order: PaymentOrder,
  orderId: string,
  allowedStatuses: string[] = ['PAID'],
): Promise<{ userId: string; sku: string } | null> {
  const directCandidates = [
    paymentString(order.userId),
    paymentString(order.buyerUserId),
    paymentBuyerFromObject(order.buyer),
    paymentBuyerFromObject(order.user),
    paymentString(context.userId),
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(directCandidates)];

  for (const candidate of uniqueCandidates) {
    const verified = await verifyPaymentOrder(orderId, candidate, allowedStatuses);
    if (verified) {
      await appendPaymentDebugLog('buyer:provider-verified', {
        orderId,
        selectedUserId: candidate,
        sku: verified.sku,
        contextUserId: paymentString(context.userId) || null,
      });
      return { userId: candidate, sku: verified.sku };
    }
  }

  await appendPaymentDebugLog('buyer:provider-verification-failed', {
    orderId,
    candidates: uniqueCandidates,
    contextUserId: paymentString(context.userId) || null,
  });
  return null;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(createTelemetryRouter());

  // Track requests in memory only; never persist a per-request log to Redis.
  app.use((req, res, next) => {
    beginServerRequest(
      req.method,
      req.path,
      context.username,
      () => res.statusCode,
      (event, callback) => res.once(event, callback),
    );
    next();
  });

  // Keep the enormous Codex collection out of ordinary client-state payloads.
  // The collection itself remains server-side and is fetched through /api/collection
  // in small pages when the Codex is opened.
  const stripPlayerCollection = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if (
      !Array.isArray(value) &&
      'collection' in value &&
      'coins' in value &&
      'shards' in value &&
      'totalRolls' in value &&
      'highestRarity' in value
    ) {
      const copy = { ...value };
      const sourceCollection = value.collection && typeof value.collection === 'object' && !Array.isArray(value.collection)
        ? value.collection as Record<string, number>
        : {};
      const pendingPatcherRarity = Math.floor(Number(value.chainPatcherNextRarity ?? 0) || 0);
      // Client state intentionally omits the full Codex, so preserve the correct
      // pre-purchase target as a tiny server-calculated projection.
      copy.chainPatcherSuggestedRarity = pendingPatcherRarity >= 2
        ? pendingPatcherRarity
        : nextCodexChainRarity(sourceCollection);
      // Preserve compact Codex Devotion projections before removing the large collection.
      const codexChain = bestCodexChain(sourceCollection);
      copy.codexChain = codexChain.length;
      copy.codexChainStart = codexChain.start;
      copy.codexChainEnd = codexChain.end;
      copy.codexDevotionLuckPercent = codexDevotionLuckPercent(
        copy.masterySkills?.celestialSurge ?? 0,
        codexChain.length,
      );
      copy.collection = {};
      copy.collectionCount = Object.keys(sourceCollection).length;
      return copy;
    }
    if (!Array.isArray(value) && value.state && typeof value.state === 'object') {
      return { ...value, state: stripPlayerCollection(value.state) };
    }
    if (!Array.isArray(value) && value.state?.state && typeof value.state.state === 'object') {
      return { ...value, state: { ...value.state, state: stripPlayerCollection(value.state.state) } };
    }
    return value;
  };

  // Persistent player data is keyed by Reddit user ID. Logged-out users have
  // no account identity, so they must never reach player-state APIs.
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    if (req.path === '/health' || req.path === '/version' || req.path === '/app-info' || req.path === '/impressions') return next();
    const userId = String(context.userId ?? '').trim();
    if (!userId) {
      return res.status(401).json({
        error: 'REDDIT_LOGIN_REQUIRED',
        message: 'Log in to a Reddit account to play Infinity Orbs.',
      });
    }
    next();
  });

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) return next();
    const originalJson = res.json.bind(res);
    res.json = ((body: any) => {
      const errorText = body && typeof body === 'object'
        ? String(body.error ?? body.message ?? '')
        : '';
      const retryableContention =
        body?.code === 'PLAYER_STATE_CONFLICT' ||
        body?.code === 'PLAYER_MUTATION_QUEUED' ||
        body?.error === 'PLAYER_MUTATION_QUEUED' ||
        (/the game is busy finishing another action|another game action is still finishing/i.test(errorText) ||
          (res.statusCode === 503 && /busy|still finishing|changed repeatedly|lease lost|could not safely save/i.test(errorText)));
      if (retryableContention) {
        res.status(503);
        return originalJson(stripPlayerCollection({
          code: 'PLAYER_MUTATION_QUEUED',
          error: 'Your action is queued and will retry automatically.',
          retryAfterMs: 300,
        }));
      }
      return originalJson(stripPlayerCollection(body));
    }) as typeof res.json;
    next();
  });

  // Keep a small in-process FIFO for this runtime. Cross-instance correctness
  // belongs to the domain mutation locks in player-lock.ts and the WATCH/EXEC
  // compare-and-swap writers (Combat, Guilds, and shared projections). A second
  // Redis lease here used a different key/timeout and made every action queue twice.
  const mutationQueues = new Map<string, Promise<void>>();

  app.use('/api', async (req, res, next) => {
    const mutatesState = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const readsAndPersistsPlayerState =
      req.method === 'GET' &&
      ['/me', '/leaderboard', '/guilds'].includes(req.path);
    if (!mutatesState && !readsAndPersistsPlayerState) return next();

    const playerKey = String(context.userId ?? req.ip ?? 'unknown');
    const previous = mutationQueues.get(playerKey) ?? Promise.resolve();
    let releaseLocal!: () => void;
    const current = new Promise<void>(resolve => { releaseLocal = resolve; });
    const chain = previous.then(() => current);
    mutationQueues.set(playerKey, chain);

    await previous;
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      releaseLocal();
      if (mutationQueues.get(playerKey) === chain) mutationQueues.delete(playerKey);
    };

    if (res.destroyed) {
      releaseOnce();
      return;
    }
    res.once('finish', releaseOnce);
    res.once('close', releaseOnce);
    try {
      return next();
    } catch (error) {
      releaseOnce();
      return next(error);
    }
  });

  // Major systems unlock gradually so new players learn the core loop before
  // the advanced economy, social systems, and prestige layers appear.
  const featureForPath = (path: string): FeatureId | null => {
    if (path === '/upgrade' || path === '/upgrade/all' || path === '/upgrade/batch' || path === '/turbo/activate') return 'upgrades';
    if (path === '/products' || path === '/payments/reconcile') return 'shop';
    if (path === '/collection') return 'collection';
    if (path === '/quests/claim' || path === '/streak/claim') return 'quests';
    if (
      path === '/boosters/activate' ||
      path === '/global-boosters/activate' ||
      path === '/automation/buy' ||
      path === '/community/reward/claim'
    ) return 'boosters';
    if (path === '/cosmetics/buy') return 'prestige';
    if (path === '/leaderboard' || path === '/leaderboards' ||
        path === '/guilds' || path.startsWith('/guilds/') ||
        path === '/social/visit' || path === '/world-event' ||
        (path.startsWith('/community/') && path !== '/community/reward/claim')) return 'social';
    if (path.startsWith('/altar/')) return 'altar';
    if (path.startsWith('/mastery/')) return 'mastery';
    if (path === '/prestige' || path.startsWith('/prestige/')) return 'prestige';
    return null;
  };

  app.use('/api', async (req, res, next) => {
    const feature = featureForPath(req.path);
    if (!feature) return next();

    try {
      const s = await loadRaw({ registerActivity: false });
      const requiredLevel = FEATURE_UNLOCK_LEVELS[feature];
      const storedLevel = Math.max(1, Number(s.level) || 1);
      const xpLevel = Math.max(1, calculateLevelFromXp(Number(s.xp) || 0).level);
      const effectiveLevel = Math.max(storedLevel, xpLevel);
      if (effectiveLevel < requiredLevel) {
        return res.status(403).json({
          error: `Reach Level ${requiredLevel} to unlock this feature.`,
          feature,
          requiredLevel,
          currentLevel: effectiveLevel,
        });
      }
    } catch (e) {
      reportRedisTransactionFailure(e);
      console.error('Feature gate check failed:', e);
      if (transientContentionError(e)) {
        return res.status(503).json({ error: 'The game is busy verifying access. Please retry.' });
      }
      return res.status(500).json({ error: 'Could not verify feature access.' });
    }

    next();
  });

  // Game bans are enforced server-side. Banned players can still load /api/me
  // so the client can render the ban screen, and the admin identity can still
  // use /api/dev to unban or otherwise recover the account. Admins do not bypass
  // the game ban for ordinary gameplay endpoints.
  app.use('/api', async (req, res, next) => {
    if (req.path === '/me' || req.path === '/dev' || req.path.startsWith('/dev/')) return next();

    try {
      const { getGameBanStatus } = await import('./game.js');
      const ban = await getGameBanStatus();
      if (ban) {
        return res.status(403).json({
          error: ban.reason || 'Your Infinity Orbs account is banned.',
          gameBan: {
            active: true,
            bannedAt: ban.bannedAt,
            bannedUntil: ban.bannedUntil,
            reason: ban.reason,
          },
        });
      }
    } catch (e) {
      console.error('Game ban check failed:', e);
      return res.status(503).json({
        error: 'Could not verify game ban status. Please retry.',
      });
    }
    next();
  });


  // Global feature switches are enforced server-side, including direct API
  // requests that bypass the client UI. Each mapped request checks the gameplay
  // master switch first, then its parent and subsystem switches. Admin routes,
  // chat reports, and telemetry deliberately remain outside this gate.
  app.use('/api', async (req, res, next) => {
    const features = globalFeaturesForRequest(req.method, req.path);
    if (!features.length) return next();
    try {
      const controls = await Promise.all(features.map(feature => getGlobalFeatureControl(feature)));
      const disabled = controls.find(control => !control.enabled);
      if (disabled) {
        return res.status(403).json({
          error: disabled.reason || 'This feature has been disabled by the developer.',
          feature: disabled.feature,
          featureDisabled: true,
          reason: disabled.reason,
        });
      }
    } catch (error) {
      console.error('[Global Feature Control] Could not verify ' + features.join(', ') + ' status.', error);
      return res.status(503).json({ error: 'Could not verify feature availability. Please retry.' });
    }
    next();
  });

  // Reddit's payment callback should be treated as an untrusted transport
  // envelope. Normalize it first, then resolve the entitlement owner from the
  // order itself, verified order history, or the authenticated Devvit context.
  app.post('/internal/payments/fulfill', async (req, res) => {
    try {
      await appendPaymentDebugLog('fulfill:received', {
        contentType: req.headers['content-type'] ?? null,
        bodyType: typeof req.body,
        bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : null,
        rawBody: (() => {
          try {
            const serialized = JSON.stringify(req.body);
            return serialized.length > 12000 ? serialized.slice(0, 12000) + '…[truncated]' : serialized;
          } catch {
            return String(req.body);
          }
        })(),
      });

      const order = normalizePaymentOrder(req.body);
      const orderId = paymentOrderId(order);
      const envelopeSku = paymentProductSku(order);
      const status = paymentOrderStatus(order);
      const verifiedPayment = await resolvePaymentBuyerId(order, orderId, ['PAID']);
      const buyerUserId = verifiedPayment?.userId ?? '';
      const productSku = verifiedPayment?.sku ?? '';

      console.error('[Payments] Fulfill received:', JSON.stringify({
        id: orderId || null,
        orderUserId: paymentString(order.userId) || null,
        contextUserId: paymentString(context.userId) || null,
        resolvedBuyerUserId: buyerUserId || null,
        status: status || null,
        products: Array.isArray(order.products)
          ? order.products.map(product => ({ sku: paymentString(product?.sku) }))
          : [],
      }));
      await appendPaymentDebugLog('fulfill:normalized', {
        orderId: orderId || null,
        orderUserId: paymentString(order.userId) || null,
        contextUserId: paymentString(context.userId) || null,
        resolvedBuyerUserId: buyerUserId || null,
        status: status || null,
        productSku: productSku || null,
        productCount: Array.isArray(order.products) ? order.products.length : null,
        normalizedOrder: order,
      });

      if (!orderId) {
        return res.json({
          success: false,
          reason: 'Purchase order is missing its order ID.',
        });
      }
      if (!buyerUserId) {
        return res.json({
          success: false,
          reason: 'Payment order could not be verified against its purchasing Reddit account.',
        });
      }
      if (status && status !== 'PAID') {
        return res.json({
          success: false,
          reason: 'Payment order is not marked as PAID.',
        });
      }
      if (!productSku) {
        return res.json({
          success: false,
          reason: envelopeSku
            ? 'Payment order product could not be verified against the provider record.'
            : 'Infinity Orbs purchases must contain one product.',
        });
      }

      await appendPaymentDebugLog('fulfill:before-grant', {
        buyerUserId,
        productSku,
        orderId,
      });
      await grantPurchasedPack(buyerUserId, productSku, orderId);
      await appendPaymentDebugLog('fulfill:handler-success', {
        buyerUserId,
        productSku,
        orderId,
      });
      return res.json({ success: true });
    } catch (e: unknown) {
      console.error('[Payments] Fulfillment failed:', e instanceof Error ? e.stack ?? e.message : e);
      await appendPaymentDebugLog('fulfill:handler-error', {
        errorName: e instanceof Error ? e.name : null,
        errorMessage: e instanceof Error ? e.message : String(e),
        errorStack: e instanceof Error ? (e.stack ?? '').slice(0, 8000) : null,
      });
      return res.json({
        success: false,
        reason: e instanceof Error ? e.message : 'Unable to fulfill purchase.',
      });
    }
  });

  app.post('/internal/payments/refund', async (req, res) => {
    try {
      const order = normalizePaymentOrder(req.body);
      const orderId = paymentOrderId(order);
      const verifiedPayment = await resolvePaymentBuyerId(order, orderId, ['REFUNDED']);
      const buyerUserId = verifiedPayment?.userId ?? '';
      const productSku = verifiedPayment?.sku ?? '';

      if (!buyerUserId || !orderId) {
        return res.json({
          success: false,
          reason: 'Refund order could not be verified against its purchasing Reddit account.',
        });
      }
      if (!productSku) {
        return res.json({
          success: false,
          reason: 'Refund must identify one product.',
        });
      }

      await refundPurchasedPack(buyerUserId, productSku, orderId);
      return res.json({ success: true });
    } catch (e: unknown) {
      console.error('[Payments] Refund failed:', e instanceof Error ? e.stack ?? e.message : e);
      return res.json({
        success: false,
        reason: e instanceof Error ? e.message : 'Unable to process refund.',
      });
    }
  });
  app.post('/api/payments/reconcile', async (req, res) => {
    try {
      const userId = String(context.userId ?? '').trim();
      if (!userId) return res.status(401).json({ error: 'REDDIT_LOGIN_REQUIRED' });
      const requestedOrderId = String(req.body?.orderId ?? '').trim();

      const rawOrders = await payments.getOrders({ limit: 50, buyer: userId });
      const orders = Array.isArray(rawOrders)
        ? rawOrders
        : rawOrders && typeof rawOrders === 'object' && Array.isArray((rawOrders as { orders?: unknown }).orders)
          ? (rawOrders as { orders: unknown[] }).orders
          : [];

      let granted = 0;
      for (const rawOrder of orders) {
        if (!rawOrder || typeof rawOrder !== 'object') continue;
        const order = rawOrder as PaymentOrder;
        const orderId = paymentOrderId(order);
        if (requestedOrderId && orderId !== requestedOrderId) continue;
        const status = paymentOrderStatus(order);
        if (status !== 'PAID') continue;
        if (!orderId) continue;
        const sku = paymentProductSku(order);
        if (!sku) continue;
        try {
          if (await grantPurchasedPack(userId, sku, orderId)) granted++;
        } catch (error) {
          console.error('[Payments] Reconciliation failed for order', orderId, error);
        }
      }

      res.json({ ok: true, granted });
    } catch (e: unknown) {
      console.error('[Payments] Reconciliation lookup failed:', e instanceof Error ? e.stack ?? e.message : e);
      res.status(500).json({ error: e instanceof Error ? e.message : 'Unable to reconcile purchases.' });
    }
  });

  app.get('/api/products', async (_req, res) => {
    const fallbackProducts = PURCHASE_PACKS.map(pack => ({
      sku: pack.sku,
      displayName: pack.name,
      description: pack.description,
      price: pack.priceGold,
    }));

    try {
      const raw = await payments.getProducts();
      const products = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { products?: unknown }).products)
          ? (raw as { products: unknown[] }).products
          : null;

      if (!products) {
        console.error('[Payments] Product lookup returned an unexpected response shape.');
        return res.json(fallbackProducts);
      }

      const normalized = products
        .filter((product): product is Record<string, unknown> => Boolean(product) && typeof product === 'object')
        .map(product => ({
          sku: String(product.sku ?? ''),
          displayName: String(product.displayName ?? 'Shard Pack'),
          description: String(product.description ?? ''),
          price: Number(product.price ?? 0),
        }))
        .filter(product => product.sku && Number.isFinite(product.price) && product.price > 0);

      return res.json(normalized.length > 0 ? normalized : fallbackProducts);
    } catch (e: unknown) {
      console.error('[Payments] Product lookup failed:', e instanceof Error ? e.stack ?? e.message : e);
      // Keep the shop usable in playtest if the payment catalog lookup is temporarily unavailable.
      return res.json(fallbackProducts);
    }
  });

  app.post('/internal/scheduler/offline-orbs-full', async (req, res) => {
    try {
      const data = req.body?.data ?? {};
      const userId = String(data.userId ?? '').trim();
      const subredditName = String(data.subredditName ?? '').trim();
      const jobToken = String(data.jobToken ?? '').trim();
      if (!userId || !subredditName) {
        return res.status(400).json({ status: 'error', message: 'Missing offline notification job data.' });
      }
      await processOfflineFullNotification(userId, subredditName, jobToken || undefined);
      return res.status(200).json({ status: 'ok' });
    } catch (e) {
      console.error('Offline-orbs-full scheduler failed:', e);
      return res.status(200).json({ status: 'error' });
    }
  });

  app.post('/internal/scheduler/manual-push-broadcast', async (req, res) => {
    try {
      const data = req.body?.data ?? {};
      await processManualPushNotificationCampaign({
        campaignId: data.campaignId,
        cursor: data.cursor,
      });
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('[Notification Broadcast] Scheduler worker failed:', error);
      return res.status(200).json({ status: 'error' });
    }
  });

  app.post('/internal/scheduler/pending-game-update-drain', async (req, res) => {
    try {
      const data = req.body?.data ?? {};
      await processPendingGameUpdateQueue({
        token: data.token,
        cursor: data.cursor,
      });
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('[Notification Broadcast] Queued update worker failed:', error);
      return res.status(200).json({ status: 'error' });
    }
  });

  app.post('/internal/menu/post-create', async (_req, res) => {
    try {
      const subredditName = context.subredditName;
      if (!subredditName) return res.status(400).json({ showToast: 'No subreddit context available.' });
      const post = await reddit.submitCustomPost({
        title: 'Infinity Orbs',
        entry: 'default',
      });
      await redis.set('io:global-game-post-id', post.id);
      res.json({ navigateTo: `https://reddit.com/r/${subredditName}/comments/${post.id}` });
    } catch (e) {
      console.error('Failed to create Infinity Orbs post:', e);
      res.status(400).json({ showToast: 'Failed to create Infinity Orbs post.' });
    }
  });

  // The v2.2.11 production upgrade performs a strictly read-only storage audit.
  const REDIS_STORAGE_AUDIT_VERSION = '2.2.25';
  app.post('/internal/on-app-upgrade', async (_req, res) => {
    const subredditName = String(context.subredditName ?? '').trim().replace(/^r\//i, '').toLowerCase();
    if (subredditName !== 'infinityorbs') {
      return res.status(200).json({ status: 'skipped', version: APP_VERSION, subredditName });
    }
    if (String(APP_VERSION) !== REDIS_STORAGE_AUDIT_VERSION) {
      return res.status(200).json({ status: 'skipped', version: APP_VERSION, subredditName });
    }
    try {
      const report = await auditKnownRedisStorage(redis);
      // One labelled JSON line keeps the report easy to capture from Codespaces.
      console.warn('[Redis Storage Audit] READ ONLY REPORT ' + JSON.stringify(report));
      return res.status(200).json({
        status: 'audited',
        generatedAt: report.generatedAt,
        indexedPlayersAudited: report.indexedPlayersAudited,
        indexedPlayersTotal: report.indexedPlayersTotal,
        knownIndexedPayloadBytes: report.knownIndexedPayloadBytes,
        groups: report.groups,
        errors: report.errors,
      });
    } catch (error) {
      console.error('[Redis Storage Audit] Read-only audit failed during app upgrade:', error);
      return res.status(200).json({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post('/internal/on-app-install', async (_req, res) => {
    try {
      const subredditName = context.subredditName;
      if (!subredditName) return res.status(400).json({ status: 'error', message: 'No subreddit context available.' });
      const post = await reddit.submitCustomPost({
        title: 'Infinity Orbs',
        entry: 'default',
      });
      await redis.set('io:global-game-post-id', post.id);
      res.json({ status: 'success', message: `Created Infinity Orbs post ${post.id} in r/${subredditName}.` });
    } catch (e) {
      console.error('Failed to create install post:', e);
      res.status(400).json({ status: 'error', message: 'Failed to create Infinity Orbs post.' });
    }
  });

  app.get('/api/notifications', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(await getNotificationPreferences());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load notification settings.' });
    }
  });

  app.post('/api/notifications', async (req, res) => {
    try {
      // Keep compatibility with older clients that still send { enabled }.
      const result = typeof req.body?.enabled === 'boolean'
        ? await setNotificationPreferences({ updates: req.body.enabled, offlineOrbs: req.body.enabled })
        : await setNotificationPreferences({
            ...(typeof req.body?.updates === 'boolean' ? { updates: req.body.updates } : {}),
            ...(typeof req.body?.offlineOrbs === 'boolean' ? { offlineOrbs: req.body.offlineOrbs } : {}),
          });
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Could not update notification settings.' });
    }
  });

  app.get('/api/popups/config', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ config: await getPopupConfig() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load popup settings.' });
    }
  });

  app.post('/api/popups/track', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await recordPopupEvent(req.body?.popup, req.body?.event));
    } catch (e: any) {
      console.error('[Popup Analytics] Failed to persist popup event:', e);
      res.status(500).json({ error: e?.message || 'Could not record popup activity.' });
    }
  });

  app.get('/api/follow-reward/status', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await getFollowRewardStatus());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load subreddit reward status.' });
    }
  });

  app.get('/api/developer-announcement', async (_req, res) => {
    try {
      res.json(await getDeveloperAnnouncement());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to fetch developer announcement.' });
    }
  });

  app.get('/api/menu-control', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(await getGlobalMenuControl());
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : 'Could not load global menu settings.' });
    }
  });

  app.get('/api/live-balance', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(await getLiveBalanceSnapshot());
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : 'Could not load live balance settings.' });
    }
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({ version: APP_VERSION });
  });

  app.get('/api/app-info', (_req, res) => {
    const subredditName = String(context.subredditName ?? '').trim().replace(/^r\//i, '').toLowerCase();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ isBeta: subredditName === 'infinity_orbs_dev' });
  });

  // Public post previews personalize their CTA without recording a player visit.
  app.get('/api/player/experience', async (_req, res) => {
    try {
      const player = await loadRaw({ registerActivity: false });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ playedBefore: Number(player.totalRolls) > 0 || Number(player.level) > 1 || Number(player.collectionValue) > 0 });
    } catch (error: any) {
      const message = error?.message || 'Could not read player experience.';
      res.status(message === 'REDDIT_LOGIN_REQUIRED' ? 401 : 503).json({ error: message });
    }
  });

  app.get('/api/combat/marks', async (_req, res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json({combatMarks: await getCombatMarksBalance()}); }
    catch (e:any) { const message=e?.message||'Could not load Combat Marks.';res.status(message==='REDDIT_LOGIN_REQUIRED'?401:503).json({error:message}); }
  });
  app.get('/api/combat/state', async (_req, res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await getCombatSnapshot()); }
    catch (e:any) { const message=e?.message||'Could not load combat state.';res.status(message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500).json({error:message}); }
  });
  app.post('/api/combat/runes/equip', async (req,res) => {
    const runeId=req.body?.runeId, equip=req.body?.equip;
    if(typeof runeId!=='string'||!runeId.trim()||runeId.length>160)return res.status(400).json({error:'A valid Rune is required.'});
    if(typeof equip!=='boolean')return res.status(400).json({error:'Rune equip state must be true or false.'});
    try{res.setHeader('Cache-Control','no-store');res.json(await equipCombatRune(runeId,equip));}
    catch(e:any){const message=e?.message||'Could not update Rune loadout.';const status=message==='Rune is not in your inventory.'?404:message==='A valid Rune is required.'||message.startsWith('All Rune slots are full.')?400:message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500;res.status(status).json({error:message});}
  });
  app.post('/api/combat/runes/sacrifice', async (req,res) => {
    const targetRuneId=req.body?.targetRuneId, donorRuneId=req.body?.donorRuneId;
    if(typeof targetRuneId!=='string'||!targetRuneId.trim()||targetRuneId.length>160||
       typeof donorRuneId!=='string'||!donorRuneId.trim()||donorRuneId.length>160)
      return res.status(400).json({error:'A valid Rune is required.'});
    if(targetRuneId===donorRuneId)return res.status(400).json({error:'Choose two different Runes.'});
    try{res.setHeader('Cache-Control','no-store');res.json(await sacrificeCombatRuneInto(targetRuneId,donorRuneId));}
    catch(e:any){const message=e?.message||'Could not sacrifice Rune.';
      const status=message==='Rune is not in your inventory.'?404:message==='A valid Rune is required.'||message==='Choose two different Runes.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500;
      res.status(status).json({error:message});}
  });
  app.post('/api/combat/runes/auto-sacrifice/settings', async (req,res) => {
    const enabled=req.body?.enabled, maxRarity=req.body?.maxRarity;
    const targetRuneId=req.body?.targetRuneId, preserveSpecialEffects=req.body?.preserveSpecialEffects;
    if(typeof enabled!=='boolean'||typeof maxRarity!=='string'||
       (targetRuneId!==undefined&&targetRuneId!==null&&typeof targetRuneId!=='string')||
       (preserveSpecialEffects!==undefined&&typeof preserveSpecialEffects!=='boolean')) {
      return res.status(400).json({error:'Auto-sacrifice settings are invalid.'});
    }
    try{
      res.setHeader('Cache-Control','no-store');
      res.json(await updateCombatRuneAutoSacrificeSettings(enabled,maxRarity,targetRuneId,preserveSpecialEffects));
    } catch(e:any) {
      const message=e?.message||'Could not update Auto Sacrifice settings.';
      const status=message==='Auto-sacrifice settings are invalid.'||message==='Auto-sacrifice target Rune is not in your inventory.'||message==='Auto-sacrifice target Rune must be equipped.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500;
      res.status(status).json({error:message});
    }
  });
  app.post('/api/combat/runes/auto-sacrifice/run', async (_req,res) => {
    try{res.setHeader('Cache-Control','no-store');res.json(await processCombatRuneAutoSacrifice());}
    catch(e:any){const message=e?.message||'Could not auto-sacrifice Runes.';const status=message==='Equip at least one Rune before auto-sacrifice can strengthen a target.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500;res.status(status).json({error:message});}
  });
  app.get('/api/tutorial/first-roll/status', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ seen: await hasCompletedFirstRollTutorial() });
    } catch (error: any) {
      const message = error?.message || 'Could not load tutorial status.';
      res.status(message === 'REDDIT_LOGIN_REQUIRED' ? 401 : 503).json({ error: message });
    }
  });
  app.post('/api/tutorial/first-roll/complete', async (_req, res) => {
    try {
      await markFirstRollTutorialSeen();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ seen: true });
    } catch (error: any) {
      const message = error?.message || 'Could not save tutorial completion.';
      res.status(message === 'REDDIT_LOGIN_REQUIRED' ? 401 : 503).json({ error: message });
    }
  });

  app.get('/api/combat/tutorial/status', async (_req,res) => {
    try{res.setHeader('Cache-Control','no-store');res.json({seen:await hasCompletedCombatTutorial()});}
    catch(e:any){const message=e?.message||'Could not load tutorial status.';res.status(message==='REDDIT_LOGIN_REQUIRED'?401:503).json({error:message});}
  });
  app.post('/api/combat/tutorial/complete', async (_req,res) => {
    try{await markCombatTutorialSeen();res.setHeader('Cache-Control','no-store');res.json({seen:true});}
    catch(e:any){const message=e?.message||'Could not save tutorial completion.';res.status(message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500).json({error:message});}
  });
  app.post('/api/combat/beat', async (req,res) => {
    const sequence=req.body?.sequence, intent=req.body?.intent;
    if(!Number.isSafeInteger(sequence)||sequence<1)return res.status(400).json({error:'A valid combat sequence is required.'});
    if(!['auto','strike','heavy','guard','mend','ability'].includes(intent))return res.status(400).json({error:'Invalid combat command.'});
    if(intent==='ability'&&(typeof req.body?.skillId!=='string'||req.body.skillId.length>100))return res.status(400).json({error:'A valid active ability is required.'});
    try { res.setHeader('Cache-Control','no-store');res.json(await performCombatBeat(sequence,intent,req.body?.skillId)); }
    catch(e:any){const message=e?.message||'Combat beat failed.';const status=message==='stale combat sequence'||message==='Ability is on cooldown.'||message==='No player action is ready for this ability.'?409:message==='REDDIT_LOGIN_REQUIRED'?401:message.startsWith('COMBAT_BEAT_TOO_SOON:')?429:message==='Combat state changed repeatedly. Please retry.'?503:['Invalid combat command.','Choose a valid equipped ability.','Ability is not equipped.','Not enough energy for this ability.'].includes(message)?400:500;res.status(status).json({error:message});}
  });
  app.post('/api/combat/dungeon', async (req,res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await setCombatDungeon(req.body?.dungeonId)); }
    catch(e:any) { const message=e?.message||'Could not switch dungeon.'; res.status(message==='REDDIT_LOGIN_REQUIRED'?401:message==='Invalid combat dungeon.'?400:503).json({error:message}); }
  });
  app.post('/api/combat/tactics', async (req,res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await setCombatAutoTactic(req.body?.tactic)); }
    catch(e:any) { const message=e?.message||'Could not update combat tactic.'; res.status(message==='REDDIT_LOGIN_REQUIRED'?401:message==='Invalid combat tactic.'?400:503).json({error:message}); }
  });
  app.post('/api/combat/equip', async (req,res) => {
    const itemId=req.body?.itemId;
    if(typeof itemId!=='string'||!itemId.trim()||itemId.length>160)return res.status(400).json({error:'A valid gear item is required.'});
    try{res.setHeader('Cache-Control','no-store');res.json(await equipCombatItem(itemId));}
    catch(e:any){const message=e?.message||'Could not equip gear.';const status=message==='item not owned'?404:message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500;res.status(status).json({error:message});}
  });
  app.post('/api/combat/gear/scrap', async (req,res) => {
    try { res.setHeader('Cache-Control','no-store');res.json(await scrapCombatItem(req.body?.itemId)); }
    catch(e:any) { const message=e?.message||'Could not scrap gear.';const status=message==='A valid gear item is required.'||message==='Gear item is not in your inventory.'||message==='Unequip this item before scrapping it.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:503;res.status(status).json({error:message}); }
  });
  app.post('/api/combat/forge', async (req,res) => {
    try { res.setHeader('Cache-Control','no-store');res.json(await forgeCombatGear(req.body?.slot,req.body?.quality)); }
    catch(e:any) { const message=e?.message||'Forge failed.';const status=message==='Choose a valid equipment slot for the Forge.'||message==='Choose a valid item quality for the Forge.'||message==='Not enough Scrap to forge this item.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:503;res.status(status).json({error:message}); }
  });
  app.post('/api/combat/auto-scrap', async (req,res) => {
    try {
      const settings=await updateCombatAutoScrapSettings(req.body?.enabled,req.body?.maxQuality);
      await getCombatSnapshot();
      res.setHeader('Cache-Control','no-store');res.json({settings});
    } catch(e:any) { const message=e?.message||'Could not update Auto Scrap settings.';const status=message==='Auto Scrap Prestige upgrade is required.'||message==='Auto Scrap quality threshold must be between 0 and 100.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:503;res.status(status).json({error:message}); }
  });
  app.post('/api/combat/skills/roll', async (req,res) => {
    const count = req.body?.count === 10 ? 10 : 1;
    try{res.setHeader('Cache-Control','no-store');res.json(await rollCombatSkill(count));}
    catch(e:any){const message=e?.message||'Skill roll failed.';const status=message.startsWith('Not enough Combat Marks')?400:message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500;res.status(status).json({error:message});}
  });
  app.post('/api/combat/skills/equip', async (req,res) => {
    const skillId=req.body?.skillId;
    if(typeof skillId!=='string'||!skillId.trim()||skillId.length>100)return res.status(400).json({error:'A valid combat ability is required.'});
    if(typeof req.body?.equip!=='boolean')return res.status(400).json({error:'A boolean equip value is required.'});
    try{res.setHeader('Cache-Control','no-store');res.json(await equipCombatSkill(skillId,req.body.equip));}
    catch(e:any){const message=e?.message||'Could not update ability loadout.';const status=message==='Ability not owned.'||message==='All active ability slots are full.'||message==='Invalid combat ability.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:503;res.status(status).json({error:message});}
  });
  app.post('/api/combat/skills/rank-up', async (_req,res) => {
    try{res.setHeader('Cache-Control','no-store');res.json(await rankUpCombatSkillGacha());}
    catch(e:any){const message=e?.message||'Could not rank up Skill Gacha.';const status=message.startsWith('Need ')||message==='Not enough Combat Marks to rank up the Skill Gacha.'||message==='Skill Gacha is already max rank.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:503;res.status(status).json({error:message});}
  });
    app.post('/api/combat/strategy-guide/buy', async (_req,res) => {
    try{res.setHeader('Cache-Control','no-store');res.json(await buyCombatStrategyGuideRank());}
    catch(e:any){
      const message=e?.message||'Strategy Guide purchase failed.';
      const status=message==="Need a Tactician's Manual."||message==='Not enough Combat Marks for Strategy Guide.'||message==='Strategy Guide is already max rank.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500;
      res.status(status).json({error:message});
    }
  });
  app.post('/api/combat/upgrades/buy', async (req,res) => {
    try{res.setHeader('Cache-Control','no-store');res.json(await buyCombatUpgrade(req.body?.upgradeId));}
    catch(e:any){const message=e?.message||'Combat upgrade failed.';const status=message==='Not enough Combat Marks.'||message==='Combat upgrade is already max rank.'||message==='Invalid combat upgrade.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:503;res.status(status).json({error:message});}
  });
    app.get('/api/combat/arena/opponents', async (_req,res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await getCombatArenaOpponents()); }
    catch(e:any) { const message=e?.message||'Could not load Arena opponents.'; res.status(message==='REDDIT_LOGIN_REQUIRED'?401:503).json({error:message}); }
  });
  app.post('/api/combat/arena/challenge', async (req,res) => {
    const opponentId=req.body?.opponentId;
    if(typeof opponentId!=='string'||!opponentId.trim()||opponentId.length>256) return res.status(400).json({error:'A valid Arena opponent is required.'});
    try { res.setHeader('Cache-Control','no-store'); res.json(await challengeCombatArena(opponentId)); }
    catch(e:any) {
      const message=e?.message||'Arena challenge failed.';
      const targetCooldown=message.startsWith('ARENA_OPPONENT_COOLDOWN:');
      const status=message==='REDDIT_LOGIN_REQUIRED'?401:message==='ARENA_SELF_CHALLENGE'?400:message==='ARENA_OPPONENT_UNAVAILABLE'?404:message.startsWith('ARENA_COOLDOWN:')||targetCooldown?429:message==='Combat state changed repeatedly. Please retry.'?503:500;
      res.status(status).json({error:message.startsWith('ARENA_COOLDOWN:')?'Your next Arena challenge is not ready yet.':targetCooldown?'This opponent was challenged recently. Choose another opponent.':message,...(message.startsWith('ARENA_COOLDOWN:')?{retryAfterMs:Math.max(0,Number(message.slice('ARENA_COOLDOWN:'.length))||0)}:targetCooldown?{retryAfterMs:Math.max(0,Number(message.slice('ARENA_OPPONENT_COOLDOWN:'.length))||0)}:{})});
    }
  });

  app.get('/api/rift-challenges', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await getRiftChallengeStatus());
    } catch (error: any) {
      const message = error?.message || 'Could not load Rift Challenges.';
      res.status(message === 'REDDIT_LOGIN_REQUIRED' ? 401 : transientContentionError(error) ? 503 : 500)
        .json({ error: message });
    }
  });

  app.post('/api/rift-challenges/mark-opened', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await markRiftGameOpened());
    } catch (error: any) {
      const message = error?.message || 'Could not record game entry.';
      res.status(message === 'REDDIT_LOGIN_REQUIRED' ? 401 : 500).json({ error: message });
    }
  });

  app.get('/api/rift-completion/info', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const postId = typeof req.query.postId === 'string' ? req.query.postId : undefined;
      res.json(await getRiftCompletionPostInfo(postId));
    } catch (error: any) {
      const message = error?.message || 'Could not load this Rift completion post.';
      res.status(message === 'REDDIT_LOGIN_REQUIRED' ? 401 : 404).json({ error: message });
    }
  });

  app.post('/api/rift-completion/simulator/create', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const viewerId = String(context.userId ?? '').trim();
      if (!viewerId) throw new Error('REDDIT_LOGIN_REQUIRED');
      const challenge = getRiftChallengeDefinition(req.body?.challengeId);
      if (!challenge) throw new Error('Choose a valid Rift challenge to preview.');
      const cryptoApi = globalThis.crypto;
      if (!cryptoApi?.getRandomValues) throw new Error('Secure preview ID generation is unavailable.');
      const makeId = () => {
        if (typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
        return Array.from(cryptoApi.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
      };
      const ownerId = 'simulated-rift-owner:' + viewerId;
      const ownerUsername = String(context.username ?? 'Redditor').trim().replace(/^u\//i, '').slice(0, 32) || 'Redditor';
      const subredditName = String(context.subredditName ?? '').trim().replace(/^r\//i, '').slice(0, 100);
      if (!subredditName) throw new Error('Subreddit context is unavailable for the simulated post.');
      const createdAt = Date.now();
      const postId = 't3_sim_rift_preview-' + makeId();
      const runId = 'rift-post-simulator-' + makeId();
      const title = 'u/' + ownerUsername + ' has completed the Rift ' + challenge.name + ' for the first time!';
      const postBody = 'u/' + ownerUsername + ' has completed the rift ' + challenge.name + ' for the first time!\n\n' +
        'Celebrate this first clear with Kudos. Each player can send Kudos once, during the first 24 hours after the post is published.\n\n' +
        'Kudos gives you +10 Shards, gives the Rift champion +10 Shards, and adds 1 minute of progress to their Rift bar.\n\n' +
        'Use the buttons below to open Infinity Orbs or send Kudos. Sending Kudos will not open the game.';
      await registerRiftCompletionPost({
        postId,
        runId,
        ownerId,
        ownerUsername,
        challengeId: challenge.id,
        challengeName: challenge.name,
        subredditName,
        createdAt,
      });
      res.json({
        postId,
        title,
        body: postBody,
        subredditName,
        ownerUsername,
        runAs: 'USER',
        entry: 'rift',
        flairId: null,
        challengeId: challenge.id,
        challengeName: challenge.name,
        createdAt,
        expiresAt: createdAt + 24 * 60 * 60_000,
      });
    } catch (error: any) {
      const message = error?.message || 'Could not create the Rift post simulation.';
      res.status(message === 'REDDIT_LOGIN_REQUIRED' ? 401 : 400).json({ error: message });
    }
  });

  app.post('/api/rift-completion/simulator/kudos', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await simulateRiftCompletionKudos(req.body?.postId));
    } catch (error: any) {
      const message = error?.message || 'Could not simulate Kudos.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : /24 hours|owner/i.test(message) ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/rift-completion/kudos', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await awardRiftCompletionKudos(req.body?.postId));
    } catch (error: any) {
      const message = error?.message || 'Could not send Kudos.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : /already kudosed|24 hours|own Rift/i.test(message) ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/rift-challenges/start', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(await startRiftChallenge(req.body?.challengeId, req.body?.blueprintId));
    } catch (error: any) {
      const message = error?.message || 'Could not start this challenge.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : message.includes('Reach Level') || message.includes('Complete ') ||
          message.includes('already have an active challenge') || message.includes('valid Rift Challenge') ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/rift-challenges/roll', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const runId = req.body?.runId;
      if (typeof runId !== 'string' || runId.length > 120) {
        return res.status(400).json({ error: 'The challenge run ID is missing. Refresh and try again.' });
      }
      res.json(await rollRiftChallenge(runId));
    } catch (error: any) {
      const message = error?.message || 'Challenge roll failed.';
      if (message.startsWith('RIFT_CHALLENGE_COOLDOWN:')) {
        const retryAfterMs = Math.max(0, Number(message.slice('RIFT_CHALLENGE_COOLDOWN:'.length)) || 0);
        return res.status(429).json({ error: 'Your challenge roll is not ready yet.', retryAfterMs });
      }
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : message === 'CHALLENGE_RUN_MISMATCH' ? 409
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message === 'CHALLENGE_RUN_MISMATCH' ? 'This challenge run changed in another tab. Refresh before continuing.' : message });
    }
  });

  app.post('/api/rift-challenges/upgrade', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const upgradeId = req.body?.upgradeId;
      if (typeof upgradeId !== 'string' || upgradeId.length > 40) {
        return res.status(400).json({ error: 'Choose a valid challenge upgrade.' });
      }
      const runId = req.body?.runId;
      if (typeof runId !== 'string' || runId.length > 120) {
        return res.status(400).json({ error: 'The challenge run ID is missing. Refresh and try again.' });
      }
      res.json(await buyRiftChallengeUpgrade(upgradeId, runId));
    } catch (error: any) {
      const message = error?.message || 'Challenge upgrade failed.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : message === 'CHALLENGE_RUN_MISMATCH' ? 409
        : message.startsWith('Need ') || message.startsWith('Main-game requirement') ||
          message.includes('already at maximum') || message.includes('valid challenge upgrade') ||
          message.includes('There is no active Rift Challenge') ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message === 'CHALLENGE_RUN_MISMATCH' ? 'This challenge run changed in another tab. Refresh before continuing.' : message });
    }
  });

  app.post('/api/rift-challenges/perk', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const perkId = req.body?.perkId;
      if (typeof perkId !== 'string' || perkId.length > 40) {
        return res.status(400).json({ error: 'Choose a valid Rift perk.' });
      }
      res.json(await buyRiftPerk(perkId));
    } catch (error: any) {
      const message = error?.message || 'Rift perk purchase failed.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : message.startsWith('Need ') || message.includes('already at maximum') ||
          message.includes('valid Rift perk') ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/rift-challenges/mutation', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const runId = req.body?.runId;
      if (typeof runId !== 'string' || runId.length > 120) {
        return res.status(400).json({ error: 'The active Rift run ID is missing. Refresh and try again.' });
      }
      res.json(await chooseRiftMutation(req.body?.mutationId, runId));
    } catch (error: any) {
      const message = error?.message || 'Rift Mutation could not be activated.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : message === 'CHALLENGE_RUN_MISMATCH' ? 409
        : message.includes('valid Rift Mutation') || message.includes('was not offered') ||
          message.includes('already active') ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/rift-challenges/emergency', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const runId = req.body?.runId;
      if (typeof runId !== 'string' || runId.length > 120) {
        return res.status(400).json({ error: 'The active Rift run ID is missing. Refresh and try again.' });
      }
      res.json(await activateRiftEmergencyProtocol(runId));
    } catch (error: any) {
      const message = error?.message || 'Emergency Protocol could not be activated.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : message === 'CHALLENGE_RUN_MISMATCH' ? 409
        : message.includes('must be unlocked') || message.includes('charges remain') ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/rift-challenges/temporal-drag', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const multiplier = req.body?.multiplier;
      const runId = req.body?.runId;
      if (typeof runId !== 'string' || runId.length > 120) {
        return res.status(400).json({ error: 'The active Rift run ID is missing. Refresh and try again.' });
      }
      res.json(await setRiftTemporalDrag(multiplier, runId));
    } catch (error: any) {
      const message = error?.message || 'Temporal Drag could not be updated.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : message === 'CHALLENGE_RUN_MISMATCH' ? 409
        : message.includes('Temporal Drag must be') ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/rift-challenges/abandon', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const runId = req.body?.runId;
      if (typeof runId !== 'string' || runId.length > 120) {
        return res.status(400).json({ error: 'The challenge run ID is missing. Refresh and try again.' });
      }
      res.json(await abandonRiftChallenge(runId));
    } catch (error: any) {
      const message = error?.message || 'Could not abandon this challenge.';
      const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401
        : message === 'CHALLENGE_RUN_MISMATCH' ? 409
        : message.includes('There is no active challenge') ? 400
        : transientContentionError(error) ? 503 : 500;
      res.status(status).json({ error: message === 'CHALLENGE_RUN_MISMATCH' ? 'This challenge run changed in another tab. Refresh before continuing.' : message });
    }
  });

  app.get('/api/me', async (_req, res) => {
    try { res.json(await getMe()); }
    catch (e: any) {
      reportRedisTransactionFailure(e);
      console.error('[API /api/me] Failed:', e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e) ? 'Player data is busy updating. Please retry.' : e?.message || 'Failed to fetch player state.',
      });
    }
  });

  app.get('/api/collection', async (req, res) => {
    try {
      const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0) || 0));
      const limit = Math.min(100, Math.max(1, Math.floor(Number(req.query.limit ?? 60) || 60)));
      const sortValue = String(req.query.sort ?? 'rarity_desc');
      const sort =
        sortValue === 'rarity_asc' || sortValue === 'count'
          ? sortValue
          : 'rarity_desc';
      const tier = String(req.query.tier ?? 'all');
      res.json(await getCollectionPage({ offset, limit, tier, sort }));
    } catch (e: any) {
      reportRedisTransactionFailure(e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e) ? 'The Codex is busy updating. Please retry.' : e?.message || 'Failed to fetch Codex entries.',
      });
    }
  });

  app.get('/api/leaderboard', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      res.json(await leaderboard());
    } catch (e: any) {
      reportRedisTransactionFailure(e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e) ? 'Leaderboard is busy updating. Please retry.' : e?.message || 'Failed to fetch leaderboard.',
      });
    }
  });

  app.get('/api/leaderboards', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    try {
      res.json(await leaderboards({ fresh: req.query.fresh === '1' }));
    } catch (e: any) {
      reportRedisTransactionFailure(e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e) ? 'Leaderboards are busy updating. Please retry.' : e?.message || 'Failed to fetch leaderboards.',
      });
    }
  });

  app.post('/api/dev/chat/register-current-post', async (_req, res) => {
    if (!isDebugUser()) return res.status(403).json({ error: 'Admin access required.' });
    try {
      const result = await registerCurrentPostAsGlobalChatDestination();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, ...result });
    } catch (e: any) {
      const message = e?.message || 'Could not register the main Game post for Global Chat.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/chat/status', async (_req, res) => {
    try {
      res.json(await getGlobalChatStatus());
    } catch (e) { badRequest(res, e, 'Could not determine Global Chat availability.'); }
  });

  app.get('/api/chat', async (_req, res) => {
    try {
      // Do not rely on the client hiding the history panel: enforce the
      // registered main-Game-post restriction for direct API callers too.
      const status = await getGlobalChatStatus();
      if (!status.enabled) {
        return res.status(403).json({ error: status.reason || 'Global Chat is unavailable here.' });
      }
      res.json(await getGlobalChat());
    } catch (e) { badRequest(res, e, 'Could not load global chat.'); }
  });

  app.post('/api/chat', async (req, res) => {
    try { res.json(await postGlobalChatMessage(req.body?.text ?? '')); }
    catch (e) { badRequest(res, e, 'Could not send chat message.'); }
  });

  app.post('/api/chat/report', async (req, res) => {
    try { res.json(await reportGlobalChatMessage(req.body?.messageId ?? '')); }
    catch (e) { badRequest(res, e, 'Could not report chat message.'); }
  });

  // onCommentCreate keeps ordinary Reddit comments on the Game launcher in sync
  // with the Global Chat window. It does not create any comments itself.
  app.post('/internal/trigger/comment-create', async (req, res) => {
    try {
      const event = req.body ?? {};
      const comment = event.comment ?? {};
      const resolvedAuthor = resolveGlobalChatCommentAuthor(event);
      const post = event.post ?? {};
      const rawPostId = String(post.id ?? comment.postId ?? '').trim();
      const commentId = String(comment.id ?? '').trim();
      const text = String(comment.body ?? comment.text ?? '').trim();
      const authorName = resolvedAuthor.username;
      const authorId = resolvedAuthor.userId ?? '';
      const rawCreatedAt = comment.createdAt ?? comment.created;
      const parsedCreatedAt = typeof rawCreatedAt === 'number'
        ? (rawCreatedAt > 0 && rawCreatedAt < 1_000_000_000_000 ? rawCreatedAt * 1000 : rawCreatedAt)
        : typeof rawCreatedAt === 'string' ? Date.parse(rawCreatedAt) : NaN;
      const timestamp = Number.isSafeInteger(parsedCreatedAt) && parsedCreatedAt >= 0
        ? parsedCreatedAt
        : Date.now();

      if (rawPostId && commentId && text && authorName) {
        await recordGlobalChatComment({
          postId: rawPostId,
          commentId,
          text,
          username: authorName,
          userId: authorId || undefined,
          timestamp,
        });
      }
      return res.json({ status: 'ok' });
    } catch (error) {
      console.error('[Global Chat] Comment trigger failed:', error);
      return res.status(500).json({ status: 'error' });
    }
  });

  app.get('/api/guilds', async (_req, res) => {
    try {
      res.json(await guildInfo());
    } catch (e: any) {
      reportRedisTransactionFailure(e);
      console.error('[API /api/guilds] Failed:', e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e)
          ? 'Guild data is being updated. Please retry.'
          : e?.message || 'Failed to fetch guilds.',
      });
    }
  });

  // Reddit's user-action API performs the actual subscription. Reward claiming is
  // deliberately a separate action so subscribing is an explicit user choice.
  app.post('/api/follow-reward', async (_req, res) => {
    try {
      res.json(await claimFollowReward());
    } catch (e: any) { badRequest(res, e, 'Could not claim the 200-roll reward.'); }
  });

  app.post('/api/activity/heartbeat', async (req, res) => {
    try {
      const heartbeat = await recordPlayerHeartbeat(req.body?.version);
      try {
        await recordPlayerActivityForImpressions(context.userId);
      } catch (analyticsError) {
        console.error('[Impressions] First-play attribution failed; heartbeat remains successful.', analyticsError);
      }
      res.json(heartbeat);
    } catch (e: any) {
      reportRedisTransactionFailure(e);
      console.error('[API /api/activity/heartbeat] Failed:', {
        timestamp: new Date().toISOString(),
        userId: String(context.userId ?? ''),
        message: e?.message ?? String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e) ? 'Presence is busy updating. Please retry.' : e?.message || 'Could not record player activity.',
      });
    }
  });

  // Public post-preview analytics are aggregate-only and never register player activity.
  app.post('/api/impressions', async (req, res) => {
    try {
      res.json(await recordPostImpression(req.body?.postType, req.body?.deviceType, req.body?.postId));
    } catch (error) {
      // Impression analytics must never turn a preview into an online player or
      // block the public post from rendering if analytics is unavailable.
      console.error('[API /api/impressions] Failed:', error);
      res.status(400).json({ error: 'Could not record this impression.' });
    }
  });

  app.post('/api/impressions/conversion', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(await recordMainGamePostConversion(req.body?.postId, req.body?.deviceType));
    } catch (error) {
      // Conversion analytics are best-effort and never block the Play action.
      console.error('[API /api/impressions/conversion] Failed:', error);
      res.status(400).json({ recorded: false, error: 'Could not record this conversion.' });
    }
  });

  // Count an explicit visit to the social tab, not background API refreshes.
  app.post('/api/social/visit', async (_req, res) => {
    try {
      await withPlayerMutationLock(async () => {
        const s = await settleOffline(await loadRaw());
        await recordSocialVisit(s);
        res.json({ ok: true, state: s });
      });
    } catch (e: any) { badRequest(res, e, 'Could not record social visit.'); }
  });

  app.get('/api/online', async (_req, res) => {
    try {
      res.json({ onlinePlayers: await getOnlinePlayers() });
    } catch (e: any) {
      reportRedisTransactionFailure(e);
      console.error('[API /api/online] Failed:', e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e)
          ? 'Presence is updating. Please retry.'
          : e?.message || 'Failed to fetch online players.',
      });
    }
  });

  app.get('/api/global-boosters', async (_req, res) => {
    try {
      res.json(await getGlobalBoosters());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to fetch Global Boosters.' });
    }
  });

  app.get('/api/global-booster-announcement', async (_req, res) => {
    try {
      res.json(await getGlobalBoosterAnnouncement());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to fetch Global Booster announcement.' });
    }
  });

  app.post('/api/global-boosters/activate', async (req, res) => {
    try {
      const id = req.body?.id;
      const useCredit = req.body?.useCredit === true;
      const validIds = ['luck', 'speed', 'crit'];
      if (!validIds.includes(id)) {
        return res.status(400).json({ error: 'Invalid Global Booster.' });
      }
      res.json(await activateGlobalBooster(id, useCredit));
    } catch (e) {
      badRequest(res, e, 'Failed to activate Global Booster.');
    }
  });

  app.get('/api/world-event', async (_req, res) => {
    try {
      const event = await getCommunityEvent();
      res.json(event);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to fetch world event.' });
    }
  });

  // Debug routes are always mounted, but debug.ts rejects every request unless
  // the trusted Devvit username is exactly "shadow_fen".
  app.use('/api/dev', debugRouter);

  const transientContentionError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /max(?:imum)? concurrency|concurrency limit|redis.*transaction|transaction.*failed|PLAYER_MUTATION_LEASE_LOST|another game action is still finishing|the game is busy finishing another action|combat state changed repeatedly|guild.*changed|shared state changed|data changed before the roll saved|player state changed while saving|player activity changed repeatedly|could not safely save player data|could not create a roll prediction ticket|community event changed while|community progress changed while|daily streak community goal changed while/i.test(message);
  };

  const reportRedisTransactionFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (!transientContentionError(error)) return;
    // Preserve the underlying stack and operation context; the client-facing
    // toast alone is not enough to diagnose intermittent platform failures.
    console.error('[Redis/Concurrency Failure]', {
      timestamp: new Date().toISOString(),
      userId: String(context.userId ?? ''),
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
  };

  const badRequest = (res: express.Response, e: unknown, fallback: string) => {
    reportRedisTransactionFailure(e);
    if (e instanceof Error && e.message === 'PLAYER_MUTATION_QUEUED') {
      return res.status(503).json({
        code: 'PLAYER_MUTATION_QUEUED',
        error: 'Your action is queued and will retry automatically.',
        retryAfterMs: 300,
      });
    }
    if (transientContentionError(e)) {
      return res.status(503).json({
        code: 'PLAYER_MUTATION_QUEUED',
        error: 'Your action is queued and will retry automatically.',
        retryAfterMs: 300,
      });
    }
    return res.status(400).json({ error: e instanceof Error ? e.message : fallback });
  };

  app.get('/api/roll-ticket', async (_req, res) => {
    try { res.json(await getRollTicket()); }
    catch (e) {
      reportRedisTransactionFailure(e);
      res.status(transientContentionError(e) ? 503 : 500).json(transientContentionError(e)
        ? { code: 'PLAYER_MUTATION_QUEUED', error: 'Your action is queued and will retry automatically.', retryAfterMs: 300 }
        : { error: e instanceof Error ? e.message : 'Could not create roll prediction ticket.' });
    }
  });

  app.post('/api/roll', async (req, res) => {
    try {
      const ticketId = typeof req.body?.ticketId === 'string' ? req.body.ticketId : '';
      const ticketIndex = req.body?.ticketIndex;
      const ticketSeed = typeof req.body?.ticketSeed === 'string' ? req.body.ticketSeed : '';
      const progressAttemptId = typeof req.body?.progressAttemptId === 'string' ? req.body.progressAttemptId : undefined;
      if (!ticketId || !Number.isSafeInteger(ticketIndex) || !ticketSeed) {
        return res.status(400).json({ error: 'Roll request is missing its ticket. Refresh the game and try again.' });
      }
      const result = await roll(req.body?.auto === true, ticketId, ticketIndex, req.body?.useAllFreeRolls === true, req.body?.useTimeEnergy === true, ticketSeed, progressAttemptId);
      const rolledOrb = (result as { orb?: { rarity?: number; name?: string } }).orb;
      if (rolledOrb) queueCombatOrbFocusSync(rolledOrb.rarity, rolledOrb.name);

      // A first-clear marker is attached by the Rift save transaction only after
      // its archive commit. Posting is a secondary side effect and must never
      // make a successfully completed roll appear to have failed.
      const completion = result.state?.riftChallengeFirstClear;
      if (completion?.runId) {
        try {
          const registeredPostId = await redis.get('io:rift-completion:run:v1:' + completion.runId);
          if (!registeredPostId) {
            const subredditName = String(context.subredditName ?? '').trim();
            if (!subredditName) throw new Error('Subreddit context is unavailable for the Rift announcement.');
            const title = `u/${completion.ownerUsername} has completed the Rift ${completion.challengeName} for the first time!`;
            const post = await reddit.submitCustomPost({
              runAs: 'USER',
              subredditName,
              title,
              entry: 'rift',
              userGeneratedContent: {
                text: `u/${completion.ownerUsername} has completed the rift ${completion.challengeName} for the first time!\n\nCelebrate this first clear with Kudos. Each player can send Kudos once, during the first 24 hours after the post is published.\n\nKudos gives you +10 Shards, gives the Rift champion +10 Shards, and adds 1 minute of progress to their Rift bar.\n\nUse the buttons below to open Infinity Orbs or send Kudos. Sending Kudos will not open the game.`,
              },
            });
            const postId = String(post?.id ?? '').trim();
            if (!postId) throw new Error('Reddit did not return a Rift completion post ID.');
            await registerRiftCompletionPost({
              postId,
              runId: completion.runId,
              ownerId: completion.ownerId,
              ownerUsername: completion.ownerUsername,
              challengeId: completion.challengeId,
              challengeName: completion.challengeName,
              subredditName,
              createdAt: Date.now(),
            });
          }
        } catch (postError) {
          console.error('[Rift Completion] The first-clear reward committed, but its announcement could not be published.', postError);
        }
      }
      res.json(result);
    } catch (e) { badRequest(res, e, 'Roll failed.'); }
  });

  app.post('/api/auto-roll', async (req, res) => {
    try {
      res.json({ state: await setAutoRollEnabled(req.body?.enabled === true) });
    } catch (e) { badRequest(res, e, 'Auto Roll preference update failed.'); }
  });

  app.post('/api/offline/claim', async (_req, res) => {
    try {
      const result = await claimOffline();
      const rolledOrb = (result as { orb?: { rarity?: number; name?: string } }).orb;
      if (rolledOrb) queueCombatOrbFocusSync(rolledOrb.rarity, rolledOrb.name);
      res.json(result);
    } catch (e) { badRequest(res, e, 'Offline claim failed.'); }
  });

  app.post('/api/upgrade', async (req, res) => {
    try {
      const { id } = req.body || {};
      const validUpgradeIds = [
        'speed', 'multi', 'clusterRoll', 'auto', 'luck', 'coinBonus',
        'shardChance', 'xpBonus', 'critChance', 'critPower', 'offlineRate', 'valueBonus'
      ];
      if (!validUpgradeIds.includes(id ?? '')) return res.status(400).json({ error: 'Unknown upgrade.' });
      res.json({ state: await buyUpgrade(id) });
    } catch (e) { badRequest(res, e, 'Upgrade failed.'); }
  });

  app.post('/api/upgrade/batch', async (req, res) => {
    const startedAt = Date.now();
    const diagnosticId = String(req.body?.diagnosticId ?? '')
      .replace(/[^a-zA-Z0-9._:-]/g, '')
      .slice(0, 80);
    const clientStateRevision = Number.isSafeInteger(req.body?.clientStateRevision)
      ? Number(req.body.clientStateRevision)
      : undefined;
    const ids = req.body?.ids;
    const requestedIds = Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string').slice(0, 100)
      : [];
    const validUpgradeIds: UpgradeId[] = [
      'speed', 'multi', 'clusterRoll', 'auto', 'luck', 'coinBonus',
      'shardChance', 'xpBonus', 'critChance', 'critPower', 'offlineRate', 'valueBonus',
      'offlineFoundry', 'orbFingers', 'criticalDividend',
    ];

    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
        !ids.every(id => typeof id === 'string' && validUpgradeIds.includes(id as UpgradeId))) {
      recordUpgradeBatchDiagnostic({
        stage: 'server-rejected',
        username: context.username,
        requestId: diagnosticId,
        upgradeIds: requestedIds,
        status: 400,
        durationMs: Date.now() - startedAt,
        errorCode: 'INVALID_BATCH_IDS',
        message: 'Batch must contain 1 to 100 valid upgrade IDs.',
        clientStateRevision,
      });
      return res.status(400).json({
        error: 'Batch must contain 1 to 100 valid upgrade IDs.',
        ...(diagnosticId ? { diagnosticId } : {}),
      });
    }

    try {
      const result = await buyUpgradeBatch(ids as UpgradeId[]);
      const stage = result.purchased.length === ids.length ? 'server-accepted' : 'server-partial';
      recordUpgradeBatchDiagnostic({
        stage,
        username: context.username,
        requestId: diagnosticId,
        upgradeIds: requestedIds,
        status: 200,
        durationMs: Date.now() - startedAt,
        message: result.stoppedReason ?? '',
        clientStateRevision,
        serverStateRevision: result.state.stateRevision,
        purchasedCount: result.purchased.length,
      });
      res.json({ ...result, ...(diagnosticId ? { diagnosticId } : {}) });
    } catch (error) {
      const retryable = error instanceof Error &&
        (error.message === 'PLAYER_MUTATION_QUEUED' || transientContentionError(error));
      recordUpgradeBatchDiagnostic({
        stage: 'server-rejected',
        username: context.username,
        requestId: diagnosticId,
        upgradeIds: requestedIds,
        status: retryable ? 503 : 400,
        durationMs: Date.now() - startedAt,
        errorCode: retryable ? 'PLAYER_MUTATION_QUEUED' : error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'Upgrade batch failed.',
        clientStateRevision,
      });
      badRequest(res, error, 'Upgrade batch failed.');
    }
  });

  // The client reports only after it has discarded its optimistic upgrade batch.
  // This is process-local telemetry: it adds no Redis write to a failed purchase.
  app.post('/api/diagnostics/upgrade-rollback', (req, res) => {
    const diagnosticId = String(req.body?.diagnosticId ?? '')
      .replace(/[^a-zA-Z0-9._:-]/g, '')
      .slice(0, 80);
    const validUpgradeIds: UpgradeId[] = [
      'speed', 'multi', 'clusterRoll', 'auto', 'luck', 'coinBonus',
      'shardChance', 'xpBonus', 'critChance', 'critPower', 'offlineRate', 'valueBonus',
      'offlineFoundry', 'orbFingers', 'criticalDividend',
    ];
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id: unknown): id is UpgradeId => typeof id === 'string' && validUpgradeIds.includes(id as UpgradeId)).slice(0, 100)
      : [];
    if (!diagnosticId || ids.length === 0) return res.status(204).end();

    recordUpgradeBatchDiagnostic({
      stage: 'client-rollback',
      username: context.username,
      requestId: diagnosticId,
      upgradeIds: ids,
      status: req.body?.status,
      durationMs: req.body?.durationMs,
      errorCode: req.body?.errorCode,
      message: req.body?.message,
      clientStateRevision: req.body?.clientStateRevision,
    });
    return res.status(204).end();
  });

  app.post('/api/upgrade/all', async (_req, res) => {
    try {
      res.json(await buyAllUpgrades());
    } catch (e) { badRequest(res, e, 'Upgrade all failed.'); }
  });

  app.post('/api/chain-patcher/buy', async (_req, res) => {
    try {
      res.json(await buyChainPatcher());
    } catch (e) { badRequest(res, e, 'Chain Patcher purchase failed.'); }
  });

  app.post('/api/streak/claim', async (_req, res) => {
    try { res.json(await claimDailyStreak()); } catch (e) { badRequest(res, e, 'Could not claim daily streak.'); }
  });

  app.post('/api/quests/claim', async (req, res) => {
    try {
      const { type, id } = req.body || {};
      if (type !== 'daily' && type !== 'weekly') return res.status(400).json({ error: 'Invalid quest type.' });
      res.json(await claimQuest(type, id));
    } catch (e) { badRequest(res, e, 'Could not claim quest.'); }
  });

  app.post('/api/prestige', async (_req, res) => {
    try { res.json(await prestige()); } catch (e) { badRequest(res, e, 'Prestige failed.'); }
  });

  app.post('/api/prestige/upgrade', async (req, res) => {
    try {
      const { id } = req.body || {};
      const validIds = [
        'permLuck', 'permSpeed', 'unbrokenMomentum', 'vaultCap', 'sonarPing', 'instantReveal',
        'autoOverclock', 'autoFilter', 'resonanceMeter', 'stellarMagnet', 'chronoOverdrive',
        'transmutation', 'shardSynthesis', 'astralBarrage', 'cosmicInheritance',
        'autoBuyer', 'supernova', 'altarResonator', 'offlineOverdrive',
        'luckyFloor', 'astralArsenal', 'deepVault', 'masteryEngine', 'steadyHands', 'offlineFortune',
        'frenzyVolley', 'astralReserve', 'temporalCompression', 'shardResonator', 'cosmicValuation', 'cosmicReserve', 'autoScrap'
      ];
      if (!validIds.includes(id)) return res.status(400).json({ error: 'Invalid prestige upgrade.' });
      res.json({ state: await buyPrestigeUpgrade(id) });
    } catch (e) { badRequest(res, e, 'Prestige upgrade failed.'); }
  });

  app.post('/api/prestige/synthesize', async (_req, res) => {
    try { res.json(await synthesizeDust()); } catch (e) { badRequest(res, e, 'Dust synthesis failed.'); }
  });

  app.post('/api/altar/sacrifice', async (req, res) => {
    try {
      const { coins = 0, shards = 0 } = req.body || {};
      const numCoins = Number(coins);
      const numShards = Number(shards);
      if (!Number.isFinite(numCoins) || !Number.isFinite(numShards) ||
          numCoins < 0 || numShards < 0 ||
          !Number.isInteger(Math.floor(numCoins)) || !Number.isSafeInteger(Math.floor(numShards))) {
        return res.status(400).json({ error: 'Invalid offering amounts.' });
      }
      const result = await sacrificeToAltar(numCoins, numShards);
      res.json(result);
    } catch (e) {
      badRequest(res, e, 'Sacrifice to altar failed.');
    }
  });

  app.post('/api/mastery/upgrade', async (req, res) => {
    try {
      const skillId = req.body?.skillId;
      if (
        typeof skillId !== 'string' ||
        !Object.prototype.hasOwnProperty.call(MASTERY_SKILLS, skillId)
      ) {
        return res.status(400).json({ error: 'Unknown mastery skill.' });
      }
      const state = await upgradeMasterySkill(skillId as MasterySkillId);
      res.json({ state });
    } catch (e) {
      badRequest(res, e, 'Mastery upgrade failed.');
    }
  });

  app.get('/api/alignment/status', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await getCelestialAlignmentStatus());
    } catch (e) {
      badRequest(res, e, 'Celestial Alignment status failed.');
    }
  });

  app.post('/api/alignment/choose', async (req, res) => {
    try {
      const choice = req.body?.choice;
      if (!['starseeker', 'goldenOrbit', 'clockwork'].includes(choice)) {
        return res.status(400).json({ error: 'Choose a valid Alignment effect.' });
      }
      res.json(await chooseCelestialAlignment(choice));
    } catch (e) {
      badRequest(res, e, 'Celestial Alignment choice failed.');
    }
  });

  app.post('/api/cosmetics/buy', async (req, res) => {
    try { res.json({ state: await buyCosmetic(req.body?.id) }); } catch (e) { badRequest(res, e, 'Cosmetic purchase failed.'); }
  });

  app.post('/api/boosters/activate', async (req, res) => {
    try {
      const id = req.body?.id;
      const validIds = ['fortune', 'hyperdrive', 'barrage', 'prosperity', 'ascension'];
      if (!validIds.includes(id)) return res.status(400).json({ error: 'Invalid premium booster.' });
      res.json({ state: await activatePremiumBooster(id) });
    } catch (e) { badRequest(res, e, 'Failed to activate booster.'); }
  });

  app.post('/api/automation/buy', async (req, res) => {
    try {
      const id = req.body?.id;
      const validIds = ['autoQuestClaim', 'autoStreakClaim', 'autoCommunityClaim', 'autoOfflineClaim', 'autoUpgrade'];
      if (!validIds.includes(id)) return res.status(400).json({ error: 'Invalid automation.' });
      res.json({ state: await buyAutomation(id) });
    } catch (e) { badRequest(res, e, 'Failed to unlock automation.'); }
  });

  app.post('/api/community/reward/claim', async (_req, res) => {
    try {
      res.json(await claimCommunityReward());
    } catch (e) { badRequest(res, e, 'Could not claim community reward.'); }
  });

  app.post('/api/frenzy/start', async (_req, res) => {
    try { res.json(await startOrbFrenzy()); }
    catch (e) { badRequest(res, e, 'Could not start Orb Frenzy.'); }
  });

  app.post('/api/frenzy/arm', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await armOrbFrenzyClaim()); }
    catch (e) { badRequest(res, e, 'Could not arm Orb Frenzy.'); }
  });

  app.post('/api/frenzy/offline-reward/ack', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ state: await acknowledgeFrenzyOfflineReward() }); }
    catch (e) { badRequest(res, e, 'Could not acknowledge offline Frenzy rewards.'); }
  });

  app.get('/api/frenzy/handoff', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await getOrbFrenzyHandoff()); }
    catch (e) { badRequest(res, e, 'Could not load Frenzy handoff.'); }
  });

  app.get('/api/frenzy/info', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await getOrbFrenzyInfo()); }
    catch (e) { badRequest(res, e, 'Could not load Orb Frenzy.'); }
  });

  app.get('/api/frenzy/progress', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await getOrbFrenzyClaimProgress()); }
    catch (e) { badRequest(res, e, 'Could not load Frenzy progress.'); }
  });

  app.get('/api/time-energy/progress', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json(await getTimeEnergyRollProgress()); }
    catch (e) { badRequest(res, e, 'Could not load Time Energy progress.'); }
  });

  app.post('/api/frenzy/claim', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const attemptId = typeof req.body?.attemptId === 'string' ? req.body.attemptId : undefined;
      const result = await claimOrbFrenzy({ attemptId });
      const rolledOrb = (result as { orb?: { rarity?: number; name?: string } }).orb;
      if (rolledOrb) queueCombatOrbFocusSync(rolledOrb.rarity, rolledOrb.name);
      res.json(result);
    } catch (e) { badRequest(res, e, 'Could not claim Orb Frenzy.'); }
  });

  app.post('/api/frenzy/thank-you', async (req, res) => {
    try {
      res.json(await postFrenzyThankYouComment(req.body?.text ?? '', req.body?.postId ?? ''));
    } catch (error) {
      badRequest(res, error, 'Could not post the thank-you comment.');
    }
  });

  app.post('/api/frenzy/shard-popup/ack', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ state: await acknowledgeFrenzyShardPopup() });
    } catch (error) {
      badRequest(res, error, 'Could not dismiss the Frenzy Shard notice.');
    }
  });

  app.post('/api/feedback', async (req, res) => {
    try {
      const type = req.body?.type === 'suggestion' ? 'suggestion' : 'bug';
      const message = String(req.body?.message ?? '').trim();
      if (!message) return res.status(400).json({ error: 'Please describe the bug or suggestion.' });
      if (message.length > 2000) return res.status(400).json({ error: 'Please keep feedback under 2,000 characters.' });

      const subredditName = String(context.subredditName ?? '').trim();
      const subredditId = String(context.subredditId ?? '').trim();
      const username = String(context.username ?? 'Redditor').trim() || 'Redditor';
      if (!subredditName || !subredditId) {
        return res.status(400).json({ error: 'Subreddit context is unavailable.' });
      }

      const subject = `${type === 'bug' ? 'Bug Report' : 'Suggestion'} • Infinity Orbs • u/${username}`.slice(0, 100);
      const bodyMarkdown = [
        `**${type === 'bug' ? 'Bug Report' : 'Suggestion'}**`,
        `**From:** u/${username}`,
        message,
      ].join('\n\n');

      // Atomically reserve a per-user feedback slot before the external
      // Modmail side effect. Keep the cooldown if the provider response is
      // ambiguous, so retries cannot flood Modmail with duplicate reports.
      const userId = String(context.userId ?? '').trim();
      if (!userId) {
        return res.status(401).json({ error: 'Your Reddit identity is unavailable.' });
      }
      const feedbackCooldownKey = `io:feedback-cooldown:${userId}`;
      const feedbackCooldownToken = secureRequestToken();
      try {
        await redis.set(feedbackCooldownKey, feedbackCooldownToken, {
          nx: true,
          expiration: new Date(Date.now() + 60_000),
        });
        if (await redis.get(feedbackCooldownKey) !== feedbackCooldownToken) {
          return res.status(429).json({ error: 'Feedback was sent recently. Please wait a minute before sending more.' });
        }
      } catch (cooldownError) {
        console.error('[Feedback] Could not reserve rate-limit slot:', cooldownError);
        return res.status(503).json({ error: 'Could not verify feedback rate limit. Please retry later.' });
      }

      const conversationId = await reddit.modMail.createModInboxConversation({
        subredditId,
        subject,
        bodyMarkdown,
      });

      res.json({ success: true, conversationId });
    } catch (e) {
      badRequest(res, e, 'Could not send feedback to modmail.');
    }
  });

  app.post('/api/turbo/activate', async (_req, res) => {
    try { res.json({ state: await activateTurbo() }); } catch (e) { badRequest(res, e, 'Failed to activate Turbo Roll.'); }
  });

  app.post('/api/guilds/create', async (req, res) => {
    try {
      res.json({ guild: await createGuild(req.body?.name ?? '', req.body?.tag ?? '') });
    } catch (e) { badRequest(res, e, 'Could not create guild.'); }
  });

  app.post('/api/guilds/join', async (req, res) => {
    try { res.json({ guild: await joinGuild(req.body?.id ?? '') }); }
    catch (e) { badRequest(res, e, 'Could not join guild.'); }
  });

  app.post('/api/guilds/leave', async (_req, res) => {
    try { res.json(await leaveGuild()); } catch (e) { badRequest(res, e, 'Could not leave guild.'); }
  });

  app.post('/api/guilds/perk', async (req, res) => {
    try {
      const { perk } = req.body || {};
      const validPerks = [
        'luckRank', 'speedRank', 'vaultRank', 'shardRank', 'critRank', 'coinRank',
        'memberCapacityRank', 'tokenYieldRank', 'taskBountyRank', 'comboRank',
      ];
      if (!validPerks.includes(perk)) return res.status(400).json({ error: 'Invalid guild perk.' });
      res.json(await buyGuildPerk(perk));
    } catch (e) { badRequest(res, e, 'Failed to upgrade guild perk.'); }
  });

  app.post('/api/guilds/trust', async (req, res) => {
    try {
      const targetUsername = String(req.body?.username ?? '').trim();
      if (!targetUsername) return res.status(400).json({ error: 'Guild member username is required.' });
      res.json({ member: await setGuildTrust(targetUsername, req.body?.trusted === true) });
    } catch (e) { badRequest(res, e, 'Could not change Trust status.'); }
  });

  app.post('/api/guilds/kick', async (req, res) => {
    try {
      const targetUsername = String(req.body?.username ?? '').trim();
      if (!targetUsername) return res.status(400).json({ error: 'Guild member username is required.' });
      res.json(await kickGuildMember(targetUsername));
    } catch (e) { badRequest(res, e, 'Could not kick guild member.'); }
  });

  app.post('/api/share', async (req, res) => {
    try {
      await withPlayerMutationLock(async () => {
      const s = await settleOffline(await loadRaw());
      const value = Number(req.body?.rarity);
      const isInfinity = req.body?.isInfinity === true;
      const ownedKey = isInfinity ? 'Infinity' : String(value);
      if (!Number.isInteger(value) || value < 2 || value > MAX_ORB_RARITY ||
          (isInfinity && value !== MAX_ORB_RARITY) || (s.collection[ownedKey] ?? 0) <= 0) {
        return res.status(400).json({ error: 'You can only share an orb you actually own.' });
      }
      const subredditName = context.subredditName;
      const username = String(context.username ?? s.username ?? 'a player').trim().replace(/^u\//i, '') || 'a player';
      const text = shareText(s, value, isInfinity);
      const postData = {
        type: 'shared-orb',
        rarity: value,
        isInfinity,
        username,
        totalRolls: s.totalRolls,
        collectionValue: s.collectionValue,
      };

      // Persist the cooldown before the irreversible external submit. If the
      // provider succeeds but its response or the following save fails, an
      // immediate retry cannot publish a duplicate post.
      await reserveShareCooldown(s);

      let postId = `share-${Date.now()}`;
      if (subredditName) {
        const post = await reddit.submitCustomPost({
          runAs: 'USER',
          subredditName,
          title: `u/${username} found a 1/${formatRarity(value, isInfinity)} Orb`,
          ...(await getPostFlairOptions(subredditName, 'discovery')),
          entry: 'default',
          postData,
          userGeneratedContent: { text },
        });
        postId = post.id;
        // Mark this known shared-Orb post so the moderator's Global Chat repair
        // action cannot accidentally register it as the canonical Game post.
        try {
          const rawSharePostId = String(post.id ?? '').trim();
          const normalizedSharePostId = /^t3_/i.test(rawSharePostId) ? rawSharePostId : 't3_' + rawSharePostId;
          if (normalizedSharePostId.length <= 200) {
            await redis.set('io:shared-orb:post:' + normalizedSharePostId, '1', {
              expiration: new Date(Date.now() + 180 * 86_400_000),
            });
          }
        } catch (registryError) {
          // The share itself is already published. Logging this best-effort
          // safety marker must not turn success into a retryable failure.
          console.error('[Share] Could not mark shared-Orb post for chat-routing protection.', registryError);
        }
      }
      // The post and cooldown are already durable. Quest progress is a
      // secondary projection: if it conflicts after Reddit has accepted the
      // post, log the omission but return success to avoid encouraging retries.
      try {
        await recordShareQuestProgress(s);
      } catch (progressError) {
        console.error('[Share] Post completed but quest progress save failed; cooldown remains committed.', progressError);
      }
      res.json({ success: true, id: postId, text });
      });
    } catch (e) { badRequest(res, e, 'Could not create Reddit post.'); }
  });

  // Normalize errors raised by middleware (for example, lock acquisition
  // or Redis infrastructure failures) instead of leaking Express's default
  // HTML 500 response to a JSON client.
  app.use((
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) return;
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown server error');
    const busy = transientContentionError(error);
    const queuedBeforeHandler = error instanceof Error && error.message === 'PLAYER_MUTATION_QUEUED';
    console.error('[Unhandled API Error]', {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      userId: String(context.userId ?? ''),
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (queuedBeforeHandler) {
      return res.status(503).json({
        code: 'PLAYER_MUTATION_QUEUED',
        error: 'Your action is queued and will retry automatically.',
        retryAfterMs: 300,
      });
    }
    if (busy) {
      return res.status(503).json({
        code: 'PLAYER_MUTATION_QUEUED',
        error: 'Your action is queued and will retry automatically.',
        retryAfterMs: 300,
      });
    }
    return res.status(500).json({ error: 'The server hit an unexpected error. Please retry.' });
  });

  return app;
}

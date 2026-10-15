import express from 'express';
import { debugRouter, isDebugUser } from './debug.js';
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
  getOrbFrenzyHandoff,
  armOrbFrenzyClaim,
  startOrbFrenzy,
  grantPurchasedPack,
  refundPurchasedPack,
  appendPaymentDebugLog,
  getDeveloperAnnouncement,
  getGlobalBoosterAnnouncement,
  loadRaw,
  recordSocialVisit,
  reserveShareCooldown,
  recordShareQuestProgress,
  save,
  setAutoRollEnabled,
  sacrificeToAltar,
  upgradeMasterySkill,
  getCollectionPage,
  processOfflineFullNotification,
  getNotificationState,
  setNotificationState,
  settleOffline,
  recordPlayerHeartbeat,
} from './game.js';
import {
  createGuild,
  guildInfo,
  joinGuild,
  leaveGuild,
  postGuildMessage,
  buyGuildPerk,
  setGuildTrust,
  kickGuildMember,
  setGuildTaxRate,
  leaderboard,
  leaderboards,
  recordLeaderboard,
  shareText,
  getCommunityEvent,
  getGlobalChat,
  getGlobalChatStatus,
  postGlobalChatMessage,
  recordGlobalChatComment,
  reportGlobalChatMessage,
  reportGuildChatMessage,
} from './social.js';
import { context, reddit, redis } from './devvit-mock.js';
import { withPlayerMutationLock } from './player-lock.js';
import * as devvitServer from '@devvit/web/server';
import { PURCHASE_PACKS, spendShards, FEATURE_UNLOCK_LEVELS, calculateLevelFromXp, formatRarity, MASTERY_SKILLS, MAX_ORB_RARITY, nextCodexChainRarity, type FeatureId, type MasterySkillId, type UpgradeId } from '../shared/game.js';
import { APP_VERSION } from '../shared/version.js';
import { getCombatSnapshot, performCombatBeat, equipCombatItem, rollCombatSkill } from './combat.js';
import { getArenaStatus, joinArenaQueue, leaveArenaQueue } from './arena.js';

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
    if (req.path === '/health' || req.path === '/version' || req.path === '/app-info') return next();
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
    res.json = ((body: any) => originalJson(stripPlayerCollection(body))) as typeof res.json;
    next();
  });

  // Serialize state-changing requests per player inside this server instance.
  // Devvit can execute requests concurrently on different instances, so a Redis
  // lock is also required to protect a player's full read-modify-write mutation.
  const mutationQueues = new Map<string, Promise<void>>();
  const MUTATION_LOCK_PREFIX = 'player-mutation-lock:';
  const MUTATION_LOCK_TTL_MS = 2 * 60_000;
  const MUTATION_LOCK_WAIT_MS = 20_000;

  const mutationLockKey = (playerKey: string) => MUTATION_LOCK_PREFIX + playerKey;

  const mutationLockOwner = (): string =>
    String(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const parseMutationLock = (raw: string | null): { owner: string; expiresAt: number } | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { owner?: unknown; expiresAt?: unknown };
      const owner = String(parsed.owner ?? '').trim();
      const expiresAt = Number(parsed.expiresAt ?? 0);
      if (!owner || !Number.isFinite(expiresAt)) return null;
      return { owner, expiresAt };
    } catch {
      return null;
    }
  };

  const acquireMutationLock = async (playerKey: string): Promise<{
    lockKey: string;
    owner: string;
  }> => {
    const lockKey = mutationLockKey(playerKey);
    const owner = mutationLockOwner();
    const deadline = Date.now() + MUTATION_LOCK_WAIT_MS;

    while (Date.now() < deadline) {
      const now = Date.now();
      const txn = await redis.watch(lockKey);
      let transactionClosed = false;
      try {
        // TxClient.get() queues a transaction command. Read the watched value
        // through Redis itself so we inspect the actual current lock contents.
        const raw = await redis.get(lockKey);
        const existing = parseMutationLock(raw);

        if (existing && existing.expiresAt > now) {
          await txn.unwatch();
          transactionClosed = true;
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        const value = JSON.stringify({
          owner,
          expiresAt: now + MUTATION_LOCK_TTL_MS,
        });

        await txn.multi();
        await txn.set(lockKey, value);
        const committed = await txn.exec();
        transactionClosed = true;

        if (committed !== null) {
          return { lockKey, owner };
        }
      } finally {
        if (!transactionClosed) {
          await txn.unwatch().catch(() => undefined);
        }
      }
    }

    throw new Error('Another game action is still finishing. Please retry.');
  };

  const releaseMutationLock = async (lockKey: string, owner: string): Promise<void> => {
    let txn: Awaited<ReturnType<typeof redis.watch>> | null = null;
    let transactionClosed = false;
    try {
      txn = await redis.watch(lockKey);
      // TxClient.get() queues a transaction command. Read the watched value
      // through Redis itself before deciding whether the lock is ours.
      const raw = await redis.get(lockKey);
      const existing = parseMutationLock(raw);
      if (!existing || existing.owner !== owner) {
        await txn.unwatch();
        transactionClosed = true;
        return;
      }

      await txn.multi();
      await txn.del(lockKey);
      await txn.exec();
      transactionClosed = true;
    } catch (error) {
      console.error('[Mutation Lock] Failed to release lock:', error);
    } finally {
      if (txn && !transactionClosed) {
        await txn.unwatch().catch(() => undefined);
      }
    }
  };

  app.use('/api', async (req, res, next) => {
    // Combat has a separate per-player state key and Redis WATCH/MULTI/EXEC
    // compare-and-set writes. Do not queue its one-second beats behind the
    // global player-save lock; that lock protects the unrelated orb-save path.
    if (
      req.path === '/combat/beat' ||
      req.path === '/combat/equip' ||
      req.path === '/combat/skills/roll'
    ) return next();

    const mutatesState = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    const readsAndPersistsPlayerState =
      req.method === 'GET' &&
      ['/me', '/leaderboard', '/guilds'].includes(req.path);
    const requiresPlayerSerialization = mutatesState || readsAndPersistsPlayerState;
    if (!requiresPlayerSerialization) return next();

    const playerKey = context.userId ?? req.ip ?? 'unknown';
    const previous = mutationQueues.get(playerKey) ?? Promise.resolve();

    let releaseLocal!: () => void;
    const current = new Promise<void>(resolve => { releaseLocal = resolve; });
    const chain = previous.then(() => current);
    mutationQueues.set(playerKey, chain);

    await previous;

    let distributedLock: { lockKey: string; owner: string } | null = null;
    try {
      distributedLock = await acquireMutationLock(playerKey);
      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        releaseLocal();
        if (mutationQueues.get(playerKey) === chain) mutationQueues.delete(playerKey);
        if (distributedLock) {
          void releaseMutationLock(distributedLock.lockKey, distributedLock.owner);
          distributedLock = null;
        }
      };
      res.once('finish', releaseOnce);
      res.once('close', releaseOnce);
      return next();
    } catch (error) {
      releaseLocal();
      if (mutationQueues.get(playerKey) === chain) mutationQueues.delete(playerKey);
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
      const s = await loadRaw();
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

  app.post('/internal/menu/post-create', async (_req, res) => {
    try {
      const subredditName = context.subredditName;
      if (!subredditName) return res.status(400).json({ showToast: 'No subreddit context available.' });
      const post = await reddit.submitCustomPost({
        title: 'Infinity Orbs',
        entry: 'default',
      });
      await redis.set('io:global-game-post-id', post.id, { nx: true }).catch((error: unknown) => {
        console.error('[Global Chat] Could not register the new Game post:', error);
      });
      res.json({ navigateTo: `https://reddit.com/r/${subredditName}/comments/${post.id}` });
    } catch (e) {
      console.error('Failed to create Infinity Orbs post:', e);
      res.status(400).json({ showToast: 'Failed to create Infinity Orbs post.' });
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
      await redis.set('io:global-game-post-id', post.id, { nx: true }).catch((error: unknown) => {
        console.error('[Global Chat] Could not register the new Game post:', error);
      });
      res.json({ status: 'success', message: `Created Infinity Orbs post ${post.id} in r/${subredditName}.` });
    } catch (e) {
      console.error('Failed to create install post:', e);
      res.status(400).json({ status: 'error', message: 'Failed to create Infinity Orbs post.' });
    }
  });

  app.get('/api/notifications', async (_req, res) => {
    try {
      res.json({ enabled: await getNotificationState() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Could not load notification settings.' });
    }
  });

  app.post('/api/notifications', async (req, res) => {
    try {
      const enabled = req.body?.enabled === true;
      res.json({ enabled: await setNotificationState(enabled) });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || 'Could not update notification settings.' });
    }
  });

  app.get('/api/developer-announcement', async (_req, res) => {
    try {
      res.json(await getDeveloperAnnouncement());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || 'Failed to fetch developer announcement.' });
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

  app.get('/api/combat/state', async (_req, res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await getCombatSnapshot()); }
    catch (e:any) { const message=e?.message||'Could not load combat state.';res.status(message==='REDDIT_LOGIN_REQUIRED'?401:500).json({error:message}); }
  });
  app.post('/api/combat/beat', async (req,res) => {
    const sequence=req.body?.sequence, intent=req.body?.intent;
    if(!Number.isSafeInteger(sequence)||sequence<1)return res.status(400).json({error:'A valid combat sequence is required.'});
    if(!['strike','heavy','guard','mend'].includes(intent))return res.status(400).json({error:'Invalid combat command.'});
    try { res.setHeader('Cache-Control','no-store');res.json(await performCombatBeat(sequence,intent)); }
    catch(e:any){const message=e?.message||'Combat beat failed.';const status=message==='stale combat sequence'?409:message==='REDDIT_LOGIN_REQUIRED'?401:message==='Combat state changed repeatedly. Please retry.'?503:500;res.status(status).json({error:message});}
  });
  app.post('/api/combat/equip', async (req,res) => {
    const itemId=req.body?.itemId;
    if(typeof itemId!=='string'||!itemId.trim()||itemId.length>160)return res.status(400).json({error:'A valid gear item is required.'});
    try{res.setHeader('Cache-Control','no-store');res.json(await equipCombatItem(itemId));}
    catch(e:any){const message=e?.message||'Could not equip gear.';const status=message==='item not owned'?404:message==='REDDIT_LOGIN_REQUIRED'?401:500;res.status(status).json({error:message});}
  });
  app.post('/api/combat/skills/roll', async (_req,res) => {
    try{res.setHeader('Cache-Control','no-store');res.json(await rollCombatSkill());}
    catch(e:any){const message=e?.message||'Skill roll failed.';const status=message==='Not enough Delver Coins.'?400:message==='REDDIT_LOGIN_REQUIRED'?401:500;res.status(status).json({error:message});}
  });

  app.get('/api/combat/arena/status', async (_req,res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await getArenaStatus()); }
    catch(e:any) { const message=e?.message||'Could not load Arena status.'; res.status(message==='REDDIT_LOGIN_REQUIRED'?401:503).json({error:message}); }
  });
  app.post('/api/combat/arena/queue', async (_req,res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await joinArenaQueue()); }
    catch(e:any) { const message=e?.message||'Could not join the Arena.'; const status=message==='REDDIT_LOGIN_REQUIRED'?401:message.includes('Arena queue is full')||message.includes('Arena state changed')?503:500; res.status(status).json({error:message}); }
  });
  app.post('/api/combat/arena/leave', async (_req,res) => {
    try { res.setHeader('Cache-Control','no-store'); res.json(await leaveArenaQueue()); }
    catch(e:any) { const message=e?.message||'Could not leave the Arena queue.'; res.status(message==='REDDIT_LOGIN_REQUIRED'?401:503).json({error:message}); }
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
    try {
      res.json(await leaderboard());
    } catch (e: any) {
      reportRedisTransactionFailure(e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e) ? 'Leaderboard is busy updating. Please retry.' : e?.message || 'Failed to fetch leaderboard.',
      });
    }
  });

  app.get('/api/leaderboards', async (_req, res) => {
    try {
      res.json(await leaderboards());
    } catch (e: any) {
      reportRedisTransactionFailure(e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e) ? 'Leaderboards are busy updating. Please retry.' : e?.message || 'Failed to fetch leaderboards.',
      });
    }
  });

  app.get('/api/chat/status', async (req, res) => {
    try {
      // The GlobalChatWindow is mounted by the main launcher entry point.
      // Explicitly mark that handshake so stale test/Frenzy metadata cannot
      // prevent the main Game post from registering itself.
      res.json(await getGlobalChatStatus(
        req.query.launcher === 'main',
        req.query.launcher === 'frenzy',
      ));
    } catch (e) { badRequest(res, e, 'Could not determine Global Chat availability.'); }
  });

  app.get('/api/chat', async (_req, res) => {
    try { res.json(await getGlobalChat()); }
    catch (e) { badRequest(res, e, 'Could not load global chat.'); }
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
      const author = event.author ?? {};
      const post = event.post ?? {};
      const rawPostId = String(post.id ?? comment.postId ?? '').trim();
      const commentId = String(comment.id ?? '').trim();
      const text = String(comment.body ?? comment.text ?? '').trim();
      const authorName = String(author.name ?? author.username ?? '').trim().replace(/^u\//i, '');
      const authorId = String(author.id ?? '').trim();
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
      res.json(await recordPlayerHeartbeat(req.body?.version));
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
    return /max(?:imum)? concurrency|concurrency limit|redis.*transaction|transaction.*failed|PLAYER_MUTATION_LEASE_LOST|another game action is still finishing|guild.*changed|shared state changed|data changed before the roll saved|player state changed while saving|player activity changed repeatedly|could not safely save player data|could not create a roll prediction ticket|community event changed while|community progress changed while|daily streak community goal changed while/i.test(message);
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
    if (transientContentionError(e)) {
      return res.status(503).json({ error: 'The game is busy finishing another action. Please retry.' });
    }
    return res.status(400).json({ error: e instanceof Error ? e.message : fallback });
  };

  app.get('/api/roll-ticket', async (_req, res) => {
    try { res.json(await getRollTicket()); }
    catch (e) {
      reportRedisTransactionFailure(e);
      res.status(transientContentionError(e) ? 503 : 500).json({
        error: transientContentionError(e) ? 'The game is busy preparing your next roll. Please retry.' : e instanceof Error ? e.message : 'Could not create roll prediction ticket.',
      });
    }
  });

  app.post('/api/roll', async (req, res) => {
    try {
      const ticketId = typeof req.body?.ticketId === 'string' ? req.body.ticketId : '';
      const ticketIndex = req.body?.ticketIndex;
      if (!ticketId || !Number.isSafeInteger(ticketIndex)) {
        return res.status(400).json({ error: 'Roll request is missing its ticket. Refresh the game and try again.' });
      }
      res.json(await roll(req.body?.auto === true, ticketId, ticketIndex, req.body?.useAllFreeRolls === true));
    } catch (e) { badRequest(res, e, 'Roll failed.'); }
  });

  app.post('/api/auto-roll', async (req, res) => {
    try {
      res.json({ state: await setAutoRollEnabled(req.body?.enabled === true) });
    } catch (e) { badRequest(res, e, 'Auto Roll preference update failed.'); }
  });

  app.post('/api/offline/claim', async (_req, res) => {
    try { res.json(await claimOffline()); } catch (e) { badRequest(res, e, 'Offline claim failed.'); }
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
    try {
      const ids = req.body?.ids;
      const validUpgradeIds: UpgradeId[] = [
        'speed', 'multi', 'clusterRoll', 'auto', 'luck', 'coinBonus',
        'shardChance', 'xpBonus', 'critChance', 'critPower', 'offlineRate', 'valueBonus',
      ];
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
          !ids.every(id => typeof id === 'string' && validUpgradeIds.includes(id as UpgradeId))) {
        return res.status(400).json({ error: 'Batch must contain 1 to 100 valid upgrade IDs.' });
      }
      res.json(await buyUpgradeBatch(ids as UpgradeId[]));
    } catch (e) { badRequest(res, e, 'Upgrade batch failed.'); }
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
        'permLuck', 'permSpeed', 'vaultCap', 'dustBounty', 'sonarPing', 'instantReveal',
        'autoOverclock', 'autoFilter', 'resonanceMeter', 'stellarMagnet', 'chronoOverdrive',
        'transmutation', 'shardSynthesis', 'astralBarrage', 'cosmicInheritance',
        'autoBuyer', 'supernova', 'altarResonator', 'offlineOverdrive', 'singularityTithe',
        'luckyFloor', 'astralArsenal', 'deepVault', 'masteryEngine', 'steadyHands', 'offlineFortune',
        'frenzyVolley', 'astralReserve', 'temporalCompression', 'shardResonator', 'cosmicValuation', 'cosmicReserve'
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
          !Number.isSafeInteger(Math.floor(numCoins)) || !Number.isSafeInteger(Math.floor(numShards))) {
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
    try { res.json(await armOrbFrenzyClaim()); }
    catch (e) { badRequest(res, e, 'Could not arm Orb Frenzy.'); }
  });

  app.get('/api/frenzy/handoff', async (_req, res) => {
    try { res.json(await getOrbFrenzyHandoff()); }
    catch (e) { badRequest(res, e, 'Could not load Frenzy handoff.'); }
  });

  app.get('/api/frenzy/info', async (_req, res) => {
    try { res.json(await getOrbFrenzyInfo()); }
    catch (e) { badRequest(res, e, 'Could not load Orb Frenzy.'); }
  });

  app.post('/api/frenzy/claim', async (_req, res) => {
    try { res.json(await claimOrbFrenzy()); }
    catch (e) { badRequest(res, e, 'Could not claim Orb Frenzy.'); }
  });

  app.post('/api/frenzy/thank-you', async (req, res) => {
    try {
      res.json(await postFrenzyThankYouComment(req.body?.text ?? '', req.body?.postId ?? ''));
    } catch (error) {
      badRequest(res, error, 'Could not post the thank-you comment.');
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
      const feedbackCooldownToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    try { res.json({ guild: await createGuild(req.body?.name ?? '', req.body?.tag ?? '') }); }
    catch (e) { badRequest(res, e, 'Could not create guild.'); }
  });

  app.post('/api/guilds/join', async (req, res) => {
    try { res.json({ guild: await joinGuild(req.body?.id ?? '') }); }
    catch (e) { badRequest(res, e, 'Could not join guild.'); }
  });

  app.post('/api/guilds/leave', async (_req, res) => {
    try { res.json(await leaveGuild()); } catch (e) { badRequest(res, e, 'Could not leave guild.'); }
  });

  app.post('/api/guilds/chat', async (req, res) => {
    try { res.json({ message: await postGuildMessage(req.body?.text ?? '') }); }
    catch (e) { badRequest(res, e, 'Could not post message.'); }
  });

  app.post('/api/guilds/chat/report', async (req, res) => {
    try { res.json(await reportGuildChatMessage(req.body?.messageId ?? '')); }
    catch (e) { badRequest(res, e, 'Could not report guild chat message.'); }
  });

  app.post('/api/guilds/perk', async (req, res) => {
    try {
      const { perk } = req.body || {};
      const validPerks = [
        'luckRank', 'speedRank', 'vaultRank', 'shardRank', 'critRank', 'coinRank',
        'memberCapacityRank', 'tokenYieldRank', 'taskBountyRank', 'comboRank', 'guildXpRank',
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

  app.post('/api/guilds/tax', async (req, res) => {
    try {
      const rate = Number(req.body?.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 10) {
        return res.status(400).json({ error: 'Guild Tax must be between 0% and 10%.' });
      }
      res.json({ guild: await setGuildTaxRate(rate) });
    } catch (e) { badRequest(res, e, 'Could not change Guild Tax.'); }
  });


  app.post('/api/share', async (req, res) => {
    try {
      await withPlayerMutationLock(async () => {
      const s = await settleOffline(await loadRaw());
      const value = Number(req.body?.rarity);
      if (!Number.isInteger(value) || value < 2 || value > MAX_ORB_RARITY || (s.collection[String(value)] ?? 0) <= 0) {
        return res.status(400).json({ error: 'You can only share an orb you actually own.' });
      }
      const subredditName = context.subredditName;
      const username = String(context.username ?? s.username ?? 'a player').trim().replace(/^u\//i, '') || 'a player';
      const text = shareText(s, value);
      const postData = {
        type: 'shared-orb',
        rarity: value,
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
          title: `u/${username} found a 1/${formatRarity(value)} Orb`,
          flairText: 'discovery',
          entry: 'default',
          postData,
          userGeneratedContent: { text },
        });
        postId = post.id;
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
    console.error('[Unhandled API Error]', {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      userId: String(context.userId ?? ''),
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (busy) {
      return res.status(503).json({ error: 'The game is busy finishing another action. Please retry.' });
    }
    return res.status(500).json({ error: 'The server hit an unexpected error. Please retry.' });
  });

  return app;
}

import { APP_VERSION } from '../shared/version.js';
import { configureDevvitRuntime, redis, reddit, scheduler } from '../server/devvit-mock.js';
import * as game from '../server/game.js';
import * as social from '../server/social.js';
import * as combat from '../server/combat.js';
import * as riftChallenges from '../server/rift-challenges.js';
import { handlePagesAdminRequest } from './admin-api.js';
import { context } from './devvit-client.js';
import { globalFeaturesForRequest } from '../shared/admin-cli.js';

type JsonRecord = Record<string, any>;

const pagesContext = {
  userId: context.userId,
  username: context.username,
  subredditName: context.subredditName,
  subredditId: context.subredditId,
  postId: context.postId,
  appVersion: APP_VERSION,
};

// These are the existing safe local mocks. No Reddit network connection is
// present in the Pages build.
configureDevvitRuntime({ redis, context: pagesContext, reddit, scheduler });

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value ?? null), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function errorResponse(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown local test error.');
  if (message === 'CHALLENGE_RUN_MISMATCH') {
    return jsonResponse({ error: 'This challenge run changed in another tab. Refresh before continuing.' }, 409);
  }
  if (message.startsWith('RIFT_CHALLENGE_COOLDOWN:')) {
    const retryAfterMs = Math.max(0, Number(message.slice('RIFT_CHALLENGE_COOLDOWN:'.length)) || 0);
    return jsonResponse({ error: 'Your challenge roll is not ready yet.', retryAfterMs }, 429);
  }
  return jsonResponse({ error: message }, status);
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<JsonRecord> {
  let raw: BodyInit | null | undefined = init?.body;
  if (raw == null && typeof Request !== 'undefined' && input instanceof Request) {
    raw = await input.clone().text();
  }
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : {};
  } catch {
    throw new Error('The Pages test API received an invalid JSON request.');
  }
}

function localOnlyResult(action: string) {
  return { success: true, localOnly: true, action };
}

async function handleApiRequest(url: URL, method: string, body: JsonRecord): Promise<Response> {
  const path = url.pathname;

  if (path.startsWith('/api/dev/')) {
    // Pages admin actions are local-only and scoped to the active browser profile.
    return handlePagesAdminRequest(url, method, body);
  }
  if (path.startsWith('/api/payments/')) {
    return jsonResponse({ error: 'Payments are unavailable in the GitHub Pages test build.' }, 404);
  }

  try {
    const requestedFeatures = globalFeaturesForRequest(method, path);
    if (requestedFeatures.length) {
      const controls = await Promise.all(requestedFeatures.map(feature => game.getGlobalFeatureControl(feature)));
      const disabled = controls.find(control => !control.enabled);
      if (disabled) {
        return jsonResponse({
          error: disabled.reason || 'This feature has been disabled by the developer.',
          feature: disabled.feature,
          featureDisabled: true,
          reason: disabled.reason,
        }, 403);
      }
    }

    if (method === 'GET') {
      switch (path) {
        case '/api/rift-challenges':
          return jsonResponse(await riftChallenges.getRiftChallengeStatus());
        case '/api/rift-completion/info':
          return jsonResponse(await riftChallenges.getRiftCompletionPostInfo());
        case '/api/me':
          return jsonResponse(await game.getMe());
        case '/api/roll-ticket':
          return jsonResponse(await game.getRollTicket());
        case '/api/alignment/status':
          return jsonResponse(await game.getCelestialAlignmentStatus());
        case '/api/frenzy/handoff':
          return jsonResponse(await game.getOrbFrenzyHandoff());
        case '/api/frenzy/info':
          return jsonResponse(await game.getOrbFrenzyInfo());
        case '/api/frenzy/simulator/info': {
          const postId = String(url.searchParams.get('postId') ?? '').trim();
          return jsonResponse(await game.getOrbFrenzyInfo({ postId, allowAdminTestOwner: true }));
        }
        case '/api/frenzy/progress':
          return jsonResponse(await game.getOrbFrenzyClaimProgress());
        case '/api/time-energy/progress':
          return jsonResponse(await game.getTimeEnergyRollProgress());
        case '/api/global-boosters':
          return jsonResponse(await game.getGlobalBoosters());
        case '/api/global-booster-announcement':
          return jsonResponse(await game.getGlobalBoosterAnnouncement());
        case '/api/world-event':
          return jsonResponse(await social.getCommunityEvent());
        case '/api/guilds':
          return jsonResponse(await social.guildInfo());
        case '/api/leaderboard':
          return jsonResponse(await social.leaderboard());
        case '/api/leaderboards':
          return jsonResponse(await social.leaderboards({ fresh: url.searchParams.get('fresh') === '1' }));
        case '/api/online':
          return jsonResponse({ onlinePlayers: await game.getOnlinePlayers() });
        case '/api/notifications':
          return jsonResponse(await game.getNotificationPreferences());
        case '/api/popups/config':
          return jsonResponse(await game.getPopupConfig());
        case '/api/follow-reward/status':
          return jsonResponse(await game.getFollowRewardStatus());
        case '/api/developer-announcement':
          return jsonResponse(await game.getDeveloperAnnouncement());
        case '/api/menu-control':
          return jsonResponse(await game.getGlobalMenuControl());
        case '/api/live-balance':
          return jsonResponse(await game.getLiveBalanceSnapshot());
        case '/api/health':
          return jsonResponse({ status: 'ok', runtime: 'github-pages-test' });
        case '/api/version':
          return jsonResponse({ version: APP_VERSION });
        case '/api/app-info':
          return jsonResponse({ isBeta: false, pagesTest: true, runtime: 'github-pages-test' });
        case '/api/player/experience': {
          const player = await game.loadRaw({ registerActivity: false });
          return jsonResponse({
            playedBefore: Number(player.totalRolls) > 0 ||
              Number(player.level) > 1 ||
              Number(player.collectionValue) > 0,
          });
        }
        case '/api/combat/state':
          return jsonResponse(await combat.getCombatSnapshot());
        case '/api/combat/marks':
          return jsonResponse({ combatMarks: await combat.getCombatMarksBalance() });
        case '/api/combat/arena/opponents':
          return jsonResponse(await combat.getCombatArenaOpponents());
        case '/api/combat/tutorial/status':
          return jsonResponse({ seen: await combat.hasCompletedCombatTutorial() });
        case '/api/tutorial/first-roll/status':
          return jsonResponse({ seen: await game.hasCompletedFirstRollTutorial() });
        case '/api/chat/status':
          return jsonResponse(await social.getGlobalChatStatus());
        case '/api/chat': {
          const status = await social.getGlobalChatStatus();
          if (!status.enabled) return jsonResponse({ error: status.reason || 'Global Chat is unavailable in Pages testing.' }, 403);
          return jsonResponse(await social.getGlobalChat());
        }
        case '/api/collection': {
          const sortParam = url.searchParams.get('sort') ?? 'rarity_desc';
          const sort = sortParam === 'rarity_asc' || sortParam === 'count' ? sortParam : 'rarity_desc';
          return jsonResponse(await game.getCollectionPage({
            offset: Number(url.searchParams.get('offset') ?? 0),
            limit: Number(url.searchParams.get('limit') ?? 60),
            tier: url.searchParams.get('tier') ?? 'all',
            sort,
          }));
        }
        case '/api/products':
          return jsonResponse([]);
        default:
          return jsonResponse({ error: 'Unknown GitHub Pages test API endpoint: ' + path }, 404);
      }
    }

    if (method !== 'POST') {
      return jsonResponse({ error: 'Method not supported by the GitHub Pages test API.' }, 405);
    }

    switch (path) {
      case '/api/frenzy/shard-popup/ack':
        return jsonResponse({ state: await game.acknowledgeFrenzyShardPopup() });
      case '/api/frenzy/offline-reward/ack':
        return jsonResponse({ state: await game.acknowledgeFrenzyOfflineReward() });
      case '/api/rift-challenges/mark-opened':
        return jsonResponse(await riftChallenges.markRiftGameOpened());
      case '/api/rift-completion/kudos':
        return jsonResponse(await riftChallenges.awardRiftCompletionKudos());
      case '/api/rift-challenges/start':
        return jsonResponse(await riftChallenges.startRiftChallenge(body.challengeId));
      case '/api/rift-challenges/roll':
        return jsonResponse(await riftChallenges.rollRiftChallenge(body.runId));
      case '/api/rift-challenges/upgrade':
        return jsonResponse(await riftChallenges.buyRiftChallengeUpgrade(body.upgradeId, body.runId));
      case '/api/rift-challenges/perk':
        return jsonResponse(await riftChallenges.buyRiftPerk(body.perkId));
      case '/api/rift-challenges/abandon':
        return jsonResponse(await riftChallenges.abandonRiftChallenge(body.runId));
      case '/api/roll': {
        const result = await game.roll(
          body.auto === true,
          typeof body.ticketId === 'string' ? body.ticketId : undefined,
          body.ticketIndex,
          body.useAllFreeRolls === true,
          body.useTimeEnergy === true,
          typeof body.ticketSeed === 'string' ? body.ticketSeed : undefined,
          typeof body.progressAttemptId === 'string' ? body.progressAttemptId : undefined,
        );
        if (result.orb) {
          try { await combat.setCombatOrbFocus(result.orb.rarity, result.orb.name); } catch { /* Focus sync is secondary. */ }
        }
        return jsonResponse(result);
      }
      case '/api/auto-roll':
        return jsonResponse({ state: await game.setAutoRollEnabled(body.enabled === true) });
      case '/api/offline/claim':
        return jsonResponse(await game.claimOffline());
      case '/api/upgrade':
        return jsonResponse({ state: await game.buyUpgrade(body.id) });
      case '/api/upgrade/batch':
        return jsonResponse(await game.buyUpgradeBatch(Array.isArray(body.ids) ? body.ids : []));
      case '/api/upgrade/all':
        return jsonResponse(await game.buyAllUpgrades());
      case '/api/chain-patcher/buy':
        return jsonResponse(await game.buyChainPatcher());
      case '/api/streak/claim':
        return jsonResponse(await game.claimDailyStreak());
      case '/api/quests/claim':
        return jsonResponse(await game.claimQuest(body.type, body.id));
      case '/api/prestige':
        return jsonResponse(await game.prestige());
      case '/api/prestige/upgrade':
        return jsonResponse({ state: await game.buyPrestigeUpgrade(body.id) });
      case '/api/prestige/synthesize':
        return jsonResponse(await game.synthesizeDust());
      case '/api/altar/sacrifice':
        return jsonResponse(await game.sacrificeToAltar(Number(body.coins ?? 0), Number(body.shards ?? 0)));
      case '/api/mastery/upgrade':
        return jsonResponse({ state: await game.upgradeMasterySkill(body.skillId) });
      case '/api/alignment/choose':
        return jsonResponse(await game.chooseCelestialAlignment(body.choice));
      case '/api/cosmetics/buy':
        return jsonResponse({ state: await game.buyCosmetic(body.id) });
      case '/api/boosters/activate':
        return jsonResponse({ state: await game.activatePremiumBooster(body.id) });
      case '/api/automation/buy':
        return jsonResponse({ state: await game.buyAutomation(body.id) });
      case '/api/community/reward/claim':
        return jsonResponse(await game.claimCommunityReward());
      case '/api/frenzy/start':
        return jsonResponse(await game.startOrbFrenzy());
      case '/api/frenzy/simulator/create':
        return jsonResponse(await game.createFrenzySimulatorPost(body.rarity));
      case '/api/frenzy/simulator/claim': {
        const postId = String(body.postId ?? '').trim();
        if (!postId) throw new Error('Choose a Frenzy post before claiming it.');
        const result = await game.claimOrbFrenzy({
          postId,
          allowAdminTestOwner: true,
          attemptId: typeof body.attemptId === 'string' ? body.attemptId : undefined,
        });
        if (result.orb) {
          try { await combat.setCombatOrbFocus(result.orb.rarity, result.orb.name); } catch { /* Focus sync is secondary. */ }
        }
        return jsonResponse(result);
      }
      case '/api/frenzy/arm':
        return jsonResponse(await game.armOrbFrenzyClaim());
      case '/api/frenzy/claim': {
        const result = await game.claimOrbFrenzy({
          attemptId: typeof body.attemptId === 'string' ? body.attemptId : undefined,
        });
        const orb = (result as { orb?: { rarity?: number; name?: string } }).orb;
        if (orb) {
          try { await combat.setCombatOrbFocus(orb.rarity, orb.name); } catch { /* Focus sync is secondary. */ }
        }
        return jsonResponse(result);
      }
      case '/api/frenzy/thank-you':
        return jsonResponse(await game.postFrenzyThankYouComment(body.text ?? '', body.postId ?? ''));
      case '/api/notifications': {
        const preferences = typeof body.enabled === 'boolean'
          ? { updates: body.enabled, offlineOrbs: body.enabled }
          : {
              ...(typeof body.updates === 'boolean' ? { updates: body.updates } : {}),
              ...(typeof body.offlineOrbs === 'boolean' ? { offlineOrbs: body.offlineOrbs } : {}),
            };
        return jsonResponse(await game.setNotificationPreferences(preferences));
      }
      case '/api/global-boosters/activate':
        return jsonResponse(await game.activateGlobalBooster(body.id, body.useCredit === true));
      case '/api/turbo/activate':
        return jsonResponse({ state: await game.activateTurbo() });
      case '/api/follow-reward':
        return jsonResponse(await game.claimFollowReward());
      case '/api/popups/track':
        return jsonResponse(await game.recordPopupEvent(body.popup, body.event));
      case '/api/tutorial/first-roll/complete':
        await game.markFirstRollTutorialSeen();
        return jsonResponse({ seen: true });
      case '/api/combat/tutorial/complete':
        await combat.markCombatTutorialSeen();
        return jsonResponse({ seen: true });
      case '/api/activity/heartbeat':
        return jsonResponse(await game.recordPlayerHeartbeat(body.version));
      case '/api/social/visit': {
        const state = await game.settleOffline(await game.loadRaw());
        await game.recordSocialVisit(state);
        return jsonResponse({ ok: true, state });
      }
      case '/api/guilds/create':
        return jsonResponse({ guild: await social.createGuild(body.name ?? '', body.tag ?? '') });
      case '/api/guilds/join':
        return jsonResponse({ guild: await social.joinGuild(body.id ?? '') });
      case '/api/guilds/leave':
        return jsonResponse(await social.leaveGuild());
      case '/api/guilds/perk':
        return jsonResponse(await social.buyGuildPerk(body.perk));
      case '/api/guilds/trust':
        return jsonResponse({ member: await social.setGuildTrust(body.username ?? '', body.trusted === true) });
      case '/api/guilds/kick':
        return jsonResponse(await social.kickGuildMember(body.username ?? ''));
      case '/api/chat':
        return jsonResponse(await social.postGlobalChatMessage(body.text ?? ''));
      case '/api/chat/report':
        return jsonResponse(await social.reportGlobalChatMessage(body.messageId ?? ''));
      case '/api/share': {
        const state = await game.settleOffline(await game.loadRaw());
        const rarity = Number(body.rarity);
        const isInfinity = body.isInfinity === true;
        const ownKey = isInfinity ? 'Infinity' : String(rarity);
        if (!Number.isInteger(rarity) || rarity < 2 || (state.collection[ownKey] ?? 0) <= 0) {
          throw new Error('You can only share an Orb that exists in this local test Codex.');
        }
        const text = social.shareText(state, rarity, isInfinity);
        await game.recordShareAction(state);
        return jsonResponse({ success: true, localOnly: true, id: 'pages-share-' + Date.now(), text });
      }
      case '/api/diagnostics/upgrade-rollback':
        return new Response(null, { status: 204 });
      case '/api/feedback': {
        const message = String(body.message ?? '').trim();
        if (!message) throw new Error('Please describe the bug or suggestion.');
        if (message.length > 2000) throw new Error('Please keep feedback under 2,000 characters.');
        try {
          const key = 'io-pages-test-feedback-v1';
          const existing = JSON.parse(window.localStorage.getItem(key) ?? '[]');
          const entries = Array.isArray(existing) ? existing : [];
          entries.push({
            type: body.type === 'suggestion' ? 'suggestion' : 'bug',
            message,
            createdAt: Date.now(),
            username: context.username,
          });
          window.localStorage.setItem(key, JSON.stringify(entries.slice(-50)));
        } catch {
          throw new Error('Browser storage is unavailable. Feedback was not saved.');
        }
        return jsonResponse({ success: true, localOnly: true });
      }
      case '/api/impressions':
      case '/api/impressions/conversion':
        return jsonResponse(localOnlyResult('analytics'));
      case '/api/combat/beat':
        return jsonResponse(await combat.performCombatBeat(body.sequence, body.intent, body.skillId));
      case '/api/combat/equip':
        return jsonResponse(await combat.equipCombatItem(body.itemId));
      case '/api/combat/gear/scrap':
        return jsonResponse(await combat.scrapCombatItem(body.itemId));
      case '/api/combat/forge':
        return jsonResponse(await combat.forgeCombatGear(body.slot, body.quality));
      case '/api/combat/auto-scrap': {
        const settings = await game.updateCombatAutoScrapSettings(body.enabled, body.maxQuality);
        await combat.getCombatSnapshot();
        return jsonResponse({ settings });
      }
      case '/api/combat/skills/roll':
        return jsonResponse(await combat.rollCombatSkill(body.count === 10 ? 10 : 1));
      case '/api/combat/skills/equip':
        return jsonResponse(await combat.equipCombatSkill(body.skillId, body.equip));
      case '/api/combat/skills/rank-up':
        return jsonResponse(await combat.rankUpCombatSkillGacha());
      case '/api/combat/runes/equip':
        return jsonResponse(await combat.equipCombatRune(body.runeId, body.equip));
      case '/api/combat/runes/sacrifice':
        return jsonResponse(await combat.sacrificeCombatRuneInto(body.targetRuneId, body.donorRuneId));
      case '/api/combat/runes/auto-sacrifice/settings':
        return jsonResponse(await combat.updateCombatRuneAutoSacrificeSettings(
          body.enabled,
          body.maxRarity,
          body.targetRuneId,
          body.preserveSpecialEffects,
        ));
      case '/api/combat/runes/auto-sacrifice/run':
        return jsonResponse(await combat.processCombatRuneAutoSacrifice());
      case '/api/combat/tactics':
        return jsonResponse(await combat.setCombatAutoTactic(body.tactic));
      case '/api/combat/dungeon':
        return jsonResponse(await combat.setCombatDungeon(body.dungeonId));
      case '/api/combat/upgrades/buy':
        return jsonResponse(await combat.buyCombatUpgrade(body.upgradeId));
      case '/api/combat/strategy-guide/buy':
        return jsonResponse(await combat.buyCombatStrategyGuideRank());
      case '/api/combat/arena/challenge':
        return jsonResponse(await combat.challengeCombatArena(String(body.opponentId ?? '')));
      default:
        return jsonResponse({ error: 'Unknown GitHub Pages test API endpoint: ' + path }, 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    const status = message === 'REDDIT_LOGIN_REQUIRED' ? 401 : 400;
    return errorResponse(error, status);
  }
}

const nativeFetch = window.fetch.bind(window);

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  let url: URL;
  try {
    const address = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input);
    url = new URL(address, window.location.href);
  } catch {
    return nativeFetch(input, init);
  }

  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
    return nativeFetch(input, init);
  }

  const inputMethod = typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET';
  const method = String(init?.method ?? inputMethod).toUpperCase();
  try {
    const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(input, init);
    return await handleApiRequest(url, method, body);
  } catch (error) {
    return errorResponse(error);
  }
}) as typeof window.fetch;

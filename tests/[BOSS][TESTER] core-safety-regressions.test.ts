import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInitialState, masterySkillCost, spendShards } from '../src/shared/game.js';

const source = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

test('ticket API does not expose deterministic seeds or client-side reward prediction', () => {
  const server = source('src/server/game.ts');
  const client = source('src/client/main.tsx');
  const start = server.indexOf('export async function getRollTicket');
  const end = server.indexOf('async function loadRollTicketForUse', start);
  assert.ok(start >= 0 && end > start);
  const api = server.slice(start, end);
  assert.doesNotMatch(api, /seed\s*:\s*(?:current|ticket)\.seed/);
  assert.doesNotMatch(api, /seed:\s*number/);
  assert.doesNotMatch(client, /predictRollActivation|rollTicketSeed|ticket\.seed/);
  assert.doesNotMatch(server, /createSeededRandom\(rollTicketSeed/);
  assert.match(server, /await applyRolls\(s, 1, undefined, 'online'\)/);
});

test('a mutation invalidated by an account wipe reports failure instead of success', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('if (stateGeneration !== generation)');
  const end = server.indexOf('const latest = latestRaw', start);
  assert.ok(start >= 0 && end > start);
  const block = server.slice(start, end);
  assert.match(block, /invalidated by an admin wipe/);
  assert.doesNotMatch(block, /Object\.assign\(s, fresh\)|return;/);
});

test('mastery costs reject prototype keys and invalid levels', () => {
  assert.throws(() => masterySkillCost('constructor' as never, 0), /Unknown mastery skill/);
  assert.throws(() => masterySkillCost('__proto__' as never, 0), /Unknown mastery skill/);
  assert.throws(() => masterySkillCost('toString' as never, 0), /Unknown mastery skill/);
  assert.throws(() => masterySkillCost('continuumLuck', Number.NaN), /Mastery skill level is invalid/);
  assert.throws(() => masterySkillCost('continuumLuck', -1), /Mastery skill level is invalid/);
});

test('mastery endpoint validates the skill ID with an own-property check', () => {
  const app = source('src/server/app.ts');
  assert.match(app, /hasOwnProperty\.call\(MASTERY_SKILLS, skillId\)/);
});

test('game ban middleware fails closed if it cannot verify ban state', () => {
  const app = source('src/server/app.ts');
  const catchAt = app.indexOf("console.error('Game ban check failed:'");
  const end = app.indexOf("// Reddit's payment callback", catchAt);
  assert.ok(catchAt >= 0 && end > catchAt);
  assert.match(app.slice(catchAt, end), /return res\.status\(503\)\.json/);
});

test('prestige preserves the Shard balance', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('export async function prestige(');
  const end = server.indexOf('export async function buyPrestigeUpgrade', start);
  assert.ok(start >= 0 && end > start);
  const prestige = server.slice(start, end);
  assert.match(prestige, /const keptShards = Math\.max\(0, Math\.floor\(Number\(s\.shards \?\? 0\) \|\| 0\)\)/);
  assert.match(prestige, /s\.shards = keptShards/);
});

test('game and splash viewports permit user zoom', () => {
  for (const path of ['src/client/game.html', 'src/client/splash.html']) {
    const html = source(path);
    assert.match(html, /name="viewport" content="width=device-width, initial-scale=1\.0"/);
    assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1\.0/);
  }
});

test('community event config and persisted event data are validated before mutation', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /integerOption\('goal', config\.goal, 1\)/);
  assert.match(social, /function assertValidCommunityEvent/);
  assert.match(social, /function parseCommunityEventForMutation\(raw: unknown\)/);
  assert.match(social, /assertValidCommunityEvent\(ev\)/);
  assert.match(social, /const parsedEvent = sourceRaw == null \? null : parseCommunityEventForMutation\(sourceRaw\)/);
});

test('server RNG stays on 64-bit samples and never returns zero', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('function serverRandom()');
  const end = server.indexOf('\nfunction finiteNonNegative', start);
  assert.ok(start >= 0 && end > start);
  const rng = server.slice(start, end);
  assert.match(rng, /new BigUint64Array\(1\)/);
  assert.match(rng, /18_446_744_073_709_551_616/);
  assert.match(rng, /return Math\.max\(Number\.MIN_VALUE, value\)/);
});

test('player charge and shared Global Booster activation commit atomically', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('async function claimWorldBoosterActivation');
  const end = server.indexOf('export async function activateGlobalBooster', start);
  assert.ok(start >= 0 && end > start);
  const claim = server.slice(start, end);
  assert.match(claim, /await save\(s, \{/);
  assert.match(claim, /key: GLOBAL_BOOSTERS_KEY/);
  assert.match(claim, /expectedValue: prepared\.expectedValue/);
  assert.doesNotMatch(claim, /await updateGlobalBooster\(id\)/);
  assert.match(claim, /announcement\/audit projection failed/);
});

test('admin Global Booster state uses watched compare-and-set', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('export async function setGlobalBoosterDebugState');
  const end = server.indexOf('function playerKeyFor', start);
  assert.ok(start >= 0 && end > start);
  const setter = server.slice(start, end);
  assert.match(setter, /await redis\.watch\(GLOBAL_BOOSTERS_KEY\)/);
  assert.match(setter, /await txn\.exec\(\)/);
  assert.doesNotMatch(setter, /await redis\.set\(GLOBAL_BOOSTERS_KEY/);
});

test('Global Booster activation rejects inherited object keys at the service boundary', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('export async function activateGlobalBooster(');
  const end = server.indexOf('export async function activatePremiumBooster(', start);
  assert.ok(start >= 0 && end > start);
  assert.match(server.slice(start, end), /hasOwnProperty\.call\(GLOBAL_BOOSTERS, id\)/);
});



test('roll celebrations respect the live reduced-motion preference', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(roll, /media\.addEventListener\('change', updatePreference\)/);
  assert.match(roll, /lastOrb\.rarity >= 1000 && !reducedMotion/);
  assert.match(roll, /if \(!reducedMotion\)\s*\{\s*confetti\(/);
  assert.match(roll, /\[lastOrb, hasSonarUpgrade, instantRevealActive, hasInstantUpgrade, reducedMotion\]/);
});

test('Frenzy count-up cancels when reduced motion is enabled mid-animation', () => {
  const frenzy = source('src/client/frenzy.tsx');
  assert.match(frenzy, /reducedMotion\.addEventListener\('change', handleMotionPreference\)/);
  assert.match(frenzy, /if \(event\.matches\)\s*\{\s*window\.cancelAnimationFrame\(frame\);\s*setDisplay\(rarity\)/);
  assert.match(frenzy, /reducedMotion\.removeEventListener\('change', handleMotionPreference\)/);
});

test('Frenzy expansion is requested in the trusted click turn and failed expansion falls back once', () => {
  const frenzy = source('src/client/frenzy.tsx');
  const start = frenzy.indexOf('const claim = async (event: React.MouseEvent');
  const end = frenzy.indexOf('\n  if (error && !info)', start);
  assert.ok(start >= 0 && end > start, 'Frenzy claim handler must exist');
  const handler = frenzy.slice(start, end);
  const expansionCall = handler.indexOf("requestExpandedMode(event.nativeEvent, 'game')");
  const armFetch = handler.indexOf("fetch('/api/frenzy/arm'");
  assert.ok(expansionCall >= 0 && armFetch > expansionCall, 'expanded mode must be requested before the first network await');
  assert.match(handler, /Promise\.allSettled\(\[expansionPromise, armPromise\]\)/);
  assert.match(handler, /Some previews cannot expand\. Finish the claim on this screen instead/);
  assert.equal((handler.match(/fetch\('\/api\/frenzy\/claim'/g) ?? []).length, 1);
});

test('main-game Frenzy reveal skips per-orb delays for reduced-motion users', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const reduceMotion = window.matchMedia');
  const end = main.indexOf('sound.playMythicFanfare()', start);
  assert.ok(start >= 0 && end > start, 'main-game Frenzy reveal must check motion preference');
  const reveal = main.slice(start, end);
  assert.match(reveal, /if \(reduceMotion\)\s*\{\s*setLastOrb\(res\.orb\)/);
  assert.match(reveal, /else\s*\{[\s\S]*?setTimeout\(resolve, 240\)/);
});

test('feedback modal exposes dialog semantics and a keyboard close path', () => {
  const modal = source('src/client/components/FeedbackModal.tsx');
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="feedback-modal-title"/);
  assert.match(modal, /event\.key === 'Escape' && !busy/);
  assert.match(modal, /window\.removeEventListener\('keydown', handleKeyDown\)/);
  assert.match(modal, /aria-label=\{type === 'bug' \? 'Describe the bug' : 'Describe your suggestion'\}/);
});

test('switching to reduced motion clears an in-flight same-Orb reveal state', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /if \(prevOrbRef\.current === lastOrb\)\s*\{[\s\S]*?if \(reducedMotion\)\s*\{\s*setIsRevealing\(false\);\s*setIsShaking\(false\);\s*setSonarPinging\(false\)/);
});

test('new Orb reveal cancels the previous screen-shake timer', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /let shakeTimer: number \| null = null/);
  assert.match(roll, /shakeTimer = window\.setTimeout\(\(\) => setIsShaking\(false\), 450\)/);
  assert.match(roll, /if \(shakeTimer !== null\) window\.clearTimeout\(shakeTimer\)/);
});

test('shared-Orb public preview rejects rarity above the supported game ceiling', () => {
  const shared = source('src/shared/game.ts');
  const splash = source('src/client/splash.tsx');
  assert.match(shared, /export const MAX_ORB_RARITY = 1_000_000_000_000_000_000/);
  assert.match(splash, /Number\.isInteger\(data\.rarity\)[\s\S]*?Number\(data\.rarity\) <= MAX_ORB_RARITY/);
  assert.doesNotMatch(splash, /Number\.isSafeInteger\(data\.rarity\)/);
});

test('all long-form dialogs remain scrollable on short viewports', () => {
  const feedback = source('src/client/components/FeedbackModal.tsx');
  const main = source('src/client/main.tsx');
  const share = source('src/client/components/RedditShareModal.tsx');
  const best = source('src/client/components/NewBestModal.tsx');
  const rarity = source('src/client/components/RarityTableModal.tsx');
  const changelog = source('src/client/components/ChangelogModal.tsx');
  assert.match(feedback, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain/);
  assert.ok(main.includes('max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-3xl border border-fuchsia-500/30'));
  assert.match(share, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain/);
  assert.equal((best.match(/max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain/g) ?? []).length, 2);
  assert.match(rarity, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain/);
  assert.match(changelog, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain/);
});


test('global toast uses a persistent live region for announcements', () => {
  const main = source('src/client/main.tsx');
  assert.match(main, /className="sr-only"[\s\S]*?role=\{toast\?\.type === 'warn' \? 'alert' : 'status'\}/);
  assert.match(main, /aria-live=\{toast\?\.type === 'warn' \? 'assertive' : 'polite'\}/);
  assert.match(main, /aria-atomic="true"[\s\S]*?\{toast\?\.msg \?\? ''\}/);
  assert.doesNotMatch(main, /\{toast && \([\s\S]*?role=\{toast\.type === 'warn'/);
});

test('Frenzy handoff rejects malformed persisted expiry types', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function readFrenzyHandoff');
  const end = game.indexOf('\\nexport async function armOrbFrenzyClaim', start);
  assert.ok(start >= 0 && end > start, 'handoff reader must exist');
  const reader = game.slice(start, end);
  assert.match(reader, /typeof expiresAt !== 'number'/);
  assert.match(reader, /Number\.isSafeInteger\(expiresAt\)/);
  assert.doesNotMatch(reader, /Number\(data\?\.expiresAt/);
});


test('Celestial Auto-Buyer preserves its 50-Coin reserve when enabled', () => {
  const game = source('src/server/game.ts');
  const shared = source('src/shared/game.ts');
  assert.match(shared, /export const AUTO_BUYER_COIN_RESERVE = 50/);
  assert.match(shared, /keeping a 50-Coin reserve/);
  assert.match(game, /const reserveCoins = s\.prestigeUpgrades\?\.autoBuyer \? AUTO_BUYER_COIN_RESERVE : 0/);
  const start = game.indexOf('export function autoBuyCheapest');
  const end = game.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'Auto-Buyer helper must exist');
  const helper = game.slice(start, end);
  assert.match(helper, /const spendableCoins = Math\.max\(0, s\.coins - reserve\)/);
  assert.match(helper, /cost <= spendableCoins/);
  assert.match(helper, /s\.coins - lowestCost >= reserve/);
});


test('payment fulfillment and refund verify buyer, status, and SKU against provider order history', () => {
  const app = source('src/server/app.ts');
  const verifyStart = app.indexOf('async function verifyPaymentOrder');
  const resolveStart = app.indexOf('async function resolvePaymentBuyerId');
  const createAppStart = app.indexOf('export function createApp()');
  assert.ok(verifyStart >= 0 && resolveStart > verifyStart && createAppStart > resolveStart);
  const verifier = app.slice(verifyStart, resolveStart);
  const resolver = app.slice(resolveStart, createAppStart);
  assert.match(verifier, /payments\.getOrders\(\{ limit: 50, buyer \}\)/);
  assert.match(verifier, /paymentOrderId\(candidate\) !== id/);
  assert.match(verifier, /!allowedStatuses\.includes\(status\)/);
  assert.match(verifier, /paymentProductSku\(candidate\)/);
  assert.match(resolver, /verifyPaymentOrder\(orderId, candidate, allowedStatuses\)/);
  assert.doesNotMatch(resolver, /hasReadablePlayerSave/);
  assert.match(app, /resolvePaymentBuyerId\(order, orderId, \['PAID'\]\)/);
  assert.match(app, /resolvePaymentBuyerId\(order, orderId, \['REFUNDED'\]\)/);
});

test('purchase reconciliation filters to a requested order ID and only grants explicitly paid orders', () => {
  const app = source('src/server/app.ts');
  const start = app.indexOf("app.post('/api/payments/reconcile'");
  const end = app.indexOf("\n  app.get('/api/products'", start);
  assert.ok(start >= 0 && end > start, 'reconciliation route must exist');
  const route = app.slice(start, end);
  assert.match(route, /const requestedOrderId = String\(req\.body\?\.orderId \?\? ''\)\.trim\(\)/);
  assert.match(route, /if \(requestedOrderId && orderId !== requestedOrderId\) continue/);
  assert.match(route, /if \(status !== 'PAID'\) continue/);
});


test('Shards spending consumes free balance before per-order purchased lots', () => {
  const state = createInitialState(Date.UTC(2026, 9, 10));
  state.shards = 50;
  state.purchasedShards = 30;
  state.purchasedShardLots = { 'order-a': 30 };

  assert.equal(spendShards(state, 20), 20);
  assert.equal(state.shards, 30);
  assert.equal(state.purchasedShards, 30);
  assert.equal(state.purchasedShardLots?.['order-a'], 30);

  assert.equal(spendShards(state, 20), 20);
  assert.equal(state.shards, 10);
  assert.equal(state.purchasedShards, 10);
  assert.equal(state.purchasedShardLots?.['order-a'], 10);
});

test('purchase grants and refunds track remaining currency by order', () => {
  const game = source('src/server/game.ts');
  const grantStart = game.indexOf('export async function grantPurchasedPack');
  const refundStart = game.indexOf('export async function refundPurchasedPack');
  const refundEnd = game.indexOf('\\nexport async function loadRaw', refundStart);
  assert.ok(grantStart >= 0 && refundStart > grantStart && refundEnd > refundStart);
  const grant = game.slice(grantStart, refundStart);
  const refund = game.slice(refundStart, refundEnd);
  assert.match(grant, /state\.purchasedShardLots\[orderId\][\s\S]*?pack\.shards/);
  assert.match(grant, /state\.globalBoosterCreditLots\[orderId\][\s\S]*?pack\.globalBoosterCredits/);
  assert.match(refund, /const orderShardLot = normalizeSafeInteger\(state\.purchasedShardLots\[orderId\], 0\)/);
  assert.match(refund, /const orderCreditLot = normalizeSafeInteger\(state\.globalBoosterCreditLots\[orderId\], 0\)/);
  assert.match(refund, /const generationKey = saveGenerationKeyFor\(userId\)/);
  assert.match(refund, /stateGeneration !== generation/);
});

test('Global Booster activation decrements purchased credit provenance and restores it on failed commit', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function claimWorldBoosterActivation');
  const end = game.indexOf('\\nexport async function activateGlobalBooster', start);
  assert.ok(start >= 0 && end > start);
  const activation = game.slice(start, end);
  assert.match(activation, /const previousGlobalBoosterCreditLots/);
  assert.match(activation, /const lots = normalizeEntitlementLots\(\s*s\.globalBoosterCreditLots/);
  assert.match(activation, /for \(const orderId of Object\.keys\(lots\)\)/);
  assert.match(activation, /s\.globalBoosterCreditLots = previousGlobalBoosterCreditLots/);
  assert.match(activation, /s\.purchasedShardLots = previousPurchasedShardLots/);
});


test('Altar submit state matches the actual coin-floor and non-empty-offer validation', () => {
  const altar = source('src/client/components/AltarSection.tsx');
  assert.match(altar, /const canSubmitOffering =\s*\(selectedCoinOffer <= 0 \|\| coinOfferMeetsFloor\) &&\s*\(selectedCoinOffer > 0 \|\| selectedShardOffer > 0\)/);
  assert.match(altar, /disabled=\{busy \|\| sacrificing \|\| !canSubmitOffering\}/);
  assert.match(altar, /canSubmitOffering\s*\?\s*'bg-orange-600/);
  const handlerStart = altar.indexOf('const handleSacrificeSubmit');
  const handlerEnd = altar.indexOf('setSacrificing(true)', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  assert.match(altar.slice(handlerStart, handlerEnd), /selectedCoinOffer > 0 && selectedCoinOffer < currentCoinFloor/);
});


test('share cooldown is durable before Reddit post creation and quest progress cannot trigger duplicate retries', () => {
  const app = source('src/server/app.ts');
  const game = source('src/server/game.ts');
  const start = app.indexOf("app.post('/api/share'");
  const end = app.indexOf('\\n  return app;', start);
  assert.ok(start >= 0 && end > start, 'share route must exist');
  const route = app.slice(start, end);
  const reserve = route.indexOf('await reserveShareCooldown(s)');
  const submit = route.indexOf('await reddit.submitCustomPost');
  const quest = route.indexOf('await recordShareQuestProgress(s)');
  assert.ok(reserve >= 0 && submit > reserve, 'cooldown must commit before external Reddit submit');
  assert.ok(quest > submit, 'share quest progress must follow the external post');
  const questTry = route.indexOf('try {', quest - 30);
  const questCatch = route.indexOf('catch (progressError)', quest);
  const success = route.indexOf('res.json({ success: true, id: postId, text })');
  assert.ok(questCatch > questTry && success > questCatch, 'quest save failure must not return a retry-triggering error after post success');
  assert.match(route, /Post completed but quest progress save failed; cooldown remains committed/);
  const helperStart = game.indexOf('export async function reserveShareCooldown');
  const helperEnd = game.indexOf('\\n}', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'durable reservation helper must exist');
  const helper = game.slice(helperStart, helperEnd);
  assert.match(helper, /assertShareCooldownAvailable\\(s, now\\)/);
  assert.match(helper, /s\\.lastShareAt = now/);
  assert.match(helper, /await save\\(s\\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('follow reward save and its idempotency marker commit through the same save transaction', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimFollowReward');
  const end = game.indexOf('\nexport async function claimOffline', start);
  assert.ok(start >= 0 && end > start, 'claimFollowReward function must exist');
  const reward = game.slice(start, end);

  assert.match(reward, /await save\(s, \{[\s\S]*?key: rewardKey,[\s\S]*?expectedValue: null,[\s\S]*?nextValue: rewardMarker/);
  assert.match(reward, /if \(await redis\.get\(rewardKey\) !== rewardMarker\)/);
  assert.doesNotMatch(reward, /await redis\.set\(rewardKey,/);
  assert.match(reward, /void recordLeaderboard\(s\)\.catch/);
  assert.doesNotMatch(reward, /await recordLeaderboard\(s\)/);
});

test('Frenzy client retries read-only preflight but does not retry the claim POST', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const resolveFrenzy = async () =>');
  const end = main.indexOf('\n    void resolveFrenzy()', start);
  assert.ok(start >= 0 && end > start, 'Frenzy resolver must exist');
  const resolver = main.slice(start, end);

  assert.match(resolver, /for \(let attempt = 0; attempt < 12; attempt\+\+\)/);
  assert.match(resolver, /getJson<RollResponse>\('\/api\/frenzy\/claim', \{ method: 'POST' \}\)/);
  assert.equal(
    (resolver.match(/getJson<RollResponse>\('\/api\/frenzy\/claim'/g) ?? []).length,
    1,
    'a potentially committed claim must not be automatically posted a second time',
  );
  assert.match(main.slice(end, end + 500), /showToast\(error\?\.message/);
});

test('global chat refresh replaces history with the server moderation-filtered snapshot', () => {
  const chat = source('src/client/components/GlobalChatWindow.tsx');
  assert.match(chat, /setMessages\(next\.slice\(-100\)\)/);
  assert.doesNotMatch(chat, /setMessages\(prev => mergeMessages\(prev, next\)\)/);
});

test('the static splash is imported and shown before the main game shell', () => {
  const main = source('src/client/main.tsx');
  const splash = source('src/client/components/SplashScreen.tsx');
  assert.match(main, /import \{ SplashScreen \} from '\.\/components\/SplashScreen\.js'/);
  assert.match(main, /if \(!splashEntered\)\s*\{[\s\S]*?<SplashScreen/);
  assert.match(splash, /infinity orbs/);
  assert.match(splash, /roll, collect, go further/);
  assert.doesNotMatch(splash, /setInterval|setTimeout|animate-/);
});

test('Reddit share failures render an accessible error instead of silently closing busy state', () => {
  const share = source('src/client/components/RedditShareModal.tsx');
  assert.match(share, /catch \(error\)\s*\{[\s\S]*?setErrorMessage/);
  assert.match(share, /role="alert"/);
});

test('global booster duration and UI copy agree on a two-hour activation', () => {
  const shared = source('src/shared/game.ts');
  const boosters = source('src/client/components/BoostersAndAutomation.tsx');
  const main = source('src/client/main.tsx');
  assert.match(shared, /GLOBAL_BOOSTER_DURATION_MS = 2 \* 60 \* 60 \* 1000/);
  assert.match(boosters, /Every activation adds 2 hours to its timer/);
  assert.match(boosters, /\+2h/);
  assert.match(main, /activated \{boosterAnnouncement\.name\} booster for 2 hours!/);
  assert.doesNotMatch(boosters, /adds 30 minutes|\+30m/);
});

test('Frenzy claim reserves claimant, owner, and post locks in a deterministic order', () => {
  const game = source('src/server/game.ts');
  const helperStart = game.indexOf('async function withPlayerMutationLocksFor');
  const helperEnd = game.indexOf('\nconst key =', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'multi-lock helper must exist');
  const helper = game.slice(helperStart, helperEnd);
  assert.match(helper, /\.sort\(\)/);

  const start = game.indexOf('export async function claimOrbFrenzy');
  const end = game.indexOf('\n\nfunction sampleBinomial', start);
  assert.ok(start >= 0 && end > start, 'claim function must exist');
  const claim = game.slice(start, end);
  assert.match(claim, /const postLockId =/);
  assert.match(claim, /__frenzy-post__/);
  assert.match(claim, /return withPlayerMutationLocksFor\(lockIds/);
  assert.match(claim, /if \(data\.consumedAt != null\)/);
  assert.match(claim, /expectedValue: raw,[\s\S]*?nextValue: consumedPostValue/);
  assert.match(claim, /if \(await redis\.get\(FRENZY_POST_PREFIX \+ postId\) !== consumedPostValue\)/);
});

test('missing-key initialization cannot overwrite a concurrent first write', () => {
  const game = source('src/server/game.ts');
  const social = source('src/server/social.ts');
  const mock = source('src/server/devvit-mock.ts');
  assert.match(game, /redis\.set\(keyName, fallback, \{ nx: true \}\)/);
  assert.match(social, /redis\.set\(keyName, fallback, \{ nx: true \}\)/);
  assert.match(mock, /options\?\.nx && readStore\(key\) !== undefined/);
  assert.match(mock, /options\?\.expiration instanceof Date/);
});

test('game ban mutations use WATCH/EXEC so concurrent admins cannot erase each other', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function mutateGameBans');
  const end = game.indexOf('export async function getGameBanStatus', start);
  assert.ok(start >= 0 && end > start, 'atomic ban mutation helper must exist');
  const helper = game.slice(start, end);
  assert.match(helper, /redis\.watch\(GAME_BANS_KEY\)/);
  assert.match(helper, /await txn\.exec\(\)/);
  assert.match(game, /return mutateGameBans\(bans => \{/);
  assert.doesNotMatch(game, /async function writeGameBans/);
});

test('CCU peak recording uses a monotonic watched update', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function updateCcuPeak');
  const end = game.indexOf('async function recordCcuPeak', start);
  assert.ok(start >= 0 && end > start, 'CCU peak helper must exist');
  const helper = game.slice(start, end);
  assert.match(helper, /redis\.watch\(keyName\)/);
  assert.match(helper, /candidate <= current/);
  assert.match(helper, /await txn\.exec\(\)/);
  assert.match(game, /await updateCcuPeak\(hourKey, ccu\)/);
  assert.match(game, /await updateCcuPeak\(CCU_ALL_TIME_KEY, ccu\)/);
});

test('offline claim persists the reward before clearing reminders and does not fail on leaderboard projection errors', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOffline');
  const end = game.indexOf('\nexport async function buyUpgrade', start);
  assert.ok(start >= 0 && end > start, 'claimOffline function must exist');
  const claim = game.slice(start, end);
  const saveIndex = claim.indexOf('await save(s)');
  const notificationDeleteIndex = claim.indexOf('redis.del(OFFLINE_FULL_NOTIFICATION_PREFIX');
  const jobDeleteIndex = claim.indexOf('redis.del(OFFLINE_FULL_JOB_PREFIX');
  assert.ok(saveIndex >= 0, 'offline claim must durably save the reward');
  assert.ok(notificationDeleteIndex > saveIndex, 'notification must only be cleared after the save commits');
  assert.ok(jobDeleteIndex > saveIndex, 'scheduled job must only be cleared after the save commits');
  assert.match(claim, /void recordLeaderboard\(s\)\.catch/);
  assert.doesNotMatch(claim, /await recordLeaderboard\(s\)/);
});

test('roll celebrations respect the live reduced-motion preference', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(roll, /media\.addEventListener\('change', updatePreference\)/);
  assert.match(roll, /lastOrb\.rarity >= 1000 && !reducedMotion/);
  assert.match(roll, /if \(!reducedMotion\)\s*\{\s*confetti\(/);
  assert.match(roll, /\[lastOrb, hasSonarUpgrade, instantRevealActive, hasInstantUpgrade, reducedMotion\]/);
});

test('default splash entrypoint does not disable user zoom', () => {
  const splash = source('src/client/splash.html');
  assert.match(splash, /name="viewport" content="width=device-width, initial-scale=1\.0"/);
  assert.doesNotMatch(splash, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?/i);
});

test('Frenzy reveal skips per-orb JavaScript delays for reduced-motion users', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const reduceMotion = window.matchMedia');
  const end = main.indexOf('sound.playMythicFanfare()', start);
  assert.ok(start >= 0 && end > start, 'Frenzy reveal must check reduced-motion preference');
  const reveal = main.slice(start, end);
  assert.match(reveal, /if \(reduceMotion\)\s*\{\s*setLastOrb\(res\.orb\)/);
  assert.match(reveal, /else\s*\{[\s\S]*?setTimeout\(resolve, 240\)/);
});

test('roll tickets reject malformed persisted index and expiry types', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function getRollTicket');
  const end = game.indexOf('\nexport async function roll(', start);
  assert.ok(start >= 0 && end > start, 'roll ticket helpers must exist');
  const tickets = game.slice(start, end);
  assert.match(tickets, /Number\.isSafeInteger\(current\.nextIndex\)/);
  assert.match(tickets, /Number\.isSafeInteger\(current\.expiresAt\)/);
  assert.match(tickets, /Number\.isSafeInteger\(ticket\.nextIndex\)/);
  assert.match(tickets, /Number\.isSafeInteger\(ticket\.expiresAt\)/);
});

test('Frenzy expansion is requested in the trusted click turn and failed expansion falls back once', () => {
  const frenzy = source('src/client/frenzy.tsx');
  const start = frenzy.indexOf('const claim = async (event: React.MouseEvent');
  const end = frenzy.indexOf('\n  if (error && !info)', start);
  assert.ok(start >= 0 && end > start, 'Frenzy claim handler must exist');
  const handler = frenzy.slice(start, end);
  const expansionCall = handler.indexOf('requestExpandedMode(event.nativeEvent, \'game\')');
  const armFetch = handler.indexOf('fetch(\'/api/frenzy/arm\'');
  assert.ok(expansionCall >= 0 && armFetch > expansionCall, 'expanded mode must be requested before the first network await');
  assert.match(handler, /Promise\.allSettled\(\[expansionPromise, armPromise\]\)/);
  assert.match(handler, /Some previews cannot expand\. Finish the claim on this screen instead/);
  assert.equal((handler.match(/fetch\('\/api\/frenzy\/claim'/g) ?? []).length, 1);
});

test('daily streak community progression validates stored goal and fails closed on corrupt data', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /function isValidDailyStreakCommunityEvent\(value: unknown\)/);
  assert.match(social, /Number\.isSafeInteger\(event\.goal\)[\s\S]*?Number\(event\.goal\) > 0/);
  assert.match(social, /if \(raw != null && raw !== '' && !isValidDailyStreakCommunityEvent\(parsed\)\)/);
  assert.match(social, /Stored Daily Streak event is invalid/);
  assert.match(social, /while \(event\.currentProgress >= event\.goal\)/);
});

test('new Orb reveal cancels the previous screen-shake timer', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /let shakeTimer: number \| null = null/);
  assert.match(roll, /shakeTimer = window\.setTimeout\(\(\) => setIsShaking\(false\), 450\)/);
  assert.match(roll, /if \(shakeTimer !== null\) window\.clearTimeout\(shakeTimer\)/);
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

test('Guild reset migrations re-check completion markers under a shared lock', () => {
  const social = source('src/server/social.ts');
  const upgradeStart = social.indexOf('const upgradeResetDone =');
  const tokenStart = social.indexOf('const resetDone =', upgradeStart);
  const upgrade = social.slice(upgradeStart, tokenStart);
  const tokenEnd = social.indexOf('if (expiredCombo)', tokenStart);
  const tokens = social.slice(tokenStart, tokenEnd);
  assert.match(upgrade, /withPlayerMutationLockFor\('__guild-upgrade-reset-migration__'/);
  assert.match(upgrade, /if \(await redis\.get\(GUILD_UPGRADE_RESET_KEY\)\) return false/);
  assert.match(tokens, /withPlayerMutationLockFor\('__guild-token-reset-migration__'/);
  assert.match(tokens, /if \(await redis\.get\(GUILD_TOKEN_RESET_KEY\)\) return false/);
});

test('switching to reduced motion clears an in-flight same-Orb reveal state', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /if \(prevOrbRef\.current === lastOrb\)\s*\{[\s\S]*?if \(reducedMotion\)\s*\{\s*setIsRevealing\(false\);\s*setIsShaking\(false\);\s*setSonarPinging\(false\)/);
});

test('owned high-rarity Orbs remain shareable and render on the public entrypoint', () => {
  const shared = source('src/shared/game.ts');
  const app = source('src/server/app.ts');
  const splash = source('src/client/splash.tsx');
  assert.match(shared, /export const MAX_ORB_RARITY = 1_000_000_000_000_000_000/);
  assert.match(app, /Number\.isInteger\(value\)[\s\S]*?value > MAX_ORB_RARITY[\s\S]*?s\.collection\[String\(value\)\]/);
  assert.match(splash, /Number\.isInteger\(data\.rarity\) && Number\(data\.rarity\) > 0 && Number\(data\.rarity\) <= MAX_ORB_RARITY/);
  assert.doesNotMatch(splash, /Number\.isSafeInteger\(data\.rarity\)/);
});

test('polled online count survives optimistic and authoritative player-state updates', () => {
  const main = source('src/client/main.tsx');
  assert.match(main, /if \(current\) stateRef\.current = \{ \.\.\.current, onlinePlayers \}/);
  assert.match(main, /const onlinePlayers = stateRef\.current\?\.onlinePlayers/);
  assert.match(main, /const appliedState = Number\.isFinite\(onlinePlayers\)[\s\S]*?\{ \.\.\.nextState, onlinePlayers \}/);
  assert.match(main, /stateRef\.current = appliedState/);
  assert.match(main, /setState\(appliedState\)/);
});

test('feedback and notification dialogs remain scrollable on short viewports', () => {
  const feedback = source('src/client/components/FeedbackModal.tsx');
  const main = source('src/client/main.tsx');
  assert.match(feedback, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain/);
  assert.match(main, /max-h-\[calc\(100dvh-2rem\)\] overflow-y-auto overscroll-contain rounded-3xl border border-fuchsia-500/30/);
});

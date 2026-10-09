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

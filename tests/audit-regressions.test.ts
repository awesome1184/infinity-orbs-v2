import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Follow Reward leaderboard projection failure is not reported as claim failure', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimFollowReward');
  const end = game.indexOf('export async function claimOffline', start);
  assert.ok(start >= 0 && end > start);
  const claim = game.slice(start, end);
  const saveIndex = claim.indexOf('await save(s, {');
  const markerIndex = claim.indexOf("if (await redis.get(rewardKey) !== rewardMarker)");
  const projectionIndex = claim.indexOf('void recordLeaderboard(s).catch');
  assert.ok(saveIndex >= 0 && markerIndex > saveIndex && projectionIndex > markerIndex);
  assert.doesNotMatch(claim.slice(projectionIndex, claim.indexOf("void appendPlayerSpyLog", projectionIndex)), /await recordLeaderboard/);
  assert.match(claim, /Leaderboard projection failed after reward commit/);
});

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

 
test('roll tickets disclose no RNG seed and client never predicts authoritative rewards', () => {
  const game = source('src/server/game.ts');
  const client = source('src/client/main.tsx');
  const getTicketStart = game.indexOf('export async function getRollTicket');
  const getTicketEnd = game.indexOf('async function loadRollTicketForUse', getTicketStart);
  assert.ok(getTicketStart >= 0 && getTicketEnd > getTicketStart);
  const ticketApi = game.slice(getTicketStart, getTicketEnd);
  assert.doesNotMatch(ticketApi, /seed\s*:/);
  assert.doesNotMatch(ticketApi, /current\.seed|ticket\.seed/);
  assert.doesNotMatch(client, /predictRollActivation|rollTicketSeed/);
  const rollStart = game.indexOf('export async function roll(');
  const rollEnd = game.indexOf('export async function subscribeToSubredditForReward', rollStart);
  assert.ok(rollStart >= 0 && rollEnd > rollStart);
  const roll = game.slice(rollStart, rollEnd);
  assert.doesNotMatch(roll, /createSeededRandom|rollTicketSeed/);
  assert.match(roll, /await applyRolls\(s, 1, undefined, 'online'\)/);
  assert.match(game, /const rng = randomOverride \?\? serverRandom/);
});

test('player mutation lock renews its lease and releases only its own token', () => {
  const lock = source('src/server/player-lock.ts');
  assert.match(lock, /renewOwnedLock\(lockKey, token\)/);
  assert.match(lock, /PLAYER_MUTATION_LOCK_TTL_MS \/ 3/);
  const releaseStart = lock.indexOf('async function releaseOwnedLock');
  const releaseEnd = lock.indexOf('async function runLocked', releaseStart);
  assert.ok(releaseStart >= 0 && releaseEnd > releaseStart);
  const release = lock.slice(releaseStart, releaseEnd);
  assert.match(release, /redis\.watch\(lockKey\)/);
  assert.match(release, /await txn\.del\(lockKey\)/);
  assert.doesNotMatch(release, /await redis\.del\(lockKey\)/);
});

test('mastery upgrades reject inherited property names and ban middleware fails closed', () => {
  const app = source('src/server/app.ts');
  const game = source('src/server/game.ts');
  const routeStart = app.indexOf("app.post('/api/mastery/upgrade'");
  const routeEnd = app.indexOf("app.post('/api/cosmetics/buy'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = app.slice(routeStart, routeEnd);
  assert.match(route, /hasOwnProperty\.call\(MASTERY_SKILLS, skillId\)/);
  assert.match(route, /status\(400\)/);
  const serviceStart = game.indexOf('export async function upgradeMasterySkill');
  const serviceEnd = game.indexOf('export async function synthesizeDust', serviceStart);
  assert.ok(serviceStart >= 0 && serviceEnd > serviceStart);
  assert.match(game.slice(serviceStart, serviceEnd), /hasOwnProperty\.call\(MASTERY_SKILLS, skillId\)/);
  const banStart = app.indexOf("// Game bans are enforced server-side.");
  const banEnd = app.indexOf("// Reddit's payment callback", banStart);
  assert.ok(banStart >= 0 && banEnd > banStart);
  assert.match(app.slice(banStart, banEnd), /status\(503\)/);
  assert.match(app.slice(banStart, banEnd), /return next\(\)/);
});

test('Prestige optimistic state preserves Shards just like the server', () => {
  const client = source('src/client/main.tsx');
  const start = client.indexOf('const handlePrestige');
  const end = client.indexOf('const handleBuyPrestigeUpgrade', start);
  assert.ok(start >= 0 && end > start);
  const prestige = client.slice(start, end);
  assert.match(prestige, /shards:\s*current\.shards \?\? 0/);
  assert.doesNotMatch(prestige, /shards:\s*keptShards/);
});

test('community event rejects infinite and non-terminating progression values', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /function validateCommunityEventConfig/);
  assert.match(social, /Number\.isFinite\(config\.buffMultiplier\)/);
  assert.match(social, /Number\.isSafeInteger\(amount\)/);
  assert.match(social, /assertSafeProgressionNumbers\('Community event'/);

  const helperStart = social.indexOf('function nextCommunityMilestoneProgression(');
  const helperEnd = social.indexOf('\nexport async function prepareCommunityRolls', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'shared progression guard must exist');
  const helper = social.slice(helperStart, helperEnd);
  assert.match(helper, /Number\.isSafeInteger\(nextGoal\)/);
  assert.match(helper, /nextGoal <= goal/);
  assert.match(helper, /tier >= Number\.MAX_SAFE_INTEGER/);

  const prepStart = social.indexOf('export async function prepareCommunityRolls');
  const prepEnd = social.indexOf('export async function addCommunityRolls', prepStart);
  assert.ok(prepStart >= 0 && prepEnd > prepStart);
  const prepare = social.slice(prepStart, prepEnd);
  assert.match(prepare, /nextCommunityMilestoneProgression\(ev\.goal, ev\.tier/);
  assert.match(prepare, /ev\.currentProgress = Math\.min\(Number\.MAX_SAFE_INTEGER - 1, ev\.currentProgress \+ amount\)/);
  assert.ok(
    prepare.indexOf('nextCommunityMilestoneProgression(ev.goal') <
      prepare.indexOf('ev.currentProgress = Math.min'),
    'World Event next-goal feasibility is checked before mutating prepared progress',
  );
  assert.doesNotMatch(prepare, /ev\.goal = Number\.MAX_SAFE_INTEGER/);

  const configStart = social.indexOf('export async function setCommunityEventConfig');
  const configEnd = social.indexOf('const GLOBAL_CHAT_KEY', configStart);
  assert.ok(configStart >= 0 && configEnd > configStart);
  const config = social.slice(configStart, configEnd);
  assert.match(config, /nextCommunityMilestoneProgression\(ev\.goal, ev\.tier/);
  assert.match(config, /catch \(error\) \{\s*await txn\.unwatch\(\);\s*throw error;\s*\}/);
  assert.ok(
    config.indexOf("nextCommunityMilestoneProgression(ev.goal") <
      config.indexOf("while (ev.currentProgress >= ev.goal)"),
    'admin configuration validates progression before entering the milestone loop',
  );
  assert.doesNotMatch(config, /ev\.goal = Number\.MAX_SAFE_INTEGER/);
});

test('chat side effects use per-user atomic cooldowns and real newlines', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /function enforceChatCooldown/);
  assert.match(social, /nx:\s*true/);
  assert.match(social, /expiration:\s*new Date/);
  assert.match(social, /enforceChatCooldown\('global', 2_000\)/);
  assert.match(social, /enforceChatCooldown\('guild', 2_000\)/);
  assert.match(social, /enforceChatCooldown\('report', 5_000\)/);
  assert.ok(social.includes(".split(/\\r?\\n/)"));
  assert.ok(social.includes("].join('\\n');"));
  assert.doesNotMatch(social, /split\('\\\\n'\)/);
});

test('Global Booster debug updates validate and CAS the full snapshot', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function setGlobalBoosterDebugState');
  const end = game.indexOf('function playerKeyFor', start);
  assert.ok(start >= 0 && end > start);
  const setter = game.slice(start, end);
  assert.match(setter, /Number\.isSafeInteger\(tier\)/);
  assert.match(setter, /Number\.isSafeInteger\(minutes\)/);
  assert.match(setter, /hasOwnProperty\.call\(GLOBAL_BOOSTERS, id\)/);
  assert.match(setter, /redis\.watch\(GLOBAL_BOOSTERS_KEY\)/);
  assert.match(setter, /await txn\.exec\(\)/);
  assert.doesNotMatch(setter, /await redis\.set\(GLOBAL_BOOSTERS_KEY/);
  assert.match(setter, /refusing to overwrite it/);
});


test('wiped saves cannot return mutation success and offline reminder keys survive failed claims', () => {
  const game = source('src/server/game.ts');
  const saveStart = game.indexOf('export async function save(');
  const saveEnd = game.indexOf('export async function loadRaw', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const save = game.slice(saveStart, saveEnd);
  const mismatch = save.indexOf('if (stateGeneration !== generation)');
  const mismatchEnd = save.indexOf('const latest =', mismatch);
  assert.ok(mismatch >= 0 && mismatchEnd > mismatch);
  assert.match(save.slice(mismatch, mismatchEnd), /PLAYER_STATE_INVALIDATED_BY_WIPE/);
  assert.doesNotMatch(save.slice(mismatch, mismatchEnd), /Object\.assign\(s, fresh\);\s*await txn\.unwatch\(\);\s*return;/);

  const claimStart = game.indexOf('export async function claimOffline');
  const claimEnd = game.indexOf('export async function buyUpgrade', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = game.slice(claimStart, claimEnd);
  assert.ok(claim.indexOf('await save(s)') < claim.indexOf('OFFLINE_FULL_NOTIFICATION_PREFIX'));
  assert.ok(claim.indexOf('await save(s)') < claim.indexOf('OFFLINE_FULL_JOB_PREFIX'));
});


test('Global Booster activation cannot replace corrupt data with defaults', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function prepareGlobalBoosterActivation');
  const end = game.indexOf('export async function setGlobalBoosterDebugState', start);
  assert.ok(start >= 0 && end > start);
  const updater = game.slice(start, end);
  assert.match(updater, /raw == null\s*\?\s*createInitialGlobalBoosters\(now\)/);
  assert.match(updater, /parseGlobalBoosterSnapshot\(raw, now\)/);
  assert.match(updater, /Global Booster data is corrupted; refusing to overwrite it/);
  assert.doesNotMatch(updater, /parseGlobalBoosterSnapshot\(raw, now\)\s*\?\?\s*createInitialGlobalBoosters/);
});


test('valid Daily Streak community reads avoid rewriting the watched global key', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function getDailyStreakCommunity');
  const end = social.indexOf('export async function prepareDailyStreakCommunityProgress', start);
  assert.ok(start >= 0 && end > start);
  const getter = social.slice(start, end);
  const fastPath = getter.indexOf('const currentRaw = await redis.get(DAILY_STREAK_COMMUNITY_KEY)');
  const watch = getter.indexOf('redis.watch(DAILY_STREAK_COMMUNITY_KEY)');
  const returnCurrent = getter.indexOf('if (current.weekId === currentWeek && now < current.endsAt) return current');
  assert.ok(fastPath >= 0 && watch > fastPath, 'common valid read must precede WATCH transaction');
  assert.ok(returnCurrent > fastPath && returnCurrent < watch, 'current-week data should return without SET');
  assert.match(getter, /Daily Streak community data is corrupted/);
});

test('Daily Streak community progression rejects invalid loop state', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /function validateDailyStreakCommunityEvent/);
  assert.match(social, /Daily Streak community data is corrupted/);
  assert.match(social, /Daily Streak contribution must be a finite safe integer/);
  const start = social.indexOf('export async function prepareDailyStreakCommunityProgress');
  const end = social.indexOf('export async function addDailyStreakCommunityProgress', start);
  assert.ok(start >= 0 && end > start);
  const prepare = social.slice(start, end);
  assert.match(prepare, /Number\.isSafeInteger\(contribution\)/);
  assert.match(prepare, /validateDailyStreakCommunityEvent\(event\)/);
  assert.match(prepare, /nextCommunityMilestoneProgression\(event\.goal, event\.tier \|\| 1/);
  assert.ok(
    prepare.indexOf("nextCommunityMilestoneProgression(event.goal") <
      prepare.indexOf("event.currentProgress += contribution"),
    'Daily Streak validates a future goal before mutating prepared progress',
  );
  assert.doesNotMatch(prepare, /event\.goal = Number\.MAX_SAFE_INTEGER/);
});


test('guild parser rejects malformed nested economy and boss state before normalization', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('function validateGuildNestedState');
  const end = social.indexOf('function parseGuildList', start);
  assert.ok(start >= 0 && end > start, 'nested Guild validator must exist before normalization');
  const validator = social.slice(start, end);
  assert.match(validator, /perkCaps/);
  assert.match(validator, /guildXpRank: 20/);
  assert.match(validator, /if \(value == null\) continue; \/\/ Legacy saves can omit core economy defaults/);
  const normalizeStart = social.indexOf('function normalizeGuilds');
  const normalizeEnd = social.indexOf('function generatedFallbackTaskType', normalizeStart);
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
  const normalize = social.slice(normalizeStart, normalizeEnd);
  assert.match(normalize, /g\.level \?\?= 1/);
  assert.match(normalize, /g\.xp \?\?= 0/);
  assert.match(normalize, /g\.tokens \?\?= 0/);
  assert.match(validator, /Number\.isSafeInteger\(member\.contribution\)/);
  assert.match(validator, /guild\.challenge != null/);
  assert.match(validator, /Number\(challenge\.progress\) > Number\(challenge\.target\)/);
  assert.match(validator, /guild\.createdAt != null/);
  assert.match(validator, /Number\.isSafeInteger\(value\)/);
  assert.match(validator, /guild\.tasks != null/);
  assert.match(validator, /!isRecordValue\(task\)/);
  assert.match(validator, /guild\.chat != null/);
  assert.match(validator, /typeof message\.text !== 'string'/);
  assert.match(validator, /guild\.bossWeek === weekKey\(\)/);
  assert.match(validator, /boss\.currentHp > boss\.maxHp/);
  const parserStart = social.indexOf('function parseGuildList');
  const parserEnd = social.indexOf('function parseLeaderboardList', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  assert.match(social.slice(parserStart, parserEnd), /validateGuildNestedState\(item as Record<string, unknown>\)/);
});

test('Guild migration marker and transformed guild data commit atomically', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /async function applyGuildMigration/);
  const start = social.indexOf('async function applyGuildMigration');
  const end = social.indexOf('async function ensureGuildMigrations', start);
  assert.ok(start >= 0 && end > start);
  const migration = social.slice(start, end);
  assert.match(migration, /redis\.watch\(GUILDS_KEY, markerKey\)/);
  assert.match(migration, /await txn\.set\(GUILDS_KEY, JSON\.stringify\(guilds\)\)/);
  assert.match(migration, /await txn\.set\(markerKey, '1'\)/);
  assert.match(migration, /await txn\.exec\(\)/);
  assert.match(migration, /if \(marker != null\)/);
  const writerStart = social.indexOf('async function updateGuilds<T>');
  const readerStart = social.indexOf('async function loadGuilds');
  assert.ok(writerStart >= 0 && readerStart > writerStart);
  assert.match(social.slice(writerStart, readerStart), /await ensureGuildMigrations\(\)/);
  assert.match(social.slice(readerStart), /await ensureGuildMigrations\(\)/);
  assert.match(social, /Guild data is corrupted; refusing to replace it/);
});


test('corrupted leaderboard rows cannot be overwritten as an empty board', () => {
  const social = source('src/server/social.ts');
  const parserStart = social.indexOf('function parseLeaderboardList');
  const parserEnd = social.indexOf('const COMMUNITY_EVENT_KEY', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = social.slice(parserStart, parserEnd);
  assert.match(parser, /Leaderboard data is corrupted; refusing to replace it/);
  assert.match(parser, /Leaderboard contains a malformed record/);
  const recordStart = social.indexOf('export async function recordLeaderboard');
  const recordEnd = social.indexOf('function validateDailyStreakCommunityEvent', recordStart);
  assert.ok(recordStart >= 0 && recordEnd > recordStart);
  assert.match(social.slice(recordStart, recordEnd), /parseLeaderboardList\(raw\)/);
  const boardsStart = social.indexOf('export async function leaderboards()');
  const boardsEnd = social.indexOf('\nexport async function ', boardsStart + 30);
  assert.ok(boardsStart >= 0 && boardsEnd > boardsStart);
  assert.match(social.slice(boardsStart, boardsEnd), /Ignoring corrupt legacy projection/);
});


test('Global Booster charge and stack share one atomic player save', () => {
  const game = source('src/server/game.ts');
  const prepareStart = game.indexOf('async function prepareGlobalBoosterActivation');
  const prepareEnd = game.indexOf('export async function setGlobalBoosterDebugState', prepareStart);
  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart);
  assert.doesNotMatch(game.slice(prepareStart, prepareEnd), /await txn\.exec\(\)/);
  const claimStart = game.indexOf('async function claimWorldBoosterActivation');
  const claimEnd = game.indexOf('export async function activateGlobalBooster', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = game.slice(claimStart, claimEnd);
  assert.match(claim, /await save\(s, \{/);
  assert.match(claim, /key: GLOBAL_BOOSTERS_KEY/);
  assert.match(claim, /expectedValue: prepared\.expectedValue/);
  assert.match(claim, /nextValue: prepared\.nextValue/);
  assert.match(claim, /Activation committed, but announcement\/audit projection failed/);
});


test('malformed roll tickets are replaced or rejected before use', () => {
  const game = source('src/server/game.ts');
  const issueStart = game.indexOf('export async function getRollTicket');
  const issueEnd = game.indexOf('async function loadRollTicketForUse', issueStart);
  assert.ok(issueStart >= 0 && issueEnd > issueStart);
  const issue = game.slice(issueStart, issueEnd);
  assert.match(issue, /Number\.isSafeInteger\(current\.nextIndex\)/);
  assert.match(issue, /Number\.isSafeInteger\(current\.expiresAt\)/);
  assert.match(issue, /current\.id\.length <= 128/);
  const useEnd = game.indexOf('export async function save(', issueEnd);
  assert.ok(useEnd > issueEnd);
  const use = game.slice(issueEnd, useEnd);
  assert.match(use, /Number\.isSafeInteger\(ticket\.nextIndex\)/);
  assert.match(use, /Roll prediction ticket data is corrupted/);
});


test('Daily Streak reward and community tier commit atomically with player state', () => {
  const game = source('src/server/game.ts');
  const social = source('src/server/social.ts');
  assert.match(game, /const pendingSaveExtraWrites = new WeakMap<PlayerState, SaveExtraWrite\[\]>/);
  assert.match(game, /function stageSaveExtraWrite/);
  const saveStart = game.indexOf('export async function save(');
  const saveEnd = game.indexOf('function serverRandom', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const save = game.slice(saveStart, saveEnd);
  assert.match(save, /Array\.isArray\(extraWrite\)/);
  assert.match(save, /redis\.watch\(\.\.\.watchedKeys\)/);
  assert.match(save, /for \(const write of extraWrites\)/);
  const claimStart = game.indexOf('async function claimDailyStreakFromState');
  const claimEnd = game.indexOf('async function claimCommunityRewardFromState', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = game.slice(claimStart, claimEnd);
  assert.match(claim, /prepareDailyStreakCommunityProgress/);
  assert.match(claim, /stageSaveExtraWrite\(s/);
  assert.doesNotMatch(claim, /await addDailyStreakCommunityProgress/);
  assert.match(claim, /previousCount < 0/);
  assert.match(claim, /previousLongest < 0/);
  assert.doesNotMatch(claim, /previousCount < 1|previousLongest < 1/);
  assert.ok(
    claim.indexOf('const communityUpdate = await prepareDailyStreakCommunityProgress') <
      claim.indexOf('s.streak.count = nextStreakCount'),
    'shared event must prepare before local streak or rewards mutate',
  );
  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('function flairTextColorForBackground', automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart);
  const automation = game.slice(automationStart, automationEnd);
  assert.match(automation, /await claimDailyStreakFromState\(s\)[\s\S]*?catch \(error\)/);
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('function applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.match(game.slice(loadStart, loadEnd), /getDailyStreakCommunity\(\)\.catch\(error =>/);
  assert.match(social, /export async function prepareDailyStreakCommunityProgress/);
});


test('rolling Shard grants fail closed on malformed daily counters and requests', () => {
  const shared = source('src/shared/game.ts');
  const start = shared.indexOf('export function grantRollShards');
  const end = shared.indexOf('export function spendShards', start);
  assert.ok(start >= 0 && end > start);
  const grant = shared.slice(start, end);
  assert.match(grant, /Number\.isFinite\(requested\)/);
  assert.match(grant, /Number\.isSafeInteger\(rawEarnedToday\)/);
  assert.match(grant, /: FREE_SHARD_DAILY_CAP/);
  assert.match(grant, /Math\.max\(0, FREE_SHARD_DAILY_CAP - earnedToday\)/);
  assert.match(grant, /s\.freeShardsEarnedToday = earnedToday \+ granted/);
  assert.match(grant, /Number\.isSafeInteger\(lifetimeShards\)/);
});

test('roll rewards commit atomically with Guild and community progress', () => {
  const game = source('src/server/game.ts');
  const social = source('src/server/social.ts');
  const rollStart = game.indexOf('export async function applyRolls');
  const rollEnd = game.indexOf('async function sendOfflineFullNotification', rollStart);
  assert.ok(rollStart >= 0 && rollEnd > rollStart);
  const roll = game.slice(rollStart, rollEnd);
  assert.match(roll, /prepareGuildRollEffects\(/);
  assert.match(roll, /stageSaveExtraWrite\(s, guildEffects\.extraWrite\)/);
  assert.match(roll, /prepareCommunityRolls\(rollCount, pendingCommunityWrite\)/);
  assert.match(roll, /getCommunityEvent\(\)\.catch\(error =>/);
  assert.match(roll, /Read failed; rolling without the event bonus/);
  assert.match(roll, /Progress not recorded for this roll; preserving shared data/);

  assert.match(roll, /stageSaveExtraWrite\(s, \{/);
  assert.doesNotMatch(roll, /await applyGuildTax\(/);
  assert.doesNotMatch(roll, /await contribute\(/);
  assert.doesNotMatch(roll, /await addCommunityRolls\(/);
  assert.match(social, /export async function prepareGuildRollEffects/);
  assert.match(social, /export async function prepareCommunityRolls/);
  assert.match(game, /function getPendingSaveExtraWrite/);
});


test('automatic offline claims only clear reminder keys after the player save commits', () => {
  const game = source('src/server/game.ts');
  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('function flairTextColorForBackground', automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart);
  const automation = game.slice(automationStart, automationEnd);
  assert.match(automation, /stageSavePostCommitAction\(s, async \(\) =>/);
  assert.doesNotMatch(automation, /redis\.del\(OFFLINE_FULL_(?:NOTIFICATION|JOB)_PREFIX/);
  assert.match(automation, /clearOfflineReminderKeyIfUnchanged/);
  assert.match(automation, /scheduleOfflineFullNotification/);

  const saveStart = game.indexOf('export async function save(');
  const saveEnd = game.indexOf('function serverRandom', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const save = game.slice(saveStart, saveEnd);
  const committedIndex = save.indexOf('if (committed !== null)');
  const playerStateIndex = save.indexOf('Object.assign(s, nextState)', committedIndex);
  const actionsIndex = save.indexOf('for (const action of postCommitActions)', committedIndex);
  assert.ok(committedIndex >= 0 && playerStateIndex > committedIndex);
  assert.ok(actionsIndex > playerStateIndex, 'reminder cleanup must run only after the saved state is durable');
});


test('game ban registry fails closed on malformed stored rows and unrepresentable duration inputs', () => {
  const game = source('src/server/game.ts');
  const parserStart = game.indexOf('function parseGameBanRegistry');
  const parserEnd = game.indexOf('async function readGameBans', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = game.slice(parserStart, parserEnd);
  assert.match(parser, /if \(raw == null\) return Object\.create\(null\)/);
  assert.match(parser, /bannedUntil.*=== null/);
  assert.match(parser, /Number\.isSafeInteger/);
  assert.match(parser, /Number\(\(value as any\)\.bannedUntil\) > Number\(\(value as any\)\.bannedAt\)/);
  assert.match(parser, /malformed record/);

  const mutatorStart = game.indexOf('async function mutateGameBans');
  const mutatorEnd = game.indexOf('export async function getGameBanStatus', mutatorStart);
  const mutator = game.slice(mutatorStart, mutatorEnd);
  assert.match(mutator, /bans = parseGameBanRegistry\(raw\)/);
  assert.doesNotMatch(mutator, /raw !== ''/);

  const banStart = game.indexOf('export async function banGameUser');
  const banEnd = game.indexOf('export async function unbanGameUser', banStart);
  assert.ok(banStart >= 0 && banEnd > banStart);
  const ban = game.slice(banStart, banEnd);
  assert.match(ban, /Number\.isSafeInteger\(requestedDays\)/);
  assert.match(ban, /maximumDays/);
  assert.match(ban, /Number\.isSafeInteger\(bannedUntil\)/);
});

test('targeted wipes and Reset All write generation plus fresh save atomically', () => {
  const debug = source('src/server/debug.ts');
  const helperStart = debug.indexOf('async function resetPlayerGenerationAndSave');
  const helperEnd = debug.indexOf('async function wipeUser', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = debug.slice(helperStart, helperEnd);
  assert.match(helper, /redis\.watch\(generationKey, playerKey\)/);
  assert.match(helper, /await txn\.multi\(\)/);
  assert.match(helper, /txn\.set\(generationKey/);
  assert.match(helper, /txn\.set\(playerKey/);
  assert.match(helper, /await txn\.exec\(\)/);
  assert.doesNotMatch(helper, /await redis\.set\(generationKey/);
  assert.doesNotMatch(helper, /await redis\.set\(playerKey/);

  const wipeStart = debug.indexOf('async function wipeUser');
  const wipeEnd = debug.indexOf('function setMaxProgression', wipeStart);
  assert.ok(wipeStart >= 0 && wipeEnd > wipeStart);
  assert.match(debug.slice(wipeStart, wipeEnd), /resetPlayerGenerationAndSave\(userId, name\)/);

  const resetStart = debug.indexOf("debugRouter.post('/reset-all'");
  assert.ok(resetStart >= 0);
  assert.match(debug.slice(resetStart, resetStart + 2200), /resetPlayerGenerationAndSave\(/);
  assert.doesNotMatch(debug.slice(resetStart, resetStart + 2200), /await redis\.set\(generationKey/);
});

test('account cleanup never overwrites a concurrent leaderboard update or replaces corrupt data with an empty board', () => {
  const debug = source('src/server/debug.ts');
  const start = debug.indexOf('async function removeLeaderboardEntry');
  const end = debug.indexOf('async function resolveUserId', start);
  assert.ok(start >= 0 && end > start);
  const cleanup = debug.slice(start, end);
  assert.match(cleanup, /redis\.watch\(leaderboardKey\)/);
  assert.match(cleanup, /await txn\.exec\(\)/);
  assert.match(cleanup, /Leaderboard data is corrupted/);
  assert.match(cleanup, /Leaderboard data is malformed/);
  assert.doesNotMatch(cleanup, /catch \{\s*parsed = \[\]/);
});


test('Frenzy claim commits owner reward, Guild effects, community progress, and post consumption together', () => {
  const game = source('src/server/game.ts');
  const rewardStart = game.indexOf('async function prepareFrenzyOwnerRewardWrites');
  const rewardEnd = game.indexOf('function parseGlobalBoosterSnapshot', rewardStart);
  assert.ok(rewardStart >= 0 && rewardEnd > rewardStart);
  const reward = game.slice(rewardStart, rewardEnd);
  assert.match(reward, /ownerGenerationKey/);
  assert.match(reward, /key: ownerGenerationKey/);
  assert.match(reward, /key: ownerKey/);
  assert.match(reward, /Number\.isSafeInteger\(generation\)/);

  const claimStart = game.indexOf('export async function claimOrbFrenzy');
  const claimEnd = game.indexOf('function sampleBinomial', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = game.slice(claimStart, claimEnd);
  assert.match(claim, /prepareGuildRollEffects\(/);
  assert.match(claim, /prepareCommunityRolls\(/);
  assert.match(claim, /prepareFrenzyOwnerRewardWrites\(/);
  assert.match(claim, /await save\(s, \[[\s\S]*?FRENZY_POST_PREFIX \+ postId[\s\S]*?\.\.\.ownerRewardWrites/);
  assert.doesNotMatch(claim, /await applyGuildTax\(coinsGained\)/);
  assert.doesNotMatch(claim, /await contribute\(finalValue/);
  assert.doesNotMatch(claim, /await addCommunityRolls\(count\)/);
  assert.doesNotMatch(claim, /grantFrenzyOwnerReward/);
});


test('player saves watch and validate active distributed lease tokens before EXEC', () => {
  const game = source('src/server/game.ts');
  const lock = source('src/server/player-lock.ts');
  assert.match(lock, /const activeMutationTokens = new Map<string, string>/);
  assert.match(lock, /export function getActivePlayerMutationLock/);
  const start = game.indexOf('export async function save(');
  const end = game.indexOf('function serverRandom', start);
  assert.ok(start >= 0 && end > start);
  const save = game.slice(start, end);
  assert.match(save, /getActivePlayerMutationLock\(id\)/);
  assert.match(save, /activeLocks\.map\(item => item\.key\)/);
  assert.match(save, /redis\.watch\(\.\.\.watchedKeys\)/);
  assert.match(save, /actualToken !== activeLock\.token/);
  assert.match(save, /PLAYER_MUTATION_LEASE_LOST/);
  assert.ok(save.indexOf('actualToken !== activeLock.token') < save.indexOf('await txn.multi()'));
});


test('Guild migration markers must be exactly the completed marker before skipping or mutating', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('async function applyGuildMigration');
  const end = social.indexOf('async function ensureGuildMigrations', start);
  assert.ok(start >= 0 && end > start);
  const migration = social.slice(start, end);
  assert.match(migration, /if \(marker === '1'\)/);
  assert.match(migration, /if \(marker != null\)[\s\S]*?txn\.unwatch\(\)[\s\S]*?throw new Error\('Guild migration marker is corrupted/);
  const malformedGuard = migration.indexOf("throw new Error('Guild migration marker is corrupted");
  const migrateIndex = migration.indexOf('migrate(guilds)');
  assert.ok(malformedGuard >= 0 && migrateIndex > malformedGuard);
  assert.doesNotMatch(migration, /if \(marker\) return/);
});


test('offline scheduler reservations prevent duplicate jobs and reject stale worker tokens', () => {
  const game = source('src/server/game.ts');
  const app = source('src/server/app.ts');
  const scheduleStart = game.indexOf('async function scheduleOfflineFullNotification');
  const processStart = game.indexOf('export async function processOfflineFullNotification', scheduleStart);
  const processEnd = game.indexOf('export async function settleOffline', processStart);
  assert.ok(scheduleStart >= 0 && processStart > scheduleStart && processEnd > processStart);
  const scheduler = game.slice(scheduleStart, processStart);
  assert.match(scheduler, /redis\.watch\(jobKey\)/);
  assert.match(scheduler, /const reservation = JSON\.stringify\(\{ token, jobId: null/);
  assert.match(scheduler, /jobToken: token/);
  assert.match(scheduler, /replaceOfflineFullJobMarkerIfUnchanged/);
  const processor = game.slice(processStart, processEnd);
  assert.match(processor, /marker\.token !== jobToken/);
  assert.match(processor, /marker\.legacy/);
  assert.match(processor, /clearOfflineReminderKeyIfUnchanged\(jobKey, expectedJobValue\)/);
  assert.doesNotMatch(processor, /await redis\.del\(jobKey\)/);
  assert.match(app, /processOfflineFullNotification\(userId, subredditName, jobToken \|\| undefined\)/);
});


test('Global Booster mutations reject malformed nested state instead of freezing or normalizing it', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('function parseGlobalBoosterSnapshot');
  const end = game.indexOf('export async function getGlobalBoosters', start);
  assert.ok(start >= 0 && end > start);
  const parser = game.slice(start, end);
  assert.match(parser, /isValidBoosterState\(record\.luck, 'luck'\)/);
  assert.match(parser, /isValidBoosterState\(record\.speed, 'speed'\)/);
  assert.match(parser, /Number\.isSafeInteger\(state\.tier\)/);
  assert.match(parser, /Number\(state\.tier\) > 10/);
  assert.match(parser, /Number\(state\.lastTickAt\) > now \+ 60_000/);
});

test('leaderboard projection refuses stale player-state revisions', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function recordLeaderboard');
  const end = social.indexOf('function validateDailyStreakCommunityEvent', start);
  assert.ok(start >= 0 && end > start);
  const record = social.slice(start, end);
  assert.match(record, /stateRevision: Math\.max/);
  assert.match(record, /existingRevision <= next\.stateRevision!/);
  assert.match(record, /existing\.userId === next\.userId/);
});

test('Guild Chat filters muted authors even if the history purge fails', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function guildInfo');
  const end = social.indexOf('export async function getPlayerGuildPerks', start);
  assert.ok(start >= 0 && end > start);
  const info = social.slice(start, end);
  assert.match(info, /redis\.hGetAll\(GUILD_CHAT_MUTES_KEY\)/);
  assert.match(info, /mutedUserIds\.has\(messageUserId\)/);
  assert.match(info, /mutedUsernames\.has\(messageUsername\)/);
  assert.match(info, /filterMutedGuildChat\(hydrated\)/);
});


test('wipe-and-ban applies the ban before reset and never clears it after reset', () => {
  const debug = source('src/server/debug.ts');
  const wipeStart = debug.indexOf('async function wipeUser');
  const wipeEnd = debug.indexOf('function setMaxProgression', wipeStart);
  assert.ok(wipeStart >= 0 && wipeEnd > wipeStart);
  const wipe = debug.slice(wipeStart, wipeEnd);
  assert.match(wipe, /if \(clearBanAfterWipe\) await unbanGameUser\(userId\)/);

  const routeStart = debug.indexOf("debugRouter.post('/moderation/wipe-and-ban'");
  const routeEnd = debug.indexOf("debugRouter.post('/reset-all'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = debug.slice(routeStart, routeEnd);
  assert.ok(route.indexOf('await banGameUser(') < route.indexOf('await wipeUser(username, false)'));
  assert.match(route, /let banApplied = false/);
  assert.match(route, /banApplied,?/);
});


test('future registry timestamps cannot inflate DAU/WAU/MAU or online-player activity', () => {
  const game = source('src/server/game.ts');
  assert.match(game, /function validPastTimestamp\(value: unknown, now: number\): number/);
  assert.match(game, /timestamp > now\) return 0/);
  const statsStart = game.indexOf('export async function getPlayerActivityStats');
  const statsEnd = game.indexOf('export async function getFollowPromptStats', statsStart);
  assert.ok(statsStart >= 0 && statsEnd > statsStart);
  assert.match(game.slice(statsStart, statsEnd), /validPastTimestamp\(entry\.lastSeenAt, now\)/);
  assert.match(game.slice(statsStart, statsEnd), /validPastTimestamp\(entry\.lastActivityAt, now\)/);
  const touchStart = game.indexOf('async function touchPlayerActivity');
  const touchEnd = game.indexOf('async function registerPlayer', touchStart);
  assert.ok(touchStart >= 0 && touchEnd > touchStart);
  assert.match(game.slice(touchStart, touchEnd), /validPastTimestamp\(existing\?\.lastActivityAt, activityNow\)/);
});

test('player activity watch transaction preserves playtime updates and fences an expired activity lease', () => {
  const game = source('src/server/game.ts');
  const mock = source('src/server/devvit-mock.ts');
  const start = game.indexOf('async function touchPlayerActivity');
  const end = game.indexOf('async function registerPlayer', start);
  assert.ok(start >= 0 && end > start);
  const activity = game.slice(start, end);
  assert.match(activity, /redis\.watch\(PLAYER_REGISTRY_KEY, activeLock\.key\)/);
  assert.match(activity, /PLAYER_MUTATION_LEASE_LOST/);
  assert.match(activity, /txn\.hSet\(PLAYER_REGISTRY_KEY/);
  assert.match(activity, /if \(await txn\.exec\(\) !== null\) return playtimeMs/);
  assert.match(mock, /kind: 'hset'/);
  assert.match(mock, /Object\.assign\(values, write\.fields\)/);
});


test('live presence survives optimistic and authoritative state replacement, and auth reset clears revision guards', () => {
  const client = source('src/client/main.tsx');
  assert.match(client, /const onlinePlayersRef = useRef<number \| undefined>\(undefined\)/);
  assert.match(client, /const mergedState = onlinePlayersRef\.current == null/);
  assert.match(client, /onlinePlayersRef\.current = safeOnlinePlayers/);
  assert.match(client, /stateRef\.current = \{ \.\.\.stateRef\.current, onlinePlayers: safeOnlinePlayers \}/);
  const authIndex = client.indexOf("if (e?.message === 'REDDIT_LOGIN_REQUIRED')");
  const authEnd = client.indexOf('const message = e?.message', authIndex);
  assert.ok(authIndex >= 0 && authEnd > authIndex);
  const auth = client.slice(authIndex, authEnd);
  assert.match(auth, /stateRef\.current = null/);
  assert.match(auth, /appliedServerRevisionRef\.current = -1/);
  assert.match(auth, /rollTicketRef\.current = null/);
});


test('offline notification worker validates the persisted PlayerState before calculating cap', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function processOfflineFullNotification');
  const end = game.indexOf('export async function settleOffline', start);
  assert.ok(start >= 0 && end > start);
  const worker = game.slice(start, end);
  assert.match(worker, /const s = parsePlayerStateValue\(raw\)/);
  assert.match(worker, /if \(!s\)[\s\S]*?preserving the job marker/);
  assert.doesNotMatch(worker, /JSON\.parse\(String\(raw\)\) as PlayerState/);
});

test('scheduled and request-triggered offline notifications share one per-player worker lock', () => {
  const game = source('src/server/game.ts');
  const processorStart = game.indexOf('export async function processOfflineFullNotification');
  const processorEnd = game.indexOf('export async function settleOffline', processorStart);
  assert.ok(processorStart >= 0 && processorEnd > processorStart);
  const processor = game.slice(processorStart, processorEnd);
  assert.match(processor, /withPlayerMutationLockFor/);
  assert.match(processor, /offline-notification:/);
  const settle = game.slice(processorEnd, game.indexOf('export interface CollectionPageItem', processorEnd));
  assert.match(settle, /withPlayerMutationLockFor/);
  assert.match(settle, /offline-notification:/);
  assert.doesNotMatch(settle, /await redis\.del\(OFFLINE_FULL_JOB_PREFIX \+ userId\)/);
});


test('Guild Chat username normalization uses a valid escaped slash regex', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function guildInfo');
  const end = social.indexOf('export async function getPlayerGuildPerks', start);
  const info = social.slice(start, end);
  const slash = String.fromCharCode(92);
  assert.equal(info.split('replace(/^u' + slash + '//i').length - 1, 2);
  assert.equal(info.split('replace(/^u' + slash + slash + '//i').length - 1, 0);
});


test('optimistic rollback restores stateRef as well as React state without losing live presence', () => {
  const client = source('src/client/main.tsx');
  const start = client.indexOf('const beginOptimisticState');
  const end = client.indexOf('const enqueueMutation', start);
  assert.ok(start >= 0 && end > start);
  const callback = client.slice(start, end);
  assert.match(callback, /stateRevisionRef\.current !== optimisticRevision/);
  assert.match(callback, /const restoredState = onlinePlayersRef\.current == null/);
  assert.match(callback, /stateRef\.current = restoredState/);
  assert.match(callback, /setState\(restoredState\)/);
});


test('loadRaw distinguishes a missing save from a present empty or malformed save', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function loadRaw');
  const end = game.indexOf('function applyXp', start);
  assert.ok(start >= 0 && end > start);
  const loader = game.slice(start, end);
  assert.match(loader, /if \(raw == null\)/);
  assert.match(loader, /const parsed = parsePlayerStateValue\(raw\)/);
  assert.match(loader, /stored save is not valid player data/);
  assert.doesNotMatch(loader, /if \(!raw\)/);
});


test('Frenzy start saves the post receipt atomically with its owner reward and cooldown', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function startOrbFrenzy');
  const end = game.indexOf('export async function claimOrbFrenzy', start);
  assert.ok(start >= 0 && end > start);
  const body = game.slice(start, end);
  const createIndex = body.indexOf('await reddit.submitCustomPost');
  const receiptIndex = body.indexOf('const frenzyPostValue = JSON.stringify');
  const saveIndex = body.indexOf('await save(s, {', receiptIndex);
  assert.ok(createIndex >= 0 && receiptIndex > createIndex && saveIndex > receiptIndex);
  assert.match(body.slice(saveIndex, saveIndex + 500), /key: FRENZY_POST_PREFIX \+ postId/);
  assert.match(body.slice(saveIndex, saveIndex + 500), /expectedValue: null/);
  assert.doesNotMatch(body.slice(createIndex, saveIndex), /await redis\.set\(FRENZY_POST_PREFIX/);
});


test('optional Auto-Community Claim failure does not abort unrelated mutations', () => {
  const game = source('src/server/game.ts');
  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('function flairTextColorForBackground', automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart);
  const automation = game.slice(automationStart, automationEnd);
  const blockStart = automation.indexOf('if (s.automations?.autoCommunityClaim)');
  const blockEnd = automation.indexOf('if (!options.skipAutoOfflineClaim', blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  const block = automation.slice(blockStart, blockEnd);
  assert.match(block, /try \{/);
  assert.match(block, /await claimCommunityRewardFromState\(s\)/);
  assert.match(block, /catch \(error\)/);
  assert.match(block, /continuing without its reward/);
});

test('manual Daily Streak, Quest and Community claims bypass their duplicate auto-claim', () => {
  const game = source('src/server/game.ts');

  const streakStart = game.indexOf('export async function claimDailyStreak');
  const streakEnd = game.indexOf('export async function claimQuest', streakStart);
  assert.ok(streakStart >= 0 && streakEnd > streakStart);
  assert.match(game.slice(streakStart, streakEnd), /skipAutoStreakClaim: true/);

  const questStart = game.indexOf('export async function claimQuest');
  const questEnd = game.indexOf('export async function prestige', questStart);
  assert.ok(questStart >= 0 && questEnd > questStart);
  assert.match(game.slice(questStart, questEnd), /skipAutoQuestClaim: true/);

  const communityStart = game.indexOf('export async function claimCommunityReward');
  const communityEnd = game.indexOf('export async function startOrbFrenzy', communityStart);
  assert.ok(communityStart >= 0 && communityEnd > communityStart);
  assert.match(game.slice(communityStart, communityEnd), /skipAutoCommunityClaim: true/);

  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('function flairTextColorForBackground', automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart);
  const automation = game.slice(automationStart, automationEnd);
  assert.match(automation, /!options\.skipAutoStreakClaim && s\.automations\?\.autoStreakClaim/);
  assert.match(automation, /!options\.skipAutoQuestClaim && s\.automations\?\.autoQuestClaim/);
  assert.match(automation, /!options\.skipAutoCommunityClaim && s\.automations\?\.autoCommunityClaim/);
});

test('manual offline claim serializes with reminder workers and suppresses claim-time alerts', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOffline');
  const end = game.indexOf('export async function buyUpgrade', start);
  assert.ok(start >= 0 && end > start);
  const manual = game.slice(start, end);
  assert.match(manual, /withPlayerMutationLockFor\(notificationLock/);
  assert.match(manual, /skipAutoOfflineClaim: true/);
  assert.match(manual, /skipOfflineNotifications: true/);
  const settleStart = game.indexOf('export async function settleOffline');
  const settleEnd = game.indexOf('export interface CollectionPageItem', settleStart);
  assert.ok(settleStart >= 0 && settleEnd > settleStart);
  const settle = game.slice(settleStart, settleEnd);
  assert.match(settle, /!options\.skipOfflineNotifications && userId && subredditName/);
  assert.match(settle, /withPlayerMutationLockFor\(\`offline-notification:\$\{userId\}\`/);
});

test('manual offline claim bypasses only its duplicate Auto Offline Claim automation', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOffline');
  const end = game.indexOf('export async function buyUpgrade', start);
  assert.ok(start >= 0 && end > start);
  const manual = game.slice(start, end);
  assert.match(manual, /settleOffline\(await loadRaw\(\), \{ skipAutoOfflineClaim: true \}\)/);
  const settleStart = game.indexOf('export async function settleOffline');
  const settleEnd = game.indexOf('export async function getState', settleStart);
  assert.ok(settleStart >= 0 && settleEnd > settleStart);
  const settle = game.slice(settleStart, settleEnd);
  assert.match(settle, /processAutomation\(s, options\)/);
  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('function flairTextColorForBackground', automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart);
  assert.match(game.slice(automationStart, automationEnd), /!options\.skipAutoOfflineClaim && s\.automations\?\.autoOfflineClaim/);
});

test('manual offline claim compare-clears only reminder values observed before the saved claim', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOffline');
  const claim = game.slice(start, game.indexOf('export async function', start + 40));
  assert.match(claim, /const \[previousNotification, previousJob\] = await Promise\.all/);
  assert.match(claim, /await save\(s\)/);
  assert.match(claim, /clearOfflineReminderKeyIfUnchanged\(notificationKey, previousNotification\)/);
  assert.match(claim, /clearOfflineReminderKeyIfUnchanged\(jobKey, previousJob\)/);
  assert.doesNotMatch(claim, /redis\.del\(OFFLINE_FULL_(?:NOTIFICATION|JOB)_PREFIX/);
});

test('rarity flair sync serializes side effects and rechecks saved rarity before caching', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function syncRarityFlair');
  const flair = game.slice(start, game.indexOf('export async function save', start));
  assert.match(flair, /withPlayerMutationLockFor\('flair:'/);
  assert.match(flair, /redis\.get\(playerKeyFor\(userId\)\)/);
  assert.match(flair, /const afterRaw = await redis\.get\(playerKeyFor\(userId\)\)/);
  assert.match(flair, /if \(afterState === flairState\)/);
  assert.match(flair, /leaving cache untouched/);
});


test('leaderboard projection uses a newer durable save even when invoked with an older callback snapshot', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function recordLeaderboard');
  const end = social.indexOf('function validateDailyStreakCommunityEvent', start);
  assert.ok(start >= 0 && end > start);
  const record = social.slice(start, end);
  assert.match(record, /const persistedRaw = await redis\.get/);
  assert.match(record, /persistedRevision > incomingRevision/);
  assert.match(record, /value: source\.collectionValue/);
  assert.match(record, /totalRolls: source\.totalRolls/);
});


test('follow subscription marker and aggregate count commit atomically and idempotently', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimFollowReward');
  const end = game.indexOf('export async function claimOffline', start);
  assert.ok(start >= 0 && end > start);
  const follow = game.slice(start, end);
  assert.match(follow, /redis\.watch\(subscribedKey, FOLLOW_ACTION_COUNT_KEY\)/);
  assert.match(follow, /await txn\.set\(subscribedKey, String\(Date\.now\(\)\)\)/);
  assert.match(follow, /await txn\.set\(FOLLOW_ACTION_COUNT_KEY, String\(currentCount \+ 1\)\)/);
  assert.match(follow, /if \(await txn\.exec\(\) !== null\)/);
  assert.match(follow, /Follow-action counter is corrupted or exhausted/);
  assert.doesNotMatch(follow, /await redis\.incr\(FOLLOW_ACTION_COUNT_KEY\)/);
});


test('chat posting and moderation share a per-user lock and unmute purges history before clearing the mute', () => {
  const social = source('src/server/social.ts');
  const muteStart = social.indexOf('export async function muteGuildChatUser');
  const unmuteStart = social.indexOf('export async function unmuteGuildChatUser', muteStart);
  const guildPostStart = social.indexOf('export async function postGuildMessage');
  const globalPostStart = social.indexOf('export async function postGlobalChatMessage');
  const nextFunctionAfterGlobal = social.indexOf('function sortLeaderboard', globalPostStart);
  assert.ok(muteStart >= 0 && unmuteStart > muteStart && guildPostStart > unmuteStart && globalPostStart > guildPostStart);
  const mute = social.slice(muteStart, unmuteStart);
  const unmute = social.slice(unmuteStart, social.indexOf('async function hideGuildLastLogins', unmuteStart));
  const guildPost = social.slice(guildPostStart, globalPostStart);
  const globalPost = social.slice(globalPostStart, nextFunctionAfterGlobal);
  for (const body of [mute, unmute, guildPost, globalPost]) {
    assert.match(body, /withPlayerMutationLockFor\('guild-chat-user:' \+/);
  }
  assert.ok(unmute.indexOf('await purgeChatMessagesForUser') < unmute.indexOf("await redis.hSet(GUILD_CHAT_MUTES_KEY, { [targetId]: '' })"));
  assert.match(unmute, /Mute record is corrupted; refusing to unmute/);
});


test('roll-ticket requests are fenced across authentication resets', () => {
  const client = source('src/client/main.tsx');
  assert.match(client, /const authSessionEpochRef = useRef\(0\)/);
  const start = client.indexOf('const ensureRollTicket');
  const end = client.indexOf('const dismissedDeveloperAnnouncementRef', start);
  assert.ok(start >= 0 && end > start);
  const ensure = client.slice(start, end);
  assert.match(ensure, /const requestSessionEpoch = authSessionEpochRef\.current/);
  assert.match(ensure, /requestSessionEpoch !== authSessionEpochRef\.current/);
  assert.match(ensure, /if \(rollTicketRequestRef\.current === tracked\)/);
  const authStart = client.indexOf("if (e?.message === 'REDDIT_LOGIN_REQUIRED')");
  const authEnd = client.indexOf('const message = e?.message', authStart);
  assert.match(client.slice(authStart, authEnd), /authSessionEpochRef\.current \+= 1/);
});


test('Global Chat mutations fail closed rather than overwriting malformed history with an empty list', () => {
  const social = source('src/server/social.ts');
  const parserStart = social.indexOf('function parseGlobalChatList');
  const parserEnd = social.indexOf('async function purgeChatMessagesForUser', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = social.slice(parserStart, parserEnd);
  assert.match(parser, /if \(raw == null\) return \[\]/);
  assert.match(parser, /Global Chat history is corrupted; refusing to overwrite it/);
  assert.match(parser, /Global Chat history contains malformed messages/);
  assert.match(parser, /typeof message\.id === 'string'/);
  assert.match(parser, /typeof message\.username === 'string'/);
  assert.match(parser, /typeof message\.text === 'string'/);
  assert.match(parser, /message\.text\.length <= 200/);
  assert.match(parser, /Number\.isSafeInteger\(message\.timestamp\)/);
  assert.match(parser, /message\.userId == null \|\| typeof message\.userId === 'string'/);

  const purgeStart = social.indexOf('async function purgeChatMessagesForUser');
  const purgeEnd = social.indexOf('export interface ChatReportRecord', purgeStart);
  const purge = social.slice(purgeStart, purgeEnd);
  assert.match(purge, /const messages = parseGlobalChatList\(raw\)/);
  assert.doesNotMatch(purge, /: \[\] as GlobalChatMessage\[\]/);

  const postStart = social.indexOf('export async function postGlobalChatMessage');
  const postEnd = social.indexOf('function sortLeaderboard', postStart);
  assert.match(social.slice(postStart, postEnd), /const messages = parseGlobalChatList\(raw\)/);

  const readStart = social.indexOf('export async function getGlobalChat');
  const readEnd = social.indexOf('export async function postGlobalChatMessage', readStart);
  assert.ok(readStart >= 0 && readEnd > readStart);
  const reader = social.slice(readStart, readEnd);
  assert.match(reader, /const parsed = parseGlobalChatList\(raw\)/);
  assert.doesNotMatch(reader, /String\(message\.text \?\? ''\)/);
});

test('persisted PlayerState parser rejects malformed wallet and roll-counter core fields', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('function parsePlayerStateValue');
  const end = game.indexOf('function parsePaymentPlayerState', start);
  assert.ok(start >= 0 && end > start, 'shared player-state parser must exist');
  const parser = game.slice(start, end);
  assert.match(parser, /typeof record\.coins === 'number'/);
  assert.match(parser, /Number\.isFinite\(record\.coins\)/);
  assert.match(parser, /record\.coins >= 0/);
  assert.match(parser, /Number\.isSafeInteger\(record\.shards\)/);
  assert.match(parser, /Number\(record\.shards\) >= 0/);
  assert.match(parser, /Number\.isSafeInteger\(record\.totalRolls\)/);
  assert.match(parser, /if \(!validCoreState\) return null/);
});

test('payment mutations reject malformed core state and stop before revision overflow', () => {
  const game = source('src/server/game.ts');
  const parserStart = game.indexOf('function parsePaymentPlayerState');
  const parserEnd = game.indexOf('export async function hasReadablePlayerSave', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = game.slice(parserStart, parserEnd);
  assert.match(parser, /'coins' in record[\s\S]*?typeof record\.coins === 'number'/);
  assert.match(parser, /'shards' in record[\s\S]*?Number\.isSafeInteger\(record\.shards\)/);
  assert.match(parser, /'totalRolls' in record[\s\S]*?Number\.isSafeInteger\(record\.totalRolls\)/);
  assert.match(parser, /record\.stateRevision == null[\s\S]*?Number\.isSafeInteger\(record\.stateRevision\)/);
  assert.match(parser, /Saved player data has invalid core fields; the purchase was not applied/);

  const grantStart = game.indexOf('export async function grantPurchasedPack');
  const grantEnd = game.indexOf('export async function refundPurchasedPack', grantStart);
  assert.ok(grantStart >= 0 && grantEnd > grantStart);
  const grant = game.slice(grantStart, grantEnd);
  const revisionRead = grant.indexOf('const currentRevision = normalizeSafeInteger(state.stateRevision, 0)');
  const revisionGuard = grant.indexOf('if (currentRevision >= Number.MAX_SAFE_INTEGER)', revisionRead);
  const shardLotWrite = grant.indexOf('state.purchasedShardLots[orderId] =');
  const creditLotWrite = grant.indexOf('state.globalBoosterCreditLots[orderId] =');
  const revisionWrite = grant.indexOf('state.stateRevision = currentRevision + 1');
  assert.ok(revisionRead >= 0 && revisionGuard > revisionRead);
  assert.ok(shardLotWrite > revisionGuard, 'revision must be guarded before Shard-lot mutation');
  assert.ok(creditLotWrite > revisionGuard, 'revision must be guarded before credit-lot mutation');
  assert.ok(revisionWrite > revisionGuard, 'only the checked revision may be incremented');
});

test('every loaded PlayerState has a valid revision, including new and legacy saves', () => {
  const game = source('src/server/game.ts');
  const parserStart = game.indexOf('function parsePlayerStateValue');
  const parserEnd = game.indexOf('function parsePaymentPlayerState', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = game.slice(parserStart, parserEnd);
  assert.match(parser, /record\.stateRevision == null/);
  assert.match(parser, /Number\.isSafeInteger\(record\.stateRevision\)/);
  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('function applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const loader = game.slice(loadStart, loadEnd);
  assert.match(loader, /s\.stateRevision = 0/);
  assert.match(loader, /fresh\.stateRevision = 0/);
  assert.match(loader, /stateRevision: Math\.max\(0, Math\.floor\(Number\(parsed\.stateRevision \?\? 0\)\) \|\| 0\)/);
});

test('prestige upgrade purchase validates stored levels and Cosmic Dust before mutation', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function buyPrestigeUpgrade');
  const end = game.indexOf('export async function sacrificeToAltar', start);
  assert.ok(start >= 0 && end > start);
  const purchase = game.slice(start, end);
  const levelGuard = purchase.indexOf('!Number.isSafeInteger(current)');
  const dustGuard = purchase.indexOf('!Number.isSafeInteger(cosmicDust)');
  const costGuard = purchase.indexOf('!Number.isSafeInteger(cost)');
  const dustMutation = purchase.indexOf('s.cosmicDust = cosmicDust - cost');
  assert.ok(levelGuard >= 0 && dustGuard > levelGuard && costGuard > dustGuard);
  assert.ok(dustMutation > costGuard, 'wallet mutation must only happen after all guards');
  assert.match(purchase, /current > info\.maxLevel/);
  assert.match(purchase, /cosmicDust < 0/);
  assert.match(purchase, /Saved Cosmic Dust balance is invalid/);
});

test('client orders PlayerState snapshots by generation before revision', () => {
  const main = source('src/client/main.tsx');
  assert.match(main, /const appliedServerGenerationRef = useRef\(-1\)/);
  const start = main.indexOf('const applyPlayerState = useCallback');
  const end = main.indexOf('// Mutations are optimistic', start);
  assert.ok(start >= 0 && end > start);
  const applier = main.slice(start, end);
  assert.match(applier, /Number\(nextState\.saveGeneration\)/);
  assert.match(applier, /nextServerGeneration < appliedServerGenerationRef\.current/);
  assert.match(applier, /nextServerGeneration > appliedServerGenerationRef\.current/);
  assert.match(applier, /!Number\.isSafeInteger\(nextServerRevision\)/);
  assert.match(applier, /appliedServerGenerationRef\.current = nextServerGeneration/);
  assert.match(main, /appliedServerGenerationRef\.current = -1/);
});

test('client ignores a conflicting Shards balance at an unchanged server revision', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const applyPlayerState = useCallback');
  const end = main.indexOf('// Mutations are optimistic', start);
  assert.ok(start >= 0 && end > start, 'authoritative player-state applier must exist');
  const applier = main.slice(start, end);
  assert.match(applier, /nextServerRevision === appliedServerRevisionRef\.current/);
  assert.match(applier, /nextState\.shards/);
  assert.match(applier, /currentState\.shards/);
  assert.match(
    applier,
    /nextServerRevision === appliedServerRevisionRef\.current[\s\S]*?return;/,
    'same-revision wallet conflicts must be ignored before state is replaced',
  );
});

test('share route treats leaderboard projection as best-effort after the durable share action', () => {
  const app = source('src/server/app.ts');
  const start = app.indexOf("app.post('/api/share'");
  const end = app.indexOf('\n  return app;', start);
  assert.ok(start >= 0 && end > start, 'share route must exist');
  const route = app.slice(start, end);
  assert.match(route, /await recordShareAction\(s\)/);
  assert.doesNotMatch(
    route,
    /await recordLeaderboard\(s\)/,
    'the route must not turn a successful post/state save into an apparent failure if a leaderboard projection fails',
  );
});


test('optional World Event conflicts cannot block primary player rewards', () => {
  const game = source('src/server/game.ts');
  const saveStart = game.indexOf('export async function save(');
  const saveEnd = game.indexOf('function serverRandom', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const save = game.slice(saveStart, saveEnd);
  assert.match(save, /if \(write\.optional\)/);
  assert.match(save, /extraWrites\.splice\(index, 1\)/);
  assert.match(save, /if \(optionalProjectionConflict\) continue;/);
  assert.match(save, /pendingSaveExtraWrites\.set\(s, remaining\)/);

  const rollStart = game.indexOf('export async function applyRolls');
  const rollEnd = game.indexOf('async function sendOfflineFullNotification', rollStart);
  assert.ok(rollStart >= 0 && rollEnd > rollStart);
  const roll = game.slice(rollStart, rollEnd);
  assert.match(roll, /Progress not recorded for this roll; preserving shared data/);
  assert.match(roll, /key: communityUpdate\.key,[\s\S]*?optional: true/);

  const claimStart = game.indexOf('export async function claimOrbFrenzy');
  const claimEnd = game.indexOf('function sampleBinomial', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = game.slice(claimStart, claimEnd);
  assert.match(claim, /Frenzy progress not recorded; preserving shared data/);
  assert.match(claim, /key: communityUpdate\.key,[\s\S]*?optional: true/);
});


test('third lifetime Orb guarantee uses an immutable pre-batch roll count', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function applyRolls');
  const end = game.indexOf('async function sendOfflineFullNotification', start);
  assert.ok(start >= 0 && end > start);
  const roll = game.slice(start, end);
  assert.match(roll, /const lifetimeRollsBeforeBatch = s\.totalRolls/);
  assert.match(roll, /forcedRarity == null && lifetimeRollsBeforeBatch \+ i === 2/);
  assert.doesNotMatch(roll, /s\.totalRolls \+ i === 2/);

  const shared = source('src/shared/game.ts');
  const predictionStart = shared.indexOf('export function predictRollActivation');
  const predictionEnd = shared.indexOf('export function upgradeCost', predictionStart);
  assert.ok(predictionStart >= 0 && predictionEnd > predictionStart);
  const prediction = shared.slice(predictionStart, predictionEnd);
  assert.match(prediction, /const lifetimeRollsBeforeBatch = s\.totalRolls/);
  assert.match(prediction, /const isGuaranteedThirdBall = lifetimeRollsBeforeBatch \+ i === 2/);
  assert.doesNotMatch(prediction, /s\.totalRolls \+ i === 2/);
});


test('critical rarity caps match the continuum ceiling and cannot downgrade high-tier Orbs', () => {
  const shared = source('src/shared/game.ts');
  assert.match(shared, /export const MAX_ORB_RARITY = 1_000_000_000_000_000_000/);
  assert.match(shared, /Math\.min\(MAX_ORB_RARITY, Math\.max\(2, rarity\)\)/);

  const game = source('src/server/game.ts');
  const applyStart = game.indexOf('export async function applyRolls');
  const applyEnd = game.indexOf('async function sendOfflineFullNotification', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const apply = game.slice(applyStart, applyEnd);
  assert.match(apply, /Math\.min\(MAX_ORB_RARITY, Math\.round\(baseRarity \* effectiveCm\)\)/);
  const claimStart = game.indexOf('export async function claimOrbFrenzy');
  const claimEnd = game.indexOf('function sampleBinomial', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = game.slice(claimStart, claimEnd);
  assert.match(claim, /Math\.min\(MAX_ORB_RARITY, Math\.round\(data\.rarity \* critMultiplier\(s\)\)\)/);
  assert.match(claim, /Math\.min\(MAX_ORB_RARITY, Math\.round\(data\.rarity \* 5\)\)/);
  assert.doesNotMatch(game, /Math\.min\(1_000_000_000_000_000, Math\.round\((?:baseRarity|data\.rarity)/);
});


test('earned Coins and lifetime Coins stay within safe integer bounds', () => {
  const game = source('src/server/game.ts');
  assert.match(game, /function finiteNonNegativeInteger\(value: unknown, fallback = 0\): number \{[\s\S]*?Math\.min\(Number\.MAX_SAFE_INTEGER/);
  assert.match(game, /function addCoins\(s: PlayerState, amount: number\): number \{[\s\S]*?Number\.MAX_SAFE_INTEGER - currentCoins/);

  const loadStart = game.indexOf('export async function loadRaw');
  const loadEnd = game.indexOf('function applyXp', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const load = game.slice(loadStart, loadEnd);
  assert.match(load, /coins: finiteNonNegativeInteger\(parsed\.coins\)/);
  assert.match(load, /lifetimeCoins: finiteNonNegativeInteger\(parsed\.lifetimeCoins \?\? parsed\.coins\)/);

  const saveStart = game.indexOf('export async function save(');
  const saveEnd = game.indexOf('function serverRandom', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const save = game.slice(saveStart, saveEnd);
  assert.match(save, /Player Coin balance is invalid; no changes were saved/);
  assert.match(save, /s\.coins = finiteNonNegativeInteger\(s\.coins\)/);

  const rollStart = game.indexOf('export async function applyRolls');
  const rollEnd = game.indexOf('async function sendOfflineFullNotification', rollStart);
  assert.ok(rollStart >= 0 && rollEnd > rollStart);
  const roll = game.slice(rollStart, rollEnd);
  assert.match(roll, /coinsGained = addCoins\(s, coinsGained\)/);
  assert.doesNotMatch(roll, /s\.coins \+= coinsGained/);
  assert.doesNotMatch(roll, /s\.lifetimeCoins = \(s\.lifetimeCoins \?\? 0\) \+ coinsGained/);

  const frenzyStart = game.indexOf('export async function claimOrbFrenzy');
  const frenzyEnd = game.indexOf('function sampleBinomial', frenzyStart);
  assert.ok(frenzyStart >= 0 && frenzyEnd > frenzyStart);
  const frenzy = game.slice(frenzyStart, frenzyEnd);
  assert.match(frenzy, /coinsGained = addCoins\(s, coinsGained\)/);
  assert.doesNotMatch(frenzy, /s\.coins \+= coinsGained/);
});


test('Frenzy claim does not add a fallible read after atomic reward commit', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOrbFrenzy');
  const end = game.indexOf('function sampleBinomial', start);
  assert.ok(start >= 0 && end > start);
  const claim = game.slice(start, end);
  const saveIndex = claim.indexOf('await save(s, [');
  const returnIndex = claim.indexOf('return {', saveIndex);
  assert.ok(saveIndex >= 0 && returnIndex > saveIndex);
  const afterCommit = claim.slice(saveIndex, returnIndex);
  assert.match(afterCommit, /FRENZY_POST_PREFIX \+ postId/);
  assert.match(afterCommit, /\.\.\.ownerRewardWrites/);
  assert.doesNotMatch(afterCommit, /await redis\.get\(FRENZY_POST_PREFIX \+ postId\)/);
  assert.doesNotMatch(afterCommit, /FRENZY_CLAIM_SAVE_INVALIDATED/);
});


test('malformed quest entries cannot break every subsequent player mutation', () => {
  const game = source('src/server/game.ts');
  assert.match(game, /function isValidQuestList\(value: unknown\): value is QuestItem\[\]/);
  assert.match(game, /Number\.isSafeInteger\(quest\.target\)/);
  assert.match(game, /Number\.isSafeInteger\(quest\.progress\)/);
  assert.match(game, /typeof quest\.claimed === 'boolean'/);
  assert.match(game, /dailyQuests: isValidQuestList\(parsed\.dailyQuests\) \? parsed\.dailyQuests : base\.dailyQuests/);
  assert.match(game, /weeklyQuests: isValidQuestList\(parsed\.weeklyQuests\) \? parsed\.weeklyQuests : base\.weeklyQuests/);
  assert.doesNotMatch(game, /dailyQuests: parsed\.dailyQuests\?\.length \?/);
});


test('malformed nested player-save shapes fall back before reaching gameplay code', () => {
  const game = source('src/server/game.ts');
  assert.match(game, /function isRecordObject\(value: unknown\): value is Record<string, unknown>/);
  assert.match(game, /function isStringList\(value: unknown\): value is string\[\]/);
  assert.match(game, /function isValidCollection\(value: unknown\): value is Record<string, number>/);
  assert.match(game, /function normalizePlayerStreak\(/);
  assert.match(game, /collection: isValidCollection\(parsed\.collection\) \? parsed\.collection : base\.collection/);
  assert.match(game, /claimedAchievements: isStringList\(parsed\.claimedAchievements\) \? parsed\.claimedAchievements : base\.claimedAchievements/);
  assert.match(game, /streak: normalizePlayerStreak\(parsed\.streak, base\.streak\)/);
  assert.match(game, /unlockedCosmetics: isStringList\(parsed\.unlockedCosmetics\)/);
});


test('malformed numeric upgrades and progression fields cannot poison future rewards', () => {
  const game = source('src/server/game.ts');
  assert.match(game, /function normalizeLevelRecord<T extends object>/);
  assert.match(game, /const STANDARD_UPGRADE_LEVEL_LIMITS = buildStandardUpgradeLimits\(\)/);
  assert.match(game, /const PRESTIGE_UPGRADE_LEVEL_LIMITS = Object\.fromEntries/);
  assert.match(game, /const MASTERY_SKILL_LEVEL_LIMITS = Object\.fromEntries/);
  assert.match(game, /upgrades: normalizedUpgrades/);
  assert.match(game, /prestigeUpgrades: normalizedPrestigeUpgrades/);
  assert.match(game, /masterySkills: normalizedMasterySkills/);
  assert.match(game, /cosmicDust: finiteNonNegativeInteger\(parsed\.cosmicDust/);
  assert.match(game, /masteryPoints: finiteNonNegativeInteger\(parsed\.masteryPoints/);
  assert.match(game, /collectionValue: finiteNonNegativeNumber\(parsed\.collectionValue/);
  assert.match(game, /coinsSacrificed: finiteNonNegativeInteger\(parsed\.sacrifices\?\.coinsSacrificed/);
});


test('bulk Global Booster grants resume by idempotency receipt and report partial failures', () => {
  const debug = source('src/server/debug.ts');
  const grantStart = debug.indexOf('async function grantGlobalBoosterCreditsToUser');
  const loggerStart = debug.indexOf('async function appendGlobalBoosterCreditGrantLog', grantStart);
  assert.ok(grantStart >= 0 && loggerStart > grantStart);
  const grant = debug.slice(grantStart, loggerStart);
  assert.match(grant, /operationId: string/);
  assert.match(grant, /await redis\.watch\(playerKey, generationKey, receiptKey\)/);
  assert.match(grant, /const receiptKey = 'io:admin-global-booster-credit-grant:'/);
  assert.match(grant, /alreadyApplied: true/);
  assert.match(grant, /await redis\.get\(receiptKey\)/);
  assert.match(grant, /await txn\.set\(receiptKey, receipt\)/);
  assert.match(grant, /await txn\.set\(playerKey, JSON\.stringify\(state\)\)/);
  assert.match(grant, /await txn\.exec\(\)/);
  assert.match(grant, /does not have enough credit capacity/);

  const routeStart = debug.indexOf("debugRouter.post('/global-booster-credits/grant'");
  const routeEnd = debug.indexOf("debugRouter.get('/follow-reward'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = debug.slice(routeStart, routeEnd);
  assert.match(route, /operationId = String\(req\.body\?\.operationId/);
  assert.match(route, /failures\.push\(/);
  assert.match(route, /res\.status\(207\)\.json\(response\)/);
  assert.match(route, /Grant succeeded but audit logging failed/);

  const modal = source('src/client/components/DevDebugModal.tsx');
  assert.match(modal, /globalBoosterGrantOperationRef = useRef/);
  assert.match(modal, /operationId: operation\.operationId/);
  assert.match(modal, /Completed grants will not be duplicated/);
  assert.match(modal, /GLOBAL_BOOSTER_GRANT_PENDING_STORAGE_KEY/);
  assert.match(modal, /sessionStorage\.setItem\(GLOBAL_BOOSTER_GRANT_PENDING_STORAGE_KEY/);
  assert.match(modal, /globalBoosterGrantOperationRef\.current = null/);
});


test('applyRolls preflights lifetime roll-counter capacity before shared reads and per-orb mutation', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function applyRolls(');
  const end = game.indexOf('\nexport async function ', start + 1);
  assert.ok(start >= 0 && end > start, 'applyRolls function must exist');
  const applyRolls = game.slice(start, end);

  const errorIndex = applyRolls.indexOf('Roll counter would exceed the safe integer range');
  const sharedReadsIndex = applyRolls.indexOf('const [freshGlobalBoosters, worldEvent, fakeCcuBonus] = await Promise.all([');
  const loopIndex = applyRolls.indexOf('for (let i = 0; i < rollCount; i++)');
  const incrementIndex = applyRolls.indexOf('s.totalRolls++');

  assert.ok(errorIndex >= 0, 'counter capacity guard must exist');
  assert.ok(sharedReadsIndex > errorIndex, 'guard must run before shared Redis-backed reads');
  assert.ok(loopIndex > sharedReadsIndex, 'roll loop must follow shared reads');
  assert.ok(incrementIndex > loopIndex, 'lifetime counter increments only inside the guarded loop');

  const guardStart = applyRolls.lastIndexOf('if (', errorIndex);
  const guardEnd = applyRolls.indexOf('\n  }', errorIndex);
  assert.ok(guardStart >= 0 && guardEnd > guardStart, 'counter guard block must be complete');
  const guard = applyRolls.slice(guardStart, guardEnd);
  assert.match(guard, /!Number\.isSafeInteger\(s\.totalRolls\)/);
  assert.match(guard, /!Number\.isSafeInteger\(rollCount\)/);
  assert.match(guard, /rollCount > Number\.MAX_SAFE_INTEGER - s\.totalRolls/);
});


test('achievement claim cannot exceed bounded Coin accounting', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function claimAchievement');
  const end = social.indexOf('\nexport function shareText', start);
  assert.ok(start >= 0 && end > start, 'claimAchievement function must exist');
  const claim = social.slice(start, end);

  assert.match(claim, /typeof state\.coins !== 'number'/);
  assert.match(claim, /!Number\.isFinite\(state\.coins\)/);
  assert.match(claim, /Number\.MAX_SAFE_INTEGER - currentCoins/);
  assert.match(claim, /state\.coins = currentCoins \+ rewardCoins/);
  assert.match(claim, /state\.lifetimeCoins = Math\.min\(Number\.MAX_SAFE_INTEGER, lifetimeCoins \+ rewardCoins\)/);
  assert.match(claim, /return \{ state, rewardCoins, rewardShards \}/);
  assert.doesNotMatch(claim, /state\.coins\s*\+=\s*achievement\.rewardCoins/);
});


test('removed Achievements API is not remounted in the integration candidate', () => {
  const app = source('src/server/app.ts');
  const socialImportStart = app.indexOf("import {\n  createGuild,");
  const socialImportEnd = app.indexOf("} from './social.js';", socialImportStart);
  assert.ok(socialImportStart >= 0 && socialImportEnd > socialImportStart);
  const socialImports = app.slice(socialImportStart, socialImportEnd);

  assert.doesNotMatch(socialImports, /\bachievements\b/);
  assert.doesNotMatch(socialImports, /\bclaimAchievement\b/);
  assert.doesNotMatch(app, /app\.get\(['"]\/api\/achievements['"]/);
  assert.doesNotMatch(app, /app\.post\(['"]\/api\/achievements\/claim['"]/);
  assert.doesNotMatch(app, /'\/achievements'\]\.includes\(req\.path\)/);
});


test('Guild expiry persistence rejects malformed watched snapshots instead of filtering rows', () => {
  const social = source('src/server/social.ts');
  const parserStart = social.indexOf('function parseGuildListRaw(');
  const parserEnd = social.indexOf('function parseLeaderboardList(', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'raw Guild validator must exist');
  const parser = social.slice(parserStart, parserEnd);
  assert.match(parser, /if \(raw == null\) return \[\]/);
  assert.match(parser, /if \(!Array\.isArray\(parsed\)\)/);
  assert.match(parser, /validateGuildNestedState\(item as Record<string, unknown>\)/);
  assert.match(parser, /return parsed as Guild\[\]/);

  const loadStart = social.indexOf('async function loadGuilds()');
  const loadEnd = social.indexOf('export interface GuildChatSpyGuild', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'loadGuilds must exist');
  const load = social.slice(loadStart, loadEnd);
  assert.match(load, /latestRawGuilds = parseGuildListRaw\(latestRaw\)/);
  assert.match(load, /await txn\.unwatch\(\);\s*throw error/);
  assert.doesNotMatch(load, /latestParsed\]\.filter\(item => item && typeof item === 'object'\)/);
});


test('Frenzy preflights lifetime roll-counter capacity before rewards and shared side effects', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOrbFrenzy');
  const end = game.indexOf('export async function getOrbFrenzyInfo', start);
  assert.ok(start >= 0 && end > start, 'claimOrbFrenzy function must exist');
  const frenzy = game.slice(start, end);

  const countIndex = frenzy.indexOf('const count = frenzyClaimCountForRarity(');
  const guardIndex = frenzy.indexOf('Frenzy roll counter would exceed the safe integer range');
  const critIndex = frenzy.indexOf('const critChance = Math.min(');
  const shardGrantIndex = frenzy.indexOf('grantRollShards(');
  const guildStageIndex = frenzy.indexOf('prepareGuildRollEffects(');
  const incrementIndex = frenzy.indexOf('s.totalRolls += count');

  assert.ok(countIndex >= 0 && guardIndex > countIndex, 'final batch count must be established before its guard');
  assert.ok(critIndex > guardIndex, 'counter capacity guard must run before reward calculations');
  assert.ok(shardGrantIndex > guardIndex, 'counter capacity guard must run before Shard grants');
  assert.ok(guildStageIndex > guardIndex, 'counter capacity guard must run before Guild side-effect staging');
  assert.ok(incrementIndex > guardIndex, 'counter guard must run before lifetime roll count mutation');

  const guardStart = frenzy.lastIndexOf('if (', guardIndex);
  const guardEnd = frenzy.indexOf('\n  }', guardIndex);
  assert.ok(guardStart >= 0 && guardEnd > guardStart, 'Frenzy counter guard block must be complete');
  const guard = frenzy.slice(guardStart, guardEnd);
  assert.match(guard, /!Number\.isSafeInteger\(s\.totalRolls\)/);
  assert.match(guard, /!Number\.isSafeInteger\(count\)/);
  assert.match(guard, /count > Number\.MAX_SAFE_INTEGER - s\.totalRolls/);
});


test('Global Booster polling synchronizes the state ref and survives stale player snapshots', () => {
  const main = source('src/client/main.tsx');
  assert.match(main, /latestGlobalBoostersRef = useRef<GlobalBoosterSnapshot \| null>\(null\)/);

  const applyStart = main.indexOf('const applyPlayerState = useCallback');
  const applyEnd = main.indexOf('// Mutations are optimistic', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const applier = main.slice(applyStart, applyEnd);
  assert.match(applier, /latestGlobalBoostersRef\.current \?\? currentState\?\.globalBoosters \?\? nextState\.globalBoosters/);
  assert.match(applier, /globalBoosters: currentGlobalBoosters/);

  const pollStart = main.indexOf('const refreshGlobalBoosters = () =>');
  const pollEnd = main.indexOf('}, [tab]);', pollStart);
  assert.ok(pollStart >= 0 && pollEnd > pollStart);
  const poll = main.slice(pollStart, pollEnd);
  assert.match(poll, /latestGlobalBoostersRef\.current = snapshot/);
  assert.match(poll, /stateRef\.current = \{ \.\.\.stateRef\.current, globalBoosters: snapshot \}/);
  assert.match(poll, /setState\(prev => prev \? \{ \.\.\.prev, globalBoosters: snapshot \} : prev\)/);
});


test('Frenzy uses the same critical chance and conditional coin/Shard modifiers as normal rolls', () => {
  const game = source('src/server/game.ts');

  const critStart = game.indexOf('function effectiveRollCritChance(');
  const normalStart = game.indexOf('export async function applyRolls(');
  const frenzyStart = game.indexOf('export async function claimOrbFrenzy(');
  assert.ok(critStart >= 0 && normalStart > critStart && frenzyStart > normalStart);

  const critEnd = game.indexOf('\n}', critStart) + 2;
  const critHelper = game.slice(critStart, critEnd);
  assert.match(critHelper, /Math\.min\(\s*0\.40/);
  assert.match(critHelper, /globalBoosterCritChanceBonus\(globalBoosters\?\.crit\)/);
  assert.match(critHelper, /guildComboCritChanceBonus\(s\.guildCombo\)/);

  const frenzyEnd = game.indexOf('\nexport async function ', frenzyStart + 1);
  assert.ok(frenzyEnd > frenzyStart, 'claimOrbFrenzy should have a following export');
  const frenzy = game.slice(frenzyStart, frenzyEnd);
  assert.match(frenzy, /effectiveRollCritChance\(s, s\.globalBoosters\)/);
  assert.match(frenzy, /const lowRarityCoins = groups[\s\S]*?group\.rarity < 100/);
  assert.match(frenzy, /autoFilter[\s\S]*?Math\.round\(lowRarityCoins \* 0\.25\)/);
  assert.match(frenzy, /transmutationLevel[\s\S]*?Math\.round\(lowRarityCoins \* \(transmutationLevel \* 0\.15\)\)/);
  assert.match(frenzy, /sampleBinomial\(count, Math\.min\(1, 0\.01 \* transmutationLevel\)\)/);
  assert.match(frenzy, /grantRollShards\(s, rarityShards \+ procShards \+ transmutationShardProcs\)/);
  assert.match(frenzy, /s\.highestDryStreak = Math\.max\(s\.highestDryStreak \?\? 0, s\.rollsSinceBest\)/);
});


test('feature gate map covers all intended gated API routes and avoids gating online presence', () => {
  const app = source('src/server/app.ts');
  const start = app.indexOf('const featureForPath = (path: string): FeatureId | null =>');
  const end = app.indexOf('\n  };', start) + 5;
  assert.ok(start >= 0 && end > start, 'featureForPath mapping must exist');
  const map = app.slice(start, end);

  assert.match(map, /path === '\/streak\/claim'\) return 'quests'/);
  assert.match(map, /path === '\/global-boosters\/activate'/);
  assert.match(map, /path === '\/cosmetics\/buy'\) return 'prestige'/);
  assert.match(map, /path === '\/turbo\/activate'\) return 'upgrades'/);
  assert.match(map, /path === '\/leaderboards'/);
  assert.match(map, /path === '\/community\/reward\/claim'\s*\)\s*return 'boosters'/);
  assert.ok(
    map.indexOf("path === '/community/reward/claim'") <
      map.indexOf("path.startsWith('/community/')"),
    'specific Community Reward claim must be mapped before the broad Social prefix',
  );
  assert.doesNotMatch(map, /path === '\/online'/);
});


test('offline vault state is validated and bounded before auto-claim can process it', () => {
  const game = source('src/server/game.ts');

  const parserStart = game.indexOf('function parsePlayerStateValue(');
  const parserEnd = game.indexOf('\nfunction parsePaymentPlayerState(', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = game.slice(parserStart, parserEnd);
  assert.match(
    parser,
    /offlineRolls:\s*Math\.min\(\s*MAX_OFFLINE_ROLLS,\s*finiteNonNegativeInteger\(record\.offlineRolls, 0\)\s*\)/,
  );
  assert.match(parser, /function parsePlayerStateValue\(value: unknown/);

  const settleStart = game.indexOf('export async function settleOffline(');
  const settleEnd = game.indexOf('\nexport interface CollectionPageItem', settleStart);
  assert.ok(settleStart >= 0 && settleEnd > settleStart);
  const settle = game.slice(settleStart, settleEnd);
  const capIndex = settle.indexOf('s.offlineRolls = Math.min(offlineCap, savedOfflineRolls)');
  const elapsedIndex = settle.indexOf('if (diff >= tickMs)');
  const automationIndex = settle.indexOf('await processAutomation(s, options)');
  assert.ok(capIndex >= 0 && elapsedIndex > capIndex && automationIndex > capIndex);
  assert.match(settle, /offlineRollCap\(s\)/);

  const applyStart = game.indexOf('export async function applyRolls(');
  const applyEnd = game.indexOf('\nasync function sendOfflineFullNotification(', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const apply = game.slice(applyStart, applyEnd);
  const maxCountIndex = apply.indexOf('const maxSupportedRollCount = offlineRollCap(s) * rollsPerActivation(s) + 2');
  const sharedReadsIndex = apply.indexOf('const [freshGlobalBoosters, worldEvent, fakeCcuBonus] = await Promise.all([');
  assert.ok(maxCountIndex >= 0 && sharedReadsIndex > maxCountIndex);
  assert.match(apply, /rollCount > maxSupportedRollCount/);
});


test('bulk Global Booster retries reuse the durable recipient manifest and operation ID', () => {
  const debug = source('src/server/debug.ts');
  const client = source('src/client/components/DevDebugModal.tsx');
  assert.match(debug, /const GLOBAL_BOOSTER_CREDIT_BATCH_PREFIX = 'io:admin-global-booster-credit-batch:'/);

  const manifestStart = debug.indexOf('async function getOrCreateGlobalBoosterCreditGrantManifest');
  const manifestEnd = debug.indexOf('\nasync function ', manifestStart + 1);
  assert.ok(manifestStart >= 0 && manifestEnd > manifestStart, 'manifest helper must exist');
  const manifest = debug.slice(manifestStart, manifestEnd);
  const readExisting = manifest.indexOf('const existing = await redis.get(manifestKey)');
  const registryRead = manifest.indexOf('const players = await listRegisteredPlayerIds()');
  assert.ok(readExisting >= 0 && registryRead > readExisting, 'existing manifest must be checked before resolving recipients');
  assert.match(manifest, /return parseGlobalBoosterCreditGrantManifest\(existing, operationId, scope, amount\)/);
  assert.match(manifest, /scope === 'online'[\s\S]*?players\.filter\(player => player\.active\)/);
  assert.match(manifest, /userIds: selectedPlayers\.map/);
  assert.match(manifest, /await redis\.watch\(manifestKey\)/);
  assert.match(manifest, /await txn\.set\(manifestKey, JSON\.stringify\(manifest\)\)/);
  assert.match(manifest, /await txn\.exec\(\) !== null/);

  const routeStart = debug.indexOf("debugRouter.post('/global-booster-credits/grant'");
  const routeEnd = debug.indexOf("debugRouter.get('/follow-reward'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'bulk grant route must exist');
  const route = debug.slice(routeStart, routeEnd);
  assert.match(route, /getOrCreateGlobalBoosterCreditGrantManifest\(\s*operationId,\s*scope,\s*amount/);
  assert.match(route, /const targetPlayers = manifest\.userIds/);
  assert.doesNotMatch(route, /const players = await listRegisteredPlayerIds\(\)/, 'retry must not resolve a fresh recipient list');

  const uiStart = client.indexOf('const grantFreeGlobalBoosters = async');
  const uiEnd = client.indexOf('const loadGlobalBoosterActivationLog', uiStart);
  assert.ok(uiStart >= 0 && uiEnd > uiStart, 'admin grant handler must exist');
  const ui = client.slice(uiStart, uiEnd);
  assert.match(ui, /globalBoosterGrantOperationRef\.current = operation/);
  assert.match(ui, /operationId: operation\.operationId/);
  assert.match(ui, /Completed grants will not be duplicated/);
  assert.match(ui, /sessionStorage\.setItem\(GLOBAL_BOOSTER_GRANT_PENDING_STORAGE_KEY/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('all eleven Rune Major Abilities are normalized, scaled, and resolved server-side',()=>{
  const shared=source('src/shared/combat.ts');
  const combat=source('src/server/combat.ts');
  const game=source('src/server/game.ts');
  const ids=['echo-chamber','paradox-engine','event-horizon','shard-constellation','temporal-loop','prismatic-fork','critical-convergence','rarity-ladder','stellar-dividend','shard-jackpot','milestone-engine'];
  for(const id of ids){
    assert.ok(shared.includes("'"+id+"'"),'shared Rune type must include '+id);
    assert.ok(combat.includes("'"+id+"'"),'Rune generation and migration must include '+id);
  }
  assert.ok(shared.includes('combatRuneMajorAbilityEffects'),'equipped Rune effects must be summarized');
  assert.ok(game.includes('addRuneBonusRolls'),'bonus rolls must use the server-authoritative roll loop');
  assert.ok(game.includes('eventHorizonRarityMultiplier'),'Event Horizon must impose its rarity floor');
  assert.ok(game.includes('prismaticForkRarityMultiplier'),'Prismatic Fork must impose its rarity floor');
  assert.ok(game.includes('runeConstellationCharge'),'Shard Constellation charge must persist');
  assert.ok(game.includes('runeTemporalMomentum'),'Temporal Loop momentum must persist');
  assert.ok(game.includes('criticalConvergenceChance'),'Critical Convergence must trigger from critical rolls');
  assert.ok(game.includes('risingRarityChain'),'Rarity Ladder must watch consecutive rising rolls');
  assert.ok(game.includes('stellarDividendInterval'),'Stellar Dividend must trigger by lifetime roll milestone');
  assert.ok(game.includes('shardJackpotChance'),'Shard Jackpot must multiply eligible Shard rewards');
  assert.ok(game.includes('milestoneRarityMultiplier'),'Milestone Engine must improve rarity-floored bonus rolls');
});

test('Rune Strengthen is tooltip-driven and Auto Sacrifice only consumes un-equipped donors',()=>{
  const ui=source('src/client/components/RunesSection.tsx');
  const combat=source('src/server/combat.ts');
  const api=source('src/server/app.ts');
  assert.ok(ui.includes('>Strengthen</button>'),'Rune tooltip must expose a Strengthen action');
  assert.ok(ui.includes('handleRuneClick(rune)'),'Rune icons must remain active while Strengthen is selected');
  assert.ok(ui.includes('setSacrificeDonorId(rune.id)'),'clicking a Rune must select it as donor, never sacrifice it implicitly');
  assert.ok(ui.includes('Sacrifice selected Rune'),'a separate confirmation action must perform the sacrifice');
  assert.ok(combat.includes('!equipped.has(rune.id) && combatRuneRarityAtOrBelow'),'bulk auto-sacrifice must protect equipped donors');
  assert.ok(combat.includes('const target = pick(targets);'),'each donor must select an equipped Rune target at random');
  assert.ok(combat.includes('const qualifiesForAutoSacrifice = s.runeAutoSacrifice.enabled'),'new eligible drops must use the saved auto-sacrifice setting');
  assert.ok(api.includes("app.post('/api/combat/runes/auto-sacrifice/settings'"));
  assert.ok(api.includes("app.post('/api/combat/runes/auto-sacrifice/run'"));
});


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

test('Frenzy claim mounted-state guard recovers after an effect replay', () => {
  const client = source('src/client/main.tsx');
  const start = client.indexOf('const componentMountedRef = useRef(true);');
  const end = client.indexOf('const appliedServerGenerationRef', start);
  assert.ok(start >= 0 && end > start);
  const lifecycle = client.slice(start, end);
  assert.ok(lifecycle.indexOf('componentMountedRef.current = true;') < lifecycle.indexOf('componentMountedRef.current = false;'));
  assert.ok(lifecycle.includes('componentMountedRef.current = false;'));
});

test('Frenzy handoff preflight is single-flight and stops before claim after unmount', () => {
  const client = source('src/client/main.tsx');
  const start = client.indexOf('const resolveFrenzy = async () => {');
  const end = client.indexOf('}, [state, splashEntered, frenzyRunTriggered, applyPlayerState, enqueueMutation]);', start);
  assert.ok(start >= 0 && end > start);
  const effect = client.slice(start, end);
  const lock = effect.indexOf('frenzyClaimActiveRef.current = true;');
  const firstHandoffRead = effect.indexOf("await getJson<{ armed: boolean }>('/api/frenzy/handoff')");
  assert.ok(lock >= 0 && lock < firstHandoffRead, 'lock must be acquired before the first awaited preflight');
  const mountedGuard = effect.indexOf('if (!componentMountedRef.current) return;');
  const claim = effect.indexOf("getJson<RollResponse>('/api/frenzy/claim'");
  assert.ok(mountedGuard > 0 && claim > mountedGuard, 'mounted state must be checked before the claim POST');
  assert.ok(client.includes('frenzyClaimActiveRef.current = false;\n        if (!componentMountedRef.current) return;'));
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
  assert.match(chat, /const visible = next\.slice\(-100\)/);
  assert.match(chat, /setMessages\(visible\)/);
  assert.doesNotMatch(chat, /setMessages\(prev => mergeMessages\(prev, next\)\)/);
});

test('Global Chat comments are submitted as USER and Reddit comment triggers are enabled', () => {
  const manifest = JSON.parse(source('devvit.json'));
  assert.ok(manifest.permissions?.reddit?.asUser?.includes('SUBMIT_COMMENT'));
  assert.equal(manifest.triggers?.onCommentCreate, '/internal/trigger/comment-create');

  const app = source('src/server/app.ts');
  assert.match(app, /\/internal\/trigger\/comment-create/);
  assert.match(app, /recordGlobalChatComment/);
  assert.match(app, /app\.get\('\/api\/chat\/status'/);
  assert.match(app, /getGlobalChatStatus/);

  const social = source('src/server/social.ts');
  const senderStart = social.indexOf('export async function postGlobalChatMessage');
  const senderEnd = social.indexOf('function sortLeaderboard', senderStart);
  assert.ok(senderStart >= 0 && senderEnd > senderStart);
  assert.match(social.slice(senderStart, senderEnd), /runAs: 'USER'/);
  assert.match(social, /resolveGlobalGamePostId/);
  assert.match(social, /export async function getGlobalChatStatus/);
  assert.match(social, /Global Chat is disabled because you're not in the main Game launcher/);

  const chat = source('src/client/components/GlobalChatWindow.tsx');
  assert.match(chat, /\/api\/chat\/status/);
  assert.match(chat, /Keep Global Chat discoverable in every context/);
  assert.match(chat, /chatAvailable !== true && \(/);
  assert.match(chat, /disabled=\{chatAvailable !== true \|\| sending \|\| !input\.trim\(\)\}/);

  const game = source('src/server/game.ts');
  assert.match(game, /postFrenzyThankYouComment/);
  assert.match(game, /runAs: 'USER'/);
  assert.ok(game.includes('nextValue: JSON.stringify({ postId, claimantId, claimedAt: now })'), 'Frenzy claims use a durable per-claimant receipt');
  assert.match(game, /consider upvoting the post/);
});

test('Chain Patcher is server-authoritative, arms exactly one guaranteed rarity, and has a cooldown', () => {
  const shared = source('src/shared/game.ts');
  assert.match(shared, /CHAIN_PATCHER_COOLDOWN_MS = 24 \* 60 \* 60 \* 1_000/);
  assert.match(shared, /nextCodexChainRarity/);
  assert.match(shared, /10 \* \(Math\.floor\(targetRarity \/ 100\) \+ 1\)/);

  const game = source('src/server/game.ts');
  assert.match(game, /export async function buyChainPatcher/);
  assert.match(game, /spendShards\(s, shardsSpent\)/);
  assert.match(game, /s\.chainPatcherCooldownUntil = now \+ CHAIN_PATCHER_COOLDOWN_MS/);
  assert.match(game, /s\.autoRollEnabled = false/);
  assert.match(game, /Auto Roll is disabled/);
  const autoToggleStart = game.indexOf('export async function setAutoRollEnabled');
  const autoToggleEnd = game.indexOf('export async function roll(', autoToggleStart);
  assert.ok(autoToggleStart >= 0 && autoToggleEnd > autoToggleStart);
  const autoToggle = game.slice(autoToggleStart, autoToggleEnd);
  assert.match(autoToggle, /if \(enabled\)[\s\S]*?pendingPatcherRarity !== 0/);
  const rollStart = game.indexOf('export async function roll(');
  const rollEnd = game.indexOf('export async function', rollStart + 20);
  assert.ok(rollStart >= 0 && rollEnd > rollStart);
  assert.match(game.slice(rollStart, rollEnd), /if \(isAuto && usingChainPatcher\)/);
  assert.match(game, /const activations = usingChainPatcher \? 1 : freeRollActivations/);
  assert.match(game, /usingChainPatcher,/);
  assert.match(game, /if \(usingChainPatcher\) s\.chainPatcherNextRarity = 0/);

  const app = source('src/server/app.ts');
  assert.match(app, /app\.post\('\/api\/chain-patcher\/buy'/);
  assert.match(app, /buyChainPatcher/);
  assert.match(app, /nextCodexChainRarity/);
  const stripStart = app.indexOf('const stripPlayerCollection =');
  const stripEnd = app.indexOf('\n  };', stripStart);
  assert.ok(stripStart >= 0 && stripEnd > stripStart, 'collection stripper must exist');
  const stripper = app.slice(stripStart, stripEnd);
  assert.match(stripper, /copy\.chainPatcherSuggestedRarity = pendingPatcherRarity >= 2[\s\S]*?nextCodexChainRarity\(sourceCollection\)/);
  assert.ok(
    stripper.indexOf('copy.chainPatcherSuggestedRarity') < stripper.indexOf('copy.collection = {}'),
    'Chain Patcher preview must be computed before the server-only Codex is stripped',
  );

  const ui = source('src/client/components/CollectionSection.tsx');
  assert.match(ui, /state\.chainPatcherSuggestedRarity !== undefined/);
  assert.match(ui, /state\.codexChain \?\? bestCodexChain\(state\.collection\)\.length/);
  assert.match(ui, /Chain Patcher/);
  assert.match(ui, /1\/900 costs 10/);
  assert.match(ui, /24 hours between purchases/);
  assert.doesNotMatch(source('src/client/components/UpgradesSection.tsx'), /Chain Patcher/);

  const social = source('src/server/social.ts');
  assert.match(social, /chainLength: highestCodexChain\(save\.collection\)/);
  assert.match(social, /chainLength: sortLeaderboard\(eligible, entry => entry\.chainLength \?\? 0\)/);

  const leaderboardUi = source('src/client/components/GuildsAndSocial.tsx');
  assert.match(leaderboardUi, /label: 'Chain Length'/);
  assert.match(leaderboardUi, /case 'chainLength'/);
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
  assert.doesNotMatch(claim, /if \(data\.consumedAt != null\)/);
  assert.match(claim, /const claimReceiptKey = frenzyClaimReceiptKey\(postId, claimantId\)/);
  assert.match(claim, /key: claimReceiptKey,[\s\S]*?expectedValue: null,[\s\S]*?nextValue: JSON\.stringify\(\{ postId, claimantId, claimedAt: now \}\)/);
  assert.match(claim, /key: FRENZY_POST_PREFIX \+ postId,[\s\S]*?expectedValue: raw,[\s\S]*?nextValue: raw/);
  assert.match(claim, /You have already claimed this Orb Frenzy/);
});

test('missing-key initialization cannot overwrite a concurrent first write', () => {
  const game = source('src/server/game.ts');
  const social = source('src/server/social.ts');
  const mock = source('src/server/devvit-mock.ts');
  assert.match(game, /redis\.set\(keyName, fallback, \{ nx: true \}\)/);
  assert.match(social, /redis\.set\(keyName, fallback, \{ nx: true \}\)/);
  assert.match(mock, /options\?\.nx && readStore\(key\) !== undefined/);
  assert.match(mock, /writeStore\(key, value, options\?\.expiration\)/);
  assert.match(mock, /expiration instanceof Date && Number\.isFinite\(expiration\.getTime\(\)\)/);
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
  assert.match(roll, /const activations = usingChainPatcher \? 1 : freeRollActivations/);
  assert.match(roll, /await applyRolls\(\s*s,\s*chunkActivations,\s*usingChainPatcher \? rawPatcherRarity : undefined,\s*'online',\s*usingChainPatcher \? 1 : undefined,\s*undefined,\s*usingChainPatcher/);
  assert.match(game, /const rng = randomOverride \?\? serverRandom/);
});

test('player mutation lock renews its lease and releases only its own token', () => {
  const lock = source('src/server/player-lock.ts');
  assert.match(lock, /renewOwnedLock\(client, lockKey, token\)/);
  assert.match(lock, /Math\.max\(1_000, Math\.floor\(leaseTtlMs \/ 3\)\)/);
  const releaseStart = lock.indexOf('async function releaseOwnedLock');
  const releaseEnd = lock.indexOf('async function runLocked', releaseStart);
  assert.ok(releaseStart >= 0 && releaseEnd > releaseStart);
  const release = lock.slice(releaseStart, releaseEnd);
  assert.match(release, /client\.watch\(lockKey\)/);
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

  // The persisted-event validator deliberately caps goals at MAX_SAFE_INTEGER - 1.
  // This fixture reaches MAX_SAFE_INTEGER exactly when multiplied by the tier factor,
  // exposing the one-step mismatch between generation and subsequent parsing.
  const schemaStart = social.indexOf('function assertValidCommunityEvent(');
  const schemaEnd = social.indexOf('\nfunction parseCommunityEventForMutation', schemaStart);
  assert.ok(schemaStart >= 0 && schemaEnd > schemaStart, 'persisted-event schema guard must exist');
  const schema = social.slice(schemaStart, schemaEnd);
  assert.match(schema, /event\.goal > Number\.MAX_SAFE_INTEGER - 1/);

  const boundaryGoal = 4_094_181_479_427_723;
  const boundaryNextGoal = Math.round(boundaryGoal * 2.2);
  assert.equal(boundaryNextGoal, Number.MAX_SAFE_INTEGER, 'reproducer must hit the rejected ceiling');
  assert.ok(boundaryNextGoal > Number.MAX_SAFE_INTEGER - 1);

  assert.match(
    helper,
    /nextGoal\s*(?:>=\s*Number\.MAX_SAFE_INTEGER|>\s*Number\.MAX_SAFE_INTEGER\s*-\s*1)/,
    'generated next goals must obey the exact ceiling accepted by persisted-event validation',
  );
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
  assert.match(social, /Guild Log is read-only/);
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
  const saveEnd = game.indexOf('function serverRandom', saveStart);
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
  const saveIndex = claim.indexOf('await save(s);');
  const notificationClearIndex = claim.indexOf('clearOfflineReminderKeyIfUnchanged(notificationKey, previousNotification)');
  const jobClearIndex = claim.indexOf('clearOfflineReminderKeyIfUnchanged(jobKey, previousJob)');
  assert.ok(saveIndex >= 0 && notificationClearIndex > saveIndex,
    'notification reminder is cleared only after the player save commits');
  assert.ok(saveIndex >= 0 && jobClearIndex > saveIndex,
    'scheduled-job reminder is cleared only after the player save commits');
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


test('comprehensive admin tests atomically reset cooldown, issue a roll ticket, and seed gated feature levels', () => {
  const modal = source('src/client/components/DevDebugModal.tsx');
  const debug = source('src/server/debug.ts');
  const rollOnceStart = modal.indexOf('const rollOnce = async');
  const rollOnceEnd = modal.indexOf('const rollDetail', rollOnceStart);
  assert.ok(rollOnceStart >= 0 && rollOnceEnd > rollOnceStart);
  const rollOnce = modal.slice(rollOnceStart, rollOnceEnd);
  const ticketReset = rollOnce.indexOf("request<{");
  const resetEndpoint = rollOnce.indexOf("('/api/dev/reset-cooldown', {})");
  const rollPost = rollOnce.indexOf("request<RollResponse>('/api/roll'");
  assert.ok(ticketReset >= 0 && resetEndpoint > ticketReset && rollPost > resetEndpoint);
  assert.match(rollOnce, /ticketId: ticket\.ticketId/);
  assert.match(rollOnce, /ticketIndex: ticket\.nextIndex/);
  const resetEndpointStart = debug.indexOf("debugRouter.post('/reset-cooldown'");
  const resetEndpointEnd = debug.indexOf("debugRouter.post('/unlock-upgrades'", resetEndpointStart);
  assert.ok(resetEndpointStart >= 0 && resetEndpointEnd > resetEndpointStart);
  const resetHandler = debug.slice(resetEndpointStart, resetEndpointEnd);
  assert.ok(resetHandler.indexOf('await save(s)') < resetHandler.indexOf('await redis.del'));
  assert.ok(resetHandler.indexOf('await redis.del') < resetHandler.indexOf('await getRollTicket()'));
  assert.match(resetHandler, /res\.json\(\{ ok: true, state: s, \.\.\.ticket \}\)/);
  const mechanicStart = modal.indexOf('const setMechanicState = async');
  const mechanicEnd = modal.indexOf('const readMechanics', mechanicStart);
  assert.ok(mechanicStart >= 0 && mechanicEnd > mechanicStart);
  assert.match(modal.slice(mechanicStart, mechanicEnd), /xp: 600/);
  assert.match(modal.slice(mechanicStart, mechanicEnd), /level: 4,\s*levelXpFloor: 533/);
  assert.match(modal.slice(mechanicStart, mechanicEnd), /freeShardsEarnedToday: 0/);
  assert.match(debug, /for \(const field of \['shards', 'lifetimeShards', 'freeShardsEarnedToday'\]\)/);
  assert.match(modal, /shardSynthesis: 1 \}, \{ shards: 100, xp: 32_000, level: 20, levelXpFloor: 0 \}/);
  assert.match(modal.slice(mechanicStart, mechanicEnd), /lastFreeShardReset: '2020-01-01'/);
  assert.match(modal, /await new Promise\(resolve => setTimeout\(resolve, 5_200\)\)/);
  assert.match(modal, /collection endpoint/);
  const rollCounterStart = modal.indexOf('"API · Force-roll increments processed roll count"');
  const rollCounterEnd = modal.indexOf('"API · Force-roll persists collection entry"', rollCounterStart);
  assert.ok(rollCounterStart >= 0 && rollCounterEnd > rollCounterStart);
  const rollCounterFixture = modal.slice(rollCounterStart, rollCounterEnd);
  assert.ok(rollCounterFixture.includes('totalRolls: 100') && rollCounterFixture.includes('currentRunRolls: 0'));
  assert.ok(rollCounterFixture.includes('level: 4,') && rollCounterFixture.includes('levelXpFloor: 533'));
  const offlineStart = modal.indexOf('"API · Offline claim consumes seeded rolls"');
  const offlineEnd = modal.indexOf('"API · Daily reset clears daily Frenzy and streak fields"', offlineStart);
  assert.ok(offlineStart >= 0 && offlineEnd > offlineStart);
  const offlineFixture = modal.slice(offlineStart, offlineEnd);
  assert.ok(offlineFixture.includes('lastSeenAt: Date.now(),') && offlineFixture.includes('xp: 600,'));
  assert.ok(offlineFixture.includes('level: 4,') && offlineFixture.includes('levelXpFloor: 533'));
  assert.match(modal, /prestigeUpgrades: \{ astralBarrage: 0, astralArsenal: 0 \}/);
  assert.match(modal, /masterySkills: \{ celestialVolley: 0 \}/);
  assert.match(modal, /activeBoosters: \{ fortune: 0, hyperdrive: 0, barrage: 0, prosperity: 0, ascension: 0 \}/);
  assert.match(modal, /\{ xp: 600, level: 4, levelXpFloor: 533, collection: \{\}/);
  assert.match(modal, /setSonarThreshold\(100\)/);

  const frenzyVolleyStart = modal.indexOf("'Mechanic · Frenzy Volley'");
  const frenzyVolleyEnd = modal.indexOf("'Mechanic · Astral Reserve'", frenzyVolleyStart);
  assert.ok(frenzyVolleyStart >= 0 && frenzyVolleyEnd > frenzyVolleyStart);
  const frenzyVolley = modal.slice(frenzyVolleyStart, frenzyVolleyEnd);
  assert.ok(frenzyVolley.includes('frenzyOrbCountForRarity(normalRarity) * 2'));
  assert.ok(frenzyVolley.includes('frenzyOrbCountForRarity(volleyRarity) * 1.20'));

  const adminFrenzyStart = modal.indexOf('"API · Frenzy admin start creates a dedicated post record"');
  const adminFrenzyEnd = modal.indexOf('"API · Frenzy admin claim returns the authoritative volley and owner reward"', adminFrenzyStart);
  assert.ok(adminFrenzyStart >= 0 && adminFrenzyEnd > adminFrenzyStart);
  const adminFrenzy = modal.slice(adminFrenzyStart, adminFrenzyEnd);
  assert.ok(adminFrenzy.includes('orbRarity < 250'));
  assert.ok(adminFrenzy.includes('returnedRarity !== orbRarity'));
});

test('Guild Collection Value tasks can roll over multiple tiers and pay every reward', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function prepareGuildRollEffects(');
  const end = social.indexOf('// Community World Event System', start);
  assert.ok(start >= 0 && end > start, 'Guild roll effect boundaries must exist');
  const effects = social.slice(start, end);
  assert.match(effects, /if \(task\.type === 'value'\) task\.progress = capInteger\(task\.progress \+ taskProgressValue\)/);
  assert.match(effects, /while \(task\.progress >= task\.target && completions < 1000\)/);
  assert.match(effects, /replacement\.progress = Math\.min\(Number\.MAX_SAFE_INTEGER, overflow\)/);
  assert.match(effects, /guild\.tokens = capInteger\(\(guild\.tokens \?\? 0\) \+ reward\)/);
  assert.match(effects, /guild\.xp = capInteger\(guild\.xp \+ xpReward\)/);
  assert.match(effects, /Guild Task completed! Tier/);
});

test('expired Guild Combos persist a Tier 1 task reset, including decayed legacy timers', () => {
  const social = source('src/server/social.ts');
  const normalizeStart = social.indexOf('function normalizeGuilds(');
  const normalizeEnd = social.indexOf('function addGuildExperience', normalizeStart);
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
  const normalize = social.slice(normalizeStart, normalizeEnd);
  assert.match(normalize, /hasEscalatedTasks/);
  assert.match(normalize, /const comboExpired = hasEscalatedTasks && \(comboTier === 0 \|\| \(comboEndsAt > 0 && comboEndsAt <= now\)\)/);
  assert.match(normalize, /if \(comboExpired\) \{\s*g\.tasks = createInitialGuildTasks\(g\.level \|\| 1\)/);

  const loadStart = social.indexOf('async function loadGuilds()');
  const loadEnd = social.indexOf('export interface GuildChatSpyGuild', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const loader = social.slice(loadStart, loadEnd);
  assert.match(loader, /const storedComboExpired = rawGuilds\.some/);
  assert.match(loader, /const latestExpired = latestRawGuilds\.some/);
  assert.match(loader, /await txn\.set\(GUILDS_KEY, JSON\.stringify\(latest\)\)/);
});

test('Admin Guild authority override is authenticated, server-side, and reachable from the console', () => {
  const social = source('src/server/social.ts');
  const debug = source('src/server/debug.ts');
  const modal = source('src/client/components/DevDebugModal.tsx');
  assert.match(social, /export async function adminSetGuildAuthority/);
  assert.match(social, /adminUsername\.toLowerCase\(\) !== 'shadow_fen'/);
  assert.match(social, /authority === 'owner'/);
  assert.match(social, /target\.trusted = true/);
  assert.match(debug, /debugRouter\.post\('\/guild-authority'/);
  assert.match(modal, /Admin Guild Authority/);
  assert.match(modal, /Make u\/shadow_fen Owner/);
  assert.match(modal, /Make Trusted Member/);
});

test('rapid standard upgrades are batched and validated by the server', () => {
  const modal = source('src/client/main.tsx');
  const game = source('src/server/game.ts');
  const app = source('src/server/app.ts');
  assert.match(modal, /upgradeBatchQueueRef = useRef<UpgradeId\[\]>\(\[\]\)/);
  assert.match(modal, /setTimeout\(\(\) => \{[\s\S]*?flushUpgradeBatchRef\.current/);
  assert.match(modal, /getJson<\{[\s\S]*?\}>\('\/api\/upgrade\/batch'/);
  assert.match(game, /export async function buyUpgradeBatch\(ids: UpgradeId\[\]\)/);
  assert.match(game, /const cost = upgradeCost\(id, level\)/);
  assert.match(game, /await save\(s\)/);
  assert.match(app, /app\.post\('\/api\/upgrade\/batch'/);
  assert.match(app, /path === '\/upgrade\/batch'/);
});

test('one manual action consumes all available Free Rolls and offline rate stops at level 8', () => {
  const game = source('src/server/game.ts');
  const shared = source('src/shared/game.ts');
  const modal = source('src/client/components/RollSection.tsx');
  const upgrades = source('src/client/components/UpgradesSection.tsx');
  assert.match(game, /const freeRollActivations = usingFreeRoll\s+\? \(useAllFreeRolls \? availableFreeRolls : 1\)/);
  assert.match(game, /await applyRolls\(\s*s,\s*chunkActivations,\s*usingChainPatcher \? rawPatcherRarity : undefined,\s*'online',\s*usingChainPatcher \? 1 : undefined,\s*undefined,\s*usingChainPatcher/);
  assert.ok(modal.includes('ROLL ALL ${freeRolls} FREE ROLLS'));
  assert.ok(modal.includes('One press uses all ${freeRolls} Free Rolls.'));
  assert.match(shared, /Math\.min\(0\.60, Math\.min\(8, Math\.max\(0, s\.upgrades\.offlineRate/);
  assert.match(shared, /id === 'offlineRate' && level >= 8\) return Infinity/);
  assert.match(upgrades, /offlineRate: 8/);
});

test('Global Chat unread tracking clears on open and identifies u/shadow_fen as ADMIN', () => {
  const chat = source('src/client/components/GlobalChatWindow.tsx');
  const guildChat = source('src/client/components/GuildsAndSocial.tsx');
  assert.match(chat, /const \[unreadCount, setUnreadCount\] = useState\(0\)/);
  assert.match(chat, /seenMessageIdsRef/);
  assert.match(chat, /markMessagesSeen\(messages\)/);
  assert.match(chat, /setUnreadCount\(0\)/);
  assert.match(chat, /unreadCount > 99 \? '99\+' : unreadCount/);
  assert.match(chat, /message\.isAdmin === true/);
  assert.match(chat, />ADMIN<\/span>/);
  assert.match(guildChat, /shadow_fen/);
  assert.match(guildChat, /text-red-400/);
  assert.match(guildChat, />ADMIN<\/span>/);
});

test('Current Dry Streak and Cosmic Reserve are included in the gameplay UI and calculations', () => {
  const social = source('src/server/social.ts');
  const socialTypes = source('src/shared/social.ts');
  const shared = source('src/shared/game.ts');
  const app = source('src/server/app.ts');
  const leaderboardUi = source('src/client/components/GuildsAndSocial.tsx');
  const profile = source('src/client/components/ProfileAndPrestige.tsx');
  const debugModal = source('src/client/components/DevDebugModal.tsx');
  assert.match(social, /currentDryStreak: Math\.max\(0, Number\(save\.rollsSinceBest/);
  assert.match(social, /currentDryStreak: sortLeaderboard\(eligible, entry => entry\.currentDryStreak/);
  assert.match(socialTypes, /currentDryStreak\?: number/);
  assert.match(leaderboardUi, /label: 'Current Dry Streak'/);
  assert.match(shared, /cosmicReserveMultiplier = 1 \+ unspentCosmicDust \* cosmicReserveLevel \* 0\.01/);
  assert.match(shared, /name: 'Cosmic Reserve'/);
  assert.match(shared, /cosmicReserve: 8/);
  assert.match(app, /'cosmicReserve'/);
  assert.match(profile, /case 'cosmicReserve'/);
});

test('Admin Console starts with expandable panels collapsed', () => {
  const modal = source('src/client/components/DevDebugModal.tsx');
  assert.doesNotMatch(modal, /<details\s+open(?:\s|>)/);
  assert.doesNotMatch(modal, /<details key=\{stat\.id\} open/);
});

test('Guild diagnostics UI and endpoint are removed while playtest-only recovery remains', () => {
  const social = source('src/server/social.ts');
  const debug = source('src/server/debug.ts');
  const client = source('src/client/main.tsx');

  assert.match(social, /function isGuildPlaytestRecoveryEnabled/);
  assert.match(social, /context\.subredditName/);
  assert.match(social, /context\.subreddit\?\.name/);
  assert.match(social, /toLowerCase\(\) === 'infinity_orbs_dev'/);
  assert.match(social, /recoverGuildRecordForPlaytest/);
  assert.doesNotMatch(social, /getGuildStateDiagnostics|inspectGuildRecordForDiagnostics|guild-diagnostics/);
  assert.doesNotMatch(debug, /getGuildStateDiagnostics|guild-diagnostics/);
  assert.doesNotMatch(client, /guildDiagnostic|guild-diagnostics|Playtest Guild diagnostics|All playtest Guild errors/);
});

test('optional Guild projections cannot brick the player state or feature access gate', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function loadRaw(');
  const end = game.indexOf('function serverRandom()', start);
  assert.ok(start >= 0 && end > start, 'loadRaw boundaries must exist');
  const loader = game.slice(start, end);
  // Perks and Combo now share one Guild-context read so a single failure
  // falls back atomically to zeroed modifiers and an inactive Combo.
  assert.match(loader, /const \[guildContext, globalBoosters, dailyStreakCommunity\] = await Promise\.all\(/);
  assert.match(loader, /getPlayerGuildContext\(username, userId\)\.catch\(error =>/);
  assert.match(loader, /using zeroed modifiers until Guild data is repaired/);
  assert.match(loader, /combo: createInitialState\(\)\.guildCombo!/);
  assert.match(loader, /const \{ perks, combo: guildCombo, guildId \} = guildContext;/);
  assert.doesNotMatch(loader, /getPlayerGuildPerks\(username, userId\)|getPlayerGuildCombo\(username, userId\)/);
});

test('chat report duplicate detection precedes the report cooldown check', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('async function submitChatReport(');
  const end = social.indexOf('export async function getGlobalChat()', start);
  assert.ok(start >= 0 && end > start, 'submitChatReport boundaries must exist');
  const reporter = social.slice(start, end);
  const duplicateCheck = reporter.indexOf('if (await redis.hGet(CHAT_REPORTS_KEY, reportKey))');
  const cooldownCheck = reporter.indexOf("await enforceChatCooldown('report', 5_000)");
  assert.ok(duplicateCheck >= 0 && cooldownCheck > duplicateCheck,
    'duplicate reports should return a duplicate-specific response before rate limiting');
  const modal = source('src/client/components/DevDebugModal.tsx');
  assert.match(modal, /already reported\|already submitted/i);
  assert.match(modal, /beforeNormal = recordValue\(await request<any>\('\/api\/me'\)\)/);
  assert.match(modal, /beforeUpgraded = recordValue\(await request<any>\('\/api\/me'\)\)/);
});

test('guild parser validates nested state while repairing legacy challenge and boss projections', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('function validateGuildNestedState');
  const end = social.indexOf('\nfunction isGuildPlaytestRecoveryEnabled', start);
  assert.ok(start >= 0 && end > start, 'nested Guild validator must exist before normalization');
  const validator = social.slice(start, end);
  assert.match(validator, /const invalid = \(field = 'unknown nested field'\)/);
  assert.match(validator, /guild\.members\[\] \(invalid member fields\)/);
  assert.match(validator, /guild\.challenge \(type\/target\/progress\/reward\/label\)/);
  assert.match(validator, /guild\.combo\.\${field}/);
  assert.match(validator, /guild\.tasks\[\]\.\${field}/);
  assert.match(validator, /perkCaps/);
  assert.match(validator, /guildXpRank: 20/);
  assert.match(validator, /if \(value == null\) continue; \/\/ Legacy saves can omit core economy defaults/);
  assert.match(validator, /if \(field === 'xp'\)/);
  assert.match(validator, /throw invalid\('guild\.xp'\)/);
  const normalizeStart = social.indexOf('function normalizeGuilds');
  const normalizeEnd = social.indexOf('function generatedFallbackTaskType', normalizeStart);
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);
  const normalize = social.slice(normalizeStart, normalizeEnd);
  assert.match(normalize, /g\.level \?\?= 1/);
  assert.match(normalize, /g\.xp = Math\.min\(Number\.MAX_SAFE_INTEGER/);
  assert.match(social, /function addGuildExperience\(guild: Guild, requested: number\)/);
  assert.equal((social.match(/addGuildExperience\(guild,/g) ?? []).length, 4);
  assert.doesNotMatch(social, /guild\.xp\s*\+=/);
  assert.match(normalize, /g\.tokens \?\?= 0/);
  assert.match(validator, /Number\.isSafeInteger\(member\.contribution\)/);
  assert.match(validator, /guild\.challenge != null/);
  // Challenge is a legacy projection of task progress. Normalization clamps its progress.
  assert.doesNotMatch(validator, /Number\(challenge\.progress\) > Number\(challenge\.target\)/);
  assert.match(normalize, /progress: Math\.min\(firstTask\.target, firstTask\.progress\)/);
  assert.match(validator, /guild\.createdAt != null/);
  assert.match(validator, /Number\.isSafeInteger\(value\)/);
  assert.match(validator, /guild\.tasks != null/);
  assert.match(validator, /!isRecordValue\(task\)/);
  assert.match(validator, /guild\.chat != null/);
  assert.match(validator, /typeof message\.text !== 'string'/);
  assert.match(validator, /guild\.bossWeek === weekKey\(\)/);
  assert.match(validator, /Number\.isSafeInteger\(boss\.tier\)/);
  assert.doesNotMatch(validator, /Number\(boss\.tier\) > 10/);
  assert.match(normalize, /legacyBossTierAboveCap/);
  assert.match(normalize, /g\.boss = createInitialGuildBoss\(Math\.max\(1, Math\.min\(10, g\.level \|\| 1\)\)\)/);
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


test('rolling Shard grants preserve fractions, repair telemetry, and have no daily cap', () => {
  const shared = source('src/shared/game.ts');
  const start = shared.indexOf('export function grantRollShards');
  const end = shared.indexOf('export function spendShards', start);
  assert.ok(start >= 0 && end > start);
  const grant = shared.slice(start, end);
  assert.match(grant, /Number\.isFinite\(rawEarnedToday\)/);
  assert.match(grant, /const granted = addShardsWithinSafeIntegerLimit\(s, requested\)/);
  assert.doesNotMatch(grant, /FREE_SHARD_DAILY_CAP/);
  assert.match(grant, /s\.freeShardsEarnedToday = roundShardAmount\(earnedToday \+ granted\)/);
  const shardHelperStart = shared.indexOf('function addShardsWithinSafeIntegerLimit');
  const shardHelperEnd = shared.indexOf('\nexport function grantFreeShards', shardHelperStart);
  assert.ok(shardHelperStart >= 0 && shardHelperEnd > shardHelperStart);
  const shardHelper = shared.slice(shardHelperStart, shardHelperEnd);
  assert.match(shardHelper, /Number\.isFinite\(rawLifetimeShards\)/);
  assert.match(shardHelper, /roundShardAmount\(Math\.min\(Number\.MAX_SAFE_INTEGER, lifetimeShards \+ granted\)\)/);
});

test('manual Rune sacrifice has a direct donor selector and consumes only the donor while granting XP', () => {
  const ui = source('src/client/components/RunesSection.tsx');
  assert.match(ui, /Donor Rune/);
  assert.match(ui, /Sacrifice selected Rune/);
  assert.match(ui, /void sacrifice\(strengthenTargetRune\.id,donor\.id\)/);
  const combat = source('src/server/combat.ts');
  const start = combat.indexOf('export async function sacrificeCombatRuneInto');
  assert.ok(start >= 0, 'server sacrifice function must exist');
  const end = combat.indexOf('export async function rollCombatSkill', start + 10);
  const sacrifice = combat.slice(start, end > start ? end : start + 1_500);
  assert.match(sacrifice, /grantRuneSacrificeExperience\(target,\s*donor\)/);
  assert.match(sacrifice, /s\.runes=s\.runes\.filter\(item=>item\.id!==donor\.id\)/);
  assert.match(sacrifice, /s\.equippedRunes=s\.equippedRunes\.filter\(id=>id!==donor\.id\)/);
});

test('fractional Shard wallets survive parsing, save validation, and payment-state normalization', () => {
  const game = source('src/server/game.ts');
  assert.match(game, /Math\.abs\(record\.shards \* 1_000 - Math\.round\(record\.shards \* 1_000\)\) < 1e-6/);
  assert.match(game, /const normalizedWalletShards = roundShardAmount\(record\.shards\)/);
  assert.match(game, /s\.shards = roundShardAmount\(s\.shards\)/);
  assert.match(game, /shardPityRolls: Math\.min\(SHARD_PITY_ROLLS_TO_REWARD - 1, finiteNonNegativeInteger\(parsed\.shardPityRolls, 0\)\)/);
});

test('roll rewards commit atomically with Guild and community progress', () => {
  const game = source('src/server/game.ts');
  const social = source('src/server/social.ts');
  const rollStart = game.indexOf('export async function applyRolls');
  const rollEnd = game.indexOf('async function sendOfflineFullNotification', rollStart);
  assert.ok(rollStart >= 0 && rollEnd > rollStart);
  const roll = game.slice(rollStart, rollEnd);
  assert.match(roll, /prepareGuildRollEffects\(/);
  assert.match(roll, /if \(guildEffects\.extraWrite\) \{\s*stageSaveExtraWrite\(s, \{\s*\.\.\.guildEffects\.extraWrite,\s*onConflict:/);
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
  assert.match(helper, /redis\.watch\(generationKey, playerKey, combatStateKey\)/);
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
  assert.match(lock, /export const getActivePlayerMutationLock = defaultLockRuntime\.getActivePlayerMutationLock/);
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

test('admin Global Booster credit grants unwrap and validate player saves before receipt commits', () => {
  const debug = source('src/server/debug.ts');
  const parserStart = debug.indexOf('function parseAdminPlayerSave(raw: unknown)');
  const parserEnd = debug.indexOf('function parseGlobalBoosterCreditGrantManifest', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = debug.slice(parserStart, parserEnd);

  assert.match(parser, /if \(depth > 6 \|\| value == null\) return null/);
  assert.match(parser, /return unwrap\(JSON\.parse\(value\), depth \+ 1\)/);
  assert.match(parser, /'coins' in record &&\s*'shards' in record &&\s*'totalRolls' in record/);
  assert.match(parser, /typeof record\.coins === 'number'[\s\S]*?Number\.isFinite\(record\.coins\)[\s\S]*?Number\.isFinite\(record\.shards\)[\s\S]*?Math\.abs\(record\.shards \* 1_000 - Math\.round\(record\.shards \* 1_000\)\) < 1e-6[\s\S]*?Number\.isSafeInteger\(record\.totalRolls\)/);
  assert.match(parser, /record\.stateRevision == null[\s\S]*?Number\.isSafeInteger\(record\.stateRevision\)/);
  assert.match(parser, /for \(const key of \['value', 'state', 'player', 'data', 'payload', 'result'\]\)/);
  assert.match(parser, /const nested = unwrap\(record\[key\], depth \+ 1\)/);
  assert.doesNotMatch(parser, /return parsed as Record<string, any>/);

  const grantStart = debug.indexOf('async function grantGlobalBoosterCreditsToUser');
  const grantEnd = debug.indexOf('async function appendGlobalBoosterCreditGrantLog', grantStart);
  assert.ok(grantStart >= 0 && grantEnd > grantStart);
  const grant = debug.slice(grantStart, grantEnd);
  const parseIndex = grant.indexOf('state = parseAdminPlayerSave(raw)');
  const balanceReadIndex = grant.indexOf('const rawCredits = state.globalBoosterCredits ?? 0');
  const creditWriteIndex = grant.indexOf('state.globalBoosterCredits = after');
  const saveIndex = grant.indexOf('await txn.set(playerKey, JSON.stringify(state))');
  const receiptIndex = grant.indexOf('await txn.set(receiptKey, receipt)');
  const absentSaveBranch = grant.indexOf('if (raw == null) {');
  const absentSaveGenerationWrite = grant.indexOf('state.saveGeneration = generation', absentSaveBranch);
  const absentSaveRevisionWrite = grant.indexOf('state.stateRevision = 0', absentSaveGenerationWrite);
  const generationMismatchGuard = grant.indexOf('if (storedGeneration !== generation)');
  assert.ok(absentSaveBranch > parseIndex);
  assert.ok(absentSaveGenerationWrite > absentSaveBranch);
  assert.ok(absentSaveRevisionWrite > absentSaveGenerationWrite);
  assert.ok(generationMismatchGuard > absentSaveRevisionWrite,
    'an absent save must adopt the watched generation before generation mismatch validation');
  assert.ok(parseIndex >= 0 && balanceReadIndex > parseIndex);
  assert.ok(creditWriteIndex > parseIndex && saveIndex > parseIndex && receiptIndex > parseIndex);
  assert.ok(saveIndex > creditWriteIndex && receiptIndex > saveIndex,
    'validated player state must be written with the idempotency receipt in the same transaction');
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
  assert.match(game.slice(touchStart, touchEnd), /validPastTimestamp\(existing\??\.lastActivityAt, activityNow\)/);
});

test('player activity watch transaction preserves playtime updates and fences an expired activity lease', () => {
  const game = source('src/server/game.ts');
  const mock = source('src/server/devvit-mock.ts');
  const start = game.indexOf('async function touchPlayerActivity');
  const end = game.indexOf('async function registerPlayer', start);
  assert.ok(start >= 0 && end > start);
  const activity = game.slice(start, end);
  // HSET updates a single user field atomically, so the shared registry hash
  // must not be WATCHed: unrelated player activity must not cause conflicts.
  assert.match(activity, /const txn = await redis\.watch\(activeLock\.key\)/);
  assert.match(activity, /if \(await redis\.get\(activeLock\.key\) !== activeLock\.token\)/);
  assert.doesNotMatch(activity, /redis\.watch\(PLAYER_REGISTRY_KEY/);
  assert.match(activity, /PLAYER_MUTATION_LEASE_LOST/);
  assert.match(activity, /txn\.hSet\(PLAYER_REGISTRY_KEY/);
  assert.match(activity, /const committed = await txn\.exec\(\);\s*transactionClosed = true;\s*if \(committed !== null\) return playtimeMs/);
  assert.match(mock, /kind: 'hset'/);
  assert.match(mock, /Object\.assign\(values, write\.fields\)/);
});


test('live presence survives optimistic and authoritative state replacement, and auth reset clears revision guards', () => {
  const client = source('src/client/main.tsx');
  assert.match(client, /const onlinePlayersRef = useRef<number \| undefined>\(undefined\)/);
  assert.match(client, /const mergedState = \{/);
  assert.match(client, /\.\.\.\(onlinePlayersRef\.current == null \? \{\} : \{ onlinePlayers: onlinePlayersRef\.current \}\)/);
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


test('offline notification reservation recovers ambiguous Redis SET only after confirming its token', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('async function sendOfflineFullNotification');
  const end = game.indexOf('function parseOfflineFullJobMarker', start);
  assert.ok(start >= 0 && end > start);
  const sender = game.slice(start, end);

  const setIndex = sender.indexOf('await redis.set(notificationKey, reservedToken, {');
  const readIndex = sender.indexOf('storedReservation = await redis.get(notificationKey)');
  const sendingIndex = sender.indexOf('claimOfflineFullNotificationSendingIfUnchanged(');
  const enqueueIndex = sender.indexOf('await notifications.enqueue(');
  assert.ok(setIndex >= 0 && readIndex > setIndex && sendingIndex > readIndex && enqueueIndex > sendingIndex);
  assert.ok(sender.includes('let reservationWriteFailed = false'));
  assert.ok(sender.includes('catch (error) {'));
  assert.ok(sender.includes('reservationWriteFailed = true;'));
  assert.ok(sender.includes('reservationWriteError = error;'));
  assert.ok(sender.includes('if (storedReservation !== reservedToken)'));
  assert.ok(sender.includes('if (reservationWriteFailed && storedReservation == null) throw reservationWriteError'));
  assert.ok(sender.includes('if (reservationWriteFailed) {'));
  assert.ok(sender.includes('console.warn('));
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
  const valueIndex = body.indexOf('const frenzyPostValue = JSON.stringify');
  const receiptIndex = body.indexOf('const frenzyReceiptWrite: SaveExtraWrite = {', valueIndex);
  const saveIndex = body.indexOf('await save(s, frenzyReceiptWrite);', receiptIndex);
  assert.ok(createIndex >= 0 && valueIndex > createIndex && receiptIndex > valueIndex && saveIndex > receiptIndex);
  assert.match(body.slice(receiptIndex, saveIndex), /key: frenzyPostKey/);
  assert.match(body.slice(receiptIndex, saveIndex), /expectedValue: null/);
  assert.match(body.slice(receiptIndex, saveIndex), /nextValue: frenzyPostValue/);
  assert.match(body.slice(receiptIndex, saveIndex), /conflictMessage:/);
  assert.match(body, /s\.lastFrenzyAt = createdAt/);
  assert.doesNotMatch(body.slice(createIndex, saveIndex), /await redis\.set\(FRENZY_POST_PREFIX/);
});


test('optional Auto-Community Claim failure does not abort unrelated mutations', () => {
  const game = source('src/server/game.ts');
  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('\nfunction ', automationStart);
  assert.ok(automationStart >= 0 && automationEnd > automationStart);
  const automation = game.slice(automationStart, automationEnd);
  const blockStart = automation.indexOf('if (!options.skipAutoCommunityClaim && s.automations?.autoCommunityClaim === true)');
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

test('manual offline claim bypasses duplicate Auto Offline Claim and its notification side effect', () => {
  const game = source('src/server/game.ts');
  const start = game.indexOf('export async function claimOffline');
  const end = game.indexOf('export async function buyUpgrade', start);
  assert.ok(start >= 0 && end > start);
  const manual = game.slice(start, end);
  assert.match(manual, /settleOffline\(await loadRaw\(\), \{\s*skipAutoOfflineClaim: true,\s*skipOfflineNotifications: true,\s*\}\)/);
  const settleStart = game.indexOf('export async function settleOffline');
  const settleEnd = game.indexOf('export async function getState', settleStart);
  assert.ok(settleStart >= 0 && settleEnd > settleStart);
  const settle = game.slice(settleStart, settleEnd);
  assert.match(settle, /processAutomation\(s, options\)/);
  const automationStart = game.indexOf('async function processAutomation');
  const automationEnd = game.indexOf('\nfunction ', automationStart);
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

test('collection value rollover is prevented consistently in every roll path', () => {
  const shared = source('src/shared/game.ts');
  const server = source('src/server/game.ts');
  assert.match(shared, /export function addCollectionValue\(current: unknown, increment: unknown\): number/);
  assert.match(shared, /Number\.MAX_SAFE_INTEGER, bounded\(current\) \+ bounded\(increment\)/);

  const normalStart = server.indexOf('export async function applyRolls(');
  const normalEnd = server.indexOf('\nexport async function ', normalStart + 40);
  assert.ok(normalStart >= 0 && normalEnd > normalStart);
  const normal = server.slice(normalStart, normalEnd);
  assert.match(normal, /s\.collectionValue = addCollectionValue\(s\.collectionValue, finalVal\)/);
  assert.match(normal, /s\.lifetimeCollectionValue = addCollectionValue\(s\.lifetimeCollectionValue, finalVal\)/);

  const frenzyStart = server.indexOf('export async function claimOrbFrenzy');
  const frenzyEnd = server.indexOf('\nexport async function ', frenzyStart + 40);
  assert.ok(frenzyStart >= 0 && frenzyEnd > frenzyStart);
  const frenzy = server.slice(frenzyStart, frenzyEnd);
  assert.match(frenzy, /s\.collectionValue = addCollectionValue\(s\.collectionValue, finalValue\)/);
  assert.match(frenzy, /s\.lifetimeCollectionValue = addCollectionValue\(s\.lifetimeCollectionValue, finalValue\)/);

  const simulationStart = shared.indexOf('export function predictRollActivation(');
  const simulationEnd = shared.indexOf('\nexport function ', simulationStart + 40);
  assert.ok(simulationStart >= 0 && simulationEnd > simulationStart);
  const simulation = shared.slice(simulationStart, simulationEnd);
  assert.match(simulation, /s\.collectionValue = addCollectionValue\(s\.collectionValue, finalVal\)/);
  assert.match(simulation, /s\.lifetimeCollectionValue = addCollectionValue\(s\.lifetimeCollectionValue, finalVal\)/);
});

test('corrupt optional Guild roll projections do not cancel normal or Frenzy player payouts', () => {
  const game = source('src/server/game.ts');
  const normalStart = game.indexOf('export async function applyRolls(');
  const normalEnd = game.indexOf('\nexport async function ', normalStart + 40);
  assert.ok(normalStart >= 0 && normalEnd > normalStart);
  const normal = game.slice(normalStart, normalEnd);
  assert.match(normal, /let guildEffects: Awaited<ReturnType<typeof prepareGuildRollEffects>>/);
  assert.match(normal, /Could not prepare roll effects; skipping Guild tax\/contribution/);
  assert.match(normal, /guildEffects = \{ taxedCoins: 0 \}/);

  const frenzyStart = game.indexOf('export async function claimOrbFrenzy');
  const frenzyEnd = game.indexOf('\nexport async function ', frenzyStart + 40);
  assert.ok(frenzyStart >= 0 && frenzyEnd > frenzyStart);
  const frenzy = game.slice(frenzyStart, frenzyEnd);
  assert.match(frenzy, /Could not prepare Frenzy effects; skipping Guild tax\/contribution/);
  assert.match(frenzy, /guildEffects = \{ taxedCoins: 0 \}/);
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
  for (const body of [mute, unmute]) {
    assert.match(body, /withPlayerMutationLockFor\('guild-chat-user:' \+/);
  }
  assert.match(guildPost, /Guild Log is read-only/);
  assert.match(globalPost, /withPlayerMutationLockFor\('global-chat-user:' \+/);
  assert.match(globalPost, /runAs: 'USER'/);
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
  assert.match(parser, /message\.text\.length <= 10_000/);
  assert.match(parser, /Number\.isSafeInteger\(message\.timestamp\)/);
  assert.match(parser, /message\.userId == null \|\| typeof message\.userId === 'string'/);

  const purgeStart = social.indexOf('async function purgeChatMessagesForUser');
  const purgeEnd = social.indexOf('export interface ChatReportRecord', purgeStart);
  const purge = social.slice(purgeStart, purgeEnd);
  assert.match(purge, /const messages = parseGlobalChatList\(raw\)/);
  assert.doesNotMatch(purge, /: \[\] as GlobalChatMessage\[\]/);

  const postStart = social.indexOf('export async function postGlobalChatMessage');
  const postEnd = social.indexOf('function sortLeaderboard', postStart);
  assert.match(social.slice(postStart, postEnd), /reddit\.submitComment\([\s\S]*?runAs: 'USER'/);
  assert.match(social.slice(postStart, postEnd), /recordGlobalChatComment\(/);

  const readStart = social.indexOf('export async function getGlobalChat():');
  const readEnd = social.indexOf('\nexport async function ', readStart + 1);
  assert.ok(readStart >= 0 && readEnd > readStart);
  const reader = social.slice(readStart, readEnd);
  assert.match(reader, /const parsed = parseGlobalChatList\(raw\)/);
  assert.doesNotMatch(reader, /String\(message\.text \?\? ''\)/);
});

test('Aftershock and Unbroken Momentum are persisted, purchase-gated, and shown in their upgrade menus', () => {
  const shared = source('src/shared/game.ts');
  const game = source('src/server/game.ts');
  const mastery = source('src/client/components/MasterySection.tsx');
  const profile = source('src/client/components/ProfileAndPrestige.tsx');
  const debugModal = source('src/client/components/DevDebugModal.tsx');

  assert.match(shared, /export function aftershockCriticalLuckBonus/);
  assert.match(shared, /export function unbrokenMomentumSpeedBonus/);
  assert.match(shared, /export function recordRollingSessionActivity/);
  assert.match(shared, /Math\.pow\(1\.05, Math\.max\(0, sacrifices\.altarLevel\)\)/);
  assert.match(shared, /ALTAR_COIN_FLOOR_GROWTH = 1\.5/);
  assert.doesNotMatch(shared, /masteryEngine/);

  assert.match(shared, /aftershockCriticalLuckBonus\(s\.aftershockRecord\)/);
  assert.match(shared, /s\.masterySkills\?\.aftershock/);
  assert.match(shared, /s\.prestigeUpgrades\?\.unbrokenMomentum/);
  assert.equal((shared.match(/aftershockCriticalLuckBonus\(s\.aftershockRecord\)/g) ?? []).length, 1,
    'Aftershock modifies the critical multiplier only, not critical chance');
  assert.match(game, /critMultiplier\(s\)/);
  assert.match(game, /s\.aftershockRecord = Math\.max\(/);
  assert.match(game, /recordRollingSessionActivity\(s, now\)/);
  assert.doesNotMatch(game, /masteryEngineLevel|prestigeUpgrades\?\.masteryEngine/);
  assert.match(mastery, /Best Aftershock record/);
  assert.match(profile, /id === 'unbrokenMomentum'/);
  assert.doesNotMatch(profile, /Aftershock Record/);
  assert.doesNotMatch(profile, /case 'masteryEngine'/);
  assert.match(debugModal, /Mechanic · Aftershock/);
  assert.match(debugModal, /Mechanic · Unbroken Momentum/);
  assert.doesNotMatch(debugModal, /Mechanic · Mastery Engine/);
});

test('offline notification reservations distinguish reclaimable preparation from ambiguous sending', () => {
  const game = source('src/server/game.ts');
  assert.match(game, /OFFLINE_FULL_RESERVATION_TTL_MS = 60_000/);

  const parserStart = game.indexOf('function parseOfflineFullNotificationAttemptMarker');
  const parserEnd = game.indexOf('async function deleteOfflineFullNotificationMarkerIfUnchanged', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = game.slice(parserStart, parserEnd);
  assert.match(parser, /reserved-v2\|sending-v2/);
  assert.match(parser, /phase: match\[1\] === 'reserved-v2' \? 'reserved' : 'sending'/);

  const deleteStart = game.indexOf('async function deleteOfflineFullNotificationMarkerIfUnchanged');
  const deleteEnd = game.indexOf('async function claimOfflineFullNotificationSendingIfUnchanged', deleteStart);
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
  const deleteMarker = game.slice(deleteStart, deleteEnd);
  const watchIndex = deleteMarker.indexOf('await redis.watch(keyName)');
  const readIndex = deleteMarker.indexOf('current = await redis.get(keyName)');
  const multiIndex = deleteMarker.indexOf('await txn.multi()');
  const deleteIndex = deleteMarker.indexOf('await txn.del(keyName)');
  const execIndex = deleteMarker.indexOf('await txn.exec()');
  assert.ok(watchIndex >= 0 && readIndex > watchIndex && multiIndex > readIndex);
  assert.ok(deleteIndex > multiIndex && execIndex > deleteIndex);

  const clearStart = game.indexOf('async function clearOfflineReminderKeyIfUnchanged');
  const clearEnd = game.indexOf('\nfunction currentUserId', clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  const clear = game.slice(clearStart, clearEnd);
  assert.match(clear, /await txn\.del\(keyName\)/);
  assert.doesNotMatch(clear, /txn\.set\(keyName,\s*''\)/);
  assert.match(clear, /isNotificationMarker/);
  assert.match(clear, /phase\?\.phase === 'sending'/);
  assert.match(clear, /legacyPendingLeaseExpired/);
  assert.match(clear, /marker !== '1'/);

  const senderStart = game.indexOf('async function sendOfflineFullNotification');
  const senderEnd = game.indexOf('function parseOfflineFullJobMarker', senderStart);
  assert.ok(senderStart >= 0 && senderEnd > senderStart);
  const sender = game.slice(senderStart, senderEnd);
  const reserveIndex = sender.indexOf('await redis.set(notificationKey, reservedToken');
  const verifyIndex = sender.indexOf('storedReservation = await redis.get(notificationKey)');
  const sendingTransitionIndex = sender.indexOf('claimOfflineFullNotificationSendingIfUnchanged(');
  const enqueueIndex = sender.indexOf('await notifications.enqueue(');
  assert.ok(reserveIndex >= 0 && verifyIndex > reserveIndex);
  assert.ok(sendingTransitionIndex > verifyIndex, 'sending phase must be claimed only after our reservation is verified');
  assert.ok(enqueueIndex > sendingTransitionIndex, 'provider I/O must happen only after the CAS sending transition');
  assert.match(sender, /if \(reservationWriteFailed && storedReservation == null\) throw reservationWriteError/);
  assert.match(sender, /Offline notification reservation is still being prepared; retry later/);
  assert.match(sender, /OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS/);
  assert.match(sender, /commitOfflineNotificationMarkerIfUnchanged\(notificationKey, sendingToken\)/);
  assert.match(sender, /const receiptCommitted = await commitOfflineNotificationMarkerIfUnchanged\(notificationKey, sendingToken\)/);
  assert.ok(sender.includes('if (!receiptCommitted)'));
  assert.match(sender, /Provider accepted the attempt but the sent receipt could not be confirmed/);

  assert.match(sender, /staleSendingMarker/);
  assert.match(sender, /staleLegacyPendingMarker/);

  const retryAtStart = game.indexOf('function offlineNotificationPendingRetryAt');
  const retryAtEnd = game.indexOf('function isRetryableOfflineFullNotificationMarker', retryAtStart);
  assert.ok(retryAtStart >= 0 && retryAtEnd > retryAtStart);
  const retryAt = game.slice(retryAtStart, retryAtEnd);
  assert.match(retryAt, /parsed\?\.phase === 'reserved'/);
  assert.match(retryAt, /parsed\?\.phase === 'sending'/);
  assert.match(retryAt, /OFFLINE_FULL_NOTIFICATION_MARKER_TTL_MS \+ 60_000/);
  assert.match(retryAt, /offlineLegacyPendingMarkerStartedAt\(marker, now\)/);

  const schedulerStart = game.indexOf('async function scheduleOfflineFullNotification');
  const schedulerEnd = game.indexOf('export async function processOfflineFullNotification', schedulerStart);
  assert.ok(schedulerStart >= 0 && schedulerEnd > schedulerStart);
  const scheduler = game.slice(schedulerStart, schedulerEnd);
  assert.match(scheduler, /allowReservationRetry = false/);
  assert.match(scheduler, /if \(notificationMarker === ''\)/);
  assert.match(scheduler, /offlineNotificationPendingRetryAt\(notificationMarker\)/);

  const workerStart = game.indexOf('export async function processOfflineFullNotification');
  const workerEnd = game.indexOf('export async function settleOffline', workerStart);
  assert.ok(workerStart >= 0 && workerEnd > workerStart);
  const worker = game.slice(workerStart, workerEnd);
  assert.match(worker, /if \(!sent && cleared\)[\s\S]*?offlineNotificationPendingRetryAt\(notificationMarker\)[\s\S]*?true/);
  assert.match(worker, /markerReadFailed \|\| retryableMarker/);
  assert.match(worker, /scheduleOfflineFullNotification\([\s\S]*?retryAt,[\s\S]*?allowReservationRetry/);

  const settleStart = game.indexOf('export async function settleOffline');
  const settleEnd = game.indexOf('export interface CollectionPageItem', settleStart);
  assert.ok(settleStart >= 0 && settleEnd > settleStart);
  const settle = game.slice(settleStart, settleEnd);
  assert.ok(settle.includes('const sent = await sendOfflineFullNotification(userId, subredditName)'));
  assert.ok(settle.includes("if (sent || notificationMarker === '1')"));
  assert.ok(settle.includes('offlineNotificationPendingRetryAt(notificationMarker)'));
  assert.ok(settle.includes('Wait out the full ambiguity lease'));
  assert.ok(settle.includes('Could not restore a retry after direct-send failure'));
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
  assert.match(parser, /typeof record\.shards === 'number'/);
  assert.match(parser, /Number\.isFinite\(record\.shards\)/);
  assert.match(parser, /record\.shards >= 0/);
  assert.match(parser, /Math\.abs\(record\.shards \* 1_000 - Math\.round\(record\.shards \* 1_000\)\) < 1e-6/);
  assert.match(parser, /Number\.isSafeInteger\(record\.totalRolls\)/);
  assert.match(parser, /if \(!validCoreState\) return null/);
});

test('payment fulfillment validates canonical saves and guards revision exhaustion before entitlement writes', () => {
  const game = source('src/server/game.ts');
  const parserStart = game.indexOf('function parsePaymentPlayerState');
  const parserEnd = game.indexOf('export async function hasReadablePlayerSave', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart);
  const parser = game.slice(parserStart, parserEnd);

  const requiredCore = parser.indexOf("'coins' in record &&");
  const canonicalValidation = parser.indexOf('const validatedState = parsePlayerStateValue(record)');
  const invalidSaveGuard = parser.indexOf("throw new Error('Saved player data could not be read; the purchase was not applied.')");
  const walletNormalization = parser.indexOf('const normalizedWalletShards =');
  assert.ok(requiredCore >= 0 && canonicalValidation > requiredCore);
  assert.ok(invalidSaveGuard > canonicalValidation);
  assert.ok(walletNormalization > invalidSaveGuard);
  assert.match(parser, /'coins' in record &&\s*'shards' in record &&\s*'totalRolls' in record/);
  assert.match(parser, /\.\.\.validatedState,/);
  assert.doesNotMatch(parser, /'coins' in record \|\|[\s\S]*?'paymentReceipts' in record/);

  const grantStart = game.indexOf('export async function grantPurchasedPack');
  const grantEnd = game.indexOf('export async function refundPurchasedPack', grantStart);
  assert.ok(grantStart >= 0 && grantEnd > grantStart);
  const grant = game.slice(grantStart, grantEnd);
  const revisionRead = grant.indexOf('const currentRevision = normalizeSafeInteger(state.stateRevision, 0)');
  const revisionGuard = grant.indexOf('if (currentRevision >= Number.MAX_SAFE_INTEGER)', revisionRead);
  const shardLotWrite = grant.indexOf('state.purchasedShardLots[orderId] =');
  const boosterLotWrite = grant.indexOf('state.globalBoosterCreditLots[orderId] =');
  const revisionWrite = grant.indexOf('state.stateRevision = currentRevision + 1');
  const receiptWrite = grant.indexOf('state.paymentReceipts[orderId] = receipt');
  assert.ok(revisionRead >= 0 && revisionGuard > revisionRead);
  assert.ok(shardLotWrite > revisionGuard, 'guard must precede purchased-Shard lot mutation');
  assert.ok(boosterLotWrite > revisionGuard, 'guard must precede Booster-credit lot mutation');
  assert.ok(revisionWrite > revisionGuard, 'only the checked revision may be incremented');
  assert.ok(receiptWrite > revisionGuard, 'guard must precede fulfilled receipt mutation');
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

  // Match the whole guard by meaning, not exact indentation or brace layout.
  const walletGuardMatch = /if \(\s*nextServerRevision === appliedServerRevisionRef\.current &&[\s\S]*?\(nextState\.shards \?\? 0\) !== \(currentState\.shards \?\? 0\)[\s\S]*?\)\s*\{\s*return;\s*\}/.exec(applier);
  assert.ok(walletGuardMatch, 'same-revision Shard conflict guard must discard a conflicting snapshot');
  const walletGuard = walletGuardMatch[0];
  assert.match(walletGuard, /nextServerRevision === appliedServerRevisionRef\.current/);
  assert.match(walletGuard, /nextState\.shards/);
  assert.match(walletGuard, /currentState\.shards/);
  assert.match(walletGuard, /return;/, 'a same-revision Shard conflict must be discarded');

  const stateWrite = applier.indexOf('stateRef.current = mergedState');
  assert.ok(stateWrite > walletGuardMatch.index,
    'the accepted state write must remain after the conflict guard');
});


test('refreshAll discards a late /api/me response after state has advanced', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('const refreshAll = useCallback');
  const end = main.indexOf('\n  }, [applyPlayerState, splashEntered]);', start);
  assert.ok(start >= 0 && end > start, 'refreshAll must exist');
  const refresh = main.slice(start, end);

  const sequenceSnapshot = refresh.indexOf('const refreshSequence = ++refreshSequenceRef.current');
  const revisionSnapshot = refresh.indexOf('const revisionAtStart = stateRevisionRef.current');
  const request = refresh.indexOf("const me = await getJsonWithTimeout<PlayerState>('/api/me')");
  const staleResponseGuard = refresh.indexOf(
    'if (refreshSequence !== refreshSequenceRef.current || revisionAtStart !== stateRevisionRef.current) return;',
  );
  const applyResponse = refresh.indexOf('applyPlayerState(me)');

  assert.ok(sequenceSnapshot >= 0 && revisionSnapshot > sequenceSnapshot && request > revisionSnapshot);
  assert.ok(staleResponseGuard > request,
    'state revision must be rechecked after /api/me returns');
  assert.ok(applyResponse > staleResponseGuard,
    'a stale /api/me response must be rejected before applying its PlayerState');
  assert.ok(refresh.includes('} catch (e: any) {\n      // Do not let a late error from an older request clear a newer session or'));
  assert.ok(refresh.includes('if (!componentMountedRef.current) return;'));
  assert.ok(refresh.includes('if (refreshSequence !== refreshSequenceRef.current || revisionAtStart !== stateRevisionRef.current) return;'));
  assert.ok((refresh.match(/if \(!componentMountedRef\.current\) return;/g) ?? []).length >= 4,
    'each refresh phase should stop applying results after unmount');
  const catchIndex = refresh.indexOf('} catch (e: any) {');
  const catchGuard = refresh.indexOf('if (refreshSequence !== refreshSequenceRef.current || revisionAtStart !== stateRevisionRef.current) return;', catchIndex);
  const authReset = refresh.indexOf("if (e?.message === 'REDDIT_LOGIN_REQUIRED')", catchIndex);
  assert.ok(catchIndex >= 0 && catchGuard > catchIndex && authReset > catchGuard,
    'stale errors must be discarded before auth-reset handling');
  assert.ok((refresh.match(/if \(refreshSequence !== refreshSequenceRef\.current\) return;/g) ?? []).length >= 2,
    'admin and auxiliary bootstrap responses must each be sequence-fenced');
});

test('share route commits the share cooldown before posting and treats quest projection as best-effort', () => {
  const app = source('src/server/app.ts');
  const start = app.indexOf("app.post('/api/share'");
  const end = app.indexOf('\n  return app;', start);
  assert.ok(start >= 0 && end > start, 'share route must exist');
  const route = app.slice(start, end);
  const cooldownIndex = route.indexOf('await reserveShareCooldown(s)');
  const postIndex = route.indexOf('await reddit.submitCustomPost');
  const questIndex = route.indexOf('await recordShareQuestProgress(s)');
  assert.ok(cooldownIndex >= 0 && postIndex > cooldownIndex);
  assert.ok(questIndex > postIndex, 'quest projection follows the durable post');
  assert.match(route.slice(questIndex - 100, questIndex + 450), /try \{[\s\S]*?catch \(progressError\)/);
  assert.doesNotMatch(route, /await recordLeaderboard\(s\)/);
  assert.doesNotMatch(route, /await recordShareAction\(s\)/);
});


test('optional World Event conflicts cannot block primary player rewards', () => {
  const game = source('src/server/game.ts');
  const saveStart = game.indexOf('export async function save(');
  const saveEnd = game.indexOf('function serverRandom', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  const save = game.slice(saveStart, saveEnd);
  assert.match(save, /const extraWrites = allExtraWrites\.filter\(write => !write\.optional\)/);
  assert.match(save, /const optionalWrites = allExtraWrites\.filter\(write => write\.optional\)/);
  assert.match(save, /extraWrites\.splice\(index, 1\)/);
  assert.match(save, /if \(droppedConflictingProjection\) continue;/);
  assert.match(save, /void commitOptionalSaveProjection\(write\)\.catch\(error => \{/);
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
  assert.match(shared, /export const MAX_ORB_RARITY = Number\.MAX_VALUE/);
  assert.match(shared, /if \(isInfinity \|\| raw === Number\.POSITIVE_INFINITY\) return 'Infinity'/);
  assert.match(shared, /getOrbInfo\(rarity: number, isInfinity = false\)/);
  assert.doesNotMatch(shared, /Infinity: \['Infinity Orb'\]/);
  assert.match(shared, /return Math\.max\(2, Math\.min\(MAX_ORB_RARITY, Math\.floor\(rawRarity\)\)\)/);

  const game = source('src/server/game.ts');
  const applyStart = game.indexOf('export async function applyRolls');
  const applyEnd = game.indexOf('async function sendOfflineFullNotification', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const apply = game.slice(applyStart, applyEnd);
  assert.match(apply, /const rawCritRarity = isCrit \? Math\.round\(baseRarity \* effectiveCm\) : baseRarity/);
  assert.match(apply, /if \(isCrit && \(!Number\.isFinite\(rawCritRarity\) \|\| rawCritRarity > MAX_ORB_RARITY\)\) isInfinityOrb = true/);
  const claimStart = game.indexOf('export async function claimOrbFrenzy');
  const claimEnd = game.indexOf('function sampleBinomial', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = game.slice(claimStart, claimEnd);
  assert.match(claim, /const rawNormalCritRarity = Math\.round\(data\.rarity \* critMultiplier\(s\)\)/);
  assert.match(claim, /const rawSupernovaRarity = Math\.round\(data\.rarity \* critMultiplier\(s\) \* 5\)/);
  assert.match(claim, /isInfinity: baseIsInfinity/);
  assert.match(claim, /s\.collection\[group\.isInfinity \? 'Infinity' : String\(group\.rarity\)\]/);
  assert.match(apply, /effectiveCm = cm \* 5/);
  assert.match(shared, /effectiveCm = cm \* 5/);
  assert.doesNotMatch(game, /Math\.min\(1_000_000_000_000_000, Math\.round\((?:baseRarity|data\.rarity)/);
});


test('the rarity continuum can sample and display its full finite Infinity ceiling', () => {
  const shared = source('src/shared/game.ts');
  const game = source('src/server/game.ts');
  assert.match(shared, /export const MAX_ORB_RARITY = Number\.MAX_VALUE/);
  assert.match(shared, /return 'Infinity'/);
  assert.match(shared, /isInfinity: bestIsInfinity/);
  assert.doesNotMatch(shared, /Infinity: \['Infinity Orb'\]/);
  assert.match(game, /function serverRarityRandom\(\): number/);
  assert.match(game, /new Uint32Array\(34\)/);
  assert.match(game, /bitLength - 1088/);
  assert.match(game, /rollContinuum\(effectiveLuck, randomOverride \?\? serverRarityRandom\)/);
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
  assert.match(game, /activeCosmetic: 'default'/);
  assert.match(game, /unlockedCosmetics: \['default'\]/);
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
  const sharedReadsIndex = applyRolls.indexOf('const [freshGlobalBoosters, worldEvent, fakeCcuBonus, combatStateRaw] = await Promise.all([');
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
  const end = game.indexOf('\nexport async function ', start + 1);
  assert.ok(start >= 0 && end > start, 'claimOrbFrenzy function must exist');
  const frenzy = game.slice(start, end);

  const countIndex = frenzy.indexOf('const count = frenzyClaimCountForRarity(');
  const guardIndex = frenzy.indexOf('Frenzy roll counter would exceed the safe integer range');
  const critIndex = frenzy.indexOf('const critChance =');
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

  const pollStart = main.indexOf('const refreshGlobalBoosters = async () =>');
  const pollEnd = main.indexOf('}, [tab, splashEntered]);', pollStart);
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
    /offlineRolls:\s*Math\.min\(\s*MAX_OFFLINE_ROLLS,\s*finiteNonNegativeInteger\(record\.offlineRolls, 0\),?\s*\)/,
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
  const sharedReadsIndex = apply.indexOf('const [freshGlobalBoosters, worldEvent, fakeCcuBonus, combatStateRaw] = await Promise.all([');
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

test('Guild task rollover consumes multi-tier overflow and persists combo-expiry resets', () => {
  const social = source('src/server/social.ts');
  const loadStart = social.indexOf('async function loadGuilds(): Promise<Guild[]>');
  const loadEnd = social.indexOf('\n}\n', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const load = social.slice(loadStart, loadEnd);
  assert.match(social, /while \(task\.progress >= task\.target && completions < 1000\)/);
  assert.match(social, /replacement\.progress = Math\.min\(Number\.MAX_SAFE_INTEGER, overflow\)/);
  assert.match(load, /const rawGuilds = parseGuildListRaw\(raw\)/);
  assert.match(load, /const storedComboExpired = rawGuilds\.some\(g =>/);
  assert.match(load, /const latestExpired = latestRawGuilds\.some\(g =>/);
  assert.match(load, /await txn\.set\(GUILDS_KEY, JSON\.stringify\(latest\)\)/);
});

test('rapid upgrades are shown optimistically but purchased in a server-verified batch', () => {
  const game = source('src/server/game.ts');
  const app = source('src/server/app.ts');
  const client = source('src/client/main.tsx');
  const start = game.indexOf('export async function buyUpgradeBatch');
  const end = game.indexOf('\nexport function autoBuyCheapest', start);
  assert.ok(start >= 0 && end > start);
  const batch = game.slice(start, end);
  assert.match(batch, /withPlayerMutationLock/);
  assert.match(batch, /upgradeCost\(id, level\)/);
  assert.match(batch, /if \(s\.coins < cost\) \{[\s\S]*?stoppedReason = `Need \$\{cost\.toLocaleString\(\)\} Coins for \$\{id\}\.`;[\s\S]*?break;/);
  assert.match(batch, /await save\(s\)/);
  assert.match(app, /app\.post\('\/api\/upgrade\/batch'/);
  assert.match(client, /upgradeBatchQueueRef\.current\.push\(id\)/);
  assert.match(client, /setState\(nextState\)/);
  assert.match(client, /'\/api\/upgrade\/batch'/);
});

test('one Free Roll click submits all stored Free Rolls while rewards remain server-authoritative', () => {
  const game = source('src/server/game.ts');
  const app = source('src/server/app.ts');
  const client = source('src/client/main.tsx');
  assert.match(game, /useAllFreeRolls = false/);
  assert.match(game, /useAllFreeRolls \? availableFreeRolls : 1/);
  assert.match(game, /while \(remainingActivations > 0\)/);
  assert.match(game, /if \(usingFreeRoll\) s\.freeRolls = availableFreeRolls - freeRollActivations/);
  assert.match(app, /req\.body\?\.useAllFreeRolls === true/);
  assert.match(client, /useAllFreeRolls: !isAutoRoll &&/);
  assert.match(client, /currentState\.chainPatcherNextRarity \?\? 0/);
  assert.match(client, /\(currentState\.freeRolls \?\? 0\) > 0/);
});

test('Cosmic Reserve is a multiplicative per-unspent-Dust Luck layer and Offline Rate stops at level 8', () => {
  const shared = source('src/shared/game.ts');
  const upgradesUi = source('src/client/components/UpgradesSection.tsx');
  const prestigeUi = source('src/client/components/ProfileAndPrestige.tsx');
  assert.match(shared, /cosmicReserve:\s*\{[\s\S]*?maxLevel: 5/);
  assert.match(shared, /cosmicReserveMultiplier = 1 \+ unspentCosmicDust \* cosmicReserveLevel \* 0\.01/);
  assert.match(shared, /baseLuck \* prestigeMultiplier \* totalAltarMultiplier \* cosmicReserveMultiplier/);
  assert.match(shared, /id === 'offlineRate' && level >= 8\) return Infinity/);
  assert.match(upgradesUi, /offlineRate: 8/);
  assert.match(prestigeUi, /case 'cosmicReserve'/);
});

test('Global Chat badge counts unread arrivals and displays the server-verified admin badge', () => {
  const chat = source('src/client/components/GlobalChatWindow.tsx');
  const social = source('src/server/social.ts');
  assert.match(chat, /const \[unreadCount, setUnreadCount\] = useState\(0\)/);
  assert.match(chat, /setUnreadCount\(0\)/);
  assert.match(chat, /if \(open\) \{[\s\S]*?markMessagesSeen\(visible\)/);
  assert.match(chat, /const unread = visible\.filter\(message => !seenMessageIdsRef\.current\.has\(message\.id\)\)/);
  assert.match(chat, /setUnreadCount\(unread\.length\)/);
  assert.match(chat, /message\.isAdmin === true/);
  assert.match(chat, />ADMIN<\/span>/);
  assert.match(social, /isAdmin: isAdminUsername\(message\.username\)/);
  assert.match(social, /isAdmin: isAdminUsername\(username\(\)\)/);
  assert.match(social, /currentDryStreak: Math\.max\(0, Number\(save\.rollsSinceBest/);
});

test('Aftershock and Unbroken Momentum are unlocked through their purchase menus and documented', () => {
  const shared = source('src/shared/game.ts');
  assert.match(shared, /aftershock: \{[\s\S]*?name: 'Aftershock'[\s\S]*?maxLevel: 1/);
  assert.match(shared, /unbrokenMomentum: \{[\s\S]*?name: 'Unbroken Momentum'[\s\S]*?maxLevel: 1/);

  const mastery = source('src/client/components/MasterySection.tsx');
  assert.match(mastery, /Best Aftershock record/);
  assert.match(mastery, /aftershockCriticalLuckBonus/);
  assert.match(mastery, /After next level/);

  const prestige = source('src/client/components/ProfileAndPrestige.tsx');
  assert.match(prestige, /id === 'unbrokenMomentum'/);
  assert.match(prestige, /Speed bonus after purchase/);
  assert.doesNotMatch(prestige, /Aftershock Record|Unbroken Momentum\s*<\/span>/);

  const changelog = source('src/client/components/ChangelogModal.tsx');
  assert.match(changelog, /Mastery Engine has been removed for balancing purposes/);
  assert.match(changelog, /Chain Patcher/);
  assert.match(changelog, /Bug Fixes & Improvements/);
});



test('Combat is level-gated, guided, and reset with the rest of the player save', () => {
  const shared = source('src/shared/game.ts');
  const main = source('src/client/main.tsx');
  const header = source('src/client/components/Header.tsx');
  const debug = source('src/server/debug.ts');
  const combat = source('src/client/components/CombatSection.tsx');
  assert.match(shared, /combat: 8/);
  assert.match(main, /Buy Auto Roll there/);
  assert.ok(main.includes('COMBAT UNLOCKED · LEVEL {FEATURE_UNLOCK_LEVELS.combat}'));
  assert.ok(main.includes("changeTab('runes')"));
  assert.ok(!main.includes('import { RunesSection } from'));
  assert.ok(combat.includes("if(page==='runes')return <RunesSection/>"));
  assert.ok(header.includes('!combatMode &&'));
  assert.ok(header.includes('combatMode &&'));
  assert.ok(debug.includes('const combatStateKey = `infinity-orbs:combat:${userId}`'));
  assert.ok(debug.includes('redis.watch(generationKey, playerKey, combatStateKey)'));
  assert.ok(debug.includes('await txn.del(combatStateKey)'));
  assert.ok(combat.includes('window.innerHeight-376'));
  assert.ok(combat.includes("maxHeight:'min(360px, calc(100vh - 16px))'"));
});

test('Global Chat comment ingestion rejects a canonical destination that is a Frenzy post', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function recordGlobalChatComment');
  const end = social.indexOf('export async function', start + 1);
  assert.ok(start >= 0 && end > start);
  const handler = social.slice(start, end);
  assert.ok(handler.includes('if (await isRegisteredFrenzyPost(registeredPostId)) return null;'));
  assert.ok(handler.indexOf('targetPostId !== registeredPostId') < handler.indexOf('isRegisteredFrenzyPost(registeredPostId)'));
});

test('Global Chat history is server-gated to the registered main Game post', () => {
  const api = source('src/server/app.ts');
  const start = api.indexOf("app.get('/api/chat', async (_req, res) => {");
  const end = api.indexOf("app.post('/api/chat',", start);
  assert.ok(start >= 0 && end > start);
  const route = api.slice(start, end);
  assert.ok(route.includes('const status = await getGlobalChatStatus();'));
  assert.ok(route.includes('if (!status.enabled)'));
  assert.ok(route.includes('res.status(403).json'));
  assert.ok(route.indexOf('if (!status.enabled)') < route.indexOf('res.json(await getGlobalChat())'));
});

test('Global Chat destination cannot be inferred from a client-supplied launcher flag', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('async function resolveGlobalGamePostId');
  const statusStart = social.indexOf('export async function getGlobalChatStatus');
  const end = social.indexOf('export async function recordGlobalChatComment', statusStart);
  assert.ok(start >= 0 && statusStart > start && end > statusStart);
  const resolver = social.slice(start, social.indexOf('\n}', start) + 2);
  const status = social.slice(statusStart, end);
  assert.match(resolver, /if \(!saved\)/);
  assert.match(resolver, /isRegisteredFrenzyPost\(saved\)/);
  assert.doesNotMatch(resolver, /context\.postId/);
  assert.doesNotMatch(status, /fromMainLauncher|fromFrenzyPost/);
  assert.match(social, /async function isRegisteredFrenzyPost\(postId: string\)/);

  const app = source('src/server/app.ts');
  const routeStart = app.indexOf("app.get('/api/chat/status'");
  const routeEnd = app.indexOf("app.get('/api/chat'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.doesNotMatch(app.slice(routeStart, routeEnd), /req\.query\.launcher/);
  assert.match(app.slice(routeStart, routeEnd), /getGlobalChatStatus\(\)/);

  const createStart = app.indexOf("app.post('/internal/menu/post-create'");
  const installStart = app.indexOf("app.post('/internal/on-app-install'");
  assert.ok(createStart >= 0 && installStart > createStart);
  const creationRoutes = app.slice(createStart, app.indexOf("app.get('/api/notifications'", installStart));
  assert.equal((creationRoutes.match(/redis\.set\('io:global-game-post-id', post\.id\)/g) ?? []).length, 2);
  assert.doesNotMatch(creationRoutes, /global-game-post-id', post\.id, \{ nx: true \}/);
});

test('legacy guild contribution does not double-count each task update', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function contribute(');
  const end = social.indexOf('export async function prepareGuildRollEffects', start);
  assert.ok(start >= 0 && end > start);
  const contribution = social.slice(start, end);
  for (const field of [
    'task.progress = capSafeGuildCounter(task.progress + taskProgressValue)',
    'task.progress = capSafeGuildCounter(task.progress + taskProgressRolls)',
    'task.progress = capSafeGuildCounter(task.progress + taskProgressRare)',
  ]) {
    assert.equal(contribution.split(field).length - 1, 1, field + ' should be applied once');
  }
});


test('API responses default to non-cacheable because they depend on viewer or Reddit context', () => {
  const app = source('src/server/app.ts');
  assert.match(app, /app\.use\('\/api',[\s\S]{0,300}Cache-Control', 'no-store'/);
  assert.match(app, /app\.get\('\/api\/me'/);
  assert.match(app, /app\.get\('\/api\/collection'/);
  assert.match(app, /app\.get\('\/api\/chat\/status'/);
});


test('distributed player lock fencing tokens use 128 bits of cryptographic randomness', () => {
  const lock = source('src/server/player-lock.ts');
  assert.match(lock, /function randomLockToken\(\): string/);
  assert.match(lock, /new Uint8Array\(16\)/);
  assert.match(lock, /globalThis\.crypto\.getRandomValues\(sample\)/);
  assert.match(lock, /const token = 'lock-' \+ randomLockToken\(\)/);
  assert.doesNotMatch(lock, /randomUint32\(\)/);
});


test('Combat snapshot polling only mutates the save when core-game projection changed', () => {
  const combat = source('src/server/combat.ts');
  const start = combat.indexOf('export async function getCombatSnapshot()');
  const end = combat.indexOf('\nfunction grantXp', start);
  assert.ok(start >= 0 && end > start);
  const snapshot = combat.slice(start, end);
  assert.match(snapshot, /const current=normalizeState\(await redis\.get\(combatKey\(\)\)\)/);
  assert.match(snapshot, /const projectionChanged=/);
  assert.match(snapshot, /if\(projectionChanged\)\{\s*state=await mutate/);
  assert.doesNotMatch(snapshot, /const state=await mutate\(s=>/);
});


test('Social cooldowns and report reservations use cryptographic, collision-resistant tokens', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /function secureSocialToken\(prefix: string\): string/);
  assert.match(social, /new Uint8Array\(16\)/);
  assert.match(social, /globalThis\.crypto\.getRandomValues\(bytes\)/);
  const cooldownStart = social.indexOf('async function enforceChatCooldown');
  const cooldownEnd = social.indexOf('\nasync function ', cooldownStart + 10);
  assert.ok(cooldownStart >= 0 && cooldownEnd > cooldownStart);
  assert.match(social.slice(cooldownStart, cooldownEnd), /secureSocialToken\('chat'\)/);
  const reportStart = social.indexOf('async function submitChatReport');
  const reportEnd = social.indexOf('\nexport async function ', reportStart);
  assert.ok(reportStart >= 0 && reportEnd > reportStart);
  assert.match(social.slice(reportStart, reportEnd), /secureSocialToken\('report'\)/);
  assert.doesNotMatch(social, /Math\.random\(\)/);
});


test('core idempotency reservations never fall back to Math.random tokens', () => {
  const game = source('src/server/game.ts');
  assert.match(game, /function secureServerToken\(prefix: string\): string/);
  assert.match(game, /new Uint8Array\(16\)/);
  assert.match(game, /globalThis\.crypto\.getRandomValues\(bytes\)/);
  assert.match(game, /secureServerToken\('offline-notification'\)/);
  assert.match(game, /secureServerToken\('offline-job'\)/);
  assert.match(game, /secureServerToken\('follow-reward'\)/);
  assert.match(game, /secureServerToken\('frenzy-thank-you'\)/);
  assert.doesNotMatch(game, /Math\.random\(\)/);
});


test('read-only Collection and admin mechanics endpoints do not register active presence', () => {
  const game = source('src/server/game.ts');
  const collectionStart = game.indexOf('export async function getCollectionPage(');
  const collectionEnd = game.indexOf('export async function getState(', collectionStart);
  assert.ok(collectionStart >= 0 && collectionEnd > collectionStart);
  assert.match(game.slice(collectionStart, collectionEnd), /loadRaw\(\{ registerActivity: false \}\)/);

  const debug = source('src/server/debug.ts');
  const mechanicsStart = debug.indexOf("debugRouter.get('/mechanics'");
  const mechanicsEnd = debug.indexOf("debugRouter.post('/currency'", mechanicsStart);
  assert.ok(mechanicsStart >= 0 && mechanicsEnd > mechanicsStart);
  assert.match(debug.slice(mechanicsStart, mechanicsEnd), /loadRaw\(\{ registerActivity: false \}\)/);
});

test('passive player snapshots and the Play splash do not register active sessions', () => {
  const game = source('src/server/game.ts');
  const stateStart = game.indexOf('export async function getState(');
  const meStart = game.indexOf('export async function getMe()', stateStart);
  const offlineStart = game.indexOf('export async function checkOffline()', meStart);
  assert.ok(stateStart >= 0 && meStart > stateStart && offlineStart > meStart);
  const getState = game.slice(stateStart, meStart);
  const getMe = game.slice(meStart, offlineStart);

  assert.match(getState, /loadRaw\(\{ registerActivity: options\.registerActivity \}\)/);
  assert.match(getState, /options\.registerActivity === false[\s\S]*?await getOnlinePlayers\(\)[\s\S]*?: await touchOnlinePresence\(\)/);
  assert.match(getMe, /loadRaw\(\{ registerActivity: false \}\)/);
  assert.match(getMe, /getState\(\{ registerActivity: false \}\)/);

  const combat = source('src/server/combat.ts');
  const snapshotStart = combat.indexOf('export async function getCombatSnapshot()');
  const snapshotEnd = combat.indexOf('\nfunction grantXp', snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart);
  assert.match(combat.slice(snapshotStart, snapshotEnd), /loadRaw\(\{ registerActivity: false \}\)/);

  const api = source('src/server/app.ts');
  const featureStart = api.indexOf('const feature = featureForPath(req.path);');
  const featureEnd = api.indexOf('// Game bans are enforced server-side.', featureStart);
  assert.ok(featureStart >= 0 && featureEnd > featureStart);
  assert.match(api.slice(featureStart, featureEnd), /loadRaw\(\{ registerActivity: false \}\)/);

  const client = source('src/client/main.tsx');
  const heartbeatStart = client.indexOf('const heartbeat = () =>');
  const heartbeatEnd = client.indexOf('}, [Boolean(state), splashEntered]);', heartbeatStart);
  assert.ok(heartbeatStart >= 0 && heartbeatEnd > heartbeatStart, 'heartbeat effect must restart when Play is entered');
  const heartbeat = client.slice(heartbeatStart, heartbeatEnd);
  assert.match(client.slice(client.lastIndexOf('useEffect(() =>', heartbeatStart), heartbeatStart), /if \(!state \|\| !splashEntered\) return;/);
  assert.match(heartbeat, /if \(!splashEntered \|\| document\.visibilityState === 'hidden'\) return;/);

  // Saved Auto Roll and resource prefetches must also wait for explicit entry.
  assert.match(client, /if \(!splashEntered \|\| !stateRef\.current\) return;/);
  assert.match(client, /if \(isAutoRoll && !splashEntered\) return;/);
  assert.match(client, /if \(!splashEntered \|\| !autoRoll \|\| !state \|\| state\.upgrades\.auto === 0\) return;/);

  const promptStart = client.lastIndexOf('useEffect(() =>', client.indexOf('const checkPrompt = () =>'));
  const promptEnd = client.indexOf('}, [splashEntered]);', promptStart);
  assert.ok(promptStart >= 0 && promptEnd > promptStart, 'daily Frenzy prompt delay must start after Play');
  assert.match(client.slice(promptStart, promptEnd), /if \(!splashEntered\) return;/);
});


test('request coordination and feedback cooldowns use cryptographic tokens', () => {
  const app = source('src/server/app.ts');
  const helperStart = app.indexOf('const secureRequestToken = (): string => {');
  const parseStart = app.indexOf('const parseMutationLock', helperStart);
  assert.ok(helperStart >= 0 && parseStart > helperStart, 'shared request token helper must exist');
  const coordination = app.slice(helperStart, parseStart);
  assert.match(coordination, /new Uint8Array\(16\)/);
  assert.match(coordination, /globalThis\.crypto\.getRandomValues\(bytes\)/);
  assert.match(coordination, /const mutationLockOwner = \(\): string => 'lease-' \+ secureRequestToken\(\);/);
  assert.match(app, /const feedbackCooldownToken = secureRequestToken\(\);/);
  assert.doesNotMatch(app, /Math\.random\(\)/);
});


test('background refreshes are deferred until Play and refresh promptly on entry', () => {
  const client = source('src/client/main.tsx');

  const boosterStart = client.indexOf('const pollAnnouncement = async () =>');
  const boosterEffectStart = client.lastIndexOf('useEffect(() => {', boosterStart);
  const boosterEffectEnd = client.indexOf('}, [splashEntered]);', boosterStart);
  assert.ok(boosterEffectStart >= 0 && boosterEffectEnd > boosterStart);
  assert.match(client.slice(boosterEffectStart, boosterStart), /if \(!splashEntered\) return;/);

  const developerStart = client.indexOf('const pollDeveloperAnnouncement = async () =>');
  const developerEffectStart = client.lastIndexOf('useEffect(() => {', developerStart);
  assert.match(client.slice(developerEffectStart, developerStart), /if \(!splashEntered\) return;/);

  const versionStart = client.indexOf('const checkForUpdate = async () =>');
  const versionEffectStart = client.lastIndexOf('useEffect(() => {', versionStart);
  assert.match(client.slice(versionEffectStart, versionStart), /if \(!splashEntered\) return;/);

  const communityStart = client.indexOf('const refreshCommunityState = async () =>');
  const communityEffectStart = client.lastIndexOf('useEffect(() => {', communityStart);
  const communityEffectEnd = client.indexOf('}, [tab, splashEntered]);', communityStart);
  assert.ok(communityEffectStart >= 0 && communityEffectEnd > communityStart);
  const communityEffect = client.slice(communityEffectStart, communityEffectEnd);
  assert.match(communityEffect, /if \(!splashEntered\) return;/);
  assert.match(communityEffect, /void refreshCommunityState\(\);/);
  assert.match(communityEffect, /if \(inFlight\) return;/);

  const presenceStart = client.indexOf('const refreshPresence = async () =>');
  const presenceEffectStart = client.lastIndexOf('useEffect(() => {', presenceStart);
  const presenceEffectEnd = client.indexOf('}, [splashEntered]);', presenceStart);
  assert.ok(presenceEffectStart >= 0 && presenceEffectEnd > presenceStart);
  assert.match(client.slice(presenceEffectStart, presenceEffectEnd), /void refreshPresence\(\);/);
  assert.match(client.slice(presenceEffectStart, presenceEffectEnd), /if \(inFlight \|\| document\.visibilityState === 'hidden'\) return;/);
});

test('rolling disables both roll affordances and gives the orb keyboard semantics', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /if \(busy\) return;[\s\S]{0,120}if \(canRoll\)/);
  assert.match(roll, /<button[\s\S]{0,250}disabled=\{busy\}[\s\S]{0,250}aria-busy=\{busy\}/);
  assert.match(roll, /aria-label=\{busy \? 'Rolling orbs'/);
  assert.match(roll, /const primaryActionLabel = busy[\s\S]*?\? 'ROLL IN PROGRESS'/);
  assert.match(roll, /className=\{'roll-button ' \+ \(busy \? 'is-waiting'/);
  const css = source('src/client/styles.css');
  assert.match(css, /\.roll-button:hover:disabled \{[^}]*transform: none !important;[^}]*cursor: wait !important;/);
});


test('passive splash loads only the save before deferring auxiliary bootstrap requests', () => {
  const client = source('src/client/main.tsx');
  const appInfoFetch = client.indexOf("void getJson<{ isBeta: boolean }>('/api/app-info')");
  const appInfoEffectStart = client.lastIndexOf('useEffect(() => {', appInfoFetch);
  assert.ok(appInfoFetch > 0 && appInfoEffectStart >= 0);
  assert.match(client.slice(appInfoEffectStart, appInfoFetch), /if \(!splashEntered\) return;/);

  const refreshStart = client.indexOf('const refreshAll = useCallback(async () =>');
  const adminStart = client.indexOf("const adminStatus = await getJson<{ isAdmin: boolean }>", refreshStart);
  const deferStart = client.indexOf('if (!splashEntered) return;', refreshStart);
  const dependencyEnd = client.indexOf('}, [applyPlayerState, splashEntered]);', refreshStart);
  assert.ok(refreshStart >= 0 && adminStart > refreshStart && deferStart > refreshStart);
  assert.ok(deferStart < adminStart, 'auxiliary APIs should not run while only the splash is visible');
  assert.ok(dependencyEnd > deferStart, 'refreshAll must rerun when Play changes splashEntered');

  const tutorialFetch = client.indexOf("getJsonWithTimeout<{ seen?: boolean }>('/api/combat/tutorial/status'");
  const tutorialEffectStart = client.lastIndexOf('useEffect(() => {', tutorialFetch);
  assert.ok(tutorialEffectStart >= 0 && tutorialFetch > tutorialEffectStart);
  assert.match(client.slice(tutorialEffectStart, tutorialFetch), /if \(!splashEntered \|\| !state\) return;/);
});


test('roll interactions explain current state and animate server resolution without breaking reduced motion', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.ok(roll.includes('const cooldownProgress = busy || canRoll'));
  assert.ok(roll.includes(': cd > 0'));
  assert.ok(roll.includes('const actionHint = busy'));
  assert.ok(roll.includes('Resolving your roll'));
  assert.ok(roll.includes('One press uses all'));
  assert.ok(roll.includes('id="roll-action-hint"'));
  assert.ok(roll.includes('<Loader2 className="w-5 h-5 animate-spin"'));
  assert.ok(roll.includes('aria-describedby="roll-action-hint"'));
  assert.ok(roll.includes('Personal best'));

  const css = source('src/client/styles.css');
  assert.ok(css.includes('.roll-action-hint {'));
  assert.ok(css.includes('.roll-stage.is-rolling::after'));
  assert.ok(css.includes('@keyframes io-roll-resolve-ring'));
  assert.ok(css.includes('.roll-stage.is-rolling::after, .roll-stage.is-rolling > .absolute.w-64 { animation: none !important; }'));
});

test('header experience progress and icon-only actions have keyboard/screen-reader labels', () => {
  const header = source('src/client/components/Header.tsx');
  assert.ok(header.includes('aria-label={`Open profile. Experience progress'));
  assert.ok(header.includes('focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300'));
  assert.ok(header.includes("!event.repeat && (event.key === 'Enter' || event.key === ' ')"));
  assert.ok(header.includes('aria-label="View probability and drop odds"'));
  assert.ok(header.includes('aria-label="Report a bug or suggest an improvement"'));
  assert.ok(header.includes('aria-label="Open admin console"'));
  assert.ok(header.includes("aria-label={notificationsEnabled ? 'Disable Reddit notifications' : 'Enable Reddit notifications'}"));
  assert.ok(header.includes("aria-label={soundEnabled ? 'Mute sound' : 'Enable sound'}"));
});

test('best-orb reveal badges reflect critical and discovery flags from the selected orb', () => {
  const server = source('src/server/game.ts');
  assert.ok(server.includes('let bestIsCrit = false;'));
  assert.ok(server.includes('let bestIsNew = false;'));
  assert.ok(server.includes('bestIsCrit = isCrit;'));
  assert.ok(server.includes('bestIsNew = isNew;'));
  assert.ok(server.includes('isNew: bestIsNew,'));
  assert.ok(server.includes('isCrit: bestIsCrit,'));

  const shared = source('src/shared/game.ts');
  assert.ok(shared.includes('let bestIsCrit = false;'));
  assert.ok(shared.includes('isCrit: bestIsCrit,'));
  assert.ok(!shared.includes('isCrit: bestRarity > (sourceState.highestRarity ?? 0),'));
});

test('combined Altar submit button has a closed disabled expression', () => {
  const combined = source('src/client/components/AltarAndMasterySection.tsx');
  assert.ok(combined.includes('disabled={sacrificing || busy || (selectedCoinOffer <= 0 && selectedShardOffer <= 0) || state.coins < selectedCoinOffer || (state.shards ?? 0) < selectedShardOffer}'));
  assert.ok(!combined.includes('state.shards ?? 0) < selectedShardOffer>'));
});

test('combined Altar offering choices expose selection and local Mastery pending state', () => {
  const combined = source('src/client/components/AltarAndMasterySection.tsx');
  assert.ok((combined.match(/aria-pressed=\{selectedCoinOffer === amt\}/g) ?? []).length === 1);
  assert.ok(combined.includes('aria-pressed={selectedCoinOffer === state.coins}'));
  assert.ok(combined.includes('aria-pressed={selectedShardOffer === amt}'));
  assert.ok(combined.includes('aria-pressed={selectedShardOffer === state.shards}'));
  assert.ok(combined.includes('const [upgradingSkillId, setUpgradingSkillId] = useState<MasterySkillId | null>(null);'));
  assert.ok(combined.includes('aria-busy={busy || sacrificing || upgradingSkillId === skillId}'));
  assert.ok(combined.includes('disabled={!canAfford || busy || isMax || sacrificing || upgradingSkillId !== null}'));
});

test('UI-only action buttons declare type=button to avoid accidental form submissions', () => {
  const main = source('src/client/main.tsx');
  assert.match(main, /<button\s+type="button"\s+onClick=\{\(\) => setShowDevModal\(true\)\}/);
  assert.match(main, /<button\s+type="button"\s+aria-current=\{tab === 'fight'/);
  const admin = source('src/client/components/DevDebugModal.tsx');
  assert.match(admin, /<button\s+type="button"\s+title="Jump to aggregate Impressions analytics\."/);
  assert.match(admin, /<button\s+type="button"\s+title="Close the admin console\."/);
  assert.match(admin, /<button\s+type="button"\s+title="Delete all stored payment traces\."/);
  const upgrades = source('src/client/components/UpgradesSection.tsx');
  assert.ok(upgrades.includes('<button\n              type="button"\n              onClick={handleUpgradeAllClick}'));
  assert.ok(upgrades.includes('<button\n                    type="button"\n                    disabled\n                    className="w-full bg-slate-950'));
  assert.ok(upgrades.includes('<button\n                    type="button"\n                    disabled\n                    title="This upgrade has reached its maximum level."'));

  const profile = source('src/client/components/ProfileAndPrestige.tsx');
  assert.ok(profile.includes('<button\n                  type="button"\n                  onClick={() => {\n                    sound.playClick();\n                    void onBuyPrestigeUpgrade(id);'));
  assert.doesNotMatch(profile, /onBuyCosmetic|Cosmetics & Customization/);

  const rarity = source('src/client/components/RarityTableModal.tsx');
  assert.equal((rarity.match(/<button\s+type="button"\s+onClick=\{onClose\}/g) ?? []).length, 2);

  const best = source('src/client/components/NewBestModal.tsx');
  assert.equal((best.match(/<button\s+type="button"\s+onClick=\{onClose\}/g) ?? []).length, 2);
  assert.ok(best.includes('<button\n            type="button"\n            onClick={() => {\n              onClose();\n              onOpenShareModal(orb.rarity, orb.isInfinity);'));
});

test('Mastery upgrade disabled expression closes before the next JSX attribute', () => {
  const mastery = source('src/client/components/MasterySection.tsx');
  assert.ok(mastery.includes('disabled={!canAfford || busy || isMax || upgradingSkillId !== null}'));
  assert.ok(!mastery.includes('disabled={!canAfford || busy || isMax || upgradingSkillId !== null>'));
});

test('upgrade and mastery controls use existing local pending state for busy semantics', () => {
  const upgrades = source('src/client/components/UpgradesSection.tsx');
  assert.ok(!upgrades.includes('pendingUpgradeId'));
  assert.ok(upgrades.includes('aria-busy={upgradingId === u.id}'));
  const mastery = source('src/client/components/MasterySection.tsx');
  assert.ok(mastery.includes('aria-busy={busy || upgradingSkillId === skillId}'));
  const combined = source('src/client/components/AltarAndMasterySection.tsx');
  assert.ok(combined.includes('aria-busy={sacrificing || busy}'));
});

test('Mastery and Altar success effects wait for confirmed server results', () => {
  const client = source('src/client/main.tsx');
  const masteryHandlerStart = client.indexOf('const handleUpgradeMastery = async (skillId: MasterySkillId) =>');
  const masteryHandlerEnd = client.indexOf('// Daily Streak', masteryHandlerStart);
  const mainMastery = client.slice(masteryHandlerStart, masteryHandlerEnd);
  assert.ok(masteryHandlerStart >= 0 && masteryHandlerEnd > masteryHandlerStart);
  assert.ok(mainMastery.includes('rollback?.();\n      throw e;'));
  assert.ok(!mainMastery.includes("showToast(e.message || 'Mastery upgrade failed'"));

  const mastery = source('src/client/components/MasterySection.tsx');
  const masteryClickStart = mastery.indexOf('const handleMasteryClick = async (skillId: MasterySkillId) =>');
  const masteryClickEnd = mastery.indexOf('const masterySkillsList', masteryClickStart);
  const masteryClick = mastery.slice(masteryClickStart, masteryClickEnd);
  assert.ok(masteryClick.indexOf('await onUpgradeMastery(skillId)') < masteryClick.indexOf('sound.playLevelUpFanfare()'));

  const altar = source('src/client/components/AltarSection.tsx');
  const altarStart = altar.indexOf('const handleSacrificeSubmit = async (e: React.FormEvent) =>');
  const altarEnd = altar.indexOf('return (', altarStart);
  assert.ok(altar.slice(altarStart, altarEnd).indexOf('await onSacrifice(selectedCoinOffer, selectedShardOffer)') < altar.slice(altarStart, altarEnd).indexOf('sound.playSacrificeSound()'));

  const combined = source('src/client/components/AltarAndMasterySection.tsx');
  const combinedMasteryStart = combined.indexOf('const handleMasteryClick = async (skillId: MasterySkillId) =>');
  const combinedMasteryEnd = combined.indexOf('const masterySkillsList', combinedMasteryStart);
  const combinedMastery = combined.slice(combinedMasteryStart, combinedMasteryEnd);
  assert.ok(combinedMastery.indexOf('await onUpgradeMastery(skillId)') < combinedMastery.indexOf('sound.playLevelUpFanfare()'));
});

test('combined Mastery Cosmos filter includes every Cosmos-branch skill', () => {
  const mastery = source('src/client/components/MasterySection.tsx');
  const combined = source('src/client/components/AltarAndMasterySection.tsx');
  for (const skill of ['critMastery', 'celestialSurge', 'cosmicAttunement', 'celestialVolley', 'aftershock']) {
    assert.ok(mastery.includes("id === '" + skill + "'"));
    assert.ok(combined.includes("id === '" + skill + "'"));
  }
});

test('Mastery branch filters are named groups with pressed-state buttons', () => {
  for (const path of ['src/client/components/MasterySection.tsx', 'src/client/components/AltarAndMasterySection.tsx']) {
    const content = source(path);
    assert.ok(content.includes('role="group" aria-label="Filter Mastery skills by branch"'));
    assert.ok(content.includes('aria-pressed={activeBranch === b.id}'));
  }
});

test('Mastery branch filters expose their selected state to assistive technology', () => {
  const mastery = source('src/client/components/MasterySection.tsx');
  const combined = source('src/client/components/AltarAndMasterySection.tsx');
  assert.ok(mastery.includes('aria-pressed={activeBranch === b.id}'));
  assert.ok(combined.includes('aria-pressed={activeBranch === b.id}'));
  assert.ok((mastery.match(/type="button"\s+aria-pressed=\{activeBranch === b\.id\}/g) ?? []).length === 1);
  assert.ok((combined.match(/type="button"\s+aria-pressed=\{activeBranch === b\.id\}/g) ?? []).length === 1);
});

test('Altar descriptions match the implemented multiplicative bonus rates', () => {
  const altar = source('src/client/components/AltarSection.tsx');
  const combined = source('src/client/components/AltarAndMasterySection.tsx');
  assert.ok(altar.includes('base +2% multiplicative luck per shard'));
  assert.ok(altar.includes('Each adds base +2% multiplicative luck before Altar Resonator/level bonuses'));
  assert.ok(!altar.includes('+3% permanent multiplicative luck'));
  assert.ok(!altar.includes('+3% multiplicative luck per shard'));
  assert.ok(combined.includes('each rank compounds Coin Devotion by 1.05×'));
  assert.ok(combined.includes('base +2% permanent luck each'));
  assert.ok(!combined.includes('Altar Devotion Luck (+1% per Level)'));
});

test('Altar range controls have explicit labels connected to their inputs', () => {
  const altar = source('src/client/components/AltarSection.tsx');
  assert.ok(altar.includes('<label htmlFor="altar-coin-offer"'));
  assert.ok(altar.includes('<input\n              id="altar-coin-offer"'));
  assert.ok(altar.includes('<label htmlFor="altar-shard-offer"'));
  assert.ok(altar.includes('<input\n              id="altar-shard-offer"'));
});

test('Turbo banner matches the active cooldown reduction and roll timer cleanup is unique', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.ok(roll.includes('const turboReductionPercent = (state.prestigeUpgrades?.chronoOverdrive ?? 0) > 0 ? 35 : 25;'));
  assert.ok(roll.includes('TURBO ACTIVE (-{turboReductionPercent}% Cooldown)'));
  assert.ok(!roll.includes('TURBO ACTIVE (-20% Cooldown)'));
  const cleanup = 'useEffect(() => () => {\n    if (cooldownNoticeTimerRef.current !== null) window.clearTimeout(cooldownNoticeTimerRef.current);\n  }, []);';
  assert.equal(roll.split(cleanup).length - 1, 1);

  const client = source('src/client/main.tsx');
  const guardStart = client.indexOf('const refreshGlobalBoosters = async () =>');
  const guardEnd = client.indexOf('inFlight = true;', guardStart);
  assert.ok(guardStart >= 0 && guardEnd > guardStart);
  assert.equal((client.slice(guardStart, guardEnd).match(/if \(.*document\.visibilityState === 'hidden'\).*return;/g) ?? []).length, 1);
});

test('Turbo Booster confirmation reports the actual cooldown reduction', () => {
  const client = source('src/client/main.tsx');
  const shared = source('src/shared/game.ts');
  assert.ok(client.includes('const turboReductionPercent = durationMinutes === 60 ? 35 : 25;'));
  assert.ok(client.includes("const turboDescription = durationMinutes === 60\n        ? '35% faster cooldowns for 60 minutes'\n        : '25% faster cooldowns for 30 minutes';"));
  assert.ok(shared.includes("const turboReduction = (s.prestigeUpgrades?.chronoOverdrive ?? 0) > 0 ? 0.65 : 0.75;"));
});

test('Global Chat history polling is single-flight and paused in hidden tabs', () => {
  const chat = source('src/client/components/GlobalChatWindow.tsx');
  assert.ok(chat.includes('const refreshInFlightRef = useRef(false);'));
  assert.ok(chat.includes('const refreshPendingRef = useRef(false);'));
  assert.ok(chat.includes("if (document.visibilityState === 'hidden') return;"));
  assert.ok(chat.includes('if (refreshInFlightRef.current) {'));
  assert.ok(chat.includes("document.addEventListener('visibilitychange', refreshWhenVisible);"));
  assert.ok(chat.includes("document.removeEventListener('visibilitychange', refreshWhenVisible);"));
  assert.ok(chat.includes('void refreshChat(true);'));
});

test('Global Chat availability retries stop after the launcher unmounts', () => {
  const chat = source('src/client/components/GlobalChatWindow.tsx');
  const start = chat.indexOf('const checkAvailability = async () =>');
  const end = chat.indexOf('    };', start);
  const retryLoopStart = chat.indexOf('for (let attempt = 0; attempt < 3; attempt += 1)', start);
  const firstTry = chat.indexOf('        try {', retryLoopStart);
  assert.ok(start >= 0 && end > start && retryLoopStart > start && firstTry > retryLoopStart);
  assert.ok(chat.slice(start, end).includes('if (cancelled) return;'));
  assert.ok(chat.slice(retryLoopStart, firstTry).includes('if (cancelled) return;'));
});

test('Quest claim controls expose local pending state to assistive technology', () => {
  const quests = source('src/client/components/QuestsAndStreaks.tsx');
  assert.ok((quests.match(/aria-busy=\{busy \|\| claimPending\}/g) ?? []).length >= 3);
});

test('central Orb roll affordance is keyboard operable and announces busy state', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /role="button"[\s\S]{0,120}tabIndex=\{0\}[\s\S]{0,180}aria-label=\{primaryActionLabel\.toLowerCase\(\)\}/);
  assert.match(roll, /onKeyDown=\{event => \{[\s\S]{0,180}!event\.repeat && \(event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(roll, /aria-busy=\{busy\}[\s\S]{0,40}aria-disabled=\{busy\}/);
  assert.ok(roll.includes('focus-visible:outline-cyan-300'));
});

test('Chain Patcher takes priority over Free Roll cooldown bypass in the roll UI', () => {
  const roll = source('src/client/components/RollSection.tsx');
  const canRollStart = roll.indexOf('const canRoll =');
  const canRollEnd = roll.indexOf('const frenzyReady =', canRollStart);
  assert.ok(canRollStart >= 0 && canRollEnd > canRollStart);
  assert.match(roll.slice(canRollStart, canRollEnd), /chainPatcherPending\s*\?\s*chainPatcherCharged && remain <= 0/);
  assert.ok(roll.includes('const chainPatcherPending = rawChainPatcherTarget !== 0;'));
  assert.ok(roll.includes('Chain Patcher target is invalid. Refresh your save before rolling.'));
  assert.ok(roll.includes(": chainPatcherPending\n        ? chainPatcherCharged ? 'ROLL CHAIN PATCHER' : 'CHAIN PATCHER NEEDS REPAIR'"));
  assert.ok(roll.includes('Chain Patcher is charged; wait'));
  assert.ok(roll.includes('preserves ${freeRolls} stored Free Rolls.'));
  const quests = source('src/client/components/QuestsAndStreaks.tsx');
  assert.ok(quests.includes('Manual Free Rolls bypass normal cooldown; Frenzy and Chain Patcher take priority'));
});

test('armed Frenzy readiness and Pity Luck meter use the actual gameplay thresholds', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.ok(roll.includes('const frenzyReady = frenzyArmed && canRoll;'));
  assert.ok(roll.includes('const primaryActionLabel = busy'));
  assert.ok(roll.includes("? 'RELEASE FRENZY'"));
  assert.ok(roll.includes("frenzyReady ? 'frenzy-supercharged'"));
  assert.ok(roll.includes('const pityInterval = Math.max(6, 18 - pityCalibration * 2);'));
  assert.ok(roll.includes('const pityRollsIntoTier = pityDryRolls % pityInterval;'));
  assert.ok(roll.includes('const pityProgressPct = (pityRollsIntoTier / pityInterval) * 100;'));
  assert.ok(roll.includes('aria-valuenow={pityProgressPct}'));
  assert.ok(roll.includes('width: `${pityProgressPct}%`'));
  assert.ok(roll.includes('{pityRollsIntoTier} / {pityInterval} rolls to next stack'));
  assert.ok(roll.includes('{hasResonanceUpgrade && ('));
});

test('new-best celebration covers confirmed manual, Frenzy, and offline results', () => {
  const client = source('src/client/main.tsx');
  const rollStart = client.indexOf('const handleRoll = useCallback(async (isAutoRoll = false) =>');
  const frenzyStart = client.indexOf("'/api/frenzy/start'", rollStart);
  const rollSuccess = client.indexOf("'/api/roll'", rollStart);
  const rollEnd = client.indexOf('catch (error: any)', rollSuccess);
  assert.ok(rollStart >= 0 && rollSuccess > rollStart && rollEnd > rollSuccess);
  const rollHandler = client.slice(rollStart, rollEnd);
  const frenzyPath = rollHandler.slice(0, rollSuccess - rollStart);
  const regularRollPath = rollHandler.slice(rollSuccess - rollStart);
  assert.ok(frenzyPath.includes('if (res.orb.rarity > previousBest && res.orb.rarity >= latestBest)'));
  assert.ok(frenzyPath.includes('setNewBestModalData({ orb: res.orb, prevBest: previousBest });'));
  assert.ok(regularRollPath.includes('if (!isAutoRoll && res.orb.rarity > previousBest && res.orb.rarity >= latestBest)'));
  assert.ok(regularRollPath.includes('setNewBestModalData({ orb: res.orb, prevBest: previousBest });'));
  assert.ok(frenzyStart > rollStart && rollSuccess > frenzyStart, 'Frenzy and regular roll paths remain distinct');

  const offlineClaimStart = client.indexOf('const handleClaimOffline = async () =>');
  const offlineClaimRequest = client.indexOf("'/api/offline/claim'", offlineClaimStart);
  const offlineClaimCheck = client.indexOf('const latestBest = Math.max(2, Number(res.state.highestRarity) || 2);', offlineClaimRequest);
  assert.ok(offlineClaimStart >= 0 && offlineClaimRequest > offlineClaimStart && offlineClaimCheck > offlineClaimRequest);
  assert.ok(client.slice(offlineClaimStart, offlineClaimCheck + 240).includes('setNewBestModalData({ orb: res.orb, prevBest: previousBest });'));
  assert.ok(!source('src/client/components/RollSection.tsx').includes('handledBestResultRef'));
});

test('background polling is single-flight and paused while hidden', () => {
  const client = source('src/client/main.tsx');
  const sharedPollGuard = "if (cancelled || inFlight || document.visibilityState === 'hidden') return;";
  assert.ok(client.split(sharedPollGuard).length - 1 >= 3);
  assert.ok(client.includes("if (cancelled || !splashEntered || inFlight || document.visibilityState === 'hidden') return;"));
  assert.ok(client.includes("if (!splashEntered) return;\n      if (inFlight) return;\n      if (document.visibilityState === 'hidden') return;"));
  assert.ok(client.includes("if (inFlight || document.visibilityState === 'hidden') return;"));
  assert.ok(client.includes("document.addEventListener('visibilitychange', onVisibilityChange);"));
  assert.ok(client.includes("document.removeEventListener('visibilitychange', onVisibilityChange);"));
  assert.ok(client.includes("if (cancelled || !snapshot) return;"));
  assert.ok(client.includes("if (cancelled || !res.ok) return;"));
});

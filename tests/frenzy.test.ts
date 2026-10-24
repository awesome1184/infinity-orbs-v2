import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createInitialState,
  frenzyOrbCountForRarity,
  frenzyClaimCountForRarity,
  grantFrenzyOwnerShards,
  FRENZY_OWNER_SHARD_REWARD,
  FRENZY_PROMPT_DELAY_MS,
  FRENZY_CLAIM_MAX_ORBS,
  FRENZY_POST_COOLDOWN_MS,
  FRENZY_CLAIM_COOLDOWN_MS,
  FRENZY_POST_LIFETIME_MS,
  canShowDailyFrenzyPrompt,
  frenzyCooldownRemaining,
  frenzyClaimCooldownRemaining,
  frenzyPostExpiresAt,
  isFrenzyPostExpired,
  todayKey,
} from '../src/shared/game.js';

const NOW = 1_800_000_000_000;

test('Frenzy claim size is multiplied by Multi Roll', () => {
  const base = frenzyOrbCountForRarity(1_000_000);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 1), base);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 4), base * 4);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 0), base);
});

test('Frenzy Volley keeps its existing bonus on top of the Multi Roll multiplier', () => {
  const base = frenzyOrbCountForRarity(10_000);
  const multi = 5;
  assert.equal(
    frenzyClaimCountForRarity(10_000, multi, 1),
    Math.floor(base * 1.8),
  );
});

test('Frenzy claim size is capped safely', () => {
  assert.equal(
    frenzyClaimCountForRarity(1e100, 1e100),
    FRENZY_CLAIM_MAX_ORBS,
  );
});

test('Frenzy owner rewards remain separate from roll-earned Shard telemetry', () => {
  const state = createInitialState(NOW);
  state.shards = 50;
  state.lifetimeShards = 50;
  state.lastFreeShardReset = todayKey(NOW);
  state.freeShardsEarnedToday = 50;

  const granted = grantFrenzyOwnerShards(state);

  assert.equal(granted, FRENZY_OWNER_SHARD_REWARD);
  assert.equal(state.shards, 55);
  assert.equal(state.lifetimeShards, 55);
  assert.equal(state.freeShardsEarnedToday, 50);
});

test('Frenzy cooldowns and expiry use precise timestamps', () => {
  assert.equal(FRENZY_PROMPT_DELAY_MS, 3 * 60_000);
  assert.equal(FRENZY_POST_COOLDOWN_MS, 23 * 60 * 60 * 1000);
  assert.equal(FRENZY_CLAIM_COOLDOWN_MS, 23 * 60 * 60 * 1000);
  assert.equal(FRENZY_POST_LIFETIME_MS, 24 * 60 * 60 * 1000);
  assert.equal(frenzyCooldownRemaining(NOW, NOW), FRENZY_POST_COOLDOWN_MS);
  assert.equal(frenzyClaimCooldownRemaining(NOW, NOW), FRENZY_CLAIM_COOLDOWN_MS);
  assert.equal(canShowDailyFrenzyPrompt(NOW, NOW), false);
  assert.equal(canShowDailyFrenzyPrompt(NOW - FRENZY_POST_COOLDOWN_MS, NOW), true);
  assert.equal(frenzyPostExpiresAt(NOW), NOW + FRENZY_POST_LIFETIME_MS);
  assert.equal(isFrenzyPostExpired(NOW, NOW + FRENZY_POST_LIFETIME_MS - 1), false);
  assert.equal(isFrenzyPostExpired(NOW, NOW + FRENZY_POST_LIFETIME_MS), true);
});

test('posted Frenzy opens the actual game entrypoint from the claim button', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  assert.match(source, /requestExpandedMode\(event\.nativeEvent, ['"]game['"]\)/);
  assert.match(source, /Click below to claim it/);
  assert.match(source, /Frenzy expires in/);
  assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
  assert.match(source, /io-frenzy-rarity-number/);
  assert.match(source, /Your Multi Roll multiplies the Frenzy size/);
  assert.doesNotMatch(source, /When someone claims this Frenzy/);
  assert.doesNotMatch(source, /That \+5 Shard reward bypasses/);
  assert.doesNotMatch(source, /Self-claim is enabled for admin testing/);
  assert.match(source, /io-frenzy-orb-visual/);
});

test('posted Frenzy rarity uses the rarity color and roll-up animation', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  const styles = readFileSync(resolve(process.cwd(), 'src/client/styles.css'), 'utf8');
  assert.match(source, /getOrbInfo\(info\.rarity(?:,\s*info\.isInfinity)?\)/);
  assert.match(source, /style=\{\{ color \}\}/);
  assert.match(styles, /@keyframes io-frenzy-number-roll/);
  assert.match(styles, /\.io-frenzy-rarity-number/);
});

test('starting a Frenzy creates a dedicated public Frenzy post', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /entry: 'frenzy'/);
  assert.match(source, /postId = String\(post\?\.id/);
  assert.match(source, /FRENZY_OWNER_SHARD_REWARD/);
});

test('Frenzy posts use Orb terminology and claims return a visible Orb volley', () => {
  const server = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.doesNotMatch(server, /got a 1\/\$\{formatRarity\(rarity\)\} ball in their Frenzy/);
  assert.match(server, /got a 1\/\$\{formatRarity\(rarity,\s*isInfinity\)\} Orb in their Frenzy/);
  assert.match(server, /const visibleBatch: Orb\[\] = \[\]/);
  assert.match(server, /batch: visibleBatch/);
});

test('Frenzy claims expose 23-hour eligibility and expiry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /canClaim: !expired && !alreadyClaimedByViewer && \(claimCooldownRemainingMs <= 0 \|\| selfClaimTest\)/);
  assert.match(source, /const alreadyClaimedByViewer = claimedReceipt != null \|\| data\.consumedBy === viewerId/);
  assert.match(source, /const claimReceiptKey = frenzyClaimReceiptKey\(postId, claimantId\)/);
  assert.match(source, /key: claimReceiptKey,[\s\S]*?expectedValue: null/);
  assert.match(source, /key: FRENZY_POST_PREFIX \+ postId/);
  assert.doesNotMatch(source, /nextValue: consumedPostValue/);
  assert.match(source, /frenzyClaimCooldownRemaining/);
  assert.match(source, /isFrenzyPostExpired/);
  assert.match(source, /selfClaimTest/);
  assert.match(source, /data\.adminTest === true/);
  assert.ok(source.includes('const claimReceipt = await redis.get(frenzyClaimReceiptKey(postId, claimantId))'));
  assert.ok(source.includes('legacyClaimedByThisUser'));
});


test('daily Frenzy prompt appears after the delay and explains the owner reward', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(source, /FRENZY_PROMPT_DELAY_MS/);
  assert.match(source, /Post today’s Frenzy/);
  assert.match(source, /\+\{FRENZY_OWNER_SHARD_REWARD\} Shards/);
  assert.match(source, /does not count toward your roll-earned Shard total/);
  assert.match(source, /localStorage\.setItem\(storageKey, '1'\)/);
});


test('Frenzy submission arms a manual roll and disables Auto Roll first', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(source, /const \[frenzyArmed, setFrenzyArmed\] = useState\(false\)/);
  assert.match(source, /body: JSON\.stringify\(\{ enabled: false \}\)/);
  assert.match(source, /setAutoRoll\(false\)/);
  assert.match(source, /setFrenzyArmed\(true\)/);
  assert.match(source, /if \(!isAutoRoll && frenzyArmed\)/);
  assert.match(source, /\/api\/frenzy\/start/);
});

test('Frenzy Roll button has a persistent lightning charge state and releases on click', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/components/RollSection.tsx'), 'utf8');
  const styles = readFileSync(resolve(process.cwd(), 'src/client/styles.css'), 'utf8');
  assert.match(source, /frenzy-supercharged/);
  assert.match(source, /frenzy-lightning-left/);
  assert.match(source, /frenzy-lightning-right/);
  assert.match(source, /RELEASE FRENZY/);
  assert.match(styles, /@keyframes io-frenzy-charge-pulse/);
  assert.match(styles, /@keyframes io-frenzy-lightning/);
});

test('Frenzy button shows a ticking daily cooldown after submission', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/components/RollSection.tsx'), 'utf8');
  assert.match(source, /frenzyCooldownRemaining/);
  assert.match(source, /formatFrenzyCooldown/);
  assert.match(source, /Frenzy Cooldown/);
  assert.match(source, /disabled=\{busy \|\| frenzyArmed \|\| frenzyUsedToday\}/);
  assert.match(source, /frenzyCooldownRemaining/);
});

test('admin self-claim works even when the normal daily claim is already used', () => {
  const serverSource = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const clientSource = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  assert.match(serverSource, /isFrenzyTestAdmin\(s\.username\)/);
  assert.match(serverSource, /data\.adminTest === true/);
  assert.match(clientSource, /const canClaim = info\.canClaim && !openedGame/);
  assert.match(clientSource, /Claim Your Frenzy · Test/);
  assert.match(serverSource, /if \(claimCooldown > 0 && !selfClaimTest\)/);
});


test('Frenzy submission returns the starter roll and marks it as a manual roll', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /s\.manualRolls = Math\.min\(10, \(s\.manualRolls \?\? 0\) \+ 1\)/);
  assert.match(source, /if \(s\.manualRolls >= 3\) s\.upgrades\.auto = 1/);
  assert.match(source, /orb: result\.bestOrb/);
  assert.match(source, /rollsProcessed: result\.rollCount/);
  assert.match(source, /lastFrenzyDate = today/);
  assert.match(source, /lastFrenzyAt = createdAt/);
  assert.match(source, /expiresAt/);
});

test('Roll and Frenzy mutations share the client mutation queue', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');

  assert.match(
    source,
    /const res = await enqueueMutation\(\(\) =>[\s\S]*?\/api\/auto-roll/,
  );
  assert.match(
    source,
    /frenzySubmissionInFlight = true;[\s\S]*?const res = await enqueueMutation\(\(\) => getJson<\{/,
  );
  assert.match(source, /setFrenzyArmed\(false\);[\s\S]*?await refreshAll\(\)\.catch/);
});

test('Frenzy auto-claim requires an explicit server-side handoff', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(source, /\/api\/frenzy\/handoff/);
  assert.match(source, /if \(!handoff\.armed\) return/);
});

test('Frenzy claim button arms the server-side handoff before opening the game', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  assert.match(source, /\/api\/frenzy\/arm/);
  assert.match(source, /requestExpandedMode\(event\.nativeEvent, 'game'\)/);
});

test('Frenzy auto-claim always releases the game loading state', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(
    source,
    /void resolveFrenzy\(\)[\s\S]*?\.finally\(\(\) => \{[\s\S]*?setIsRolling\(false\);[\s\S]*?setBusy\(false\);[\s\S]*?\}\);/,
  );
  assert.match(
    source,
    /const res = await enqueueMutation\(\(\) =>[\s\S]*?\/api\/frenzy\/claim/,
  );
});


test('client roll reveal displays the exact authoritative payout', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/components/RollSection.tsx'), 'utf8');
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(source, /reward-burst/);
  assert.match(source, /batchSummary\.coins/);
  assert.match(source, /batchSummary\.xp/);
  assert.match(source, /batchSummary\.shards/);
  assert.match(source, /batchSummary\.totalVal/);
  assert.match(source, /roll-reward-summary/);
  assert.doesNotMatch(source, /coinsForRarity\(displayOrb\.rarity\)/);
  assert.match(main, /setBatchSummary\(\{[\s\S]*?coins: (?:res|prediction)\.coinsGained,[\s\S]*?xp: (?:res|prediction)\.xpGained/);
});

test('daily Frenzy popup closes when it arms the next manual roll', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(
    source,
    /onClick=\{\(\) => \{[\s\S]*?setShowFrenzyPrompt\(false\);[\s\S]*?void handleStartOrbFrenzy\(\);[\s\S]*?\}\}/,
  );
  assert.match(source, /Charge My Frenzy/);
  assert.match(source, /Your next manual Roll creates the post/);
});


test('Frenzy reveal survives the authoritative state update', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  const claimStart = source.indexOf('const resolveFrenzy = async () => {');
  const claimEnd = source.indexOf('\n    void resolveFrenzy()', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart, 'the in-game Frenzy claim handler must exist');
  const claim = source.slice(claimStart, claimEnd);
  assert.match(claim, /frenzyClaimActiveRef\.current = true/);
  assert.match(claim, /if \(!componentMountedRef\.current\) return/);
  assert.match(claim, /applyPlayerState\(res\.state\)/);
  const applyIndex = claim.indexOf('applyPlayerState(res.state)');
  const revealIndex = claim.indexOf('for (const revealedOrb of revealBatch)');
  const revealWriteIndex = claim.indexOf('setLastOrb(revealedOrb)');
  assert.ok(applyIndex >= 0 && revealIndex > applyIndex && revealWriteIndex > revealIndex,
    'authoritative state must be applied before the independent visual reveal sequence');
  assert.doesNotMatch(claim, /let cancelled = false|cancelled = true/);
});


test('Admin console exposes a Force Frenzy Popup control', () => {
  const admin = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(admin, /onForceFrenzyPopup/);
  assert.match(admin, /Force Frenzy Popup/);
  assert.match(main, /onForceFrenzyPopup=\{\(\) => \{[\s\S]*?setShowFrenzyPrompt\(true\)/);
});


test('public Frenzy initial load offers a deduplicated read-only retry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  assert.ok(source.includes('const loadInFlightRef = useRef(false)'));
  const loadStart = source.indexOf('const load = async () =>');
  const loadEnd = source.indexOf('\n  useEffect(() => { void load(); }, []);', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'read-only load function must exist');
  const load = source.slice(loadStart, loadEnd);
  assert.ok(load.includes('if (loadInFlightRef.current) return;'));
  assert.ok(load.includes("fetchWithTimeout('/api/frenzy/info')"), 'the read-only info request must have a timeout');
  assert.ok(!load.includes('/api/frenzy/arm') && !load.includes('/api/frenzy/claim'));
  const errorStart = source.indexOf('if (error && !info)');
  const errorEnd = source.indexOf('\n  if (!info)', errorStart);
  assert.ok(errorStart >= 0 && errorEnd > errorStart, 'initial load error panel must exist');
  const errorPanel = source.slice(errorStart, errorEnd);
  assert.ok(errorPanel.includes('onClick={() => void load()}'));
  assert.ok(errorPanel.includes('disabled={loadingInfo}'));
});

test('Frenzy post previews do not register online-player activity', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const infoStart = source.indexOf('export async function getOrbFrenzyInfo');
  const infoEnd = source.indexOf('\nexport async function claimOrbFrenzy', infoStart);
  assert.ok(infoStart >= 0 && infoEnd > infoStart, 'Frenzy info handler must exist');
  const info = source.slice(infoStart, infoEnd);

  // Preview loads must not use getMe()/getState(), because that path touches
  // the online-presence sorted set. Read only the fields needed for eligibility.
  assert.match(info, /loadRaw\(\{ registerActivity: false \}\)/);
  assert.doesNotMatch(info, /getMe\(\)|getState\(\)|touchOnlinePresence\(/);
  assert.match(source, /if \(options\.registerActivity !== false\) await registerPlayer\(/);
});



test('Frenzy claim and preview paths fail closed for malformed persisted timestamps and rarity', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /function parseFrenzyPostRecord\(raw: unknown\): FrenzyPostRecord \| null/);
  assert.match(source, /!Number\.isSafeInteger\(record\.createdAt\)/);
  assert.match(source, /record\.createdAt > now/);
  assert.match(source, /!Number\.isInteger\(record\.rarity\)/);
  assert.match(source, /record\.rarity > MAX_ORB_RARITY/);
  const infoStart = source.indexOf('export async function getOrbFrenzyInfo');
  const claimStart = source.indexOf('export async function claimOrbFrenzy');
  const armStart = source.indexOf('export async function armOrbFrenzyClaim');
  assert.ok(infoStart >= 0 && claimStart > infoStart && armStart > 0);
  assert.match(source.slice(infoStart, claimStart), /parseFrenzyPostRecord\(raw\)/);
  assert.match(source.slice(armStart, claimStart), /parseFrenzyPostRecord\(raw\)/);
  assert.match(source.slice(claimStart, claimStart + 5000), /parseFrenzyPostRecord\(raw\)/);
});


test('viewer-specific Frenzy eligibility and handoff responses are never cacheable', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
  for (const route of [
    "app.post('/api/frenzy/arm'",
    "app.get('/api/frenzy/handoff'",
    "app.get('/api/frenzy/info'",
    "app.post('/api/frenzy/claim'",
  ]) {
    const start = source.indexOf(route);
    assert.ok(start >= 0, 'missing route ' + route);
    const nextRoute = source.indexOf('\n  app.', start + 5);
    const end = nextRoute < 0 ? source.length : nextRoute;
    assert.match(source.slice(start, end), /Cache-Control', 'no-store'/, route + ' must not leak cached per-viewer state');
  }
});


test('arming a Frenzy serializes offline settlement with normal player mutations', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const start = source.indexOf('export async function armOrbFrenzyClaim');
  const end = source.indexOf('\nexport async function getOrbFrenzyHandoff', start);
  assert.ok(start >= 0 && end > start, 'Frenzy arm function must exist');
  const arm = source.slice(start, end);
  assert.match(arm, /return withPlayerMutationLock\(async \(\) => \{/);
  assert.match(arm, /await settleOffline\(await loadRaw\(\)\)/);
  assert.match(arm, /frenzyHandoffKey\(currentUserId\(\)\)/);
});


test('expired Frenzy handoff cleanup cannot delete a fresh concurrent handoff', async () => {
  const {
    configureDevvitRuntime,
    context: originalContext,
    redis: originalRedis,
    reddit: originalReddit,
  } = await import('../src/server/devvit-mock.js');
  const { getOrbFrenzyHandoff } = await import('../src/server/game.js');
  const userId = 'frenzy-handoff-race-' + Date.now().toString(36);
  const handoffKey = 'io:frenzy:handoff:' + userId;
  const stale = JSON.stringify({ postId: 't3_stale', expiresAt: Date.now() - 1 });
  const fresh = JSON.stringify({ postId: 't3_fresh', expiresAt: Date.now() + 60_000 });
  const baseRedis = originalRedis;
  let raced = false;
  const raceRedis = {
    ...baseRedis,
    get: async (key: string) => {
      const value = await baseRedis.get(key);
      if (key === handoffKey && !raced) {
        raced = true;
        await baseRedis.set(handoffKey, fresh);
      }
      return value;
    },
  };
  configureDevvitRuntime({
    redis: raceRedis,
    context: { ...originalContext, userId, username: 'FrenzyRaceTest' },
    reddit: originalReddit,
  });
  try {
    await baseRedis.set(handoffKey, stale);
    assert.deepEqual(await getOrbFrenzyHandoff(), { armed: false });
    assert.deepEqual(await getOrbFrenzyHandoff(), { armed: true, postId: 't3_fresh' });
  } finally {
    await baseRedis.del(handoffKey);
    configureDevvitRuntime({ redis: baseRedis, context: originalContext, reddit: originalReddit });
  }
});


test('Frenzy handoff keys have a Redis expiry as well as an application expiry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const start = source.indexOf('export async function armOrbFrenzyClaim');
  const end = source.indexOf('\nexport async function getOrbFrenzyHandoff', start);
  assert.ok(start >= 0 && end > start);
  const arm = source.slice(start, end);
  assert.match(arm, /const handoffExpiresAt = Date\.now\(\) \+ FRENZY_HANDOFF_TTL_MS/);
  assert.match(arm, /expiration: new Date\(handoffExpiresAt\)/);
});


test('Frenzy preview, arm, and claim checks honor the stored expiration timestamp', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /function isFrenzyPostRecordExpired\([\s\S]{0,250}post\.expiresAt \?\? frenzyPostExpiresAt\(post\.createdAt\)/);
  const infoStart = source.indexOf('export async function getOrbFrenzyInfo');
  const claimStart = source.indexOf('export async function claimOrbFrenzy');
  const armStart = source.indexOf('export async function armOrbFrenzyClaim');
  const handoffStart = source.indexOf('export async function getOrbFrenzyHandoff');
  assert.ok(infoStart >= 0 && claimStart > infoStart && armStart > 0 && handoffStart > armStart);
  assert.match(source.slice(infoStart, claimStart), /isFrenzyPostRecordExpired\(data, now\)/);
  assert.match(source.slice(armStart, handoffStart), /isFrenzyPostRecordExpired\(data, now\)/);
  assert.match(source.slice(claimStart, claimStart + 8000), /isFrenzyPostRecordExpired\(data, now\)/);
});

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
  FRENZY_LOG_BASE,
  FRENZY_POST_COOLDOWN_MS,
  FRENZY_CLAIMS_PER_DAY,
  frenzyClaimsUsedToday,
  frenzyClaimsRemainingToday,
  FRENZY_POST_LIFETIME_MS,
  canShowDailyFrenzyPrompt,
  frenzyCooldownRemaining,
  frenzyPostExpiresAt,
  isFrenzyPostExpired,
  todayKey,
} from '../src/shared/game.js';
import {
  MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH,
  MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH,
  createRollBatchPlan,
  effectiveWeightAtSample,
} from '../src/shared/roll-batching.js';

const NOW = 1_800_000_000_000;

test('Frenzy claim size is multiplied by Multi Roll', () => {
  const base = frenzyOrbCountForRarity(1_000_000);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 1), base);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 4), base * 4);
  assert.equal(frenzyClaimCountForRarity(1_000_000, 0), base);
});

test('1/e9 Frenzy stays below the supported claim cap and uses bounded samples', () => {
  const baseCount = frenzyOrbCountForRarity(1e9);
  assert.equal(baseCount, Math.floor(Math.log(1e9) / Math.log(FRENZY_LOG_BASE)));

  // Stress a high-Multiball, Frenzy Volley claim rather than only the base payout.
  const claimCount = frenzyClaimCountForRarity(1e9, 163, 1);
  assert.ok(Number.isSafeInteger(claimCount));
  assert.ok(claimCount > baseCount);
  assert.ok(claimCount < MAX_EFFECTIVE_FRENZY_ROLLS_PER_BATCH);

  const plan = createRollBatchPlan(
    claimCount,
    0,
    true,
    MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH,
  );
  assert.ok(plan.simulatedBaseCount <= MAX_SIMULATED_FRENZY_ROLLS_PER_BATCH);

  let processedCount = 0;
  for (let index = 0; index < plan.simulatedBaseCount; index++) {
    processedCount += effectiveWeightAtSample(plan, index);
  }
  assert.equal(processedCount, claimCount);
});

test('Frenzy payout always applies full Multiball and Frenzy Volley adds 20%', () => {
  const rarity = 10_000;
  const base = frenzyOrbCountForRarity(rarity);
  const multi = 5;
  assert.equal(frenzyClaimCountForRarity(rarity, multi), base * multi);
  assert.equal(frenzyClaimCountForRarity(rarity, multi, 1), Math.floor(base * multi * 1.2));
  assert.equal(frenzyClaimCountForRarity(rarity, multi, 1), Math.floor(base * 6));
});

test('Frenzy payout scaling uses log base 1.004 and exceeds the old 50k limit', () => {
  assert.equal(FRENZY_LOG_BASE, 1.004);
  const base = frenzyOrbCountForRarity(1e100);
  assert.equal(base, Math.floor(Math.log(1e100) / Math.log(1.004)));
  assert.ok(base > 50_000);
});

test('Frenzy claims have no arbitrary 50k cap and still scale with Multi Roll', () => {
  const base = frenzyOrbCountForRarity(1e100);
  assert.equal(frenzyClaimCountForRarity(1e100, 1), base);
  assert.equal(frenzyClaimCountForRarity(1e100, 2), base * 2);
  assert.ok(frenzyClaimCountForRarity(1e100, 2) > 50_000);
});

test('Frenzy owner rewards remain separate from roll-earned Shard telemetry', () => {
  const state = createInitialState(NOW);
  state.shards = 50;
  state.lifetimeShards = 50;
  state.lastFreeShardReset = todayKey(NOW);
  state.freeShardsEarnedToday = 50;

  const granted = grantFrenzyOwnerShards(state);

  assert.equal(granted, FRENZY_OWNER_SHARD_REWARD);
  assert.equal(state.shards, 150);
  assert.equal(state.lifetimeShards, 150);
  assert.equal(state.freeShardsEarnedToday, 50);
});

test('Frenzy claims use a three-per-day limit while post creation retains its cooldown', () => {
  const today = todayKey(NOW);
  assert.equal(FRENZY_CLAIMS_PER_DAY, 3);
  assert.equal(frenzyClaimsUsedToday(today, 0, NOW), 0);
  assert.equal(frenzyClaimsRemainingToday(today, 0, NOW), 3);
  assert.equal(frenzyClaimsUsedToday(today, 1, NOW), 1);
  assert.equal(frenzyClaimsRemainingToday(today, 1, NOW), 2);
  assert.equal(frenzyClaimsUsedToday(today, 3, NOW), 3);
  assert.equal(frenzyClaimsRemainingToday(today, 3, NOW), 0);
  // Legacy saves with a same-day timestamp but no counter conservatively count one claim.
  assert.equal(frenzyClaimsUsedToday(today, undefined, NOW), 1);
  assert.equal(frenzyClaimsUsedToday('2000-01-01', 3, NOW), 0);

  assert.equal(FRENZY_PROMPT_DELAY_MS, 3 * 60_000);
  assert.equal(FRENZY_POST_COOLDOWN_MS, 23 * 60 * 60 * 1000);
  assert.equal(FRENZY_POST_LIFETIME_MS, 24 * 60 * 60 * 1000);
  assert.equal(frenzyCooldownRemaining(NOW, NOW), FRENZY_POST_COOLDOWN_MS);
  assert.equal(canShowDailyFrenzyPrompt(NOW, NOW), false);
  assert.equal(canShowDailyFrenzyPrompt(NOW - FRENZY_POST_COOLDOWN_MS, NOW), true);
  assert.equal(frenzyPostExpiresAt(NOW), NOW + FRENZY_POST_LIFETIME_MS);
  assert.equal(isFrenzyPostExpired(NOW, NOW + FRENZY_POST_LIFETIME_MS - 1), false);
  assert.equal(isFrenzyPostExpired(NOW, NOW + FRENZY_POST_LIFETIME_MS), true);
});

test('posted Frenzy opens the actual game entrypoint from the claim button', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  assert.match(source, /requestExpandedMode\(event\.nativeEvent, ['"]game['"]\)/);
  assert.match(source, /Claim it for a burst of Orbs/);
  assert.match(source, /Frenzy expires in/);
  assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
  assert.match(source, /io-frenzy-rarity-number/);
  assert.match(source, /Multi Roll scales (?:the Frenzy size|your reward)/);
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

test('Frenzy claims expose a daily allowance and expiry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /canClaim: !expired && !alreadyClaimedByViewer && \(claimsRemainingToday > 0 \|\| selfClaimTest\)/);
  assert.match(source, /const alreadyClaimedByViewer = claimedReceipt != null \|\| data\.consumedBy === viewerId/);
  assert.match(source, /const claimReceiptKey = frenzyClaimReceiptKey\(postId, claimantId\)/);
  assert.match(source, /key: claimReceiptKey,[\s\S]*?expectedValue: null/);
  assert.match(source, /key: FRENZY_POST_PREFIX \+ postId/);
  assert.doesNotMatch(source, /nextValue: consumedPostValue/);
  assert.match(source, /frenzyClaimsUsedToday/);
  assert.match(source, /FRENZY_CLAIMS_PER_DAY/);
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
  assert.match(clientSource, /const canClaim = info\.canClaim && !openedGame[\s\S]*claimsRemainingToday > 0 \|\| info\.selfClaimTest/);
  assert.match(clientSource, /Claim Your Frenzy · Test/);
  assert.match(serverSource, /if \(claimsUsedToday >= FRENZY_CLAIMS_PER_DAY && !selfClaimTest\)/);
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

test('Frenzy post arms the handoff and opens the main game without claiming in the preview', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/frenzy.tsx'), 'utf8');
  const claimStart = source.indexOf('const claim = async (event: React.MouseEvent<HTMLButtonElement>) =>');
  const claimEnd = source.indexOf('\n  };', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = source.slice(claimStart, claimEnd);
  assert.match(claim, /requestExpandedMode\(event\.nativeEvent, 'game'\)/);
  assert.match(claim, /fetchWithTimeout\('\/api\/frenzy\/arm', \{ method: 'POST' \}, 10_000\)/);
  assert.match(claim, /setOpenedGame\(true\)/);
  assert.doesNotMatch(claim, /\/api\/frenzy\/claim/);
  assert.match(source, /Orbs were rolled and saved to your account/);
  assert.match(source, /Opening game/);
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
  const acceptStart = source.indexOf('const acceptFrenzyPrompt = () => {');
  const acceptEnd = source.indexOf('\n  };', acceptStart);
  assert.ok(acceptStart >= 0 && acceptEnd > acceptStart, 'Frenzy accept handler must exist');
  const handler = source.slice(acceptStart, acceptEnd);
  assert.match(handler, /trackPopupEvent\('frenzy', 'accepted'\)/);
  assert.match(handler, /setShowFrenzyPrompt\(false\)/);
  assert.match(handler, /void handleStartOrbFrenzy\(\)/);
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
  assert.match(arm, /const viewerId = currentUserId\(\)/);
  assert.match(arm, /frenzyHandoffKey\(viewerId\)/);
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

test('claiming from a Frenzy post takes precedence over a stale game handoff', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const start = source.indexOf('export async function claimOrbFrenzy');
  const claim = source.slice(start, start + 1900);

  assert.ok(start >= 0);
  assert.match(claim, /const contextPostId = String\(context\.postId \?\? ''\)\.trim\(\)/);
  assert.match(claim, /parseFrenzyPostRecord\(contextPostRaw\)/);
  assert.match(claim, /const handoff = options\.postId \|\| isDirectFrenzyPost \? null : await readFrenzyHandoff\(claimantId\)/);
  assert.match(claim, /isDirectFrenzyPost \? contextPostId : handoff\?\.postId \?\? contextPostId/);
});


test('Frenzy info follows the viewer handoff when expanded-game post context differs', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const start = source.indexOf('export async function getOrbFrenzyInfo');
  const end = source.indexOf('\nexport async function claimOrbFrenzy', start);
  assert.ok(start >= 0 && end > start);
  const info = source.slice(start, end);
  assert.match(info, /const contextPostId = String\(context\.postId \?\? ''\)\.trim\(\)/);
  assert.match(info, /const contextPostData = parseFrenzyPostRecord\(contextPostRaw\)/);
  assert.match(info, /const handoff = contextPostData \? null : await readFrenzyHandoff\(viewerId\)/);
  assert.match(info, /const postId = contextPostData \? contextPostId : handoff\?\.postId \?\? contextPostId/);
  assert.match(info, /frenzyClaimReceiptKey\(postId, viewerId\)/);
});



test('arming a Frenzy uses the current viewer for ownership and handoff', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const start = source.indexOf('export async function armOrbFrenzyClaim');
  const end = source.indexOf('export async function getOrbFrenzyHandoff', start);
  assert.ok(start >= 0 && end > start);
  const arm = source.slice(start, end);
  assert.match(arm, /const viewerId = currentUserId\(\);/);
  assert.match(arm, /data\.ownerId === viewerId/);
  assert.match(arm, /frenzyHandoffKey\(viewerId\)/);
});

test('current app version is visible on the main game splash and header', () => {
  const splash = readFileSync(resolve(process.cwd(), 'src/client/components/SplashScreen.tsx'), 'utf8');
  const header = readFileSync(resolve(process.cwd(), 'src/client/components/Header.tsx'), 'utf8');
  assert.match(splash, /import \{ APP_VERSION \} from '\.\.\/\.\.\/shared\/version\.js'/);
  assert.match(splash, /v\{APP_VERSION\}/);
  assert.match(header, /import \{ APP_VERSION \} from '\.\.\/\.\.\/shared\/version\.js'/);
  assert.match(header, /v\{APP_VERSION\}/);
});


test('Frenzy payout preview and claim use the same Multiball-scaled count', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const infoStart = source.indexOf('export async function getOrbFrenzyInfo');
  const claimStart = source.indexOf('export async function claimOrbFrenzy');
  const claimEnd = source.indexOf('export async function postFrenzyThankYouComment', claimStart);
  assert.ok(infoStart >= 0 && claimStart > infoStart && claimEnd > claimStart);

  const info = source.slice(infoStart, claimStart);
  const claim = source.slice(claimStart, claimEnd);
  assert.match(info, /const baseOrbCount = frenzyOrbCountForRarity\(data\.rarity\)/);
  assert.match(info, /const multiRolls = rollsPerActivation\(s\)/);
  assert.match(info, /const rewardOrbCount = frenzyClaimCountForRarity\(/);
  assert.match(info, /rewardOrbCount,/);
  assert.match(claim, /const count = frenzyClaimCountForRarity\(\s*data\.rarity,\s*rollsPerActivation\(s\)/);
  assert.match(claim, /applyRolls\([\s\S]{0,220}'frenzy',[\s\S]{0,220}chunkProcessed =>/);
  assert.match(claim, /frenzyCount: processedCount/);
  assert.doesNotMatch(claim, /data\.rarity \* critMultiplier\(s\)/);
});

test('Frenzy batches use ordinary RNG without hidden extra Orb rolls', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const start = source.indexOf('export async function applyRolls');
  const end = source.indexOf('async function commitOfflineNotificationMarkerIfUnchanged', start);
  assert.ok(start >= 0 && end > start);
  const apply = source.slice(start, end);
  assert.match(apply, /source: 'online' \| 'offline' \| 'frenzy'/);
  assert.match(apply, /MAX_EFFECTIVE_ROLLS_PER_BATCH/);
  assert.match(apply, /source === 'offline'[\s\S]{0,100}offlineRollCap\(s\)/);
  assert.ok(apply.includes('const sampleScale = sampleWeight * averageGroupMultiplier'));
  assert.ok(apply.includes('effectiveLuck * sampleScale * sampleScale'));
  assert.match(apply, /source === 'frenzy'\s*\?\s*0\s*:\s*Math\.max/);
  assert.match(apply, /source !== 'frenzy' && rollCount > 1 && magnetLevel > 0/);
  assert.match(apply, /source !== 'frenzy' && !constellationTriggered/);
  assert.match(apply, /source !== 'frenzy' && !temporalLoopTriggered/);
  assert.match(apply, /source === 'online' \|\| source === 'frenzy'/);
});


test('slow Frenzy claims show a delayed calculating popup with rapid Orb spawns', () => {
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  const styles = readFileSync(resolve(process.cwd(), 'src/client/ui-polish.css'), 'utf8');

  assert.match(main, /FRENZY_CALCULATING_DELAY_MS = 650/);
  assert.match(main, /FRENZY_CALCULATING_MIN_VISIBLE_MS = 420/);
  assert.match(main, /setTimeout\(\(\) => \{/);
  assert.match(main, /setShowFrenzyCalculating\(true\)/);
  assert.match(main, /data-testid="frenzy-calculating-popup"/);
  assert.match(main, /Calculating Frenzy/);
  assert.match(main, /Array\.from\(\{ length: 12 \}/);
  assert.match(main, /setShowFrenzyCalculating\(false\)/);
  assert.match(styles, /io-frenzy-calc-orb-spawn/);
  assert.match(styles, /\.io-frenzy-calculating-orb:nth-of-type\(12\)/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});


test('Frenzy claim activity is a retryable post-commit projection and cannot invalidate rewards', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const claimStart = source.indexOf('export async function claimOrbFrenzy');
  const claimEnd = source.indexOf('export async function postFrenzyThankYouComment', claimStart);
  const helperStart = source.indexOf('async function recordFrenzyClaimer');
  const helperEnd = source.indexOf('function frenzyHandoffKey', helperStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const claim = source.slice(claimStart, claimEnd);
  const helper = source.slice(helperStart, helperEnd);
  const durableSaveStart = claim.indexOf('await save(s, [');
  const durableSaveEnd = claim.indexOf(']);', durableSaveStart);
  assert.ok(durableSaveStart >= 0 && durableSaveEnd > durableSaveStart);
  const durableSave = claim.slice(durableSaveStart, durableSaveEnd);

  assert.match(claim, /stageSavePostCommitAction\(s, async \(\) => \{[\s\S]*?recordFrenzyClaimer\(/);
  assert.match(claim, /const claimProjectionExpiresAt = new Date\(/);
  assert.match(durableSave, /key: claimReceiptKey/);
  assert.match(durableSave, /key: FRENZY_POST_PREFIX \+ postId/);
  assert.doesNotMatch(durableSave, /claimersKey|Frenzy claim activity changed/);
  assert.match(helper, /const maxAttempts = 24/);
  assert.match(helper, /redis\.watch\(claimersKey, projectionReceiptKey\)/);
  assert.match(helper, /frenzyClaimerProjectionReceiptKey\(postId, userId\)/);
  assert.match(helper, /if \(projectionReceipt != null\)/);
  assert.match(helper, /await txn\.set\(claimersKey, JSON\.stringify\(next\), \{ expiration: expiresAt \}\)/);
  assert.match(helper, /await txn\.set\(projectionReceiptKey, '1', \{ expiration: expiresAt \}\)/);
  assert.match(helper, /if \(committed !== null\) return/);
  assert.match(helper, /Reward was saved, but the live claim activity projection could not be updated/);
});

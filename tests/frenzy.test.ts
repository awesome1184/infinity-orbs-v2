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

test('Frenzy owner reward bypasses the normal 50-Shard daily cap', () => {
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
  assert.match(source, /getOrbInfo\(info\.rarity\)/);
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
  assert.match(server, /got a 1\/\$\{formatRarity\(rarity\)\} Orb in their Frenzy/);
  assert.match(server, /const visibleBatch: Orb\[\] = \[\]/);
  assert.match(server, /batch: visibleBatch/);
});

test('Frenzy claims expose 23-hour eligibility and expiry', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(source, /canClaim: !expired && data\.consumedAt == null && \(claimCooldownRemainingMs <= 0 \|\| selfClaimTest\)/);
  assert.match(source, /consumedAt: now/);
  assert.match(source, /key: FRENZY_POST_PREFIX \+ postId/);
  assert.match(source, /frenzyClaimCooldownRemaining/);
  assert.match(source, /isFrenzyPostExpired/);
  assert.match(source, /selfClaimTest/);
  assert.match(source, /data\.adminTest === true/);
});


test('daily Frenzy prompt appears after the delay and explains the owner reward', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.match(source, /FRENZY_PROMPT_DELAY_MS/);
  assert.match(source, /Post today’s Frenzy/);
  assert.match(source, /\+\{FRENZY_OWNER_SHARD_REWARD\} Shards/);
  assert.match(source, /bypasses the 50 Shard daily cap/);
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
  assert.match(source, /frenzyClaimActiveRef/);
  assert.match(source, /componentMountedRef/);
  assert.match(source, /for \(const revealedOrb of revealBatch\)/);
  assert.match(source, /setLastOrb\(revealedOrb\)/);
  assert.match(
    source,
    /applyPlayerState\(res\.state\);[\s\S]*?for \(const revealedOrb of revealBatch\)[\s\S]*?setLastOrb\(revealedOrb\)/,
  );
  const frenzyEffectStart = source.indexOf('  useEffect(() => {\n    if (!state || frenzyRunTriggered || frenzyClaimActiveRef.current) return;');
  const frenzyEffectEnd = source.indexOf('  useEffect(() => {\n    const startedAt = Date.now();', frenzyEffectStart);
  assert.ok(frenzyEffectStart >= 0);
  assert.ok(frenzyEffectEnd > frenzyEffectStart);
  const frenzyEffect = source.slice(frenzyEffectStart, frenzyEffectEnd);
  assert.doesNotMatch(frenzyEffect, /let cancelled = false/);
  assert.doesNotMatch(frenzyEffect, /cancelled = true/);
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
  assert.ok(load.includes("fetch('/api/frenzy/info')"));
  assert.ok(!load.includes('/api/frenzy/arm') && !load.includes('/api/frenzy/claim'));
  const errorStart = source.indexOf('if (error && !info)');
  const errorEnd = source.indexOf('\n  if (!info)', errorStart);
  assert.ok(errorStart >= 0 && errorEnd > errorStart, 'initial load error panel must exist');
  const errorPanel = source.slice(errorStart, errorEnd);
  assert.ok(errorPanel.includes('onClick={() => void load()}'));
  assert.ok(errorPanel.includes('disabled={loadingInfo}'));
});

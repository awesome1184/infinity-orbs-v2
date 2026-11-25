import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cooldownMs, createInitialState, normalizeCelestialAlignmentInstances, celestialAlignmentStackCount, CELESTIAL_ALIGNMENT_DURATION_MS } from '../src/shared/game.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const mainAlignmentChoice = () => source('src/client/main.tsx');

test('Celestial Alignment ignores stale pending polls after a choice succeeds', () => {
  const main = source('src/client/main.tsx');

  assert.ok(main.includes('alignmentDismissedPendingAtRef = useRef(0)'));
  assert.ok(main.includes('const chosenPendingAt = Math.max('));
  assert.ok(main.includes('alignmentPendingSeenRef.current'));
  assert.ok(main.includes('Date.now(),'));
  assert.ok(main.includes('alignmentDismissedPendingAtRef.current = Math.max(alignmentDismissedPendingAtRef.current, chosenPendingAt)'));
  assert.ok(main.includes('const pendingWasDismissed = status.pending &&'));
  assert.ok(main.includes('if (pendingWasDismissed) return;'));
  assert.ok(main.includes('if (!alignmentChoiceBusy && !alignmentChoiceError)'));
});

test('Alignment chooser is a 60-second offer; each selected effect still lasts two hours', () => {
  const main = source('src/client/main.tsx');
  const server = source('src/server/game.ts');
  const shared = source('src/shared/game.ts');
  const choice = server.slice(server.indexOf('export async function chooseCelestialAlignment'), server.indexOf('export async function synthesizeDust'));
  const status = server.slice(server.indexOf('export async function getCelestialAlignmentStatus'), server.indexOf('export async function chooseCelestialAlignment'));

  assert.ok(shared.includes('CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS = 60 * 1_000'));
  assert.ok(main.includes('data-testid="celestial-alignment-choice-timer"'));
  assert.ok(main.includes('window.setInterval(tick, 250)'));
  assert.ok(main.includes('const alignmentPromptCountdown = `${alignmentPromptSecondsLeft}s`;'));
  assert.ok(main.includes('alignmentDismissedPendingAtRef.current = Math.max('));
  assert.ok(main.includes('setAlignmentPromptVisible(false)'));
  assert.ok(main.includes('data-testid="celestial-alignment-duration"'));
  assert.ok(main.includes('>2 hours</strong>'));
  assert.ok(main.includes('Each chosen effect lasts 2 hours'));
  assert.ok(status.includes('now >= pendingAt + CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS'));
  assert.ok(choice.includes('The Alignment choice window expired.'));
  assert.ok(choice.includes('const pendingAt = Number(s.alignmentPendingAt ?? 0)'));
});
test('Clockwork reduces real Auto Roll cooldown by 20%, but does not change manual rolls', () => {
  const now = Date.now();
  const base = createInitialState(now);
  const active = {
    ...base,
    alignmentActiveInstances: [{
      id: 'clockwork-test',
      choice: 'clockwork' as const,
      activatedAt: now,
      expiresAt: now + 60 * 60 * 1000,
    }],
  };

  const regularAutoCooldown = cooldownMs(base, true);
  const clockworkAutoCooldown = cooldownMs(active, true);
  assert.equal(clockworkAutoCooldown, Math.max(300, Math.round(regularAutoCooldown * 0.8)));
  assert.equal(cooldownMs(active, false), cooldownMs(base, false));
});

test('Clockwork applies through the Auto Roll request, server cooldown, and live client timer', () => {
  const client = source('src/client/main.tsx');
  const server = source('src/server/game.ts');
  const app = source('src/server/app.ts');
  const rollHandler = server.slice(
    server.indexOf('export async function roll('),
    server.indexOf('export async function subscribeToSubredditForReward'),
  );

  assert.ok(client.includes('auto: isAutoRoll'));
  assert.ok(app.includes('req.body?.auto === true'));
  assert.ok(rollHandler.includes('const cd = cooldownMs(s, isAuto, liveBalance)'));
  assert.ok(rollHandler.includes('rollsRemainingUntilNext: cd'));
  assert.ok(client.includes('const nextReadyAt = autoRollReadyAt('));
  assert.ok(client.includes('cooldownMs(latest, true, liveBalance)'));
  assert.ok(client.includes('setReadyAt(manualRollReadyAt(lastRollAt, cooldownMs(timingState, false, liveBalance)))'));
});

test('Alignment has no post-claim popup and the active duration is a live Roll-screen countdown', () => {
  const main = source('src/client/main.tsx');
  const roll = source('src/client/components/RollSection.tsx');

  assert.doesNotMatch(main, /celestial-alignment-confirmation|Alignment activated/);
  assert.match(roll, /formatAlignmentRemaining\(instance\.expiresAt - now\)/);
  assert.match(roll, /alignmentInstances\.map\(\(instance, index\)/);
});

test('Sonar Ping selects near-record or new-best triggers and has a Celestial Alignment sound bypass', () => {
  const roll = source('src/client/components/RollSection.tsx');
  const sound = source('src/client/sound.ts');
  const main = source('src/client/main.tsx');

  assert.match(roll, /hasSonarUpgrade && sonarActive/);
  assert.match(roll, /sonar-alert-mode/);
  assert.match(roll, /value=\{sonarAlertMode\}/);
  assert.match(roll, /At least 1\/10th below a new best/);
  assert.match(roll, /value="new-best"/);
  assert.match(roll, /Math\.ceil\(Math\.max\(2, bestBefore\) \* 0\.9\)/);
  assert.match(roll, /lastOrb\.rarity < bestBefore/);
  assert.match(roll, /sonarAlignmentSoundsAllowed/);
  assert.match(roll, /setSonarAlignmentSoundsAllowed/);
  assert.match(sound, /setSonarAlertMode/);
  assert.match(sound, /setSonarAlignmentSoundsAllowed/);
  assert.match(sound, /this\.playSample\(SOUND_ASSETS\.alignment, 0\.14, this\.sonarAlignmentSoundsAllowed\)/);
  assert.doesNotMatch(main, /sonarStarseekerAlerts/);
  assert.doesNotMatch(main, /choice === 'starseeker'[\s\S]{0,240}playSonarPing/);
});

test('Starseeker amplifies ordinary Luck but never exponentiates Rune Luck', () => {
  const roll = source('src/client/components/RollSection.tsx');
  const server = source('src/server/game.ts');
  assert.match(roll, /Math\.pow\(starseekerBaseLuck, Math\.pow\(1\.05, starseekerStacks\)\)/);
  assert.match(roll, /alignedBaseLuck \* combatRuneLuckMultiplier\(runeLuckPct\)/);
  assert.match(server, /Math\.pow\(baseLuck, starseekerExponent\)/);
  assert.match(server, /const runeLuckMultiplier = rawRuneLuckMultiplier/);
  assert.doesNotMatch(server, /Math\.pow\(baseLuck \* rawRuneLuckMultiplier/);
  assert.doesNotMatch(server, /starseekerActive \? 1 : rawRuneLuckMultiplier/);
  assert.match(mainAlignmentChoice(), /Rune Luck is applied separately and is not amplified/);
});

test('admin-forced Alignment effects remain visible without unlocking mastery', () => {
  const server = source('src/server/game.ts');
  const statusHandler = server.slice(
    server.indexOf('export async function getCelestialAlignmentStatus'),
    server.indexOf('export async function chooseCelestialAlignment'),
  );

  assert.ok(statusHandler.includes('if (!hasMastery && !forcedPending)'));
  assert.ok(statusHandler.includes('const activeInstances = activeCelestialAlignmentInstances(s.alignmentActiveInstances, now)'));
  assert.ok(statusHandler.includes('activeUntil: latest?.expiresAt ?? 0'));
  assert.ok(statusHandler.includes('unlocked: false'));
});

test('Alignment statistics are a retryable post-commit projection, not a reason to reject a saved choice', () => {
  const server = source('src/server/game.ts');
  const choiceHandler = server.slice(
    server.indexOf('export async function chooseCelestialAlignment'),
    server.indexOf('export async function synthesizeDust'),
  );
  const statsWriter = server.slice(
    server.indexOf('async function recordCelestialAlignmentChoiceStats'),
    server.indexOf('export async function forceCelestialAlignmentPromptForCurrentUser'),
  );

  assert.ok(choiceHandler.includes('stageSavePostCommitAction(s, async () =>'));
  assert.ok(choiceHandler.includes('await recordCelestialAlignmentChoiceStats(choice, username, now, wasAdminTest)'));
  assert.ok(choiceHandler.indexOf('stageSavePostCommitAction(s') < choiceHandler.indexOf('await save(s)'));
  assert.ok(!choiceHandler.includes('Alignment choice statistics changed during your selection'));
  assert.ok(statsWriter.includes('const maxAttempts = 16'));
  assert.ok(statsWriter.includes('redis.watch(CELESTIAL_ALIGNMENT_CHOICE_STATS_KEY)'));
  assert.ok(statsWriter.includes('if (committed !== null) return;'));
  assert.ok(statsWriter.includes('const alreadyRecorded = previous.recent.some'));
  assert.ok(statsWriter.includes('Player choice was saved, but shared choice statistics could not be updated.'));
});

test('API and player mutations share one distributed lock instead of double-locking requests', () => {
  const app = source('src/server/app.ts');
  const playerLock = source('src/server/player-lock.ts');
  assert.ok(app.includes('const mutationQueues = new Map<string, Promise<void>>()'));
  assert.ok(app.includes('Cross-instance correctness'));
  assert.ok(!app.includes('MUTATION_LOCK_PREFIX'));
  assert.ok(!app.includes('acquireMutationLock'));
  assert.ok(playerLock.includes('const PLAYER_MUTATION_LOCK_ATTEMPTS = 400'));
  assert.ok(playerLock.includes('const PLAYER_MUTATION_LOCK_RETRY_MS = 25'));
  assert.ok(playerLock.includes("throw new Error('PLAYER_MUTATION_QUEUED')"));
});

test('Celestial Alignment events use a bounded 20–30 minute interval averaging 25 minutes', () => {
  const shared = source('src/shared/game.ts');
  const server = source('src/server/game.ts');
  assert.match(shared, /CELESTIAL_ALIGNMENT_MIN_INTERVAL_MS = 20 \* 60 \* 1_000/);
  assert.match(shared, /CELESTIAL_ALIGNMENT_MAX_INTERVAL_MS = 30 \* 60 \* 1_000/);
  assert.match(shared, /CELESTIAL_ALIGNMENT_DURATION_MS = 2 \* 60 \* 60 \* 1_000/);
  const scheduler = server.slice(server.indexOf('function nextCelestialAlignmentAt'), server.indexOf('export async function getCelestialAlignmentStatus'));
  assert.match(scheduler, /CELESTIAL_ALIGNMENT_MIN_INTERVAL_MS/);
  assert.match(scheduler, /CELESTIAL_ALIGNMENT_MAX_INTERVAL_MS/);
  assert.doesNotMatch(scheduler, /-Math\.log\(1 - sample\)/);
});

test('Celestial Alignment choice appends an independently expiring stack instance', () => {
  const server = source('src/server/game.ts');
  const choice = server.slice(server.indexOf('export async function chooseCelestialAlignment'), server.indexOf('export async function synthesizeDust'));
  assert.match(choice, /const nextInstances = \[\.\.\.activeInstances, instance\]/);
  assert.match(choice, /expiresAt: now \+ CELESTIAL_ALIGNMENT_DURATION_MS/);
  assert.match(choice, /const pendingAt = Number\(s\.alignmentPendingAt \?\? 0\)/);
  assert.match(choice, /CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS/);
  assert.match(choice, /choice window expired/i);
  assert.match(choice, /s\.alignmentActiveInstances = nextInstances/);
  assert.doesNotMatch(choice, /s\.alignmentActiveInstances = \[instance\]/);
});

test('Starseeker, Golden Orbit, and Clockwork stack multiplicatively', () => {
  const shared = source('src/shared/game.ts');
  const server = source('src/server/game.ts');
  assert.match(shared, /Math\.pow\(0\.80, clockworkStacks\)/);
  assert.match(server, /Math\.pow\(1\.05, starseekerStacks\)/);
  assert.match(server, /Math\.pow\(1\.5, goldenOrbitStacks\)/);
});

test('Boosters menu lists each active Alignment instance and its separate expiry', () => {
  const boosters = source('src/client/components/BoostersAndAutomation.tsx');
  assert.match(boosters, /data-testid="stacked-alignment-buffs"/);
  assert.match(boosters, /alignmentInstances\.map\(\(instance, index\)/);
  assert.match(boosters, /instance\.expiresAt - now/);
  assert.match(boosters, /Matching effects stack multiplicatively/);
});

test('Alignment migration preserves legacy effects and new choices stack for two hours independently', () => {
  const now = 1_800_000_000_000;
  const legacyExpiresAt = now + 30 * 60_000;
  const legacy = normalizeCelestialAlignmentInstances(undefined, 'starseeker', legacyExpiresAt, now);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].activatedAt, legacyExpiresAt - 60 * 60_000);
  assert.equal(legacy[0].expiresAt, legacyExpiresAt);

  const first = {
    id: 'alignment-a',
    choice: 'goldenOrbit' as const,
    activatedAt: now,
    expiresAt: now + CELESTIAL_ALIGNMENT_DURATION_MS,
  };
  const second = {
    id: 'alignment-b',
    choice: 'goldenOrbit' as const,
    activatedAt: now + 10_000,
    expiresAt: now + 10_000 + CELESTIAL_ALIGNMENT_DURATION_MS,
  };
  const active = normalizeCelestialAlignmentInstances([first, second], undefined, undefined, now);
  assert.equal(active.length, 2);
  assert.equal(celestialAlignmentStackCount(active, 'goldenOrbit', now), 2);
  assert.equal(celestialAlignmentStackCount(active, 'goldenOrbit', first.expiresAt + 1), 1);
  assert.equal(CELESTIAL_ALIGNMENT_DURATION_MS, 2 * 60 * 60_000);
});


test('Alignment queue grace applies only to choices admitted before the visible deadline', () => {
  const shared = source('src/shared/game.ts');
  const server = source('src/server/game.ts');
  const status = server.slice(
    server.indexOf('export async function getCelestialAlignmentStatus'),
    server.indexOf('export async function chooseCelestialAlignment'),
  );
  const choice = server.slice(
    server.indexOf('export async function chooseCelestialAlignment'),
    server.indexOf('export async function synthesizeDust'),
  );

  assert.match(shared, /CELESTIAL_ALIGNMENT_CHOICE_GRACE_MS = 30 \* 1_000/);
  assert.match(status, /CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS \+ CELESTIAL_ALIGNMENT_CHOICE_GRACE_MS/);
  assert.match(status, /now < Number\(s\.alignmentPendingAt\) \+ CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS/);
  assert.match(choice, /const choiceQueuedAt = Date\.now\(\)/);
  assert.match(choice, /choiceQueuedAt >= pendingAt \+ CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS/);
  assert.match(choice, /now >= pendingAt \+ CELESTIAL_ALIGNMENT_CHOICE_WINDOW_MS \+ CELESTIAL_ALIGNMENT_CHOICE_GRACE_MS/);
});

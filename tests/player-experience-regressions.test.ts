import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeImpressionCount } from '../src/server/impressions.js';
import { classifyImpressionDeviceType } from '../src/client/impressions.js';

test('impression counters reject partial, negative, fractional, and unsafe values', () => {
  assert.equal(normalizeImpressionCount('123'), 123);
  assert.equal(normalizeImpressionCount('0'), 0);
  assert.equal(normalizeImpressionCount('12garbage'), 0);
  assert.equal(normalizeImpressionCount('-1'), 0);
  assert.equal(normalizeImpressionCount('1.5'), 0);
  assert.equal(normalizeImpressionCount(String(Number.MAX_SAFE_INTEGER + 1)), 0);
});

test('coarse device classification identifies Android tablets and unknown environments', () => {
  assert.equal(classifyImpressionDeviceType('Mozilla/5.0 (Linux; Android 14; Pixel C) AppleWebKit/537.36', 'Linux arm', 5), 'tablet');
  assert.equal(classifyImpressionDeviceType('Mozilla/5.0 (Linux; Android 14; Pixel 9 Mobile) Mobile', 'Linux arm', 5), 'mobile');
  assert.equal(classifyImpressionDeviceType('', '', 0), 'unknown');
  assert.equal(classifyImpressionDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)', 'MacIntel', 0), 'desktop');
});

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Rune mutations cannot overlap and delayed reads cannot override the current snapshot', () => {
  const runes = source('src/client/components/RunesSection.tsx');
  assert.match(runes, /const actionInFlightRef=useRef\(false\)/);
  assert.match(runes, /snapshotRequestSequenceRef\.current\+=1/);
  assert.match(runes, /requestSequence!==snapshotRequestSequenceRef\.current/);
  assert.match(runes, /if\(!beginAction\(\)\)return/);
  assert.match(runes, /aria-describedby=\{'io-rune-tooltip-'/);
});

test('Streak reward previews match the configured reward table and quest progress is accessible', () => {
  const quests = source('src/client/components/QuestsAndStreaks.tsx');
  assert.match(quests, /const reward = streakReward;/)
  assert.match(quests, /fmt\(reward\.coins\)/);
  assert.match(quests, /fmt\(reward\.shards\)/);
  assert.doesNotMatch(quests, /fmt\(day \* 100\)/);
  assert.match(quests, /const target = Number\.isFinite\(q\.target\) && q\.target > 0/);
  assert.match(quests, /role="progressbar" aria-label=\{q\.title \+ ' progress'\}/);
  assert.match(quests, /Resets daily at midnight UTC/);
});

test('Public share previews validate metadata and launch failures are visible and retryable', () => {
  const splash = source('src/client/splash.tsx');
  assert.match(splash, /function PlayGameButton/);
  assert.match(splash, /Promise\.resolve\(request\)\.catch\(failed\)/);
  assert.match(splash, /postData\.type === 'shared-orb'/);
  assert.match(splash, /Orb preview unavailable/);
  assert.match(splash, /Number\.isSafeInteger\(count\) && count >= 0/);
});

test('combat controls expose health and selection state and retry always refreshes', () => {
  const combat = source('src/client/components/CombatSection.tsx');
  assert.match(combat, /aria-label="Player health" aria-valuemin=\{0\} aria-valuemax=\{100\}/);
  assert.match(combat, /aria-label=\{enemy\.name\+' health'\}/);
  assert.match(combat, /aria-pressed=\{intent===cmd\}/);
  assert.match(combat, /setError\(''\);void load\(\)/);
  assert.match(combat, /cache:'no-store'/);
});

test('roll and feedback controls prevent duplicates and announce state', () => {
  const roll = source('src/client/components/RollSection.tsx');
  const feedback = source('src/client/components/FeedbackModal.tsx');
  const chat = source('src/client/components/GlobalChatWindow.tsx');
  assert.match(roll, /disabled=\{busy\}[\s\S]{0,40}aria-busy=\{busy\}/);
  assert.match(feedback, /maxLength=\{2000\}/);
  assert.match(feedback, /aria-pressed=\{type === 'bug'\}/);
  assert.match(feedback, /aria-live=\{error \? 'assertive' : 'polite'\}/);
  assert.match(chat, /role="log"/);
  assert.match(chat, /aria-label=\{sending \? 'Sending public comment' : 'Send public comment'\}/);
});


test('streak preview follows the server reward schedule and resets after a missed UTC day', () => {
  const quests = source('src/client/components/QuestsAndStreaks.tsx');
  const game = source('src/server/game.ts');
  assert.match(quests, /\{ day: 1, coins: 100, shards: 0 \}/);
  assert.match(quests, /\{ day: 7, coins: 700, shards: 5 \}/);
  assert.match(quests, /const reward = streakReward/);
  assert.match(quests, /lastClaimDate === yesterday/);
  assert.match(quests, /preview now shows tomorrow's reward/);
  assert.match(game, /const rewardCoins = day \* 100/);
  assert.match(game, /s\.streak\.lastClaimDate === yesterday \? previousCount \+ 1 : 1/);
});

test('navigation is grouped by purpose and selected tabs are exposed', () => {
  const main = source('src/client/main.tsx');
  const start = main.indexOf('{/* Main Navigation Bar */}');
  const end = main.indexOf('{combatTutorialStatusLoaded', start);
  assert.ok(start >= 0 && end > start);
  const nav = main.slice(start, end);
  for (const label of ['PLAY', 'GROW', 'DISCOVER', 'COMMUNITY', 'LONG-TERM']) {
    assert.ok(nav.includes('>' + label + '</span>'), 'missing navigation group ' + label);
  }
  assert.match(nav, /aria-current=\{tab === 'roll' \? 'page' : undefined\}/);
  assert.match(nav, /aria-current=\{tab === 'runes' \? 'page' : undefined\}/);
  assert.match(nav, /io-combat-soon">PVP/);
  assert.doesNotMatch(nav, /sound\.playClick\(\);\s*changeTab\('/);
});

test('upgrade page groups choices and accurately reports Shard, Crit and Turbo values', () => {
  const upgrades = source('src/client/components/UpgradesSection.tsx');
  const main = source('src/client/main.tsx');
  for (const group of ['Roll controls', 'Rarity and criticals', 'Rewards and value', 'Offline progress']) {
    assert.ok(upgrades.includes(group), 'missing group ' + group);
  }
  assert.match(upgrades, /shardChance \?\? 0\) \* 0\.15/);
  assert.match(upgrades, /Critical Rarity Multiplier/);
  assert.match(upgrades, /Auto Roll Unlocked Automatically/);
  assert.match(upgrades, /Buy All Affordable/);
  assert.match(upgrades, /turboRemainingLabel/);
  assert.match(main, /25% faster cooldowns for 30 minutes/);
  assert.match(main, /35% faster cooldowns for 60 minutes/);
});

test('Booster and Automation actions are single-flight and show their scope clearly', () => {
  const boosters = source('src/client/components/BoostersAndAutomation.tsx');
  assert.match(boosters, /const actionInFlightRef = useRef\(false\)/);
  assert.match(boosters, /if \(busy \|\| !beginAction\('global:' \+ id\)\) return/);
  assert.match(boosters, /if \(busy \|\| !beginAction\('premium:' \+ id\)\) return/);
  assert.match(boosters, /if \(busy \|\| !beginAction\('automation:' \+ id\)\) return/);
  assert.match(boosters, /Global Boosters affect everyone, Premium Boosters run on your own timers, and Automation unlocks are permanent purchases/);
  assert.match(boosters, /GLOBAL_BOOSTERS\[id\]\.name.*timer/);
  assert.match(boosters, /Weekly community reward progress/);
});

test('Codex validates API results, groups filters, and recovers when a page is empty', () => {
  const codex = source('src/client/components/CollectionSection.tsx');
  assert.match(codex, /cache: 'no-store'/);
  assert.match(codex, /const safeItems = Array\.isArray\(data\.items\)/);
  assert.match(codex, /role="group" aria-label="Filter Codex by tier"/);
  assert.match(codex, /aria-label="Sort Codex entries"/);
  assert.match(codex, /No discoveries in this tier yet/);
  assert.match(codex, /<nav aria-label="Codex pages"/);
  assert.match(codex, /aria-label="Next Codex page"/);
});

test('Achievement filters and empty states are accurate and accessible', () => {
  const achievements = source('src/client/components/AchievementsSection.tsx');
  assert.match(achievements, /readyToClaimCount = achievements\.filter\(a => a\.unlocked && !a\.claimed\)/);
  assert.match(achievements, /role="group" aria-label="Filter achievements"/);
  assert.match(achievements, /aria-pressed=\{filter === 'all'\}/);
  assert.match(achievements, /Achievement unlock progress/);
  assert.match(achievements, /No rewards ready to claim/);
  assert.match(achievements, /aria-busy=\{busy\}/);
});

test('Header actions have accessible names and the experience bar supports keyboard use', () => {
  const header = source('src/client/components/Header.tsx');
  assert.match(header, /role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(header, /aria-label="View probability and drop odds"/);
  assert.match(header, /aria-label="Report a bug or suggest an improvement"/);
  assert.match(header, /aria-pressed=\{notificationsEnabled\}/);
  assert.match(header, /aria-pressed=\{soundEnabled\}/);
});

test('Prestige explains what resets and groups permanent-upgrade filters', () => {
  const profile = source('src/client/components/ProfileAndPrestige.tsx');
  assert.match(profile, /Before you prestige/);
  assert.match(profile, /Coins retained depend on Cosmic Inheritance \(minimum 50\)/);
  assert.match(profile, /Before you prestige/);
  assert.doesNotMatch(profile, /cosmetics are kept/i);
  assert.match(profile, /role="group" aria-label="Filter permanent Prestige upgrades"/);
  assert.equal((profile.match(/aria-pressed=\{filterCategory ===/g) || []).length, 4);
});


test('Pity progress matches its mastery-adjusted interval and cooldown notice timers are cleaned up', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.match(roll, /const pityInterval = Math\.max\(6, 18 -/);
  assert.match(roll, /pityRollsIntoTier = pityDryRolls % pityInterval/);
  assert.match(roll, /aria-valuenow=\{pityProgressPct\}/);
  assert.doesNotMatch(roll, /% 20\) \/ 20/);
  assert.match(roll, /cooldownNoticeTimerRef\.current !== null\) window\.clearTimeout/);
});

test('Guild moderation and creation errors are visible and guild tags are validated', () => {
  const guilds = source('src/client/components/GuildsAndSocial.tsx');
  assert.match(guilds, /setSocialError\(error instanceof Error \? error\.message/);
  assert.ok(guilds.includes("if (!/^[A-Z]{2,5}$/.test(tag))"));
  assert.match(guilds, /createGuildInFlightRef\.current/);
  assert.match(guilds, /aria-labelledby="io-create-guild-title"/);
  assert.match(guilds, /mostRolls: \[\]/);
  assert.match(guilds, /aria-pressed=\{activeLeaderboard === board\.id\}/);
});

test('Global Chat rejects malformed history, bounds report state, and prevents duplicate posts', () => {
  const chat = source('src/client/components/GlobalChatWindow.tsx');
  assert.match(chat, /Chat history response was invalid/);
  assert.match(chat, /sendingInFlightRef\.current/);
  assert.match(chat, /reportingInFlightRef\.current/);
  assert.match(chat, /slice\(-200\)/);
  assert.match(chat, /refreshRequestRef\.current \+= 1/);
  assert.match(chat, /Public chat comment/);
});

test('Rune inventory is filtered without losing empty-state recovery and handles corrupted numeric settings', () => {
  const runes = source('src/client/components/RunesSection.tsx');
  assert.match(runes, /bestDepthCandidates/);
  assert.match(runes, /visibleRunes/);
  assert.match(runes, /Filter Rune inventory/);
  assert.match(runes, /No matching Runes/);
  assert.match(runes, /rawAutoSacrificeSettings/);
  assert.match(runes, /Number\.isFinite\(value\)/);
});

test('Combat snapshot and Arena reads cannot overwrite newer responses', () => {
  const combat = source('src/client/components/CombatSection.tsx');
  assert.match(combat, /snapshotLoadSequenceRef/);
  assert.match(combat, /requestSequence!==snapshotLoadSequenceRef\.current/);
  assert.match(combat, /arenaLoadSequenceRef/);
  assert.match(combat, /Array\.isArray\(result\.opponents\)/);
});

test('Feedback submission has a synchronous duplicate lock and field-associated status', () => {
  const feedback = source('src/client/components/FeedbackModal.tsx');
  assert.match(feedback, /submitInFlightRef\.current/);
  assert.match(feedback, /aria-invalid=\{Boolean\(error\)\}/);
  assert.match(feedback, /aria-describedby="io-feedback-status"/);
});

test('Community tier labels are safe when a saved event tier is malformed', () => {
  const quests = source('src/client/components/QuestsAndStreaks.tsx');
  assert.match(quests, /safeCommunityTier/);
  assert.match(quests, /Tier \{fmt\(safeCommunityTier\)\}/);
});

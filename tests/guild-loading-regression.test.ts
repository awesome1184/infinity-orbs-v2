import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Guild and world-event polling use independent in-flight locks', () => {
  const main = source('src/client/main.tsx');
  const refreshStart = main.indexOf('const refreshCommunityState = () =>');
  const start = main.lastIndexOf('useEffect(() => {', refreshStart);
  const end = main.indexOf('\n    const onVisibilityChange', refreshStart);
  assert.ok(refreshStart >= 0 && start >= 0 && end > refreshStart, 'community polling effect must exist');
  const poll = main.slice(start, end);
  assert.match(poll, /let worldEventInFlight = false/);
  assert.match(poll, /let guildInFlight = false/);
  assert.match(poll, /if \(!worldEventInFlight\)/);
  assert.match(poll, /if \(tab === 'social' && !guildInFlight\)/);
  assert.match(poll, /finally \{\s+worldEventInFlight = false/);
  assert.match(poll, /finally \{\s+guildInFlight = false/);
  assert.match(poll, /getJson<WorldEvent \| null>\('\/api\/world-event'\)/);
  assert.match(poll, /getJson<\{ guilds: Guild\[\]; mine: Guild \| null \}>\('\/api\/guilds', \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(poll, /await Promise\.all/);
});

test('Failed Guild requests preserve the last successful snapshot and expose retry', () => {
  const main = source('src/client/main.tsx');
  const guildUi = source('src/client/components/GuildsAndSocial.tsx');
  assert.doesNotMatch(main, /catch\(\(\) => \(\{ guilds: \[\], mine: null \}\)\)/);
  assert.match(main, /setGuildData\(gd\)/);
  assert.match(main, /setGuildLoadError\(error instanceof Error \? error\.message/);
  assert.match(guildUi, /Guild data could not be loaded/);
  assert.match(guildUi, /Retry loading/);
});

test('Production Guild parsing repairs non-authoritative nested state before strict validation', () => {
  const social = source('src/server/social.ts');
  const recoveryStart = social.indexOf('function normalizeRecoverableGuildNestedFields(');
  const recoveryEnd = social.indexOf('\nfunction validateGuildNestedState(', recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart,
    'production nested-state recovery helper must exist');
  const recovery = social.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /guild\.tasks = guild\.tasks\.slice\(0, 3\)\.map/);
  assert.match(recovery, /delete guild\.chat/);
  assert.match(recovery, /delete guild\.boss/);
  assert.match(recovery, /guild\.perks\[rank\] = clampInteger/);
  assert.match(recovery, /const comboEndsAt = clampInteger\(guild\.combo\.endsAt,/);
  assert.match(recovery, /const comboLastTickAt = clampInteger\(guild\.combo\.lastTickAt,/);
  assert.match(recovery, /guild\.combo\.endsAt = comboEndsAt/);
  assert.match(recovery, /guild\.combo\.lastTickAt = comboLastTickAt/);
  assert.match(recovery, /clampInteger\(task\.tier, 1, MAX_GUILD_TASK_TIER, 1\)/);
  assert.match(recovery, /normalizeGuildValueProgress\(task\.target\)/);
  assert.match(recovery, /normalizeGuildValueProgress\(task\.progress\)/);
  assert.doesNotMatch(recovery, /guild\.id\s*=/);
  assert.doesNotMatch(recovery, /member\.role\s*=/);
  assert.doesNotMatch(recovery, /member\.userId\s*=/);

  const parserStart = social.indexOf('function parseGuildListRaw(');
  const parserEnd = social.indexOf('\nfunction parseGuildList(', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'Guild parser boundaries must exist');
  const parser = social.slice(parserStart, parserEnd);
  const recoveryCall = parser.indexOf('normalizeRecoverableGuildNestedFields(item, index)');
  const strictValidation = parser.indexOf('validateGuildNestedState(item as Record<string, unknown>)');
  assert.ok(recoveryCall >= 0 && strictValidation > recoveryCall,
    'nested non-authoritative fields must be repaired before validation');
  assert.match(parser, /\['owner', 'officer', 'member'\]\.includes\(\(member as any\)\.role\)/);
  assert.match(parser, /\(\(member as any\)\.userId == null \|\| typeof \(member as any\)\.userId === 'string'\)/);
});


test('Guild activity logs are removed from the player UI and no longer persisted', () => {
  const guildUi = source('src/client/components/GuildsAndSocial.tsx');
  const social = source('src/server/social.ts');
  const app = source('src/server/app.ts');
  assert.doesNotMatch(guildUi, /Guild Log|GuildMessage|chatMessages|handleReportChat|\/api\/guilds\/chat/);
  assert.doesNotMatch(social, /guild\.chat\.push\s*\(/);
  assert.match(social, /delete guild\.chat/);
  assert.doesNotMatch(app, /\/api\/guilds\/chat/);
});


test('Guild directory reads no longer depend on the retired Guild chat-moderation hash', () => {
  const social = source('src/server/social.ts');
  const start = social.indexOf('export async function guildInfo()');
  const end = social.indexOf('export async function getPlayerGuildContext(', start);
  assert.ok(start >= 0 && end > start);
  const handler = social.slice(start, end);
  assert.doesNotMatch(handler, /GUILD_CHAT_MUTES_KEY|hGetAll|filterMutedGuildChat|guild\.chat/);
  assert.match(handler, /guilds: visibleGuilds/);
  assert.match(handler, /mine: visibleMine/);
});

test('Guild page is named in the main navigation', () => {
  const main = source('src/client/main.tsx');
  assert.match(main, /renderNavItem\('social', 'Guilds', Users\)/);
  assert.match(main, /renderNavItem\('social', 'Guilds', Users, false, 'io-nav-mobile-only'\)/);
  assert.match(main, /social: 'Guilds'/);
});


test('Production Guild parser accepts current level-free Guild records', () => {
  const social = source('src/server/social.ts');
  const parserStart = social.indexOf('function parseGuildListRaw(');
  const parserEnd = social.indexOf('function parseLeaderboardList(', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'raw Guild parser must exist');
  const parser = social.slice(parserStart, parserEnd);
  assert.doesNotMatch(parser, /Number\.isFinite\(\(item as any\)\.level\)/);
  assert.doesNotMatch(parser, /Number\.isFinite\(\(item as any\)\.xp\)/);
  assert.match(parser, /Number\.isFinite\(\(item as any\)\.tokens\)/);
  const createStart = social.indexOf('export async function createGuild(');
  const createEnd = social.indexOf('export async function joinGuild(', createStart);
  assert.ok(createStart >= 0 && createEnd > createStart, 'Guild creator must exist');
  assert.doesNotMatch(social.slice(createStart, createEnd), /\blevel\s*:|\bxp\s*:/);
});

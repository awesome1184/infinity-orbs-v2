import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildGuildUserFlair,
  normalizeGuildName,
  guildMemberMatchesIdentity,
  promoteGuildOwnerIfNeeded,
} from '../src/shared/social.js';

test('guild names are normalized safely for the public directory and Reddit flair', () => {
  assert.equal(normalizeGuildName('  Celestial\tKnights   '), 'Celestial Knights');
  assert.equal(normalizeGuildName('x'.repeat(40)).length, 32);
  assert.equal(normalizeGuildName(null), '');
});

test('Reddit guild flair includes the custom guild name and each member’s highest orb tier', () => {
  assert.equal(buildGuildUserFlair('Celestial Knights', 'Omega'), 'Celestial Knights - Omega');
  assert.equal(buildGuildUserFlair('', 'Omega'), 'Omega');
  assert.equal(buildGuildUserFlair('Celestial Knights', ''), 'Celestial Knights');
  assert.ok(buildGuildUserFlair('x'.repeat(32), 'T'.repeat(40)).length <= 64);
});

test('guild creation accepts a custom name and unique 2–5 character tag without an approval request', () => {
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  const createStart = social.indexOf('export async function createGuild');
  const joinStart = social.indexOf('export async function joinGuild', createStart);
  const createGuild = social.slice(createStart, joinStart);
  assert.match(createGuild, /const cleanName = normalizeGuildName\(name\)/);
  assert.match(createGuild, /cleanName\.length < 3/);
  assert.match(createGuild, /cleanTag\.length < 2/);
  assert.match(createGuild, /name: cleanName/);
  assert.doesNotMatch(createGuild, /requestedName|nameStatus|approval/i);
});

test('the one-time restore migration recovers pending custom names and clears legacy approval metadata', () => {
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  assert.match(social, /applyGuildCustomNameRestoreMigration/);
  assert.match(social, /requestedNameByGuild\.get\(guild\.id\)/);
  assert.match(social, /guild\.name = requestedName/);
  assert.match(social, /delete guild\.nameStatus/);
  assert.match(social, /GUILD_FLAIR_NAMES_KEY/);
  assert.doesNotMatch(social, /applyGuildNameReviewMigration|reviewGuildNameRequest|getGuildNameRequests/);
});

test('creating, joining, leaving, and kicking update the affected player flair mapping', () => {
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  for (const functionName of ['createGuild', 'joinGuild', 'leaveGuild', 'kickGuildMember']) {
    const start = social.indexOf(`export async function ${functionName}`);
    assert.ok(start >= 0, `missing ${functionName}`);
    const next = social.indexOf('\nexport async function ', start + 1);
    const block = social.slice(start, next < 0 ? social.length : next);
    assert.match(block, /flair\.(set|remove)/);
    assert.match(block, /syncCurrentPlayerRarityFlair|syncPlayerRarityFlair/);
  }
});

test('guild names are added to the existing post-save Reddit rarity flair updater', () => {
  const game = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const start = game.indexOf('async function syncRarityFlair');
  const end = game.indexOf('export async function syncCurrentPlayerRarityFlair', start);
  const updater = game.slice(start, end);
  assert.match(updater, /buildGuildUserFlair\(guildName, orbInfo\.tier\)/);
  assert.match(updater, /reddit\.setUserFlair/);
  assert.match(updater, /cached\?\.orbTier === orbInfo\.tier/);
  const getMe = game.slice(game.indexOf('export async function getMe'), game.indexOf('export async function checkOffline'));
  assert.match(getMe, /void syncRarityFlair\(s\)/);
});

test('guild member identity remains anchored to Reddit user ID and ownership transfers safely', () => {
  const member = { username: 'shadow_fen', userId: 't2_old' };
  assert.equal(guildMemberMatchesIdentity(member, 'shadow_fen', 't2_old'), true);
  assert.equal(guildMemberMatchesIdentity(member, 'shadow_fen', 't2_new'), false);
  assert.equal(guildMemberMatchesIdentity(member, 'shadow_fen'), false);
  assert.equal(guildMemberMatchesIdentity({ username: 'legacy_user' }, 'legacy_user', 't2_new'), true);

  const members: Array<{ username: string; contribution: number; role: 'owner' | 'officer' | 'member'; trusted?: boolean }> = [
    { username: 'one', contribution: 100, role: 'member' },
    { username: 'two', contribution: 500, role: 'officer', trusted: false },
  ];
  promoteGuildOwnerIfNeeded(members);
  assert.equal(members[1]?.role, 'owner');
  assert.equal(members[1]?.trusted, true);
  promoteGuildOwnerIfNeeded(members);
  assert.equal(members.filter(member => member.role === 'owner').length, 1);
});

test('guild creation UI restores the original custom name and tag inputs', () => {
  const ui = readFileSync(resolve(process.cwd(), 'src/client/components/GuildsAndSocial.tsx'), 'utf8');
  assert.match(ui, /Guild Name/);
  assert.match(ui, /Guild Tag/);
  assert.match(ui, /value=\{createName\}/);
  assert.match(ui, /value=\{createTag\}/);
  assert.doesNotMatch(ui, /Guild Name Approval|Request a Custom Name|Temporary Public Name/);
});

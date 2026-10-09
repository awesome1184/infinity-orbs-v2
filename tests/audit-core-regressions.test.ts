import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { masterySkillCost } from '../src/shared/game.js';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('ticket API has no exposed seed or client-side deterministic reward prediction', () => {
  const server = source('src/server/game.ts');
  const client = source('src/client/main.tsx');
  const start = server.indexOf('export async function getRollTicket');
  const end = server.indexOf('async function loadRollTicketForUse', start);
  assert.ok(start >= 0 && end > start);
  const api = server.slice(start, end);
  assert.doesNotMatch(api, /seed\s*:\s*(?:current|ticket)\.seed/);
  assert.doesNotMatch(api, /seed:\s*number/);
  assert.doesNotMatch(client, /predictRollActivation|rollTicketSeed|ticket\.seed/);
  assert.doesNotMatch(server, /createSeededRandom\(rollTicketSeed/);
  assert.match(server, /await applyRolls\(s, 1, undefined, 'online'\)/);
});

test('wiped-generation mutations throw instead of returning discarded rewards as successful', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('if (stateGeneration !== generation)');
  const end = server.indexOf('const latest = latestRaw', start);
  assert.ok(start >= 0 && end > start);
  const block = server.slice(start, end);
  assert.match(block, /invalidated by an admin wipe/);
  assert.doesNotMatch(block, /Object\.assign\(s, fresh\)|return;/);
});

test('mastery helper rejects prototype keys and invalid levels', () => {
  assert.throws(() => masterySkillCost('constructor' as never, 0), /Unknown mastery skill/);
  assert.throws(() => masterySkillCost('__proto__' as never, 0), /Unknown mastery skill/);
  assert.throws(() => masterySkillCost('toString' as never, 0), /Unknown mastery skill/);
  assert.throws(() => masterySkillCost('continuumLuck', Number.NaN), /Mastery skill level is invalid/);
  assert.throws(() => masterySkillCost('continuumLuck', -1), /Mastery skill level is invalid/);
});

test('mastery endpoint validates skill IDs before service call', () => {
  const app = source('src/server/app.ts');
  assert.match(app, /hasOwnProperty\.call\(MASTERY_SKILLS, skillId\)/);
});

test('ban middleware fails closed if it cannot verify a user is not banned', () => {
  const app = source('src/server/app.ts');
  const catchAt = app.indexOf("console.error('Game ban check failed:'");
  const end = app.indexOf('// Reddit\'s payment callback', catchAt);
  assert.ok(catchAt >= 0 && end > catchAt);
  assert.match(app.slice(catchAt, end), /return res\.status\(503\)\.json/);
});

test('Prestige optimistic state preserves Shards', () => {
  const client = source('src/client/main.tsx');
  assert.match(client, /keptShards = current\.shards \?\? 0/);
  assert.doesNotMatch(client, /keptShards = Math\.floor/);
});

test('game viewport permits user zoom', () => {
  const html = source('src/client/game.html');
  assert.match(html, /name=\"viewport\" content=\"width=device-width, initial-scale=1\.0\"/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1\.0/);
});

test('community event config rejects zero/Infinity and malformed stored state is not defaulted', () => {
  const social = source('src/server/social.ts');
  assert.match(social, /Number.isSafeInteger(config.goal)/);
  assert.match(social, /function assertValidCommunityEvent/);
  assert.match(social, /parseCommunityEventForMutation(raw)/);
  assert.match(social, /assertValidCommunityEvent(ev);\s*while \(ev.currentProgress >= ev.goal\)/);
});

test('rarity RNG clamps zero to a real 64-bit sample step', () => {
  const shared = source('src/shared/game.ts');
  assert.match(shared, /Math.max\(1 \/ 18_446_744_073_709_551_616, sample\)/);
});
test('global booster debit and shared activation are committed through one save transaction', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('async function claimWorldBoosterActivation');
  const end = server.indexOf('export async function activateGlobalBooster', start);
  assert.ok(start >= 0 && end > start);
  const claim = server.slice(start, end);
  assert.match(claim, /await save\\(s, \\{/);
  assert.match(claim, /key: GLOBAL_BOOSTERS_KEY/);
  assert.match(claim, /expectedValue: globalRaw/);
  assert.doesNotMatch(claim, /await updateGlobalBooster\\(id\\)/);
  assert.match(claim, /announcement write failed/);
});

test('admin booster state mutation uses watched compare-and-set rather than stale whole-snapshot SET', () => {
  const server = source('src/server/game.ts');
  const start = server.indexOf('export async function setGlobalBoosterDebugState');
  const end = server.indexOf('function playerKeyFor', start);
  assert.ok(start >= 0 && end > start);
  const setter = server.slice(start, end);
  assert.match(setter, /await redis\\.watch\\(GLOBAL_BOOSTERS_KEY\\)/);
  assert.match(setter, /await txn\\.exec\\(\\)/);
  assert.doesNotMatch(setter, /await redis\\.set\\(GLOBAL_BOOSTERS_KEY/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('offline Frenzy owner rewards are accumulated only for offline owners and acknowledged separately', () => {
  const server = read('src/server/game.ts');
  const main = read('src/client/main.tsx');
  const pagesApi = read('src/pages/api.ts');
  const app = read('src/server/app.ts');

  assert.match(server, /if \(ownerWasOffline\) \{[\s\S]*pendingFrenzyOfflineClaimCount[\s\S]*pendingFrenzyOfflineShards/);
  assert.match(server, /export async function acknowledgeFrenzyOfflineReward/);
  assert.match(server, /s\.pendingFrenzyOfflineClaimCount = 0;[\s\S]*s\.pendingFrenzyOfflineShards = 0;/);
  assert.match(main, /pendingFrenzyOfflineClaimCount[\s\S]*people rolled[\s\S]*pendingFrenzyOfflineShards/);
  assert.match(main, /!frenzyRunTriggered/);
  assert.match(pagesApi, /\/api\/frenzy\/offline-reward\/ack/);
  assert.match(app, /\/api\/frenzy\/offline-reward\/ack/);
});

test('Frenzy post shows remaining daily claims instead of a personal claim timer', () => {
  const frenzy = read('src/client/frenzy.tsx');
  assert.match(frenzy, /Frenzy claims remaining today/);
  assert.match(frenzy, /claimsRemainingToday\} \/ \{claimLimit/);
  assert.match(frenzy, /Claims reset at midnight UTC/);
  assert.doesNotMatch(frenzy, /Your claim cooldown/);
  assert.doesNotMatch(frenzy, /FRENZY_CLAIM_COOLDOWN_MS/);
});

test('Reddit simulator uses the local post record and the real Frenzy claim engine', () => {
  const main = read('src/client/main.tsx');
  const simulator = read('src/client/components/RedditPostSimulator.tsx');
  const frenzyEntry = read('src/client/frenzy.tsx');
  const server = read('src/server/game.ts');
  const pagesApi = read('src/pages/api.ts');
  assert.match(main, /hostname\.endsWith\('\.github\.io'\)/);
  assert.match(main, /IS_GITHUB_PAGES_TEST && tab === 'reddit-simulator'/);
  assert.match(simulator, /Orb rarity to publish/);
  assert.match(simulator, /Create and view post/);
  assert.match(simulator, /\/api\/frenzy\/simulator\/create/);
  assert.match(frenzyEntry, /\/api\/frenzy\/simulator\/info/);
  assert.match(frenzyEntry, /\/api\/frenzy\/simulator\/claim/);
  assert.match(simulator, /onClaimed\(result\)/);
  assert.match(server, /export async function createFrenzySimulatorPost/);
  assert.match(server, /export async function getOrbFrenzyInfo\(options:/);
  assert.match(pagesApi, /game\.claimOrbFrenzy\(\{[\s\S]*?postId,[\s\S]*?allowAdminTestOwner: true/);
  assert.doesNotMatch(simulator, /window\.open|https?:\/\//);
});

test('manual Roll readiness uses the manual cooldown instead of Auto Roll timing', () => {
  const main = read('src/client/main.tsx');
  const start = main.indexOf('Keep the manual Roll button aligned with the manual server cooldown.');
  const end = main.indexOf('// Auto Roll uses a single scheduled wake-up', start);
  assert.ok(start >= 0 && end > start);
  assert.match(main.slice(start, end), /cooldownMs\(timingState, false, liveBalance\)/);
  assert.doesNotMatch(main.slice(start, end), /cooldownMs\(timingState, true\)/);
});

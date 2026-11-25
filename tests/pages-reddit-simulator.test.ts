import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Reddit Simulator is in More while Rift Challenges occupies its former full-page navigation slot', () => {
  const main = read('src/client/main.tsx');
  const simulator = read('src/client/components/RedditPostSimulator.tsx');
  const frenzy = read('src/client/frenzy.tsx');
  const api = read('src/pages/api.ts');
  const game = read('src/server/game.ts');
  const moreMenuStart = main.indexOf('id="io-more-navigation"');
  assert.ok(moreMenuStart >= 0);
  const moreMenuEnd = main.indexOf('                </div>\n                <button\n                  type="button"\n                  onClick={() => changeTab(\'fight\')}', moreMenuStart);
  assert.ok(moreMenuEnd > moreMenuStart);
  assert.match(main.slice(moreMenuStart, moreMenuEnd), /renderNavItem\('reddit-simulator', 'Reddit Simulator', MessageSquare\)/);
  assert.doesNotMatch(main.slice(moreMenuStart, moreMenuEnd), /renderNavItem\('challenges'/);
  assert.match(main, /const standalonePageMode = combatMode \|\| riftChallengesMode/);
  assert.match(main, /io-nav-rift/);
  assert.match(main, /redditSimulatorMode/);
  assert.match(main, /RedditPostSimulator/);
  assert.match(main, /Back to Orbs/);
  assert.doesNotMatch(main, /io-reddit-simulator-mode-switch/);
  assert.match(simulator, /\/api\/frenzy\/simulator\/create/);
  assert.match(simulator, /frenzy\.html/);
  assert.match(frenzy, /previewPostId/);
  assert.match(frenzy, /\/api\/frenzy\/simulator\/info/);
  assert.match(frenzy, /\/api\/frenzy\/simulator\/claim/);
  assert.match(frenzy, /io-frenzy-preview-claimed/);
  assert.match(api, /game\.createFrenzySimulatorPost\(body.rarity\)/);
  assert.match(game, /export async function createFrenzySimulatorPost/);
  assert.match(game, /buildFrenzyPostSubmission/);
  assert.match(game, /options\.allowAdminTestOwner/);
});

test('Pages Admin Console routes to the local-only adapter, including Rift controls', () => {
  const api = read('src/pages/api.ts');
  const admin = read('src/pages/admin-api.ts');
  assert.ok(api.includes("import { handlePagesAdminRequest } from './admin-api.js';"));
  assert.ok(api.includes('return handlePagesAdminRequest(url, method, body)'));
  assert.ok(!api.includes('Developer-only controls are not available in the browser Pages build.'));
  assert.ok(admin.includes('isAdmin: true'));
  assert.ok(admin.includes('GitHub Pages testing has access only to the current local test profile.'));
  assert.ok(admin.includes("case '/rift/status':"));
  assert.ok(admin.includes('getRiftChallengeAdminStatus(userId)'));
  assert.ok(admin.includes("case '/rift/grant':"));
  assert.ok(admin.includes('adminGrantRiftProgress(userId'));
  assert.ok(admin.includes("return fail('Command-line admin tools are unavailable in the browser-only Pages build.', 501)"));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Rift first clears publish a dedicated post entrypoint only after a committed first clear', () => {
  const game = read('src/server/game.ts');
  const app = read('src/server/app.ts');
  const config = read('devvit.json');
  const post = read('src/client/rift.tsx');

  assert.match(game, /firstClear = !completedIds\.includes\(challenge\.id\)/);
  assert.match(game, /if \(firstClear\) \{/);
  assert.match(game, /state\.riftChallengeFirstClear = \{/);
  assert.match(app, /const completion = result\.state\?\.riftChallengeFirstClear/);
  assert.match(app, /entry: 'rift'/);
  assert.match(app, /has completed the Rift \$\{completion\.challengeName\} for the first time!/);
  assert.match(config, /"rift": \{\s*"entry": "rift\.html"/);
  assert.match(post, /has completed the rift \{info\.challengeName\} for the first time!/);
  assert.match(post, /FIRST CLEAR/);
});

test('Kudos is once per viewer, expires after 24 hours, and applies all three rewards', () => {
  const server = read('src/server/rift-challenges.ts');
  const app = read('src/server/app.ts');
  const post = read('src/client/rift.tsx');

  assert.match(server, /RIFT_KUDOS_WINDOW_MS = 24 \* 60 \* 60_000/);
  assert.match(server, /now >= record\.createdAt \+ RIFT_KUDOS_WINDOW_MS/);
  assert.match(server, /You cannot kudos your own Rift completion post/);
  assert.match(server, /riftCompletionKudosReceiptKey\(postId, giverId\)/);
  assert.match(server, /grantFrenzyOwnerShards\(giverState, RIFT_KUDOS_REWARD_SHARDS\)/);
  assert.match(server, /prepareFrenzyOwnerRewardWrites\(ownerId, RIFT_KUDOS_REWARD_SHARDS, false\)/);
  assert.match(server, /RIFT_KUDOS_PROGRESS_MINUTES = 1/);
  assert.match(server, /archive\.kudosSinceLastOpen = Math\.min/);
  assert.match(server, /await save\(giverState, \[/);
  assert.match(post, /Send Kudos/);
  assert.match(post, /Sending Kudos does not open the game\./);

  const sendStart = post.indexOf('const sendKudos');
  const openStart = post.indexOf('const openGame');
  assert.ok(sendStart >= 0 && openStart > sendStart);
  assert.doesNotMatch(post.slice(sendStart, openStart), /requestExpandedMode/);
  assert.match(post.slice(openStart), /requestExpandedMode\(event\.nativeEvent, 'game'\)/);
  assert.match(post, /disabled=\{!info \|\| !info\.canKudos \|\| expired/);
});

test('Rift menu counts Kudos over the last day and since the most recent game entry', () => {
  const server = read('src/server/rift-challenges.ts');
  const client = read('src/client/components/RiftChallengesSection.tsx');
  const shared = read('src/shared/rift-challenges.ts');
  const main = read('src/client/main.tsx');
  const pagesApi = read('src/pages/api.ts');

  assert.match(shared, /kudosSinceLastOpen: number/);
  assert.match(shared, /kudosDisplaySinceLastOpen: number/);
  assert.match(server, /last24Hours: archive\.kudosReceivedAt\.filter/);
  assert.match(server, /sinceLastOpen: archive\.kudosDisplaySinceLastOpen \+ archive\.kudosSinceLastOpen/);
  assert.match(server, /archive\.kudosSinceLastOpen = 0/);
  assert.match(main, /\/api\/rift-challenges\/mark-opened/);
  assert.match(pagesApi, /case '\/api\/rift-challenges\/mark-opened'/);
  assert.match(client, /snapshot\.kudosStats\.last24Hours/);
  assert.match(client, /snapshot\.kudosStats\.sinceLastOpen/);
});

test('Rift admin tools are registered in the searchable console and expose Rift-only grants', () => {
  const admin = read('src/client/components/DevDebugModal.tsx');
  const debug = read('src/server/debug.ts');
  assert.match(admin, /id: 'rift', label: 'Rift Administration'/);
  assert.match(admin, /id: 'rift-admin', label: 'Rift Player Controls'/);
  assert.match(admin, /io-rift-admin-group/);
  assert.match(admin, /io-tool-rift-admin/);
  assert.match(admin, /\/api\/dev\/rift\/status/);
  assert.match(admin, /\/api\/dev\/rift\/grant/);
  assert.match(debug, /debugRouter\.get\('\/rift\/status'/);
  assert.match(debug, /debugRouter\.post\('\/rift\/grant'/);
});

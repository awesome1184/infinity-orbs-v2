import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Frenzy calculating popup displays server-backed live progress without the old vague message', () => {
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  assert.doesNotMatch(main, /Orbs are spawning while we secure your claim/);
  assert.match(main, /\/api\/frenzy\/progress/);
  assert.match(main, /role="progressbar"/);
  assert.match(main, /io-frenzy-progress-track/);
  assert.match(main, /frenzyProgressCount = Math\.min\(/);
  assert.match(main, /const ceiling = Math\.min\(total, processed \+ Math\.max\(500, Math\.ceil\(total \* 0\.01\)\)\)/);
  assert.match(main, /Math\.random\(\) \* Math\.min\(250, room\)/);
  assert.match(main, /setFrenzyDisplayedProcessed\(finalFrenzyCount\)/);

});

test('Frenzy progress is claimant-scoped and updated after bounded server batches', () => {
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');
  const server = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const app = readFileSync(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
  assert.match(server, /FRENZY_CLAIM_PROGRESS_PREFIX/);
  assert.match(server, /export async function getOrbFrenzyClaimProgress/);
  assert.match(server, /await writeFrenzyClaimProgress\(claimantId, postId, attemptId, count, processedCount, false\)/);
  assert.match(server, /MAX_EFFECTIVE_ROLLS_PER_BATCH/);
  assert.match(server, /chunkProcessed =>/);
  assert.match(server, /nowForProgress - lastProgressWriteAt >= 100/);
  assert.match(server, /await writeFrenzyClaimProgress\(claimantId, postId, attemptId, count, processedCount, true\)/);
  assert.match(main, /progress\.attemptId !== activeFrenzyAttemptId/);
  assert.match(main, /body: JSON\.stringify\(\{ attemptId: activeFrenzyAttemptId \}\)/);
  assert.match(app, /app\.get\('\/api\/frenzy\/progress'/);
  assert.match(app, /claimOrbFrenzy\(\{ attemptId \}\)/);
});

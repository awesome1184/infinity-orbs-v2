import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Rift rolls use floating resource particles instead of an Orb-covering reward card', () => {
  const roll = source('src/client/components/RollSection.tsx');
  const styles = source('src/client/styles.css');
  assert.match(roll, /roll-floating-rewards/);
  assert.match(roll, /roll-floating-stat-/);
  assert.doesNotMatch(roll, /reward-burst|rewardBurst/);
  assert.match(styles, /@keyframes io-roll-floating-stat/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('Rift mode disables Frenzy, keeps New Best non-blocking, and stages completion', () => {
  const roll = source('src/client/components/RollSection.tsx');
  const main = source('src/client/main.tsx');
  const theme = source('src/client/rift-theme.css');
  const admin = source('src/client/components/DevDebugModal.tsx');
  const adminServer = source('src/server/debug.ts');
  assert.match(roll, /const isRiftSave = Boolean/);
  assert.match(roll, /frenzyArmedForRoll = frenzyArmed && !isRiftSave/);
  assert.match(roll, /riftCompletionPhase/);
  assert.match(roll, /riftCompletionReveal/);
  assert.match(main, /riftChallengeCompletedPopup/);
  assert.match(main, /newBestModalData && !riftActive/);
  assert.match(main, /onRiftCompletionRevealComplete/);
  assert.match(theme, /io-rift-atmosphere/);
  assert.match(theme, /io-rift-completion-charge/);
  assert.match(admin, /handleQueueGuaranteedRoll/);
  assert.match(admin, /Guaranteed Next Roll/);
  assert.match(adminServer, /debugRouter\.post\('\/queue-force-roll'/);
});


test('high-rarity Orb color cycling is reduced-motion aware', () => {
  const shared = source('src/shared/game.ts');
  const styles = source('src/client/styles.css');
  assert.match(shared, /animated\?: boolean/);
  assert.match(shared, /animated: rarity >= 1e38/);
  assert.match(styles, /\.io-rarity-color-cycle/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

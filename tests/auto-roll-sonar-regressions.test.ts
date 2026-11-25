import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AUTO_ROLL_COOLDOWN_RETRY_BUFFER_MS,
  autoRollCooldownRetryDelayMs,
} from '../src/shared/auto-roll-timing.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Auto Roll cooldown retries use the server remainder plus a safety buffer', () => {
  assert.equal(AUTO_ROLL_COOLDOWN_RETRY_BUFFER_MS, 150);
  assert.equal(autoRollCooldownRetryDelayMs('Cooldown: 0.2s'), 350);
  assert.equal(autoRollCooldownRetryDelayMs(new Error('Cooldown: 1.3s')), 1_450);
  assert.equal(autoRollCooldownRetryDelayMs({ message: 'Cooldown: 0.0s' }), 150);
  assert.equal(autoRollCooldownRetryDelayMs(new Error('Network request failed')), null);
  assert.equal(autoRollCooldownRetryDelayMs('Cooldown: -0.2s'), null);
});

test('Auto Roll keeps cooldown-retry backoff across state refreshes and clears it after success', () => {
  const main = source('src/client/main.tsx');
  assert.match(main, /const autoCooldownRetryDelay = isAutoRoll\s*\?\s*autoRollCooldownRetryDelayMs\(error\)/);
  assert.match(main, /autoRollCooldownRetryUntilRef\.current = retryAt/);
  assert.match(main, /const nextReadyAt = autoRollReadyAt\(/);
  assert.match(main, /cooldownMs\(latest, true, liveBalance\)/);
  assert.match(main, /autoRollCooldownRetryUntilRef\.current,/);
  assert.match(main, /setReadyAt\(manualRollReadyAt\(lastRollAt, cooldownMs\(timingState, false, liveBalance\)\)\)/);
  assert.doesNotMatch(main, /authoritativeReadyAt/);
  assert.match(main, /if \(isAutoRoll\) autoRollCooldownRetryUntilRef\.current = 0/);
});

test('Sonar trigger settings stay in the Sonar Ping menu without a duplicate Record alerts strip', () => {
  const roll = source('src/client/components/RollSection.tsx');
  assert.doesNotMatch(roll, /Record alerts/);
  assert.doesNotMatch(roll, /Ping non-record Orbs that reach 90% of your current best rarity/);
  assert.match(roll, /data-testid="sonar-ping-options"/);
  assert.match(roll, /data-testid="sonar-alert-mode"/);
  assert.match(roll, /At least 1\/10th below a new best/);
  assert.match(roll, /New records always play the longer celebration/);
  assert.match(roll, /data-testid="alignment-alert-sound-toggle"/);
  assert.match(roll, /data-testid="sonar-alignment-sounds-toggle"/);
});

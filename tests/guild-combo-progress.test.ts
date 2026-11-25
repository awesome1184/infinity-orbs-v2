import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  activateGuildComboStack,
  createInitialGuildCombo,
  decayGuildComboState,
  guildComboDurationMs,
  guildComboTimeProgress,
} from '../src/shared/game.js';
import {
  addGuildValueProgress,
  countGuildTaskRareOrbs,
  createGuildTask,
  isGuildValueProgress,
  MAX_GUILD_TASK_TIER,
} from '../src/shared/social.js';

test('Guild combo time bar measures remaining time against all duration earned', () => {
  const startedAt = 1_000_000;
  const first = activateGuildComboStack(createInitialGuildCombo(startedAt), startedAt);
  assert.equal(first.totalDurationMs, guildComboDurationMs(1));
  assert.equal(guildComboTimeProgress(first, startedAt), 100);

  const oneMinuteLater = startedAt + 60_000;
  const decayed = decayGuildComboState(first, oneMinuteLater);
  const afterElapsedTime = guildComboTimeProgress(decayed, oneMinuteLater);
  assert.ok(afterElapsedTime > 0 && afterElapsedTime < 100,
    'the bar should shrink as the combo timer drains');

  const stacked = activateGuildComboStack(decayed, oneMinuteLater);
  const newDuration = guildComboDurationMs(stacked.tier);
  assert.equal(stacked.totalDurationMs, first.totalDurationMs + newDuration,
    'stacking adds the newly granted duration to the denominator');
  const expected = Math.round(
    Math.min(1, (stacked.endsAt - oneMinuteLater) / stacked.totalDurationMs) * 10_000,
  ) / 100;
  assert.equal(guildComboTimeProgress(stacked, oneMinuteLater), expected);
  assert.ok(expected < 100, 'stacked time must be shown as a fraction of cumulative time earned');
});

test('rare Guild task progress counts every weighted 1/100+ Orb in a batch', () => {
  const rarities = [99, 100, 1_000, Number.POSITIVE_INFINITY];
  const weights = [500, 529, 1, 100];
  assert.equal(countGuildTaskRareOrbs(rarities, weights), 530);
  assert.equal(countGuildTaskRareOrbs(rarities, weights, 1_000), 1);
  assert.equal(countGuildTaskRareOrbs([100, 101], [Number.MAX_SAFE_INTEGER, 1]), Number.MAX_SAFE_INTEGER);
});

test('completed roll batches pass weighted rare-Orb counts into Guild task progress', () => {
  const game = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  assert.ok(game.includes('countGuildTaskRareOrbs(rarities, rarityWeights)'));
  assert.ok(game.includes('prepareGuildRollEffects(totalVal, rollCount, bestRarity, pendingGuildWrite, rareOrbCount)'));
  assert.ok(social.includes('rareOrbCount?: number'));
  assert.ok(social.includes('const taskProgressRare = capInteger(rareOrbCount ?? ((bestRarity ?? 0) >= 100 ? 1 : 0));'));
  assert.ok(social.includes('else if (task.type === \'rare\') task.progress = capInteger(task.progress + taskProgressRare);'));
});

test('Guild combo duration earned is normalized and validated in persisted Guild data', () => {
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  assert.ok(social.includes('guild.combo.totalDurationMs = clampInteger('));
  assert.ok(social.includes("'totalDurationMs']"));
});

test('Guild combo time bar communicates the remaining-to-earned ratio accessibly', () => {
  const ui = readFileSync(resolve(process.cwd(), 'src/client/components/GuildsAndSocial.tsx'), 'utf8');
  assert.ok(ui.includes('Time left / earned'));
  assert.ok(ui.includes('guildComboTimeProgress(combo, now)'));
  assert.ok(ui.includes('Guild combo time remaining relative to total time earned'));
});

test('Guild Collection Value task targets scale to roughly 1e85 by Tier 100', () => {
  const tier71 = createGuildTask('value', 71);
  const tier100 = createGuildTask('value', 100);
  assert.equal(tier100.tier, 100);
  assert.ok(Number.isFinite(tier100.target));
  assert.ok(Number.isInteger(tier100.target));
  assert.ok(tier71.target > Number.MAX_SAFE_INTEGER);
  assert.ok(Math.log10(tier100.target) >= 85 && Math.log10(tier100.target) < 86,
    `expected a Tier 100 target around 1e85, got ${tier100.target.toExponential(3)}`);
  assert.match(tier100.label, /Accumulate .* collection value/);

  const progress = addGuildValueProgress(Number.MAX_SAFE_INTEGER, tier100.target);
  assert.ok(progress > Number.MAX_SAFE_INTEGER);
  assert.equal(isGuildValueProgress(progress), true);
  assert.equal(isGuildValueProgress(Number.POSITIVE_INFINITY), false);
  assert.equal(MAX_GUILD_TASK_TIER, 100);
});

test('Guild parser upgrades legacy value-task targets to the new tier curve without discarding progress', () => {
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  assert.match(social, /Math\.max\(generated\.target, existingValueTarget\)/);
  assert.match(social, /label: type === 'value' && target === generated\.target/);
});

test('Guild parser and both contribution writers preserve large Collection Value progress', () => {
  const social = readFileSync(resolve(process.cwd(), 'src/server/social.ts'), 'utf8');
  assert.match(social, /member\.contribution = addGuildValueProgress\(member\.contribution, safeValue\)/);
  assert.match(social, /task\.type === 'value'\) task\.progress = addGuildValueProgress\(task\.progress, safeValue\)/);
  assert.match(social, /isGuildValueProgress\(member\.contribution\)/);
  assert.match(social, /isGuildValueProgress\(challenge\.target, 1\)/);
  assert.match(social, /isGuildValueProgress\(value, minimum\)/);
  assert.doesNotMatch(social, /task\.type === 'value'\) task\.progress = cap(?:SafeGuildCounter|Integer)\(task\.progress \+ safeValue\)/);
});

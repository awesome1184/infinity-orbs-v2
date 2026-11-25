// [BOSS][TESTER] Keep level-gated API tests independent from the Level 1 reset-all assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('comprehensive API runner seeds an unlocked fixture after reset-all baseline', () => {
  const runner = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const resetIndex = runner.indexOf('"API · Final fixture baseline"');
  const seedIndex = runner.indexOf("'API · Seed level-gated feature fixture'", resetIndex);
  const nextApiMutationIndex = runner.indexOf('"API · Nested upgrade state mutation"', resetIndex);

  assert.ok(resetIndex >= 0, 'reset-all baseline assertion must remain present');
  assert.ok(seedIndex > resetIndex, 'unlocked fixture must come after reset-all baseline');
  assert.ok(nextApiMutationIndex > seedIndex, 'unlocked fixture must precede stateful API tests');

  const fixture = runner.slice(seedIndex, nextApiMutationIndex);
  assert.match(fixture, /xp:\s*100_000/);
  assert.match(fixture, /level:\s*32/);
  assert.match(fixture, /Number\(state\.level\) < 20/);
});


test('admin API test request helper never retries HTTP 4xx responses', () => {
  const runner = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const start = runner.indexOf('const request = async <T,>');
  const end = runner.indexOf('\n    const step = async <T,>', start);
  assert.ok(start >= 0 && end > start, 'admin API request helper boundaries must exist');

  const helper = runner.slice(start, end);
  const fetchTryEnd = helper.indexOf('} catch (error)');
  const successCheck = helper.indexOf('if (response.ok) return data as T;');
  const clientErrorGuard = helper.indexOf('if (response.status < 500 || attempt === 2) throw lastError;');
  assert.ok(fetchTryEnd > helper.indexOf('response = await fetch('),
    'network errors must be caught around fetch only');
  assert.ok(successCheck > fetchTryEnd,
    'HTTP response handling must be outside the network-error catch');
  assert.ok(clientErrorGuard > successCheck,
    'HTTP 4xx responses must throw without being swallowed or retried');
  assert.match(helper, /if \(response\.status < 500 \|\| attempt === 2\) throw lastError;/);
});

test('feature-level fixture is verified through the same /api/me read path used by feature gates', () => {
  const runner = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const seedIndex = runner.indexOf("'API · Seed level-gated feature fixture'");
  const nextIndex = runner.indexOf('"API · Nested upgrade state mutation"', seedIndex);
  assert.ok(seedIndex >= 0 && nextIndex > seedIndex);
  const fixture = runner.slice(seedIndex, nextIndex);
  assert.match(fixture, /level:\s*32/);
  assert.match(fixture, /request<any>\('\/api\/me'\)/);
  assert.match(fixture, /Number\(state\.level\) < 20/);
  assert.match(fixture, /Number\(state\.xp\) < 100_000/);
});


test('admin roll helper consumes the ticket returned by the cooldown-reset endpoint', () => {
  const runner = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const start = runner.indexOf('const rollOnce = async');
  const end = runner.indexOf('const rollDetail', start);
  assert.ok(start >= 0 && end > start, 'admin roll helper boundaries must exist');
  const helper = runner.slice(start, end);

  const resetIndex = helper.indexOf("('/api/dev/reset-cooldown', {})");
  const rollIndex = helper.indexOf("request<RollResponse>('/api/roll'");
  assert.ok(resetIndex >= 0 && rollIndex > resetIndex,
    'roll submission must use the reset endpoint that returns a fresh ticket');
  assert.match(helper, /ticketId: ticket\.ticketId/);
  assert.match(helper, /ticketIndex: ticket\.nextIndex/);
  assert.match(helper, /message\.includes\('Roll prediction ticket is'\)/);
  assert.match(helper, /message\.includes\('Could not create a roll prediction ticket'\)/);
});

test('admin sweep isolates force-roll results from multi-roll, critical, and cached leaderboard state', () => {
  const runner = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');

  const forceFixtureStart = runner.indexOf('const seedSingleBallForceRoll = async');
  const prestigeBranch = runner.indexOf('if (prestigeResult)', forceFixtureStart);
  assert.ok(forceFixtureStart >= 0 && prestigeBranch > forceFixtureStart,
    'single-ball force-roll fixture must be declared outside the optional prestige branch');
  const forceFixture = runner.slice(forceFixtureStart, prestigeBranch);
  assert.ok(forceFixture.includes("request<any>('/api/dev/state', {"));
  assert.ok(forceFixture.includes('highestRarity,'));
  assert.ok(forceFixture.includes('collection: {},'));
  assert.ok(forceFixture.includes('collectionValue: 0,'));
  assert.ok(forceFixture.includes('lifetimeCollectionValue: 0,'));
  assert.ok(forceFixture.includes('Object.keys(PRESTIGE_UPGRADES)'));
  assert.ok(forceFixture.includes('celestialVolley: 0'));
  assert.ok(forceFixture.includes("request('/api/dev/global-booster'"));

  for (const [label, rarity] of [
    ['API · Force-roll 1/1e15 Paradox', '1_000_000_000_000_000'],
    ['API · Force-roll 1/1e16 Beyond', '10_000_000_000_000_000'],
    ['API · Force-roll 1/1e17 Endless', '100_000_000_000_000_000'],
  ] as const) {
    const start = runner.indexOf("'" + label + "'");
    const end = runner.indexOf('\n      await step(', start + 1);
    assert.ok(start >= 0 && end > start, label + ' step must exist');
    const step = runner.slice(start, end);
    assert.match(step, /await seedSingleBallForceRoll\(9\)/);
    assert.ok(step.includes("rarity: " + rarity));
    assert.match(step, /randomValue:\s*0\.999999/);
  }

  const deterministicStart = runner.indexOf('"API · Force-roll honors deterministic rarity"');
  const deterministicEnd = runner.indexOf('\n      await step(', deterministicStart + 1);
  assert.ok(deterministicStart >= 0 && deterministicEnd > deterministicStart);
  const deterministicStep = runner.slice(deterministicStart, deterministicEnd);
  assert.match(deterministicStep, /await seedSingleBallForceRoll\(0\)/);
  assert.match(deterministicStep, /rarity:\s*12345,\s*randomValue:\s*0\.999999/);

  const persistenceStart = runner.indexOf('"API · Force-roll persists collection entry"');
  const persistenceEnd = runner.indexOf('\n      await step(', persistenceStart + 1);
  assert.ok(persistenceStart >= 0 && persistenceEnd > persistenceStart);
  const persistenceStep = runner.slice(persistenceStart, persistenceEnd);
  assert.match(persistenceStep, /await seedSingleBallForceRoll\(0\)/);
  assert.match(persistenceStep, /rarity:\s*777,\s*randomValue:\s*0\.999999/);

  const shareStart = runner.indexOf('"API · Share records eligibility in a fresh leaderboard snapshot"');
  const shareEnd = runner.indexOf('\n      await step(', shareStart + 1);
  assert.ok(shareStart >= 0 && shareEnd > shareStart);
  const shareStep = runner.slice(shareStart, shareEnd);
  assert.ok(shareStep.includes("'/api/leaderboards?fresh=1'"));
  assert.match(shareStep, /result\?\.collectionValue/);
});

test('admin mechanic remount tests use an unlocked navigation tab instead of gated Guilds', () => {
  const runner = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const start = runner.indexOf('const remountRollSection = async');
  const end = runner.indexOf('const readMechanics = async', start);
  assert.ok(start >= 0 && end > start, 'RollSection remount helper must exist');
  const helper = runner.slice(start, end);
  assert.match(helper, /aria-label'\) === 'Upgrades'/);
  assert.match(helper, /aria-label'\) === 'Roll'/);
  assert.doesNotMatch(helper, /aria-label'\) === 'Guilds'/);
  assert.ok(runner.includes("'Mechanic · Silent Alert Mode'") && runner.includes("'Mechanic · Skip Animations'"));
  assert.equal(runner.split('await remountRollSection();').length - 1, 2,
    'both mount-only RollSection preference tests should use the unlocked navigation helper');
});


test('admin force-roll preserves the requested rarity and Sonar checks match the live control', () => {
  const debug = readFileSync(resolve(process.cwd(), 'src/server/debug.ts'), 'utf8');
  const forceStart = debug.indexOf("debugRouter.post('/force-roll'");
  const forceEnd = debug.indexOf("\ndebugRouter.post('/frenzy/start'", forceStart);
  assert.ok(forceStart >= 0 && forceEnd > forceStart, 'admin force-roll route must exist');
  const forceRoute = debug.slice(forceStart, forceEnd);
  assert.match(forceRoute, /const exactRarity = req\.body\?\.exactRarity !== false/,
    'force-rolls default to exact rarity but allow explicit non-exact mechanic tests');
  assert.match(
    forceRoute,
    /applyRolls\(s,\s*1,\s*forcedRarity,\s*source,\s*undefined,\s*randomOverride,\s*exactRarity\)/,
    'admin force-rolls must use exact-rarity mode so crits cannot alter deterministic fixtures',
  );

  const rollSection = readFileSync(resolve(process.cwd(), 'src/client/components/RollSection.tsx'), 'utf8');
  assert.match(rollSection, /data-testid="sonar-mode-toggle"/);

  const runner = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const silentStart = runner.indexOf("'Mechanic · Silent Alert Mode'");
  const silentEnd = runner.indexOf("\n        await step(", silentStart + 1);
  assert.ok(silentStart >= 0 && silentEnd > silentStart, 'Silent Alert Mode test must exist');
  const silentStep = runner.slice(silentStart, silentEnd);
  assert.equal(
    silentStep.split("dataset.testid === 'sonar-mode-toggle'").length - 1,
    3,
    'all Sonar toggle lookups must use the stable live control selector',
  );
  assert.match(silentStep, /Sonar Ping: ON/);
  assert.match(silentStep, /Sonar Ping: OFF/);

  const triggerStart = runner.indexOf("'Mechanic · Sonar Ping Rare Trigger'");
  const triggerEnd = runner.indexOf("\n        await step(", triggerStart + 1);
  assert.ok(triggerStart >= 0 && triggerEnd > triggerStart, 'Sonar trigger test must exist');
  const triggerStep = runner.slice(triggerStart, triggerEnd);
  assert.match(triggerStep, /highestRarity:\s*110/);
  assert.match(triggerStep, /sound\.setSonarAlertMode\('near-best'\)/);
  assert.match(triggerStep, /await onRefresh\(\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('Rift Relic Forge persists loadouts and applies equipped relic effects to active runs', () => {
  const shared = read('src/shared/rift-challenges.ts');
  const server = read('src/server/rift-challenges.ts');
  const game = read('src/server/game.ts');
  const combat = read('src/server/combat.ts');
  const pagesApi = read('src/pages/api.ts');
  const app = read('src/server/app.ts');
  const client = read('src/client/components/RiftChallengesSection.tsx');

  assert.match(shared, /riftRelicLevels: RiftRelicLevels/);
  assert.match(shared, /equippedRiftRelics: RiftRelicId\[\]/);
  assert.match(shared, /equippedRelics: RiftRelicId\[\]/);
  assert.match(shared, /timelineFork/);
  assert.match(server, /export async function buyRiftRelic/);
  assert.match(server, /spendCombatScrapForRiftForge/);
  assert.match(server, /refundCombatScrapForRiftForge/);
  assert.match(server, /export async function setEquippedRiftRelic/);
  assert.match(server, /equippedRelics: \[\.\.\.archive\.equippedRiftRelics\]/);
  assert.match(server, /function normalizeRun\(value: unknown, maxRelicSlots = RIFT_RELIC_EQUIP_SLOTS\)/);
  assert.match(server, /activeRun: normalizeRun\(/);
  assert.match(server, /riftPerkLevels\.timelineFork > 0 \? RIFT_RELIC_FORKED_EQUIP_SLOTS/);
  assert.match(game, /riftRelicCompletionRewardMultiplier/);
  assert.match(game, /riftObserverLuckMultiplier/);
  assert.match(game, /riftRelicProgressCoinMultiplier/);
  assert.match(game, /fractureCascadePending/);
  assert.match(combat, /export async function spendCombatScrapForRiftForge/);
  assert.match(combat, /export async function getCombatScrapBalance/);
  assert.match(pagesApi, /\/api\/rift-challenges\/relic\/forge/);
  assert.match(pagesApi, /\/api\/rift-challenges\/relic\/equip/);
  assert.match(pagesApi, /\/api\/rift-challenges\/relics\/status/);
  assert.match(app, /app\.get\('\/api\/rift-challenges\/relics\/status'/);
  assert.match(app, /app\.post\('\/api\/rift-challenges\/relic\/forge'/);
  assert.match(app, /app\.post\('\/api\/rift-challenges\/relic\/equip'/);
  assert.match(client, /The Relic Forge/);
  assert.match(client, /FORGE/);
  assert.match(client, /UNEQUIP/);
});

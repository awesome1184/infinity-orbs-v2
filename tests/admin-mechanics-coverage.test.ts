import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AUTOMATIONS, MASTERY_SKILLS, PREMIUM_BOOSTERS, PRESTIGE_UPGRADES } from '../src/shared/game.js';

test('admin Full Test directly covers each current Prestige Upgrade and Mastery skill', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/client/components/DevDebugModal.tsx'), 'utf8');
  const prestigeLabels: Record<keyof typeof PRESTIGE_UPGRADES, string> = {
  permLuck: "Mechanic · Permanent Luck",
  permSpeed: "Mechanic · Permanent Speed",
  unbrokenMomentum: "Mechanic · Unbroken Momentum",
  vaultCap: "Mechanic · Vault Expansion",
  sonarPing: "Mechanic · Silent Alert Mode",
  instantReveal: "Mechanic · Skip Animations",
  autoOverclock: "Mechanic · Auto-Roll Speed",
  autoFilter: "Mechanic · Common Salvage",
  autoScrap: "Mechanic · Auto Scrap",
  resonanceMeter: "Mechanic · Dry Streak Luck",
  stellarMagnet: "Mechanic · Multi-Roll Extra",
  chronoOverdrive: "Mechanic · Turbo Duration",
  transmutation: "Mechanic · Transmutation",
  shardSynthesis: "Mechanic · Dust Synthesis",
  astralBarrage: "Mechanic · Astral Barrage",
  cosmicInheritance: "Mechanic · Cosmic Inheritance",
  autoBuyer: "Mechanic · Celestial Auto-Buyer",
  supernova: "Mechanic · Supernova Burst",
  altarResonator: "Mechanic · Altar Resonator",
  offlineOverdrive: "Mechanic · Offline Overdrive",
  luckyFloor: "Mechanic · Lucky Floor",
  astralArsenal: "Mechanic · Astral Arsenal",
  deepVault: "Mechanic · Deep Vault",
  steadyHands: "Mechanic · Steady Hands",
  offlineFortune: "Mechanic · Offline Fortune",
  frenzyVolley: "Mechanic · Frenzy Volley",
  astralReserve: "Mechanic · Astral Reserve",
  temporalCompression: "Mechanic · Temporal Compression",
  shardResonator: "Mechanic · Shard Resonator",
  cosmicValuation: "Mechanic · Cosmic Valuation",
  cosmicReserve: "Mechanic · Cosmic Reserve"
};
  assert.deepEqual(Object.keys(prestigeLabels).sort(), Object.keys(PRESTIGE_UPGRADES).sort(), 'refresh labels when the Prestige catalog changes');
  for (const [id, label] of Object.entries(prestigeLabels)) assert.ok(source.includes("'" + label + "'"), 'missing live behavior check for Prestige Upgrade ' + id);

  const masteryLabels: Record<keyof typeof MASTERY_SKILLS, string> = {
  continuumLuck: "Mechanic · Mastery · Continuum Luck",
  prosperity: "Mechanic · Mastery · Prosperity",
  shardAttunement: "Mechanic · Mastery · Shard Attunement",
  critMastery: "Mechanic · Mastery · Critical Mastery",
  aftershock: "Mechanic · Aftershock",
  chronoFlow: "Mechanic · Mastery · Chrono Flow",
  infiniteVault: "Mechanic · Mastery · Infinite Vault",
  cosmicAttunement: "Mechanic · Mastery · Cosmic Attunement",
  celestialSurge: "Mechanic · Mastery · Celestial Surge",
  pityAccelerant: "Mechanic · Mastery · Pity Accelerant",
  apexFortune: "Mechanic · Mastery · Apex Fortune",
  celestialVolley: "Mechanic · Mastery · Celestial Volley"
};
  assert.deepEqual(Object.keys(masteryLabels).sort(), Object.keys(MASTERY_SKILLS).sort(), 'refresh labels when the Mastery catalog changes');
  for (const [id, label] of Object.entries(masteryLabels)) assert.ok(source.includes("'" + label + "'"), 'missing live behavior check for Mastery skill ' + id);

  assert.ok(source.includes("'Mechanic · Premium Booster Catalog'") && source.includes('Object.keys(PREMIUM_BOOSTERS)'), 'each Premium Booster must be activated and cost-checked');
  assert.ok(source.includes("'Mechanic · Automation Catalog'") && source.includes('Object.keys(AUTOMATIONS)'), 'each automation must be purchased and checked');
  for (const label of ['Activate Global Luck','Activate Global Speed','Activate Global Crit']) assert.ok(source.includes("'" + label + "'"), 'missing Global Booster test: ' + label);
  assert.ok(source.includes("'Upgrade All'"), 'standard upgrades must stay covered by the upgrade-all test');
  assert.ok(source.includes("'API · Impressions reach admin analytics'"), 'the Full Test must round-trip preview impressions into the dashboard');
  assert.ok(source.includes("'API · Combat Lab validates gear, runes, and scaling'"), 'the Full Test must exercise Combat Lab diagnostics');
  assert.ok(source.includes("activeBoosters: {},\n            automations: {\n              autoQuestClaim: false,\n              autoStreakClaim: false,\n              autoCommunityClaim: false,\n              autoOfflineClaim: false,\n              autoUpgrade: false,\n            },"), 'mechanic fixtures must disable automations to prevent cross-test currency changes');
  const combatLabSource = readFileSync(resolve(process.cwd(), 'src/server/debug.ts'), 'utf8');
  assert.ok(combatLabSource.includes("label:'Player Speed is independent of dungeon depth'"), 'Combat Lab must verify the intended player Speed invariant');
  assert.ok(!combatLabSource.includes("label:'Late-game Speed reaches millions'"), 'Combat Lab must not require depth-scaled player Speed');
  assert.ok(!source.includes("'Mechanic · Singularity Tithe'"), 'retired mechanics must not remain as failing tests');
});

test('Combat regression suite covers the catalog, progression, gear, runes, tactics, and economy', () => {
  const source = readFileSync(resolve(process.cwd(), 'tests/combat-mechanics.test.ts'), 'utf8');
  const testNames = [
  "new Delvers start without gear and rely on modest baseline stats",
  "every combat rarity has seven active abilities",
  "skill catalog descriptions are distinct and Manual drops get rarer with Strategy Guide ranks",
  "equipped gear changes derived stats",
  "every tenth Undercrypt depth has a boss",
  "enemy speed scales continuously with depth and increases actions owed",
  "skill pull prices rise with Gacha rank and lifetime pulls",
  "quality curve stays anchored to run best after current depth resets",
  "ability energy availability respects the post-regeneration maximum",
  "flurry and bounty outputs scale with ability value and rank",
  "duplicate copies advance uncapped skill ranks with an increasing copy requirement",
  "skill copies are active ability types rather than passive stat modifiers",
  "ranked Gacha raises higher-rarity odds without pity overrides",
  "Scrap rewards and Forge costs scale with gear/floor progression",
  "run-haul overflow never evicts equipped gear acquired during the current run",
  "the newest run pickup survives overflow even when its quality is lower than the old haul",
  "duplicate loot grants are idempotent and do not consume haul slots",
  "run haul pruning preserves owned equipment and newest loot",
  "boss clears across all three dungeons grant additive Luck with 1.01^n self-stacking",
  "Arena rating uses bounded Elo-style updates",
  "core-game level and highest-orb rarity improve combat without changing baseline builds",
  "auto combat tactics choose safe, valid intents from health and energy",
  "dungeon choices have separate enemy modifiers and distinct combat builds",
  "Mark Magnet adds Combat Marks to the upgrade economy",
  "Warding Doctrine adds permanent damage reduction",
  "Starfall and Mark Harvest Major Abilities apply equipped bonuses"
];
  for (const name of testNames) assert.ok(source.includes("test('" + name + "'"), 'missing combat regression test: ' + name);
  assert.equal(testNames.length, 26, 'keep a coverage guard for all current combat regression cases');
});

test('impression and Global Chat reliability regressions remain covered', () => {
  const impressions = readFileSync(resolve(process.cwd(), 'tests/impressions.test.ts'), 'utf8');
  const chat = readFileSync(resolve(process.cwd(), 'tests/global-chat-routing.test.ts'), 'utf8');
  assert.ok(impressions.includes('client post ID preserves impressions when Devvit server context lacks post ID'));
  assert.ok(chat.includes('trusted admin repairs stale Frenzy destination only from a valid main Game post'));
});

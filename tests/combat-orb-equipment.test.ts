import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_BEAT_INTERVAL_MS, COMBAT_MAJOR_ABILITY_IDS, combatForgeQualityCost, combatMajorAbilityChance, combatOrbDamageMultiplier, combatSkillRarityOdds, combatStatsFor, createCombatState, resolveCombatSkillRarity } from '../src/shared/combat.js';
import { luckRarityFactor } from '../src/shared/game.js';

test('each orb rarity maps monotonically to a bounded base-damage multiplier', () => {
  assert.equal(combatOrbDamageMultiplier(0), 1);
  assert.equal(combatOrbDamageMultiplier(2), 1);
  assert.ok(combatOrbDamageMultiplier(10) > combatOrbDamageMultiplier(2));
  assert.ok(combatOrbDamageMultiplier(100) > combatOrbDamageMultiplier(10));
  assert.equal(combatOrbDamageMultiplier(200), 3);
  assert.equal(combatOrbDamageMultiplier(1e30), 20);
});

test('gear affixes from multiple equipment slots contribute to the combat build', () => {
  const state = createCombatState();
  const before = combatStatsFor(state);
  const ring = {
    id:'test-ring', name:'Quiet Ember Signet', slot:'ring' as const, quality:94, sourceFloor:0, power:40,
    effect:'Test ring affixes.', trait:'keen' as const, damageBonus:9, speedBonus:4, maxHealthBonus:0,
    armorBonus:0, critChanceBonus:.20,
  };
  const helmet = {
    id:'test-helmet', name:'Ashen Riftbound Visor', slot:'helmet' as const, quality:88, sourceFloor:0, power:35,
    effect:'Test helmet affixes.', trait:'bulwark' as const, damageBonus:0, speedBonus:0, maxHealthBonus:10,
    armorBonus:30, critChanceBonus:.03,
  };
  state.inventory.push(ring, helmet);
  state.equipment.ring = ring.id;
  state.equipment.helmet = helmet.id;
  const after = combatStatsFor(state);

  assert.ok(after.damage > before.damage);
  assert.equal(after.speed, before.speed + ring.speedBonus, 'ordinary gear Speed affixes must increase turn speed');
  assert.equal(after.armor, before.armor + helmet.armorBonus);
  assert.ok(after.critChance > before.critChance);
  state.equipment.ring = null;
  assert.ok(combatStatsFor(state).critChance < after.critChance);
});

test('new Delvers start with empty inventory and all gear slots unequipped', () => {
  const state = createCombatState();
  assert.deepEqual(state.inventory, []);
  assert.deepEqual(state.equipment, { weapon:null, armor:null, helmet:null, gloves:null, boots:null, ring:null, amulet:null });
  const stats = combatStatsFor(state);
  assert.equal(stats.damage, 30);
  assert.equal(stats.maxHealth, 500);
  assert.equal(stats.speed, 150);
});

test('major ability odds increase with item rarity but are never guaranteed', () => {
  const common = combatMajorAbilityChance(5);
  const uncommon = combatMajorAbilityChance(20);
  const rare = combatMajorAbilityChance(50);
  const epic = combatMajorAbilityChance(75);
  const mythic = combatMajorAbilityChance(100);
  assert.ok(common > 0);
  assert.ok(common < uncommon && uncommon < rare && rare < epic && epic < mythic);
  assert.ok(mythic < 1);
});


test('Luck makes average orb rarity improve continuously with diminishing returns', () => {
  assert.equal(luckRarityFactor(1), 1);
  assert.ok(luckRarityFactor(10) > luckRarityFactor(1));
  assert.ok(luckRarityFactor(1_000_000) > luckRarityFactor(10));
  assert.ok(luckRarityFactor(1e100) > 25);
  assert.equal(luckRarityFactor(1e100), 1e50);
});

test('combat cadence is 30 seconds and Forge quality has an exponential cost', () => {
  assert.equal(COMBAT_BEAT_INTERVAL_MS, 30_000);
  const low = combatForgeQualityCost(0, 20);
  const medium = combatForgeQualityCost(0, 50);
  const high = combatForgeQualityCost(0, 80);
  const nearPerfect = combatForgeQualityCost(0, 99);
  assert.ok(low < medium && medium < high && high < nearPerfect);
  assert.equal(combatForgeQualityCost(0, 100), 5_000_000);
  assert.equal(combatForgeQualityCost(0, 120), 5_000_000);
});

test('Rank 30 keeps Common dominant and preserves the intended rarity mix', () => {
  const rank1 = combatSkillRarityOdds(1);
  const rank10 = combatSkillRarityOdds(10);
  const rank30 = combatSkillRarityOdds(30);
  assert.equal(rank1.Common, 1);
  assert.equal(rank1.Mythic, 0);
  assert.ok(rank10.Mythic > rank1.Mythic);
  assert.equal(rank30.Mythic, 0.005);
  assert.equal(rank30.Common, 0.50);
  assert.equal(rank30.Uncommon, 0.30);
  assert.equal(rank30.Rare, 0.145);
  assert.equal(rank30.Epic, 0.05);
  assert.ok(Math.abs(Object.values(rank30).reduce((sum, chance) => sum + chance, 0) - 1) < 1e-12);
  assert.equal(resolveCombatSkillRarity(0.1, 30, 0, 0), 'Common');
  assert.equal(resolveCombatSkillRarity(0.6, 30, 0, 0), 'Uncommon');
  assert.equal(resolveCombatSkillRarity(0.85, 30, 0, 0), 'Rare');
  assert.equal(resolveCombatSkillRarity(0.96, 30, 0, 0), 'Epic');
  assert.equal(resolveCombatSkillRarity(0.999, 30, 0, 0), 'Mythic');
});

test('Void Edge and Aegis Ward Major Abilities affect equipped combat stats', () => {
  const state = createCombatState();
  const baseline = combatStatsFor(state);
  const offense = {
    id:'test-void-edge', name:'Void Edge', slot:'ring' as const, quality:100, sourceFloor:0, power:90,
    effect:'Increases outgoing damage.', trait:'keen' as const, damageBonus:0, speedBonus:0,
    maxHealthBonus:0, armorBonus:0, critChanceBonus:0,
    majorAbility:{id:'void-edge' as const,name:'Void Edge',trigger:'passive' as const,damagePercent:.15,description:'Increases outgoing damage.'},
  };
  const defense = {
    id:'test-aegis-ward', name:'Aegis Ward', slot:'amulet' as const, quality:100, sourceFloor:0, power:90,
    effect:'Reduces incoming damage.', trait:'bleed' as const, damageBonus:0, speedBonus:0,
    maxHealthBonus:0, armorBonus:0, critChanceBonus:0,
    majorAbility:{id:'aegis-ward' as const,name:'Aegis Ward',trigger:'passive' as const,damageReduction:.08,description:'Reduces incoming damage.'},
  };
  state.inventory.push(offense,defense);
  state.equipment.ring=offense.id;
  state.equipment.amulet=defense.id;
  const equipped = combatStatsFor(state);
  assert.ok(equipped.damage > baseline.damage);
  assert.ok(equipped.damageReduction > baseline.damageReduction);
});

test('turn speed is provided by an equipped Chrono Surge Major Ability', () => {
  const state = createCombatState();
  const before = combatStatsFor(state).speed;
  const charm = {
    id: 'test-chrono-surge',
    name: 'Hourglass of the Last Star',
    slot: 'amulet' as const,
    quality: 100,
    sourceFloor: 0,
    power: 80,
    effect: 'Major Ability: faster turns.',
    trait: 'bulwark' as const,
    damageBonus: 0,
    speedBonus: 0,
    maxHealthBonus: 0,
    armorBonus: 0,
    critChanceBonus: 0,
    majorAbility: {
      id: 'chrono-surge' as const,
      name: 'Chrono Surge',
      trigger: 'passive' as const,
      speedPercent: 0.2,
      description: 'Increases turn speed.',
    },
  };
  state.inventory.push(charm);
  state.equipment.amulet = charm.id;
  assert.equal(combatStatsFor(state).speed, Math.round(before * 1.2));
});


test('Major Ability pool expands to thirty-two distinct abilities', () => {
  assert.equal(COMBAT_MAJOR_ABILITY_IDS.length, 32);
  assert.equal(new Set(COMBAT_MAJOR_ABILITY_IDS).size, 32);
  assert.ok(COMBAT_MAJOR_ABILITY_IDS.includes('titan-heart'));
  assert.ok(COMBAT_MAJOR_ABILITY_IDS.includes('genesis-core'));
  assert.ok(COMBAT_MAJOR_ABILITY_IDS.includes('expanded-reserves'));
  assert.ok(COMBAT_MAJOR_ABILITY_IDS.includes('third-beat-recharge'));
});

test('Titan Heart, Glass Cannon, Frostbrand, and Full Moon apply their equipped effects', () => {
  const state = createCombatState();
  const baseline = combatStatsFor(state);
  const titan = {
    id:'test-titan-heart', name:"Titan's Heart", slot:'ring' as const, quality:100, sourceFloor:0, power:90,
    effect:'Increases maximum HP.', trait:'keen' as const, damageBonus:0, speedBonus:0, maxHealthBonus:0, armorBonus:0, critChanceBonus:0,
    majorAbility:{id:'titan-heart' as const,name:"Titan's Heart",trigger:'passive' as const,maxHealthPercent:.2,description:'Increases maximum HP.'},
  };
  const glass = {
    id:'test-glass-cannon', name:'Glass Cannon', slot:'amulet' as const, quality:100, sourceFloor:0, power:90,
    effect:'High damage with a defensive tradeoff.', trait:'keen' as const, damageBonus:0, speedBonus:0, maxHealthBonus:0, armorBonus:0, critChanceBonus:0,
    majorAbility:{id:'glass-cannon' as const,name:'Glass Cannon',trigger:'passive' as const,damagePercent:.3,damageTakenPercent:.15,description:'Deals more damage but takes more damage.'},
  };
  const frost = {
    id:'test-frostbrand', name:'Frostbrand', slot:'helmet' as const, quality:100, sourceFloor:0, power:90,
    effect:'Reduces incoming damage.', trait:'keen' as const, damageBonus:0, speedBonus:0, maxHealthBonus:0, armorBonus:0, critChanceBonus:0,
    majorAbility:{id:'frostbrand' as const,name:'Frostbrand',trigger:'passive' as const,damageReduction:.01,description:'Reduces incoming enemy damage.'},
  };
  const moon = {
    id:'test-full-moon', name:'Full Moon', slot:'gloves' as const, quality:100, sourceFloor:0, power:90,
    effect:'Critical chance while at full HP.', trait:'keen' as const, damageBonus:0, speedBonus:0, maxHealthBonus:0, armorBonus:0, critChanceBonus:0,
    majorAbility:{id:'full-moon' as const,name:'Full Moon',trigger:'passive' as const,critChanceBonus:.1,description:'Adds critical chance while at full HP.'},
  };
  state.inventory.push(titan,glass,frost,moon);
  state.equipment.ring=titan.id;
  state.equipment.amulet=glass.id;
  state.equipment.helmet=frost.id;
  state.equipment.gloves=moon.id;
  const equipped=combatStatsFor(state);
  assert.ok(equipped.maxHealth>baseline.maxHealth,'Titan Heart increases maximum HP');
  assert.ok(equipped.damage>baseline.damage,'Glass Cannon increases outgoing damage');
  assert.ok(equipped.damageReduction<baseline.damageReduction,'Glass Cannon drawback outweighs the small Frostbrand reduction');
  assert.ok(equipped.critChance>baseline.critChance,'Full Moon increases crit chance at full health');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_RUNE_EFFECT_MULTIPLIER_CAP,
  COMBAT_RUNE_RARITIES,
  COMBAT_RUNE_RARITY_ROLL_THRESHOLDS,
  combatRuneRarityFromRoll,
  DEFAULT_COMBAT_RUNE_AUTO_SACRIFICE_SETTINGS,
  shouldAutoSacrificeRune,
  combatRuneRarityAtOrBelow,
  combatRuneBonuses,
  combatRuneMajorAbilityEffects,
  combatRuneMajorAbilityMultiplier,
  combatRuneMajorAbilityStrengthPct,
  combatRuneMajorAbilitySummary,
  createCombatState,
  combatRuneExperienceForLevel,
  combatRuneLevelFromExperience,
  combatRuneLevelMultiplier,
  combatRuneLuckMultiplier,
  combatRuneSacrificeExperience,
  combatRuneSlotsUnlocked,
  combatRuneValueFor,
  type CombatRune,
} from '../src/shared/combat.js';

const runes:CombatRune[]=[
  {id:'fate-1',name:'Radiant Fate Rune',rarity:'Rare',stat:'luckPct',value:1.4,sourceDepth:20,sourceDungeon:'undercrypt'},
  {id:'hoard-1',name:'Fractured Hoard Rune',rarity:'Common',stat:'coinGainPct',value:1.5,sourceDepth:1,sourceDungeon:'undercrypt'},
  {id:'prism-1',name:'Radiant Prism Rune',rarity:'Rare',stat:'shardChancePct',value:.08,level:100,sourceDepth:20,sourceDungeon:'undercrypt'},
  {id:'insight-1',name:'Runed Insight Rune',rarity:'Epic',stat:'xpGainPct',value:4.2,sourceDepth:30,sourceDungeon:'glass-labyrinth'},
];
test('Rune Auto Sacrifice defaults to Rare threshold and protects special effects',()=>{
  assert.deepEqual(COMBAT_RUNE_RARITIES,['Common','Uncommon','Rare','Epic','Legendary','Mythic','Cosmic','Astral','Celestial','Transcendent']);
  assert.deepEqual(DEFAULT_COMBAT_RUNE_AUTO_SACRIFICE_SETTINGS,{enabled:false,maxRarity:'Rare',targetRuneId:null,preserveSpecialEffects:true});
  assert.deepEqual(createCombatState().runeAutoSacrifice,{enabled:false,maxRarity:'Rare',targetRuneId:null,preserveSpecialEffects:true});
  assert.equal(combatRuneRarityAtOrBelow('Common','Common'),true);
  assert.equal(combatRuneRarityAtOrBelow('Rare','Rare'),true);
  assert.equal(combatRuneRarityAtOrBelow('Uncommon','Rare'),true);
  assert.equal(combatRuneRarityAtOrBelow('Epic','Rare'),false);
  assert.equal(combatRuneRarityAtOrBelow('Cosmic','Mythic'),false);
  assert.equal(combatRuneRarityAtOrBelow('Astral','Cosmic'),false);
  assert.equal(combatRuneRarityAtOrBelow('Celestial','Astral'),false);
  assert.equal(combatRuneRarityAtOrBelow('Transcendent','Celestial'),false);
});
test('Rune drop table adds three tiers at exact 10× rarer odds without reducing existing rare-tier odds',()=>{
  assert.equal(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Transcendent, .0000005);
  const expectMass = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, 'expected ' + expected + ', got ' + actual);
  expectMass(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Celestial - COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Transcendent, .000005);
  expectMass(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Astral - COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Celestial, .00005);
  expectMass(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Cosmic - COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Astral, .0005);
  expectMass(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Mythic - COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Cosmic, .002);
  expectMass(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Legendary - COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Mythic, .0075);
  expectMass(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Epic - COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Legendary, .025);
  expectMass(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Rare - COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Epic, .085);
  expectMass(COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Uncommon - COMBAT_RUNE_RARITY_ROLL_THRESHOLDS.Rare, .23);
  assert.equal(combatRuneRarityFromRoll(0), 'Transcendent');
  assert.equal(combatRuneRarityFromRoll(.0000005), 'Celestial');
  assert.equal(combatRuneRarityFromRoll(.0000055), 'Astral');
  assert.equal(combatRuneRarityFromRoll(.0000555), 'Cosmic');
  assert.equal(combatRuneRarityFromRoll(.0005555), 'Mythic');
  assert.equal(combatRuneRarityFromRoll(.0025555), 'Legendary');
  assert.equal(combatRuneRarityFromRoll(1), 'Common');
});
test('Auto Sacrifice preserves Major Ability Runes unless preservation is disabled',()=>{
  const special:CombatRune={...runes[1]!,majorAbility:{id:'memory-well',name:'Memory Well',valuePct:10,description:'Improves XP gain.'}};
  assert.equal(shouldAutoSacrificeRune(runes[1]!, 'Rare', true),true);
  assert.equal(shouldAutoSacrificeRune(special, 'Rare', true),false);
  assert.equal(shouldAutoSacrificeRune(special, 'Rare', false),true);
  assert.equal(shouldAutoSacrificeRune(runes[3]!, 'Rare', false),false);
});
test('Rune bonuses only count Runes in the equipped loadout',()=>{
  assert.deepEqual(combatRuneBonuses(runes,['fate-1','insight-1']),{luckPct:1.4,coinGainPct:0,shardChancePct:0,xpGainPct:4.2});
});
test('all eleven trigger-based Rune Major Abilities scale and expose distinct mechanics',()=>{
  const abilityRunes:CombatRune[]=[
    {...runes[0]!,id:'echo',level:1,majorAbility:{id:'echo-chamber',name:'Echo Chamber',valuePct:10,description:''}},
    {...runes[1]!,id:'paradox',level:1,majorAbility:{id:'paradox-engine',name:'Paradox Engine',valuePct:12,description:''}},
    {...runes[0]!,id:'horizon',level:1,majorAbility:{id:'event-horizon',name:'Event Horizon',valuePct:15,description:''}},
    {...runes[2]!,id:'constellation',level:1,majorAbility:{id:'shard-constellation',name:'Shard Constellation',valuePct:20,description:''}},
    {...runes[3]!,id:'temporal',level:1,majorAbility:{id:'temporal-loop',name:'Temporal Loop',valuePct:8,description:''}},
    {...runes[0]!,id:'fork',level:1,majorAbility:{id:'prismatic-fork',name:'Prismatic Fork',valuePct:18,description:''}},
    {...runes[0]!,id:'critical',level:1,majorAbility:{id:'critical-convergence',name:'Critical Convergence',valuePct:16,description:''}},
    {...runes[1]!,id:'ladder',level:1,majorAbility:{id:'rarity-ladder',name:'Rarity Ladder',valuePct:14,description:''}},
    {...runes[0]!,id:'dividend',level:1,majorAbility:{id:'stellar-dividend',name:'Stellar Dividend',valuePct:22,description:''}},
    {...runes[2]!,id:'jackpot',level:1,majorAbility:{id:'shard-jackpot',name:'Shard Jackpot',valuePct:25,description:''}},
    {...runes[3]!,id:'milestone',level:1,majorAbility:{id:'milestone-engine',name:'Milestone Engine',valuePct:20,description:''}},
  ];
  const equipped=abilityRunes.map(rune=>rune.id);
  const effects=combatRuneMajorAbilityEffects(abilityRunes,equipped);
  assert.equal(effects.echoChamberPct,8.5);
  assert.equal(effects.paradoxEnginePct,6);
  assert.equal(effects.eventHorizonPct,12.75);
  assert.equal(effects.shardConstellationPct,17);
  assert.equal(effects.temporalLoopPct,8);
  assert.ok(Math.abs(effects.prismaticForkPct-15.3)<1e-12);
  assert.equal(effects.criticalConvergencePct,13.6);
  assert.equal(effects.rarityLadderPct,7);
  assert.equal(effects.stellarDividendPct,18.7);
  assert.equal(effects.shardJackpotPct,21.25);
  assert.equal(effects.milestoneEnginePct,20);
  assert.ok(effects.echoChamberMaxChain>=1);
  assert.ok(effects.paradoxEngineBonusRolls>=1);
  assert.ok(effects.eventHorizonBonusRolls>=1);
  assert.equal(effects.shardConstellationBonusShards,1);
  assert.ok(effects.shardConstellationBonusRolls<=2);
  assert.ok(effects.temporalLoopMomentumPerRoll>1);
  assert.ok(effects.criticalConvergenceBonusRolls>=1);
  assert.ok(effects.rarityLadderBonusRolls>=1);
  assert.ok(effects.stellarDividendBonusRolls>=1);
  assert.equal(effects.shardJackpotExtraMultiplier,1,'Jackpot can only double a single-Shard payout');
  assert.ok(effects.milestoneEngineBonusRolls>=1 && effects.milestoneEngineBonusRolls<=2);
  assert.equal(effects.milestoneEngineBonusShards,1);
  assert.ok(combatRuneMajorAbilityStrengthPct(abilityRunes[0]!.majorAbility!,256,abilityRunes[0]!.rarity)>combatRuneMajorAbilityStrengthPct(abilityRunes[0]!.majorAbility!,1,abilityRunes[0]!.rarity));
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[0]!.majorAbility!,20,abilityRunes[0]!.rarity),/echo|chain/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[1]!.majorAbility!,20,abilityRunes[1]!.rarity),/multi-roll|extra roll/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[2]!.majorAbility!,20,abilityRunes[2]!.rarity),/record|rarity floor/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[3]!.majorAbility!,20,abilityRunes[3]!.rarity),/Shards|bonus roll/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[4]!.majorAbility!,20,abilityRunes[4]!.rarity),/Momentum|bonus roll/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[5]!.majorAbility!,20,abilityRunes[5]!.rarity),/fork|rarity floor/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[6]!.majorAbility!,20,abilityRunes[6]!.rarity),/critical|bonus roll/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[7]!.majorAbility!,20,abilityRunes[7]!.rarity),/rising rarities/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[8]!.majorAbility!,20,abilityRunes[8]!.rarity),/lifetime rolls/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[9]!.majorAbility!,20,abilityRunes[9]!.rarity),/Shard payout/i);
  assert.match(combatRuneMajorAbilitySummary(abilityRunes[10]!.majorAbility!,20,abilityRunes[10]!.rarity),/power of ten/i);
  assert.equal(combatRuneMajorAbilityEffects(abilityRunes,equipped.slice(0,2)).eventHorizonPct,0,'unequipped Major Abilities must not be active');
});
test('Rune rarity multipliers strengthen real Major Ability power and its displayed summary',()=>{
  const fateAbility={id:'fateweaver',name:'Fateweaver',valuePct:20,description:'Adds effective Luck.'} as const;
  const echoAbility={id:'echo-chamber',name:'Echo Chamber',valuePct:20,description:'Echoes rolls.'} as const;
  const expectedPower=[10,14,17,20,24,29,36,42,48,56];
  const expectedMultipliers=[.5,.7,.85,1,1.2,1.45,1.8,2.1,2.4,2.8];
  assert.deepEqual(
    COMBAT_RUNE_RARITIES.map(rarity=>combatRuneMajorAbilityMultiplier(rarity)),
    expectedMultipliers,
  );
  assert.deepEqual(
    COMBAT_RUNE_RARITIES.map(rarity=>combatRuneMajorAbilityStrengthPct(fateAbility,1,rarity)),
    expectedPower,
  );
  for(let index=0;index<COMBAT_RUNE_RARITIES.length;index++){
    const rarity=COMBAT_RUNE_RARITIES[index]!;
    const rune:CombatRune={
      id:'rarity-fate-'+rarity,name:rarity+' Fate Rune',rarity,stat:'luckPct',value:.6,
      level:1,sourceDepth:0,sourceDungeon:'undercrypt',majorAbility:fateAbility,
    };
    assert.equal(
      combatRuneBonuses([rune],[rune.id]).luckPct,
      .6+expectedPower[index]!,
      rarity+' Fateweaver must use the rarity multiplier in the actual Luck bonus',
    );
    const triggerRune:CombatRune={...rune,id:'rarity-echo-'+rarity,majorAbility:echoAbility};
    assert.equal(
      combatRuneMajorAbilityEffects([triggerRune],[triggerRune.id]).echoChamberPct,
      expectedPower[index],
      rarity+' Echo Chamber must use the rarity multiplier in its active proc chance',
    );
    assert.ok(
      combatRuneMajorAbilitySummary(fateAbility,1,rarity).includes('+'+expectedPower[index]+'% effective Luck'),
      rarity+' tooltip must show the same rarity-scaled starting power',
    );
  }
});

test('Rune slot milestones are earned through Delver levels and depth',()=>{
  assert.equal(combatRuneSlotsUnlocked(1,1),2);
  assert.equal(combatRuneSlotsUnlocked(10,1),3);
  assert.equal(combatRuneSlotsUnlocked(25,1),4);
  assert.equal(combatRuneSlotsUnlocked(25,50),5);
});
test('Rune base value scales with rarity and depth while retaining shard precision',()=>{
  assert.ok(combatRuneValueFor('Cosmic','luckPct',50)>combatRuneValueFor('Common','luckPct',0));
  assert.ok(combatRuneValueFor('Astral','luckPct',50)>combatRuneValueFor('Cosmic','luckPct',50));
  assert.ok(combatRuneValueFor('Celestial','luckPct',50)>combatRuneValueFor('Astral','luckPct',50));
  assert.ok(combatRuneValueFor('Transcendent','luckPct',50)>combatRuneValueFor('Celestial','luckPct',50));
  assert.ok(combatRuneValueFor('Epic','shardChancePct',30)>0);
});
test('Rune Luck percentages map directly to strong rarity multipliers',()=>{
  assert.equal(combatRuneLuckMultiplier(0),1);
  assert.equal(combatRuneLuckMultiplier(900),10);
  assert.ok(combatRuneLuckMultiplier(9_000)>90);
  assert.ok(combatRuneLuckMultiplier(Number.MAX_VALUE)>Number.MAX_SAFE_INTEGER);
});
test('Rune effect scaling grows strongly and approaches a large soft cap',()=>{
  assert.equal(combatRuneLevelMultiplier(1),1);
  assert.ok(combatRuneLevelMultiplier(20)>combatRuneLevelMultiplier(10));
  assert.ok(combatRuneLevelMultiplier(100)<COMBAT_RUNE_EFFECT_MULTIPLIER_CAP);
  assert.ok(combatRuneLevelMultiplier(10_000)>990_000);
  assert.equal(combatRuneLevelMultiplier(Number.MAX_SAFE_INTEGER),COMBAT_RUNE_EFFECT_MULTIPLIER_CAP);
  assert.ok(combatRuneExperienceForLevel(100)>combatRuneExperienceForLevel(10));
  assert.equal(combatRuneLevelFromExperience(0),1);
  assert.equal(combatRuneLevelFromExperience(combatRuneExperienceForLevel(20)),20);
  const highLuck:CombatRune={id:'hi-luck',name:'Cosmic Fate',rarity:'Cosmic',stat:'luckPct',value:combatRuneValueFor('Cosmic','luckPct',50),level:10,sourceDepth:50,sourceDungeon:'undercrypt'};
  const highCoins:CombatRune={id:'hi-coins',name:'Cosmic Hoard',rarity:'Cosmic',stat:'coinGainPct',value:combatRuneValueFor('Cosmic','coinGainPct',50),level:10,sourceDepth:50,sourceDungeon:'undercrypt'};
  const bonuses=combatRuneBonuses([highLuck,highCoins],[highLuck.id,highCoins.id]);
  assert.ok(bonuses.luckPct>900,'a high-rarity Luck Rune remains much stronger at level 10');
  assert.ok(bonuses.coinGainPct>900,'a high-rarity Coin Rune remains much stronger at level 10');
  const atSoftCap:CombatRune={...highLuck,id:'at-soft-cap',level:Number.MAX_SAFE_INTEGER};
  assert.ok(combatRuneBonuses([atSoftCap],[atSoftCap.id]).luckPct>highLuck.value*100_000);
});
test('Shard Rune chance is exactly unaffected by Rune level',()=>{
  const level1:CombatRune={...runes[2]!,level:1};
  const level1000:CombatRune={...runes[2]!,level:1000};
  assert.equal(combatRuneBonuses([level1],[level1.id]).shardChancePct,.08);
  assert.equal(combatRuneBonuses([level1000],[level1000.id]).shardChancePct,.08);
});
test('Rune sacrifice XP increases with rarity, donor level, and source depth',()=>{
  const common=combatRuneSacrificeExperience({rarity:'Common',level:1,sourceDepth:0});
  const cosmic=combatRuneSacrificeExperience({rarity:'Cosmic',level:1,sourceDepth:0});
  const astral=combatRuneSacrificeExperience({rarity:'Astral',level:1,sourceDepth:0});
  const celestial=combatRuneSacrificeExperience({rarity:'Celestial',level:1,sourceDepth:0});
  const transcendent=combatRuneSacrificeExperience({rarity:'Transcendent',level:1,sourceDepth:0});
  const deepCosmic=combatRuneSacrificeExperience({rarity:'Cosmic',level:1,sourceDepth:1000});
  const rankedCosmic=combatRuneSacrificeExperience({rarity:'Cosmic',level:10,sourceDepth:0});
  assert.ok(cosmic>common);
  assert.ok(astral>cosmic);
  assert.ok(celestial>astral);
  assert.ok(transcendent>celestial);
  assert.ok(deepCosmic>cosmic);
  assert.ok(rankedCosmic>cosmic);
});

test('invalid Rune progression inputs cannot unlock slots or propagate NaN values',()=>{
  assert.equal(combatRuneSlotsUnlocked(Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY),2);
  assert.equal(combatRuneSlotsUnlocked(Number.NaN,Number.NaN),2);
  assert.equal(combatRuneValueFor('Unknown' as never,'luckPct',10),0);
  assert.equal(combatRuneValueFor('Rare','unknown' as never,10),0);
  assert.equal(combatRuneValueFor('Rare','luckPct',Number.POSITIVE_INFINITY),combatRuneValueFor('Rare','luckPct',0));
  assert.equal(combatRuneSacrificeExperience({rarity:'Unknown' as never,level:1,sourceDepth:0}),1);
});

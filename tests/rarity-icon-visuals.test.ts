import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTINUUM_TIERS, getOrbInfo, getOrbTier } from '../src/shared/game.js';

test('rarity milestone icons use the canonical orb colors and only shine when reached', () => {
  const icon = readFileSync(resolve(process.cwd(), 'src/client/components/RarityOrbIcon.tsx'), 'utf8');
  const codex = readFileSync(resolve(process.cwd(), 'src/client/components/CollectionSection.tsx'), 'utf8');
  const table = readFileSync(resolve(process.cwd(), 'src/client/components/RarityTableModal.tsx'), 'utf8');

  assert.ok(icon.includes('getOrbInfo(rarity)'));
  assert.ok(icon.includes('info.color'));
  assert.ok(icon.includes('info.bgGradient'));
  assert.ok(icon.includes("unlocked ? 'is-unlocked' : 'is-locked'"));
  assert.ok(codex.includes('<RarityOrbIcon rarity={milestone.minRarity} unlocked={reached} />'));
  assert.ok(codex.includes("'--io-tier-color': milestone.color"));
  assert.ok(table.includes('<RarityOrbIcon rarity={tier.minRarity} unlocked={highestRarity >= tier.minRarity} compact />'));
});

test('rarity orb sizes increase in fullscreen and animated effects respect reduced motion', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/client/experience-200.css'), 'utf8');

  assert.ok(css.includes(':fullscreen .io-rarity-orb-icon'));
  assert.ok(css.includes('html:fullscreen .io-rarity-orb-icon'));
  assert.ok(css.includes('@media (display-mode: fullscreen)'));
  assert.ok(css.includes('width: clamp(62px, 6.2vw, 116px)'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(css.includes('.io-rarity-orb-icon__shine'));
  assert.ok(css.includes('@keyframes io-rarity-orb-pulse'));
  assert.ok(css.includes('@keyframes io-rarity-orb-sheen'));
});

test('Devvit expanded mode gets roomy Codex cards and a wide rarity table', () => {
  const responsiveCss = readFileSync(resolve(process.cwd(), 'src/client/mobile-experience.css'), 'utf8');
  const main = readFileSync(resolve(process.cwd(), 'src/client/main.tsx'), 'utf8');

  assert.ok(main.includes("useState<'inline' | 'expanded'>"));
  assert.ok(main.includes('getWebViewMode()'));
  assert.ok(main.includes("window.addEventListener('focus', syncWebViewMode)"));
  assert.ok(main.includes("'io-expanded-view'"));
  assert.ok(responsiveCss.includes('.io-ui.io-expanded-view .io-page-codex .io-codex-milestone-grid'));
  assert.ok(responsiveCss.includes('grid-template-columns: repeat(9, minmax(0, 1fr)) !important;'));
  assert.ok(responsiveCss.includes('width: clamp(48px, 5vw, 88px) !important'));
  assert.ok(responsiveCss.includes('.io-ui.io-expanded-view .io-rarity-modal'));
  assert.ok(responsiveCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr)) !important'));
});

test('the fourth rarity continuum row has animated shifting spectrum colors', () => {
  const responsiveCss = readFileSync(resolve(process.cwd(), 'src/client/mobile-experience.css'), 'utf8');
  const table = readFileSync(resolve(process.cwd(), 'src/client/components/RarityTableModal.tsx'), 'utf8');

  assert.ok(table.includes("tierIndex === 3 ? 'io-rarity-tier-row--shifting'"));
  assert.ok(responsiveCss.includes('.io-rarity-tier-row--shifting'));
  assert.ok(responsiveCss.includes('@keyframes io-rarity-epic-row-shift'));
  assert.ok(responsiveCss.includes('@keyframes io-rarity-epic-orb-shift'));
  assert.ok(responsiveCss.includes('io-rarity-tier-row--shifting::before'));
  assert.ok(responsiveCss.includes('@media (prefers-reduced-motion: reduce)'));
});


test('expanded Codex shows nine milestones per row and mobile shows three', () => {
  const responsiveCss = readFileSync(resolve(process.cwd(), 'src/client/mobile-experience.css'), 'utf8');
  const expandedGrid = responsiveCss.slice(
    responsiveCss.indexOf('.io-ui.io-expanded-view .io-page-codex .io-codex-milestone-grid'),
    responsiveCss.indexOf('.io-ui.io-expanded-view .io-page-codex .io-codex-milestone-card'),
  );
  const mobileStart = responsiveCss.indexOf('@media (max-width: 760px)', responsiveCss.indexOf('Devvit expanded mode is the game'));
  const mobileCss = responsiveCss.slice(mobileStart);

  assert.ok(expandedGrid.includes('repeat(9, minmax(0, 1fr))'));
  assert.ok(mobileCss.includes('grid-template-columns: repeat(3, minmax(0, 1fr)) !important;'));
  assert.ok(mobileCss.includes('width: clamp(46px, 13.5vw, 64px) !important;'));
});

test('mobile multi-roll preview shows up to three distinct actual Orbs including the centerpiece', () => {
  const orbit = readFileSync(resolve(process.cwd(), 'src/client/components/OrbOrbit.tsx'), 'utf8');
  const roll = readFileSync(resolve(process.cwd(), 'src/client/components/RollSection.tsx'), 'utf8');

  assert.ok(roll.includes('<OrbOrbit orbs={lastBatch} radius={orbitRadius} primaryOrb={displayOrb} />'));
  assert.ok(orbit.includes("window.matchMedia('(max-width: 760px)')"));
  assert.ok(orbit.includes('companionOrbs.slice(0, 2)'));
  assert.ok(orbit.includes('companionOrbs.slice(0, 7)'));
  assert.ok(orbit.includes('const orbitRadius = isMobile ? Math.min(radius, 104) : radius;'));
  assert.ok(orbit.includes('index / visibleOrbs.length'));
  assert.ok(orbit.includes('orb.name === primaryOrb.name'));
});


test('nine new rarity tiers scale by e3 and the original 27 colors are unique', () => {
  const extension = [
    ['Hyperion', 1e38],
    ['Ethereal', 1e41],
    ['Aetherion', 1e44],
    ['Nexus', 1e47],
    ['Archetype', 1e50],
    ['Apotheosis', 1e53],
    ['Eschaton', 1e56],
    ['Omniform', 1e59],
    ['Eternity', 1e62],
  ] as const;

  assert.equal(CONTINUUM_TIERS.length, 36);
  assert.equal(new Set(CONTINUUM_TIERS.slice(0, 27).map(tier => tier.color)).size, 27);
  assert.equal(CONTINUUM_TIERS[26]?.tier, 'Omega');

  for (let index = 0; index < extension.length; index += 1) {
    const [tier, threshold] = extension[index];
    assert.equal(getOrbTier(threshold), tier);
    assert.equal(getOrbInfo(threshold).animated, true);
    assert.equal(getOrbInfo(threshold).tier, tier);
    if (index > 0) {
      const [previousTier, previousThreshold] = extension[index - 1];
      assert.ok(Math.abs(Math.log10(threshold / previousThreshold) - 3) < 1e-12);
      assert.equal(getOrbTier(threshold / 10), previousTier);
    }
  }

  assert.equal(getOrbTier(1e37), 'Omega');
  assert.equal(getOrbInfo(1e35).animated, false);
  assert.equal(getOrbInfo(Number.MAX_VALUE, true).animated, false);
});



test('animated Orb borders inherit the same color source as each Orb fill', () => {
  const roll = readFileSync(resolve(process.cwd(), 'src/client/components/RollSection.tsx'), 'utf8');
  const orbit = readFileSync(resolve(process.cwd(), 'src/client/components/OrbOrbit.tsx'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/client/mobile-experience.css'), 'utf8');

  assert.ok(roll.includes("borderColor: orbInfo?.color ?? '#6366f1'"));
  assert.ok(roll.includes('io-rarity-color-cycle'));
  assert.ok(orbit.includes('background: info.bgGradient, borderColor: info.color'));
  assert.ok(css.includes('.io-ui .io-main-orb'));
  assert.ok(css.includes('border-color: var(--io-orb-current-color'));
  assert.ok(css.includes('.io-ui .io-orbit-satellite-core'));
});

test('rarities 19–27 use distinct multi-color orb gradients', () => {
  const expected = ['Empyrean', 'Hyperversal', 'Transfinite', 'Metacosmic', 'Primordial', 'Unfathomable', 'Axiom', 'Omniscient', 'Omega'];
  const tiers = CONTINUUM_TIERS.slice(18, 27);

  assert.deepEqual(tiers.map(tier => tier.tier), expected);
  for (const tier of tiers) {
    const info = getOrbInfo(tier.minRarity);
    const colors = [...new Set(info.bgGradient.match(/#[0-9A-F]{6}/gi) ?? [])];
    assert.ok(colors.length >= 4, `${tier.tier} should render with at least four gradient colors`);
  }
});

test('restored multiball satellites and faster rarity color cycling have visible styles', () => {
  const orbit = readFileSync(resolve(process.cwd(), 'src/client/components/OrbOrbit.tsx'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/client/mobile-experience.css'), 'utf8');
  const table = readFileSync(resolve(process.cwd(), 'src/client/components/RarityTableModal.tsx'), 'utf8');
  const icon = readFileSync(resolve(process.cwd(), 'src/client/components/RarityOrbIcon.tsx'), 'utf8');

  assert.ok(orbit.includes('io-orbit-satellite-core'));
  assert.ok(orbit.includes("info.animated ? 'io-rarity-color-cycle' : ''"));
  assert.ok(css.includes('.io-ui .io-orbit-satellite-core'));
  assert.ok(css.includes('@keyframes io-rarity-color-cycle'));
  assert.ok(css.includes('animation: io-rarity-color-cycle 16s linear infinite'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(table.includes('io-rarity-tier-row--animated'));
  assert.ok(icon.includes("info.animated ? 'io-rarity-color-cycle' : ''"));
});

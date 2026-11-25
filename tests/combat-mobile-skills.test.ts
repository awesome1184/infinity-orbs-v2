import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Combat Skill Gacha opens readable tap-first details on mobile', () => {
  const combat = source('src/client/components/CombatSection.tsx');
  const mobileCss = source('src/client/mobile-experience.css');

  assert.match(combat, /setMobileDetailSkillId\(skill\.id\)/);
  assert.match(combat, /data-testid="combat-skill-mobile-details"/);
  assert.match(combat, /role="dialog"/);
  assert.match(combat, /skillValue\(mobileDetailSkill/);
  assert.match(combat, /mobileDetailCopies/);
  assert.match(combat, /mobileDetailActionLabel/);
  assert.match(combat, /Close skill details/);
  assert.match(mobileCss, /\.io-combat-skill-mobile-detail-backdrop/);
  assert.match(mobileCss, /\.io-combat-skill-mobile-detail[\s\S]*max-height: min\(82dvh, 680px\)/);
  assert.match(mobileCss, /io-combat-skill-icon-wrap \.io-combat-skill-tooltip[\s\S]*display: none !important/);
});

test('all seven Combat tabs stay reachable from the mobile bottom dock without horizontal scrolling', () => {
  const navigation = source('src/client/main.tsx');
  const mobileCss = source('src/client/mobile-experience.css');

  assert.match(navigation, /io-nav-combat-list/);
  assert.match(navigation, /io-nav-combat-overflow/);
  assert.match(navigation, /io-nav-combat-mobile-more/);
  assert.match(navigation, /aria-controls="io-combat-more-navigation"/);
  assert.match(navigation, /renderNavItem\('runes', 'Runes', Gem\)/);
  assert.match(navigation, /renderNavItem\('forge', 'Forge', Hammer\)/);
  assert.match(navigation, /renderNavItem\('arena', 'Arena', Users\)/);
  assert.match(navigation, /Back to Orbs/);
  assert.match(navigation, /io-app-main-combat/);
  assert.match(mobileCss, /\.app-nav\.io-nav-combat[\s\S]*position: fixed !important[\s\S]*bottom: 0 !important/);
  assert.match(mobileCss, /\.io-nav-combat-list[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(mobileCss, /\.io-nav-combat-menu[\s\S]*bottom: calc\(100% \+ 8px\)/);
  assert.match(mobileCss, /\.io-nav-combat-list > \.io-nav-combat-overflow[\s\S]*display: none !important/);
});

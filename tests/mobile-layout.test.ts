import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInitialState, upgradeUnlockLevel } from '../src/shared/game.js';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('mobile stylesheet is loaded after desktop and general experience polish', () => {
  const main = read('src/client/main.tsx');
  const styles = main.indexOf("import './styles.css'");
  const polish = main.indexOf("import './ui-polish.css'");
  const experience = main.indexOf("import './experience-200.css'");
  const mobile = main.indexOf("import './mobile-experience.css'");

  assert.ok(styles >= 0 && styles < polish);
  assert.ok(polish < experience && experience < mobile);
});

test('mobile navigation keeps core tabs visible and routes secondary tabs through More', () => {
  const main = read('src/client/main.tsx');
  const css = read('src/client/mobile-experience.css');

  assert.ok(main.includes("renderNavItem('roll', 'Roll', Sparkles)"));
  assert.ok(main.includes("renderNavItem('upgrades', 'Upgrades', Zap)"));
  assert.ok(main.includes("renderNavItem('collection', 'Collection', BookOpen)"));
  assert.ok(main.includes("renderNavItem('quests', 'Quests', Calendar, streakReady || questsReady, 'io-nav-mobile-only')"));
  assert.ok(main.includes("renderNavItem('social', 'Guilds', Users, false, 'io-nav-mobile-only')"));
  assert.ok(css.includes('.io-ui .app-nav:not(.io-nav-combat) .io-nav-primary > .nav-tab:nth-child(n + 4)'));
  assert.ok(css.includes('.io-ui .io-nav-mobile-only { display: flex !important; }'));
  assert.ok(css.includes('.io-ui .io-nav-combat .io-nav-combat-list'));
});

test('mobile shell respects safe areas and leaves one natural document scroller', () => {
  const css = read('src/client/mobile-experience.css');

  assert.ok(css.includes('env(safe-area-inset-top, 0px)'));
  assert.ok(css.includes('env(safe-area-inset-bottom, 0px)'));
  assert.ok(css.includes('position: fixed !important;'));
  assert.ok(css.includes('inset: auto 0 0;'));
  assert.ok(css.includes('overflow-y: auto !important;'));
  assert.ok(css.includes('max-height: none !important;'));
});

test('mobile roll and progression pages use readable card layouts and large actions', () => {
  const css = read('src/client/mobile-experience.css');

  assert.ok(css.includes('.io-ui .roll-controls .roll-button'));
  assert.ok(css.includes('min-height: 54px;'));
  assert.ok(css.includes('.io-ui .io-page-upgrades > .io-page-hero + div > section > .grid'));
  assert.ok(css.includes('.io-ui .io-page-codex > .grid[class*="grid-cols-"]'));
  assert.ok(css.includes('.io-ui .io-page-quests > .io-page-hero ~ div.space-y-3 > .grid'));
  assert.ok(css.includes('.io-ui .io-page-social > [role="group"][aria-label="Guilds and social sections"]'));
  assert.ok(css.includes('.io-ui .io-page-altar > form'));
  assert.ok(css.includes('.io-ui .io-page-mastery > .io-page-hero + div'));
  assert.ok(css.includes('.io-ui .io-page-boosters > section'));
});

test('all combat destinations and rune tools receive dedicated phone layouts', () => {
  const css = read('src/client/mobile-experience.css');

  for (const page of ['fight','dungeons','gear','forge','skills','arena']) {
    assert.ok(css.includes('.io-ui .io-combat-page-' + page), 'missing responsive rules for ' + page);
  }
  assert.ok(css.includes('.io-ui .io-runes-page .io-runes-inventory'));
  assert.ok(css.includes('.io-ui .io-runes-page .io-runes-filter-group'));
});

test('dialogs remain scrollable above the bottom navigation and preserve reduced motion', () => {
  const css = read('src/client/mobile-experience.css');

  assert.ok(css.includes('.io-ui .io-modal-backdrop'));
  assert.ok(css.includes('max-height: min(90dvh, 820px) !important;'));
  assert.ok(css.includes('overscroll-behavior: contain;'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
});


test('mobile second pass keeps the selected More destination visible and improves thumb targets', () => {
  const main = read('src/client/main.tsx');
  const css = read('src/client/mobile-experience.css');

  assert.ok(main.includes("{tab === 'profile' && <span className=\"io-nav-current-page\">Progress</span>}"));
  assert.ok(css.includes('.io-ui .io-combat-command-group'));
  assert.ok(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;'));
  assert.ok(css.includes('.io-ui .io-combat-command {'));
  assert.ok(css.includes('min-height: 56px;'));
  assert.ok(css.includes('.io-ui .roll-controls .roll-button'));
  assert.ok(css.includes('min-height: 58px;'));
  assert.ok(css.includes('outline: 2px solid #8bc8ff;'));
});

test('mobile content reserves space for the taller thumb navigation and preserves phone breakpoints', () => {
  const css = read('src/client/mobile-experience.css');

  assert.ok(css.includes('calc(128px + env(safe-area-inset-bottom, 0px))'));
  assert.ok(css.includes('grid-template-columns: minmax(0, 1fr) 116px;'));
  assert.ok(css.includes('@media (max-width: 359px)'));
  assert.ok(css.includes('scroll-snap-type: x proximity;'));
});


test('standard Coin upgrades unlock in level order with only four starters at Level 1', () => {
  const state = createInitialState();
  const starters = ['speed', 'multi', 'luck', 'coinBonus'] as const;
  assert.equal(state.level, 1);
  assert.deepEqual(starters.map(upgradeUnlockLevel), [1, 1, 1, 1]);
  assert.deepEqual(
    ['xpBonus', 'shardChance', 'critChance', 'valueBonus', 'critPower', 'offlineRate', 'clusterRoll']
      .map(id => upgradeUnlockLevel(id as Parameters<typeof upgradeUnlockLevel>[0])),
    [5, 10, 15, 20, 25, 30, 50],
  );
  const server = read('src/server/game.ts');
  assert.match(server, /s\.level < requiredPlayerLevel/);
  assert.match(server, /s\.level < upgradeUnlockLevel\(id\)/);
});

test('mobile shop shows core upgrades before stats and uses a two-by-two starter grid', () => {
  const upgrades = read('src/client/components/UpgradesSection.tsx');
  const css = read('src/client/mobile-experience.css');
  const core = upgrades.indexOf("title: 'Core upgrades'");
  const early = upgrades.indexOf("title: 'Early unlocks'");
  const stats = upgrades.indexOf('io-upgrade-stats-card');
  assert.ok(core >= 0 && early > core);
  assert.ok(stats > early);
  assert.ok(css.includes('.io-ui .io-upgrade-primary-group .io-upgrade-card-grid'));
  assert.ok(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;'));
});

test('50-use roll tickets warm before the first tap and remain server-consumed in order', () => {
  const main = read('src/client/main.tsx');
  const server = read('src/server/game.ts');
  assert.match(server, /const ROLL_TICKET_COUNT = 50;/);
  assert.match(main, /current\.nextIndex < 50/);
  assert.match(main, /if \(!stateRef\.current \|\| stateRef\.current\.gameBan\?\.active\) return;\s*void ensureRollTicket\(\)/);
  assert.doesNotMatch(main, /if \(!splashEntered \|\| !stateRef\.current\) return;\s*void ensureRollTicket/);
});

test('normal roll response does not wait for the combat-focus projection', () => {
  const app = read('src/server/app.ts');
  const route = app.slice(app.indexOf("app.post('/api/roll'"), app.indexOf("app.post('/api/auto-roll'"));
  assert.match(route, /queueCombatOrbFocusSync\(rolledOrb\.rarity, rolledOrb\.name\)/);
  assert.doesNotMatch(route, /await setCombatOrbFocus/);
});

test('gold replaces the brown upgrade accent and mobile dialogs become scrollable sheets', () => {
  const polish = read('src/client/ui-polish.css');
  const css = read('src/client/mobile-experience.css');
  assert.ok(polish.includes('--io-upgrade-gold: #e9c45b;'));
  assert.ok(polish.includes('background-color: #98742a !important;'));
  assert.ok(polish.includes('background-color: #b28a31 !important;'));
  assert.ok(css.includes('align-items: flex-end !important;'));
  assert.ok(css.includes('max-height: min(84dvh, 720px) !important;'));
  assert.ok(css.includes('overscroll-behavior: contain;'));
});


test('desktop layouts use natural page flow and readable wide upgrade cards', () => {
  const css = read('src/client/mobile-experience.css');
  const upgrades = read('src/client/components/UpgradesSection.tsx');
  const desktopPass = css.slice(css.lastIndexOf('2.1.34 desktop breathing-room pass'));

  assert.ok(desktopPass.includes('@media (min-width: 1180px)'));
  assert.ok(desktopPass.includes('max-width: min(100%, 1720px) !important;'));
  assert.ok(desktopPass.includes('height: auto !important;'));
  assert.ok(desktopPass.includes('overflow: visible !important;'));
  assert.ok(desktopPass.includes('grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)) !important;'));
  assert.doesNotMatch(upgrades, /Idle-game synergy:/);
});


test('mobile Gear inventory exposes a direct Equip button on every item', () => {
  const combat = read('src/client/components/CombatSection.tsx');
  const css = read('src/client/mobile-experience.css');

  const cardStart = combat.indexOf("className={'io-combat-gear-icon-wrap");
  const cardEnd = combat.indexOf('{showTooltip&&tooltipPoint&&createPortal(', cardStart);
  assert.ok(cardStart >= 0 && cardEnd > cardStart, 'gear item card must be present');
  const card = combat.slice(cardStart, cardEnd);
  assert.ok(card.includes('data-testid="mobile-gear-equip"'));
  assert.ok(card.includes('disabled={busy || isEquipped}'));
  assert.ok(card.includes('onClick={onEquip}'));
  assert.ok(card.includes("{isEquipped ? 'Equipped' : 'Equip'}"));
  assert.ok(css.includes('.io-ui .io-combat-page-gear .io-combat-gear-mobile-equip'));
  assert.ok(css.includes('min-height: 46px;'));
  assert.ok(css.includes('touch-action: manipulation;'));
});

test('mobile Global Chat panel sits above the bottom navigation', () => {
  const component = read('src/client/components/GlobalChatWindow.tsx');
  const css = read('src/client/mobile-experience.css');

  assert.ok(component.includes('className="io-chat-window fixed bottom-4 right-4'));
  assert.ok(css.includes('.io-ui .io-chat-window {'));
  assert.ok(css.includes('bottom: calc(88px + env(safe-area-inset-bottom,0px)) !important;'));
});

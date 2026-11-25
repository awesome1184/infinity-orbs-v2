import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('production Redis MGet is bounded and adapts to Devvit response-size limits', () => {
  const index = source('src/server/index.ts');
  const batch = source('src/server/redis-batch.ts');

  assert.match(index, /new Proxy\(redis/);
  assert.match(index, /property === 'mGet'/);
  assert.match(index, /mGetInChunks/);
  assert.match(batch, /REDIS_MGET_BATCH_SIZE = 20/);
  assert.match(batch, /max response size limit/i);
});

test('main and shared post CTAs use the animated high-visibility play button', () => {
  const splash = source('src/client/splash.tsx');
  const styles = source('src/client/post-revamp.css');
  const shellStyles = source('src/client/styles.css');

  assert.ok(splash.includes('io-post-cta'));
  assert.ok(splash.includes('YOUR FIRST ORB IS ONE TAP AWAY'));
  assert.ok(splash.includes('YOUR CODEX STARTS WITH ONE ROLL'));
  assert.match(styles, /@keyframes io-post-cta-pulse/);
  assert.match(styles, /@keyframes io-post-cta-sheen/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test('Frenzy stays playable through the claim cooldown and expiry timer', () => {
  const frenzy = source('src/client/frenzy.tsx');
  const styles = source('src/client/post-revamp.css');

  assert.ok(frenzy.includes('CLAIM THE FRENZY · PLAY NOW'));
  assert.ok(frenzy.includes('START YOUR OWN CODEX'));
  assert.ok(frenzy.includes('Play Infinity Orbs'));
  assert.ok(frenzy.includes("requestExpandedMode(event.nativeEvent, 'game')"));
  assert.ok(frenzy.includes('io-frenzy-button io-post-cta'));
  assert.ok(frenzy.includes('Your claim cooldown'));
  assert.ok(frenzy.includes('You can still play while this timer runs.'));
  assert.ok(frenzy.includes('Frenzy expires in'));
  assert.match(styles, /\.io-frenzy-rarity-number/);
  assert.match(styles, /\.io-frenzy-cooldown-mini/);
});

test('claiming a Frenzy uses the animated main-game-style reward reveal', () => {
  const frenzy = source('src/client/frenzy.tsx');
  const styles = source('src/client/post-revamp.css');

  assert.ok(frenzy.includes('FRENZY REWARD CONFIRMED'));
  assert.ok(frenzy.includes('io-frenzy-success-stage'));
  assert.ok(frenzy.includes('io-frenzy-success-orbit-a'));
  assert.ok(frenzy.includes('io-frenzy-success-particle-a'));
  assert.ok(frenzy.includes('ORBS ROLLED'));
  assert.ok(frenzy.includes('PERSONAL COOLDOWN'));
  assert.ok(frenzy.includes('POST EXPIRES IN'));
  assert.ok(frenzy.includes('Continue in Infinity Orbs'));
  assert.match(styles, /@keyframes io-launch-sphere-float/);
  assert.match(styles, /@keyframes io-frenzy-cooldown-glow/);
  assert.match(styles, /\.io-frenzy-success-orb/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test('main-game and shared-Orb posts use animated Orb hero elements', () => {
  const splash = source('src/client/splash.tsx');
  const styles = source('src/client/post-revamp.css');

  assert.ok(splash.includes('io-launch-orb-stage'));
  assert.ok(splash.includes('io-launch-orb-sphere'));
  assert.ok(splash.includes('io-public-orb-ring-secondary'));
  assert.ok(splash.includes('io-share-orb-spark-a'));
  assert.match(styles, /@keyframes io-launch-ring-counter/);
  assert.match(styles, /@keyframes io-launch-spark-drift/);
  assert.match(styles, /\.io-launch-steps > div:hover/);
});

test('post rings stay centered, all main-post rings rotate smoothly, and shared Orb glow is restrained', () => {
  const styles = source('src/client/post-revamp.css');
  const splash = source('src/client/splash.tsx');
  assert.ok(styles.includes('.io-public-orb-ring-secondary'));
  assert.ok(styles.includes('.io-public-orb-ring-tertiary'));
  assert.ok(styles.includes('animation: io-launch-ring-a-spin 18s linear infinite'));
  assert.ok(styles.includes('animation: io-launch-ring-b-spin 23s linear infinite'));
  assert.ok(styles.includes('animation: io-launch-ring-c-spin 32s linear infinite'));
  assert.ok(styles.includes('@keyframes io-frenzy-arc-a-spin'));
  assert.ok(styles.includes('@keyframes io-frenzy-arc-b-spin'));
  assert.ok(splash.includes('0 0 16px \u0024{info.color}18'));
});

test('Frenzy post claim arms the main-game reward animation instead of consuming it in preview', () => {
  const frenzy = source('src/client/frenzy.tsx');
  const game = source('src/client/main.tsx');
  assert.match(frenzy, /requestExpandedMode\(event\.nativeEvent, 'game'\)/);
  assert.match(frenzy, /fetchWithTimeout\('\/api\/frenzy\/arm', \{ method: 'POST' \}, 10_000\)/);
  assert.match(game, /getJson<\{ armed: boolean \}>\('\/api\/frenzy\/handoff'\)/);
  assert.match(game, /if \(!handoff\.armed\) return;/);
  assert.match(game, /setLastBatch\(revealBatch\)/);
});

test('in-game start screen shares the same animated play emphasis', () => {
  const splashScreen = source('src/client/components/SplashScreen.tsx');
  const styles = source('src/client/post-revamp.css');

  assert.ok(splashScreen.includes('io-immersive-play-cta'));
  assert.ok(splashScreen.includes("ready ? (hasProgress ? 'Continue playing' : 'Start playing')"));
  assert.match(styles, /\.io-immersive-play-cta/);
});

test('post animations are low-paint, Frenzy orbits are centered, and skill Equip remains reachable', () => {
  const styles = source('src/client/post-revamp.css');
  const globalStyles = source('src/client/styles.css');
  const frenzy = source('src/client/frenzy.tsx');
  const combat = source('src/client/components/CombatSection.tsx');

  assert.match(styles, /Performance pass: low-paint post animations and centered Frenzy orbits/);
  assert.match(styles, /\.io-frenzy-orbit-arc\s*\{[^}]*top:\s*50%[^}]*left:\s*50%/s);
  assert.match(styles, /#root\.io-inline-post[\s\S]*?io-frenzy-success-particle[\s\S]*?animation:\s*none !important/);
  assert.match(frenzy, /now - lastUpdateAt >= 100/);
  assert.match(frenzy, /fetchWithTimeout\('\/api\/frenzy\/arm', \{ method: 'POST' \}, 10_000\)/);
  assert.doesNotMatch(frenzy, /fetchWithTimeout\('\/api\/frenzy\/claim'/);
  assert.match(globalStyles, /bottom:calc\(100% \+ 2px\)/);
  assert.match(combat, /skillTooltipCloseTimerRef/);
  assert.match(combat, /onPointerEnter=\{cancelSkillTooltipClose\}/);
  assert.match(combat, /scheduleSkillTooltipClose\(skill\.id\)/);
});


test('Frenzy post makes the exact normal-roll payout visually prominent', () => {
  const frenzy = source('src/client/frenzy.tsx');
  const styles = source('src/client/post-revamp.css');
  assert.ok(frenzy.includes('info.rewardOrbCount'));
  assert.ok(frenzy.includes('info.baseOrbCount'));
  assert.ok(frenzy.includes('MULTIBALL ×'));
  assert.ok(frenzy.includes('io-frenzy-payout-number'));
  assert.ok(frenzy.includes('not the rarity of your results'));
  assert.match(styles, /\.io-frenzy-payout\s*\{/);
  assert.match(styles, /@keyframes io-frenzy-payout-sheen/);
  assert.match(styles, /@keyframes io-frenzy-payout-pulse/);
  assert.match(styles, /@keyframes io-frenzy-payout-number-pop/);
  assert.match(styles, /\.io-frenzy-payout-number\s*\{[^}]*font-size:/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test('main game spotlights first rolls and makes new Orb discoveries pop', () => {
  const roll = source('src/client/components/RollSection.tsx');
  const polish = source('src/client/ui-polish.css');

  assert.match(roll, /const isFirstSession = totalRollCount < 12/);
  assert.match(roll, /ROLL YOUR FIRST ORB/);
  assert.match(roll, /io-first-roll-label/);
  assert.match(roll, /io-main-orb/);
  assert.match(roll, /is-new-discovery/);
  assert.match(polish, /\.roll-stage\.is-first-session:not\(\.is-rolling\)::after/);
  assert.match(polish, /\.roll-button\.is-first-session-cta\.is-ready/);
  assert.match(polish, /@keyframes io-first-roll-sheen/);
  assert.match(polish, /@keyframes io-latest-discovery-pop/);
  const firstRollCta = polish.indexOf('.io-ui .roll-button.is-first-session-cta.is-ready');
  const reducedMotionStart = polish.indexOf('@media (prefers-reduced-motion: reduce)', firstRollCta);
  const reducedMotion = polish.slice(reducedMotionStart);
  assert.match(reducedMotion, /roll-button\.is-first-session-cta\.is-ready/);
  assert.match(reducedMotion, /latest-orb-mark\.is-new-discovery/);
});

test('immersive startup shows save-loading progress and unlocks the radiant Play button only when ready', () => {
  const splashScreen = source('src/client/components/SplashScreen.tsx');
  const main = source('src/client/main.tsx');
  const styles = source('src/client/post-revamp.css');

  assert.match(splashScreen, /role="progressbar"/);
  assert.match(splashScreen, /aria-valuenow=\{progress\}/);
  assert.match(splashScreen, /loadingProgress\?: number/);
  assert.match(main, /setStartupProgress\(35\)/);
  assert.match(main, /setStartupProgress\(100\)/);
  assert.match(main, /loadingProgress=\{startupProgress\}/);
  assert.match(splashScreen, /ready \? 'is-ready' : 'is-loading'/);
  assert.match(styles, /\.io-splash-cta\.is-ready/);
  assert.match(styles, /@keyframes io-splash-play-sheen/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});



test('inline Frenzy claim activity stays compact inside the fixed, non-scrollable post preview', () => {
  const frenzy = source('src/client/frenzy.tsx');
  const styles = source('src/client/post-revamp.css');
  const globalStyles = source('src/client/styles.css');

  assert.ok(frenzy.includes('FrenzyClaimActivity count={info.claimCount ?? 0} players={info.recentClaimers ?? []}'));
  assert.ok(styles.includes('#root.io-inline-post .io-frenzy-claim-activity {'));
  assert.ok(styles.includes('grid-template-columns: repeat(auto-fit, minmax(min(100%, 108px), 1fr));'));
  assert.ok(styles.includes('#root.io-inline-post .io-frenzy-claimer {'));
  assert.ok(styles.includes('min-height: 20px;'));
  assert.ok(globalStyles.includes('#root.io-inline-post .io-frenzy-button {'));
  assert.ok(globalStyles.includes('overflow: clip;'));
  assert.doesNotMatch(styles, /#root\.io-inline-post \.io-frenzy-claimers\s*\{[^}]*overflow(?:-y)?:\s*(?:auto|scroll)/s);
  assert.match(styles, /#root\.io-inline-post \.io-frenzy-claimers\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /#root\.io-inline-post \.io-frenzy-claimer strong\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*white-space:\s*normal/s);
  assert.match(frenzy, /players\.slice\(0, 5\)\.map/);
  assert.match(styles, /#root\.io-inline-post \.io-frenzy-claim-activity-head strong\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(styles, /#root\.io-inline-post \.io-frenzy-card:not\(\.io-frenzy-success-card\)\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-height:\s*0/s);
  assert.match(styles, /#root\.io-inline-post \.io-frenzy-card:not\(\.io-frenzy-success-card\) > \.io-cta-caption\s*\{[^}]*margin:\s*auto 0 4px/s);
});


test('inline main-game Reddit post expands its Orb animation and anchors Continue playing at the bottom', () => {
  const styles = source('src/client/post-revamp.css');
  const shellStyles = source('src/client/styles.css');
  const splash = source('src/client/splash.tsx');
  assert.match(styles, /#root\.io-inline-post > \.io-public:not\(\.io-public-compact\)/);
  assert.match(styles, /#root\.io-inline-post \.io-public-frame\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*height:\s*100%/s);
  assert.match(styles, /#root\.io-inline-post \.io-launch-card\s*\{[^}]*flex:\s*1 1 auto[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(styles, /#root\.io-inline-post \.io-launch-orb-stage\s*\{[^}]*flex:\s*1 1 clamp\(76px, 15vh, 116px\)[^}]*min-height:\s*76px/s);
  assert.match(styles, /#root\.io-inline-post \.io-launch-steps/);
  assert.match(styles, /#root\.io-inline-post \.io-main-cta\s*\{[^}]*margin-top:\s*auto/s);
  assert.match(styles, /#root\.io-inline-post \.io-launch-footer\s*\{[^}]*margin-top:\s*9px/s);
  assert.match(styles, /@media \(max-height:\s*640px\)/);
  assert.match(styles, /height:\s*100% !important/);
  assert.match(styles, /min-height:\s*0 !important/);
  assert.match(shellStyles, /#root\.io-inline-post > \.io-public:not\(\.io-public-compact\)[^}]*padding-bottom:\s*0 !important/s);
  assert.match(shellStyles, /#root\.io-inline-post \.io-launch-card\s*\{[^}]*margin-bottom:\s*0/s);
  assert.ok(splash.indexOf('className="io-launch-footer"') < splash.indexOf('className="io-post-conversion io-main-cta"'));
});;

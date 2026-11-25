import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('inline main-game post pins Continue playing and animates a layered infinity energy field', () => {
  const splash = source('src/client/splash.tsx');
  const styles = source('src/client/post-revamp.css');
  const footerIndex = splash.indexOf('className="io-launch-footer"');
  const ctaIndex = splash.indexOf('className="io-post-conversion io-main-cta"');
  assert.ok(footerIndex >= 0 && ctaIndex >= 0, 'main post footer and CTA should both exist');
  assert.ok(footerIndex < ctaIndex, 'the Continue playing action should follow the metadata');
  assert.ok(splash.includes('io-launch-orb-vortex-a'));
  assert.ok(splash.includes('io-launch-orb-vortex-b'));
  assert.ok(styles.includes('flex: 1 1 clamp(76px, 15vh, 116px);'));
  assert.ok(styles.includes('#root.io-inline-post .io-main-cta {'));
  assert.ok(styles.includes('margin-top: auto;'));
  assert.ok(styles.includes('@keyframes io-inline-orb-charge-sweep'));
  assert.ok(styles.includes('@keyframes io-inline-orb-vortex-a'));
  assert.ok(styles.includes('@keyframes io-inline-orb-aura-pulse'));
  assert.ok(styles.includes('@media (prefers-reduced-motion: reduce)'));
  assert.ok(styles.includes('.io-launch-orb-vortex,'));
});

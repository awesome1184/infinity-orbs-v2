import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('full upgrade cards remain clickable while individual purchases are pending', () => {
  const source = read('src/client/components/UpgradesSection.tsx');
  assert.match(source, /if \(busy \|\| upgradeAllInFlightRef\.current\) return;/);
  assert.match(source, /disabled=\{!canAfford \|\| busy \|\| upgradingAll\}/);
  assert.match(source, /Buy another ·/);
  assert.doesNotMatch(source, /disabled=\{!canAfford[^}]*pendingUpgradeCount/);
});

test('quick upgrade buttons remain clickable and show the number of queued clicks', () => {
  const source = read('src/client/components/RollSection.tsx');
  assert.match(source, /if \(busy \|\| quickBuyAllBusyRef\.current\) return;/);
  assert.match(source, /disabled=\{!canAfford \|\| busy \|\| quickBuyAllBusy\}/);
  assert.match(source, /×\$\{pendingCount\}/);
  assert.doesNotMatch(source, /disabled=\{!canAfford[^}]*quickUpgradePending/);
});

test('Buy All stays mutually exclusive with individual queued purchases', () => {
  const upgrades = read('src/client/components/UpgradesSection.tsx');
  const quick = read('src/client/components/RollSection.tsx');
  assert.match(upgrades, /pendingUpgradeCountRef\.current > 0/);
  assert.match(upgrades, /disabled=\{affordableCount === 0 \|\| busy \|\| upgradingAll \|\| pendingUpgradeCount > 0\}/);
  assert.match(quick, /quickUpgradePendingCountRef\.current > 0/);
  assert.match(quick, /quickUpgradePendingCount > 0 \|\| quickBuyAllBusy/);
});

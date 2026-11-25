import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function upgradeAllowlist(sourceText: string, marker: string): string[] {
  const start = sourceText.indexOf(marker);
  assert.ok(start >= 0, `missing allowlist marker: ${marker}`);
  const open = sourceText.indexOf('[', start);
  const close = sourceText.indexOf('];', open);
  assert.ok(open >= 0 && close > open, 'upgrade allowlist must be a literal array');
  return [...sourceText.slice(open + 1, close).matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]);
}

test('upgrade batch route accepts every upgrade supported by the server purchase handler', () => {
  const app = source('src/server/app.ts');
  const game = source('src/server/game.ts');
  const routeIds = upgradeAllowlist(app, 'const validUpgradeIds: UpgradeId[] = [');
  const handlerIds = upgradeAllowlist(game, 'const validIds: UpgradeId[] = [');

  assert.deepEqual(
    routeIds.filter(id => handlerIds.includes(id)).sort(),
    handlerIds.sort(),
    'the HTTP route must not reject upgrade IDs accepted by buyUpgradeBatch',
  );
  assert.ok(routeIds.includes('offlineFoundry'));
  assert.ok(routeIds.includes('orbFingers'));
  assert.ok(routeIds.includes('criticalDividend'));
});

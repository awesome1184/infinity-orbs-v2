// [TESTER] Regression for retrying bulk Booster grants against a stable recipient set.
// This is intentionally expected to fail against the current candidate until a batch
// manifest is persisted; it guards behavior promised by the partial-retry UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('bulk Booster retries reuse the original durable recipient manifest', () => {
  const debug = source('src/server/debug.ts');
  const routeStart = debug.indexOf("debugRouter.post('/global-booster-credits/grant'");
  const routeEnd = debug.indexOf("debugRouter.get('/follow-reward'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'bulk grant route must exist');
  const route = debug.slice(routeStart, routeEnd);

  // The initial request may resolve the current target set; subsequent retries
  // must load that same operation manifest, not reevaluate online/registered status.
  assert.match(
    debug,
    /async function getOrCreateGlobalBoosterCreditGrantManifest[\s\S]*?operationId[\s\S]*?scope[\s\S]*?amount[\s\S]*?userIds/,
    'server needs a durable per-operation recipient manifest',
  );
  assert.match(
    debug,
    /io:admin-global-booster-credit-batch:/,
    'recipient manifest key must be separate from wipeable player saves',
  );
  assert.match(
    route,
    /getOrCreateGlobalBoosterCreditGrantManifest\s*\(\s*operationId\s*,\s*scope\s*,\s*amount/,
    'the route must load/create the immutable batch manifest before processing grants',
  );
  assert.doesNotMatch(
    route,
    /const players = await listRegisteredPlayerIds\(\)/,
    'a retry must not silently replace the original target set with today's registry',
  );
  assert.match(
    route,
    /manifest\.userIds[\s\S]*?grantGlobalBoosterCreditsToUser/,
    'recipients must come from the durable manifest and use per-user idempotency receipts',
  );
});

test('the partial-retry UI retains the same operation ID after a batch failure', () => {
  const modal = source('src/client/components/DevDebugModal.tsx');
  const start = modal.indexOf('const grantFreeGlobalBoosters = async');
  const end = modal.indexOf('const loadGlobalBoosterActivationLog', start);
  assert.ok(start >= 0 && end > start, 'grant UI handler must exist');
  const handler = modal.slice(start, end);
  assert.match(handler, /globalBoosterGrantOperationRef\.current = operation/);
  assert.match(handler, /if \(data\?\.partial\)/);
  assert.match(handler, /Completed grants will not be duplicated/);
  assert.match(handler, /operationId: operation\.operationId/);
});

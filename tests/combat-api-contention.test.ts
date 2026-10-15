import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');

function routeSection(startMarker: string, endMarker: string): string {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Missing or reordered route: ${startMarker}`);
  return appSource.slice(start, end);
}

test('combat endpoints report Redis contention and return retryable 503 responses', () => {
  const routes = [
    {
      section: routeSection("app.get('/api/combat/state'", "app.post('/api/combat/beat'"),
      message: 'Combat is busy loading your save. Please retry.',
    },
    {
      section: routeSection("app.post('/api/combat/beat'", "app.post('/api/combat/equip'"),
      message: 'Combat is busy resolving your action. Please retry.',
    },
    {
      section: routeSection("app.post('/api/combat/equip'", "app.post('/api/combat/skills/roll'"),
      message: 'Combat is busy saving your loadout. Please retry.',
    },
    {
      section: routeSection("app.post('/api/combat/skills/roll'", "app.get('/api/me'"),
      message: 'Combat is busy saving your skill roll. Please retry.',
    },
  ];

  for (const route of routes) {
    assert.match(route.section, /reportRedisTransactionFailure\(e\)/);
    assert.match(route.section, /transientContentionError\(e\)/);
    assert.match(route.section, /503/);
    assert.ok(route.section.includes(route.message), `Missing retry message: ${route.message}`);
  }
});

test('combat CAS retry exhaustion is classified as transient contention', () => {
  assert.match(
    appSource,
    /return \/combat state changed repeatedly\|max\(\?:imum\)\? concurrency\|/,
  );
});

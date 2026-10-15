import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const server = readFileSync(resolve(process.cwd(), 'src/server/combat.ts'), 'utf8');

test('combat gameplay rolls use the cryptographic server RNG', () => {
  assert.match(server, /function combatRandom\(\):number/);
  assert.match(server, /globalThis\.crypto\.getRandomValues\(sample\)/);
  assert.doesNotMatch(server, /Math\.random\s*\(/);
  assert.match(server, /Math\.floor\(combatRandom\(\)\*values\.length\)/);
  assert.match(server, /const chance=combatRandom\(\)/);
  assert.match(server, /combatRandom\(\)<stats\.critChance/);
  assert.match(server, /combatRandom\(\)<\.18/);
});

test('gear quality continues to use the fourth-power distribution with secure samples', () => {
  assert.match(server, /const quality=Math\.round\(1_000_000\*Math\.pow\(combatRandom\(\),4\)\)\/10_000/);
});

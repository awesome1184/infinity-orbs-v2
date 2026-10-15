import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const component = readFileSync(
  resolve(process.cwd(), 'src/client/components/CombatSection.tsx'),
  'utf8',
);

test('combat mutations wait for an in-flight auto beat before accepting a newer snapshot', () => {
  assert.match(component, /mutating:false,beatPromise:null as Promise<void>\|null/);
  assert.match(component, /runtime\.current\.busy\|\|runtime\.current\.mutating/);
  assert.match(component, /runtime\.current\.beatPromise=operation/);
  assert.match(component, /if\(pendingBeat\)await pendingBeat\.catch\(\(\)=>undefined\)/);
});

test('manual beats cannot leave a sticky manual override while busy', () => {
  assert.match(
    component,
    /const manualBeat=\(\)=>\{if\(!stateRef\.current\|\|runtime\.current\.busy\|\|runtime\.current\.mutating\)return;/,
  );
});

test('gear and skill controls disable while an automatic beat is processing', () => {
  assert.match(component, /busy=\{mutating\|\|processing\}/);
  assert.match(component, /disabled=\{mutating\|\|processing\|\|state\.coins<pullCost\}/);
});

test('Arena challenge shares the same mutation lock and drains the pending combat beat', () => {
  assert.match(component, /const challengeArena=async\(opponentId:string\)=>\{[\s\S]*?if\(runtime\.current\.mutating\)return;[\s\S]*?runtime\.current\.mutating=true;[\s\S]*?const pendingBeat=runtime\.current\.beatPromise;[\s\S]*?if\(pendingBeat\)await pendingBeat\.catch\(\(\)=>undefined\);[\s\S]*?\/api\/combat\/arena\/challenge/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findPostFlairTemplateId, getPostFlairOptions } from '../src/server/post-flair.js';

test('post flair resolves a real template ID by case-insensitive label', () => {
  const templates = [
    { id: 'template-discovery', text: 'Discovery' },
    { id: 'template-frenzy', text: 'Frenzy' },
  ];
  assert.equal(findPostFlairTemplateId(templates, 'discovery'), 'template-discovery');
  assert.equal(findPostFlairTemplateId(templates, 'FRENZY'), 'template-frenzy');
});

test('post flair never returns a label without a real template ID', () => {
  assert.equal(findPostFlairTemplateId([{ text: 'Frenzy' }], 'frenzy'), undefined);
  assert.equal(findPostFlairTemplateId([{ id: 'template-other', text: 'Other' }], 'frenzy'), undefined);
  assert.equal(findPostFlairTemplateId(null, 'frenzy'), undefined);
});

test('post flair uses the current subreddit template and omits flair if unavailable', async () => {
  const calls: string[] = [];
  const options = await getPostFlairOptions('r/infinity_orbs_dev', 'frenzy', {
    getPostFlairTemplates: async subredditName => {
      calls.push(subredditName);
      return [{ id: 'frenzy-template-id', text: 'Frenzy' }];
    },
  });
  assert.deepEqual(calls, ['infinity_orbs_dev']);
  assert.deepEqual(options, { flairId: 'frenzy-template-id' });
  const missing = await getPostFlairOptions('infinity_orbs_dev', 'frenzy', {
    getPostFlairTemplates: async () => [],
  });
  assert.deepEqual(missing, {});
});

test('a flair lookup failure does not block post creation', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const options = await getPostFlairOptions('infinity_orbs_dev', 'discovery', {
      getPostFlairTemplates: async () => { throw new Error('flair service unavailable'); },
    });
    assert.deepEqual(options, {});
  } finally {
    console.warn = originalWarn;
  }
});

test('Share and Frenzy resolve flair template IDs instead of sending free-form flairText', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/server/app.ts'), 'utf8');
  const game = readFileSync(resolve(process.cwd(), 'src/server/game.ts'), 'utf8');
  assert.match(app, /getPostFlairOptions\(subredditName,\s*['"]discovery['"]\)/);
  assert.match(game, /getPostFlairOptions\(subredditName,\s*['"]frenzy['"]\)/);
  assert.doesNotMatch(app, /flairText:\s*['"]discovery['"]/);
  assert.doesNotMatch(game, /flairText:\s*['"]frenzy['"]/);
});

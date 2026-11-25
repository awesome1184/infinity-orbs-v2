import { reddit } from './devvit-mock.js';

type FlairTemplateReader = {
  getPostFlairTemplates?: (subredditName: string) => Promise<unknown>;
};

export function findPostFlairTemplateId(templates: unknown, requestedLabel: string): string | undefined {
  const target = String(requestedLabel ?? '').trim().toLowerCase();
  if (!target || !Array.isArray(templates)) return undefined;
  for (const value of templates) {
    if (!value || typeof value !== 'object') continue;
    const template = value as Record<string, unknown>;
    const text = String(template.text ?? '').trim().toLowerCase();
    const id = String(template.id ?? template.flairTemplateId ?? '').trim();
    if (text === target && id) return id;
  }
  return undefined;
}

export async function getPostFlairOptions(
  subredditName: string,
  requestedLabel: string,
  reader: FlairTemplateReader = reddit,
): Promise<{ flairId?: string }> {
  let subreddit = String(subredditName ?? '').trim();
  if (subreddit.toLowerCase().startsWith('r/')) subreddit = subreddit.slice(2);
  const label = String(requestedLabel ?? '').trim();
  if (!subreddit || !label || typeof reader.getPostFlairTemplates !== 'function') return {};
  try {
    const templates = await reader.getPostFlairTemplates(subreddit);
    const flairId = findPostFlairTemplateId(templates, label);
    return flairId ? { flairId } : {};
  } catch (error) {
    console.warn('[Post Flair] Could not resolve "' + label + '" in r/' + subreddit + '; submitting without flair.', error);
    return {};
  }
}

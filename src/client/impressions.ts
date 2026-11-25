export type ImpressionPostType = 'main-game' | 'orb-share' | 'frenzy';
export type ImpressionDeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export function classifyImpressionDeviceType(agentValue: unknown, platformValue: unknown = '', touchPointsValue: unknown = 0): ImpressionDeviceType {
  const agent = typeof agentValue === 'string' ? agentValue : '';
  const platform = typeof platformValue === 'string' ? platformValue : '';
  const touchPoints = typeof touchPointsValue === 'number' && Number.isSafeInteger(touchPointsValue) && touchPointsValue >= 0 ? touchPointsValue : 0;
  if (!agent.trim() && !platform.trim()) return 'unknown';
  if (/iPad|Tablet|PlayBook|Silk/i.test(agent) || (platform === 'MacIntel' && touchPoints > 1)) return 'tablet';
  if (/iPhone|iPod|Windows Phone|IEMobile|Mobi/i.test(agent) || (/Android/i.test(agent) && /Mobile/i.test(agent))) return 'mobile';
  if (/Android/i.test(agent)) return 'tablet';
  return 'desktop';
}
function detectDeviceType(): ImpressionDeviceType {
  if (typeof navigator === 'undefined') return 'unknown';
  return classifyImpressionDeviceType(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}
function normalizePostId(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 200 || /[\u0000-\u001f\u007f]/.test(raw)) return '';
  const bareId = raw.replace(/^t3_/i, '');
  return bareId ? 't3_' + bareId : '';
}
/** A duplicate view is a successful request; the server returns recorded:false when already counted. */
export async function recordPostImpression(postType: ImpressionPostType, postIdValue: unknown): Promise<boolean> {
  const postId = normalizePostId(postIdValue);
  if (!postId) {
    console.warn('[Impressions] Skipped preview without a valid Reddit post ID.');
    return false;
  }
  const body = JSON.stringify({ postType, deviceType: detectDeviceType(), postId });
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/impressions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', keepalive: true, body,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
          ? String((payload as { error: string }).error) : 'HTTP ' + response.status;
        throw new Error(message);
      }
      if (!payload || typeof payload !== 'object' || typeof (payload as { recorded?: unknown }).recorded !== 'boolean') {
        throw new Error('The impression endpoint returned an invalid response.');
      }
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  console.warn('[Impressions] Preview analytics failed after retries.', lastError);
  return false;
}

/**
 * Best-effort conversion event for the explicit Play CTA on the main-game post.
 * Only a coarse device category and the post ID are sent; never send account IDs
 * or usernames. It intentionally does not await before the game expands.
 */
export function recordMainGamePostConversion(postIdValue: unknown): void {
  const postId = normalizePostId(postIdValue);
  if (!postId) return;
  const body = JSON.stringify({ postId, deviceType: detectDeviceType() });
  void fetch('/api/impressions/conversion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    keepalive: true,
    body,
  }).then(async response => {
    if (!response.ok) {
      console.warn('[Impressions] Main-game conversion event was not recorded.', response.status);
    }
  }).catch(error => {
    console.warn('[Impressions] Main-game conversion analytics unavailable.', error);
  });
}

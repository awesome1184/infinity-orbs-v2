function selectedPlayerName(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const requested = String(params.get('player') ?? 'PagesTester')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 25);
    return requested || 'PagesTester';
  } catch {
    return 'PagesTester';
  }
}

const username = selectedPlayerName();

export const context = {
  userId: 'github-pages-test-' + username.toLowerCase(),
  username,
  subredditName: 'infinityorbs',
  subredditId: 't5_github_pages_test',
  postId: 't3_github_pages_test',
  appVersion: 'github-pages-test',
};

export function getWebViewMode(): 'expanded' {
  return 'expanded';
}

export function requestExpandedMode(): Promise<boolean> {
  // GitHub Pages is already a standalone browser page, so there is no
  // Reddit inline-to-expanded transition to perform.
  return Promise.resolve(true);
}

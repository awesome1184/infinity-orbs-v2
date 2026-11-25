import { context } from './devvit-client.js';

type BrowserStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function browserStorage(): BrowserStorageLike | null {
  try {
    return ((globalThis as any).localStorage as BrowserStorageLike | undefined) ?? null;
  } catch {
    return null;
  }
}

function preferenceKey(userId: string): string {
  return 'io:github-pages-test:notifications:' + userId;
}

export const notifications = {
  isOptedIn: async (userId: string): Promise<boolean> => {
    try {
      return browserStorage()?.getItem(preferenceKey(userId)) === '1';
    } catch {
      return false;
    }
  },
  optInCurrentUser: async (): Promise<boolean> => {
    try {
      browserStorage()?.setItem(preferenceKey(context.userId), '1');
      return true;
    } catch {
      return false;
    }
  },
  optOutCurrentUser: async (): Promise<boolean> => {
    try {
      browserStorage()?.removeItem(preferenceKey(context.userId));
      return true;
    } catch {
      return false;
    }
  },
  enqueue: async (_userId: string, _payload: unknown): Promise<{ localOnly: true }> => ({ localOnly: true }),
  listOptedInUsers: async (): Promise<string[]> => [],
};

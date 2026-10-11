// Local in-memory implementation of the small Devvit service surface used by the game.
// In production, src/server/index.ts swaps these live bindings for Devvit's real services.

const store = new Map<string, string>();
const expirations = new Map<string, number>();
const keyRevisions = new Map<string, number>();

function bumpKeyRevision(key: string): void {
  keyRevisions.set(key, (keyRevisions.get(key) ?? 0) + 1);
}

function writeStore(key: string, value: string, expiration?: Date): void {
  store.set(key, value);
  if (expiration instanceof Date && Number.isFinite(expiration.getTime())) {
    expirations.set(key, expiration.getTime());
  } else {
    expirations.delete(key);
  }
  bumpKeyRevision(key);
}

function deleteStore(key: string): boolean {
  expirations.delete(key);
  const deleted = store.delete(key);
  if (deleted) bumpKeyRevision(key);
  return deleted;
}

function readStore(key: string): string | undefined {
  const expiresAt = expirations.get(key);
  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    if (store.delete(key)) bumpKeyRevision(key);
    expirations.delete(key);
    return undefined;
  }
  return store.get(key);
}

const initialGuilds = [
  {
    id: 'guild-1',
    name: 'Astral Knights',
    tag: 'STAR',
    level: 12,
    xp: 1250,
    tokens: 42,
    createdAt: Date.now() - 86400000 * 5,
    challenge: { type: 'rolls', target: 500, progress: 140, reward: 250, label: 'Roll Together: 500 guild rolls' },
    members: [
      { username: 'Celestia', contribution: 540000, role: 'owner' },
      { username: 'Starlight', contribution: 320000, role: 'member' },
    ],
  },
  {
    id: 'guild-2',
    name: 'Void Walkers',
    tag: 'VOID',
    level: 8,
    xp: 820,
    tokens: 18,
    createdAt: Date.now() - 86400000 * 3,
    challenge: { type: 'value', target: 50_000, progress: 12400, reward: 500, label: 'Treasure Hunt: 50,000 collection value' },
    members: [{ username: 'NullPointer', contribution: 410000, role: 'owner' }],
  },
];

const initialLeaderboard = [
  { username: 'Celestia', value: 540000, highestRarity: 100000, totalRolls: 840 },
  { username: 'NullPointer', value: 410000, highestRarity: 10000, totalRolls: 620 },
  { username: 'Starlight', value: 320000, highestRarity: 10000, totalRolls: 510 },
  { username: 'NebulaRider', value: 180000, highestRarity: 1000, totalRolls: 340 },
  { username: 'OrbMaster', value: 0, highestRarity: 2, totalRolls: 0 },
];

store.set('io:guilds', JSON.stringify(initialGuilds));
store.set('io:leaderboard', JSON.stringify(initialLeaderboard));

const localRedis = {
  get: async (key: string): Promise<string | null> => readStore(key) ?? null,
  hGet: async (key: string, field: string): Promise<string | undefined> => {
    const raw = readStore(key);
    if (!raw) return undefined;
    const values = JSON.parse(raw) as Record<string, string>;
    return values[field];
  },
  hSet: async (key: string, fieldValues: Record<string, string>): Promise<number> => {
    const raw = readStore(key);
    const values = raw ? JSON.parse(raw) as Record<string, string> : {};
    let added = 0;
    for (const [field, value] of Object.entries(fieldValues)) {
      if (!(field in values)) added++;
      values[field] = value;
    }
    writeStore(key, JSON.stringify(values));
    return added;
  },
  hGetAll: async (key: string): Promise<Record<string, string>> => {
    const raw = readStore(key);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  },
  mGet: async (keys: string[]): Promise<Array<string | null>> => keys.map(key => readStore(key) ?? null),
  set: async (
    key: string,
    value: string,
    options?: { nx?: boolean; expiration?: Date },
  ): Promise<string> => {
    if (options?.nx && readStore(key) !== undefined) {
      return null as unknown as string;
    }
    writeStore(key, value, options?.expiration);
    return 'OK';
  },
  del: async (key: string): Promise<boolean> => {
    return deleteStore(key);
  },
  watch: async (...keys: string[]) => {
    // Match Redis WATCH: record mutation revisions, not just values, so an
    // ABA transition (A -> B -> A) still invalidates a transaction.
    for (const key of keys) readStore(key);
    const snapshot = new Map(keys.map(key => [key, keyRevisions.get(key) ?? 0]));
    let watched = true;
    const staged: Array<
      | { kind: 'set'; key: string; value: string; expiration?: Date }
      | { kind: 'del'; key: string }
      | { kind: 'hset'; key: string; fields: Record<string, string> }
    > = [];
    return {
      // TxClient is intentionally modeled without a read method. In Devvit,
      // reads after WATCH must go through redis.get(), while this object queues
      // writes for MULTI/EXEC. Keeping the mock honest prevents SDK misuse from
      // passing local tests while failing in production.
      multi: async () => undefined,
      set: async (key: string, value: string, options?: { expiration?: Date }) => {
        staged.push({ kind: 'set', key, value, expiration: options?.expiration });
        return 'QUEUED';
      },
      hSet: async (key: string, fields: Record<string, string>) => {
        staged.push({ kind: 'hset', key, fields: { ...fields } });
        return 'QUEUED';
      },
      del: async (key: string) => {
        staged.push({ kind: 'del', key });
        return 'QUEUED';
      },
      exec: async () => {
        if (watched) {
          for (const key of keys) {
            // Expiry is also a mutation. Process it before comparing revisions.
            readStore(key);
            if ((keyRevisions.get(key) ?? 0) !== snapshot.get(key)) {
              watched = false;
              return null;
            }
          }
        }
        for (const write of staged) {
          if (write.kind === 'del') {
            deleteStore(write.key);
          } else if (write.kind === 'set') {
            // Redis SET clears an existing TTL unless one is provided.
            writeStore(write.key, write.value, write.expiration);
          } else {
            const raw = readStore(write.key);
            const values = raw ? JSON.parse(raw) as Record<string, string> : {};
            Object.assign(values, write.fields);
            writeStore(write.key, JSON.stringify(values));
          }
        }
        watched = false;
        return [];
      },
      unwatch: async () => {
        watched = false;
      },
    };
  },
  incr: async (key: string): Promise<number> => {
    const value = Number.parseInt(readStore(key) ?? '0', 10) + 1;
    writeStore(key, String(value));
    return value;
  },
  zAdd: async (key: string, ...entries: Array<{ member: string; score: number }>): Promise<number> => {
    const raw = readStore(key);
    const values: Record<string, number> = raw ? JSON.parse(raw) : {};
    let added = 0;
    for (const entry of entries) {
      if (!(entry.member in values)) added++;
      values[entry.member] = entry.score;
    }
    writeStore(key, JSON.stringify(values));
    return added;
  },
  zRemRangeByScore: async (key: string, min: number, max: number): Promise<number> => {
    const raw = readStore(key);
    if (!raw) return 0;
    const values: Record<string, number> = JSON.parse(raw);
    let removed = 0;
    for (const [member, score] of Object.entries(values)) {
      if (score >= min && score <= max) {
        delete values[member];
        removed++;
      }
    }
    if (removed > 0) writeStore(key, JSON.stringify(values));
    return removed;
  },
  zCard: async (key: string): Promise<number> => {
    const raw = readStore(key);
    return raw ? Object.keys(JSON.parse(raw)).length : 0;
  },
};

const localContext = {
  userId: 'local-player-1',
  username: 'OrbMaster',
  subredditName: 'infinityorbs',
  subredditId: 't5-local-infinityorbs',
};

const localReddit = {
  modMail: {
    createModInboxConversation: async (options: {
      subredditId: string;
      subject: string;
      bodyMarkdown: string;
    }) => {
      console.log('[Reddit Mock] Modmail submitted:', options.subject);
      return `local-modmail-${Date.now()}`;
    },
  },
  setUserFlair: async (options: {
    subredditName: string;
    username: string;
    text?: string;
  }) => {
    console.log('[Reddit Mock] User flair set:', options.username, options.text);
  },
  submitCustomPost: async (options: {
    runAs?: string;
    subredditName?: string;
    title: string;
    entry?: string;
    userGeneratedContent?: { text?: string };
  }) => {
    console.log('[Reddit Mock] Custom post submitted:', options.title);
    return { id: `reddit-post-${Date.now()}` };
  },
  subscribeToCurrentSubreddit: async () => {
    console.log('[Reddit Mock] Subscribed current user to current subreddit.');
  },
  getSubredditInfoByName: async (_subredditName: string) => ({
    name: _subredditName,
    subscribersCount: 0,
  }),
};

export let redis: any = localRedis;
export let context: any = localContext;
export let reddit: any = localReddit;

export function configureDevvitRuntime(runtime: {
  redis: unknown;
  context: unknown;
  reddit: unknown;
}) {
  redis = runtime.redis;
  context = runtime.context;
  reddit = runtime.reddit;
}

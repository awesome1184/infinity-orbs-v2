import { context, createServer, getServerPort, redis, reddit, scheduler } from '@devvit/web/server';
import { createApp } from './app.js';
import { configureDevvitRuntime } from './devvit-mock.js';
import { mGetInChunks } from './redis-batch.js';
import { instrumentRedisClient } from './server-monitor.js';

// Devvit Redis MGet can exceed its RPC response-size cap when the subreddit
// has hundreds of player saves. Proxy only this method; all other Redis methods
// remain bound to the original client and retain their normal behavior.
const boundedRedis = new Proxy(redis, {
  get(target, property, receiver) {
    if (property === 'mGet') {
      return (keys: string[]) => mGetInChunks(keys, batch => target.mGet(batch));
    }
    const value = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

configureDevvitRuntime({ redis: instrumentRedisClient(boundedRedis), context, reddit, scheduler });

const app = createApp();
const server = createServer(app);

server.on('error', (error: Error) => {
  console.error('[Devvit] Server error:', error.stack ?? error.message);
});

server.listen(getServerPort());

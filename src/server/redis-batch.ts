/**
 * Keep Redis MGet replies below Devvit's RPC response-size ceiling.
 * Values can vary considerably in size (player and combat saves are JSON blobs),
 * so split the normal batch further if Devvit explicitly reports the limit.
 */
export const REDIS_MGET_BATCH_SIZE = 20;
const REDIS_MGET_MAX_CONCURRENCY = 4;

type MGetReader<T> = (keys: string[]) => Promise<readonly T[]>;

async function readChunkWithSizeFallback<T>(
  keys: string[],
  readChunk: MGetReader<T>,
): Promise<T[]> {
  try {
    const values = await readChunk(keys);
    if (!Array.isArray(values) || values.length !== keys.length) {
      throw new Error(
        `Redis MGet returned ${Array.isArray(values) ? values.length : 'a non-array'} values for ${keys.length} keys.`,
      );
    }
    return Array.from(values);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (keys.length <= 1 || !/max response size limit/i.test(message)) throw error;

    // Only retry the specific response-size error. Transient and permission
    // failures should surface immediately instead of silently masking faults.
    const middle = Math.floor(keys.length / 2);
    const first = await readChunkWithSizeFallback(keys.slice(0, middle), readChunk);
    const second = await readChunkWithSizeFallback(keys.slice(middle), readChunk);
    return first.concat(second);
  }
}

export async function mGetInChunks<T>(
  keys: readonly string[],
  readChunk: MGetReader<T>,
): Promise<T[]> {
  if (keys.length === 0) return [];

  const results: T[] = [];
  const waveSize = REDIS_MGET_BATCH_SIZE * REDIS_MGET_MAX_CONCURRENCY;

  for (let waveStart = 0; waveStart < keys.length; waveStart += waveSize) {
    const waveEnd = Math.min(keys.length, waveStart + waveSize);
    const chunks: string[][] = [];
    for (let start = waveStart; start < waveEnd; start += REDIS_MGET_BATCH_SIZE) {
      chunks.push(Array.from(keys.slice(start, Math.min(waveEnd, start + REDIS_MGET_BATCH_SIZE))));
    }

    // Promise.all preserves chunk order. Four calls maximum are active per wave.
    const chunkValues = await Promise.all(
      chunks.map(chunk => readChunkWithSizeFallback(chunk, readChunk)),
    );
    for (const values of chunkValues) results.push(...values);
  }

  return results;
}

export interface AsyncSerialQueue {
  /** Number of queued or currently executing operations. */
  readonly pending: number;
  /** Runs an operation after all previously enqueued operations have settled. */
  enqueue<T>(operation: () => Promise<T> | T): Promise<T>;
}

/**
 * Serializes stateful client requests. A rejected operation does not poison the
 * queue, and pending includes work waiting to start as well as active work.
 */
export function createAsyncSerialQueue(): AsyncSerialQueue {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    get pending() {
      return pending;
    },

    enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
      pending += 1;
      const result = tail.then(operation, operation);
      // Keep the internal tail fulfilled so one failed request cannot block
      // every later request.
      tail = result.then(() => undefined, () => undefined);
      return result.finally(() => {
        pending = Math.max(0, pending - 1);
      });
    },
  };
}

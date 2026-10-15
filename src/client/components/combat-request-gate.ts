/**
 * Coordinates automatic combat beats and player-initiated combat writes.
 *
 * Automatic beats are skipped while any mutation is queued or in flight, so
 * the interval never builds a backlog of stale beats. A single mutation may
 * wait for the current beat to finish; duplicate mutations are ignored.
 */
export function createCombatRequestGate() {
  let inFlight = false;
  let pendingMutations = 0;
  let releaseActive: (() => void) | null = null;
  let activeDone: Promise<void> = Promise.resolve();

  const begin = () => {
    inFlight = true;
    activeDone = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
  };

  const end = () => {
    inFlight = false;
    const release = releaseActive;
    releaseActive = null;
    release?.();
  };

  return {
    async runBeat<T>(operation: () => Promise<T>): Promise<T | undefined> {
      if (inFlight || pendingMutations > 0) return undefined;
      begin();
      try {
        return await operation();
      } finally {
        end();
      }
    },

    async runMutation<T>(operation: () => Promise<T>): Promise<T | undefined> {
      if (pendingMutations > 0) return undefined;
      pendingMutations += 1;
      try {
        while (inFlight) await activeDone;
        begin();
        try {
          return await operation();
        } finally {
          end();
        }
      } finally {
        pendingMutations -= 1;
      }
    },

    isBusy(): boolean {
      return inFlight || pendingMutations > 0;
    },
  };
}

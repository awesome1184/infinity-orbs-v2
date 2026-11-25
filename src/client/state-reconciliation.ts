export interface PlayerStateRevisionSnapshot {
  stateRevision?: number;
  saveGeneration?: number;
  coins?: number;
  shards?: number;
  xp?: number;
  level?: number;
  totalRolls?: number;
  freeRolls?: number;
  highestRarity?: number;
  collectionValue?: number;
  prestigeCount?: number;
}

/**
 * Decide whether a server snapshot may replace the current client state.
 *
 * Same-generation stale revisions are always rejected. By default, a snapshot
 * with the same durable revision may not change balances; explicit recovery
 * responses can opt in because a rejected optimistic mutation does not advance
 * the server revision even though it must undo the local prediction.
 */
export function shouldAcceptPlayerStateSnapshot(
  nextState: PlayerStateRevisionSnapshot,
  currentState: PlayerStateRevisionSnapshot | null | undefined,
  appliedServerGeneration: number,
  appliedServerRevision: number,
  allowSameRevisionBalanceChanges = false,
): boolean {
  const nextGeneration = Number(nextState.saveGeneration);
  const nextRevision = Number(nextState.stateRevision);

  if (
    !Number.isSafeInteger(nextGeneration) || nextGeneration < 0 ||
    !Number.isSafeInteger(nextRevision) || nextRevision < 0
  ) {
    return false;
  }
  if (nextGeneration < appliedServerGeneration) return false;
  if (nextGeneration > appliedServerGeneration) return true;
  if (nextRevision < appliedServerRevision) return false;

  if (
    nextRevision === appliedServerRevision &&
    currentState &&
    !allowSameRevisionBalanceChanges
  ) {
    const balanceFields = [
      ['coins', 0],
      ['shards', 0],
      ['xp', 0],
      ['level', 1],
      ['totalRolls', 0],
      ['freeRolls', 0],
      ['highestRarity', 0],
      ['collectionValue', 0],
      ['prestigeCount', 0],
    ] as const;
    for (const [field, fallback] of balanceFields) {
      if ((nextState[field] ?? fallback) !== (currentState[field] ?? fallback)) return false;
    }
  }

  return true;
}

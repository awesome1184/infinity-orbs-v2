/**
 * Extra wait after a server-side cooldown rejection.
 *
 * The server reports the remaining cooldown rounded to one decimal place. A
 * small buffer avoids another early request when that value was rounded down
 * or the request is retried close to the boundary.
 */
export const AUTO_ROLL_COOLDOWN_RETRY_BUFFER_MS = 150;

export function autoRollCooldownRetryDelayMs(error: unknown): number | null {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  const match = /Cooldown:\s*(\d+(?:\.\d+)?)s/i.exec(message);
  if (!match) return null;

  const remainingSeconds = Number(match[1]);
  if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) return null;

  const retryDelay = Math.ceil(remainingSeconds * 1_000) + AUTO_ROLL_COOLDOWN_RETRY_BUFFER_MS;
  return Number.isFinite(retryDelay) ? retryDelay : null;
}

/** Manual readiness is derived only from the player's last committed roll. */
export function manualRollReadyAt(lastRollAt: unknown, cooldownDurationMs: unknown): number {
  const timestamp = Number(lastRollAt ?? 0);
  const duration = Number(cooldownDurationMs);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return timestamp + duration;
}

/**
 * Auto Roll has a separate cadence. Never fold the manual UI countdown into
 * this deadline, otherwise a longer manual cooldown throttles Auto Roll too.
 */
export function autoRollReadyAt(
  lastRollAt: unknown,
  cooldownDurationMs: unknown,
  retryUntil: unknown = 0,
): number {
  const rollReadyAt = manualRollReadyAt(lastRollAt, cooldownDurationMs);
  const retryTimestamp = Number(retryUntil ?? 0);
  return Math.max(rollReadyAt, Number.isFinite(retryTimestamp) && retryTimestamp > 0 ? retryTimestamp : 0);
}

/** Invalid/future persisted roll timestamps must not lock a save out indefinitely. */
export function normalizeLastRollTimestamp(value: unknown, now = Date.now()): number {
  if (value == null) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return 0;
  const safeNow = Math.max(0, Math.floor(now));
  return value > safeNow ? 0 : value;
}

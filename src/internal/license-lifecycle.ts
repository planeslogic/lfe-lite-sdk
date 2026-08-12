export const MAX_TIMER_DELAY_MS = 2_147_000_000;
export const EXPIRY_REFRESH_TOLERANCE_MS = 50;

export function parseExpiryMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nextExpiryDelayMs(expiresAtMs: number, nowMs: number): number {
  const remaining = expiresAtMs + EXPIRY_REFRESH_TOLERANCE_MS - nowMs;
  if (remaining <= 0) {
    return 0;
  }
  return Math.min(remaining, MAX_TIMER_DELAY_MS);
}

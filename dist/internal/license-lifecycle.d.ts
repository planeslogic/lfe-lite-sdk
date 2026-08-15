export declare const MAX_TIMER_DELAY_MS = 2147000000;
export declare const EXPIRY_REFRESH_TOLERANCE_MS = 50;
export declare function parseExpiryMs(value: string | null | undefined): number | null;
export declare function nextExpiryDelayMs(expiresAtMs: number, nowMs: number): number;

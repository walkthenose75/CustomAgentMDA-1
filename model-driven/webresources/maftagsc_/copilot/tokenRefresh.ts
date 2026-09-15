// Pure token-lifetime helpers for the side-pane silent-refresh loop.
//
// This module has NO imports on purpose: it holds only side-effect-free timing
// math so it can be unit-tested directly (see model-driven/build.test.mjs) and
// reasoned about in isolation. All MSAL/Web Chat wiring lives in agentSidePane.ts.

// Refresh this far ahead of the token's stated expiry so a fresh token is in
// hand before the live conversation would ever present an expired one.
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

// Never schedule a refresh closer than this; guards against a tight/negative
// window (e.g. a token that is already near expiry) turning into a busy loop.
export const MIN_TOKEN_REFRESH_DELAY_MS = 30 * 1000;

/**
 * Milliseconds to wait before silently refreshing the delegated access token.
 *
 * Returns `null` when the lifetime is unknown (no/!finite `expiresOn`), meaning
 * "cannot schedule a proactive refresh — fall back to reactive reconnect". A
 * non-null result is always clamped to at least `minDelayMs`.
 */
export function computeRefreshDelayMs(
    expiresOn: Date | null | undefined,
    now: number,
    skewMs: number = TOKEN_REFRESH_SKEW_MS,
    minDelayMs: number = MIN_TOKEN_REFRESH_DELAY_MS
): number | null {
    if (!(expiresOn instanceof Date)) {
        return null;
    }
    const expiresAt = expiresOn.getTime();
    if (!Number.isFinite(expiresAt)) {
        return null;
    }
    return Math.max(expiresAt - skewMs - now, minDelayMs);
}

// Pure, import-free helpers for the launcher's per-navigation configuration cache.
//
// The launcher's OnLoad handler runs on every form and, before this cache, read
// the sidecar configuration (a small Dataverse query) on each navigation. Because
// the configuration and its target bindings change rarely, the launcher caches the
// result in sessionStorage for a short TTL, collapsing per-navigation reads to
// roughly one per browser session. Staleness self-heals: the pane always reads a
// fresh configuration when it (re)loads, and the entry expires after the TTL.
//
// The freshness decision is isolated here so it can be unit-tested directly.

export const CONFIG_CACHE_TTL_MS = 15 * 60 * 1000;

// Bump when the persisted envelope shape changes so stale-format entries written
// by an older deployment are ignored rather than mis-parsed.
export const CONFIG_CACHE_VERSION = "v1";

export interface CachedConfigEnvelope<T> {
    savedAt: number;
    configuration: T;
}

export function configCacheKey(
    appId: string,
    version: string = CONFIG_CACHE_VERSION
): string {
    return `maftagsc.sidecar.config.${version}.${appId}`;
}

// A parsed envelope is usable when it carries a finite, non-future timestamp, a
// configuration payload, and an age within the TTL window.
export function isFreshEnvelope(
    envelope: unknown,
    now: number,
    ttlMs: number = CONFIG_CACHE_TTL_MS
): boolean {
    if (!envelope || typeof envelope !== "object") {
        return false;
    }
    const candidate = envelope as { savedAt?: unknown; configuration?: unknown };
    if (typeof candidate.savedAt !== "number" || !Number.isFinite(candidate.savedAt)) {
        return false;
    }
    if (candidate.configuration === null || candidate.configuration === undefined) {
        return false;
    }
    const age = now - candidate.savedAt;
    return age >= 0 && age <= ttlMs;
}

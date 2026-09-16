// Pure, import-free context-selection logic for the pane runtime. Kept in its own
// module (like tokenRefresh.ts) so the navigation watcher's "prefer the fresher
// in-scope form" rule has one home and can be unit-tested directly.

export interface ResolvableContext {
    pageType: string;
    entityName: string;
    recordId: string | null;
}

// Two contexts describe the same form when their page type, table, and record
// identity match. Record name and roles are content, not identity, so they are
// intentionally excluded here.
export function isSameForm(a: ResolvableContext, b: ResolvableContext): boolean {
    return (
        a.pageType === b.pageType &&
        a.entityName === b.entityName &&
        (a.recordId ?? "") === (b.recordId ?? "")
    );
}

// Choose the context the pane should act on.
//
// The launcher writes `shared` (localStorage) on form OnLoad, but only for forms
// whose OnLoad handler is registered. When the user navigates to a *different*
// in-scope form without that handler, `shared` goes stale while `live` — the
// pane's own read of the host page — is the truth. So prefer `live` whenever it
// resolves to a different in-scope form. When both agree, or the host page is
// unreadable (`live` is null), keep the COOP-safe `shared` context; fall back to
// whichever single context is available, and finally to `fallback`.
export function chooseResolvedContext<T extends ResolvableContext>(
    shared: T | null,
    live: T | null,
    fallback: T
): T {
    if (live && (shared === null || !isSameForm(shared, live))) {
        return live;
    }
    return shared ?? live ?? fallback;
}

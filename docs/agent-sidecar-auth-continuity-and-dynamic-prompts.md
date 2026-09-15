# Agent Sidecar — Auth Continuity & Dynamic Per-Form Prompts

**Status:** Design / implementation guide
**Scope:** `model-driven/webresources/maftagsc_/copilot/**` (side-pane runtime) and `src/**` (Code App admin wizard)
**Audience:** engineers extending the sidecar; reviewers of the accompanying PR
**Companion artifacts:** `AgentSidecar-Auth-and-Prompts-Deck.html` (executive + technical slide deck), ADR `docs/adr/0007-dynamic-form-prompts.md`

---

## 1. Context

The Agent Sidecar surfaces a Copilot Studio agent inside a Dynamics 365 (Sales / Service / Field
Service) side pane, using **delegated per-user identity** (Microsoft Entra, `CopilotStudioClient`),
and passes **live form context** (the entity/record the user is looking at) into every turn.

Two user-reported needs are addressed here:

1. **Auth continuity (Issue):** the agent's access token can expire mid-Dynamics-session, forcing the
   user to re-authenticate to the agent even though they are still signed in to Dynamics. The two
   sessions have different lifetimes, which produces a jarring "sign in again" experience.
2. **Dynamic per-form prompts (Question):** the sidecar should present context-appropriate suggested
   prompts — e.g. Opportunity prompts on the Opportunity form, Case prompts on the Case form — rather
   than a single static list.

Both are solved **without weakening delegated identity** and **without a Dataverse schema change**.

---

## 2. Issue #1 — Auth continuity

### 2.1 Root cause

In `model-driven/webresources/maftagsc_/copilot/agentSidePane.ts`:

- `acquireToken()` performs a silent-first acquisition (`acquireTokenSilent`, falling back to an
  interactive redirect on `InteractionRequiredAuthError`) — **but it discards `result.expiresOn`.**
- `renderConversation()` calls `new CopilotStudioClient(settings, token)` and sets
  `activeToken = token` **once**. The token is snapshotted at conversation start and is **never
  refreshed**.

Consequence: when the delegated access token expires (typically ~60–90 min, governed by Entra token
lifetime / Conditional Access), the next agent call returns **401**. Because nothing re-acquires a
token in the background, the user is dropped to an interactive sign-in — even though their Dynamics
session (and their underlying Entra session) is still valid.

> This is a *token-lifetime* problem, not a *sign-in* problem. The user almost never needs to type
> credentials again — MSAL can silently mint a fresh access token from the cached, rotating refresh
> token. The bug is simply that we never ask it to.

### 2.2 Why we cannot "just reuse the Dynamics credentials"

Dynamics 365 and the sidecar agent both authenticate against Entra, but they hold **different tokens
for different resources**:

- Dynamics holds a token for the **Dataverse/Dynamics** resource.
- The agent needs a token for **`https://api.powerplatform.com/CopilotStudio.Copilots.Invoke`**
  (per ADR-0003).

A token issued for one resource cannot be presented to the other. What *is* shared is the **Entra
session** in the browser. That shared session is exactly what lets MSAL acquire the agent token
**silently** (no password prompt) — via `acquireTokenSilent` / `ssoSilent` — as long as we ask before
the current token dies and we give MSAL a `loginHint`.

### 2.3 Solution — four cooperating layers

| Layer | What it does | Effect |
|------|--------------|--------|
| **1. Capture `expiresOn`** | Stop discarding `result.expiresOn` in `acquireToken()`. | We know exactly when the live token dies. |
| **2. Silent-refresh scheduler** | Schedule a silent `acquireTokenSilent` at `expiresOn − ~5 min`; on success, swap the token into the live conversation. | Token is renewed **before** it expires — no 401, no visible interruption. Renewal is a background CORS POST using the cached rotating refresh token (no popup, no hidden iframe, no third-party cookies). |
| **2a. Transient-failure retry** | If a background refresh throws (e.g. a brief network drop) rather than genuinely requiring interaction, retry silently up to 3× (60 s apart) before falling back to Layer 4. | A momentary connectivity blip does not interrupt the session: the live token is still valid through the ~5-min skew window, so the retries complete invisibly. The reconnect chip is reserved for real interaction-required cases (which return `null`, not throw). |
| **3. SSO hinting** | `agentSidePaneLauncher.ts` captures the Dynamics UPN (`Xrm.Utility.getGlobalContext().userSettings.userName`) into the shared-context localStorage; `acquireToken()` passes it as MSAL `loginHint` and tries `ssoSilent` before any interactive step. | When an interactive step *is* unavoidable, it is account-preselected and usually completes with **zero clicks** (silent SSO), because the Entra session already exists from the Dynamics login. This is the "programmatic" experience the user asked for. |
| **4. Graceful reconnect** | If a refresh fails with `InteractionRequiredAuthError` (e.g. a Conditional Access re-auth is genuinely required), render an inline **"Session expired — Reconnect"** chip that resumes the **same `conversationId`**, instead of blanking the pane. | Worst case is one click that preserves the conversation, not a lost session. |

### 2.4 Feeding the fresh token into a live conversation

The refreshed token must reach the running chat **without resetting Web Chat** (which would wipe the
transcript). Two implementation paths, chosen at build time based on SDK capability:

- **Preferred:** if the installed `@microsoft/agents-copilotstudio-client@1.6.1` exposes a
  token-provider / token-update hook, register the scheduler's output as the token source so the
  client always calls with a current token.
- **Fallback (verified-safe):** rebuild the `CopilotStudioClient`/connection with the new token while
  **reusing the same `conversationId`** and **preserving the existing Web Chat `store`**, so the
  transcript and UI state survive the swap.

> **Action item (Phase 2):** verify the SDK token-swap capability first (via Microsoft Learn docs or
> by inspecting `node_modules`). The fallback is always available, so this is a UX-polish decision,
> not a feasibility risk.

### 2.5 Conditional Access alignment (operational guidance)

Even a perfect refresh loop cannot beat a Conditional Access policy that forces re-auth on a short
interval. To make silent renewal reliable:

- Ensure the sidecar's app registration is **in scope of the same CA session-lifetime policy** as
  Dynamics (or at least not a stricter sign-in-frequency policy).
- Prefer Entra **token lifetime defaults** over aggressive custom short-lifetime policies for this
  app, unless security requires otherwise.
- These are tenant-admin settings and are **out of code scope**, but they determine how often the
  Layer-4 reconnect chip is ever shown.

### 2.6 What we explicitly do **not** do

- **Do not** reintroduce `acquireTokenPopup` or the MSAL redirect-bridge. Dynamics sets
  Cross-Origin-Opener-Policy (COOP), which breaks popup/redirect-bridge flows. `authRedirect.ts` is a
  self-contained redirect client that writes results to `localStorage` precisely to work around COOP;
  the sign-in handshake **must** stay same-origin via `localStorage`.
- **Do not** revive the disabled Direct Line token broker (`maftagsc_GetDirectLineToken`, ADR-0002).
  It would make the agent answer as a **service identity**, losing per-user knowledge security. Every
  approach above keeps the **delegated** user identity intact.

### 2.7 Files touched (Phase 2)

- `agentSidePane.ts` — capture `expiresOn`; add refresh scheduler; accept `loginHint`; render the
  reconnect chip; token-swap into the live conversation.
- `agentSidePaneLauncher.ts` — capture the Dynamics UPN into shared-context localStorage.
- Shared context type (context envelope) — add the optional `userPrincipalName` field.
- Tests — pure refresh-delay computation (`expiresOn` → delay), `loginHint` plumbing; extend
  `model-driven/build.test.mjs` coverage as needed.

---

## 3. Question #2 — Dynamic per-form prompts

### 3.1 You already have the hook

The runtime already knows which form the user is on and who they are:

- `SidecarEntityBinding { logicalName, screenName }` in `sidecarConfiguration.ts` maps an entity/form
  to its sidecar behavior — this is the natural extension point.
- The context envelope injected by the wrapped `postActivity` already carries `entityName`,
  `recordName`, and `CurrentUserRoles`. The navigation watcher already re-evaluates on form change.

So "show Opportunity prompts on the Opportunity form" needs **new data on an existing binding** plus
**a chip bar that reads it** — no new plumbing for context or navigation.

### 3.2 Three options (by who owns the prompt list)

| Option | Who owns the list | Pros | Cons |
|--------|-------------------|------|------|
| **A — Config-driven chips (chosen for v1)** | Admin, in the sidecar config (authored in the Code App wizard) | Fully declarative; role-aware; no agent redeploy to change prompts; testable; ships now | Prompts are static text authored by admins |
| **B — Agent-driven (documented alternative)** | The Copilot Studio agent (a topic triggered on context change branches on `entityName` and emits Suggested Actions / an Adaptive Card) | Prompts can be dynamic/generative and reuse agent logic | Requires Copilot Studio authoring + agent publish cycle; harder to govern per-role from config |
| **C — Hybrid (future)** | Both: config seeds defaults, agent can override | Best of both | Most moving parts |

**Decision:** ship **Option A** now; **document Option B** as the alternative (ADR-0007). See
`docs/adr/0007-dynamic-form-prompts.md`.

### 3.3 Option A — data model & data flow

**Config extension** (`sidecarConfiguration.ts`):

```ts
interface SidecarEntityBinding {
  logicalName: string;
  screenName: string;
  prompts?: Array<{
    label: string;      // chip text shown to the user
    text: string;       // message actually sent to the agent
    roles?: string[];   // optional: only show to these security roles
  }>;
}
```

`assertSidecarConfiguration()` is loosened to accept the optional `prompts` array.

**Runtime flow:**

1. On load and on navigation (existing nav watcher), read the current binding's `prompts`.
2. Filter by `CurrentUserRoles` (`sidecarUserRoles.ts`) — a prompt with no `roles` shows to everyone;
   a prompt with `roles` shows only if the user holds one of them.
3. Render the surviving prompts as chips in a suggested-action bar above the Web Chat input
   (`agentSidePane.template.html`).
4. Clicking a chip sends its `text` through the **existing wrapped `postActivity`**, so the full
   form/record context envelope rides along automatically.

**Persistence (v1) — bundled prompt catalog.** The runtime resolves configuration from Dataverse
(`maftagsc_targetbinding` rows) with a fallback to the local bootstrap. The binding table has **no
prompts column**, and adding one is plugin-gated schema work that also regenerates the read-only
`src/generated/**` models. To make prompts work in **every** deployment without a schema change, the
prompt catalog lives in a **bundled TypeScript module** — `promptCatalog.ts` — keyed by entity
logical name. `applyPromptCatalog(configuration)` merges the catalog over the resolved configuration
(for both the Dataverse and bootstrap paths) immediately after `getByAppId`. Because the catalog
ships **inside the already-deployed `agentSidePane.js`**, chips appear in a real environment even
though Dataverse carries no prompt data. Binding-authored prompts (a future admin surface) always
take precedence; the catalog only fills the gap. This is the single source of truth — the bootstrap
no longer inlines prompts.

### 3.4 Admin authoring (Code App) — shipped (Option C)

Administrators author role-aware prompts **inside the Agent Sidecar Administration app** — no code
edits, no redeploy. The editor lives on the sidecar **detail page** (`SidecarDetailPage` →
`SidecarDetails` → `SidecarPromptsEditor`): for each bound table, add up to `MAX_PROMPTS_PER_TABLE`
(6) prompts, each with a chip label, prompt text, and optional comma-separated security roles
(blank = everyone). Saving persists the whole catalog and re-validates health.

Persistence is a single JSON column **`maftagsc_prompts` on `maftagsc_sidecarconfiguration`**, keyed
by table logical name — *not* a per-binding column. This keeps one write target that both the admin
`map()` and the runtime repository already read, and avoids regenerating `src/generated/**`.

- `src/lib/sidecar-prompts.ts` — the single serialize/validate boundary (caps, length limits,
  logical-name validation, role de-dup) shared by the real and mock providers.
- `src/components/SidecarPromptsEditor/` — Fluent v9 editor; dirty-tracking; refetch-safe draft
  reconciliation; labels the field via `DataverseFieldLabel`.
- Providers / hook / contract: `savePrompts(id, promptsByTable)` plus prompt read-through on `map()`.
- Runtime `sidecarConfigurationRepository.ts` — selects `maftagsc_prompts` as an **optional** column
  (retries without it if the environment predates the feature) and applies authored prompts onto
  matching bindings, where they win over the bundled catalog.

**Precedence:** admin-authored (Dataverse) prompts > bundled `promptCatalog.ts`, which still backfills
tables the admin has not customized. The `maftagsc_prompts` column ships in the solution
(`solution/Entities/maftagsc_sidecarconfiguration/Entity.xml`), so it travels with a solution import;
if it is ever absent the pane degrades to the bundled catalog instead of failing.

### 3.5 Files touched (Phase 3)

Runtime: `sidecarConfiguration.ts`, `promptCatalog.ts` (new), `agentSidePane.ts`,
`agentSidePane.template.html`, `hrSidecarBootstrap.ts`, `sidecarUserRoles.ts` (read).
Tests: `model-driven/build.test.mjs` — config validation, chip render + role filter, catalog merge
(binding precedence, no-mutation, role-gated prompt).

---

## 4. Architecture constraints preserved (non-negotiable)

- **Same-origin `localStorage` sign-in handshake** — no `acquireTokenPopup`, no MSAL redirect-bridge
  (Dynamics COOP).
- **Delegated identity** — no revival of the Direct Line token broker; the agent always acts as the
  signed-in user.
- **Code App rules** — `src/generated/**` is read-only; three-layer architecture; HashRouter only;
  Fluent UI v9 only; every new editable Dataverse-bound field uses `DataverseFieldLabel`; dev port
  3000; `base: './'` for build.
- **Minimal, additive schema** — the bundled catalog needs no schema change; the Option C authoring
  UI adds exactly one additive column (`maftagsc_sidecarconfiguration.maftagsc_prompts`, tracked in
  the solution). No tables added, nothing destructive, and the runtime tolerates its absence.

---

## 5. Implementation roadmap

| Phase | Work | Status |
|-------|------|--------|
| 0 | Git: fork on GitHub, add fork remote, feature branch `feature/auth-refresh-and-dynamic-prompts` off `main`; PR upstream at the end | **Done** — fork `walkthenose75/CustomAgentMDA-1`, branch pushed, **PR #3** open upstream |
| 1 | HTML slide deck (Fluent/Microsoft themed) — exec summary + technical detail + roadmap | **Done** |
| 2 | Auth continuity code (Section 2.7) | **Done** — validated: model-driven build + typecheck + 9 tests, main typecheck, lint, 41 vitest |
| 3 | Dynamic prompts Option A (Section 3.5) | Runtime **done** — config model, role filter, chip bar, bundled `promptCatalog.ts` merged over **both** the Dataverse and bootstrap configs, tests. In-app admin authoring UI (Option C) **shipped** — `SidecarPromptsEditor` persists to `maftagsc_sidecarconfiguration.maftagsc_prompts` (one additive, in-solution column); runtime degrades to the bundled catalog if the column is absent. |
| 4 | ADR 0007 documenting Option A choice + Option B alternative | This doc + ADR |
| 5 | Green baseline, push to fork, open PR upstream | **Done** — baseline green; pushed; PR https://github.com/martycarreras-psnl/CustomAgentMDA/pull/3 |

**Green baseline (must stay green):**
`npm run typecheck` · `npm test` · `npm run lint` · `npm run build` ·
`node model-driven/build.mjs` · `node --test model-driven/build.test.mjs`

---

## 6. Risks & open items

- **SDK token swap** — whether `CopilotStudioClient` can update its token without resetting the chat.
  Verify early (Phase 2); fallback is reconnect-by-`conversationId` preserving the Web Chat store.
- **Conditional Access** — a strict sign-in-frequency policy can still force periodic re-auth; the
  reconnect chip (Layer 4) covers this gracefully. Alignment is a tenant-admin task (Section 2.5).
- **`ssoSilent` third-party-cookie edge cases** — mitigated because token renewal uses a CORS POST,
  not a hidden iframe.
- **Prompt persistence** — v1 uses a JSON blob to avoid plugin-gated Dataverse schema work; a
  dedicated table can follow if the catalog grows large.
- **Out of scope here** — deployment, live-form mutation, and any Dataverse schema change (gated on
  the Dataverse/Code Apps plugins, a dev environment, and explicit approval).

---

## 7. Theming note (documentation & deck)

The companion slide deck uses **Fluent UI v9 / Microsoft design tokens** (Segoe UI; brand `#0f6cbd`
light / `#479ef5` dark — the same brand the sidecar's Web Chat already uses; Fluent neutral grays;
4–8 px radii; Fluent depth shadows; light/dark auto-detection). This matches the product's own design
language and Dynamics 365's host UI.

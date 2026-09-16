# AuthPromptPlan — Developer Handoff

**Two Agent Sidecar enhancements: (A) Silent Auth Continuity and (B) Dynamic Form Prompts.**

This is the single entry point for the developer picking up this work. It is written so you can
**point GitHub Copilot at it** (coding agent *or* IDE/CLI) and adopt, extend, or re-implement the two
features with confidence. Everything below is anchored to real files, real commands, and the existing
reference implementation.

> **Read this first, then open the track you're working on (§3 or §4).** The durable guardrails are
> auto-loaded by Copilot from `.github/instructions/20-agent-sidecar-auth-and-prompts.instructions.md`
> — you don't need to re-paste them.

---

## 0. Current status (important — the work already exists)

Both features are **implemented, merged into a feature branch, opened as PR #3, and deployed to
Contoso-Dev.** This handoff is therefore about **owning, verifying, and extending** the work — not
building from a blank page.

| Item | State |
|---|---|
| Silent auth continuity (Track A) | ✅ Implemented in PR #3 · deployed to Contoso-Dev |
| Dynamic form prompts (Track B) | ✅ Implemented in PR #3 · deployed to Contoso-Dev |
| In-app prompt authoring UI (Option C) | ✅ Shipped (`SidecarPromptsEditor`) · deployed |
| Incident Reports / Incident Process prompts | ✅ Authored on the live Contoso-Dev record (6 each) |
| Green baseline (typecheck / test / lint / build / model-driven) | ✅ Passing on the branch |

**Fastest path if you just want it live upstream:** review and merge **PR #3**
(`walkthenose75/CustomAgentMDA-1:feature/auth-refresh-and-dynamic-prompts` → `martycarreras-psnl/CustomAgentMDA`).
Use the rest of this document to understand, verify, or extend it.

---

## 1. How to drive GitHub Copilot against this handoff

The repo is already AI-agent-friendly (`.github/copilot-instructions.md`, `.github/instructions/*`,
`.claude/`, `.cursor/`). This handoff adds **one** feature-scoped instruction file and **two** issue
specs so both Copilot surfaces work well:

**If you use the Copilot coding agent (assign an issue → it opens a PR):**
1. Create two GitHub issues from `docs/handoff/issue-auth-continuity.md` and
   `docs/handoff/issue-dynamic-prompts.md` (copy the body verbatim — they already have acceptance
   criteria + file anchors + a test plan).
2. Assign each to `@copilot`. Keep them **separate** — the two features ship and roll back independently.

**If you use Copilot in VS Code / Copilot CLI (interactive):**
1. Open this file and the relevant track (§3 or §4). Point Copilot at the **Anchors** list for that track.
2. The guardrails in `.github/instructions/20-agent-sidecar-auth-and-prompts.instructions.md` are
   auto-attached for `model-driven/webresources/**` and the sidecar `src/**` files — Copilot will honor
   them without prompting.

**Definition of done (both surfaces):** the green baseline in §5 passes. Nothing is "done" until it does.

---

## 2. Repository & branch map

| | |
|---|---|
| Upstream (origin) | `https://github.com/martycarreras-psnl/CustomAgentMDA` |
| Fork | `https://github.com/walkthenose75/CustomAgentMDA-1` |
| Feature branch | `feature/auth-refresh-and-dynamic-prompts` |
| PR | **#3** (open, mergeable) → upstream `main` |

Key commits on the branch (reference implementation):

| Commit | What it added |
|---|---|
| `2d6d7e9` | Auth: retry silent refresh on transient failure before reconnect |
| `bb9fa63` | Prompts: in-app authoring UI for role-aware suggested prompts (Option C) |
| `7301a5c` | Prompts: make authored-prompt column portable + pane resilient to its absence |
| `b86a2aa` | Prompts: bundled catalog defaults for `contoso_incidentreport` / `contoso_incidentprocess` |
| `be195da` | Deploy: add `authRedirect.html` web resource + Contoso-Dev setup |

---

## 3. Track A — Silent Auth Continuity

### 3.1 Problem / root cause
The delegated MSAL access token was captured **once** in `renderConversation()`
(`new CopilotStudioClient(settings, token)`; `activeToken = token`) and never refreshed. Tokens live
~60–90 min, so the agent begins returning 401s mid-Dynamics-session and the user is bounced back to
sign-in. Fix: a proactive silent-refresh loop + SSO hinting + graceful reconnect, all while preserving
the **delegated** user identity.

### 3.2 What shipped (anchors)
All under `model-driven/webresources/maftagsc_/copilot/`:

- **`tokenRefresh.ts`** — pure, import-free timing math. `computeRefreshDelayMs(expiresOn, now)` returns
  when to refresh (`expiresOn − TOKEN_REFRESH_SKEW_MS` = 5 min ahead, clamped to
  `MIN_TOKEN_REFRESH_DELAY_MS` = 30 s), or `null` when the lifetime is unknown (→ reactive reconnect).
- **`agentSidePane.ts`** — `acquireToken()` now captures `result.expiresOn`, passes MSAL `loginHint`,
  and tries `ssoSilent` / `acquireTokenSilent` before any interactive step. A scheduler refreshes the
  token proactively and feeds it into the **live** conversation by **rebuilding the
  `CopilotStudioClient` / connection while reusing the same `conversationId` and preserving the Web Chat
  `store`** (the SDK exposes no token-setter — rebuild is the sanctioned path). On
  `InteractionRequiredAuthError` (after a transient retry) it renders an inline **"Session expired —
  Reconnect"** chip that resumes the same conversation.
- **`agentSidePaneLauncher.ts`** — captures the Dynamics UPN
  (`Xrm.Utility.getGlobalContext().userSettings.userName`) into the shared-context localStorage so
  `acquireToken()` can use it as the `loginHint`.
- **`authRedirect.ts` / `authRedirect.html`** — the MSAL redirect landing page.
- Tests: `model-driven/build.test.mjs` covers `computeRefreshDelayMs` and loginHint plumbing.

### 3.3 Non-negotiable constraints (do not regress)
- **Keep the localStorage sign-in handshake.** Do **not** reintroduce `acquireTokenPopup` or an MSAL
  redirect-bridge — Dynamics COOP headers break popups/iframes.
- **Keep delegated identity.** Do **not** revive the disabled DirectLine token broker
  (`maftagsc_GetDirectLineToken`); it would make the agent answer as a service identity.
- Silent refresh must renew via the cached rotating refresh token (CORS POST), **not** a hidden iframe.

### 3.4 Verify
```
npm run typecheck:model-driven
npm run build:model-driven
npm run test:model-driven      # node --test model-driven/build.test.mjs
```
Manual: open a record form in Contoso-Dev, leave the pane idle past token expiry, confirm the
conversation keeps working (no re-auth); force an expiry to see the Reconnect chip resume the thread.

### 3.5 Extension backlog (if goal = extend)
- Emit telemetry for refresh success/failure and reconnect counts (App Insights or console channel).
- Make `TOKEN_REFRESH_SKEW_MS` configurable via the sidecar config record.
- Multi-account disambiguation when MSAL has more than one cached account.
- Broaden tests around the `ssoSilent` / `InteractionRequiredAuthError` branches.

### 3.6 Re-implement from spec (if goal = clean-room)
Recreate `tokenRefresh.ts` (pure math, unit-tested first), then wire `acquireToken()` to capture
`expiresOn`, schedule the refresh, and rebuild the client on the same `conversationId` preserving the
Web Chat `store`. Add the launcher UPN capture and the reconnect chip last. Honor every constraint in §3.3.

---

## 4. Track B — Dynamic Form Prompts

### 4.1 What it does
Surfaces form-specific, role-aware **suggested-prompt chips** above the Web Chat input. Clicking a chip
sends its `text` through the existing wrapped `postActivity`, so the full form/record context rides along.
Prompts are keyed by **table logical name** and filtered by the current user's roles.

### 4.2 Two prompt sources + precedence (read this before editing)
There are two places prompts can come from, and **authored prompts win**:

1. **Bundled catalog** — `model-driven/webresources/maftagsc_/copilot/promptCatalog.ts`
   (`SIDECAR_PROMPT_CATALOG`). Compiled into `agentSidePane.js`, so defaults work in **every**
   deployment with **no schema change**. Already contains `contoso_incidentreport` and
   `contoso_incidentprocess` defaults.
2. **Authored record** — JSON on `maftagsc_sidecarconfiguration.maftagsc_prompts`, keyed by table
   logical name. Written by the admin app (Option C) or directly.

`applyPromptCatalog()` only fills bindings that **don't already** declare prompts, so **record/binding
prompts take precedence** over the bundled catalog. The Incident Reports config on Contoso-Dev now has
**6 authored prompts per table on the record**, which override the 4 bundled defaults.

### 4.3 What shipped (anchors)
Runtime (`model-driven/webresources/maftagsc_/copilot/`):
- **`sidecarConfiguration.ts`** — `SidecarPrompt { label; text; roles? }`, `SidecarEntityBinding.prompts`.
- **`promptCatalog.ts`** — `SIDECAR_PROMPT_CATALOG` + `applyPromptCatalog()` (pure; binding prompts win).
- **`sidecarConfigurationRepository.ts`** — selects the optional `maftagsc_prompts` column with a
  graceful **missing-column retry**, and `parseAuthoredPrompts()` maps the JSON onto the bindings.
- **`sidecarUserRoles.ts`** — role filtering against `CurrentUserRoles`.
- **`agentSidePane.template.html`** — the chip / suggested-action bar. **`agentSidePane.ts`** —
  `getBindingPrompts()`, chip render, click → wrapped `postActivity`.

Admin app / Option C (`src/`):
- **`components/SidecarPromptsEditor/SidecarPromptsEditor.tsx`** — the authoring UI (per-table prompts).
- **`components/SidecarDetails/SidecarDetails.tsx`** — mounts the editor on the detail page
  (`/sidecars/:id`); `onSavePrompts` → provider.
- **`lib/sidecar-prompts.ts`** — the **single serialization boundary**: `serializePromptCatalog` /
  `parsePromptCatalog`, `MAX_PROMPTS_PER_TABLE = 6`, label ≤ 60, text ≤ 400, role ≤ 100, keys must match
  `/^[a-z][a-z0-9_]*$/`.
- **`services/real-sidecar-admin-provider.ts`** — `savePrompts(id, promptsByTable)` writes
  `maftagsc_prompts`; `map()` reads it back onto `TargetTable.prompts`.
- **`types/sidecar-admin-models.ts`** — `SidecarPromptDefinition`, `TargetTable.prompts`.

### 4.4 Persistence (no schema change)
Prompts are a JSON object on the existing `maftagsc_prompts` column (Memo / `TextArea`,
`MaxLength = 100000`). Shape:
```json
{ "contoso_incidentreport": [ { "label": "Summarize this incident", "text": "…", "roles": ["Manager"] } ] }
```
Keep the admin app and runtime pane agreeing on shape by routing **all** reads/writes through
`src/lib/sidecar-prompts.ts` (admin) and `sidecarConfigurationRepository.ts` (runtime).

### 4.5 Verify
```
npm run typecheck && npm test && npm run lint && npm run build
npm run build:model-driven && npm run test:model-driven
```
Manual: open a `contoso_incidentreport` (or `…process`) form in Contoso-Dev → open the sidecar pane →
confirm the chips render → click one → the agent answers with record context. Edit prompts in the admin
app (`/sidecars/:id` → Prompts card → Save) and re-check the pane.

### 4.6 Extension backlog (if goal = extend)
- **Per-form** prompts (currently per-table) — key by `systemform` id in addition to table.
- Author prompts inside the **`SidecarWizard`** flow, not only the detail page.
- Usage analytics on chip clicks.
- Localization of `label` / `text`.
- Only if the catalog outgrows a JSON blob: a dedicated `maftagsc_targetbinding.prompts` column (schema
  change — regenerates read-only `src/generated`, gated on the Dataverse plugin).

### 4.7 Re-implement from spec (if goal = clean-room)
Model the JSON shape and limits on `src/lib/sidecar-prompts.ts` first (with tests), then the runtime
`applyPromptCatalog` merge (bundled defaults ← overridden by authored record), the role filter, the chip
bar, and finally the admin editor. Keep the "no schema change / JSON blob" decision from ADR 0007.

---

## 5. Green baseline — Definition of Done

Run all of these; every one must pass before opening/merging a PR:

```
npm run typecheck            # tsc --noEmit (code app)
npm test                     # vitest run
npm run lint                 # eslint src/ --max-warnings 0
npm run build                # typecheck + vite build
npm run build:model-driven   # node model-driven/build.mjs
npm run test:model-driven    # node --test model-driven/build.test.mjs
npm run typecheck:model-driven
```

> Note: two vitest discovery tests need a raised timeout only on CPU-starved machines — a real failure
> is different from a timeout.

---

## 6. Deployment state (Contoso-Dev) & how to redeploy

Already live in Contoso-Dev (`https://org8599b1c0.crm.dynamics.com/`, env
`f93f07d8-7d47-ea58-95b8-d71772175b0b`):
- Runtime web resources (`agentSidePane.html/.js`, `authRedirect.html`) — deployed + published.
- `maftagsc_prompts` column present (Memo, `MaxLength 100000`).
- Admin **code app** "Agent Sidecar" (`de99b8b7-fa6b-4ed1-b2f6-38f2f12d3017`) — updated in place with
  Option C. `power.config.json` is pointed at this env/app.
- Incident prompts authored on the config record `75b20c59-38b1-f111-aaac-000d3a314f6d`.

Redeploy the code app: `npm run build` then `pac code push -s AgentSidecarCore` (with the correct auth
profile selected). Full routes, rollback, and greenfield install: **`docs/deployment-runbook-auth-and-prompts.md`**
and **`docs/post-import-setup-contoso-dev.md`**.

---

## 7. Reference docs (already in the repo — link, don't duplicate)

- **Design deep-dive:** `docs/agent-sidecar-auth-continuity-and-dynamic-prompts.md`
- **ADR (why JSON blob, not a table; Option A vs B vs C):** `docs/adr/0007-dynamic-form-prompts.md`
- **Deploy + verify + rollback:** `docs/deployment-runbook-auth-and-prompts.md`
- **Contoso-Dev post-import setup:** `docs/post-import-setup-contoso-dev.md`
- **Repo conventions Copilot must follow:** `.github/instructions/` (esp. `09-form-field-pattern`,
  `05-testing`, `06-security`) and the feature-scoped
  `.github/instructions/20-agent-sidecar-auth-and-prompts.instructions.md`.

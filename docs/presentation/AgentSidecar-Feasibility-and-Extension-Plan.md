# Agent Sidecar — Architecture Understanding, Feasibility & Extension Plan

Repo: https://github.com/martycarreras-psnl/CustomAgentMDA
Cloned to: `C:\VSCodeProjects\the-sidecar-app\CustomAgentMDA`
Prepared: 2026-09-14

---

## 1. What this project is

A reusable Power Platform **product** ("Agent Sidecar") that adds a persistent,
context-aware Copilot Studio assistant to any Dataverse **model-driven app**. It ships as
one importable solution (`solution-core/AgentSidecarCore.zip`) and is configured through an
in-app wizard — no scripting for the end user. HR Management is an optional reference
implementation only.

It has **two code surfaces**:

### A. Admin app — Power Apps **Code App** (`src/`)
- Stack: TypeScript + React 18 + Fluent UI v9 + Vite, TanStack Query, HashRouter.
- Deployed via `pac code push -s AgentSidecarCore`. Restricted to System Administrators.
- UX: 3 routes (`src/App.tsx`) — Portfolio dashboard, Create wizard (`/new`), Detail (`/sidecars/:id`).
- 5-step wizard (`src/components/SidecarWizard/SidecarWizard.tsx`, 471 lines):
  Application → Tables & forms → Agent → Identity → Review/Deploy.
- Clean **three-layer architecture**:
  - Components render → hooks orchestrate (`src/hooks/useSidecarAdministration.ts`,
    `useOperationReport.ts`) → provider contract (`SidecarAdministrationProvider` in
    `src/services/sidecar-admin-contracts.ts`).
  - Two provider implementations behind a factory (`src/services/sidecar-provider-factory.ts`):
    `mock-sidecar-admin-provider.ts` (dev) and `real-sidecar-admin-provider.ts`
    (480 lines — the live deploy/lifecycle engine).
  - `src/generated/**` — read-only Dataverse service bindings (Appmodules, Bots, Systemforms,
    Solutions, Publishers, Roles, Systemusers, plus custom tables
    `Maftagsc_sidecarconfigurations`, `Maftagsc_targetbindings`). **Never edit by hand.**

### B. Side-pane runtime — model-driven web resources (`model-driven/webresources/maftagsc_/copilot/`)
Vanilla TypeScript, bundled by `model-driven/build.mjs` (tested by `build.test.mjs`).
- `agentSidePaneLauncher.ts` (201 lines) — registered on each selected form's **OnLoad**;
  creates/reuses ONE stable `Xrm.App.sidePanes` pane per app; writes live form context to
  `localStorage` key `maftagsc.sidecar.context.<paneId>` on every navigation.
- `agentSidePane.ts` (696 lines — the heart) — hosts Bot Framework Web Chat; signs the user in
  with **delegated MSAL PKCE**; connects via the **M365 Agents SDK `CopilotStudioClient`**;
  pushes page/record/**role** context (`pvaSetContext` + a trusted per-message envelope);
  1s navigation watcher keeps context fresh; "New conversation" resets without re-auth.
- `authRedirect.ts` (102 lines) — self-contained MSAL redirect client that reports the token
  via same-origin `localStorage` (deliberately avoids `acquireTokenPopup` / redirect-bridge
  because Dynamics' COOP header breaks them).
- `sidecarConfiguration*.ts`, `sidecarConnectionSettings.ts`, `sidecarUserRoles.ts` — config
  read/shape + harness-specific direct-connect URL + role-name context.

### Data / config model (`src/types/sidecar-admin-models.ts`)
- `SidecarConfiguration` (persisted in `maftagsc_sidecarconfigurations`) — target app, agent,
  identity, pane, `tables[] → forms[]{formId,name,enabled}`, `enabledSurfaces`,
  **`autoEnableNewTables: boolean`** (flag already exists in schema + read at line 171),
  `driftItems[]`, `healthChecks[]`, lifecycle/health state.
- Lifecycle engine verbs (all implemented in the real provider): `deploy`, `validate`,
  `reconcile`, `setEnabled`, `uninstall` — each with per-form progress + automatic rollback,
  and a downloadable JSON report (`useOperationReport`).
- Validation states include a **`Conflict`** value (deprecated/system-form bindings).

---

## 2. Key architecture constraints to preserve (from ADRs + HANDOFF + AGENTS.md)

1. **Delegated identity end-to-end** — agent answers as the signed-in user; knowledge stays
   gated by that user's permissions. Roles are context, never authorization.
2. **Runtime auth is delegated MSAL PKCE + localStorage handshake.** Do NOT reintroduce
   `acquireTokenPopup` or the MSAL redirect-bridge (COOP breaks them). The token-broker
   Custom API (`maftagsc_GetDirectLineToken`) is disabled and off the critical path.
3. **Per-form binding model** — deploy binds only `enabled` forms; Information form defaults on.
4. **Deploy performs LIVE form mutations** — only through the admin app, always published +
   verified, with rollback. Get explicit approval before deploying to any real environment.
5. **Code App rules** (AGENTS.md): `src/generated/**` read-only; three-layer architecture;
   port 3000 dev; `base:'./'` for build; **HashRouter only**; Fluent UI v9 only; no non-Power-
   Platform hosting/auth libs; every editable Dataverse field uses `DataverseFieldLabel`.
6. **Dataverse/scaffold/deploy work is plugin-gated** — Dataverse-skills plugin + Code Apps
   plugin must be installed & verified before any schema/connector/deploy operation
   (`.github/instructions/00-prereq-gate.instructions.md`).

---

## 3. Feasibility verdict

**Adding functionality is highly feasible.** The codebase is well-structured, documented
(6 ADRs, HANDOFF, CONTEXT glossary), test-backed (41 unit + 7 model-driven tests, green
baseline per HANDOFF), and explicitly designed for extension via the provider contract and
per-form model. Most UI/logic additions are clean and low-risk.

The gating factors are environmental, not architectural:
- Live deploy/Dataverse/solution changes need the two plugins + a Power Platform environment
  where you are System Administrator, plus an Entra SPA app registration.
- `deploy` mutates real form metadata — never test in an environment you care about.

---

## 4. Backlog features — file-level extension plan, effort & risk

Effort scale: **S** ≈ <½ day, **M** ≈ 1–2 days, **L** ≈ 3+ days. All effort assumes a working
env + green baseline.

### 4.1 Package AgentSidecarCore as a MANAGED solution — **Effort M / Risk Med**
- Today the pipeline exports **unmanaged** (`--managed false`, HANDOFF "Deployment pipeline").
- Work: add a managed export/build path; decide dual-ship (managed for distribution, unmanaged
  for dev) or managed-only. The real provider already handles `ismanaged` on the *binding*
  solution (line 230) — but the **Core** solution being managed changes ALM for consumers
  (no in-place edits, uninstall semantics). ADR-worthy (hard to reverse for downstream imports).
- Touch: deployment scripts / `package.json` `deploy` script; docs (README import step);
  new ADR `docs/adr/0007-managed-core-solution.md`.
- Risk: managed uninstall removing target bindings owned by the sidecar — verify uninstall
  path (`uninstall` at real provider line 464) still cleanly removes per-form handlers first.

### 4.2 Validate/support MULTIPLE sidecars across apps in one environment — **Effort M / Risk Med**
- Already keyed per app (pane id per app; config is per target app). Mostly a **verification +
  test** effort plus UX polish on the portfolio dashboard.
- Touch: `PortfolioDashboard`, `listConfigurations` filtering, `agentSidePaneLauncher.ts`
  pane-id uniqueness across apps; add e2e coverage.
- Risk: `localStorage` context-key collisions if two apps ever share a pane id — confirm the
  key includes app/pane id (it does: `maftagsc.sidecar.context.<paneId>`).

### 4.3 Auto-enable newly added tables via drift reconcile — **Effort S–M / Risk Low-Med**
- **The flag already exists** (`autoEnableNewTables` in model + persisted +
  read at real provider line 171) but appears **not yet wired into the reconcile logic**.
- Work: in `validate`/`reconcile` (real provider ~line 253/457), when
  `autoEnableNewTables===true` and drift shows new tables/forms (`kind:'addition'`), auto-mark
  them enabled and include in the apply set. Add a wizard/detail toggle to set the flag.
- Touch: `real-sidecar-admin-provider.ts` (reconcile/validate), `mock-sidecar-admin-provider.ts`
  (mirror behavior), `SidecarDetails.tsx`/wizard toggle, tests.
- Risk: auto-enabling could mutate forms the admin didn't intend → keep it opt-in + surface in
  the deployment impact preview (`previewDeployment`).

### 4.4 Cleanup UX for Conflict validation bindings — **Effort M / Risk Med**
- `Conflict` validation state exists (`VALIDATION.conflict`, line 67; set at line 253) for
  deprecated/system forms, but there's no dedicated remediation UX.
- Work: surface conflicts distinctly in `SidecarDetails`; add an action to drop/repoint the
  conflicting binding; extend the provider with a targeted cleanup path (or reuse
  `reconcile`/`uninstall` per-binding).
- Touch: `SidecarDetails.tsx`, `SidecarStatusBadge`, contract + both providers, tests.
- Risk: removing a binding is a live form mutation — must go through the rollback-guarded path.

### 4.5 Automated tests for new surfaces — **Effort S–M / Risk Low**
- Gaps called out in HANDOFF: `useOperationReport`, per-form wizard behavior, navigation watcher.
- Work: Vitest + Testing Library for hooks/components; `node --test` for any model-driven logic.
- Touch: `*.test.ts(x)` beside targets; no production code risk. **Best first PR** — raises
  confidence for everything else and needs no live environment (runs on mocks).

### 4.6 Real screenshots in the setup guide — **Effort S / Risk Low**
- `figure.shot` is hidden in `docs/setup-guide/AgentSidecarSetupGuide.html`.
- Work: capture screenshots, unhide/style figures. Docs-only, no code risk.

### 4.7 Remove the unused token-broker Custom API/plugin from Core — **Effort M / Risk Med**
- The `maftagsc_GetDirectLineToken` plugin/step is disabled and off the critical path.
- Work: remove from the Core solution + any references; confirm nothing in `agentSidePane.ts`
  or `dataverse-custom-api.ts` still calls it (`assertSidecarActionsAvailable`).
- Risk: solution component removal + re-export/import; verify no consumer depends on it.
  ADR-worthy if it changes the shipped solution contract.

---

## 5. Recommended sequencing (when you return / have an env)

1. **4.5 Tests** — no env needed, hardens the baseline, safe first move (runs on mocks).
2. **4.3 Auto-enable tables** — flag already exists; small, high-value, opt-in.
3. **4.4 Conflict cleanup UX** — completes the lifecycle story.
4. **4.2 Multi-sidecar validation** — mostly verification + e2e.
5. **4.1 Managed solution** / **4.7 token-broker removal** — ALM/packaging changes; do together,
   record ADRs, test uninstall carefully.
6. **4.6 Screenshots** — docs polish any time.

## 6. Before writing code (prereqs)
- Install & verify **Dataverse-skills** plugin and **Code Apps** plugin (prereq-gate Step 8/9).
- `pnpm install`; confirm green baseline: `npm run typecheck`, `npm test`, `npm run lint`,
  `npm run build`, plus `node model-driven/build.mjs` + `node --test model-driven/build.test.mjs`.
- For live deploy: `pac org who` to confirm environment; get explicit approval (live form
  mutations); use a throwaway/dev environment first.

## 7. What I could NOT determine without input
- **Which feature(s) you actually want** — this plan covers the documented backlog; a custom
  feature would get its own file-level breakdown.
- **Whether you have a live environment + the two plugins installed** — required for any deploy
  or Dataverse change. Pure UI/logic + tests can proceed against the mock provider with no env.

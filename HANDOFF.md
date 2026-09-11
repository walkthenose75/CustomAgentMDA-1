# Agent Sidecar — Session Handoff

## What this project is now

Agent Sidecar is a **reusable capability** that adds a persistent, context-aware Copilot Studio assistant to any Dataverse model-driven app. It is deployed by importing one solution (`solution-core/AgentSidecarCore.zip`) and configured through an in-app admin wizard. **HR Management is the optional reference implementation only.** See `README.md` for the product framing.

The core capability is **complete and working end to end** in two environments. This handoff sets up a new session to build **new features**.

## Start the next session with this request

> Continue from HANDOFF.md. The core Agent Sidecar capability is complete and deployed to dev and Sales CS. I want to add new features — <describe the feature>. Preserve the architecture constraints (delegated auth via the localStorage handshake, per-form binding model, deploy through the admin app, no CLI in the user-facing path). Validate with the full baseline and ship via the standard deployment pipeline below.

## Current status — all working and deployed

- **Admin app** (Power Apps Code App, System Administrator only): 5-step wizard — Application → Tables & forms → Agent → Identity → Review/Deploy. Deploy, disable, reconcile, and uninstall all work with **live per-form progress** and a **downloadable JSON report**.
- **Agent discovery**: the wizard lists compatible published custom agents from the current environment, classifies Standard versus GitHub Copilot harness agents from Dataverse metadata, and saves the harness-specific direct-connect URL.
- **Per-form selection**: tables default off; expand a table to pick individual forms; the **Information** form is selected by default. Deploy binds only selected forms.
- **Sign-in**: delegated MSAL PKCE completed via a same-origin **localStorage handshake** (COOP-proof); succeeds on the first attempt; loading splash title comes from the configured pane title.
- **Navigation context**: the launcher writes the current form context to localStorage on every OnLoad; the sidecar watches it and proactively pushes a fresh `pvaSetContext` into the live conversation, plus a trusted per-message envelope.
- **Harness-specific runtime**: the side pane passes the saved URL through `ConnectionSettings.directConnectUrl`, preserving Standard and GitHub Copilot harness routes. The GHCP `/copilotstudio/agenticruntime/3p/` route remains experimental until Microsoft documents it as a stable production contract.
- **Deployed** to dev (`carremacodeapps`) and destination (`carrema Sales CS` / `org862d1967`). README repositioned as a reusable product.
- **Green baseline**: `npm run typecheck`, `npm test` (41), `npm run lint`, `npm run build`; model-driven `node model-driven/build.mjs` + `node --test model-driven/build.test.mjs` (7).

## Environments and identity

| Item | Dev (source) | Destination |
|---|---|---|
| Name | carremacodeapps | carrema Sales CS |
| URL | `https://carremacodeapps.crm.dynamics.com` | `https://org862d1967.crm.dynamics.com` |
| Env ID | `f9b87f8b-0abf-e629-affb-b13195d1ed14` | `7d8dcd87-2e21-e805-b9be-678794ecc80b` |
| SPA app reg | `9d03cd77-5246-4c9c-8e9d-262bff547a25` | `51733b88-b854-441d-a253-57156285344d` |

- Tenant `d92190b9-98e7-46da-8b11-580e06c7d15d`; user `macarrer@msftbapb2bcommercial.onmicrosoft.com`.
- Publisher `agentsidecar`, prefix `maftagsc`.
- Solutions: **`AgentSidecarCore`** (reusable — the deliverable), `HRAgentSidecar` (HR reference).
- Code App id `71d3fa20-9990-4622-9775-11b56f2ed893` (canvasapp `maftagsc_agentsidecar_4b928`).
- Both SPA app regs are single-tenant SPA with delegated `CopilotStudio.Copilots.Invoke` + admin consent; redirect URI is `<org>/WebResources/maftagsc_/copilot/authRedirect.html`.
- GitHub: `https://github.com/martycarreras-psnl/CustomAgentMDA`.

## Deployment pipeline

**Code App changes** (wizard/admin UI in `src/`):
1. `npm run build && pac code push -s AgentSidecarCore` (dev)
2. `pac solution export --name AgentSidecarCore --path ./solution-core/AgentSidecarCore.zip --managed false --overwrite`
3. `pac solution import --path ./solution-core/AgentSidecarCore.zip --environment 7d8dcd87-2e21-e805-b9be-678794ecc80b --publish-changes --force-overwrite`
4. Commit the refreshed zip and push.

**Web-resource changes** (side-pane runtime in `model-driven/`):
1. `node model-driven/build.mjs` (rebuilds `solution/WebResources/maftagsc_/copilot/*`)
2. PATCH each changed web resource's `content` (base64) via the Web API in dev, then `PublishXml`. Use `scripts/auth.py` `get_token(scope=<URL>/.default)`; URL-encode `$filter` with `urllib.parse.quote(...)`.
3. Export from dev and import to destination as above.

## Architecture facts to preserve

- **Runtime auth is delegated MSAL PKCE** (scope `CopilotStudio.Copilots.Invoke`) + `CopilotStudioWebChat`. It does **not** call the token-broker Custom API (`maftagsc_GetDirectLineToken`); that plugin/step is disabled and off the critical path.
- **Sign-in completion**: `authRedirect.ts` is a self-contained MSAL redirect client that reports via same-origin `localStorage`; `agentSidePane.ts` opens it as a popup and polls. **Do not** reintroduce `acquireTokenPopup` or the MSAL redirect-bridge (`broadcastResponseToMainFrame`) — Dynamics' COOP header breaks it.
- **Context sync**: `agentSidePaneLauncher.ts` writes `maftagsc.sidecar.context.<paneId>` on each OnLoad; `agentSidePane.ts` `readSharedContext` + a 1s navigation watcher pushes `pvaSetContext`.
- **Per-form model**: `TargetTable.forms[] {formId, name, enabled}`; deploy binds only `enabled` forms; `src/lib/target-forms.ts` picks the Information default.
- Three-layer: components render, hooks orchestrate, providers/services behind adapters; `src/generated/**` is read-only. `HashRouter`. Vite port 3001 / PAC host port 3000. `base: './'` for production build.

## Key files

- `src/components/SidecarWizard/SidecarWizard.tsx` — wizard (per-form selection, progress banner).
- `src/services/real-sidecar-admin-provider.ts` — connected provider + deploy/lifecycle engine.
- `src/services/mock-sidecar-admin-provider.ts`, `src/mockData/sidecarAdministration.ts` — mock/dev provider and data.
- `src/hooks/useOperationReport.ts`, `src/components/OperationProgress/OperationProgress.tsx` — progress + downloadable report.
- `src/lib/target-forms.ts` — Information-form default helper.
- `model-driven/webresources/maftagsc_/copilot/agentSidePane.ts` (sidecar), `agentSidePaneLauncher.ts` (launcher), `authRedirect.ts` (sign-in), `agentSidePane.template.html`.
- `model-driven/build.mjs`, `model-driven/build.test.mjs`.
- `docs/setup-guide/AgentSidecarSetupGuide.html` — interactive setup guide + values worksheet (includes the Agents SDK connection string).
- `README.md` — product framing. `AGENTS.md` — repo constraints. `CONTEXT.md` — glossary.
- Repo memory: `/memories/repo/environments.md`, `/memories/repo/dataverse-auth.md`.

## Backlog / candidate new features

- Package `AgentSidecarCore` as a **managed** solution for distribution (currently unmanaged).
- Validate **multiple sidecars** across several apps in one environment (already keyed per app).
- **Auto-enable newly added tables** via drift reconcile (`autoEnableNewTables` flag exists).
- Cleanup UX for **Conflict** validation bindings (deprecated/system forms).
- **Automated tests** for the new surfaces: `useOperationReport`, per-form wizard behavior, navigation watcher.
- Optional: real screenshots in the setup guide (`figure.shot` is currently hidden).
- Optional: remove the unused token-broker Custom API/plugin from the Core solution.

## Guardrails

- **Deploy performs live form mutations.** Get explicit approval before deploying in an environment you care about — testing deploy in dev mutates the HR forms.
- Reverify the environment (`pac org who`) before any write/publish/import.
- Do not edit `src/generated/**`. Do not reintroduce CLI/build steps into the user-facing README path.
- Preserve delegated identity and user-scoped authorization; no secrets, no direct DB clients, no non-Power-Platform hosting.

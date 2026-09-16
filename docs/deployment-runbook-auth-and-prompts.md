# Deployment & Verification Runbook — Auth Continuity + Dynamic Per-Form Prompts

This runbook takes the two shipped features from a validated local branch to **running and
verified inside a live Dynamics 365 environment**, with a rollback path. It is written to be
followed step by step with no guesswork.

**What is being deployed.** Both features live entirely in two model-driven **web resources**:

- `maftagsc_/copilot/agentSidePane.html` (the pane shell + bundled runtime)
- `maftagsc_/copilot/agentSidePane.js` (the form launcher)

There is **no Dataverse schema change**, **no new table or column**, and **no change to the
administration Code App**. The dynamic-prompt catalog is bundled inside `agentSidePane.js`
(`promptCatalog.ts`), so it deploys as part of the web resource — nothing else to provision.

> Because only web resources change, deployment = **update two web resources + publish**. This is
> the lowest-risk change class in Power Platform.

---

## Contoso - Dev: one command (pinned)

For the reference environment **Contoso - Dev**, the entire deploy is captured in a committed script
so it never has to be rediscovered:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy-contoso-dev.ps1   # add -Rebuild if you changed any .ts source
```

It pins the identity (**pac auth profile [5] → `admin@M365x61645866.onmicrosoft.com`**, env
`org8599b1c0.crm.dynamics.com`, solution **AgentSidecarCore**), then exports → swaps the two copilot
web resources → repacks → imports with publish → verifies `modifiedon`. It uses **pac's own token**;
do **not** use `az` (your corp identity is not a member of the Contoso tenant, so `az` mints the wrong
token). The manual routes below remain valid for other environments.

---

## 0. Prerequisites

| Requirement | Why | Check |
|---|---|---|
| Power Platform CLI (`pac`) | Auth + web-resource update/publish | `pac --version` |
| System Administrator (or maker with solution write) on the target environment | Update + publish web resources | Admin center / `pac org who` |
| The Agent Sidecar (or HR reference) solution already imported | The web resources exist to update | Solution list in make.powerapps.com |
| Node 18+ and this repo on branch `feature/auth-refresh-and-dynamic-prompts` | Rebuild artifacts locally | `node --version`, `git branch --show-current` |
| GitHub account with a fork (optional, for the PR) | Push + open PR upstream | — |

> **Environment topology observed in this workspace (2026-09-14).** A read-only scan of the
> signed-in `pac auth` profiles found a state you must reconcile **before** deploying:
> - The app's configured environment (`power.config.json` → `f9b87f8b-0abf-e629-affb-b13195d1ed14`,
>   "Agent Sidecar") is **not reachable** under any authenticated `pac` profile.
> - The only reachable environment that already hosts a sidecar solution is **Contoso - Dev**
>   (`https://org8599b1c0.crm.dynamics.com/`), which contains **`AgentSidecarCore`** (unmanaged).
>   Its environment id (`f93f07d8-…`) does **not** match `power.config.json`.
> - This repo's packaged solution under `solution/` is **`HRAgentSidecar`** (the HR reference app) —
>   **not** `AgentSidecarCore`. Do **not** blindly re-import the whole repo solution into that env.
> - Publisher: unique name `agentsidecar`, customization prefix `maftagsc`.
>
> **Action:** confirm the intended target environment and `pac auth create --environment <URL>` to it
> if it is not already a profile, then deploy **only the two changed web resources** via a route below.
>
> **Update (target confirmed 2026-09-14):** the stakeholder selected **HLS Sandbox**
> (`https://hlssandbox.crm.dynamics.com/`, env `6cc6488b-2960-eea4-ab77-0adaa7bf3a13`, `pac` profile
> `[1]`). A read-only scan shows HLS Sandbox has **no** sidecar solution yet, so this is a **greenfield
> install** (solution import + Code App push + config), not a two-file update — see **Appendix B** for
> the confirmed facts, the two inputs still required (target agent + Entra app registration), and the
> turnkey sequence.

---

## 1. Pre-flight — prove the build is green locally

Run from the repo root. **All must pass before you deploy.**

```powershell
node model-driven/build.mjs                      # rebuild + sync solution web resources
npx tsc --project model-driven/tsconfig.json     # model-driven typecheck
node --test model-driven/build.test.mjs          # 13 tests, 0 fail
npm run typecheck                                 # root typecheck
npm run lint                                       # eslint, 0 warnings
npx vitest run tests/model-driven/sidecar-configuration.test.ts --testTimeout=180000
```

Expected: model-driven tests report `pass 13 / fail 0`; typecheck and lint exit 0; the targeted
vitest reports `15 passed`.

> The full `npm test` (vitest) run passes 41/41; two discovery-heavy `src/App.test.tsx` cases only
> exceed the 5 s default timeout on a CPU-starved machine — raise with `--testTimeout=180000` if
> needed. They are environmental, not regressions.

After `node model-driven/build.mjs`, confirm the deployable copies were refreshed:

```powershell
# The pane runtime (auth refresh + prompt catalog) compiles into agentSidePane.html:
Select-String -Path solution\WebResources\maftagsc_\copilot\agentSidePane.html `
  -Pattern "applyPromptCatalog","ssoSilent","Reconnect" | Measure-Object   # expect >= 3 matches
# The form launcher (UPN -> loginHint) compiles into agentSidePane.js:
Select-String -Path solution\WebResources\maftagsc_\copilot\agentSidePane.js `
  -Pattern "loginHint","userName"
```

All must be present — they prove the new auth-refresh, SSO, and prompt-catalog code is in the
artifacts you are about to ship.

---

## 2. Phase A — GitHub fork & pull request (optional but recommended)

You do not own `martycarreras-psnl/CustomAgentMDA`, so pushing requires **your** fork.

```powershell
# 1) Create the fork on github.com (UI), or with the GitHub CLI:
gh auth login
gh repo fork martycarreras-psnl/CustomAgentMDA --clone=false

# 2) Add your fork as a remote and push the feature branch:
cd C:\VSCodeProjects\the-sidecar-app\CustomAgentMDA
git remote add fork https://github.com/<your-user>/CustomAgentMDA.git
git push -u fork feature/auth-refresh-and-dynamic-prompts

# 3) Open the PR against upstream main:
gh pr create --repo martycarreras-psnl/CustomAgentMDA `
  --base main --head <your-user>:feature/auth-refresh-and-dynamic-prompts `
  --title "Auth continuity + dynamic per-form prompts" `
  --body "Silent token refresh + SSO + reconnect; bundled role-aware prompt catalog. See docs/agent-sidecar-auth-continuity-and-dynamic-prompts.md and docs/presentation."
```

Attach the deck (`docs/presentation/index.html`) in the PR description.

---

## 3. Phase B — deploy the web resources to the environment

Pick **one** route. Route 1 (`pac`) is the most surgical.

> **Names below reflect our reference environment (Contoso-Dev): `agentSidePane.html` /
> `agentSidePane.js` in the `AgentSidecarCore` solution.** If you started from **Marty's repo**, your
> environment instead registers **`hrAgentSidePane.html` / `hrAgentSidePane.js`** in the
> **`HRAgentSidecar`** solution, and the build emits `agentSidePane.*` whose *content* you upload into
> those `hr…`-named resources. See **`docs/customer-implementation-guide.md` §4.0** for the exact
> mapping, then substitute your environment's actual names wherever this runbook says `agentSidePane.*`.

### Authenticate first

```powershell
pac auth create --environment <ENVIRONMENT_URL>     # e.g. https://org.crm.dynamics.com
pac org who                                          # confirm you're on the right org
```

> **CLI note (verified in this workspace, 2026-09-14).** `pac webresource …` is **not a command** in
> the installed CLI version — `pac` exposes `solution`, `package`, `pcf`, `tool`, … but **no
> `webresource` noun**. The `pac webresource update` commands in "Route 1" below **will not run** here.
> Use **Route 1a (maker portal)** — the simplest, lowest-risk path — or **Route 2 (solution import)**.

### Route 1a — maker portal (recommended; no CLI, no packaging)

1. Sign in to https://make.powerapps.com and select the **target environment** (see the topology note
   in §0 — confirm the right one first).
2. **Solutions** → open the solution that owns the pane web resources (e.g. `AgentSidecarCore`).
3. Open web resource **`maftagsc_/copilot/agentSidePane.html`** → **Upload file** →
   `solution\WebResources\maftagsc_\copilot\agentSidePane.html` → **Save**.
4. Repeat for **`maftagsc_/copilot/agentSidePane.js`**.
5. **Publish all customizations.**

Two files, ~2 minutes, no packaging risk. This is the recommended route because the installed CLI has
no `webresource` command.

### Route 1 — update the two web resources directly (surgical) — *only if your `pac` has the command*

```powershell
# Update the pane shell + launcher in place, then publish.
pac webresource update `
  --file solution\WebResources\maftagsc_\copilot\agentSidePane.html `
  --name maftagsc_/copilot/agentSidePane.html
pac webresource update `
  --file solution\WebResources\maftagsc_\copilot\agentSidePane.js `
  --name maftagsc_/copilot/agentSidePane.js
pac solution publish            # publish all customizations so users get the new resources
```

> If your `pac` version scopes web-resource commands to a solution, add
> `--solution-name AgentSidecarCore` (or the solution that owns these web resources in your env).

### Route 2 — re-import the solution (when you prefer solution ALM)

> **Caution (see §0 topology).** The unpacked solution under `solution/` is **`HRAgentSidecar`**. If
> your target environment runs a **different** solution (e.g. `AgentSidecarCore` in Contoso - Dev),
> do **not** pack and import `solution/` wholesale — you would import the wrong solution. Either use
> **Route 1a** (upload the two web resources into the solution the env actually uses), or build a
> minimal **patch solution** (publisher `agentsidecar` / prefix `maftagsc`) that contains *only*
> `maftagsc_/copilot/agentSidePane.html` and `.js`, then `pac solution import --publish-changes`.

1. Repack the solution that contains the web resources (the unpacked source is under `solution/`):
   ```powershell
   pac solution pack --zipfile .\AgentSidecar-updated.zip --folder .\solution --packagetype Unmanaged
   ```
2. Import in make.powerapps.com → **Solutions → Import**, or:
   ```powershell
   pac solution import --path .\AgentSidecar-updated.zip --publish-changes
   ```

Either route ends with a **publish** so the new `agentSidePane.html/.js` are live.

### No configuration change needed

These features read values that already exist in your sidecar configuration
(`maftagsc_sidecarconfiguration` / `maftagsc_targetbinding`). You do **not** need to re-run the
administration wizard. SSO uses the signed-in Dynamics user's UPN automatically.

---

## 4. Phase C — live verification (the proof it works)

Open any supported form (HR reference: Time Off Request, Expense Report, Benefit Plan) in the
model-driven app and expand the sidecar pane.

### 4.1 Dynamic per-form prompts

| # | Step | Expected result |
|---|---|---|
| 1 | Open a **Time Off Request** record, expand the pane | A chip bar appears above the input with "Submit this request" and "Check remaining balance" |
| 2 | Click a chip | Its text is sent to the agent **with the current form/record context** (the agent answers about *this* record) |
| 3 | Navigate to an **Expense Report** record | Chips change to "Add an expense line", "What's reimbursable?", "Submit for approval" |
| 4 | Navigate to a form with no catalog entry (e.g. Position) | No chip bar (graceful — never an empty box) |
| 5 | Sign in as a user **with** the Manager role, open Time Off Request | The "Approve requests" (Manager-gated) chip is **visible** |
| 6 | Sign in as a user **without** Manager, open the same form | The "Approve requests" chip is **hidden** |

> Steps 5–6 prove role-aware filtering end to end. Roles come from `CurrentUserRoles` in the context
> envelope; the match is case-insensitive.

### 4.2 Auth continuity (no mid-session re-auth)

| # | Step | Expected result |
|---|---|---|
| 1 | Open the pane fresh | Conversation starts as the signed-in user; **no interactive prompt** if the Dynamics Entra session is valid (SSO `loginHint`) |
| 2 | Open DevTools → Application → check no access token is written to console/URL/storage | Confirms delegated identity is preserved (guardrail) |
| 3 | Keep the session open past the access-token lifetime (~60–90 min) — or shorten token lifetime in a test tenant to force it | The chat keeps working; the token is **silently refreshed** ~5 min before expiry; the transcript is preserved (no blank pane, no re-login) |
| 4 | Force an interaction-required state (revoke/step-up via Conditional Access in a test tenant) | An inline **"Reconnect"** chip appears; clicking it re-establishes the conversation and preserves history |

> To exercise step 3 quickly, set a short **access-token lifetime** with an Entra token-lifetime
> policy in a **non-production** tenant, then watch the pane refresh without user action.

### 4.3 Regression smoke (from `model-driven/README.md`)

Re-run the existing side-pane smoke test (open Benefit Plan → ask "What is this screen for?" →
navigate across forms; conversation preserved, context updates). Nothing there should have changed.

---

## 5. Rollback

Web resources are versioned by publish. To revert:

- **Route 1:** re-run `pac webresource update` with the previous `agentSidePane.html/.js` (from
  `git show main:solution/WebResources/...`), then `pac solution publish`; or
- **Route 2:** re-import the prior solution zip and publish.

Because there is no schema change, rollback is a pure web-resource republish — instantaneous and safe.

---

## 6. Definition of done (10/10)

- [ ] Section 1 pre-flight all green (13 model-driven tests, typecheck, lint).
- [ ] `applyPromptCatalog`/`ssoSilent` present in the shipped `agentSidePane.html`; `loginHint` in `agentSidePane.js`.
- [ ] Web resources updated + **published** to the target environment.
- [ ] 4.1 prompts verified — chips per form + role gating (Manager visible/hidden).
- [ ] 4.2 auth verified — silent refresh across token expiry + reconnect chip on interaction-required.
- [ ] 4.3 regression smoke passes.
- [ ] (Optional) PR opened upstream with the deck attached.

---

## Appendix — where each behavior lives (for reviewers)

| Behavior | File |
|---|---|
| Capture `expiresOn`, silent refresh scheduler, reconnect | `model-driven/webresources/maftagsc_/copilot/agentSidePane.ts` |
| Refresh-delay math (pure, unit-tested) | `.../copilot/tokenRefresh.ts` |
| SSO `loginHint` from Dynamics UPN | `.../copilot/agentSidePaneLauncher.ts`, `.../copilot/authRedirect.ts` |
| Prompt model + role filter (`getBindingPrompts`) | `.../copilot/sidecarConfiguration.ts` |
| Bundled prompt catalog + merge (`applyPromptCatalog`) | `.../copilot/promptCatalog.ts` |
| Merge applied to Dataverse **and** bootstrap configs | `.../copilot/agentSidePane.ts` (after `getByAppId`) |
| Chip bar markup + styles | `.../copilot/agentSidePane.template.html` |
| Tests (13) | `model-driven/build.test.mjs` |

---

## Appendix B — HLS Sandbox greenfield install (target confirmed 2026-09-14)

The stakeholder confirmed **HLS Sandbox** as the deployment target. A read-only `pac` scan shows this
is a **first-time (greenfield) install**, not the two-file web-resource update Routes 1/1a/2 above
assume — HLS Sandbox does **not** yet contain any sidecar solution or web resources.

### B.1 Confirmed environment facts

| Fact | Value |
|---|---|
| Environment | **HLS Sandbox** |
| Org URL | `https://hlssandbox.crm.dynamics.com/` |
| Environment ID | `6cc6488b-2960-eea4-ab77-0adaa7bf3a13` |
| `pac auth` profile | `[1] thompsonkyle@microsoft.com` (a **user** profile — required for `pac code push`) |
| Sidecar solution present? | **No** — none of the 11 solutions is sidecar / `maftagsc` / `AgentSidecarCore` / `HRAgentSidecar` |

Because it is greenfield, importing this repo's `HRAgentSidecar` solution here **is** appropriate
(unlike Contoso - Dev, which already runs a *different* solution — see the §0 caution). The import
creates the web resources, the binding tables (`maftagsc_sidecarconfiguration`,
`maftagsc_targetbinding`), the model-driven app, the publisher (`agentsidecar` / prefix `maftagsc`)
and the security roles in one step.

### B.2 Two inputs still required from the app owner (decisions, not steps)

1. **Which Copilot Studio agent should the sidecar surface?** HLS Sandbox already has six published
   agents — pick one (or name a new one). The pane binds to the Dataverse `bot` row by id:

   | Agent (bot) | Copilot / bot id |
   |---|---|
   | Smooth Operator bot | `6459535b-3455-f111-bec7-000d3a342252` |
   | Careflow | `8e6f6f87-9f53-f111-bec7-000d3a342f6d` |
   | AI Heatmap Assessment Generator | `8c6e96dc-1c43-f111-88b5-000d3a342a36` |
   | HLS AI Heatmap Assessment | `96c593e9-9ce3-47d9-9315-45b123e78b74` |
   | CSAM Incentive Program Finder | `d1e77642-8254-f111-bec7-000d3a34270d` |
   | Copilot in Power Apps - AI Heatmap Admin | `733f1c5c-021d-f111-8341-000d3a342340` |

2. **Entra app registration for the Code App / delegated auth.** `power.config.json` currently carries
   `appId 71d3fa20-9990-4622-9775-11b56f2ed893` ("Agent Sidecar"), bound to the *original* (unreachable)
   environment. For HLS Sandbox, confirm either (a) that same app registration is valid in this tenant
   **and** registered as an **Application User** in HLS Sandbox with a security role, or (b) create a new
   registration per `.github/instructions/00-environment-setup.instructions.md` (Step 1) and use its
   client id. Delegated per-user identity (the entire auth-continuity story) depends on this being right.

### B.3 Turnkey install sequence (run once the B.2 inputs are confirmed)

```powershell
cd C:\VSCodeProjects\the-sidecar-app\CustomAgentMDA

# 0) Target the environment (profile [1] is already HLS Sandbox — a user profile, needed for code push)
pac auth select --index 1
pac org who        # expect Org URL https://hlssandbox.crm.dynamics.com/

# 1) Import the solution (greenfield: creates web resources + tables + model-driven app in one step)
#    If you only have unpacked source under .\solution, pack first:
#      pac solution pack --zipfile .\solution\solution-unmanaged.zip --folder .\solution --packagetype Unmanaged
pac solution import --path .\solution\solution-unmanaged.zip --publish-changes --activate-plugins true

# 2) Repoint the Code App config to HLS Sandbox, then push the Code App into the solution.
#    Edit power.config.json:
#      environmentId -> 6cc6488b-2960-eea4-ab77-0adaa7bf3a13
#      appId         -> <confirmed HLS app-registration client id>   (see B.2 #2)
npm run build
pac code push -s "HRAgentSidecar"      # -s = solution UNIQUE name; REQUIRED on the FIRST push

# 3) Seed sidecar configuration (maker portal or data import):
#    - one maftagsc_sidecarconfiguration row (app-level config; references the chosen bot/agent)
#    - maftagsc_targetbinding rows mapping each entity/form (e.g. opportunity, incident) to that agent
#    The bundled prompt catalog (promptCatalog.ts) supplies the chips with NO schema change.

# 4) Publish + verify
pac solution publish
#    then run §4 live verification (prompt chips, role gating, silent refresh, reconnect)
```

> **Auth note (from `00-environment-setup.instructions.md`).** `pac code push` requires a **user**
> profile — profile `[1] thompsonkyle@microsoft.com` qualifies; a service-principal profile would be
> rejected by the BAP checkAccess API. Get `-s "HRAgentSidecar"` right on the *first* push — a bare
> push silently creates the app **outside** the solution and cannot be retro-associated (recovery =
> delete and re-push with `-s`).

### B.4 Why this was not executed autonomously

A greenfield install **mutates a real Dataverse environment** (solution import + Code App push + config
records) and depends on the two B.2 inputs that only the app owner can supply: **which agent** to
surface (six candidates, none obviously "the" sidecar agent) and a **valid Entra app registration** for
HLS Sandbox. Proceeding on a guess would risk a broken or mis-wired install — pointing at the wrong
agent, or failing delegated auth. With those two inputs confirmed, B.3 is a ~15-minute turnkey run.

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

## 0. Prerequisites

| Requirement | Why | Check |
|---|---|---|
| Power Platform CLI (`pac`) | Auth + web-resource update/publish | `pac --version` |
| System Administrator (or maker with solution write) on the target environment | Update + publish web resources | Admin center / `pac org who` |
| The Agent Sidecar (or HR reference) solution already imported | The web resources exist to update | Solution list in make.powerapps.com |
| Node 18+ and this repo on branch `feature/auth-refresh-and-dynamic-prompts` | Rebuild artifacts locally | `node --version`, `git branch --show-current` |
| GitHub account with a fork (optional, for the PR) | Push + open PR upstream | — |

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

Attach the deck (`docs/presentation/AgentSidecar-Auth-and-Prompts-Deck.html`) in the PR description.

---

## 3. Phase B — deploy the web resources to the environment

Pick **one** route. Route 1 (`pac`) is the most surgical.

### Authenticate first

```powershell
pac auth create --environment <ENVIRONMENT_URL>     # e.g. https://org.crm.dynamics.com
pac org who                                          # confirm you're on the right org
```

### Route 1 — update the two web resources directly (surgical)

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

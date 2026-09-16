# Customer Implementation Guide

## Agent Sidecar — Silent Auth Continuity + Dynamic Role-Aware Prompts

This guide is the **precise, step-by-step path** for landing the two enhancements into your own
copy of the Agent Sidecar and deploying them to your Dynamics 365 / Dataverse environment. It is
written for a team that started from Marty's repository (`martycarreras-psnl/CustomAgentMDA`),
**forked or cloned it**, and works in **VS Code + GitHub**.

Everything is already built, tested, and packaged as **PR #3**. Your work is **review → merge →
build → deploy → verify** — not re-implementation.

---

## 0. At a glance

| | |
|---|---|
| **What ships** | Feature 1: silent token refresh + reconnect (keeps the agent alive for a full work session). Feature 2: form-specific, role-aware suggested-prompt chips. |
| **Where the code is** | Branch `feature/auth-refresh-and-dynamic-prompts` on the fork `walkthenose75/CustomAgentMDA-1`, open as **PR #3** → upstream `martycarreras-psnl/CustomAgentMDA`. |
| **Identity model** | Unchanged — delegated (per-user). No new interactive sign-in surface. |
| **The one schema change** | A single **additive column** `maftagsc_prompts` (multiline text, max 100,000) on the **existing** `maftagsc_sidecarconfiguration` table. **No new table.** Needed only for admin-authored prompt overrides — the runtime works without it. |
| **Deploy surface** | Web resources (`agentSidePane.js` / `.html`) + the one column + (optional) the admin Code App. |
| **Rollback** | Republish the previous web resources. The column is additive and non-destructive. |

### Prerequisites

| Need | Why | Check |
|---|---|---|
| **Git** + a GitHub account with your fork | Pull the branch / review PR #3 | `git --version` |
| **Node.js LTS** (18+) and **pnpm** | Build the web resources and run the test baseline | `node -v`, `pnpm -v` |
| **VS Code** + **GitHub Pull Requests** extension | Review PR #3 inline | — |
| **Power Platform CLI** (`pac`) | Authenticate + deploy to Dataverse | `pac --version` |
| **System Customizer / System Administrator** on the target environment | Import solution, add the column, publish web resources | `pac org who` |
| An **Entra app registration** valid for the target environment | The pane's delegated MSAL sign-in | Entra admin center |

> This repo uses **pnpm** (`pnpm-lock.yaml`). All commands below use `pnpm`; `npm` equivalents work
> too (`npm install`, `npm run <script>`).

---

## 1. Get the code into your repository

Pick the track that matches how you started. Commands are copy-paste-ready.

### Track A — You **forked** Marty's repo (recommended when upstream will merge)

**A1. If/after PR #3 is merged upstream** (Marty or an upstream maintainer clicks merge), just sync
your fork with upstream:

```bash
# one-time: register upstream
git remote add upstream https://github.com/martycarreras-psnl/CustomAgentMDA.git

# sync your fork's main with the merged upstream
git fetch upstream
git checkout main
git merge upstream/main          # fast-forward once PR #3 is in upstream/main
git push origin main
```

> Or use the GitHub UI: open your fork → **Sync fork** → **Update branch**.

**A2. If you don't want to wait for upstream**, pull the feature branch straight from the source fork
(see Track B — the remote/fetch steps are identical for a fork).

### Track B — You **cloned** Marty's repo, or want the change **now** (before upstream merges)

```bash
# 1) register the fork that carries the change
git remote add sidecar https://github.com/walkthenose75/CustomAgentMDA-1.git

# 2) fetch just the feature branch
git fetch sidecar feature/auth-refresh-and-dynamic-prompts

# 3) check it out as a local branch to review/build
git checkout -b sidecar-auth-prompts sidecar/feature/auth-refresh-and-dynamic-prompts
```

When you're satisfied, merge it into your working line:

```bash
git checkout main
git merge --no-ff sidecar-auth-prompts
# resolve any conflicts (unlikely — the change is additive), then:
git push origin main
```

### Track C — Apply as a reviewable **patch** (cleanest audit trail)

```bash
# requires GitHub CLI (gh) authenticated to your account
gh pr diff 3 --repo martycarreras-psnl/CustomAgentMDA --patch > sidecar-auth-prompts.patch
git checkout -b sidecar-auth-prompts
git apply --3way sidecar-auth-prompts.patch      # or: git am < sidecar-auth-prompts.patch
```

> The public patch URL also works without `gh`:
> `https://github.com/martycarreras-psnl/CustomAgentMDA/pull/3.patch`

---

## 2. Review the change in VS Code

1. Install the **GitHub Pull Requests and Issues** extension.
2. Open the **GitHub** view → **Pull Requests** → open **PR #3**.
3. Review the diff inline. The change is **additive** and concentrated in:
   - **Silent auth:** `model-driven/webresources/maftagsc_/copilot/tokenRefresh.ts`,
     `agentSidePane.ts`, `authRedirect.ts`, and the launcher (UPN → `loginHint` plumbing).
   - **Prompts:** `promptCatalog.ts`, `sidecarConfiguration.ts`, `sidecarConfigurationRepository.ts`,
     `src/lib/sidecar-prompts.ts`, and the admin editor `src/components/SidecarPromptsEditor/`.
   - **Schema:** `solution/Entities/maftagsc_sidecarconfiguration/Entity.xml` — the new
     `maftagsc_prompts` column.

---

## 3. Build & verify locally (the green baseline)

```bash
pnpm install

# App + shared libraries
pnpm typecheck
pnpm test
pnpm lint
pnpm build

# Model-driven web resources (compiles agentSidePane.ts -> agentSidePane.js, incl. auth + prompts)
pnpm build:model-driven
pnpm test:model-driven
pnpm typecheck:model-driven
```

What this proves before you touch an environment:

- `build:model-driven` produces the **deployable** `agentSidePane.js` / `.html` (this is what you ship).
- `test:model-driven` exercises the pure token-refresh timing math and the prompt merge/serialization.
- `pnpm test` covers the admin app, including graceful degradation when the `maftagsc_prompts` column
  is absent.

---

## 4. Deploy to your Dataverse environment

### 4a. Authenticate

```bash
pac auth create --environment https://YOURORG.crm.dynamics.com
pac org who        # confirm you're pointed at the intended environment
```

### 4b. Apply the one schema change — the `maftagsc_prompts` column

> **When you need this:** only if you want admins to **author/override** prompts from the in-app
> editor. The bundled catalog renders prompts with **no** schema change, and the repository degrades
> gracefully if the column is missing. If you're happy with the shipped catalog, you can skip to 4c.

**Option 1 — Solution import (recommended; the column travels with the solution).**
The column is defined in `solution/Entities/maftagsc_sidecarconfiguration/Entity.xml`. Import the
solution that owns your sidecar in the target environment (e.g. `AgentSidecarCore`), then publish.
See §4c Route 2 for the pack/import commands.

**Option 2 — Add the column manually (fastest, no packaging).**
1. Go to **make.powerapps.com** → your environment → **Tables** → **Sidecar Configuration**
   (`maftagsc_sidecarconfiguration`).
2. **+ New column** with these **exact** values:
   - **Display name:** `Suggested prompts (JSON)`
   - **Name (logical):** `maftagsc_prompts`
   - **Data type:** **Multiple lines of text** — **Maximum character count: 100000**
3. **Save**, then **Publish**.

### 4c. Deploy the web resources (silent auth + prompts runtime)

The compiled `agentSidePane.js` / `.html` carry **both** features. Choose one route.

**Route 1 — Maker portal (lowest risk, no CLI surprises):**
1. **make.powerapps.com** → **Solutions** → open the solution that owns the pane
   (e.g. `AgentSidecarCore`).
2. Open **Web resources** → `maftagsc_/copilot/agentSidePane.js` → **Upload file** →
   select your freshly built `model-driven/.../agentSidePane.js` → **Save**.
3. Repeat for `agentSidePane.html` (and the launcher, if changed).
4. **Publish all customizations.**

**Route 2 — Solution import (repeatable / CI-friendly):**
```bash
# pack the unmanaged solution folder to a zip, then import + publish
pac solution pack   --zipfile .\AgentSidecar-updated.zip --folder .\solution --packagetype Unmanaged
pac solution import --path .\AgentSidecar-updated.zip --publish-changes
```

> **CLI note:** some `pac` versions do **not** expose the `webresource` noun. If
> `pac webresource update` errors with "not a command," use **Route 1** or **Route 2** — both are
> fully supported.

### 4d. (Optional) Deploy the admin app for authoring prompts

If your team will use the in-app editor to author prompts (which writes JSON to `maftagsc_prompts`):

```bash
# -s = solution UNIQUE name; required on the first push into a new environment
pac code push -s "AgentSidecarCore"
```

### 4e. Publish

Finish with **Publish all customizations** (portal) or `--publish-changes` (CLI) so users get the new
resources immediately.

---

## 5. Verify (acceptance checklist)

Open an **Incident Reports** or **Incident Process** form in the model-driven app and confirm:

- [ ] The side pane opens and the agent responds (delegated identity — answers respect your permissions).
- [ ] **Prompt chips render** above the chat box, and they are **role-filtered** (a chip scoped to a role only shows for users in that role).
- [ ] Clicking a chip **sends its text with the record context attached** (the agent answers about *this* record).
- [ ] **Silent auth:** leave the pane open across the token lifetime (~60–90 min). The conversation **persists with no `401`**; the transcript is preserved. In the worst case a one-click **"Reconnect"** chip resumes the **same** conversation.
- [ ] **Admin authoring (if you added the column):** edit prompts in the admin app → the change appears on the form's chips (authored prompts win over the bundled catalog).

---

## 6. Rollback

- **Web resources:** re-upload the previous `agentSidePane.js` / `.html` (retrieve with
  `git show main:solution/WebResources/maftagsc_/copilot/agentSidePane.js`) and **Publish** — instant
  and safe.
- **Column:** `maftagsc_prompts` is **additive and non-destructive**. Leave it in place (harmless when
  unused) or remove it after exporting any authored prompt data. Removing it does not affect the
  bundled-catalog runtime.

---

## 7. Ongoing development (GitHub + VS Code)

- **Guardrails auto-load.** `.github/instructions/20-agent-sidecar-auth-and-prompts.instructions.md`
  is path-scoped, so Copilot in VS Code applies the auth/prompt non-negotiables automatically when
  those files are open.
- **Start from the index.** `AuthPromptPlan.md` (repo root) is the handoff map — status, file anchors,
  verify commands, and an extension backlog.
- **Extend, don't rebuild.** Issue specs in `docs/handoff/` are ready for the Copilot coding agent
  (telemetry, configurable skew, admin-authoring polish).

---

## Appendix A — File & change map

| Area | Files | Change |
|---|---|---|
| Silent auth (timing) | `model-driven/webresources/maftagsc_/copilot/tokenRefresh.ts` | New pure module: `computeRefreshDelayMs` (refresh at expiry − 5 min skew, 30 s floor, `null` when lifetime unknown). |
| Silent auth (wiring) | `agentSidePane.ts`, `authRedirect.ts`, launcher | Capture `expiresOn`; schedule silent refresh; hot-swap the token into the live conversation without losing the transcript; retry transient failures; inline "Reconnect" chip; UPN → `loginHint` / `ssoSilent`. |
| Prompts (catalog) | `promptCatalog.ts` | Bundled single-source-of-truth catalog keyed by entity logical name (incl. `contoso_incidentreport`, `contoso_incidentprocess`); zero-schema fallback. |
| Prompts (runtime) | `sidecarConfiguration.ts`, `sidecarConfigurationRepository.ts` | Config model + role filtering; reads `maftagsc_prompts` (selected separately; degrades gracefully if absent). |
| Prompts (serialization) | `src/lib/sidecar-prompts.ts` | JSON boundary: max 6 prompts/table, label ≤ 60, text ≤ 400, role list, key `^[a-z][a-z0-9_]*$`. |
| Prompts (admin UI) | `src/components/SidecarPromptsEditor/`, providers, hooks | In-app editor that persists authored prompts to `maftagsc_prompts`. |
| **Schema** | `solution/Entities/maftagsc_sidecarconfiguration/Entity.xml` | **One additive column** `maftagsc_prompts` (`ntext`, 100,000). No new table. |

## Appendix B — Related docs

- `docs/deployment-runbook-auth-and-prompts.md` — the deep operational runbook (routes, topology notes,
  greenfield install appendix, verification, rollback).
- `docs/copilot-studio-agent-instructions.md` — instructions for the Copilot Studio agent that answers
  questions over the Incident tables via a Dataverse MCP server.
- `docs/presentation/` — the technical design & delivery dossier (visual walkthrough of both features).

---

*Delegated identity preserved · no new sign-in surface · one additive config column · no new table.*

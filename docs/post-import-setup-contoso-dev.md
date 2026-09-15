# Agent Sidecar — Post‑Import Setup Guide (Contoso‑Dev)

**Target environment:** Contoso ‑ Dev
`https://org8599b1c0.crm.dynamics.com` · Environment ID `f93f07d8-7d47-ea58-95b8-d71772175b0b` · Tenant `211793ba-f563-4e53-9d36-f7ce619eda41`

**Solution package:** `solution-core/AgentSidecarCore_1_0_0_3.zip` (unmanaged)

> **Import is step 1 of 4.** Importing the solution installs the runtime, config tables, and admin
> app — but the sidecar stays dark until you (2) create an Entra app registration, (3) create a
> sidecar configuration record, and (4) register the launcher on the forms you want. This guide is
> the turnkey path for all four.

---

## 0. What v1.0.0.3 fixes

The earlier `AgentSidecarCore_1_0_0_2.zip` was **missing `authRedirect.html`** — the same‑origin MSAL
redirect page the interactive sign‑in popup navigates to. Without it, the *first* sign‑in to the
agent can't complete (the silent refresh loop only helps *after* an initial token exists).
**v1.0.0.3 adds `authRedirect.html` as a fourth web resource** (`maftagsc_/copilot/authRedirect.html`),
so delegated auth works end‑to‑end. Always import **v1.0.0.3**.

---

## 1. Import the solution

Maker portal → select **Contoso ‑ Dev** → **Solutions → Import solution → Browse** →
`AgentSidecarCore_1_0_0_3.zip` → **Next → Import** → then **Publish all customizations**.

*Prereq:* the environment must have **Copilot Studio** (the Code App references the `bot` table; the
solution declares this as a MissingDependency that resolves automatically where Copilot Studio exists).

---

## 2. Entra app registration (delegated auth) — deliverable (a)

The pane runs MSAL.js (SPA / auth‑code + PKCE) and acquires a **delegated** token for the Power
Platform API scope `CopilotStudio.Copilots.Invoke`, using the user's existing Dynamics/Entra session.
That needs one app registration with a **SPA redirect** at the sidecar's `authRedirect.html` and the
delegated permission **admin‑consented**.

### Option A — programmatic (recommended)

```powershell
# 1) Sign Azure CLI into Contoso-Dev
az login --tenant M365x61645866.onmicrosoft.com --use-device-code --allow-no-subscriptions

# 2) Run the provisioning script (creates SPA app + PP API delegated scope + admin consent)
./solution-core/create-sidecar-app-registration.ps1 `
    -OrgUrl "https://org8599b1c0.crm.dynamics.com" `
    -DisplayName "Agent Sidecar - Delegated Auth (Contoso-Dev)"
```

The script prints the `clientId` you need in step 3.

### Option B — portal (manual)

1. **Entra admin center → App registrations → New registration.**
   - Name: `Agent Sidecar - Delegated Auth (Contoso-Dev)`
   - Supported account types: **Accounts in this organizational directory only**
   - Platform: **Single‑page application (SPA)**, Redirect URI:
     `https://org8599b1c0.crm.dynamics.com/WebResources/maftagsc_/copilot/authRedirect.html`
2. **API permissions → Add a permission → APIs my organization uses →** search **Power Platform API**
   → **Delegated permissions** → check **`CopilotStudio.Copilots.Invoke`** → Add.
3. **Grant admin consent** for the directory.
4. Copy the **Application (client) ID** → that's `clientId` below.

---

## 3. Create the sidecar configuration record — deliverable (b)

The pane reads its config **by model‑driven app id** (`sidecarConfigurationRepository.getByAppId`).
Create one **`maftagsc_sidecarconfiguration`** record (via the installed **Agent Sidecar** admin app,
or directly on the table) using these values. Fields are validated strictly by
`assertSidecarConfiguration`, so match the shapes exactly.

| Field | Value for Contoso‑Dev | Where it comes from |
|---|---|---|
| `appId` | *(your model‑driven app id)* | make.powerapps.com → **Apps** → the app (Sales Hub, Customer Service Hub…) → **Details → App ID** |
| `enabled` | `true` | — |
| `paneId` | `maftagsc_agent_sidecar` | any stable id (a‑z/underscore) |
| `paneTitle` | `Agent Sidecar` | display name of the pane |
| `paneWidth` | `420` | integer 300–1000 |
| `webResourceName` | `maftagsc_/copilot/agentSidePane.html` | fixed (must end `.html`) |
| `iconWebResource` | `WebResources/maftagsc_/copilot/agentGuideLibrary.svg` | fixed |
| `clientId` | `1ae88e3c-3dd4-4132-9dbd-04df09381575` | app registration Application (client) ID — **already created in Contoso‑Dev** ("Agent Sidecar - Delegated Auth (Contoso-Dev)") |
| `tenantId` | `211793ba-f563-4e53-9d36-f7ce619eda41` | Contoso‑Dev tenant |
| `environmentId` | `f93f07d8-7d47-ea58-95b8-d71772175b0b` | Contoso‑Dev environment id |
| `agentSchemaName` | *(your agent schema name)* | Copilot Studio → agent → **Settings → Advanced / Metadata** (e.g. `cr123_myAgent`) |
| `agentConnectionString` | `https://f93f07d87d47ea5895b8d71772175b.0b.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/<agentSchemaName>/conversations?api-version=2022-03-01-preview` | host is derived from the env id; put your agent schema name in the `bots/<…>/` segment |
| `scope` | `https://api.powerplatform.com/CopilotStudio.Copilots.Invoke` | fixed |
| `redirectPath` | `/WebResources/maftagsc_/copilot/authRedirect.html` | fixed (must start `/WebResources/`) |
| `contextLabel` | `Contoso Dev` | any label |
| `defaultScreenName` | `Record form` | any label |
| `entityBindings` | one entry per form, e.g. `opportunity`, `incident` | see below |

**Entity bindings** (which forms show the sidecar). Each key is the table logical name:

```jsonc
{
  "opportunity": { "logicalName": "opportunity", "screenName": "Opportunity form" },
  "incident":    { "logicalName": "incident",    "screenName": "Case form" }
}
```

> Prompts are **not** authored here — see §5. The bundled catalog supplies role‑aware chips
> automatically for known entities.

**The agent must be Dataverse‑backed + authenticated.** In Copilot Studio, open the agent →
**Settings → Security → Authentication** = *Authenticate with Microsoft* (Entra), and ensure it's
published. That's what makes the `…/dataverse-backed/authenticated/bots/…` connection valid.

---

## 4. Register the launcher on your forms

The launcher web resource exposes `AgentSidecar.initializeGuide`, which opens the pane on form load.
For each form where you want the sidecar (Opportunity, Case, etc.):

1. Open the form in the **form designer** → **Form libraries** → **Add library** →
   `maftagsc_/copilot/agentSidePane.js`.
2. **Form properties → Event Handlers → Form → OnLoad → + Event Handler:**
   - Library: `maftagsc_/copilot/agentSidePane.js`
   - Function: `AgentSidecar.initializeGuide`
   - ✔ **Pass execution context as first parameter** *(required)*
3. **Save → Publish.**

The pane only opens on tables listed in `entityBindings`; other forms are silently skipped.

---

## 5. About prompts (answer: they're not in the Code App wizard)

The dynamic, role‑aware suggested‑prompt **chips are driven entirely at runtime** by the bundled
catalog **`model-driven/webresources/maftagsc_/copilot/promptCatalog.ts`** — the single source of
truth. They are **not** authored in the Code App wizard (the admin app authors app/table bindings,
not prompts) and require **no Dataverse schema change**. At runtime `applyPromptCatalog()` merges the
catalog over both the Dataverse‑backed config and the bootstrap fallback, filters by the signed‑in
user's security roles, and renders up to 6 chips for the current form.

**To change prompts today:** edit `promptCatalog.ts`, run `node model-driven/build.mjs`, and redeploy
the `agentSidePane.html` web resource. A future enhancement (documented in the design doc §3.4) would
add a `maftagsc_prompts` column to `maftagsc_targetbinding` and a wizard editor — but that's a schema
change and isn't needed for prompts to work.

---

## 6. Verify (proof it works)

- Open a bound form (**Opportunity**) → the **Agent Sidecar** pane opens with **form‑specific chips**;
  a chip whose role you lack is hidden.
- Keep the pane open past the access‑token lifetime → the conversation **keeps working** (silent
  refresh) — no re‑auth prompt mid‑Dynamics session.
- Force a hard auth failure → an inline **Reconnect** chip appears and resumes the same conversation.

---

## Rollback

Re‑import `solution-core/AgentSidecarCore.zip` (v1.0.0.1), or delete the **AgentSidecarCore** solution.
Deleting removes the tables/web resources/Code App but not any Copilot Studio agent.

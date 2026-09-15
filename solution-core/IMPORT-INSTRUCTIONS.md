# Manual Import — AgentSidecarCore v1.0.0.2

**Package:** `AgentSidecarCore_1_0_0_2.zip` (unmanaged Power Platform solution)
**Adds:** auth continuity (silent token refresh + SSO + inline reconnect) and dynamic, role-aware
per-form prompt chips — the two enhancements from PR #3.

---

## What's in it

| Component | Notes |
|---|---|
| Tables | `maftagsc_sidecarconfiguration`, `maftagsc_targetbinding` (+ 2 option sets) |
| Web resources | **`agentSidePane.html`** (pane runtime — the updated one), `agentSidePane.js` (launcher), `agentGuideLibrary.svg` |
| Code App | the **Agent Sidecar** admin/config app (type 300) |
| Plugin + custom API | `HRAgentSidecar.TokenBroker` + `maftagsc_GetDirectLineToken` (legacy DirectLine broker; **unused** by the delegated-identity pane, kept for baseline parity) |

Only **three** entries changed vs the baseline `AgentSidecarCore.zip`: `solution.xml` (version 1.0.0.1 →
1.0.0.2), `agentSidePane.html`, and `agentSidePane.js`. The Code App bundle, plugin DLL, tables, custom
API, and `customizations.xml` are **byte-identical** to the baseline (verified by SHA-256).

## Prerequisites in the target environment

- A Dataverse environment with **Copilot Studio / bot** capability (the Code App references the `bot`
  table — this dependency resolves automatically in any environment that has Copilot Studio).
- Rights to import solutions (**System Administrator** or **System Customizer**).
- The publisher **Agent Side Car** (prefix `maftagsc`) is created on import.

## Import — choose one route

### Route A — maker portal (simplest)

1. Go to https://make.powerapps.com and select the **target environment**.
2. **Solutions → Import solution → Browse** → choose `AgentSidecarCore_1_0_0_2.zip`.
3. **Next → Import**. Wait for "import succeeded."
4. **Publish all customizations** (Solutions → ⋯ → *Publish all customizations*).

### Route B — pac CLI

```powershell
# If the target isn't already an auth profile:
pac auth create --environment https://YOURORG.crm.dynamics.com/
pac auth select  --environment https://YOURORG.crm.dynamics.com/
pac org who      # confirm you're on the intended org

pac solution import --path .\AgentSidecarCore_1_0_0_2.zip --publish-changes --activate-plugins true
```

## After import — wire the sidecar to an agent (required)

The pane surfaces a Copilot Studio agent on specific forms, so it needs configuration records:

1. **Pick the agent** the sidecar should surface (a `bot` in your environment).
2. Create one **`maftagsc_sidecarconfiguration`** record (app-level config that references that agent),
   and one or more **`maftagsc_targetbinding`** records mapping each entity/form (e.g. Opportunity,
   Case) to the agent. Easiest: open the **Agent Sidecar** admin Code App this solution installs and
   author the bindings there.
3. Make sure the side-pane launcher (`maftagsc_/copilot/agentSidePane.js`) opens the pane on those
   forms in your model-driven app.

Dynamic prompt chips render automatically from the bundled catalog (**no schema change**); role-aware
filtering uses the signed-in user's security roles.

## Verify (the proof it works)

- Open a configured form (e.g. **Opportunity**) → open the sidecar → **form-specific prompt chips**
  appear; a chip whose role you lack is hidden.
- Keep the pane open past the access-token lifetime → the conversation **keeps working** (silent
  refresh) — no re-auth prompt mid-Dynamics-session.
- Force a hard auth failure → an inline **Reconnect** chip appears and resumes the same conversation
  (not a blank pane).

## Notes

- The **Code App** (admin UI) authenticates with Entra ID; in a **new tenant** it may need its own app
  registration / publish before it will play — see `docs/deployment-runbook-auth-and-prompts.md`
  Appendix B.2 and `.github/instructions/00-environment-setup.instructions.md`. The **pane features do
  not depend on the Code App** — they live entirely in the web resources.
- **Rollback:** re-import the baseline `AgentSidecarCore.zip` (v1.0.0.1), or delete the solution.

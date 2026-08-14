# HR Management App Guide side pane

This folder contains the source for the Model-driven App side-pane vertical slice.
The deployable Dataverse copies are created as web resources in the
`HRAgentSidecar` solution and then pulled back into `solution/` by solution export.

## Component contract

- HTML web resource: `maftagsc_/copilot/agentSidePane.html`
- JavaScript web resource: `maftagsc_/copilot/agentSidePane.js`
- Stable pane ID: `maftagsc_hr_management_app_guide`
- Authentication: Microsoft Entra delegated authorization code flow with PKCE
- Delegated scope: `https://api.powerplatform.com/CopilotStudio.Copilots.Invoke`
- Agent client: Microsoft 365 Agents SDK `CopilotStudioClient`
- Form OnLoad entry point: `AgentSidecar.initializeGuide` (with a `HRAgentSidecar.initializeGuide` alias for the existing HR reference forms) with execution context
- Supported main forms: Benefit Plan, Benefit Enrollment, Expense Line, Expense
   Report, Time Off Balance, Time Off Request, and Time Off Type
- Initial presentation: persistent and collapsed (`canClose: false`,
   `isSelected: false`, `alwaysRender: true`)

The side pane uses five non-secret configuration values: Application (client)
ID, Directory (tenant) ID, Power Platform environment ID, Copilot Studio agent
schema name, and the Microsoft 365 Agents SDK direct-connect URL. The generic
runtime resolves an enabled configuration by the current Model-driven App ID
and passes the saved URL to `ConnectionSettings.directConnectUrl`, including
for GHCP harness agentic-runtime endpoints. Invalid configured URLs fail closed
instead of falling back to the SDK's legacy generated endpoint. The current HR
values remain in `hrSidecarBootstrap.ts` as a compatibility bridge. No client
secret is created or shipped, and MSAL tokens use memory storage only.

## Build

The maintained conversation source is `agentSidePane.ts`, the form launcher
source is `agentSidePaneLauncher.ts`, and `agentSidePane.template.html`
provides the accessible shell. Both TypeScript entries use the same app-keyed
configuration repository. Build and type-check them from the repository root:

```text
pnpm run typecheck:model-driven
pnpm run build:model-driven
```

The build bundles MSAL Browser and the Agents SDK directly into
`agentSidePane.html`, compiles the launcher into `agentSidePane.js`, then
synchronizes both deployable solution projections. Do not edit either generated
web resource directly.

The app-keyed compatibility runtime was deployed in place to the existing
`HRAgentSidecar` development solution on 2026-07-10 after explicit project-owner
approval. Any later import or publish still requires target-environment
confirmation and the repository's deployment safeguards.

## Side-pane smoke test

1. Open a saved Benefit Plan in the **HR Management** Model-driven App.
2. Confirm the library icon is present in the collapsed side-pane switcher and
   that no **HR Management App Guide** command appears on the command bar.
3. Select the library icon and confirm the guide pane opens.
4. If prompted, select **Sign in** and complete Microsoft sign-in/consent.
5. Confirm the conversation starts as the signed-in user and that no access token
   is written to the console, URL, or storage.
6. Ask “What is this screen for?” and verify Benefit Plan help is used.
7. Ask “What process should I follow before making this plan active?” and verify
   Benefits Administration process guidance is included.
8. Navigate through each supported main form and confirm the same pane remains
   available, the conversation is preserved, and the current page context updates.
# Use config-driven, role-aware prompts for dynamic per-form suggestions

**Status:** accepted

The sidecar will present **form-specific, role-aware suggested prompts** (e.g. Opportunity prompts on
the Opportunity form, Case prompts on the Case form). The prompt catalog is owned by the administrator
and authored in the Code App wizard, not by the agent. Each `SidecarEntityBinding` gains an optional
`prompts` array of `{ label, text, roles? }`; the runtime reads the current binding on load and on
navigation, filters by `CurrentUserRoles`, and renders chips above the Web Chat input. Clicking a chip
sends its `text` through the existing wrapped `postActivity`, so the full form/record context envelope
(`entityName`, `recordName`, `CurrentUserRoles`) rides along.

The catalog persists as a **JSON blob in existing sidecar configuration** (read by
`sidecarConfigurationRepository.ts`), deliberately avoiding a new Dataverse table so no plugin-gated
schema provisioning is required for v1. Defaults are seeded from
`docs/entity-help/entity-help-manifest.json`.

## Alternatives considered

- **Agent-driven prompts (Option B):** a Copilot Studio topic triggered on context change branches on
  `entityName` and emits Suggested Actions or an Adaptive Card. This allows dynamic/generative prompts
  and reuse of agent logic, but requires Copilot Studio authoring and an agent publish cycle to change
  prompts, and is harder to govern per security role from configuration. It remains a valid future
  option; if pursued, route authoring to the Copilot Studio Author agent. A hybrid (config seeds
  defaults, agent may override) is a later possibility.

## Consequences

Prompts can be changed by editing configuration in the Code App — no agent redeploy. The list is
declarative, role-aware, and unit-testable. Because prompts are static admin-authored text, generative
or highly dynamic suggestions are not covered in v1 and would require Option B. Delegated identity and
the same-origin sign-in handshake are unaffected; no Dataverse schema change is introduced.

# Issue spec — Dynamic Form Prompts for the Agent Sidecar

> Paste this into a GitHub issue (title + body) and assign it to `@copilot`, or use it as an
> interactive prompt in Copilot CLI / VS Code. Context: `AuthPromptPlan.md` §4. **Keep this issue
> separate from the auth issue** — the two ship independently.

**Title:** Dynamic, role-aware suggested-prompt chips for the Agent Sidecar

**Labels:** `enhancement`, `agent-sidecar`, `prompts`

---

## Context
Surface form-specific, role-aware suggested-prompt chips above the Web Chat input; clicking a chip sends
its text through the existing wrapped `postActivity` so record/form context rides along. A reference
implementation (config-driven, "Option A" + in-app authoring "Option C") already exists on branch
`feature/auth-refresh-and-dynamic-prompts` (PR #3). This issue is to **adopt/verify/extend** it.

## How prompts resolve (must preserve)
1. **Bundled catalog** — `promptCatalog.ts` (`SIDECAR_PROMPT_CATALOG`), compiled into `agentSidePane.js`,
   provides defaults in every deployment with **no schema change**.
2. **Authored record** — JSON on `maftagsc_sidecarconfiguration.maftagsc_prompts`, keyed by table logical
   name, written by the admin app (`SidecarPromptsEditor`).
3. `applyPromptCatalog()` backfills only bindings that lack prompts, so **authored/binding prompts win**.

## Scope / acceptance criteria
- [ ] Chip bar renders above the Web Chat input (`agentSidePane.template.html` + `agentSidePane.ts`),
      keyed by the current table logical name.
- [ ] Chips are filtered by `CurrentUserRoles` (`sidecarUserRoles.ts`).
- [ ] Clicking a chip routes through the existing wrapped `postActivity` (record context included).
- [ ] Runtime reads the optional `maftagsc_prompts` column with a **graceful missing-column retry**
      (`sidecarConfigurationRepository.ts`).
- [ ] Admin app authors prompts per table on the detail page (`SidecarPromptsEditor` in
      `SidecarDetails.tsx`); `savePrompts` persists via `real-sidecar-admin-provider.ts`.
- [ ] All (de)serialization goes through `src/lib/sidecar-prompts.ts` (≤ 6/table; label ≤ 60; text ≤ 400;
      role ≤ 100; keys match `/^[a-z][a-z0-9_]*$/`).

## Optional extension (only if asked)
- Per-**form** prompts (key by `systemform` id) in addition to per-table.
- Author prompts inside `SidecarWizard`; chip-usage analytics; label/text localization.
- A dedicated `maftagsc_targetbinding.prompts` column **only** if the JSON blob is outgrown (schema
  change → regenerates read-only `src/generated`; see ADR 0007).

## Non-negotiable constraints
- **No new Dataverse table/column for v1** — persist the JSON blob on `maftagsc_prompts` (ADR 0007).
- `src/generated/**` read-only; Fluent UI v9; HashRouter; `DataverseFieldLabel` for any new
  Dataverse-bound editable field (`09-form-field-pattern.instructions.md`).
- Guardrails auto-load from `.github/instructions/20-agent-sidecar-auth-and-prompts.instructions.md`.

## Anchors
Runtime: `sidecarConfiguration.ts`, `promptCatalog.ts` (`applyPromptCatalog`),
`sidecarConfigurationRepository.ts` (`parseAuthoredPrompts`), `sidecarUserRoles.ts`,
`agentSidePane.template.html`, `agentSidePane.ts`. Admin: `SidecarPromptsEditor.tsx`,
`SidecarDetails.tsx`, `lib/sidecar-prompts.ts`, `services/real-sidecar-admin-provider.ts`,
`types/sidecar-admin-models.ts`.

## Test plan
```
npm run typecheck && npm test && npm run lint && npm run build
npm run build:model-driven && npm run test:model-driven
```
Manual: open a `contoso_incidentreport` / `contoso_incidentprocess` form in Contoso-Dev → open the pane →
chips render → click one → agent answers with record context. Edit in the admin app
(`/sidecars/:id` → Prompts → Save) and re-check the pane.

## Reference data (already live on Contoso-Dev)
Config record `75b20c59-38b1-f111-aaac-000d3a314f6d` ("Incident Reports - Sales Knowledge Agent") has 6
authored prompts each for `contoso_incidentreport` and `contoso_incidentprocess` on `maftagsc_prompts`.

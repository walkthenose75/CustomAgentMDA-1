---
applyTo: "model-driven/webresources/maftagsc_/copilot/**,src/components/SidecarPromptsEditor/**,src/components/SidecarDetails/**,src/lib/sidecar-prompts.ts,src/services/real-sidecar-admin-provider.ts,src/types/sidecar-admin-models.ts"
---

# Agent Sidecar — Auth Continuity & Dynamic Prompts (Guardrails)

These rules are **non-negotiable** for any change to the Agent Sidecar's silent-auth loop or its
suggested-prompt feature. Full context: `AuthPromptPlan.md` (repo root) and
`docs/agent-sidecar-auth-continuity-and-dynamic-prompts.md`.

## Authentication (side pane)
1. **Preserve the localStorage sign-in handshake.** Never reintroduce `acquireTokenPopup` or an MSAL
   redirect-bridge — Dynamics COOP headers break popups and hidden iframes.
2. **Preserve delegated identity.** Never revive the disabled DirectLine token broker
   (`maftagsc_GetDirectLineToken`); the agent must answer as the signed-in user, not a service identity.
3. Silent refresh renews through the cached rotating refresh token (CORS POST) — not an iframe.
4. Keep token-lifetime math **pure and import-free** in `tokenRefresh.ts` so it stays unit-testable;
   MSAL / Web Chat wiring stays in `agentSidePane.ts`.
5. To apply a refreshed token, **rebuild the `CopilotStudioClient`/connection reusing the same
   `conversationId` and preserving the Web Chat `store`.** The SDK has no token-setter; do not reset the chat.
6. On unrecoverable auth failure, render the inline **Reconnect** chip that resumes the same
   conversation — never leave a blank pane.

## Dynamic prompts
7. **All** prompt (de)serialization goes through the single boundary `src/lib/sidecar-prompts.ts`
   (admin app) and `sidecarConfigurationRepository.ts` (runtime). Keep both in agreement on shape.
8. Respect the limits: **≤ 6 prompts per table**, label ≤ 60 chars, text ≤ 400, role ≤ 100; catalog keys
   must match `/^[a-z][a-z0-9_]*$/` (table logical name, lowercase).
9. Persist prompts as a **JSON blob** on `maftagsc_sidecarconfiguration.maftagsc_prompts`. Do **not**
   add a new Dataverse table/column for v1 (see ADR 0007) — schema changes are plugin-gated and
   regenerate the read-only `src/generated`.
10. Authored/binding prompts **take precedence** over the bundled `SIDECAR_PROMPT_CATALOG`;
    `applyPromptCatalog()` only backfills bindings that lack their own prompts. Keep it pure (no mutation).
11. Filter chips by `CurrentUserRoles` via `sidecarUserRoles.ts`. Clicking a chip must route through the
    existing wrapped `postActivity` so record/form context is included.

## Both features
12. `src/generated/**` is **read-only**. Code App UI: Fluent UI v9 only, HashRouter, three-layer
    architecture; every new editable Dataverse-bound field uses `DataverseFieldLabel`
    (see `09-form-field-pattern.instructions.md`).
13. Keep the green baseline passing: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`,
    `npm run build:model-driven`, `npm run test:model-driven`, `npm run typecheck:model-driven`.

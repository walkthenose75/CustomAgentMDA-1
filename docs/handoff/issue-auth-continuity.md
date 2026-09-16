# Issue spec — Silent Auth Continuity for the Agent Sidecar

> Paste this into a GitHub issue (title + body) and assign it to `@copilot`, or use it as an
> interactive prompt in Copilot CLI / VS Code. Context: `AuthPromptPlan.md` §3. **Keep this issue
> separate from the dynamic-prompts issue** — the two ship independently.

**Title:** Silent auth continuity for the Agent Sidecar (proactive refresh + SSO hint + reconnect)

**Labels:** `enhancement`, `agent-sidecar`, `auth`

---

## Context
The delegated MSAL access token is captured once in `renderConversation()` and never refreshed, so the
side-pane agent 401s ~60–90 min into a Dynamics session and forces the user to re-authenticate. A
reference implementation already exists on branch `feature/auth-refresh-and-dynamic-prompts` (PR #3);
this issue is to **adopt/verify** it, or **re-create** it if working clean-room. All files are under
`model-driven/webresources/maftagsc_/copilot/`.

## Scope / acceptance criteria
- [ ] `acquireToken()` captures the token's `expiresOn`.
- [ ] A scheduler refreshes the delegated token **~5 min before expiry** using `acquireTokenSilent`
      (via `computeRefreshDelayMs` in `tokenRefresh.ts`); a transient failure retries **before** giving up.
- [ ] The refreshed token is applied to the **live** conversation by rebuilding the
      `CopilotStudioClient`/connection while **reusing the same `conversationId` and preserving the Web
      Chat `store`** — the chat is not reset and history is not lost.
- [ ] The Dynamics UPN (`userSettings.userName`) is captured in `agentSidePaneLauncher.ts` and used as the
      MSAL `loginHint`; `ssoSilent`/silent is attempted before any interactive step.
- [ ] On `InteractionRequiredAuthError` (after the transient retry), an inline **"Session expired —
      Reconnect"** chip appears and resumes the **same** conversation.

## Non-negotiable constraints
- Keep the localStorage sign-in handshake; **no** `acquireTokenPopup` / redirect-bridge (Dynamics COOP).
- Keep **delegated** identity; **do not** revive the DirectLine token broker (`maftagsc_GetDirectLineToken`).
- Token-lifetime math stays pure/import-free in `tokenRefresh.ts`.
- Guardrails auto-load from `.github/instructions/20-agent-sidecar-auth-and-prompts.instructions.md`.

## Anchors
`tokenRefresh.ts` (`computeRefreshDelayMs`, `TOKEN_REFRESH_SKEW_MS`, `MIN_TOKEN_REFRESH_DELAY_MS`) ·
`agentSidePane.ts` (`acquireToken`, `renderConversation`, scheduler, reconnect chip) ·
`agentSidePaneLauncher.ts` (UPN capture) · `authRedirect.ts` / `authRedirect.html`.

## Test plan
```
npm run typecheck:model-driven
npm run build:model-driven
npm run test:model-driven      # covers computeRefreshDelayMs + loginHint plumbing
```
Manual: leave the pane idle past token expiry → conversation still works (no re-auth); force an expiry
→ Reconnect chip resumes the thread.

## Out of scope
Dynamic prompts (separate issue); any Dataverse schema change; reviving the token broker.

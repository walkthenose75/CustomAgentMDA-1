import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const sourceRoot = new URL("./webresources/maftagsc_/copilot/", import.meta.url);
const solutionRoot = new URL("../solution/WebResources/maftagsc_/copilot/", import.meta.url);

async function read(root, name) {
    return readFile(new URL(name, root), "utf8");
}

test("generated side pane uses the registered scope and dedicated popup redirect", async () => {
    const html = await read(sourceRoot, "agentSidePane.html");

    assert.match(html, /https:\/\/api\.powerplatform\.com\/CopilotStudio\.Copilots\.Invoke/);
    assert.doesNotMatch(html, /api\.powerplatform\.com\/CopilotStudio\.Invoke/);
    assert.match(html, /\/WebResources\/maftagsc_\/copilot\/authRedirect\.html/);
    assert.match(html, /cr0b1_HRMgmtClassic/);
    assert.doesNotMatch(html, /Default_HR_Management_App_Guide_9e5461/);
    assert.match(html, /pvaSetContext/);
    assert.match(html, /HR Management app/);
    assert.match(html, /CurrentAppId/);
    assert.match(html, /CurrentPageType/);
    assert.match(html, /CurrentRecordId/);
    assert.match(html, /CurrentUserRoles/);
    assert.match(html, /signed-in user holds these roles/);
    assert.match(html, /Benefit Plan record form/);
    assert.match(html, /Segoe UI Web \(West European\)/);
    assert.match(html, /primaryFont/);
    assert.match(html, /getPageContext/);
    assert.match(html, /WEB_CHAT\/SEND_MESSAGE/);
    assert.match(html, /entitylist/);
    assert.match(html, /New conversation/);
    assert.match(html, /The current chat history will be cleared/);
    assert.match(html, /cacheLocation:"localStorage"/);
    assert.doesNotMatch(html, /hrAgentContext/);
    assert.equal((html.match(/<!doctype html>/gi) ?? []).length, 1);
});

test("library icon is used by the persistent collapsed side pane", async () => {
    const launcher = await read(sourceRoot, "agentSidePane.js");
    const launcherSource = await read(sourceRoot, "agentSidePaneLauncher.ts");
    const icon = await read(sourceRoot, "agentGuideLibrary.svg");

    assert.match(launcherSource, /imageSrc: configuration\.iconWebResource/);
    assert.match(launcher, /WebResources\/maftagsc_\/copilot\/agentGuideLibrary\.svg/);
    assert.match(launcherSource, /canClose: false/);
    assert.match(launcherSource, /isSelected: false/);
    assert.match(launcherSource, /alwaysRender: true/);
    assert.match(launcherSource, /sidecarConfigurationRepository\.getByAppId/);
    assert.match(launcherSource, /window\.AgentSidecar\.initializeGuide = initialize/);
    assert.match(launcherSource, /window\.HRAgentSidecar\.initializeGuide = initialize/);
    assert.doesNotMatch(launcher, /pane\.select\(\)|HRAgentSidecar\.openGuide/);
    assert.match(icon, /viewBox="0 0 24 24"/);
    assert.match(icon, /currentColor/);
    assert.doesNotMatch(icon, /<script|#[0-9a-f]{3,8}/i);
});

test("all HR Management main forms register the collapsed guide on load", async () => {
    const forms = [
        "maftagsc_benefitplan/FormXml/main/{8259c4dd-99fb-4ae1-9e31-f8d251570bc4}.xml",
        "maftagsc_benefitenrollment/FormXml/main/{0807331f-493b-4372-a7ce-21ea0d2120e3}.xml",
        "maftagsc_expenseline/FormXml/main/{93c8d348-0bb7-467e-8735-4d63ae3e576e}.xml",
        "maftagsc_expensereport/FormXml/main/{19f71f07-879b-4598-96eb-40505794238b}.xml",
        "maftagsc_timeoffbalance/FormXml/main/{8d2ab9b2-6fe9-42c9-aa7a-752595a41783}.xml",
        "maftagsc_timeoffrequest/FormXml/main/{a439b1ff-6702-4f2a-a09b-a13a266a8575}.xml",
        "maftagsc_timeofftype/FormXml/main/{fb8196d8-53d8-43ee-9293-d1c93b2640e8}.xml"
    ];

    for (const form of forms) {
        const xml = await readFile(new URL(`../solution/Entities/${form}`, import.meta.url), "utf8");
        const formXml = xml.slice(xml.indexOf("<form>"), xml.indexOf("</form>") + "</form>".length);
        assert.match(xml, /<Library name="maftagsc_\/copilot\/hrAgentSidePane\.js"/);
        assert.match(xml, /functionName="HRAgentSidecar\.initializeGuide"/);
        assert.match(xml, /passExecutionContext="true"/);
        assert.match(xml, /<event name="onload" application="false" active="true">/);
        assert.match(formXml, /<formLibraries>/);
        assert.match(formXml, /<events>/);
    }
});

test("live page context replaces stale record details before each message", async () => {
    const source = await read(sourceRoot, "agentSidePane.ts");

    assert.match(source, /window\.parent\.Xrm/);
    assert.match(source, /Utility\?\.getPageContext/);
    assert.match(source, /getPrimaryAttributeValue/);
    assert.match(source, /formEntityName !== entityName \|\| formRecordId !== recordId/);
    assert.match(source, /action\.type === "WEB_CHAT\/SEND_MESSAGE"/);
    assert.match(source, /recordName: currentRecordName \?\? \(isSameRecord \? fallback\.recordName : ""\)/);
    assert.match(source, /createContextEnvelope\(currentContext, originalText, configuration\)/);
    assert.match(source, /resolveContext\(activeContext, activeConfiguration\)/);
    assert.match(source, /readSharedContext\(configuration, fallback\)/);
    assert.match(source, /startNavigationWatcher\(store, configuration, context\)/);
    assert.match(source, /await sidecarConfigurationRepository\.getByAppId\(appId\)/);
});

test("signed-in user security roles flow into the agent context", async () => {
    const paneSource = await read(sourceRoot, "agentSidePane.ts");
    const launcherSource = await read(sourceRoot, "agentSidePaneLauncher.ts");
    const rolesSource = await read(sourceRoot, "sidecarUserRoles.ts");

    // Launcher captures role names from the host global context and hands them
    // off through the same-origin localStorage channel (not the URL payload).
    // The documented ItemCollection accessor is get(); getAll()/forEach are
    // supported as fallbacks.
    assert.match(launcherSource, /userSettings\?\.roles/);
    assert.match(launcherSource, /typeof roles\.get === "function"/);
    assert.match(launcherSource, /roles: getUserRoles\(\)/);
    assert.match(launcherSource, /normalizeUserRoles/);

    // Pane parses, reads shared roles, signs on them, and surfaces them in both
    // the pvaSetContext event and the trusted per-message envelope.
    assert.match(paneSource, /roles: normalizeUserRoles\(value\.roles\)/);
    assert.match(paneSource, /parsed\.roles !== undefined \? normalizeUserRoles\(parsed\.roles\) : fallback\.roles/);
    assert.match(paneSource, /context\.roles\.join\(","\)/);
    assert.match(paneSource, /formatUserRolesLine\(context\.roles\)/);
    assert.match(paneSource, /CurrentUserRoles: serializeUserRoles\(context\.roles\)/);
    assert.match(paneSource, /CurrentUserRoles: serializeUserRoles\(next\.roles\)/);

    // Roles are de-duplicated and bounded; only role names are handled.
    assert.match(rolesSource, /MAX_USER_ROLES/);
    assert.match(rolesSource, /MAX_ROLE_NAME_LENGTH/);
    assert.match(rolesSource, /signed-in user holds these roles/);

    // Built artifacts carry the new variable and envelope line.
    const html = await read(sourceRoot, "agentSidePane.html");
    const launcher = await read(sourceRoot, "agentSidePane.js");
    assert.match(html, /CurrentUserRoles/);
    assert.match(html, /signed-in user holds these roles/);
    assert.match(launcher, /getAll/);
});

test("solution projections exactly match maintained web resources", async () => {
    assert.equal(
        await read(solutionRoot, "agentSidePane.html"),
        await read(sourceRoot, "agentSidePane.html")
    );
    assert.equal(
        await read(solutionRoot, "agentSidePane.js"),
        await read(sourceRoot, "agentSidePane.js")
    );
    assert.equal(
        await read(solutionRoot, "agentGuideLibrary.svg"),
        await read(sourceRoot, "agentGuideLibrary.svg")
    );
});

test("authentication redirect completes sign-in via a same-origin localStorage handshake", async () => {
    const html = await read(solutionRoot, "authRedirect.html");

    assert.equal((html.match(/<!doctype html>/gi) ?? []).length, 1);
    assert.doesNotMatch(html, /main\.aspx|window\.open/i);
    assert.match(html, /Completing sign-in/);
    assert.match(html, /handleRedirectPromise/);
    assert.match(html, /acquireTokenRedirect/);
    assert.match(html, /maftagsc\.sidecar\.authResult/);
    assert.doesNotMatch(html, /broadcastResponseToMainFrame/);
    assert.doesNotMatch(html, /HR_AGENT_AUTH_REDIRECT_BUNDLE/);
});

test("token refresh delay is skewed ahead of expiry and clamped to a minimum", async () => {
    // tokenRefresh.ts is import-free pure math, so transform-and-import it and
    // exercise the timing directly rather than asserting on the bundled string.
    const src = await read(sourceRoot, "tokenRefresh.ts");
    const js = (await transform(src, { loader: "ts", format: "esm" })).code;
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    const { computeRefreshDelayMs, TOKEN_REFRESH_SKEW_MS, MIN_TOKEN_REFRESH_DELAY_MS } = mod;

    const now = 1_000_000;
    assert.equal(
        computeRefreshDelayMs(new Date(now + 60 * 60 * 1000), now),
        60 * 60 * 1000 - TOKEN_REFRESH_SKEW_MS
    );
    // Near-expiry and already-expired tokens clamp to the minimum (never negative).
    assert.equal(computeRefreshDelayMs(new Date(now + 1000), now), MIN_TOKEN_REFRESH_DELAY_MS);
    assert.equal(computeRefreshDelayMs(new Date(now - 10_000), now), MIN_TOKEN_REFRESH_DELAY_MS);
    // Unknown lifetime cannot be proactively scheduled.
    assert.equal(computeRefreshDelayMs(null, now), null);
    assert.equal(computeRefreshDelayMs(new Date(Number.NaN), now), null);
});

test("side pane silently refreshes the delegated token and offers a reconnect", async () => {
    const source = await read(sourceRoot, "agentSidePane.ts");

    // Token lifetime is captured and drives a proactive silent-refresh loop.
    assert.match(source, /computeRefreshDelayMs/);
    assert.match(source, /scheduleTokenRefresh\(configuration\)/);
    assert.match(source, /async function refreshActiveToken/);
    assert.match(source, /expiresOn: result\.expiresOn/);
    // A fresh token is swapped in while the transcript (store) is preserved.
    assert.match(source, /activeStore \?\? undefined/);
    // Silent SSO uses the Dynamics login hint before ever prompting.
    assert.match(source, /client\.ssoSilent/);
    assert.match(source, /async function reconnectConversation/);

    // The login hint (Dynamics UPN) is plumbed end to end.
    const launcherSource = await read(sourceRoot, "agentSidePaneLauncher.ts");
    assert.match(launcherSource, /userSettings\?\.userName/);
    assert.match(launcherSource, /upn: getUpn\(\)/);
    const redirectSource = await read(sourceRoot, "authRedirect.ts");
    assert.match(redirectSource, /loginHint: request\.loginHint/);

    // Built artifacts carry the reconnect affordance and the silent-SSO call.
    const html = await read(sourceRoot, "agentSidePane.html");
    assert.match(html, /Reconnect/);
    assert.match(html, /ssoSilent/);
    const launcher = await read(sourceRoot, "agentSidePane.js");
    assert.match(launcher, /userName/);
});

test("form prompts are role-filtered and entity-scoped", async () => {
    const src = await read(sourceRoot, "sidecarConfiguration.ts");
    const js = (await transform(src, { loader: "ts", format: "esm" })).code;
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    const { getBindingPrompts } = mod;

    const configuration = {
        entityBindings: {
            maftagsc_timeoffrequest: {
                logicalName: "maftagsc_timeoffrequest",
                screenName: "Time Off Request record form",
                prompts: [
                    { label: "Everyone", text: "shown to all" },
                    { label: "Managers", text: "manager only", roles: ["Manager"] }
                ]
            }
        }
    };

    // No roles: only the unrestricted prompt is returned.
    const forEmployee = getBindingPrompts(configuration, "maftagsc_timeoffrequest", []);
    assert.equal(forEmployee.length, 1);
    assert.equal(forEmployee[0].label, "Everyone");

    // Role match is case-insensitive, and the entity name is normalized too.
    const forManager = getBindingPrompts(configuration, "MAFTAGSC_TimeOffRequest", ["manager"]);
    assert.equal(forManager.length, 2);

    // Unbound entities yield no prompts.
    assert.equal(getBindingPrompts(configuration, "account", ["Manager"]).length, 0);
});

test("side pane renders role-aware suggested prompt chips per form", async () => {
    const paneSource = await read(sourceRoot, "agentSidePane.ts");
    const configSource = await read(sourceRoot, "sidecarConfiguration.ts");

    // Runtime resolves prompts for the current form and renders/refreshes chips.
    assert.match(paneSource, /getBindingPrompts/);
    assert.match(paneSource, /function renderPrompts/);
    assert.match(paneSource, /renderPrompts\(configuration\)/);
    assert.match(paneSource, /prompt-chip/);
    // Prompts are merged over BOTH the Dataverse and bootstrap configs, so chips
    // appear in a real deployment (where the binding table carries no prompts).
    assert.match(paneSource, /applyPromptCatalog\(await sidecarConfigurationRepository\.getByAppId/);
    // Clicking a chip sends its text through the normal message pipeline.
    assert.match(paneSource, /"WEB_CHAT\/SEND_MESSAGE", payload: \{ text, method: "keyboard" \}/);

    // Config layer validates and role-filters the catalog.
    assert.match(configSource, /export interface SidecarPrompt/);
    assert.match(configSource, /function isValidPrompts/);
    assert.match(configSource, /export function getBindingPrompts/);

    // Seeded HR prompts reach the built artifacts.
    const html = await read(sourceRoot, "agentSidePane.html");
    assert.match(html, /prompt-chip/);
    assert.match(html, /Submit for approval/);
});

test("prompt catalog fills bindings that carry no prompts of their own", async () => {
    const src = await read(sourceRoot, "promptCatalog.ts");
    const js = (await transform(src, { loader: "ts", format: "esm" })).code;
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    const { applyPromptCatalog, SIDECAR_PROMPT_CATALOG } = mod;

    // A Dataverse-shaped binding (no prompts column) gets catalog prompts merged in.
    const bare = {
        appId: "app",
        entityBindings: {
            maftagsc_expensereport: {
                logicalName: "maftagsc_expensereport",
                screenName: "Expense Report record form"
            },
            maftagsc_timeoffbalance: {
                logicalName: "maftagsc_timeoffbalance",
                screenName: "Time Off Balance record form"
            }
        }
    };
    const merged = applyPromptCatalog(bare);
    assert.notEqual(merged, bare, "returns a new configuration when prompts are added");
    assert.deepEqual(
        merged.entityBindings.maftagsc_expensereport.prompts,
        SIDECAR_PROMPT_CATALOG.maftagsc_expensereport
    );
    // Entities absent from the catalog stay untouched (no empty prompt arrays).
    assert.equal(merged.entityBindings.maftagsc_timeoffbalance.prompts, undefined);
    // Input is never mutated.
    assert.equal(bare.entityBindings.maftagsc_expensereport.prompts, undefined);

    // Binding-authored prompts always win over the catalog.
    const authored = {
        appId: "app",
        entityBindings: {
            maftagsc_expensereport: {
                logicalName: "maftagsc_expensereport",
                screenName: "Expense Report record form",
                prompts: [{ label: "Custom", text: "Authored prompt" }]
            }
        }
    };
    const untouched = applyPromptCatalog(authored);
    assert.equal(untouched, authored, "returns the same reference when nothing changes");
    assert.equal(untouched.entityBindings.maftagsc_expensereport.prompts[0].label, "Custom");

    // A role-gated catalog prompt is present for manager review.
    const gated = SIDECAR_PROMPT_CATALOG.maftagsc_timeoffrequest.find(
        (prompt) => Array.isArray(prompt.roles) && prompt.roles.includes("Manager")
    );
    assert.ok(gated, "catalog includes a Manager-gated prompt");
});

test("bootstrap no longer double-sources prompts (catalog is the single source)", async () => {
    const bootstrap = await read(sourceRoot, "hrSidecarBootstrap.ts");
    const catalog = await read(sourceRoot, "promptCatalog.ts");
    assert.doesNotMatch(bootstrap, /Submit for approval/);
    assert.match(catalog, /Submit for approval/);
    assert.match(catalog, /export function applyPromptCatalog/);
});
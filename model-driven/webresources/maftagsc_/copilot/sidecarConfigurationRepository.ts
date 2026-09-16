import {
    normalizeGuid,
    resolveSidecarConfiguration,
    SidecarConfigurationError,
    type SidecarConfiguration,
    type SidecarEntityBinding,
    type SidecarPrompt
} from "./sidecarConfiguration";

const AUTHORED_PROMPT_LOGICAL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

// Base projection for the sidecar configuration record, excluding the optional
// admin-authored prompt catalog. maftagsc_prompts is selected separately so the
// pane can degrade gracefully in environments provisioned before the in-app
// prompt authoring feature shipped (where that column does not yet exist).
const CONFIGURATION_SELECT =
    "maftagsc_sidecarconfigurationid,maftagsc_appid,maftagsc_panetitle,maftagsc_panewidth," +
    "maftagsc_publicclientapplicationid,maftagsc_tenantid,maftagsc_environmentid," +
    "maftagsc_agentschemaname,maftagsc_agentconnectionstring,statecode,statuscode";
const OPTIONAL_PROMPTS_COLUMN = "maftagsc_prompts";

// Selecting a column that does not exist yields a specific property-not-found
// error. Detect it by column name so a missing optional column triggers a retry
// without it, while genuine failures still propagate.
function isMissingColumnError(error: unknown, column: string): boolean {
    const message =
        error && typeof error === "object" && "message" in error
            ? String((error as { message?: unknown }).message ?? "")
            : String(error ?? "");
    return message.toLowerCase().includes(column.toLowerCase());
}

// Parse the admin-authored prompt catalog stored as JSON on
// maftagsc_sidecarconfiguration.maftagsc_prompts, keyed by table logical name.
// Invalid or partial entries are dropped so a bad edit can never break pane
// rendering; applyPromptCatalog still backfills bundled defaults for tables the
// administrator has not customized.
function parseAuthoredPrompts(raw: unknown): Record<string, SidecarPrompt[]> {
    if (typeof raw !== "string" || !raw.trim()) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const catalog: Record<string, SidecarPrompt[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const logicalName = key.trim().toLowerCase();
        if (!AUTHORED_PROMPT_LOGICAL_NAME_PATTERN.test(logicalName) || !Array.isArray(value)) continue;
        const prompts: SidecarPrompt[] = [];
        for (const item of value) {
            if (!item || typeof item !== "object") continue;
            const candidate = item as { label?: unknown; text?: unknown; roles?: unknown };
            const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
            const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
            if (!label || !text) continue;
            const roles = Array.isArray(candidate.roles)
                ? candidate.roles
                    .filter((role): role is string => typeof role === "string")
                    .map((role) => role.trim())
                    .filter((role) => role.length > 0)
                : undefined;
            prompts.push(roles && roles.length ? { label, text, roles } : { label, text });
        }
        if (prompts.length) catalog[logicalName] = prompts;
    }
    return catalog;
}

export interface SidecarConfigurationRepository {
    getByAppId(appId: unknown): Promise<SidecarConfiguration>;
}

export class BootstrapSidecarConfigurationRepository
implements SidecarConfigurationRepository {
    constructor(private readonly configurations: readonly SidecarConfiguration[]) {}

    async getByAppId(appId: unknown): Promise<SidecarConfiguration> {
        return resolveSidecarConfiguration(this.configurations, appId);
    }
}

interface DataverseResult {
    entities: Record<string, unknown>[];
}

interface DataverseWebApi {
    retrieveMultipleRecords(
        entityLogicalName: string,
        options: string,
        maxPageSize?: number
    ): Promise<DataverseResult>;
}

export class DataverseSidecarConfigurationRepository
implements SidecarConfigurationRepository {
    constructor(private readonly getWebApi: () => DataverseWebApi) {}

    async getByAppId(appId: unknown): Promise<SidecarConfiguration> {
        const normalizedAppId = normalizeGuid(appId);
        if (!normalizedAppId) {
            return resolveSidecarConfiguration([], appId);
        }

        const escapedAppId = normalizedAppId.replace(/'/g, "''");
        const configurationFilter = `&$filter=maftagsc_appid eq '${escapedAppId}' and statecode eq 0`;
        const webApi = this.getWebApi();
        let configurationResult;
        try {
            configurationResult = await webApi.retrieveMultipleRecords(
                "maftagsc_sidecarconfiguration",
                `?$select=${CONFIGURATION_SELECT},${OPTIONAL_PROMPTS_COLUMN}${configurationFilter}`,
                2
            );
        } catch (error) {
            if (!isMissingColumnError(error, OPTIONAL_PROMPTS_COLUMN)) {
                throw error;
            }
            configurationResult = await webApi.retrieveMultipleRecords(
                "maftagsc_sidecarconfiguration",
                `?$select=${CONFIGURATION_SELECT}${configurationFilter}`,
                2
            );
        }
        if (configurationResult.entities.length !== 1) {
            return resolveSidecarConfiguration([], appId);
        }

        const record = configurationResult.entities[0];
        const configurationId = normalizeGuid(record.maftagsc_sidecarconfigurationid);
        if (!configurationId) {
            return resolveSidecarConfiguration([], appId);
        }
        const bindingResult = await this.getWebApi().retrieveMultipleRecords(
            "maftagsc_targetbinding",
            `?$select=maftagsc_tablelogicalname,maftagsc_tabledisplayname,maftagsc_enabled&$filter=_maftagsc_sidecarconfiguration_value eq ${configurationId} and statecode eq 0 and maftagsc_enabled eq true`,
            500
        );
        const entityBindings: Record<string, SidecarEntityBinding> = {};
        for (const binding of bindingResult.entities) {
            const logicalName = String(binding.maftagsc_tablelogicalname ?? "").trim().toLowerCase();
            if (!logicalName || entityBindings[logicalName]) continue;
            entityBindings[logicalName] = {
                logicalName,
                screenName: `${String(binding.maftagsc_tabledisplayname ?? logicalName)} record form`
            };
        }

        const authoredPrompts = parseAuthoredPrompts(record.maftagsc_prompts);
        for (const [logicalName, prompts] of Object.entries(authoredPrompts)) {
            if (entityBindings[logicalName]) {
                entityBindings[logicalName] = { ...entityBindings[logicalName], prompts };
            }
        }

        return resolveSidecarConfiguration([{
            appId: normalizedAppId,
            enabled: true,
            paneId: `maftagsc_sidecar_${normalizedAppId.replace(/-/g, "")}`,
            paneTitle: String(record.maftagsc_panetitle ?? "Agent Sidecar"),
            paneWidth: Number(record.maftagsc_panewidth ?? 420),
            webResourceName: "maftagsc_/copilot/agentSidePane.html",
            iconWebResource: "WebResources/maftagsc_/copilot/agentGuideLibrary.svg",
            clientId: String(record.maftagsc_publicclientapplicationid ?? ""),
            tenantId: String(record.maftagsc_tenantid ?? ""),
            environmentId: String(record.maftagsc_environmentid ?? ""),
            agentSchemaName: String(record.maftagsc_agentschemaname ?? ""),
            agentConnectionString: String(record.maftagsc_agentconnectionstring ?? "").trim(),
            scope: "https://api.powerplatform.com/CopilotStudio.Copilots.Invoke",
            redirectPath: "/WebResources/maftagsc_/copilot/authRedirect.html",
            contextLabel: `${String(record.maftagsc_panetitle ?? "Agent Sidecar")} app`,
            defaultScreenName: "Model-driven App record form",
            entityBindings
        }], appId);
    }
}

export class FallbackSidecarConfigurationRepository
implements SidecarConfigurationRepository {
    constructor(
        private readonly primary: SidecarConfigurationRepository,
        private readonly fallback: SidecarConfigurationRepository
    ) {}

    async getByAppId(appId: unknown): Promise<SidecarConfiguration> {
        try {
            return await this.primary.getByAppId(appId);
        } catch (error) {
            const canUseBootstrap =
                error instanceof SidecarConfigurationError &&
                error.errorCode === "sidecar_configuration_not_found";
            if (canUseBootstrap || (error instanceof Error && error.message === "sidecar_dataverse_webapi_unavailable")) {
                return this.fallback.getByAppId(appId);
            }
            throw error;
        }
    }
}

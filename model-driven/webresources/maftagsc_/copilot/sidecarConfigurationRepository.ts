import {
    normalizeGuid,
    resolveSidecarConfiguration,
    SidecarConfigurationError,
    type SidecarConfiguration,
    type SidecarEntityBinding
} from "./sidecarConfiguration";

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
        const configurationResult = await this.getWebApi().retrieveMultipleRecords(
            "maftagsc_sidecarconfiguration",
            `?$select=maftagsc_sidecarconfigurationid,maftagsc_appid,maftagsc_panetitle,maftagsc_panewidth,maftagsc_publicclientapplicationid,maftagsc_tenantid,maftagsc_environmentid,maftagsc_agentschemaname,maftagsc_agentconnectionstring,statecode,statuscode&$filter=maftagsc_appid eq '${escapedAppId}' and statecode eq 0`,
            2
        );
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

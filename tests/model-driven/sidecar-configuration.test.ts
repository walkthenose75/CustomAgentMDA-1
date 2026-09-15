import { describe, expect, it } from "vitest";
import {
    getEntityBinding,
    normalizeGuid,
    resolveSidecarConfiguration,
    SidecarConfigurationError,
    type SidecarConfiguration
} from "../../model-driven/webresources/maftagsc_/copilot/sidecarConfiguration";
import {
    BootstrapSidecarConfigurationRepository,
    DataverseSidecarConfigurationRepository,
    FallbackSidecarConfigurationRepository
} from "../../model-driven/webresources/maftagsc_/copilot/sidecarConfigurationRepository";
import { createSidecarConnectionSettings } from "../../model-driven/webresources/maftagsc_/copilot/sidecarConnectionSettings";

const APP_ID = "62e8fdf6-e77b-f111-ab0e-000d3a34048c";
const SECOND_APP_ID = "11111111-2222-3333-4444-555555555555";

function createConfiguration(
    overrides: Partial<SidecarConfiguration> = {}
): SidecarConfiguration {
    return {
        appId: APP_ID,
        enabled: true,
        paneId: "maftagsc_hr_management_app_guide",
        paneTitle: "HR Management App Guide",
        paneWidth: 420,
        webResourceName: "maftagsc_/copilot/agentSidePane.html",
        iconWebResource: "WebResources/maftagsc_/copilot/agentGuideLibrary.svg",
        clientId: "9d03cd77-5246-4c9c-8e9d-262bff547a25",
        tenantId: "d92190b9-98e7-46da-8b11-580e06c7d15d",
        environmentId: "f9b87f8b-0abf-e629-affb-b13195d1ed14",
        agentSchemaName: "cr0b1_HRMgmtClassic",
        agentConnectionString: "https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cr0b1_HRMgmtClassic/conversations?api-version=2022-03-01-preview",
        scope: "https://api.powerplatform.com/CopilotStudio.Copilots.Invoke",
        redirectPath: "/WebResources/maftagsc_/copilot/authRedirect.html",
        contextLabel: "HR Management app",
        defaultScreenName: "HR Management record form",
        entityBindings: {
            maftagsc_benefitplan: {
                logicalName: "maftagsc_benefitplan",
                screenName: "Benefit Plan record form"
            }
        },
        ...overrides
    };
}

describe("sidecar configuration resolution", () => {
    it("normalizes braced and mixed-case app identifiers", () => {
        expect(normalizeGuid(`{${APP_ID.toUpperCase()}}`)).toBe(APP_ID);
    });

    it("resolves exactly one enabled configuration by Model-driven App ID", () => {
        const configuration = createConfiguration();

        expect(resolveSidecarConfiguration([configuration], APP_ID)).toBe(configuration);
    });

    it("exposes app-keyed resolution through the asynchronous repository contract", async () => {
        const configuration = createConfiguration();
        const repository = new BootstrapSidecarConfigurationRepository([configuration]);

        await expect(repository.getByAppId(APP_ID)).resolves.toBe(configuration);
    });

    it("maps the saved Agents SDK connection string from Dataverse", async () => {
        const queries: string[] = [];
        const repository = new DataverseSidecarConfigurationRepository(() => ({
            async retrieveMultipleRecords(entityLogicalName, options) {
                queries.push(options);
                return entityLogicalName === "maftagsc_sidecarconfiguration"
                    ? {
                        entities: [{
                            maftagsc_sidecarconfigurationid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                            maftagsc_panetitle: "Insights and actions",
                            maftagsc_panewidth: 420,
                            maftagsc_publicclientapplicationid: "9d03cd77-5246-4c9c-8e9d-262bff547a25",
                            maftagsc_tenantid: "d92190b9-98e7-46da-8b11-580e06c7d15d",
                            maftagsc_environmentid: "7d8dcd87-2e21-e805-b9be-678794ecc80b",
                            maftagsc_agentschemaname: "cr88d_insightsandactions_AChDbK",
                            maftagsc_agentconnectionstring: "https://7d8dcd872e21e805b9be678794ecc8.0b.environment.api.powerplatform.com/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/cr88d_insightsandactions_AChDbK?api-version=1"
                        }]
                    }
                    : {
                        entities: [{
                            maftagsc_tablelogicalname: "account",
                            maftagsc_tabledisplayname: "Account",
                            maftagsc_enabled: true
                        }]
                    };
            }
        }));

        const configuration = await repository.getByAppId(APP_ID);

        expect(queries[0]).toContain("maftagsc_agentconnectionstring");
        expect(configuration.agentConnectionString).toBe(
            "https://7d8dcd872e21e805b9be678794ecc8.0b.environment.api.powerplatform.com/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/cr88d_insightsandactions_AChDbK?api-version=1"
        );
    });

    function createPromptAwareRepository(prompts: unknown) {
        return new DataverseSidecarConfigurationRepository(() => ({
            async retrieveMultipleRecords(entityLogicalName) {
                return entityLogicalName === "maftagsc_sidecarconfiguration"
                    ? {
                        entities: [{
                            maftagsc_sidecarconfigurationid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                            maftagsc_panetitle: "Insights and actions",
                            maftagsc_panewidth: 420,
                            maftagsc_publicclientapplicationid: "9d03cd77-5246-4c9c-8e9d-262bff547a25",
                            maftagsc_tenantid: "d92190b9-98e7-46da-8b11-580e06c7d15d",
                            maftagsc_environmentid: "7d8dcd87-2e21-e805-b9be-678794ecc80b",
                            maftagsc_agentschemaname: "cr88d_insightsandactions_AChDbK",
                            maftagsc_agentconnectionstring: "https://7d8dcd872e21e805b9be678794ecc8.0b.environment.api.powerplatform.com/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/cr88d_insightsandactions_AChDbK?api-version=1",
                            maftagsc_prompts: prompts
                        }]
                    }
                    : {
                        entities: [{
                            maftagsc_tablelogicalname: "account",
                            maftagsc_tabledisplayname: "Account",
                            maftagsc_enabled: true
                        }]
                    };
            }
        }));
    }

    it("selects and applies admin-authored prompts onto matching bindings", async () => {
        const configuration = await createPromptAwareRepository(JSON.stringify({
            account: [
                { label: "Summarize", text: "Summarize this account." },
                { label: "Open risks", text: "List open risks.", roles: ["Salesperson"] }
            ]
        })).getByAppId(APP_ID);

        expect(getEntityBinding(configuration, "account")).toEqual({
            logicalName: "account",
            screenName: "Account record form",
            prompts: [
                { label: "Summarize", text: "Summarize this account." },
                { label: "Open risks", text: "List open risks.", roles: ["Salesperson"] }
            ]
        });
    });

    it("ignores authored prompts for logical names without an enabled binding", async () => {
        const configuration = await createPromptAwareRepository(JSON.stringify({
            incident: [{ label: "Unbound", text: "Should not appear." }]
        })).getByAppId(APP_ID);

        expect(getEntityBinding(configuration, "account")).toEqual({
            logicalName: "account",
            screenName: "Account record form"
        });
        expect(getEntityBinding(configuration, "incident")).toBeNull();
    });

    it("tolerates malformed prompt JSON without failing configuration resolution", async () => {
        const configuration = await createPromptAwareRepository("{ not valid json").getByAppId(APP_ID);

        expect(getEntityBinding(configuration, "account")).toEqual({
            logicalName: "account",
            screenName: "Account record form"
        });
    });

    it("drops prompt entries missing a label or text", async () => {
        const configuration = await createPromptAwareRepository(JSON.stringify({
            account: [
                { label: "", text: "no label" },
                { label: "no text", text: "" },
                { label: "Keep", text: "Kept" }
            ]
        })).getByAppId(APP_ID);

        expect(getEntityBinding(configuration, "account")).toEqual({
            logicalName: "account",
            screenName: "Account record form",
            prompts: [{ label: "Keep", text: "Kept" }]
        });
    });

    it("uses only the saved URL for SDK direct-connect settings", () => {
        const directConnectUrl = "https://7d8dcd872e21e805b9be678794ecc8.0b.environment.api.powerplatform.com/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/cr88d_insightsandactions_AChDbK?api-version=1";
        const settings = createSidecarConnectionSettings(createConfiguration({
            environmentId: "7d8dcd87-2e21-e805-b9be-678794ecc80b",
            agentSchemaName: "cr88d_insightsandactions_AChDbK",
            agentConnectionString: directConnectUrl
        }));

        expect(settings.directConnectUrl).toBe(directConnectUrl);
        expect(settings.environmentId).toBeUndefined();
        expect(settings.schemaName).toBeUndefined();
    });

    it("keeps independent agents and pane identities for multiple apps", async () => {
        const hrConfiguration = createConfiguration();
        const secondConfiguration = createConfiguration({
            appId: SECOND_APP_ID,
            paneId: "contoso_service_guide",
            paneTitle: "Service Guide",
            agentSchemaName: "contoso_ServiceAgent",
            agentConnectionString: "https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/contoso_ServiceAgent/conversations?api-version=2022-03-01-preview",
            entityBindings: {
                incident: {
                    logicalName: "incident",
                    screenName: "Case record form"
                }
            }
        });
        const repository = new BootstrapSidecarConfigurationRepository([
            hrConfiguration,
            secondConfiguration
        ]);

        await expect(repository.getByAppId(APP_ID)).resolves.toMatchObject({
            paneId: "maftagsc_hr_management_app_guide",
            agentSchemaName: "cr0b1_HRMgmtClassic"
        });
        await expect(repository.getByAppId(SECOND_APP_ID)).resolves.toMatchObject({
            paneId: "contoso_service_guide",
            agentSchemaName: "contoso_ServiceAgent"
        });
    });

    it("fails closed when the app identifier is absent or invalid", () => {
        expect(() => resolveSidecarConfiguration([createConfiguration()], null))
            .toThrowError(expect.objectContaining<Partial<SidecarConfigurationError>>({
                errorCode: "sidecar_app_id_invalid"
            }));
    });

    it("fails closed when no enabled configuration matches", () => {
        expect(() => resolveSidecarConfiguration([
            createConfiguration({ enabled: false })
        ], APP_ID)).toThrowError(expect.objectContaining<Partial<SidecarConfigurationError>>({
            errorCode: "sidecar_configuration_not_found"
        }));
    });

    it("fails closed when duplicate enabled configurations claim the app", () => {
        expect(() => resolveSidecarConfiguration([
            createConfiguration(),
            createConfiguration()
        ], APP_ID)).toThrowError(expect.objectContaining<Partial<SidecarConfigurationError>>({
            errorCode: "sidecar_configuration_ambiguous"
        }));
    });

    it("fails closed when a matching configuration is malformed", () => {
        expect(() => resolveSidecarConfiguration([
            createConfiguration({ clientId: "not-a-guid" })
        ], APP_ID)).toThrowError(expect.objectContaining<Partial<SidecarConfigurationError>>({
            errorCode: "sidecar_configuration_invalid"
        }));
    });

    it("fails closed instead of deriving a legacy endpoint from an invalid saved URL", () => {
        expect(() => resolveSidecarConfiguration([
            createConfiguration({ agentConnectionString: "https://example.com/not-an-agent" })
        ], APP_ID)).toThrowError(expect.objectContaining<Partial<SidecarConfigurationError>>({
            errorCode: "sidecar_configuration_invalid"
        }));
    });

    it("does not replace an invalid configured URL with a bootstrap fallback", async () => {
        const repository = new FallbackSidecarConfigurationRepository(
            new BootstrapSidecarConfigurationRepository([
                createConfiguration({ agentConnectionString: "https://example.com/not-an-agent" })
            ]),
            new BootstrapSidecarConfigurationRepository([createConfiguration()])
        );

        await expect(repository.getByAppId(APP_ID)).rejects.toMatchObject({
            errorCode: "sidecar_configuration_invalid"
        });
    });

    it("rejects unsafe pane dimensions", () => {
        expect(() => resolveSidecarConfiguration([
            createConfiguration({ paneWidth: 200 })
        ], APP_ID)).toThrowError(expect.objectContaining<Partial<SidecarConfigurationError>>({
            errorCode: "sidecar_configuration_invalid"
        }));
    });

    it("looks up entity bindings case-insensitively", () => {
        expect(getEntityBinding(createConfiguration(), "MAFTAGSC_BENEFITPLAN"))
            .toEqual({
                logicalName: "maftagsc_benefitplan",
                screenName: "Benefit Plan record form"
            });
    });

    it("does not resolve inherited object properties as entity bindings", () => {
        expect(getEntityBinding(createConfiguration(), "toString")).toBeNull();
    });
});

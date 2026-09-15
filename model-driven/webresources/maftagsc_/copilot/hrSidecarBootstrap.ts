import type { SidecarConfiguration, SidecarEntityBinding, SidecarPrompt } from "./sidecarConfiguration";
import {
    BootstrapSidecarConfigurationRepository,
    DataverseSidecarConfigurationRepository,
    FallbackSidecarConfigurationRepository
} from "./sidecarConfigurationRepository";

function entityBinding(
    logicalName: string,
    screenName: string,
    prompts?: readonly SidecarPrompt[]
): SidecarEntityBinding {
    return Object.freeze({
        logicalName,
        screenName,
        prompts: prompts ? Object.freeze(prompts.map((prompt) => Object.freeze({ ...prompt }))) : undefined
    });
}

const HR_ENTITY_BINDINGS = Object.freeze({
    systemuser: entityBinding("systemuser", "Employee record form"),
    position: entityBinding("position", "Position record form"),
    businessunit: entityBinding("businessunit", "Department record form"),
    maftagsc_timeofftype: entityBinding("maftagsc_timeofftype", "Time Off Type record form"),
    maftagsc_timeoffbalance: entityBinding("maftagsc_timeoffbalance", "Time Off Balance record form"),
    maftagsc_timeoffrequest: entityBinding("maftagsc_timeoffrequest", "Time Off Request record form", [
        { label: "Submit this request", text: "How do I submit this time off request for approval?" },
        { label: "Check remaining balance", text: "How much time off balance do I have remaining?" },
        { label: "Approve requests", text: "As a manager, what are the steps to review and approve a time off request?", roles: ["Manager"] }
    ]),
    maftagsc_expensereport: entityBinding("maftagsc_expensereport", "Expense Report record form", [
        { label: "Add an expense line", text: "How do I add a new expense line to this expense report?" },
        { label: "What's reimbursable?", text: "Which expenses on this report are reimbursable under policy?" },
        { label: "Submit for approval", text: "How do I submit this expense report for approval?" }
    ]),
    maftagsc_expenseline: entityBinding("maftagsc_expenseline", "Expense Line record form"),
    maftagsc_benefitplan: entityBinding("maftagsc_benefitplan", "Benefit Plan record form", [
        { label: "Explain this plan", text: "Explain the coverage and eligibility for this benefit plan." },
        { label: "Compare plans", text: "How does this benefit plan compare to the other available plans?" }
    ]),
    maftagsc_benefitenrollment: entityBinding("maftagsc_benefitenrollment", "Benefit Enrollment record form", [
        { label: "How do I enroll?", text: "What are the steps to complete this benefit enrollment?" },
        { label: "Change my election", text: "How do I change my election on this benefit enrollment?" }
    ])
});

const HR_SIDECAR_CONFIGURATION: SidecarConfiguration = Object.freeze({
    appId: "62e8fdf6-e77b-f111-ab0e-000d3a34048c",
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
    entityBindings: HR_ENTITY_BINDINGS
});

// Phase 1 replaces this bootstrap catalog with the runtime configuration repository.
export const SIDECAR_BOOTSTRAP_CONFIGURATIONS: readonly SidecarConfiguration[] = Object.freeze([
    HR_SIDECAR_CONFIGURATION
]);

const bootstrapRepository = new BootstrapSidecarConfigurationRepository(
    SIDECAR_BOOTSTRAP_CONFIGURATIONS
);

export const sidecarConfigurationRepository = new FallbackSidecarConfigurationRepository(
    new DataverseSidecarConfigurationRepository(() => {
        const host = globalThis as typeof globalThis & {
            Xrm?: { WebApi?: { retrieveMultipleRecords: (...args: [string, string, number?]) => Promise<{ entities: Record<string, unknown>[] }> } };
            parent?: { Xrm?: { WebApi?: { retrieveMultipleRecords: (...args: [string, string, number?]) => Promise<{ entities: Record<string, unknown>[] }> } } };
        };
        const webApi = host.Xrm?.WebApi ?? host.parent?.Xrm?.WebApi;
        if (!webApi) throw new Error("sidecar_dataverse_webapi_unavailable");
        return webApi;
    }),
    bootstrapRepository
);

import type {
    SidecarConfiguration,
    SidecarEntityBinding,
    SidecarPrompt
} from "./sidecarConfiguration";

// Single source of truth for the suggested prompts, keyed by entity logical name.
// This catalog is bundled into agentSidePane.js, so form-specific prompts work in
// EVERY deployment — both the Dataverse-backed configuration repository (which does
// not carry a prompts column) and the local bootstrap fallback — without requiring
// a Dataverse schema change. A future admin authoring surface can override this by
// persisting prompts on the binding itself; binding-level prompts always win.
export const SIDECAR_PROMPT_CATALOG: Readonly<Record<string, readonly SidecarPrompt[]>> = Object.freeze({
    maftagsc_timeoffrequest: Object.freeze([
        Object.freeze({ label: "Submit this request", text: "How do I submit this time off request for approval?" }),
        Object.freeze({ label: "Check remaining balance", text: "How much time off balance do I have remaining?" }),
        Object.freeze({
            label: "Approve requests",
            text: "As a manager, what are the steps to review and approve a time off request?",
            roles: Object.freeze(["Manager"])
        })
    ]),
    maftagsc_expensereport: Object.freeze([
        Object.freeze({ label: "Add an expense line", text: "How do I add a new expense line to this expense report?" }),
        Object.freeze({ label: "What's reimbursable?", text: "Which expenses on this report are reimbursable under policy?" }),
        Object.freeze({ label: "Submit for approval", text: "How do I submit this expense report for approval?" })
    ]),
    maftagsc_benefitplan: Object.freeze([
        Object.freeze({ label: "Explain this plan", text: "Explain the coverage and eligibility for this benefit plan." }),
        Object.freeze({ label: "Compare plans", text: "How does this benefit plan compare to the other available plans?" })
    ]),
    maftagsc_benefitenrollment: Object.freeze([
        Object.freeze({ label: "How do I enroll?", text: "What are the steps to complete this benefit enrollment?" }),
        Object.freeze({ label: "Change my election", text: "How do I change my election on this benefit enrollment?" })
    ])
});

function isValidCatalogPrompts(prompts: unknown): prompts is readonly SidecarPrompt[] {
    return Array.isArray(prompts) && prompts.every((prompt) => {
        if (!prompt || typeof prompt !== "object") {
            return false;
        }
        const candidate = prompt as SidecarPrompt;
        const labelOk = typeof candidate.label === "string" && candidate.label.trim().length > 0;
        const textOk = typeof candidate.text === "string" && candidate.text.trim().length > 0;
        const rolesOk = candidate.roles === undefined ||
            (Array.isArray(candidate.roles) && candidate.roles.every((role) => typeof role === "string"));
        return labelOk && textOk && rolesOk;
    });
}

// Fill each binding that does not already declare its own prompts with the catalog
// entry for that entity. Binding-level prompts take precedence; the catalog only
// closes the gap left by the Dataverse repository. Pure: returns a new configuration
// (or the original when nothing changes) and never mutates its input.
export function applyPromptCatalog(
    configuration: SidecarConfiguration,
    catalog: Readonly<Record<string, readonly SidecarPrompt[]>> = SIDECAR_PROMPT_CATALOG
): SidecarConfiguration {
    const entityBindings: Record<string, SidecarEntityBinding> = {};
    let changed = false;
    for (const [key, binding] of Object.entries(configuration.entityBindings)) {
        const hasOwnPrompts = Array.isArray(binding.prompts) && binding.prompts.length > 0;
        const catalogPrompts = catalog[key];
        if (!hasOwnPrompts && isValidCatalogPrompts(catalogPrompts) && catalogPrompts.length > 0) {
            entityBindings[key] = { ...binding, prompts: catalogPrompts };
            changed = true;
        } else {
            entityBindings[key] = binding;
        }
    }
    return changed ? { ...configuration, entityBindings } : configuration;
}

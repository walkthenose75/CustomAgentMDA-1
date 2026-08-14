export interface SidecarEntityBinding {
    logicalName: string;
    screenName: string;
}

export interface SidecarConfiguration {
    appId: string;
    enabled: boolean;
    paneId: string;
    paneTitle: string;
    paneWidth: number;
    webResourceName: string;
    iconWebResource: string;
    clientId: string;
    tenantId: string;
    environmentId: string;
    agentSchemaName: string;
    agentConnectionString: string;
    scope: string;
    redirectPath: string;
    contextLabel: string;
    defaultScreenName: string;
    entityBindings: Readonly<Record<string, SidecarEntityBinding>>;
}

export class SidecarConfigurationError extends Error {
    readonly errorCode: string;

    constructor(errorCode: string) {
        super(errorCode);
        this.name = "SidecarConfigurationError";
        this.errorCode = errorCode;
    }
}

const GUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const LOGICAL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const AGENT_SCHEMA_NAME_PATTERN = /^[a-z][a-z0-9_]{2,199}$/i;
const STANDARD_AGENT_PATH = ["copilotstudio", "dataverse-backed", "authenticated", "bots"];
const GHCP_AGENT_PATH = [
    "copilotstudio",
    "agenticruntime",
    "3p",
    "dataverse-backed",
    "authenticated",
    "bots"
];

function getEnvironmentApiHost(environmentId: string): string {
    const compact = environmentId.replace(/-/g, "").toLowerCase();
    return `${compact.slice(0, 30)}.${compact.slice(30)}.environment.api.powerplatform.com`;
}

function matchesPathPrefix(segments: string[], expected: string[]): boolean {
    return expected.every((segment, index) => segments[index]?.toLowerCase() === segment);
}

function isValidAgentConnectionString(
    value: string,
    environmentId: string,
    schemaName: string
): boolean {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        return false;
    }
    if (
        url.protocol !== "https:" ||
        url.port ||
        url.hostname.toLowerCase() !== getEnvironmentApiHost(environmentId)
    ) {
        return false;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const normalizedSegments = segments.map(segment => segment.toLowerCase());
    const isStandard =
        normalizedSegments.length === STANDARD_AGENT_PATH.length + 2 &&
        matchesPathPrefix(normalizedSegments, STANDARD_AGENT_PATH) &&
        normalizedSegments[normalizedSegments.length - 1] === "conversations";
    const hasGhcpConversations =
        normalizedSegments.length === GHCP_AGENT_PATH.length + 2 &&
        normalizedSegments[normalizedSegments.length - 1] === "conversations";
    const isGhcp =
        (normalizedSegments.length === GHCP_AGENT_PATH.length + 1 || hasGhcpConversations) &&
        matchesPathPrefix(normalizedSegments, GHCP_AGENT_PATH) &&
        url.searchParams.get("api-version") === "1";
    const pathSchemaName = segments[isStandard ? STANDARD_AGENT_PATH.length : GHCP_AGENT_PATH.length];

    return (isStandard || isGhcp) && pathSchemaName === schemaName;
}

export function normalizeGuid(value: unknown): string | null {
    const normalized = String(value ?? "")
        .trim()
        .replace(/^\{([^{}]+)\}$/, "$1")
        .toLowerCase();
    return GUID_PATTERN.test(normalized) ? normalized : null;
}

export function resolveSidecarConfiguration(
    configurations: readonly SidecarConfiguration[],
    appId: unknown
): SidecarConfiguration {
    const normalizedAppId = normalizeGuid(appId);
    if (!normalizedAppId) {
        throw new SidecarConfigurationError("sidecar_app_id_invalid");
    }

    const matches = configurations.filter(configuration =>
        configuration.enabled && normalizeGuid(configuration.appId) === normalizedAppId
    );
    if (matches.length === 0) {
        throw new SidecarConfigurationError("sidecar_configuration_not_found");
    }
    if (matches.length > 1) {
        throw new SidecarConfigurationError("sidecar_configuration_ambiguous");
    }

    assertSidecarConfiguration(matches[0]);
    return matches[0];
}

export function assertSidecarConfiguration(configuration: SidecarConfiguration): void {
    const identifiers = [
        configuration.appId,
        configuration.clientId,
        configuration.tenantId,
        configuration.environmentId
    ];
    const textValues = [
        configuration.paneId,
        configuration.paneTitle,
        configuration.webResourceName,
        configuration.iconWebResource,
        configuration.scope,
        configuration.contextLabel,
        configuration.defaultScreenName
    ];
    const bindingEntries = Object.entries(configuration.entityBindings);

    if (
        identifiers.some(identifier => !normalizeGuid(identifier)) ||
        textValues.some(value => typeof value !== "string" || !value.trim()) ||
        !Number.isInteger(configuration.paneWidth) ||
        configuration.paneWidth < 300 ||
        configuration.paneWidth > 1000 ||
        !configuration.webResourceName.endsWith(".html") ||
        !AGENT_SCHEMA_NAME_PATTERN.test(configuration.agentSchemaName) ||
        !isValidAgentConnectionString(
            configuration.agentConnectionString,
            configuration.environmentId,
            configuration.agentSchemaName
        ) ||
        !configuration.redirectPath.startsWith("/WebResources/") ||
        bindingEntries.length === 0 ||
        bindingEntries.some(([key, binding]) =>
            !LOGICAL_NAME_PATTERN.test(key) ||
            binding.logicalName !== key ||
            !binding.screenName.trim()
        )
    ) {
        throw new SidecarConfigurationError("sidecar_configuration_invalid");
    }
}

export function getEntityBinding(
    configuration: SidecarConfiguration,
    entityName: unknown
): SidecarEntityBinding | null {
    const logicalName = String(entityName ?? "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(configuration.entityBindings, logicalName)
        ? configuration.entityBindings[logicalName] ?? null
        : null;
}

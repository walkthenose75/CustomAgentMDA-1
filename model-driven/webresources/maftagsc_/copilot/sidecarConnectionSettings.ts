import { ConnectionSettings } from "@microsoft/agents-copilotstudio-client";
import type { SidecarConfiguration } from "./sidecarConfiguration";

export function createSidecarConnectionSettings(
    configuration: SidecarConfiguration
): ConnectionSettings {
    return new ConnectionSettings({
        directConnectUrl: configuration.agentConnectionString.trim()
    });
}

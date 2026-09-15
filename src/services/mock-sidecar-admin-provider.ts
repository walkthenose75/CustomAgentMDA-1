import {
  mockAdminAccess,
  mockAgents,
  mockRuntimeEnvironment,
  mockSidecarConfigurations,
  mockTable,
  mockTargetApps,
} from '@/mockData/sidecarAdministration';
import type { SidecarAdministrationProvider } from '@/services/sidecar-admin-contracts';
import type {
  DeploymentImpact,
  SidecarConfiguration,
  SidecarDraft,
  SidecarProgressCallback,
  TargetModelDrivenApp,
} from '@/types/sidecar-admin-models';
import { isGuid, parseCopilotStudioConnectionString } from '@/utils/agent-link';
import { parsePromptCatalog, serializePromptCatalog } from '@/lib/sidecar-prompts';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requireConfiguration(store: SidecarConfiguration[], id: string): SidecarConfiguration {
  const configuration = store.find((item) => item.id === id);
  if (!configuration) throw new Error('The sidecar configuration could not be found.');
  return configuration;
}

function now(): string {
  return new Date().toISOString();
}

export function createMockSidecarAdministrationProvider(): SidecarAdministrationProvider {
  const configurations = clone(mockSidecarConfigurations);
  const targetApps = clone(mockTargetApps);

  return {
    async getAccessContext() {
      return clone(mockAdminAccess);
    },
    async getRuntimeEnvironmentContext() {
      return clone(mockRuntimeEnvironment);
    },
    async listConfigurations() {
      return clone(configurations);
    },
    async getConfiguration(id) {
      const configuration = configurations.find((item) => item.id === id);
      if (!configuration) return null;
      configuration.lastValidatedAt = now();
      return clone(configuration);
    },
    async discoverTargetApps() {
      return clone(targetApps);
    },
    async discoverAgents() {
      return clone(mockAgents);
    },
    async resolveManualTargetApp(appId) {
      if (!isGuid(appId)) throw new Error('Enter a valid Model-driven App ID.');
      const existing = targetApps.find((item) => item.appId.toLowerCase() === appId.toLowerCase());
      if (existing) return clone(existing);
      const manual: TargetModelDrivenApp = {
        id: `manual-${appId}`,
        appId,
        uniqueName: `manual_${appId.slice(0, 8)}`,
        displayName: 'Manually entered app',
        description: 'Metadata will be discovered before deployment.',
        tables: [
          mockTable('account', 'Account', 1),
          mockTable('contact', 'Contact', 1),
        ],
      };
      targetApps.push(manual);
      return clone(manual);
    },
    async resolveAgentLink(connectionString, environmentId) {
      return parseCopilotStudioConnectionString(connectionString, environmentId);
    },
    async previewDeployment(draft) {
      const enabledCount = draft.tables.filter((table) => table.enabled).length;
      const impacts: DeploymentImpact[] = [
        {
          title: 'Create a dedicated Target Binding solution',
          detail: `${draft.bindingSolutionUniqueName} will contain only sidecar-owned structural bindings for ${draft.targetApp.displayName}.`,
          intent: 'change',
        },
        {
          title: `Enable active main forms for ${enabledCount} tables`,
          detail: 'All selected tables are enabled by default. Future app tables still require drift-review approval before form mutation.',
          intent: 'change',
        },
        {
          title: 'Reuse the existing Copilot Studio agent',
          detail: `${draft.agent.displayName} (${draft.agent.schemaName}) will be referenced; no agent or knowledge source will be created.`,
          intent: 'info',
        },
        {
          title: 'Capture a last-known-good snapshot',
          detail: 'A failed deployment will automatically restore the pre-change state and report any incomplete rollback as a blocking health issue.',
          intent: 'safety',
        },
      ];
      return clone(impacts);
    },
    async deploy(draft: SidecarDraft, onProgress?: SidecarProgressCallback) {
      if (configurations.some((item) => item.appId.toLowerCase() === draft.targetApp.appId.toLowerCase())) {
        throw new Error('This Model-driven App already has a sidecar configuration.');
      }
      const forms = draft.tables.filter((table) => table.enabled).flatMap((table) => table.forms.filter((form) => form.enabled).map((form) => `${table.displayName} — ${form.name}`));
      for (let index = 0; index < forms.length; index += 1) {
        onProgress?.({ phase: 'forms', current: index + 1, total: forms.length, label: forms[index] });
      }
      onProgress?.({ phase: 'publish', current: forms.length, total: forms.length, label: 'Publishing form changes' });
      onProgress?.({ phase: 'finalize', current: 1, total: 1, label: 'Finalizing configuration' });
      const deployed: SidecarConfiguration = {
        id: crypto.randomUUID(),
        name: draft.name,
        appId: draft.targetApp.appId,
        appUniqueName: draft.targetApp.uniqueName,
        appDisplayName: draft.targetApp.displayName,
        paneTitle: draft.paneTitle,
        paneWidth: draft.paneWidth,
        agentDisplayName: draft.agent.displayName,
        agentSchemaName: draft.agent.schemaName,
        agentConnectionString: draft.agentConnectionString,
        tenantId: draft.tenantId,
        publicClientApplicationId: draft.publicClientApplicationId,
        environmentId: draft.agent.environmentId,
        bindingSolutionUniqueName: draft.bindingSolutionUniqueName,
        lifecycleState: 'deployed',
        healthState: 'healthy',
        enabledSurfaces: ['forms'],
        autoEnableNewTables: true,
        tables: draft.tables.filter((table) => table.enabled),
        driftItems: [],
        lastValidatedAt: now(),
        lastOperationSummary: 'Deployment completed and live metadata read-back passed.',
        healthChecks: [
          { id: 'config', label: 'Configuration', state: 'pass', detail: 'One enabled app-keyed configuration resolved.' },
          { id: 'forms', label: 'Active main forms', state: 'pass', detail: 'Selected forms passed read-back verification.' },
          { id: 'identity', label: 'Delegated identity', state: 'pass', detail: 'Public-client setup values are complete.' },
          { id: 'agent', label: 'Copilot Studio agent', state: 'pass', detail: 'Existing published agent resolved successfully.' },
        ],
      };
      configurations.unshift(deployed);
      return clone(deployed);
    },
    async validate(id) {
      const configuration = requireConfiguration(configurations, id);
      configuration.lastValidatedAt = now();
      configuration.lastOperationSummary = configuration.driftItems.length
        ? 'Validation detected drift; no changes were applied.'
        : 'Manual health validation completed.';
      return clone(configuration);
    },
    async savePrompts(id, promptsByTable) {
      const configuration = requireConfiguration(configurations, id);
      const catalog = parsePromptCatalog(serializePromptCatalog(promptsByTable));
      configuration.tables = configuration.tables.map((table) => ({
        ...table,
        prompts: catalog[table.logicalName]?.length ? catalog[table.logicalName] : undefined,
      }));
      configuration.lastOperationSummary = 'Suggested prompts updated.';
      return clone(configuration);
    },
    async reconcile(id, onProgress?: SidecarProgressCallback) {
      const configuration = requireConfiguration(configurations, id);
      onProgress?.({ phase: 'forms', current: 1, total: 1, label: 'Reapplying handlers' });
      const target = targetApps.find((item) => item.appId === configuration.appId);
      configuration.tables = target ? target.tables.filter((table) => table.enabled) : configuration.tables;
      configuration.driftItems = [];
      configuration.lifecycleState = 'deployed';
      configuration.healthState = 'healthy';
      configuration.lastValidatedAt = now();
      configuration.lastOperationSummary = 'Administrator-approved reconciliation completed and read-back passed.';
      configuration.healthChecks = configuration.healthChecks.map((check) => ({
        ...check,
        state: 'pass',
        detail: check.id === 'forms' ? 'Live metadata matches the approved configuration.' : check.detail,
      }));
      return clone(configuration);
    },
    async setEnabled(id, enabled, onProgress?: SidecarProgressCallback) {
      const configuration = requireConfiguration(configurations, id);
      if (enabled && configuration.healthState === 'critical') {
        throw new Error('Resolve blocking health failures before enabling this sidecar.');
      }
      onProgress?.({ phase: 'forms', current: 1, total: 1, label: enabled ? 'Enabling bindings' : 'Disabling bindings' });
      configuration.lifecycleState = enabled ? 'deployed' : 'disabled';
      configuration.healthState = enabled ? 'healthy' : configuration.healthState;
      configuration.lastValidatedAt = now();
      configuration.lastOperationSummary = enabled
        ? 'Sidecar enabled after health validation.'
        : 'Sidecar disabled; configuration and owned bindings were retained.';
      return clone(configuration);
    },
    async uninstall(id, onProgress?: SidecarProgressCallback) {
      const index = configurations.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('The sidecar configuration could not be found.');
      onProgress?.({ phase: 'cleanup', current: 1, total: 1, label: 'Removing bindings and configuration' });
      configurations.splice(index, 1);
    },
  };
}

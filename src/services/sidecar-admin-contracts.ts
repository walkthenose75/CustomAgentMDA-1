import type {
  AdminAccessContext,
  AgentResolution,
  DiscoveredAgent,
  DeploymentImpact,
  RuntimeEnvironmentContext,
  SidecarConfiguration,
  SidecarDraft,
  SidecarProgressCallback,
  TargetModelDrivenApp,
} from '@/types/sidecar-admin-models';

export interface SidecarAdministrationProvider {
  getAccessContext(): Promise<AdminAccessContext>;
  getRuntimeEnvironmentContext(): Promise<RuntimeEnvironmentContext>;
  listConfigurations(): Promise<SidecarConfiguration[]>;
  getConfiguration(id: string): Promise<SidecarConfiguration | null>;
  discoverTargetApps(): Promise<TargetModelDrivenApp[]>;
  discoverAgents(): Promise<DiscoveredAgent[]>;
  resolveManualTargetApp(appId: string): Promise<TargetModelDrivenApp>;
  resolveAgentLink(connectionString: string, environmentId: string): Promise<AgentResolution>;
  previewDeployment(draft: SidecarDraft): Promise<DeploymentImpact[]>;
  deploy(draft: SidecarDraft, onProgress?: SidecarProgressCallback): Promise<SidecarConfiguration>;
  validate(id: string): Promise<SidecarConfiguration>;
  reconcile(id: string, onProgress?: SidecarProgressCallback): Promise<SidecarConfiguration>;
  setEnabled(id: string, enabled: boolean, onProgress?: SidecarProgressCallback): Promise<SidecarConfiguration>;
  uninstall(id: string, onProgress?: SidecarProgressCallback): Promise<void>;
}

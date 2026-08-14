import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSidecarAdministrationProvider } from '@/services/sidecar-provider-factory';
import type { SidecarConfiguration, SidecarDraft, SidecarProgressCallback } from '@/types/sidecar-admin-models';

const provider = createSidecarAdministrationProvider();

export const sidecarQueryKeys = {
  access: ['sidecar-admin', 'access'] as const,
  configurations: ['sidecar-admin', 'configurations'] as const,
  configuration: (id: string) => ['sidecar-admin', 'configurations', id] as const,
  targetApps: ['sidecar-admin', 'target-apps'] as const,
  runtimeEnvironment: ['sidecar-admin', 'runtime-environment'] as const,
  agents: ['sidecar-admin', 'agents'] as const,
};

function useConfigurationMutation<TInput>(
  mutationFn: (input: TInput) => Promise<SidecarConfiguration>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (configuration) => {
      queryClient.setQueryData(sidecarQueryKeys.configuration(configuration.id), configuration);
      queryClient.setQueryData<SidecarConfiguration[]>(sidecarQueryKeys.configurations, (current) => {
        if (!current) return [configuration];
        const exists = current.some((item) => item.id === configuration.id);
        return exists
          ? current.map((item) => (item.id === configuration.id ? configuration : item))
          : [configuration, ...current];
      });
    },
  });
}

export function useAdminAccess() {
  return useQuery({ queryKey: sidecarQueryKeys.access, queryFn: () => provider.getAccessContext() });
}

export function useSidecarConfigurations() {
  return useQuery({
    queryKey: sidecarQueryKeys.configurations,
    queryFn: () => provider.listConfigurations(),
  });
}

export function useSidecarConfiguration(id: string | undefined) {
  return useQuery({
    queryKey: sidecarQueryKeys.configuration(id ?? 'missing'),
    queryFn: () => (id ? provider.getConfiguration(id) : Promise.resolve(null)),
    enabled: Boolean(id),
  });
}

export function useTargetApps() {
  return useQuery({ queryKey: sidecarQueryKeys.targetApps, queryFn: () => provider.discoverTargetApps() });
}

export function useRuntimeEnvironment() {
  return useQuery({
    queryKey: sidecarQueryKeys.runtimeEnvironment,
    queryFn: () => provider.getRuntimeEnvironmentContext(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAgents() {
  return useQuery({
    queryKey: sidecarQueryKeys.agents,
    queryFn: () => provider.discoverAgents(),
  });
}

export function useResolveManualTargetApp() {
  return useMutation({ mutationFn: (appId: string) => provider.resolveManualTargetApp(appId) });
}

export function useResolveAgentLink() {
  return useMutation({
    mutationFn: ({ connectionString, environmentId }: { connectionString: string; environmentId: string }) =>
      provider.resolveAgentLink(connectionString, environmentId),
  });
}

export function useDeploymentPreview() {
  return useMutation({ mutationFn: (draft: SidecarDraft) => provider.previewDeployment(draft) });
}

export function useDeploySidecar() {
  return useConfigurationMutation((input: { draft: SidecarDraft; onProgress?: SidecarProgressCallback }) => provider.deploy(input.draft, input.onProgress));
}

export function useValidateSidecar() {
  return useConfigurationMutation((id: string) => provider.validate(id));
}

export function useReconcileSidecar() {
  return useConfigurationMutation((input: { id: string; onProgress?: SidecarProgressCallback }) => provider.reconcile(input.id, input.onProgress));
}

export function useSetSidecarEnabled() {
  return useConfigurationMutation((input: { id: string; enabled: boolean; onProgress?: SidecarProgressCallback }) =>
    provider.setEnabled(input.id, input.enabled, input.onProgress),
  );
}

export function useUninstallSidecar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; onProgress?: SidecarProgressCallback }) => provider.uninstall(input.id, input.onProgress),
    onSuccess: (_, input) => {
      const id = input.id;
      queryClient.removeQueries({ queryKey: sidecarQueryKeys.configuration(id) });
      const current = queryClient.getQueryData<SidecarConfiguration[]>(sidecarQueryKeys.configurations);
      if (current) {
        queryClient.setQueryData(sidecarQueryKeys.configurations, current.filter((item) => item.id !== id));
      } else {
        void queryClient.invalidateQueries({ queryKey: sidecarQueryKeys.configurations });
      }
    },
  });
}

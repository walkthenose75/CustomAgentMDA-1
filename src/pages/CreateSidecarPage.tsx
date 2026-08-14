import { useNavigate } from 'react-router-dom';
import { SidecarWizard } from '@/components/SidecarWizard/SidecarWizard';
import {
  useDeploySidecar,
  useDeploymentPreview,
  useAgents,
  useResolveManualTargetApp,
  useRuntimeEnvironment,
  useTargetApps,
} from '@/hooks/useSidecarAdministration';

export function CreateSidecarPage() {
  const navigate = useNavigate();
  const targetApps = useTargetApps();
  const runtimeEnvironment = useRuntimeEnvironment();
  const agents = useAgents();
  const resolveManual = useResolveManualTargetApp();
  const preview = useDeploymentPreview();
  const deploy = useDeploySidecar();
  const error = [targetApps.error, runtimeEnvironment.error, agents.error, resolveManual.error, preview.error, deploy.error]
    .find((item): item is Error => item instanceof Error);

  return (
    <SidecarWizard
      apps={targetApps.data}
      runtimeEnvironment={runtimeEnvironment.data}
      agents={agents.data}
      appsLoading={targetApps.isLoading}
      agentsLoading={runtimeEnvironment.isLoading || agents.isLoading}
      busy={resolveManual.isPending || preview.isPending || deploy.isPending}
      error={error?.message}
      onCancel={() => navigate('/')}
      onResolveManualApp={(appId) => resolveManual.mutateAsync(appId)}
      onPreview={(draft) => preview.mutateAsync(draft)}
      onDeploy={async (draft, onProgress) => {
        const configuration = await deploy.mutateAsync({ draft, onProgress });
        navigate(`/sidecars/${configuration.id}`);
      }}
    />
  );
}

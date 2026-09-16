import { useNavigate, useParams } from 'react-router-dom';
import { SidecarDetails } from '@/components/SidecarDetails/SidecarDetails';
import { useOperationReport } from '@/hooks/useOperationReport';
import {
  useReconcileSidecar,
  useSavePrompts,
  useSetSidecarEnabled,
  useSidecarConfiguration,
  useUninstallSidecar,
  useValidateSidecar,
} from '@/hooks/useSidecarAdministration';

export function SidecarDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const configuration = useSidecarConfiguration(id);
  const validate = useValidateSidecar();
  const reconcile = useReconcileSidecar();
  const setEnabled = useSetSidecarEnabled();
  const uninstall = useUninstallSidecar();
  const savePrompts = useSavePrompts();
  const report = useOperationReport();
  const error = [configuration.error, validate.error, reconcile.error, setEnabled.error, uninstall.error, savePrompts.error]
    .find((item): item is Error => item instanceof Error);
  const busy = validate.isPending || reconcile.isPending || setEnabled.isPending || uninstall.isPending || savePrompts.isPending;

  return (
    <SidecarDetails
      configuration={configuration.data}
      loading={configuration.isLoading}
      busy={busy}
      error={error?.message}
      report={{ active: busy, progress: report.progress, errorCount: report.errorCount, hasEntries: report.hasEntries, onDownload: report.download }}
      onBack={() => navigate('/')}
      onValidate={async () => { if (id) await validate.mutateAsync(id); }}
      onReconcile={async () => {
        if (!id) return;
        report.begin('Reconcile sidecar', { id });
        try { await reconcile.mutateAsync({ id, onProgress: report.onProgress }); report.recordSuccess('Reconciliation completed.'); }
        catch (caught) { report.recordError(caught instanceof Error ? caught.message : 'Reconciliation failed.'); }
      }}
      onSetEnabled={async (enabled) => {
        if (!id) return;
        report.begin(enabled ? 'Enable sidecar' : 'Disable sidecar', { id, enabled });
        try { await setEnabled.mutateAsync({ id, enabled, onProgress: report.onProgress }); report.recordSuccess(enabled ? 'Sidecar enabled.' : 'Sidecar disabled.'); }
        catch (caught) { report.recordError(caught instanceof Error ? caught.message : 'Operation failed.'); }
      }}
      onUninstall={async () => {
        if (!id) return;
        report.begin('Uninstall sidecar', { id });
        try { await uninstall.mutateAsync({ id, onProgress: report.onProgress }); report.recordSuccess('Uninstall completed.'); navigate('/'); }
        catch (caught) { report.recordError(caught instanceof Error ? caught.message : 'Uninstall failed.'); }
      }}
      onSavePrompts={async (promptsByTable) => { if (id) await savePrompts.mutateAsync({ id, promptsByTable }); }}
    />
  );
}

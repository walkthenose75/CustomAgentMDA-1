import { getContext } from '@microsoft/power-apps/app';
import { AppmodulesService } from '@/generated/services/AppmodulesService';
import { BotsService } from '@/generated/services/BotsService';
import { Maftagsc_sidecarconfigurationsService as Configurations } from '@/generated/services/Maftagsc_sidecarconfigurationsService';
import { Maftagsc_targetbindingsService as Bindings } from '@/generated/services/Maftagsc_targetbindingsService';
import { PublishersService } from '@/generated/services/PublishersService';
import { RolesService } from '@/generated/services/RolesService';
import { SolutionsService } from '@/generated/services/SolutionsService';
import { SystemformsService } from '@/generated/services/SystemformsService';
import { SystemuserrolescollectionService } from '@/generated/services/SystemuserrolescollectionService';
import { SystemusersService } from '@/generated/services/SystemusersService';
import { Maftagsc_sidecarconfigurationsmaftagsc_healthstate as HealthOptions, Maftagsc_sidecarconfigurationsstatuscode as StatusOptions, type Maftagsc_sidecarconfigurations } from '@/generated/models/Maftagsc_sidecarconfigurationsModel';
import { Maftagsc_targetbindingsmaftagsc_validationstate as ValidationOptions, type Maftagsc_targetbindings } from '@/generated/models/Maftagsc_targetbindingsModel';
import type { SidecarAdministrationProvider } from '@/services/sidecar-admin-contracts';
import { addSolutionComponent, assertSidecarActionsAvailable, publishTables } from '@/services/dataverse-custom-api';
import type { DiscoveredAgent, SidecarConfiguration, SidecarDraft, SidecarHealthCheck, SidecarHealthState, SidecarLifecycleState, SidecarProgressCallback, TargetModelDrivenApp, TargetTable } from '@/types/sidecar-admin-models';
import { parsePromptCatalog, serializePromptCatalog, type PromptCatalog } from '@/lib/sidecar-prompts';
import { buildCopilotStudioConnectionString, classifyCopilotStudioHarness, isMicrosoftSystemAgent, parseCopilotStudioConnectionString } from '@/utils/agent-link';
import { discoverAppForms, type DiscoveredForm } from '@/services/model-driven-app-discovery';
import { isInformationFormName } from '@/lib/target-forms';

const ADMIN_ROLE_TEMPLATE = '627090ff-40a3-4053-8790-584edc5be201';
const SIDECAR_PUBLISHER = 'agentsidecar';
const LIBRARY = 'maftagsc_/copilot/agentSidePane.js';
const HANDLER = 'AgentSidecar.initializeGuide';
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result<T> = { data?: T; error?: unknown };
type Form = DiscoveredForm;
// The generated model is read-only and does not yet include the maftagsc_prompts
// column added for admin-authored suggested prompts. The Dataverse client passes
// unknown fields through, so we widen the read/write type locally rather than
// editing src/generated.
type ConfigurationRecord = Maftagsc_sidecarconfigurations & { maftagsc_prompts?: string | null };

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown };
    if (typeof record.message === 'string') return record.message;
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error ?? 'Unknown Dataverse error');
}
function data<T>(result: Result<T>, operation: string): T {
  if (result.error) throw new Error(`${operation} failed: ${message(result.error)}`);
  if (result.data === undefined) throw new Error(`${operation} returned no data.`);
  return result.data;
}
function option<T extends number>(values: Record<T, string>, label: string): T {
  const found = Object.entries(values).find(([, value]) => value === label);
  if (!found) throw new Error(`Dataverse option '${label}' is unavailable.`);
  return Number(found[0]) as T;
}
function guid(value: string | undefined, label: string): string {
  if (!value) throw new Error(`${label} is required.`);
  const normalized = value.trim().replace(/[{}]/g, '').toLowerCase();
  if (!GUID_PATTERN.test(normalized)) throw new Error(`${label} must be a valid GUID.`);
  return normalized;
}
function odataString(value: string): string {
  return value.trim().replace(/'/g, "''");
}
const HEALTH = {
  none: option(HealthOptions, 'NotValidated'), healthy: option(HealthOptions, 'Healthy'),
  warning: option(HealthOptions, 'Warning'), critical: option(HealthOptions, 'Critical'),
};
const STATUS = {
  draft: option(StatusOptions, 'Draft'), deployed: option(StatusOptions, 'Deployed'),
  drift: option(StatusOptions, 'DriftDetected'), disabled: option(StatusOptions, 'Disabled'),
};
const VALIDATION = {
  none: option(ValidationOptions, 'NotValidated'), pass: option(ValidationOptions, 'Pass'),
  warning: option(ValidationOptions, 'Warning'), conflict: option(ValidationOptions, 'Conflict'),
};
function health(value: number): SidecarHealthState {
  return value === HEALTH.healthy ? 'healthy' : value === HEALTH.warning ? 'warning' : value === HEALTH.critical ? 'critical' : 'notValidated';
}
function lifecycle(record: Maftagsc_sidecarconfigurations): SidecarLifecycleState {
  return record.statecode === 1 || record.statuscode === STATUS.disabled ? 'disabled'
    : record.statuscode === STATUS.deployed ? 'deployed'
      : record.statuscode === STATUS.drift ? 'drift' : 'draft';
}
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, '0')).join('');
}
function xml(value: string): XMLDocument {
  const document = new DOMParser().parseFromString(value, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The target form XML is invalid.');
  return document;
}
interface HandlerMutation {
  value: string;
  handlerId: string;
  added: boolean;
}
function addHandler(value: string, id: string): HandlerMutation {
  const document = xml(value);
  const form = document.querySelector('form') ?? document.documentElement;
  let libraries = form.querySelector(':scope > formLibraries');
  if (!libraries) { libraries = document.createElement('formLibraries'); form.append(libraries); }
  if (![...libraries.querySelectorAll('Library')].some((item) => item.getAttribute('name') === LIBRARY)) {
    const library = document.createElement('Library');
    library.setAttribute('name', LIBRARY); library.setAttribute('libraryUniqueId', `{${crypto.randomUUID()}}`); libraries.append(library);
  }
  let events = form.querySelector(':scope > events');
  if (!events) { events = document.createElement('events'); form.append(events); }
  let onload = [...events.querySelectorAll(':scope > event')].find((item) => item.getAttribute('name')?.toLowerCase() === 'onload');
  if (!onload) { onload = document.createElement('event'); onload.setAttribute('name', 'onload'); onload.setAttribute('application', 'false'); onload.setAttribute('active', 'true'); events.append(onload); }
  let handlers = onload.querySelector(':scope > Handlers');
  if (!handlers) { handlers = document.createElement('Handlers'); onload.append(handlers); }
  const normalized = guid(id, 'Handler ID');
  const existing = [...handlers.querySelectorAll('Handler')].find((item) =>
    item.getAttribute('functionName') === HANDLER && item.getAttribute('libraryName') === LIBRARY,
  );
  if (existing) {
    const existingId = existing.getAttribute('handlerUniqueId');
    if (existingId) {
      return { value: new XMLSerializer().serializeToString(document), handlerId: guid(existingId, 'Existing handler ID'), added: false };
    }
    existing.setAttribute('handlerUniqueId', `{${normalized}}`);
    return { value: new XMLSerializer().serializeToString(document), handlerId: normalized, added: false };
  }
  if (![...handlers.querySelectorAll('Handler')].some((item) => item.getAttribute('handlerUniqueId')?.replace(/[{}]/g, '').toLowerCase() === normalized)) {
    const handler = document.createElement('Handler');
    handler.setAttribute('functionName', HANDLER); handler.setAttribute('libraryName', LIBRARY);
    handler.setAttribute('handlerUniqueId', `{${normalized}}`); handler.setAttribute('enabled', 'true');
    handler.setAttribute('parameters', ''); handler.setAttribute('passExecutionContext', 'true'); handlers.append(handler);
  }
  return { value: new XMLSerializer().serializeToString(document), handlerId: normalized, added: true };
}
function removeHandler(value: string, id: string): string {
  const document = xml(value); const normalized = guid(id, 'Handler ID');
  for (const handler of document.querySelectorAll('Handler')) {
    if (handler.getAttribute('handlerUniqueId')?.replace(/[{}]/g, '').toLowerCase() === normalized) handler.remove();
  }
  if (![...document.querySelectorAll('Handler')].some((item) => item.getAttribute('libraryName') === LIBRARY)) {
    for (const library of document.querySelectorAll('Library')) if (library.getAttribute('name') === LIBRARY) library.remove();
  }
  // Drop containers we may have emptied. Dataverse form-XML schema rejects an empty
  // <formLibraries>, <Handlers>, onload <event>, or <events> element
  // ("The element 'formLibraries' has incomplete content ... expected: 'Library'").
  // Remove inner-to-outer so a container emptied by a child removal is also cleaned up.
  for (const handlers of [...document.querySelectorAll('Handlers')]) if (!handlers.children.length) handlers.remove();
  for (const event of [...document.querySelectorAll('event')]) {
    if (event.getAttribute('name')?.toLowerCase() === 'onload' && !event.children.length) event.remove();
  }
  for (const events of [...document.querySelectorAll('events')]) if (!events.children.length) events.remove();
  for (const libraries of [...document.querySelectorAll('formLibraries')]) if (!libraries.children.length) libraries.remove();
  return new XMLSerializer().serializeToString(document);
}
function includesHandler(value: string, id: string): boolean {
  const normalized = guid(id, 'Handler ID');
  return [...xml(value).querySelectorAll('Handler')].some((item) =>
    item.getAttribute('handlerUniqueId')?.replace(/[{}]/g, '').toLowerCase() === normalized
    && item.getAttribute('functionName') === HANDLER
    && item.getAttribute('libraryName') === LIBRARY,
  );
}
function map(record: ConfigurationRecord, bindings: Maftagsc_targetbindings[], checks: SidecarHealthCheck[] = []): SidecarConfiguration {
  const tables = new Map<string, TargetTable>();
  for (const binding of bindings) {
    const form = { formId: binding.maftagsc_formid, name: binding.maftagsc_formname ?? binding.maftagsc_formid, enabled: binding.maftagsc_enabled };
    const current = tables.get(binding.maftagsc_tablelogicalname);
    if (current) { current.formCount += 1; current.forms.push(form); current.enabled = current.enabled || binding.maftagsc_enabled; }
    else tables.set(binding.maftagsc_tablelogicalname, { logicalName: binding.maftagsc_tablelogicalname, displayName: binding.maftagsc_tabledisplayname, enabled: binding.maftagsc_enabled, formCount: 1, forms: [form] });
  }
  const promptCatalog = parsePromptCatalog(record.maftagsc_prompts);
  for (const table of tables.values()) {
    const prompts = promptCatalog[table.logicalName];
    if (prompts && prompts.length) table.prompts = prompts;
  }
  const healthState = health(record.maftagsc_healthstate);
  return {
    id: record.maftagsc_sidecarconfigurationid, name: record.maftagsc_name,
    appId: record.maftagsc_appid, appUniqueName: record.maftagsc_appuniquename, appDisplayName: record.maftagsc_appdisplayname,
    paneTitle: record.maftagsc_panetitle, paneWidth: record.maftagsc_panewidth,
    agentDisplayName: record.maftagsc_agentdisplayname, agentSchemaName: record.maftagsc_agentschemaname,
    agentConnectionString: record.maftagsc_agentconnectionstring, tenantId: record.maftagsc_tenantid,
    publicClientApplicationId: record.maftagsc_publicclientapplicationid, environmentId: record.maftagsc_environmentid,
    bindingSolutionUniqueName: record.maftagsc_bindingsolutionuniquename, lifecycleState: lifecycle(record), healthState,
    enabledSurfaces: ['forms'], autoEnableNewTables: record.maftagsc_autoenablenewtables,
    tables: [...tables.values()],
    driftItems: healthState === 'warning' ? [{ id: 'form-drift', kind: 'conflict', title: 'Live form metadata differs from the approved binding', detail: 'Review and approve reconciliation before changing live metadata.' }] : [],
    healthChecks: checks, lastValidatedAt: record.maftagsc_lastvalidatedat, lastOperationSummary: record.maftagsc_lastoperationsummary,
  };
}

export function createRealSidecarAdministrationProvider(): SidecarAdministrationProvider {
  const appForms = new Map<string, Map<string, Form[]>>();
  const appTableDisplayNames = new Map<string, Map<string, string>>();
  let contextPromise: ReturnType<typeof getContext> | undefined;
  const runtimeContext = () => {
    contextPromise ??= getContext();
    return contextPromise;
  };
  async function bindingsFor(id?: string): Promise<Maftagsc_targetbindings[]> {
    return data(await Bindings.getAll({ filter: id ? `_maftagsc_sidecarconfiguration_value eq ${guid(id, 'Configuration ID')}` : undefined, top: 5000 }), 'List target bindings');
  }
  async function formsFor(appIdUnique: string): Promise<Map<string, Form[]>> {
    const normalizedId = guid(appIdUnique, 'App metadata ID');
    const discovery = await discoverAppForms(normalizedId);
    appTableDisplayNames.set(normalizedId, discovery.tableDisplayNames);
    return discovery.formsByTable;
  }
  async function targetApp(id: string): Promise<TargetModelDrivenApp> {
    const app = data(await AppmodulesService.get(guid(id, 'Model-driven App ID'), { select: ['appmoduleid', 'appmoduleidunique', 'uniquename', 'name', 'description'] }), 'Read Model-driven App');
    const forms = await formsFor(app.appmoduleidunique); appForms.set(app.appmoduleid, forms);
    const displayNames = appTableDisplayNames.get(app.appmoduleidunique) ?? new Map<string, string>();
    return { id: app.appmoduleid, appId: app.appmoduleid, uniqueName: app.uniquename, displayName: app.name,
      description: app.description ?? 'Model-driven App in the current environment.',
      tables: [...forms.entries()].map(([logicalName, items]) => ({
        logicalName,
        displayName: displayNames.get(logicalName) ?? logicalName,
        enabled: true,
        formCount: items.length,
        forms: items.map((item) => ({ formId: item.formid, name: item.name ?? item.formid, enabled: isInformationFormName(item.name) })),
      })) };
  }
  async function sidecarPublisherId(): Promise<string> {
    const publishers = data(await PublishersService.getAll({
      select: ['publisherid'], filter: `uniquename eq '${SIDECAR_PUBLISHER}'`, top: 1,
    }), 'Find Agent Sidecar publisher');
    if (!publishers[0]) throw new Error('The Agent Sidecar publisher is unavailable.');
    return publishers[0].publisherid;
  }
  async function ensureBindingSolution(uniqueName: string, appId: string): Promise<{ id: string; created: boolean }> {
    const normalizedName = uniqueName.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,64}$/.test(normalizedName)) {
      throw new Error('Target Binding solution must start with a letter and contain at most 65 letters, numbers, or underscores.');
    }
    const marker = `Agent Sidecar Target Binding for app ${guid(appId, 'Model-driven App ID')}`;
    // `publisheridprefix` is not a queryable column on the solution table; resolve
    // ownership by comparing the solution's publisher lookup to the Agent Sidecar publisher.
    const publisherId = await sidecarPublisherId();
    const existing = data(await SolutionsService.getAll({
      select: ['solutionid', 'description', 'ismanaged', '_publisherid_value'], filter: `uniquename eq '${odataString(normalizedName)}'`, top: 1,
    }), 'Find Target Binding solution');
    if (existing[0]) {
      const ownedByPublisher = (existing[0]._publisherid_value ?? '').toLowerCase() === publisherId.toLowerCase();
      if (existing[0].ismanaged || !ownedByPublisher || existing[0].description !== marker) {
        throw new Error(`Solution ${normalizedName} exists but is not owned by this app's Agent Sidecar binding.`);
      }
      return { id: existing[0].solutionid, created: false };
    }
    const created = data(await SolutionsService.create({
      friendlyname: normalizedName, uniquename: normalizedName, description: marker, version: '1.0.0.0',
      enabledforsourcecontrolintegration: false, sourcecontrolsyncstatus: 0,
      'publisherid@odata.bind': `/publishers(${publisherId})`,
    } as unknown as Parameters<typeof SolutionsService.create>[0]), 'Create Target Binding solution');
    return { id: created.solutionid, created: true };
  }
  async function validate(id: string): Promise<SidecarConfiguration> {
    const configurationId = guid(id, 'Configuration ID');
    const record = data(await Configurations.get(configurationId), 'Read sidecar configuration'); const bindings = await bindingsFor(configurationId);
    let warnings = 0; let failures = 0;
    for (const binding of bindings) {
      try {
        const form = data(await SystemformsService.get(guid(binding.maftagsc_formid, 'Form ID'), { select: ['formxml'] }), 'Read bound form');
        const present = includesHandler(form.formxml, binding.maftagsc_handleruniqueid);
        const shouldBePresent = record.statecode === 0 && binding.maftagsc_enabled;
        const presenceConflict = present !== shouldBePresent;
        const changed = shouldBePresent && await hash(form.formxml) !== binding.maftagsc_lastappliedfingerprint;
        const state = presenceConflict ? VALIDATION.conflict : changed ? VALIDATION.warning : VALIDATION.pass;
        if (presenceConflict) failures += 1; else if (changed) warnings += 1;
        if (state !== binding.maftagsc_validationstate) data(await Bindings.update(binding.maftagsc_targetbindingid, { maftagsc_validationstate: state }), 'Save binding validation');
      } catch { failures += 1; }
    }
    const state = failures ? HEALTH.critical : warnings ? HEALTH.warning : HEALTH.healthy;
    const summary = failures ? `${failures} target binding(s) failed validation.` : warnings ? `${warnings} live form change(s) require review.` : 'Health validation completed; configuration and live bindings match.';
    const updated = data(await Configurations.update(configurationId, { maftagsc_healthstate: state, maftagsc_lastvalidatedat: new Date().toISOString(), maftagsc_lastoperationsummary: summary, ...(warnings ? { statuscode: STATUS.drift } : {}) }), 'Save health status');
    const checks: SidecarHealthCheck[] = [
      { id: 'config', label: 'Configuration', state: 'pass', detail: 'The app-keyed configuration resolves uniquely.' },
      { id: 'forms', label: 'Active main forms', state: failures ? 'fail' : warnings ? 'warning' : 'pass', detail: summary },
      { id: 'identity', label: 'Delegated identity', state: record.maftagsc_tenantid && record.maftagsc_publicclientapplicationid ? 'pass' : 'fail', detail: 'Tenant and public-client identifiers are stored without secrets.' },
      { id: 'agent', label: 'Copilot Studio agent', state: 'pass', detail: `Configured agent: ${record.maftagsc_agentschemaname}.` },
    ];
    return map(updated, bindings, checks);
  }
  async function mutate(id: string, mode: 'apply' | 'remove', onProgress?: SidecarProgressCallback): Promise<Maftagsc_targetbindings[]> {
    assertSidecarActionsAvailable();
    const bindings = await bindingsFor(guid(id, 'Configuration ID')); const tables: string[] = [];
    const changedBindings: Array<{ binding: Maftagsc_targetbindings; formId: string; handlerId: string }> = [];
    let processed = 0;
    for (const binding of bindings) {
      onProgress?.({ phase: 'forms', current: processed, total: bindings.length, label: `${binding.maftagsc_tabledisplayname} — ${binding.maftagsc_formname}` });
      const formId = guid(binding.maftagsc_formid, 'Form ID');
      const form = data(await SystemformsService.get(formId, { select: ['formid', 'formxml', 'objecttypecode'] }), 'Read bound form');
      const mutation = mode === 'apply' ? addHandler(form.formxml, binding.maftagsc_handleruniqueid) : undefined;
      const next = mutation?.value ?? removeHandler(form.formxml, binding.maftagsc_handleruniqueid);
      if (next !== form.formxml) data(await SystemformsService.update(form.formid, { formxml: next }), 'Update bound form');
      changedBindings.push({ binding, formId, handlerId: mutation?.handlerId ?? binding.maftagsc_handleruniqueid });
      if (form.objecttypecode) tables.push(form.objecttypecode);
      processed += 1;
      onProgress?.({ phase: 'forms', current: processed, total: bindings.length, label: `${binding.maftagsc_tabledisplayname} — ${binding.maftagsc_formname}` });
    }
    if (tables.length) { onProgress?.({ phase: 'publish', current: bindings.length, total: bindings.length, label: 'Publishing form changes' }); await publishTables(tables); }
    for (const { binding, formId, handlerId } of changedBindings) {
      if (mode === 'apply') {
        const readBack = data(await SystemformsService.get(formId, { select: ['formxml'] }), 'Read back bound form');
        data(await Bindings.update(binding.maftagsc_targetbindingid, {
          maftagsc_enabled: true,
          maftagsc_handleruniqueid: handlerId,
          maftagsc_lastappliedfingerprint: await hash(readBack.formxml),
          maftagsc_validationstate: VALIDATION.pass,
        }), 'Update target binding');
      } else {
        data(await Bindings.update(binding.maftagsc_targetbindingid, { maftagsc_enabled: false, maftagsc_validationstate: VALIDATION.none }), 'Update target binding');
      }
    }
    return bindings;
  }

  return {
    async getAccessContext() {
      const context = await runtimeContext();
      const users = data(await SystemusersService.getAll({ select: ['systemuserid', 'fullname'], filter: `azureactivedirectoryobjectid eq ${guid(context.user.objectId, 'Current user object ID')}`, top: 1 }), 'Resolve user');
      if (!users[0]) return { displayName: context.user.fullName ?? context.user.userPrincipalName ?? 'Current user', isSystemAdministrator: false };
      const roles = data(await RolesService.getAll({ select: ['roleid'], filter: `_roletemplateid_value eq ${ADMIN_ROLE_TEMPLATE}`, top: 50 }), 'Resolve administrator roles');
      const roleIds = new Set(roles.map((item) => item.roleid.toLowerCase()));
      const assignments = data(await SystemuserrolescollectionService.getAll({ select: ['roleid', 'systemuserid'], filter: `systemuserid eq ${guid(users[0].systemuserid, 'System user ID')}`, top: 500 }), 'Read role assignments');
      return { displayName: context.user.fullName || users[0].fullname || context.user.userPrincipalName || 'Current user', isSystemAdministrator: assignments.some((item) => roleIds.has(item.roleid.toLowerCase())) };
    },
    async getRuntimeEnvironmentContext() {
      const context = await runtimeContext();
      const dataverseOrgUrl = context.app.dataverseOrgUrl?.replace(/\/$/, '');
      if (!dataverseOrgUrl) throw new Error('The current Dataverse organization URL is unavailable.');
      return {
        environmentId: guid(context.app.environmentId, 'Current environment ID'),
        tenantId: guid(context.user.tenantId, 'Current tenant ID'),
        dataverseOrgUrl,
      };
    },
    async listConfigurations() {
      const [records, bindings] = await Promise.all([Configurations.getAll({ orderBy: ['modifiedon desc'], top: 5000 }), bindingsFor()]);
      return data(records, 'List configurations').map((record) => map(record, bindings.filter((binding) => binding._maftagsc_sidecarconfiguration_value === record.maftagsc_sidecarconfigurationid)));
    },
    async getConfiguration(id) { try { const configurationId = guid(id, 'Configuration ID'); return map(data(await Configurations.get(configurationId), 'Read configuration'), await bindingsFor(configurationId)); } catch (error) { if (/not found|does not exist|404/i.test(message(error))) return null; throw error; } },
    async discoverTargetApps() {
      const apps = data(await AppmodulesService.getAll({ select: ['appmoduleid'], filter: 'statecode eq 0 and componentstate eq 0', orderBy: ['name asc'], top: 500 }), 'Discover apps');
      return Promise.all(apps.map((app) => targetApp(app.appmoduleid)));
    },
    async discoverAgents() {
      const context = await runtimeContext();
      const environmentId = guid(context.app.environmentId, 'Current environment ID');
      const agents = data(await BotsService.getAll({
        select: ['botid', 'name', 'schemaname', 'configuration', 'publishedon'],
        filter: 'statecode eq 0 and componentstate eq 0 and publishedon ne null',
        orderBy: ['name asc'],
        top: 500,
      }), 'Discover Copilot Studio agents');
      return agents.flatMap((record): DiscoveredAgent[] => {
        const harness = classifyCopilotStudioHarness(record.configuration);
        if (!harness || isMicrosoftSystemAgent(record.schemaname, record.name)) return [];
        return [{
          id: record.botid,
          displayName: record.name || record.schemaname,
          schemaName: record.schemaname,
          environmentId,
          published: true,
          harness,
          connectionString: buildCopilotStudioConnectionString(environmentId, record.schemaname, harness),
        }];
      });
    },
    resolveManualTargetApp: (appId) => targetApp(guid(appId, 'Model-driven App ID')),
    async resolveAgentLink(connectionString, environmentId) {
      const parsed = parseCopilotStudioConnectionString(connectionString, environmentId); const context = await runtimeContext();
      if (context.app.environmentId.toLowerCase() !== parsed.environmentId.toLowerCase()) throw new Error('The Copilot Studio agent must belong to the Code App environment.');
      const agents = data(await BotsService.getAll({ select: ['name', 'schemaname', 'publishedon'], filter: `schemaname eq '${odataString(parsed.schemaName)}' and statecode eq 0`, top: 1 }), 'Resolve agent');
      if (!agents[0]) throw new Error(`No active Copilot Studio agent named ${parsed.schemaName} was found.`);
      if (!agents[0].publishedon) throw new Error(`Copilot Studio agent ${parsed.schemaName} is not published.`);
      return { ...parsed, displayName: agents[0].name || parsed.displayName, published: true };
    },
    async previewDeployment(draft) {
      const selected = draft.tables.filter((item) => item.enabled);
      const count = selected.reduce((total, item) => total + item.forms.filter((form) => form.enabled).length, 0);
      return [
        { title: 'Create or reuse the Target Binding solution', detail: `${draft.bindingSolutionUniqueName} will own selected form components.`, intent: 'change' },
        { title: `Bind ${selected.length} tables and ${count} active main forms`, detail: 'The launcher is added idempotently with an owned handler identifier.', intent: 'change' },
        { title: 'Reuse the existing Copilot Studio agent', detail: `${draft.agent.displayName} is referenced; no agent is created.`, intent: 'info' },
        { title: 'Automatic rollback', detail: 'Failure removes only newly-added sidecar handlers and preserves unrelated form XML.', intent: 'safety' },
      ];
    },
    async deploy(draft: SidecarDraft, onProgress?: SidecarProgressCallback) {
      assertSidecarActionsAvailable();
      const appId = guid(draft.targetApp.appId, 'Model-driven App ID');
      const tenantId = guid(draft.tenantId, 'Tenant ID');
      const clientId = guid(draft.publicClientApplicationId, 'Public-client Application ID');
      const environmentId = guid(draft.agent.environmentId, 'Environment ID');
      const duplicates = data(await Configurations.getAll({ select: ['maftagsc_sidecarconfigurationid'], filter: `maftagsc_appid eq '${appId}'`, top: 1 }), 'Check app uniqueness');
      if (duplicates.length) throw new Error('This Model-driven App already has a sidecar configuration.');
      const forms = appForms.get(draft.targetApp.appId) ?? await formsFor(draft.targetApp.id);
      const selectedForms = draft.tables
        .filter((item) => item.enabled)
        .flatMap((table) => {
          const enabledFormIds = new Set(table.forms.filter((form) => form.enabled).map((form) => form.formId));
          return (forms.get(table.logicalName) ?? [])
            .filter((form) => enabledFormIds.has(form.formid))
            .map((form) => ({ table, form }));
        });
      if (!selectedForms.length) throw new Error('Select at least one form under an enabled table.');
      const bindingSolution = await ensureBindingSolution(draft.bindingSolutionUniqueName, appId);
      let created: Maftagsc_sidecarconfigurations;
      try {
        created = data(await Configurations.create({
          maftagsc_name: draft.name.trim(), maftagsc_appid: appId, maftagsc_appuniquename: draft.targetApp.uniqueName,
          maftagsc_appdisplayname: draft.targetApp.displayName, maftagsc_panetitle: draft.paneTitle.trim(), maftagsc_panewidth: draft.paneWidth,
          maftagsc_agentdisplayname: draft.agent.displayName, maftagsc_agentschemaname: draft.agent.schemaName,
          maftagsc_agentconnectionstring: draft.agentConnectionString.trim(), maftagsc_tenantid: tenantId,
          maftagsc_publicclientapplicationid: clientId, maftagsc_environmentid: environmentId,
          maftagsc_bindingsolutionuniquename: draft.bindingSolutionUniqueName.trim(), maftagsc_autoenablenewtables: true,
          maftagsc_healthstate: HEALTH.none, maftagsc_lastoperationsummary: 'Deployment is in progress.', statecode: 0, statuscode: STATUS.draft,
        }), 'Create configuration');
      } catch (error) {
        if (bindingSolution.created) await SolutionsService.delete(bindingSolution.id).catch(() => undefined);
        throw error;
      }
      const addedHandlers = new Map<string, string>();
      const createdBindings: Array<{ bindingId: string; formId: string }> = [];
      const tables: string[] = [];
      try {
        let processed = 0;
        for (const { table, form } of selectedForms) {
          onProgress?.({ phase: 'forms', current: processed, total: selectedForms.length, label: `${table.displayName} — ${form.name}` });
          const formId = guid(form.formid, 'Form ID');
          const mutation = addHandler(form.formxml, crypto.randomUUID());
          if (mutation.value !== form.formxml) data(await SystemformsService.update(formId, { formxml: mutation.value }), 'Update target form');
          if (mutation.added) addedHandlers.set(formId, mutation.handlerId);
          await addSolutionComponent(draft.bindingSolutionUniqueName.trim(), formId, 60);
          const binding = data(await Bindings.create({
            maftagsc_name: `${table.displayName} - ${form.name}`, maftagsc_tablelogicalname: table.logicalName,
            maftagsc_tabledisplayname: table.displayName, maftagsc_formid: formId, maftagsc_formname: form.name,
            maftagsc_enabled: true, maftagsc_handleruniqueid: mutation.handlerId, maftagsc_originalformfingerprint: await hash(form.formxml),
            maftagsc_lastappliedfingerprint: await hash(mutation.value), maftagsc_validationstate: VALIDATION.pass,
            'maftagsc_sidecarconfiguration@odata.bind': `/maftagsc_sidecarconfigurations(${created.maftagsc_sidecarconfigurationid})`, statecode: 0, statuscode: 1,
          }), 'Create binding'); createdBindings.push({ bindingId: binding.maftagsc_targetbindingid, formId }); tables.push(table.logicalName);
          processed += 1;
          onProgress?.({ phase: 'forms', current: processed, total: selectedForms.length, label: `${table.displayName} — ${form.name}` });
        }
        if (tables.length) { onProgress?.({ phase: 'publish', current: selectedForms.length, total: selectedForms.length, label: 'Publishing form changes' }); await publishTables(tables); }
        let readBackDone = 0;
        for (const { bindingId, formId } of createdBindings) {
          onProgress?.({ phase: 'readback', current: readBackDone, total: createdBindings.length, label: 'Verifying deployed forms' });
          const readBack = data(await SystemformsService.get(formId, { select: ['formxml'] }), 'Read back deployed form');
          data(await Bindings.update(bindingId, { maftagsc_lastappliedfingerprint: await hash(readBack.formxml) }), 'Save deployed form fingerprint');
          readBackDone += 1;
          onProgress?.({ phase: 'readback', current: readBackDone, total: createdBindings.length, label: 'Verifying deployed forms' });
        }
        onProgress?.({ phase: 'finalize', current: 1, total: 1, label: 'Finalizing configuration' });
        data(await Configurations.update(created.maftagsc_sidecarconfigurationid, { maftagsc_healthstate: HEALTH.healthy, maftagsc_lastvalidatedat: new Date().toISOString(), maftagsc_lastoperationsummary: 'Deployment completed and read-back passed.', statuscode: STATUS.deployed }), 'Complete deployment');
        return validate(created.maftagsc_sidecarconfigurationid);
      } catch (error) {
        for (const [formId, handlerId] of addedHandlers) {
          try {
            const current = data(await SystemformsService.get(formId, { select: ['formxml'] }), 'Read form for rollback');
            data(await SystemformsService.update(formId, { formxml: removeHandler(current.formxml, handlerId) }), 'Remove sidecar handler');
          } catch { /* surfaced by the deployment failure */ }
        }
        if (tables.length) await publishTables(tables).catch(() => undefined);
        await Promise.all(createdBindings.map(({ bindingId }) => Bindings.delete(bindingId).catch(() => undefined)));
        await Configurations.delete(created.maftagsc_sidecarconfigurationid).catch(() => undefined);
        if (bindingSolution.created) await SolutionsService.delete(bindingSolution.id).catch(() => undefined);
        throw new Error(`Deployment failed and rollback was attempted: ${message(error)}`);
      }
    },
    validate,
    async savePrompts(id: string, promptsByTable: PromptCatalog) {
      const configurationId = guid(id, 'Configuration ID');
      const serialized = serializePromptCatalog(promptsByTable);
      data(await Configurations.update(configurationId, { maftagsc_prompts: serialized } as unknown as Parameters<typeof Configurations.update>[1]), 'Save suggested prompts');
      const [record, bindings] = await Promise.all([Configurations.get(configurationId), bindingsFor(configurationId)]);
      return map(data(record, 'Read configuration'), bindings);
    },
    async reconcile(id, onProgress) { const configurationId = guid(id, 'Configuration ID'); await mutate(configurationId, 'apply', onProgress); data(await Configurations.update(configurationId, { statecode: 0, statuscode: STATUS.deployed, maftagsc_healthstate: HEALTH.healthy, maftagsc_lastoperationsummary: 'Approved reconciliation completed.' }), 'Complete reconciliation'); return validate(configurationId); },
    async setEnabled(id, enabled, onProgress) {
      const configurationId = guid(id, 'Configuration ID');
      await mutate(configurationId, enabled ? 'apply' : 'remove', onProgress);
      data(await Configurations.update(configurationId, { statecode: enabled ? 0 : 1, statuscode: enabled ? STATUS.deployed : STATUS.disabled, maftagsc_healthstate: enabled ? HEALTH.healthy : HEALTH.none, maftagsc_lastvalidatedat: new Date().toISOString(), maftagsc_lastoperationsummary: enabled ? 'Sidecar enabled.' : 'Sidecar disabled; configuration retained.' }), enabled ? 'Enable sidecar' : 'Disable sidecar');
      return enabled ? validate(configurationId) : map(data(await Configurations.get(configurationId), 'Read configuration'), await bindingsFor(configurationId));
    },
    async uninstall(id, onProgress) {
      const configurationId = guid(id, 'Configuration ID');
      const configuration = data(await Configurations.get(configurationId), 'Read configuration');
      const bindings = await mutate(configurationId, 'remove', onProgress);
      onProgress?.({ phase: 'cleanup', current: 0, total: 1, label: 'Removing bindings and configuration' });
      await Promise.all(bindings.map((binding) => Bindings.delete(binding.maftagsc_targetbindingid)));
      await Configurations.delete(configurationId);
      const ownershipMarker = `Agent Sidecar Target Binding for app ${guid(configuration.maftagsc_appid, 'Model-driven App ID')}`;
      const publisherId = await sidecarPublisherId();
      const solutions = data(await SolutionsService.getAll({
        select: ['solutionid', 'description', '_publisherid_value'],
        filter: `uniquename eq '${odataString(configuration.maftagsc_bindingsolutionuniquename)}' and ismanaged eq false`,
        top: 1,
      }), 'Find scoped Target Binding solution');
      if (solutions[0]?.description === ownershipMarker && (solutions[0]._publisherid_value ?? '').toLowerCase() === publisherId.toLowerCase()) {
        await SolutionsService.delete(solutions[0].solutionid);
      }
      onProgress?.({ phase: 'cleanup', current: 1, total: 1, label: 'Removing bindings and configuration' });
    },
  };
}

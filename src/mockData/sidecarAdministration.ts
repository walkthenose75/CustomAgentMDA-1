import type {
  AdminAccessContext,
  DiscoveredAgent,
  RuntimeEnvironmentContext,
  SidecarConfiguration,
  TargetForm,
  TargetModelDrivenApp,
  TargetTable,
} from '@/types/sidecar-admin-models';

const hrTables = [
  ['systemuser', 'Employee', 2],
  ['position', 'Position', 1],
  ['businessunit', 'Department', 1],
  ['maftagsc_timeoffrequest', 'Time Off Request', 1],
  ['maftagsc_expensereport', 'Expense Report', 1],
  ['maftagsc_benefitplan', 'Benefit Plan', 1],
  ['maftagsc_benefitenrollment', 'Benefit Enrollment', 1],
] as const;

// Generate a plausible set of active main forms for a table. The first is always
// the "Information" form (selected by default); the rest start unselected.
function mockForms(logicalName: string, count: number): TargetForm[] {
  const names = ['Information', 'Details', 'Quick View', 'Multisession'];
  return Array.from({ length: Math.max(1, count) }, (_, index) => ({
    formId: `${logicalName}-form-${index + 1}`,
    name: names[index] ?? `Form ${index + 1}`,
    enabled: index === 0,
  }));
}

export function mockTable(logicalName: string, displayName: string, formCount: number): TargetTable {
  const forms = mockForms(logicalName, formCount);
  return { logicalName, displayName, formCount: forms.length, enabled: true, forms };
}

export const mockAdminAccess: AdminAccessContext = {
  displayName: 'Marty Carreras',
  isSystemAdministrator: true,
};

export const mockRuntimeEnvironment: RuntimeEnvironmentContext = {
  environmentId: 'f9b87f8b-0abf-e629-affb-b13195d1ed14',
  tenantId: 'd92190b9-98e7-46da-8b11-580e06c7d15d',
  dataverseOrgUrl: 'https://carremacodeapps.crm.dynamics.com',
};

export const mockAgents: DiscoveredAgent[] = [
  {
    id: 'mock-standard-agent',
    displayName: 'Field Guide',
    schemaName: 'contoso_FieldGuide',
    environmentId: mockRuntimeEnvironment.environmentId,
    published: true,
    harness: 'standard',
    connectionString: 'https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/contoso_FieldGuide/conversations?api-version=2022-03-01-preview',
  },
  {
    id: 'mock-github-agent',
    displayName: 'Insights and actions',
    schemaName: 'contoso_InsightsAndActions',
    environmentId: mockRuntimeEnvironment.environmentId,
    published: true,
    harness: 'githubCopilot',
    connectionString: 'https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/contoso_InsightsAndActions?api-version=1',
  },
];

export const mockTargetApps: TargetModelDrivenApp[] = [
  {
    id: 'target-hr-management',
    appId: '62e8fdf6-e77b-f111-ab0e-000d3a34048c',
    uniqueName: 'maftagsc_HRManagement',
    displayName: 'HR Management',
    description: 'Benefits, time off, expenses, and organization administration.',
    tables: hrTables.map(([logicalName, displayName, formCount]) => mockTable(logicalName, displayName, formCount)),
  },
  {
    id: 'target-field-service',
    appId: '0f348e31-318e-4d89-b39e-58ced2e7f218',
    uniqueName: 'contoso_FieldOperations',
    displayName: 'Field Operations',
    description: 'Work orders, assets, inspections, and customer service history.',
    tables: [
      mockTable('msdyn_workorder', 'Work Order', 2),
      mockTable('msdyn_customerasset', 'Customer Asset', 1),
      mockTable('msdyn_workorderservicetask', 'Service Task', 1),
      mockTable('account', 'Account', 2),
    ],
  },
  {
    id: 'target-finance',
    appId: '52750231-1114-47bb-928f-41cff91af3f0',
    uniqueName: 'contoso_FinanceOperations',
    displayName: 'Finance Operations',
    description: 'Invoice exceptions, approvals, and close coordination.',
    tables: [
      mockTable('invoice', 'Invoice', 2),
      mockTable('transactioncurrency', 'Currency', 1),
      mockTable('contoso_closeitem', 'Close Item', 1),
    ],
  },
  {
    id: 'target-sales',
    appId: '81fd5395-76f7-4f36-a182-c040e35f990b',
    uniqueName: 'contoso_SalesWorkspace',
    displayName: 'Sales Workspace',
    description: 'Accounts, opportunities, contacts, and sales activities.',
    tables: [
      mockTable('account', 'Account', 2),
      mockTable('contact', 'Contact', 2),
      mockTable('opportunity', 'Opportunity', 1),
      mockTable('activitypointer', 'Activity', 1),
    ],
  },
];

export const mockSidecarConfigurations: SidecarConfiguration[] = [
  {
    id: 'sidecar-hr-management',
    name: 'HR Management App Guide',
    appId: '62e8fdf6-e77b-f111-ab0e-000d3a34048c',
    appUniqueName: 'maftagsc_HRManagement',
    appDisplayName: 'HR Management',
    paneTitle: 'HR Management App Guide',
    paneWidth: 420,
    agentDisplayName: 'HR Mgmt Classic',
    agentSchemaName: 'cr0b1_HRMgmtClassic',
    agentConnectionString: 'https://1234567890.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cr0b1_HRMgmtClassic/conversations?api-version=2022-03-01-preview',
    tenantId: 'd92190b9-98e7-46da-8b11-580e06c7d15d',
    publicClientApplicationId: '9d03cd77-5246-4c9c-8e9d-262bff547a25',
    environmentId: 'f9b87f8b-0abf-e629-affb-b13195d1ed14',
    bindingSolutionUniqueName: 'HRAgentSidecarBinding',
    lifecycleState: 'deployed',
    healthState: 'healthy',
    enabledSurfaces: ['forms'],
    autoEnableNewTables: true,
    tables: mockTargetApps[0].tables,
    driftItems: [],
    lastValidatedAt: '2026-07-10T14:32:00.000Z',
    lastOperationSummary: 'Deployment verified through live metadata read-back.',
    healthChecks: [
      { id: 'config', label: 'Configuration', state: 'pass', detail: 'One enabled app-keyed configuration resolved.' },
      { id: 'forms', label: 'Active main forms', state: 'pass', detail: 'All selected forms have active registrations.' },
      { id: 'identity', label: 'Delegated identity', state: 'pass', detail: 'Public client identifiers and redirect URI are configured.' },
      { id: 'agent', label: 'Copilot Studio agent', state: 'pass', detail: 'Existing published agent resolved successfully.' },
    ],
  },
  {
    id: 'sidecar-field-operations',
    name: 'Field Operations Assistant',
    appId: '0f348e31-318e-4d89-b39e-58ced2e7f218',
    appUniqueName: 'contoso_FieldOperations',
    appDisplayName: 'Field Operations',
    paneTitle: 'Field Operations Assistant',
    paneWidth: 420,
    agentDisplayName: 'Field Service Guide',
    agentSchemaName: 'contoso_FieldServiceGuide',
    agentConnectionString: 'https://1234567890.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/contoso_FieldServiceGuide/conversations?api-version=2022-03-01-preview',
    tenantId: 'd92190b9-98e7-46da-8b11-580e06c7d15d',
    publicClientApplicationId: '73d1e61b-0388-4602-b928-d593750bb4d7',
    environmentId: 'f9b87f8b-0abf-e629-affb-b13195d1ed14',
    bindingSolutionUniqueName: 'FieldOperationsSidecarBinding',
    lifecycleState: 'drift',
    healthState: 'warning',
    enabledSurfaces: ['forms'],
    autoEnableNewTables: true,
    tables: mockTargetApps[1].tables.slice(0, 3),
    driftItems: [
      {
        id: 'new-table',
        kind: 'addition',
        title: 'Account was added to the target app',
        detail: 'Automatic inheritance is configured, but administrator approval is required before live metadata changes.',
      },
      {
        id: 'form-change',
        kind: 'conflict',
        title: 'Work Order main form changed',
        detail: 'The current form fingerprint differs from the last applied fingerprint.',
      },
    ],
    lastValidatedAt: '2026-07-10T13:08:00.000Z',
    lastOperationSummary: 'Drift detected; no changes were applied.',
    healthChecks: [
      { id: 'config', label: 'Configuration', state: 'pass', detail: 'Configuration resolves uniquely.' },
      { id: 'forms', label: 'Active main forms', state: 'warning', detail: 'Two live form metadata differences require review.' },
      { id: 'identity', label: 'Delegated identity', state: 'pass', detail: 'Public client registration is ready.' },
      { id: 'agent', label: 'Copilot Studio agent', state: 'pass', detail: 'Published agent resolved successfully.' },
    ],
  },
  {
    id: 'sidecar-finance-operations',
    name: 'Finance Operations Guide',
    appId: '52750231-1114-47bb-928f-41cff91af3f0',
    appUniqueName: 'contoso_FinanceOperations',
    appDisplayName: 'Finance Operations',
    paneTitle: 'Finance Operations Guide',
    paneWidth: 400,
    agentDisplayName: 'Finance Operations Agent',
    agentSchemaName: 'contoso_FinanceOperationsAgent',
    agentConnectionString: 'https://1234567890.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/contoso_FinanceOperationsAgent/conversations?api-version=2022-03-01-preview',
    tenantId: 'd92190b9-98e7-46da-8b11-580e06c7d15d',
    publicClientApplicationId: '5fb2470a-25cd-4a83-92e1-616e14b259d7',
    environmentId: 'f9b87f8b-0abf-e629-affb-b13195d1ed14',
    bindingSolutionUniqueName: 'FinanceOperationsSidecarBinding',
    lifecycleState: 'disabled',
    healthState: 'critical',
    enabledSurfaces: ['forms'],
    autoEnableNewTables: true,
    tables: mockTargetApps[2].tables,
    driftItems: [],
    lastValidatedAt: '2026-07-09T17:41:00.000Z',
    lastOperationSummary: 'Automatic rollback could not restore one form registration; sidecar remains disabled.',
    healthChecks: [
      { id: 'config', label: 'Configuration', state: 'pass', detail: 'Saved configuration is intact.' },
      { id: 'forms', label: 'Rollback verification', state: 'fail', detail: 'Invoice main form needs guided remediation.' },
      { id: 'identity', label: 'Delegated identity', state: 'pass', detail: 'Public client registration is ready.' },
      { id: 'agent', label: 'Copilot Studio agent', state: 'pass', detail: 'Published agent resolved successfully.' },
    ],
  },
];

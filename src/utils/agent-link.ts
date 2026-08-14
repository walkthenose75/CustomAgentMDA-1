import type { AgentResolution } from '@/types/sidecar-admin-models';

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schemaPattern = /^[A-Za-z][A-Za-z0-9_]{2,199}$/;
const githubCopilotHarnessPath = ['copilotstudio', 'agenticruntime', '3p', 'dataverse-backed', 'authenticated', 'bots'];
const standardHarnessPath = ['copilotstudio', 'dataverse-backed', 'authenticated', 'bots'];

export type CopilotStudioHarness = 'standard' | 'githubCopilot';

interface BotConfiguration {
  isAgentConnectable?: boolean;
  recognizer?: {
    $kind?: string;
  };
}

function matchesPathPrefix(segments: string[], expected: string[]): boolean {
  return expected.every((segment, index) => segments[index]?.toLowerCase() === segment);
}

export function parseCopilotStudioConnectionString(connectionString: string, environmentId: string): AgentResolution {
  const value = connectionString.trim();
  if (/<iframe\b|<script\b|<html\b/i.test(value)) {
    throw new Error('Paste the Microsoft 365 Agents SDK connection string from Channels > Web app, not the public iframe embed code.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Paste a valid Microsoft 365 Agents SDK connection string from Channels > Web app.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('The Agents SDK connection string must use HTTPS.');
  }

  const normalizedEnvironmentId = environmentId.trim();
  if (!guidPattern.test(normalizedEnvironmentId)) {
    throw new Error('Enter a valid Power Platform Environment ID.');
  }

  const expectedHost = getPowerPlatformEnvironmentApiHost(normalizedEnvironmentId);
  if (url.hostname.toLowerCase() !== expectedHost || url.port) {
    throw new Error('The Agents SDK connection string host does not match the supplied Environment ID.');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const normalizedSegments = segments.map((segment) => segment.toLowerCase());
  const isStandardHarness =
    normalizedSegments.length === standardHarnessPath.length + 2 &&
    matchesPathPrefix(normalizedSegments, standardHarnessPath) &&
    normalizedSegments[normalizedSegments.length - 1] === 'conversations';
  const hasGitHubCopilotConversationsPath =
    normalizedSegments.length === githubCopilotHarnessPath.length + 2 &&
    normalizedSegments[normalizedSegments.length - 1] === 'conversations';
  const isGitHubCopilotHarness =
    (normalizedSegments.length === githubCopilotHarnessPath.length + 1 || hasGitHubCopilotConversationsPath) &&
    matchesPathPrefix(normalizedSegments, githubCopilotHarnessPath) &&
    url.searchParams.get('api-version') === '1';
  if (!isStandardHarness && !isGitHubCopilotHarness) {
    throw new Error('Use a supported Standard harness /copilotstudio/dataverse-backed/.../bots/{schema}/conversations URL or GitHub Copilot harness /copilotstudio/agenticruntime/3p/.../bots/{schema} URL.');
  }
  const schemaName = segments[isStandardHarness ? standardHarnessPath.length : githubCopilotHarnessPath.length];
  if (!schemaName || !schemaPattern.test(schemaName)) {
    throw new Error('The Agents SDK connection string does not contain a valid /bots/{agentName}/ segment.');
  }

  const displayName = schemaName
    .replace(/^[a-z0-9]+_/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();

  return {
    displayName: displayName || schemaName,
    schemaName,
    environmentId: normalizedEnvironmentId,
    published: true,
  };
}

export function buildGitHubCopilotHarnessConnectionString(environmentId: string, schemaName: string): string {
  return buildCopilotStudioConnectionString(environmentId, schemaName, 'githubCopilot');
}

export function buildStandardHarnessConnectionString(environmentId: string, schemaName: string): string {
  return buildCopilotStudioConnectionString(environmentId, schemaName, 'standard');
}

export function buildCopilotStudioConnectionString(
  environmentId: string,
  schemaName: string,
  harness: CopilotStudioHarness,
): string {
  const normalizedEnvironmentId = environmentId.trim().toLowerCase();
  const normalizedSchemaName = schemaName.trim();
  if (!guidPattern.test(normalizedEnvironmentId)) {
    throw new Error('Enter a valid Power Platform Environment ID.');
  }
  if (!schemaPattern.test(normalizedSchemaName)) {
    throw new Error('Enter a valid Copilot Studio agent schema name.');
  }
  const host = getPowerPlatformEnvironmentApiHost(normalizedEnvironmentId);
  return harness === 'githubCopilot'
    ? `https://${host}/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/${normalizedSchemaName}?api-version=1`
    : `https://${host}/copilotstudio/dataverse-backed/authenticated/bots/${normalizedSchemaName}/conversations?api-version=2022-03-01-preview`;
}

export function classifyCopilotStudioHarness(configuration: string | undefined): CopilotStudioHarness | null {
  if (!configuration) return null;
  let parsed: BotConfiguration;
  try {
    parsed = JSON.parse(configuration) as BotConfiguration;
  } catch {
    return null;
  }
  const recognizerKind = parsed.recognizer?.$kind;
  if (recognizerKind === 'CLICopilotRecognizer' || recognizerKind === 'CLIAgentRecognizer') {
    return 'githubCopilot';
  }
  return parsed.isAgentConnectable === true ? 'standard' : null;
}

export function isMicrosoftSystemAgent(schemaName: string, displayName: string | undefined): boolean {
  const normalizedSchema = schemaName.trim().toLowerCase();
  return normalizedSchema.startsWith('msdyn_')
    || normalizedSchema.startsWith('mspva_')
    || displayName?.trim().startsWith('[Internal]') === true;
}

function getPowerPlatformEnvironmentApiHost(environmentId: string): string {
  const compactEnvironmentId = environmentId.replace(/-/g, '').toLowerCase();
  return `${compactEnvironmentId.slice(0, 30)}.${compactEnvironmentId.slice(30)}.environment.api.powerplatform.com`;
}

export function isGuid(value: string): boolean {
  return guidPattern.test(value.trim());
}

import { describe, expect, it } from 'vitest';
import { buildGitHubCopilotHarnessConnectionString, isGuid, parseCopilotStudioConnectionString } from '@/utils/agent-link';

const environmentId = 'f9b87f8b-0abf-e629-affb-b13195d1ed14';
const connectionString = 'https://1234567890.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/contoso_FieldGuide/conversations?api-version=2022-03-01-preview';

describe('parseCopilotStudioConnectionString', () => {
  it('resolves the agent schema from an Agents SDK connection string and uses the supplied environment ID', () => {
    expect(parseCopilotStudioConnectionString(connectionString, environmentId)).toEqual({
      displayName: 'Field Guide',
      schemaName: 'contoso_FieldGuide',
      environmentId,
      published: true,
    });
  });

  it('rejects non-HTTPS links', () => {
    expect(() => parseCopilotStudioConnectionString(connectionString.replace('https:', 'http:'), environmentId)).toThrow('must use HTTPS');
  });

  it('rejects an invalid separately supplied environment ID', () => {
    expect(() => parseCopilotStudioConnectionString(connectionString, 'not-a-guid')).toThrow('valid Power Platform Environment ID');
  });

  it('rejects a public web chat URL without the conversations endpoint', () => {
    expect(() => parseCopilotStudioConnectionString('https://copilotstudio.microsoft.com/bots/contoso_FieldGuide/webchat', environmentId)).toThrow('ending in /conversations');
  });

  it('rejects public iframe embed HTML with actionable guidance', () => {
    expect(() => parseCopilotStudioConnectionString('<iframe src="https://example.com"></iframe>', environmentId)).toThrow('not the public iframe embed code');
  });

  it('resolves a GitHub Copilot harness agentic runtime URL', () => {
    const url = buildGitHubCopilotHarnessConnectionString(environmentId, 'contoso_FieldGuide');
    expect(parseCopilotStudioConnectionString(url, environmentId)).toEqual({
      displayName: 'Field Guide',
      schemaName: 'contoso_FieldGuide',
      environmentId,
      published: true,
    });
  });

  it('rejects a GitHub Copilot harness URL for a different environment', () => {
    const url = buildGitHubCopilotHarnessConnectionString(environmentId, 'contoso_FieldGuide');
    expect(() => parseCopilotStudioConnectionString(url, '7d8dcd87-2e21-e805-b9be-678794ecc80b')).toThrow('does not match');
  });
});

describe('buildGitHubCopilotHarnessConnectionString', () => {
  it('builds the agentic runtime URL from the environment ID and schema name', () => {
    expect(buildGitHubCopilotHarnessConnectionString(environmentId, 'contoso_FieldGuide')).toBe(
      'https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/contoso_FieldGuide?api-version=1',
    );
  });

  it('rejects invalid environment IDs and schema names', () => {
    expect(() => buildGitHubCopilotHarnessConnectionString('not-a-guid', 'contoso_FieldGuide')).toThrow('valid Power Platform Environment ID');
    expect(() => buildGitHubCopilotHarnessConnectionString(environmentId, 'not valid')).toThrow('valid Copilot Studio agent schema name');
  });
});

describe('isGuid', () => {
  it('accepts trimmed GUIDs and rejects arbitrary text', () => {
    expect(isGuid(` ${environmentId} `)).toBe(true);
    expect(isGuid('not-a-guid')).toBe(false);
  });
});

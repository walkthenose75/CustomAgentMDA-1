import { describe, expect, it } from 'vitest';
import {
  buildGitHubCopilotHarnessConnectionString,
  buildStandardHarnessConnectionString,
  classifyCopilotStudioHarness,
  isGuid,
  isMicrosoftSystemAgent,
  parseCopilotStudioConnectionString,
} from '@/utils/agent-link';

const environmentId = 'f9b87f8b-0abf-e629-affb-b13195d1ed14';
const connectionString = 'https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/contoso_FieldGuide/conversations?api-version=2022-03-01-preview';
const ghcpConnectionString = 'https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/contoso_FieldGuide?api-version=1';

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
    expect(() => parseCopilotStudioConnectionString(
      connectionString.replace('/copilotstudio/dataverse-backed/authenticated/bots/contoso_FieldGuide/conversations', '/bots/contoso_FieldGuide/webchat'),
      environmentId,
    )).toThrow('supported Standard harness');
  });

  it('rejects public iframe embed HTML with actionable guidance', () => {
    expect(() => parseCopilotStudioConnectionString('<iframe src="https://example.com"></iframe>', environmentId)).toThrow('not the public iframe embed code');
  });

  it('resolves a GitHub Copilot harness agentic runtime URL', () => {
    expect(parseCopilotStudioConnectionString(ghcpConnectionString, environmentId)).toEqual({
      displayName: 'Field Guide',
      schemaName: 'contoso_FieldGuide',
      environmentId,
      published: true,
    });
  });

  it('accepts a GitHub Copilot harness URL that already contains /conversations', () => {
    expect(parseCopilotStudioConnectionString(
      ghcpConnectionString.replace('?api-version=1', '/conversations?api-version=1'),
      environmentId,
    )).toMatchObject({ schemaName: 'contoso_FieldGuide', environmentId });
  });

  it('rejects a GitHub Copilot harness URL for a different environment', () => {
    expect(() => parseCopilotStudioConnectionString(
      ghcpConnectionString,
      '7d8dcd87-2e21-e805-b9be-678794ecc80b',
    )).toThrow('host does not match');
  });

  it('rejects invalid hosts, paths, and schema names', () => {
    expect(() => parseCopilotStudioConnectionString(
      ghcpConnectionString.replace('environment.api.powerplatform.com', 'example.com'),
      environmentId,
    )).toThrow('host does not match');
    expect(() => parseCopilotStudioConnectionString(
      ghcpConnectionString.replace('/agenticruntime/3p/', '/agenticruntime/unsupported/'),
      environmentId,
    )).toThrow('supported Standard harness');
    expect(() => parseCopilotStudioConnectionString(
      ghcpConnectionString.replace('contoso_FieldGuide', 'invalid-schema'),
      environmentId,
    )).toThrow('valid /bots/{agentName}/');
  });
});

describe('buildGitHubCopilotHarnessConnectionString', () => {
  it('builds the agentic runtime URL from the environment ID and schema name', () => {
    expect(buildGitHubCopilotHarnessConnectionString(environmentId, 'contoso_FieldGuide')).toBe(
      'https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/contoso_FieldGuide?api-version=1',
    );
  });

  describe('buildStandardHarnessConnectionString', () => {
    it('builds the published-agent URL from the environment ID and schema name', () => {
      expect(buildStandardHarnessConnectionString(environmentId, 'contoso_FieldGuide')).toBe(
        'https://f9b87f8b0abfe629affbb13195d1ed.14.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/contoso_FieldGuide/conversations?api-version=2022-03-01-preview',
      );
    });
  });

  describe('classifyCopilotStudioHarness', () => {
    it('recognizes current and legacy GitHub Copilot harness markers', () => {
      expect(classifyCopilotStudioHarness('{"recognizer":{"$kind":"CLICopilotRecognizer"}}')).toBe('githubCopilot');
      expect(classifyCopilotStudioHarness('{"recognizer":{"$kind":"CLIAgentRecognizer"}}')).toBe('githubCopilot');
    });

    it('recognizes connectable Standard harness agents and rejects incompatible metadata', () => {
      expect(classifyCopilotStudioHarness('{"isAgentConnectable":true,"recognizer":{"$kind":"GenerativeAIRecognizer"}}')).toBe('standard');
      expect(classifyCopilotStudioHarness('{"recognizer":{"$kind":"GenerativeAIRecognizer"}}')).toBeNull();
      expect(classifyCopilotStudioHarness('not-json')).toBeNull();
    });
  });

  describe('isMicrosoftSystemAgent', () => {
    it('hides Microsoft system schemas and internal agents without hiding custom schemas', () => {
      expect(isMicrosoftSystemAgent('msdyn_salesCopilot', 'Copilot in Dynamics 365 Sales')).toBe(true);
      expect(isMicrosoftSystemAgent('contoso_FieldGuide', '[Internal] Helper')).toBe(true);
      expect(isMicrosoftSystemAgent('contoso_FieldGuide', 'Field Guide')).toBe(false);
    });
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

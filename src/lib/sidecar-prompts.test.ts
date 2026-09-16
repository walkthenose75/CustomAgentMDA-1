import { describe, expect, it } from 'vitest';
import {
  MAX_PROMPTS_PER_TABLE,
  parsePromptCatalog,
  sanitizePrompt,
  sanitizePrompts,
  serializePromptCatalog,
  type PromptCatalog,
} from '@/lib/sidecar-prompts';

describe('sidecar prompt serialization boundary', () => {
  it('round-trips a valid catalog through serialize and parse', () => {
    const catalog: PromptCatalog = {
      account: [
        { label: 'Summarize', text: 'Summarize this account.' },
        { label: 'Open risks', text: 'List open risks.', roles: ['Salesperson', 'Sales Manager'] },
      ],
      incident: [{ label: 'Next steps', text: 'What are the next steps on this case?' }],
    };

    expect(parsePromptCatalog(serializePromptCatalog(catalog))).toEqual(catalog);
  });

  it('drops keys that are not valid table logical names', () => {
    const raw = JSON.stringify({
      account: [{ label: 'Ok', text: 'Fine' }],
      'Bad Name': [{ label: 'X', text: 'Y' }],
      '9numeric': [{ label: 'X', text: 'Y' }],
    });

    expect(Object.keys(parsePromptCatalog(raw))).toEqual(['account']);
  });

  it('lower-cases logical-name keys', () => {
    const raw = JSON.stringify({ Account: [{ label: 'Ok', text: 'Fine' }] });

    expect(parsePromptCatalog(raw)).toHaveProperty('account');
  });

  it('caps prompts per table at the shared maximum', () => {
    const many = Array.from({ length: MAX_PROMPTS_PER_TABLE + 4 }, (_, index) => ({
      label: `Label ${index}`,
      text: `Text ${index}`,
    }));

    expect(sanitizePrompts(many)).toHaveLength(MAX_PROMPTS_PER_TABLE);
  });

  it('truncates over-long labels and text', () => {
    const prompt = sanitizePrompt({ label: 'a'.repeat(200), text: 'b'.repeat(1000) });

    expect(prompt?.label).toHaveLength(60);
    expect(prompt?.text).toHaveLength(400);
  });

  it('trims, de-duplicates, and drops empty roles', () => {
    const prompt = sanitizePrompt({
      label: 'Scoped',
      text: 'Scoped prompt',
      roles: [' Sales ', 'Sales', '', '   ', 'Manager'],
    });

    expect(prompt?.roles).toEqual(['Sales', 'Manager']);
  });

  it('omits the roles array entirely when no valid roles remain', () => {
    const prompt = sanitizePrompt({ label: 'Everyone', text: 'For all', roles: ['', '  '] });

    expect(prompt).toEqual({ label: 'Everyone', text: 'For all' });
    expect(prompt).not.toHaveProperty('roles');
  });

  it('returns null when a prompt is missing a label or text', () => {
    expect(sanitizePrompt({ label: '', text: 'Body' })).toBeNull();
    expect(sanitizePrompt({ label: 'Title', text: '   ' })).toBeNull();
    expect(sanitizePrompt('not-an-object')).toBeNull();
  });

  it('returns an empty catalog for malformed or non-object input', () => {
    expect(parsePromptCatalog('not json')).toEqual({});
    expect(parsePromptCatalog('[]')).toEqual({});
    expect(parsePromptCatalog('42')).toEqual({});
    expect(parsePromptCatalog('')).toEqual({});
    expect(parsePromptCatalog(null)).toEqual({});
  });

  it('excludes tables whose prompts all fail validation from the serialized output', () => {
    const serialized = serializePromptCatalog({
      account: [{ label: '', text: '' }],
      incident: [{ label: 'Keep', text: 'Kept' }],
    });

    expect(JSON.parse(serialized)).toEqual({ incident: [{ label: 'Keep', text: 'Kept' }] });
  });
});

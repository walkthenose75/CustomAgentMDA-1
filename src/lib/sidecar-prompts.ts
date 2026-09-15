import type { SidecarPromptDefinition } from '@/types/sidecar-admin-models';

// The suggested-prompt catalog is persisted as a JSON object on the
// maftagsc_sidecarconfiguration.maftagsc_prompts column, keyed by table logical
// name. This module is the single serialization boundary for that column so the
// admin app and the runtime pane agree on shape, ordering, and limits.

export const MAX_PROMPTS_PER_TABLE = 6;
const MAX_LABEL_LENGTH = 60;
const MAX_TEXT_LENGTH = 400;
const MAX_ROLE_LENGTH = 100;
const LOGICAL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export type PromptCatalog = Record<string, SidecarPromptDefinition[]>;

export function sanitizePrompt(input: unknown): SidecarPromptDefinition | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as { label?: unknown; text?: unknown; roles?: unknown };
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  if (!label || !text) return null;
  const prompt: SidecarPromptDefinition = {
    label: label.slice(0, MAX_LABEL_LENGTH),
    text: text.slice(0, MAX_TEXT_LENGTH),
  };
  if (Array.isArray(record.roles)) {
    const roles = [
      ...new Set(
        record.roles
          .filter((role): role is string => typeof role === 'string')
          .map((role) => role.trim().slice(0, MAX_ROLE_LENGTH))
          .filter((role) => role.length > 0),
      ),
    ];
    if (roles.length) prompt.roles = roles;
  }
  return prompt;
}

export function sanitizePrompts(list: unknown): SidecarPromptDefinition[] {
  if (!Array.isArray(list)) return [];
  const prompts: SidecarPromptDefinition[] = [];
  for (const item of list) {
    const prompt = sanitizePrompt(item);
    if (prompt) prompts.push(prompt);
    if (prompts.length >= MAX_PROMPTS_PER_TABLE) break;
  }
  return prompts;
}

export function parsePromptCatalog(raw: unknown): PromptCatalog {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const catalog: PromptCatalog = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const logicalName = key.trim().toLowerCase();
    if (!LOGICAL_NAME_PATTERN.test(logicalName)) continue;
    const prompts = sanitizePrompts(value);
    if (prompts.length) catalog[logicalName] = prompts;
  }
  return catalog;
}

export function serializePromptCatalog(catalog: PromptCatalog): string {
  const clean: PromptCatalog = {};
  for (const [key, value] of Object.entries(catalog)) {
    const logicalName = key.trim().toLowerCase();
    if (!LOGICAL_NAME_PATTERN.test(logicalName)) continue;
    const prompts = sanitizePrompts(value);
    if (prompts.length) clean[logicalName] = prompts;
  }
  return JSON.stringify(clean);
}

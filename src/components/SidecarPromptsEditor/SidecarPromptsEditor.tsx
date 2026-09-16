import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  Textarea,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { AddRegular, ChevronDownRegular, ChevronRightRegular, ChevronUpRegular, DeleteRegular, SaveRegular } from '@fluentui/react-icons';
import { DataverseFieldLabel } from '@/components/DataverseFieldLabel';
import { MAX_PROMPTS_PER_TABLE } from '@/lib/sidecar-prompts';
import type { SidecarPromptDefinition, TargetTable } from '@/types/sidecar-admin-models';

const CONFIG_TABLE = 'maftagsc_sidecarconfiguration';
const PROMPTS_FIELD = 'maftagsc_prompts';

interface DraftPrompt {
  key: string;
  label: string;
  text: string;
  rolesText: string;
}
type DraftCatalog = Record<string, DraftPrompt[]>;
type PromptsByTable = Record<string, SidecarPromptDefinition[]>;

let promptKeySeed = 0;
function nextKey(): string {
  promptKeySeed += 1;
  return `prompt-${promptKeySeed}`;
}

function tablesToDraft(tables: TargetTable[]): DraftCatalog {
  const draft: DraftCatalog = {};
  for (const table of tables) {
    draft[table.logicalName] = (table.prompts ?? []).map((prompt) => ({
      key: nextKey(),
      label: prompt.label,
      text: prompt.text,
      rolesText: (prompt.roles ?? []).join(', '),
    }));
  }
  return draft;
}

function draftToPromptsByTable(draft: DraftCatalog): PromptsByTable {
  const result: PromptsByTable = {};
  for (const [logicalName, prompts] of Object.entries(draft)) {
    const cleaned: SidecarPromptDefinition[] = [];
    for (const prompt of prompts) {
      const label = prompt.label.trim();
      const text = prompt.text.trim();
      if (!label || !text) continue;
      const roles = [
        ...new Set(prompt.rolesText.split(',').map((role) => role.trim()).filter((role) => role.length > 0)),
      ];
      cleaned.push(roles.length ? { label, text, roles } : { label, text });
    }
    if (cleaned.length) result[logicalName] = cleaned;
  }
  return result;
}

function serverPromptsByTable(tables: TargetTable[]): PromptsByTable {
  const result: PromptsByTable = {};
  for (const table of tables) {
    if (table.prompts?.length) result[table.logicalName] = table.prompts;
  }
  return result;
}

const useStyles = makeStyles({
  card: { padding: tokens.spacingHorizontalL, gap: tokens.spacingVerticalM },
  intro: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS },
  muted: { color: tokens.colorNeutralForeground2 },
  table: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS, paddingBlock: tokens.spacingVerticalM, borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  tableHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: tokens.spacingHorizontalM },
  tableHeadButton: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, flexGrow: 1, minWidth: 0, backgroundColor: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' },
  chevron: { display: 'flex', alignItems: 'center', flexShrink: 0, color: tokens.colorNeutralForeground3 },
  toolbar: { display: 'flex', justifyContent: 'flex-end' },
  tableTitle: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS, minWidth: 0 },
  prompt: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS, padding: tokens.spacingHorizontalM, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground2, border: `1px solid ${tokens.colorNeutralStroke2}` },
  promptRowTop: { display: 'flex', gap: tokens.spacingHorizontalS, alignItems: 'flex-start' },
  label: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS },
  fieldLabel: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  empty: { color: tokens.colorNeutralForeground3, fontStyle: 'italic' },
  footer: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, paddingTop: tokens.spacingVerticalM, borderTop: `1px solid ${tokens.colorNeutralStroke2}`, flexWrap: 'wrap' },
});

interface SidecarPromptsEditorProps {
  tables: TargetTable[];
  busy: boolean;
  onSave: (promptsByTable: PromptsByTable) => Promise<void>;
}

export function SidecarPromptsEditor({ tables, busy, onSave }: SidecarPromptsEditorProps) {
  const styles = useStyles();

  const serverDraft = useMemo(() => tablesToDraft(tables), [tables]);
  const serverSignature = useMemo(() => JSON.stringify(serverPromptsByTable(tables)), [tables]);

  const [draft, setDraft] = useState<DraftCatalog>(serverDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const knownServerSignature = useRef(serverSignature);
  const [openTables, setOpenTables] = useState<Record<string, boolean>>({});

  const draftSignature = useMemo(() => JSON.stringify(draftToPromptsByTable(draft)), [draft]);
  const isDirty = draftSignature !== serverSignature;

  // Adopt refreshed server data (e.g. after a successful save) only when the user
  // has no pending local edits, so a background refetch never discards edits.
  useEffect(() => {
    if (knownServerSignature.current !== serverSignature) {
      if (draftSignature === knownServerSignature.current) setDraft(serverDraft);
      knownServerSignature.current = serverSignature;
    }
  }, [serverSignature, serverDraft, draftSignature]);

  const disabled = busy || saving;

  const allOpen = tables.length > 0 && tables.every((table) => openTables[table.logicalName]);
  const toggleTable = (logicalName: string) =>
    setOpenTables((current) => ({ ...current, [logicalName]: !current[logicalName] }));
  const toggleAll = () =>
    setOpenTables(allOpen ? {} : Object.fromEntries(tables.map((table) => [table.logicalName, true])));

  const updatePrompt = (logicalName: string, key: string, patch: Partial<DraftPrompt>) => {
    setDraft((current) => ({
      ...current,
      [logicalName]: (current[logicalName] ?? []).map((prompt) => (prompt.key === key ? { ...prompt, ...patch } : prompt)),
    }));
  };
  const addPrompt = (logicalName: string) => {
    setDraft((current) => ({
      ...current,
      [logicalName]: [...(current[logicalName] ?? []), { key: nextKey(), label: '', text: '', rolesText: '' }],
    }));
  };
  const removePrompt = (logicalName: string, key: string) => {
    setDraft((current) => ({
      ...current,
      [logicalName]: (current[logicalName] ?? []).filter((prompt) => prompt.key !== key),
    }));
  };

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onSave(draftToPromptsByTable(draft));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save suggested prompts.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={styles.card}>
      <div className={styles.intro}>
        <Title2 as="h2">Suggested prompts</Title2>
        <DataverseFieldLabel tableLogicalName={CONFIG_TABLE} fieldLogicalName={PROMPTS_FIELD} fallback="Suggested prompts" className={styles.fieldLabel} />
        <Text className={styles.muted}>
          Chips shown above the chat box on each table&apos;s form. Leave the roles field blank to show a prompt to everyone, or
          list one or more security role names (comma separated) to scope it. Up to {MAX_PROMPTS_PER_TABLE} prompts per table.
        </Text>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>
            <MessageBarTitle>Save failed</MessageBarTitle>
            {error}
          </MessageBarBody>
        </MessageBar>
      )}

      {tables.length === 0 && <Text className={styles.empty}>No bound tables yet. Deploy the sidecar to author prompts.</Text>}

      {tables.length > 0 && (
        <div className={styles.toolbar}>
          <Button appearance="subtle" size="small" icon={allOpen ? <ChevronUpRegular /> : <ChevronDownRegular />} onClick={toggleAll}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        </div>
      )}

      {tables.map((table) => {
        const prompts = draft[table.logicalName] ?? [];
        const open = !!openTables[table.logicalName];
        return (
          <div className={styles.table} key={table.logicalName}>
            <div className={styles.tableHead}>
              <button
                type="button"
                className={styles.tableHeadButton}
                aria-expanded={open}
                onClick={() => toggleTable(table.logicalName)}
              >
                <span className={styles.chevron} aria-hidden>
                  {open ? <ChevronDownRegular /> : <ChevronRightRegular />}
                </span>
                <span className={styles.tableTitle}>
                  <Text weight="semibold">{table.displayName}</Text>
                  <Text size={200} className={styles.muted}>{table.logicalName}</Text>
                </span>
              </button>
              <Badge appearance="tint" color={prompts.length ? 'brand' : 'informative'}>
                {prompts.length} prompt{prompts.length === 1 ? '' : 's'}
              </Badge>
            </div>

            {open && (
              <>
                {prompts.length === 0 && <Text className={styles.empty}>No prompts yet.</Text>}

                {prompts.map((prompt) => (
              <div className={styles.prompt} key={prompt.key}>
                <div className={styles.promptRowTop}>
                  <div className={styles.label}>
                    <Text className={styles.fieldLabel}>Chip label</Text>
                    <Input
                      value={prompt.label}
                      disabled={disabled}
                      maxLength={60}
                      placeholder="Summarize this record"
                      onChange={(_, data) => updatePrompt(table.logicalName, prompt.key, { label: data.value })}
                    />
                  </div>
                  <Button
                    appearance="subtle"
                    icon={<DeleteRegular />}
                    disabled={disabled}
                    aria-label="Remove prompt"
                    title="Remove prompt"
                    onClick={() => removePrompt(table.logicalName, prompt.key)}
                  />
                </div>
                <Text className={styles.fieldLabel}>Prompt text sent to the agent</Text>
                <Textarea
                  value={prompt.text}
                  disabled={disabled}
                  resize="vertical"
                  maxLength={400}
                  placeholder="Summarize this record, including status and any recent activity."
                  onChange={(_, data) => updatePrompt(table.logicalName, prompt.key, { text: data.value })}
                />
                <Text className={styles.fieldLabel}>Security roles (optional, comma separated)</Text>
                <Input
                  value={prompt.rolesText}
                  disabled={disabled}
                  placeholder="e.g. Salesperson, Sales Manager (blank = everyone)"
                  onChange={(_, data) => updatePrompt(table.logicalName, prompt.key, { rolesText: data.value })}
                />
              </div>
            ))}

                <div>
                  <Button
                    appearance="secondary"
                    icon={<AddRegular />}
                    disabled={disabled || prompts.length >= MAX_PROMPTS_PER_TABLE}
                    onClick={() => addPrompt(table.logicalName)}
                  >
                    Add prompt
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      })}

      {tables.length > 0 && (
        <div className={styles.footer}>
          <Button appearance="primary" icon={<SaveRegular />} disabled={disabled || !isDirty} onClick={save}>
            {saving ? 'Saving…' : 'Save prompts'}
          </Button>
          {isDirty ? <Text className={styles.muted}>Unsaved changes</Text> : <Text className={styles.muted}>All changes saved</Text>}
        </div>
      )}
    </Card>
  );
}

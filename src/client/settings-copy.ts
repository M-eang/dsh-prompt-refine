/**
 * Field list and draft conversions of the plugin's configuration page.
 *
 * The page edits the host's `Config` schema through the harness' shared
 * settings machinery, so the field set and order live here, in one place, and
 * both `SettingsCard.tsx` (the controls) and the locale dictionary
 * (`settings.field.<key>.label` / `.hint`) are derived from it. Keeping the
 * order explicit means the page renders the schema in a deliberate reading
 * order instead of whatever key order the schema object happens to have.
 *
 * The conversions are pure: a control's text becomes one wire operation
 * (`{ op: 'set', path: [key], value }` or `{ op: 'unset', path: [key] }`), and
 * a draft the field cannot parse is reported instead of being coerced, so an
 * unusable value blocks the save rather than silently writing something else.
 *
 * The key set must mirror `src/config.ts`'s `Config` schema: a key that is not
 * in the schema stages an edit the host will reject, and a schema field missing
 * here is simply not editable from the page. `tests/settings-page.test.ts`
 * locks both directions.
 * @module dsh-prompt-refine/client/settings-copy
 */

import { ENHANCE_MODES } from '../shared/modes'
import { ENHANCE_TEMPLATES } from '../shared/templates'

/** How one field is rendered and parsed. */
export type SettingsFieldKind = 'boolean' | 'number' | 'text' | 'enum'

/** One configurable field of the host `Config` schema. */
export interface SettingsField {
  /** Key inside the `prompt-enhance` settings namespace. */
  key: string
  /** Control and conversion kind. */
  kind: SettingsFieldKind
  /** Accepted literals for an `enum` field. */
  values?: readonly string[]
}

/** Every field the page edits, in render order. */
export const SETTINGS_FIELDS: readonly SettingsField[] = [
  { key: 'enabled', kind: 'boolean' },
  { key: 'provider', kind: 'text' },
  { key: 'model', kind: 'text' },
  { key: 'temperature', kind: 'number' },
  { key: 'mode', kind: 'enum', values: ENHANCE_MODES },
  // 空值不在 values 里：选择器的空选项就是「跟随 schema 默认」，即不使用模板
  // （`settings.template.none` 是它的本地化标题）。把 `''` 放进来会出现两个
  // 同值的空选项。
  { key: 'template', kind: 'enum', values: ENHANCE_TEMPLATES },
  { key: 'strategyMode', kind: 'enum', values: ['replace-default', 'extend-default'] },
  { key: 'systemPrompt', kind: 'text' },
  { key: 'shortcut', kind: 'text' },
  { key: 'maxOutputTokens', kind: 'number' },
  { key: 'maxInputChars', kind: 'number' },
  { key: 'timeoutMs', kind: 'number' },
  { key: 'maxConcurrent', kind: 'number' },
  { key: 'rateLimitPerMinute', kind: 'number' },
  { key: 'streaming', kind: 'boolean' },
  { key: 'fidelity', kind: 'boolean' },
  { key: 'fidelityRepair', kind: 'boolean' },
  { key: 'contextAware', kind: 'boolean' },
  { key: 'contextMaxMessages', kind: 'number' },
  { key: 'contextMaxChars', kind: 'number' },
  { key: 'workspaceAware', kind: 'boolean' },
  { key: 'workspaceRoot', kind: 'text' },
  { key: 'workspaceMaxDepth', kind: 'number' },
  { key: 'workspaceTreeMax', kind: 'number' },
  { key: 'workspaceMaxFiles', kind: 'number' },
  { key: 'workspaceMaxFileChars', kind: 'number' },
  { key: 'workspaceMaxChars', kind: 'number' },
  // Prompt armor: the host-side block that goes above every assembled
  // section. Grouped last because it is the only group that changes what the
  // model is told rather than how the rewrite is produced.
  { key: 'armorEnabled', kind: 'boolean' },
  { key: 'armorFile', kind: 'text' },
  { key: 'armorText', kind: 'text' },
  { key: 'armorOrder', kind: 'number' },
  // The rewrite call's own stance: whether the auxiliary call is framed as a
  // mechanical rewrite (and retried once) instead of letting a provider's
  // declination come back as the result.
  { key: 'rewriterArmor', kind: 'boolean' },
]

/** Every field key, for the mirror checks. */
export const SETTINGS_FIELD_KEYS: readonly string[] = SETTINGS_FIELDS.map((entry) => entry.key)

/**
 * One field operation of the host's settings mutation wire, as
 * `configForms.get(ns).mutate()` accepts it.
 */
export interface SettingsOp {
  /** `set` writes the value, `unset` drops the namespace override. */
  op: 'set' | 'unset'
  /** Field path inside the namespace section; always one scalar field here. */
  path: readonly string[]
  /** The value a `set` carries. */
  value?: unknown
}

/** Words a boolean field accepts, so a typed draft is never silently rewritten. */
const TRUE_WORDS = ['true', '1', 'on', 'yes']
/** @see TRUE_WORDS */
const FALSE_WORDS = ['false', '0', 'off', 'no']

/**
 * Render one effective host value as the text its control shows.
 *
 * An absent value renders empty, which is also what "unset" shows, so the
 * control's text is exactly the user's override or the host's default.
 * @param entry - one field entry.
 * @param value - the effective (override-else-default) value of that field.
 * @returns the control text.
 */
export function formatDraft(entry: SettingsField, value: unknown): string {
  if (entry.kind === 'boolean') {
    if (value === true) return 'true'
    if (value === false) return 'false'
    return ''
  }
  if (value === undefined || value === null) return ''
  return String(value)
}

/**
 * Parse one control's text into the operation it stages.
 *
 * Empty always means "leave the default in place" (`unset`), never an empty
 * string written over a field the schema constrains — that is what makes the
 * page's reset control work for every kind, including the ones whose default
 * is a non-empty string.
 * @param entry - one field entry.
 * @param text - the control text as typed.
 * @returns the operation, or `undefined` when the text is unusable.
 */
export function parseDraft(entry: SettingsField, text: string): SettingsOp | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return { op: 'unset', path: [entry.key] }
  if (entry.kind === 'boolean') {
    const word = trimmed.toLowerCase()
    if (TRUE_WORDS.includes(word)) return { op: 'set', path: [entry.key], value: true }
    if (FALSE_WORDS.includes(word)) return { op: 'set', path: [entry.key], value: false }
    return undefined
  }
  if (entry.kind === 'number') {
    const value = Number(trimmed)
    return Number.isFinite(value) ? { op: 'set', path: [entry.key], value } : undefined
  }
  if (entry.kind === 'enum') {
    return (entry.values ?? []).includes(trimmed)
      ? { op: 'set', path: [entry.key], value: trimmed }
      : undefined
  }
  // Free text keeps the exact draft (a prompt's own spacing is the user's).
  return { op: 'set', path: [entry.key], value: text }
}

/**
 * The operations one staged save writes, in field order.
 *
 * Only touched fields take part, so an untouched page emits nothing. A touched
 * field that already holds the value it would write is skipped, which keeps a
 * save from inventing overrides the user never expressed; clearing a field that
 * has no override is skipped for the same reason (it would be a no-op write).
 * @param fields - the field list, in render order.
 * @param drafts - staged control texts, keyed by field.
 * @param effective - the effective (override-else-default) section values.
 * @param user - the namespace's own overrides.
 * @returns the operations to write and the keys whose drafts are unusable.
 */
export function buildOps(
  fields: readonly SettingsField[],
  drafts: Readonly<Record<string, string>>,
  effective: Readonly<Record<string, unknown>>,
  user: Readonly<Record<string, unknown>>,
): { ops: SettingsOp[]; invalid: string[] } {
  const ops: SettingsOp[] = []
  const invalid: string[] = []
  for (const entry of fields) {
    const text = drafts[entry.key]
    if (text === undefined) continue
    const parsed = parseDraft(entry, text)
    if (parsed === undefined) {
      invalid.push(entry.key)
      continue
    }
    const overridden = Object.prototype.hasOwnProperty.call(user, entry.key)
    if (parsed.op === 'unset') {
      if (overridden) ops.push(parsed)
      continue
    }
    const current = overridden ? user[entry.key] : effective[entry.key]
    if (current !== parsed.value) ops.push(parsed)
  }
  return { ops, invalid }
}

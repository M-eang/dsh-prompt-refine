/**
 * The plugin's own configuration page on the dsh Plugins panel.
 *
 * A bundle's loader row only grows a configure control while something
 * registers one: `ui-plugin-manager` draws it from its `plugins.row.config`
 * ledger, keyed by `<bundle package name>#<row id>`, and the page lives exactly
 * as long as the row that registered the key. Registering it here — inside the
 * bundle that declares the row — is the documented shape for a bundle's own
 * configuration, so `prompt-enhance` stays self-contained: no companion package
 * to install, and the page disappears with the row that owns it.
 *
 * The page owns its draft and its validation, as the panel's contract asks:
 * `form.state` is the namespace's current read (effective values, the
 * namespace's own overrides, the write revision, and whether the deployment is
 * writable) and `form.mutate` writes one revision-fenced batch of field
 * operations. Nothing is written until the user saves, and a failed write keeps
 * the draft so the user can fix it and retry.
 *
 * The controls are this bundle's own, styled with the host's `--dsw-alias-*`
 * theme tokens: the harness documents that a client package must not import
 * another Client package as a module, so the shared primitives are deliberately
 * not loaded here. Their markup, class names and behavior were copied (and
 * renamed under this plugin's prefix) instead.
 *
 * Reading the settings mirror live in `index.tsx` is what makes a saved value
 * reach the button, the guards and the shortcut immediately.
 * @module dsh-prompt-refine/client/SettingsCard
 */

import { useState, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  SETTINGS_FIELDS,
  buildOps,
  formatDraft,
  parseDraft,
  type SettingsField,
  type SettingsOp,
} from './settings-copy'
import { NS, type PromptEnhanceKey } from './locales'

/** Settings namespace (and loader row id) this page edits. */
export const SETTINGS_NAMESPACE = NS

/**
 * Package name of this bundle. `scripts/build.mjs` wraps `lib/client.js` under
 * `pkg.name`, and the loader row that mounts the browser half is the one whose
 * specifier equals that name, so the row key has to be spelled out here.
 */
export const PACKAGE_NAME = 'dsh-prompt-refine'

/**
 * `plugins.row.config` key of the row this page configures: the bundle whose
 * patch declares the row, then the row id. The row id is the settings namespace
 * (`prompt-enhance`) — see `cordis.patch.yml`.
 */
export const ROW_KEY = `${PACKAGE_NAME}#prompt-enhance`

/** One namespace read, as the panel hands it to the page for a render. */
export interface SettingsFormSnapshot {
  /** `loading` before the mirror's first answer, `unavailable` when the host has no such namespace. */
  status?: 'loading' | 'ready' | 'unavailable'
  /** Revision the next write must carry. */
  revision?: number
  /** Whether this deployment accepts writes at all. */
  writable?: boolean
  /** Where the values come from (`host`, or a non-persisting mode). */
  mode?: string
  /** Effective values: the namespace's overrides over the schema defaults. */
  value?: Readonly<Record<string, unknown>>
  /** The schema defaults. */
  base?: Readonly<Record<string, unknown>>
  /** The namespace's own overrides, keyed by field. */
  user?: Readonly<Record<string, unknown>>
}

/** The write seat the panel hands the page alongside the read. */
export interface SettingsFormSeat {
  /** The namespace read of this render. */
  state?: SettingsFormSnapshot
  /** Write one batch of field operations against a revision. */
  mutate?: (ops: SettingsOp[], revision?: number) => Promise<boolean>
}

/** Props the panel owns: its locale reader, the view, and the form seat. */
export interface SettingsCardProps {
  /** The bundle's locale reader, bound to its dictionary namespace. */
  t: TranslateNS<'prompt-enhance'>
  /** Which view the panel asks for; `page` draws the form. */
  view?: 'page' | 'summary'
  /** The host's read/write seat for this row's namespace. */
  form?: SettingsFormSeat
}

/** One field row's props. */
interface FieldRowProps {
  entry: SettingsField
  t: TranslateNS<'prompt-enhance'>
  text: string
  invalid: boolean
  overridden: boolean
  disabled: boolean
  onEdit: (text: string) => void
  onReset: () => void
}

/**
 * Render one field: label and hint, the control its kind asks for, the reset
 * link while the field overrides the default, and the invalid message a draft
 * the field cannot parse shows instead of the hint.
 * @param props - the field entry, its staged text, its copy, and the edit actions.
 * @returns the control row.
 */
function FieldRow(props: FieldRowProps): ReactNode {
  const { entry, t } = props
  const id = `dsh-pe-set-${entry.key}`
  // Both copy keys are generated from SETTINGS_FIELDS, so every field has
  // them; the cast only bridges the template literal's widened `string` to
  // the dictionary's key union.
  const label = t(`settings.field.${entry.key}.label` as PromptEnhanceKey)
  const hint = t(`settings.field.${entry.key}.hint` as PromptEnhanceKey)

  const reset = props.overridden
    ? (
        <button
          type="button"
          className="dsh-pe-set-reset"
          title={t('settings.overridden')}
          disabled={props.disabled}
          onClick={props.onReset}
        >
          {t('settings.reset')}
        </button>
      )
    : null

  return (
    <div className="dsh-pe-set-field">
      <div className="dsh-pe-set-head">
        {entry.kind === 'boolean'
          ? (
              <label className="dsh-pe-set-check" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={props.text === 'true'}
                  disabled={props.disabled}
                  onChange={(event) => props.onEdit(event.target.checked ? 'true' : 'false')}
                />
                {label}
              </label>
            )
          : (
              <>
                <label className="dsh-pe-set-label" htmlFor={id}>{label}</label>
                {reset}
              </>
            )}
        {entry.kind === 'boolean' ? reset : null}
      </div>
      {entry.kind === 'boolean'
        ? null
        : entry.kind === 'enum'
          ? (
              <select
                id={id}
                className="dsh-pe-set-input"
                value={props.text}
                disabled={props.disabled}
                aria-invalid={props.invalid}
                onChange={(event) => props.onEdit(event.target.value)}
              >
                {/* 模板与档位的取值都是英文 id，选项必须本地化；其余枚举（策略
                    组合方式）的值本身就是可读词，直接显示。 */}
                <option value="">{entry.key === 'template' ? t('settings.template.none') : t('settings.default')}</option>
                {(entry.values ?? []).map((value) => (
                  <option key={value} value={value}>
                    {entry.key === 'template'
                      ? t(`settings.template.${value}` as PromptEnhanceKey)
                      : entry.key === 'mode'
                        ? t(`settings.mode.${value}` as PromptEnhanceKey)
                        : value}
                  </option>
                ))}
              </select>
            )
          : (
              <input
                id={id}
                className="dsh-pe-set-input"
                type="text"
                inputMode={entry.kind === 'number' ? 'numeric' : undefined}
                value={props.text}
                disabled={props.disabled}
                aria-invalid={props.invalid}
                onChange={(event) => props.onEdit(event.target.value)}
              />
            )}
      {props.invalid
        ? <p className="dsh-pe-set-invalid">{t('settings.invalid')}</p>
        : <p className="dsh-pe-set-hint">{hint}</p>}
    </div>
  )
}

/**
 * Render the configuration page, or its one-liner where the panel asks for a
 * summary.
 * @param props - the view asked for, the locale reader, and the host's form seat.
 * @returns the summary line, a status note, or the settings form.
 */
export function SettingsCard(props: SettingsCardProps): ReactNode {
  const { t, view } = props
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  if (view === 'summary') return t('settings.summary')

  const state = props.form?.state
  const mutate = props.form?.mutate
  if (state === undefined || mutate === undefined) {
    return <p className="dsh-pe-set-note">{t('settings.unavailable')}</p>
  }
  if (state.status === 'loading') return <p className="dsh-pe-set-note">{t('settings.saving')}</p>
  if (state.status === 'unavailable') {
    return <p className="dsh-pe-set-note">{t('settings.unavailable')}</p>
  }

  const effective = state.value ?? {}
  const user = state.user ?? {}
  const writable = state.writable === true
  const disabled = !writable || saving
  const { ops, invalid } = buildOps(SETTINGS_FIELDS, drafts, effective, user)
  const rows = SETTINGS_FIELDS.map((entry) => {
    const text = draftTextOf(entry, drafts, effective)
    // A touched field the conversion rejects, or a control whose text cannot
    // be read back at all, blocks the save instead of being coerced.
    return { entry, text, invalid: invalid.includes(entry.key) || parseDraft(entry, text) === undefined }
  })
  const staged = Object.keys(drafts)

  const edit = (key: string, text: string): void => {
    setFailed(false)
    setDrafts((previous) => ({ ...previous, [key]: text }))
  }
  const reset = (key: string): void => {
    setFailed(false)
    setDrafts((previous) => ({ ...previous, [key]: '' }))
  }
  const discard = (): void => {
    setFailed(false)
    setDrafts({})
  }
  const save = async (): Promise<void> => {
    if (!writable || saving || invalid.length > 0 || ops.length === 0) return
    setSaving(true)
    setFailed(false)
    try {
      const accepted = await mutate(ops, state.revision)
      if (accepted) setDrafts({})
      else setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="dsh-pe-set-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      {writable ? null : <p className="dsh-pe-set-note">{t('settings.readOnly')}</p>}
      {rows.map(({ entry, text, invalid: bad }) => (
        <FieldRow
          key={entry.key}
          entry={entry}
          t={t}
          text={text}
          invalid={bad}
          overridden={Object.prototype.hasOwnProperty.call(user, entry.key)}
          disabled={disabled}
          onEdit={(next) => edit(entry.key, next)}
          onReset={() => reset(entry.key)}
        />
      ))}
      <div className="dsh-pe-set-footer">
        {failed ? <p className="dsh-pe-set-failed" role="alert">{t('settings.saveFailed')}</p> : <span className="dsh-pe-set-message" />}
        <button
          type="button"
          className="dsh-pe-set-discard"
          disabled={disabled || staged.length === 0}
          onClick={discard}
        >
          {t('settings.discard')}
        </button>
        <button
          type="submit"
          className="dsh-pe-set-save"
          disabled={disabled || invalid.length > 0 || ops.length === 0}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </form>
  )
}

/** Draft text of one field, as the page renders it. */
export function draftTextOf(
  entry: SettingsField,
  drafts: Readonly<Record<string, string>>,
  effective: Readonly<Record<string, unknown>>,
): string {
  return drafts[entry.key] ?? formatDraft(entry, effective[entry.key])
}

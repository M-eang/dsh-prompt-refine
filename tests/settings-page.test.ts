/**
 * The configuration page's field list and draft conversions.
 *
 * The page writes through the host's shared settings machinery, so the two
 * contracts worth locking are the ones that would fail silently: the field list
 * mirroring the `Config` schema in both directions (a key outside the schema
 * stages a write the host rejects; a schema key missing here is simply not
 * editable), and the draft conversions — empty means "drop the override" for
 * every kind, unusable input is reported instead of coerced, and an untouched
 * or already-matching field stages nothing.
 * @module tests/settings-page
 */

import { describe, expect, it } from 'vitest'
import { Config } from '../src/config'
import {
  SETTINGS_FIELDS,
  SETTINGS_FIELD_KEYS,
  buildOps,
  formatDraft,
  parseDraft,
  type SettingsField,
} from '../src/client/settings-copy'

/** The entry of one key, failing loudly when the list drifts. */
function field(key: string): SettingsField {
  const found = SETTINGS_FIELDS.find((entry) => entry.key === key)
  if (found === undefined) throw new Error(`unknown field: ${key}`)
  return found
}

describe('settings field list', () => {
  it('mirrors the config schema keys in both directions', () => {
    const schemaKeys = Object.keys((Config as unknown as { dict: Record<string, unknown> }).dict).sort()
    expect([...SETTINGS_FIELD_KEYS].sort()).toEqual(schemaKeys)
  })

  it('lists every field once, opening with the master switch', () => {
    expect(new Set(SETTINGS_FIELD_KEYS).size).toBe(SETTINGS_FIELD_KEYS.length)
    expect(SETTINGS_FIELD_KEYS[0]).toBe('enabled')
    expect(SETTINGS_FIELD_KEYS).toContain('fidelity')
    expect(SETTINGS_FIELD_KEYS).toContain('fidelityRepair')
  })

  it('declares the accepted literals of the enum field', () => {
    expect(field('strategyMode').values).toEqual(['replace-default', 'extend-default'])
  })
})

describe('formatDraft', () => {
  it('renders booleans as the words the control round-trips', () => {
    expect(formatDraft(field('enabled'), true)).toBe('true')
    expect(formatDraft(field('enabled'), false)).toBe('false')
  })

  it('renders an absent value as empty, whatever the kind', () => {
    expect(formatDraft(field('enabled'), undefined)).toBe('')
    expect(formatDraft(field('temperature'), undefined)).toBe('')
    expect(formatDraft(field('systemPrompt'), undefined)).toBe('')
  })

  it('renders numbers and text as their scalar', () => {
    expect(formatDraft(field('temperature'), 0.3)).toBe('0.3')
    expect(formatDraft(field('workspaceRoot'), 'D:\\proj')).toBe('D:\\proj')
  })
})

describe('parseDraft', () => {
  it('reads empty as dropping the override, for every kind', () => {
    for (const entry of SETTINGS_FIELDS) {
      expect(parseDraft(entry, '   ')).toEqual({ op: 'unset', path: [entry.key] })
    }
  })

  it('parses boolean words in either case and rejects anything else', () => {
    expect(parseDraft(field('fidelity'), ' On ')).toEqual({ op: 'set', path: ['fidelity'], value: true })
    expect(parseDraft(field('fidelity'), 'NO')).toEqual({ op: 'set', path: ['fidelity'], value: false })
    expect(parseDraft(field('fidelity'), 'maybe')).toBeUndefined()
  })

  it('parses finite numbers only', () => {
    expect(parseDraft(field('timeoutMs'), '60000')).toEqual({ op: 'set', path: ['timeoutMs'], value: 60000 })
    expect(parseDraft(field('temperature'), '0.05')).toEqual({ op: 'set', path: ['temperature'], value: 0.05 })
    expect(parseDraft(field('timeoutMs'), 'soon')).toBeUndefined()
  })

  it('accepts only the declared enum literals', () => {
    expect(parseDraft(field('strategyMode'), 'extend-default'))
      .toEqual({ op: 'set', path: ['strategyMode'], value: 'extend-default' })
    expect(parseDraft(field('strategyMode'), 'replace')).toBeUndefined()
  })

  it('keeps free text verbatim, including its own spacing', () => {
    expect(parseDraft(field('systemPrompt'), '  You are a planner.  '))
      .toEqual({ op: 'set', path: ['systemPrompt'], value: '  You are a planner.  ' })
  })
})

describe('buildOps', () => {
  it('stages nothing for an untouched page', () => {
    expect(buildOps(SETTINGS_FIELDS, {}, { enabled: true }, {})).toEqual({ ops: [], invalid: [] })
  })

  it('skips a draft that already equals the effective value', () => {
    expect(buildOps([field('temperature')], { temperature: '0.3' }, { temperature: 0.3 }, {}).ops).toEqual([])
  })

  it('sets a changed scalar', () => {
    expect(buildOps([field('temperature')], { temperature: '0.7' }, { temperature: 0.3 }, {}).ops)
      .toEqual([{ op: 'set', path: ['temperature'], value: 0.7 }])
  })

  it('clears an overridden field and leaves an unoverridden one alone', () => {
    expect(buildOps([field('temperature')], { temperature: '' }, { temperature: 0.5 }, { temperature: 0.5 }).ops)
      .toEqual([{ op: 'unset', path: ['temperature'] }])
    expect(buildOps([field('temperature')], { temperature: '' }, { temperature: 0.3 }, {}).ops).toEqual([])
  })

  it('compares against the override when there is one', () => {
    expect(buildOps([field('enabled')], { enabled: 'false' }, { enabled: false }, { enabled: false }).ops).toEqual([])
    expect(buildOps([field('enabled')], { enabled: 'true' }, { enabled: false }, { enabled: false }).ops)
      .toEqual([{ op: 'set', path: ['enabled'], value: true }])
  })

  it('reports unusable drafts and keeps the rest writable', () => {
    const result = buildOps(
      [field('temperature'), field('workspaceRoot')],
      { temperature: 'hot', workspaceRoot: 'D:/p' },
      { temperature: 0.3, workspaceRoot: '' },
      {},
    )
    expect(result.invalid).toEqual(['temperature'])
    expect(result.ops).toEqual([{ op: 'set', path: ['workspaceRoot'], value: 'D:/p' }])
  })
})

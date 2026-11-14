/**
 * Locale-dictionary integrity, including the regression lock for the wire
 * `reason` → dictionary-key mapping the preview panel uses.
 *
 * The bug this file exists for: `params.reason` arrives kebab-case
 * (`invalid-credential`, `rate-limit`, `context-window`, `tool-call`,
 * `max-tokens`) while the dictionary keys are camelCase
 * (`error.upstream.invalidCredential`, …). Composing the key as
 * `` `error.upstream.${reason}` `` therefore missed five of the eight reasons
 * and silently rendered the generic `error.upstream` line, even though the
 * specific copy was already shipped. The mapping is now an explicit table
 * (`UPSTREAM_ERROR_KEYS`); these assertions fail if a key is ever added to the
 * table without shipped copy, or the tables drift apart again.
 * @module tests/locales
 */

import { describe, expect, it } from 'vitest'
import { en, isPromptEnhanceKey, zh, type PromptEnhanceKey } from '../src/client/locales'
import { CLIENT_DETAIL_KEYS } from '../src/client/enhance-client'
import { REJECTED_REASON_KEYS, UPSTREAM_ERROR_KEYS } from '../src/client/ResultPanel'

/** Every wire reason `UpstreamReason` declares (src/enhancer.ts). */
const WIRE_REASONS = [
  'auth',
  'invalid-credential',
  'rate-limit',
  'quota',
  'empty',
  'context-window',
  'tool-call',
  'max-tokens',
  'refused',
] as const

describe('locale dictionaries', () => {
  it('ships the same key set in zh and en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('has non-empty copy for every key in both dictionaries', () => {
    for (const key of Object.keys(zh) as PromptEnhanceKey[]) {
      expect(String(zh[key]).trim(), `zh['${key}']`).not.toBe('')
      expect(String(en[key]).trim(), `en['${key}']`).not.toBe('')
    }
  })
})

describe('UPSTREAM_ERROR_KEYS (wire reason → dictionary key)', () => {
  it('maps every wire reason the host can send', () => {
    for (const reason of WIRE_REASONS) {
      expect(UPSTREAM_ERROR_KEYS[reason], `missing mapping for '${reason}'`).toBeDefined()
    }
    // No extra entries: the table must not grow beyond the wire vocabulary
    // without the host side gaining the same reason.
    expect(Object.keys(UPSTREAM_ERROR_KEYS).sort()).toEqual([...WIRE_REASONS].sort())
  })

  it('points every entry at copy that actually exists in both dictionaries', () => {
    for (const [reason, key] of Object.entries(UPSTREAM_ERROR_KEYS)) {
      expect(zh[key], `zh is missing '${key}' (reason '${reason}')`).toBeTruthy()
      expect(en[key], `en is missing '${key}' (reason '${reason}')`).toBeTruthy()
    }
  })

  it('keeps the wire vocabulary distinct — no reason may alias another', () => {
    expect(new Set(Object.values(UPSTREAM_ERROR_KEYS)).size).toBe(Object.keys(UPSTREAM_ERROR_KEYS).length)
  })
})

/** Every routed refusal reason `EnhanceRejectReason` declares (src/shared/protocol.ts). */
const REFUSAL_REASONS = [
  'content-type',
  'body-too-large',
  'invalid-json',
  'invalid-body',
  'disabled',
] as const

describe('REJECTED_REASON_KEYS (routed refusal → dictionary key)', () => {
  it('maps every refusal reason the host can send', () => {
    for (const reason of REFUSAL_REASONS) {
      expect(REJECTED_REASON_KEYS[reason], `missing mapping for '${reason}'`).toBeDefined()
    }
    // No extra entries: the table must not grow past the wire vocabulary.
    expect(Object.keys(REJECTED_REASON_KEYS).sort()).toEqual([...REFUSAL_REASONS].sort())
  })

  it('points every entry at copy that actually exists in both dictionaries', () => {
    for (const [reason, key] of Object.entries(REJECTED_REASON_KEYS)) {
      expect(zh[key], `zh is missing '${key}' (reason '${reason}')`).toBeTruthy()
      expect(en[key], `en is missing '${key}' (reason '${reason}')`).toBeTruthy()
    }
  })

  it('never resolves to the generic rejection line', () => {
    for (const key of Object.values(REJECTED_REASON_KEYS)) {
      expect(zh[key]).not.toBe(zh['error.rejected'])
      expect(en[key]).not.toBe(en['error.rejected'])
    }
  })

  it('keeps the refusal vocabulary distinct — no reason may alias another', () => {
    expect(new Set(Object.values(REJECTED_REASON_KEYS)).size).toBe(Object.keys(REJECTED_REASON_KEYS).length)
  })
})

describe('CLIENT_DETAIL_KEYS (browser-side detail lines)', () => {
  it('ships every key the browser half can attach', () => {
    expect(CLIENT_DETAIL_KEYS.length).toBeGreaterThan(0)
    for (const key of CLIENT_DETAIL_KEYS) {
      expect(zh[key], `zh is missing '${key}'`).toBeTruthy()
      expect(en[key], `en is missing '${key}'`).toBeTruthy()
    }
  })

  it('keeps the set distinct, namespaced and free of the primary-line keys', () => {
    expect(new Set(CLIENT_DETAIL_KEYS).size).toBe(CLIENT_DETAIL_KEYS.length)
    for (const key of CLIENT_DETAIL_KEYS) {
      expect(key.startsWith('detail.'), `${key} is not a detail key`).toBe(true)
      // A detail key must never be one of the primary-line keys.
      expect(key.startsWith('error.')).toBe(false)
    }
  })
})

describe('isPromptEnhanceKey', () => {
  it('accepts shipped keys and rejects everything else', () => {
    expect(isPromptEnhanceKey('error.disabled')).toBe(true)
    expect(isPromptEnhanceKey('detail.unreachable')).toBe(true)
    for (const key of CLIENT_DETAIL_KEYS) expect(isPromptEnhanceKey(key)).toBe(true)
    expect(isPromptEnhanceKey('brand.new.key')).toBe(false)
    expect(isPromptEnhanceKey('')).toBe(false)
    // A near-miss must not pass: the panel renders localized copy, never a key.
    expect(isPromptEnhanceKey('error.disabled ')).toBe(false)
    expect(isPromptEnhanceKey('Error.disabled')).toBe(false)
  })
})

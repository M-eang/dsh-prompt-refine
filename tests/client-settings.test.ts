import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config'
import { decodeClientSettings, DEFAULT_CLIENT_SETTINGS } from '../src/client/settings'

describe('decodeClientSettings', () => {
  it('returns defaults for a missing or malformed section', () => {
    expect(decodeClientSettings(undefined)).toEqual(DEFAULT_CLIENT_SETTINGS)
    expect(decodeClientSettings(null)).toEqual(DEFAULT_CLIENT_SETTINGS)
    expect(decodeClientSettings('nope')).toEqual(DEFAULT_CLIENT_SETTINGS)
  })

  it('reads well-formed fields', () => {
    expect(
      decodeClientSettings({ enabled: false, maxInputChars: 8000, shortcut: 'ctrl+shift+e', streaming: false, mode: 'engineering' }),
    ).toEqual({ enabled: false, maxInputChars: 8000, shortcut: 'ctrl+shift+e', streaming: false, mode: 'engineering' })
  })

  it('falls back field-by-field on bad values', () => {
    expect(decodeClientSettings({ enabled: 'yes', maxInputChars: -5, shortcut: 7, streaming: 'no' })).toEqual(DEFAULT_CLIENT_SETTINGS)
    expect(decodeClientSettings({ maxInputChars: 4096.9 }).maxInputChars).toBe(4096)
    expect(decodeClientSettings({ mode: 'verbose' }).mode).toBe('standard')
    expect(decodeClientSettings({ mode: 7 }).mode).toBe('standard')
  })

  it('keeps streaming on by default and off only when explicitly false', () => {
    expect(decodeClientSettings({}).streaming).toBe(true)
    expect(decodeClientSettings({ streaming: false }).streaming).toBe(false)
  })
})

describe('client mirror vs the host defaults', () => {
  it('mirrors each declared value from the host DEFAULT_CONFIG', () => {
    expect(DEFAULT_CLIENT_SETTINGS.enabled).toBe(DEFAULT_CONFIG.enabled)
    expect(DEFAULT_CLIENT_SETTINGS.maxInputChars).toBe(DEFAULT_CONFIG.maxInputChars)
    expect(DEFAULT_CLIENT_SETTINGS.shortcut).toBe(DEFAULT_CONFIG.shortcut)
    expect(DEFAULT_CLIENT_SETTINGS.streaming).toBe(DEFAULT_CONFIG.streaming)
    expect(DEFAULT_CLIENT_SETTINGS.mode).toBe(DEFAULT_CONFIG.mode)
  })

  it('declares exactly the five fields the browser half reads', () => {
    // The seven `workspace*` scan bounds are host-only: the host reads them
    // while assembling the request, and no guard, label or budget in the
    // browser half depends on them. Mirroring them would create a second set of
    // defaults to keep in sync for nothing.
    expect(Object.keys(DEFAULT_CLIENT_SETTINGS).sort()).toEqual(['enabled', 'maxInputChars', 'mode', 'shortcut', 'streaming'])
    const hostOnly = ['workspaceAware', 'workspaceRoot', 'workspaceMaxDepth', 'workspaceTreeMax', 'workspaceMaxFiles', 'workspaceMaxFileChars', 'workspaceMaxChars']
    for (const field of hostOnly) {
      expect(field in DEFAULT_CLIENT_SETTINGS, `${field} must stay host-only`).toBe(false)
      expect(field in DEFAULT_CONFIG, `${field} must exist on the host side`).toBe(true)
    }
  })
})

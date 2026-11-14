// @vitest-environment jsdom
/**
 * The browser half's boot contract: `apply` must survive a shell that provides
 * NONE of the optional services.
 *
 * Why this is a test and not just a comment: DSH loads a plugin only while
 * every service named in its exported `inject` is available
 * (`Plugin.Base.inject` — "Services the plugin requires; it only loads while
 * all are available"). A plugin that hard-declares an optional service —
 * `settingsScope` from the optional settings surface, or `slots`/`locale` from
 * UI packages a minimal profile need not bundle — sits `pending` forever, and
 * the shell reports it as a boot failure on a blank page
 * ("web boot: 1 entry did not activate"). That takes the whole GUI down instead
 * of degrading.
 *
 * These assertions lock the actual contract: the entry declares no required
 * services, and applying it against a context that provides nothing completes
 * with its shortcut effect installed.
 * @module tests/client-apply
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index'
import * as ui from '../src/client/ui-state'
import { DEFAULT_CLIENT_SETTINGS, getClientSettings, setClientSettings } from '../src/client/settings'

beforeEach(() => {
  // The mirror is module-level state; start every case from the shipped default.
  setClientSettings({
    enabled: true,
    maxInputChars: 12000,
    shortcut: 'ctrl+alt+e',
    streaming: true,
    mode: 'standard',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  ui.closePanel()
})

/**
 * A context providing nothing but the machinery `apply` itself uses.
 *
 * `ctx.inject` deliberately does NOT invoke its callback: that is exactly the
 * shell behavior when a service never mounts, and it is the case under test.
 * Effects run immediately, mirroring cordis (whose effect bodies execute on
 * registration), and their disposers are collected.
 */
function bareContext(): { ctx: ClientContext; disposers: (() => void)[] } {
  const disposers: (() => void)[] = []
  const ctx = {
    effect(execute: () => unknown, _label?: string): () => void {
      const disposer = execute()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return () => {}
    },
    inject(): void {
      // No services here, so no wiring callback ever runs.
    },
  } as unknown as ClientContext
  return { ctx, disposers }
}

describe('browser half boot', () => {
  it('declares no required services', () => {
    // An `inject` entry that never mounts fails the whole web boot, so this
    // list must stay empty; every optional service rides `ctx.inject`.
    expect(inject).toEqual([])
  })
  it('applies against a shell with no optional services, without throwing', () => {
    const { ctx } = bareContext()
    expect(() => apply(ctx)).not.toThrow()
  })

  it('installs the global shortcut listener and registers its disposer', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener')
    const { ctx, disposers } = bareContext()
    apply(ctx)
    expect(addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    // One effect (the shortcut) survives even with no locale/slots/settingsScope.
    expect(disposers).toHaveLength(1)
    expect(() => disposers[0]!()).not.toThrow()
  })

  it('falls back to the bundled settings mirror instead of an unset one', () => {
    // The mirror must be populated by `apply` itself, not only by a scope
    // callback: with no settings surface there is no callback at all.
    setClientSettings({ enabled: false, maxInputChars: 1, shortcut: '', streaming: false, mode: 'standard' })
    const { ctx } = bareContext()
    apply(ctx)
    const settings = getClientSettings()
    expect(settings.enabled).toBe(true)
    expect(settings.shortcut).toBe('ctrl+alt+e')
    expect(settings.maxInputChars).toBeGreaterThan(1000)
  })
})

/**
 * A context that provides exactly the named services.
 *
 * Contract under test: `ctx.inject(deps, cb)` runs `cb` only while every named
 * service is mounted — so a stub that invokes it for `configForms` while
 * withholding `settingsScope` reproduces a dsh 0.2.x shell, and vice versa for
 * the older rc line.
 * @param services - the mounted services, keyed by name.
 * @returns the context, the collected effect disposers, and the wiring count.
 */
function servicesContext(services: Record<string, unknown>): {
  ctx: ClientContext
  disposers: (() => void)[]
  wired: string[]
} {
  const disposers: (() => void)[] = []
  const wired: string[] = []
  const ctx: Record<string, unknown> = {
    ...services,
    effect(execute: () => unknown, label?: string): () => void {
      const disposer = execute()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      if (label !== undefined) wired.push(label)
      return () => {}
    },
    inject(deps: string[], callback: (inner: unknown) => unknown): void {
      if (deps.every((dep) => dep in services)) callback(ctx)
    },
  }
  return { ctx: ctx as unknown as ClientContext, disposers, wired }
}

describe('settings mirror', () => {
  /** A stand-in for one namespace scope, with the two members the mirror reads. */
  function fakeScope(initial: unknown): {
    scope: { getSnapshot: () => { value?: unknown }; subscribe: (l: () => void) => () => void }
    publish: (next: unknown) => void
    listeners: number
  } {
    let value = initial
    const listeners: (() => void)[] = []
    return {
      scope: {
        getSnapshot: () => ({ value }),
        subscribe: (listener: () => void) => {
          listeners.push(listener)
          return () => {}
        },
      },
      publish: (next: unknown) => {
        value = next
        for (const listener of listeners) listener()
      },
      get listeners() {
        return listeners.length
      },
    }
  }

  it('binds the 0.2.x configForms service and follows a committed change', () => {
    setClientSettings(DEFAULT_CLIENT_SETTINGS)
    const fake = fakeScope({ enabled: false, maxInputChars: 8000, shortcut: 'ctrl+shift+e', streaming: false })
    const { ctx, wired } = servicesContext({ configForms: { get: () => fake.scope } })

    apply(ctx)

    // The published value reaches the mirror at bind time …
    expect(getClientSettings().shortcut).toBe('ctrl+shift+e')
    expect(getClientSettings().enabled).toBe(false)
    expect(fake.listeners).toBe(1)
    expect(wired.some((label) => label.includes('settings mirror'))).toBe(true)

    // … and again on every commit, with no second apply.
    fake.publish({ enabled: true, maxInputChars: 9000, shortcut: 'ctrl+shift+p', streaming: true })
    expect(getClientSettings().shortcut).toBe('ctrl+shift+p')
    expect(getClientSettings().maxInputChars).toBe(9000)
    expect(getClientSettings().enabled).toBe(true)
  })

  it('still binds the rc-line settingsScope service, and binds only one of the two', () => {
    setClientSettings(DEFAULT_CLIENT_SETTINGS)
    const fake = fakeScope({ enabled: false, shortcut: 'ctrl+shift+k' })
    const bind = vi.fn(() => fake.scope)
    // Both services mounted at once (a transitional shell): the first binding
    // wins, so the mirror must not double-subscribe.
    const { ctx } = servicesContext({
      configForms: { get: () => fake.scope },
      settingsScope: { bind },
    })

    apply(ctx)

    expect(bind).toHaveBeenCalledTimes(1)
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'prompt-enhance' }))
    expect(fake.listeners).toBe(1)
    expect(getClientSettings().shortcut).toBe('ctrl+shift+k')
  })

  it('handles a scope that publishes no value yet', () => {
    setClientSettings({ enabled: false, maxInputChars: 1, shortcut: '', streaming: false, mode: 'standard' })
    const fake = fakeScope(undefined)
    const { ctx } = servicesContext({ configForms: { get: () => fake.scope } })

    apply(ctx)

    expect(getClientSettings()).toEqual(DEFAULT_CLIENT_SETTINGS)
  })
})

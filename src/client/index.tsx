/**
 * Browser half of the prompt-enhance plugin: registers the composer
 * enhance button (conversation.input.right), the undo bar
 * (conversation.input.dock), the Plugins-panel configuration page
 * (plugins.row.config), the zh/en dictionaries, the settings mirror,
 * and the configurable global shortcut. Failure policy mirrors the
 * describe-image family: every optional wiring failure is caught and
 * logged-never-thrown, because the web shell fails the whole boot when a
 * plugin apply throws.
 * @module dsh-prompt-refine/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { EnhanceButton } from './EnhanceButton'
import { UndoBar } from './UndoBar'
import { ROW_KEY, SettingsCard } from './SettingsCard'
import * as ui from './ui-state'
import { dictionaries, NS } from './locales'
import { ensureStyles } from './styles'
import { matchesShortcut, parseShortcut } from './shortcut'
import { decodeClientSettings, getClientSettings, setClientSettings } from './settings'

/** Locale namespace of the browser half. */
export { NS }

// No hard service dependencies. Every service this half touches (`configForms`
// — or `settingsScope` on the older rc line — from the optional settings
// surface, `slots` and `locale` from the UI packages
// a given profile may or may not bundle) is reached through `ctx.inject`, which
// starts the wiring only if and when the service actually mounts. A service
// named here instead would make this entry sit `pending` forever on a profile
// that lacks it — and DSH treats a pending entry as a boot failure
// ("web boot: 1 entry did not activate"), taking the whole GUI down with it.
// The cost of that choice is degraded, never broken: a profile with no settings
// surface keeps the bundled default mirror, and one with no locale service
// renders dictionary keys instead of copy.
export const inject: string[] = []

/**
 * The shared configuration-forms service the 0.2.x shell mounts, declared
 * structurally on purpose.
 *
 * This bundle's dev dependency family is the `0.1.1-rc.x` line, which predates
 * that service and therefore carries no type for it — while the shell that
 * actually loads the bundle at runtime is 0.2.x and has dropped the
 * `settingsScope` service this half used to reach for. Declaring the two
 * members the mirror touches keeps one source file compiling against both
 * lines; naming the service in `inject` (which would make the entry sit
 * `pending` on a shell that lacks it) is exactly what the boot contract below
 * forbids.
 */
interface ConfigFormScope {
  getSnapshot(): { value?: unknown }
  subscribe(listener: () => void): () => void
}

/** @see ConfigFormScope */
interface ConfigFormsService {
  get(namespace: string): ConfigFormScope
}

/** Apply the browser half. */
export function apply(ctx: ClientContext): void {
  ensureStyles()

  // Dictionaries arrive with the locale service, which is optional here: a
  // profile without it renders dictionary keys instead of localized copy, but
  // the plugin must not block boot over that.
  ctx.inject(['locale'], (localeCtx: ClientContext) => {
    ctx.effect(() => {
      try {
        return localeCtx.locale.register(NS, dictionaries)
      } catch {
        return () => {}
      }
    }, 'dsh-prompt-refine: dictionaries')
  })

  // Baseline before anything optional mounts: the bundled mirror equals the
  // host `DEFAULT_CONFIG`, so a profile without the settings surface still gets
  // a working button, guards, and shortcut instead of an unset mirror.
  setClientSettings(decodeClientSettings(undefined))

  // The settings mirror: re-read on every committed change so the button,
  // the guards, and the shortcut follow Settings → 插件配置 live.
  //
  // Two service names exist in the wild and only one is mounted in a given
  // shell: dsh 0.2.x serves a plugin's namespace through the shared
  // `configForms` service, while the `settingsScope` service this half was
  // originally written against is what the `0.1.1-rc.x` line mounts. Reaching
  // for only one of them leaves the mirror permanently on its bundled defaults
  // — `enabled: false` never hides the button and a shortcut change never takes
  // effect. Both ride `ctx.inject` (never `inject`, see the boot contract
  // above), and whichever mounts first binds; the second one is a no-op.
  let mirrorBound = false

  const bindMirror = (read: () => unknown, subscribe: (sync: () => void) => () => void): void => {
    if (mirrorBound) return
    mirrorBound = true
    const sync = (): void => {
      setClientSettings(decodeClientSettings(read() ?? undefined))
    }
    sync()
    // The subscription disposer rides ctx.effect (ctx.inject only runs the
    // callback; it does not manage a returned disposer).
    ctx.effect(() => subscribe(sync), 'dsh-prompt-refine: settings mirror')
  }

  ctx.inject(['configForms'], (settingsCtx: ClientContext) => {
    const forms = (settingsCtx as unknown as { configForms: ConfigFormsService }).configForms
    const scope = forms.get(NS)
    bindMirror(() => scope.getSnapshot().value, (sync) => scope.subscribe(sync))
  })

  // The 0.1.1-rc.x line: the service this mirror was written against first.
  ctx.inject(['settingsScope'], (settingsCtx: ClientContext) => {
    const scope = settingsCtx.settingsScope.bind({ namespace: NS, decode: decodeClientSettings })
    bindMirror(() => scope.getSnapshot().value, (sync) => scope.subscribe(sync))
  })

  ctx.inject(['slots'], (slotsCtx: ClientContext) => {
    const slots = slotsCtx.slots
    return slots.inject('conversation.input.right', () => {
      try {
        return slots.register(
          { name: 'conversation.input.right', id: 'prompt-enhance', order: 60, locale: NS },
          EnhanceButton,
        )
      } catch {
        return () => {}
      }
    })
  })

  ctx.inject(['slots'], (slotsCtx: ClientContext) => {
    const slots = slotsCtx.slots
    return slots.inject('conversation.input.dock', () => {
      try {
        return slots.register(
          { name: 'conversation.input.dock', id: 'prompt-enhance-undo', order: 90, locale: NS },
          UndoBar,
        )
      } catch {
        return () => {}
      }
    })
  })

  // The bundle's own configuration page on the Plugins panel. The panel grows a
  // configure control for a row once something registers its key, and a bundle
  // registering its own row key is the documented shape — `prompt-enhance`
  // therefore needs no companion package, and the page lives exactly as long as
  // the row. On a shell whose Plugins panel never declares the owner slot the
  // injection simply stays pending: nothing to register against, nothing broken.
  ctx.inject(['slots'], (slotsCtx: ClientContext) => {
    const slots = slotsCtx.slots
    return slots.inject('plugins.row.config', () => {
      try {
        return slots.register({ name: 'plugins.row.config', key: ROW_KEY, locale: NS }, SettingsCard)
      } catch {
        return () => {}
      }
    })
  })

  // The configurable shortcut: acts on the composer the user is working in;
  // never swallows keys unless the exact combo matches.
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return
      const combo = parseShortcut(getClientSettings().shortcut)
      if (!matchesShortcut(event, combo)) return
      const target = ui.shortcutTarget()
      if (target === undefined) return
      event.preventDefault()
      event.stopPropagation()
      target()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, 'dsh-prompt-refine: shortcut')
}

// @vitest-environment jsdom
/**
 * One fact, four spellings: the package name, the patch's row id, the Plugins
 * panel slot key, and the settings namespace.
 *
 * The panel matches a configuration page to a roster row by key
 * (`<package>#<row id>`, dsh-client-ui-plugin-manager `README.zh.md` §配置页)
 * and then hands that page the form seat of the row's own id (`formFor(rowId)`
 * in its `plugin-page` half). The client bundle is mounted on the row whose
 * specifier equals the package name. A drift between any two of those fails
 * silently — the row never grows a Configure control, or the page opens with no
 * seat and can only report "unavailable" — and nothing else in this suite reads
 * the patch, so this file is that guard.
 * @module tests/wiring
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { PACKAGE_NAME, ROW_KEY } from '../src/client/SettingsCard'
import { NS } from '../src/client/locales'
import { apply } from '../src/client/index'
import { PROMPT_ENHANCE_NAMESPACE } from '../src/config'

/** The one row this bundle's patch inserts, as the plugin manager reads it. */
function patchRow(): { id: string; name: string } {
  const text = readFileSync(resolve(process.cwd(), 'cordis.patch.yml'), 'utf8')
  const row = /insert:\s*\n\s*-\s+id:\s*(\S+)\s*\n\s+name:\s*(\S+)/u.exec(text)
  const [, id, name] = row ?? []
  if (id === undefined || name === undefined) throw new Error('cordis.patch.yml no longer declares exactly one row')
  return { id, name }
}

/** The manifest name the loader row must use to mount this half. */
function packageName(): string {
  const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { name: string }
  return manifest.name
}

interface Registration {
  name: string
  key?: string
  id?: string
  locale?: string
}

/** A slots service that records owner keys and every registration made under them. */
function fakeSlots() {
  const owners: string[] = []
  const registrations: (Registration & { component: unknown })[] = []
  const service = {
    inject(owner: string, callback: () => unknown): () => void {
      owners.push(owner)
      const disposer = callback()
      return typeof disposer === 'function' ? (disposer as () => void) : () => {}
    },
    register(def: Registration, component: unknown): () => void {
      registrations.push({ ...def, component })
      return () => {}
    },
  }
  return { service, owners, registrations }
}

/** The minimal shell: effects run, and only an injection naming `slots` resolves. */
function slotsContext(slots: unknown) {
  const disposers: (() => void)[] = []
  const ctx = {
    effect(execute: () => unknown): () => void {
      const disposer = execute()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return () => {}
    },
    inject(deps: string[], callback: (c: unknown) => unknown): void {
      if (deps.includes('slots')) callback({ slots })
    },
  } as unknown as ClientContext
  return { ctx, disposers }
}

describe('bundle wiring', () => {
  it('spells the row id, the package name, the slot key and the namespace the same way', () => {
    const row = patchRow()
    // The loader mounts this browser half on the row whose specifier is the
    // package name, so the patch row and the manifest must agree.
    expect(row.name).toBe(packageName())
    expect(PACKAGE_NAME).toBe(row.name)
    // The panel keys an entry by `<package>#<row id>`; the id is what the row
    // is called in the patch.
    expect(ROW_KEY).toBe(`${row.name}#${row.id}`)
    // ...and the seat the panel hands the page is looked up by that same id,
    // which is also the settings namespace both halves use.
    expect(NS).toBe(row.id)
    expect(PROMPT_ENHANCE_NAMESPACE).toBe(row.id)
  })

  it('registers the configuration page on the row key the panel looks for', () => {
    const { service, owners, registrations } = fakeSlots()
    const { ctx } = slotsContext(service)
    apply(ctx)

    expect(owners).toContain('plugins.row.config')
    const page = registrations.find((entry) => entry.name === 'plugins.row.config')
    expect(page).toBeDefined()
    expect(page?.key).toBe(ROW_KEY)
    expect(page?.locale).toBe(NS)
    // Every UI registration must name the dictionary namespace, or the slot
    // renders keys instead of copy.
    expect(registrations.every((entry) => entry.locale === NS)).toBe(true)
  })
})

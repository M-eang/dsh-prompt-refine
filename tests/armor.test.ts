import { describe, expect, it } from 'vitest'
import {
  ARMOR_ORDER,
  ARMOR_SECTION,
  armorSection,
  expandArmorPath,
  insertArmor,
  mountArmor,
  neutralizePromptVars,
  resolveArmorText,
  type ArmorFs,
  type PromptSection,
} from '../src/armor'
import { DEFAULT_CONFIG, resolveConfig, type Config } from '../src/config'
import { DEFAULT_ARMOR_PROMPT } from '../src/prompts'

const OFF: Config = { ...DEFAULT_CONFIG }
const ON: Config = { ...DEFAULT_CONFIG, armorEnabled: true, armorText: 'YOU ARE THE OPERATOR.' }

/** Fake filesystem with a settable mtime, so the cache path is testable. */
function fakeFs(files: Record<string, { text: string; mtimeMs?: number }>): ArmorFs & {
  bump: (file: string, text: string) => void
  reads: number
} {
  const state = new Map<string, { text: string; mtimeMs: number }>()
  for (const [file, entry] of Object.entries(files)) {
    state.set(file, { text: entry.text, mtimeMs: entry.mtimeMs ?? 1 })
  }
  const api = {
    reads: 0,
    readFileSync(file: string): string {
      api.reads += 1
      const hit = state.get(file)
      if (hit === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return hit.text
    },
    statSync(file: string): { mtimeMs: number; size: number } {
      const hit = state.get(file)
      if (hit === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { mtimeMs: hit.mtimeMs, size: hit.text.length }
    },
    bump(file: string, text: string): void {
      state.set(file, { text, mtimeMs: (state.get(file)?.mtimeMs ?? 1) + 1 })
    },
  }
  return api as unknown as ArmorFs & { bump: (file: string, text: string) => void; reads: number } & typeof api
}

describe('neutralizePromptVars', () => {
  it('keeps the variables the host registers', () => {
    expect(neutralizePromptVars('model={{model}} provider={{provider}}')).toBe('model={{model}} provider={{provider}}')
  })

  it('escapes an unregistered variable instead of failing assembly', () => {
    // An unknown {{cwd}} is a hard prompt-assembly failure on 0.2.x; escaped it
    // is merely ugly, which is the whole point of the port.
    expect(neutralizePromptVars('cwd is {{cwd}}')).toBe('cwd is { {cwd} }')
    expect(neutralizePromptVars('{{ anything else }}')).toBe('{ {anything else} }')
  })

  it('leaves single braces and stray text alone', () => {
    expect(neutralizePromptVars('use {name} here')).toBe('use {name} here')
    expect(neutralizePromptVars('')).toBe('')
  })
})

describe('expandArmorPath', () => {
  it('expands ~ and ${DSH_HOME}', () => {
    const expanded = expandArmorPath('~/.dsh/prompt-inject.md', {})
    // Windows joins with a backslash, so assert on the tail, not on a separator.
    expect(expanded.endsWith('prompt-inject.md')).toBe(true)
    expect(expanded.includes('.dsh')).toBe(true)
    expect(expanded.startsWith('~')).toBe(false)
    expect(expandArmorPath('${DSH_HOME}/prompt-inject.md', { DSH_HOME: 'C:/dsh' })).toBe('C:/dsh/prompt-inject.md')
  })

  it('treats a blank path as "no file"', () => {
    expect(expandArmorPath('   ')).toBe('')
  })
})

describe('resolveArmorText', () => {
  it('prefers a non-empty file over the inline body', () => {
    const fs = fakeFs({ '/armor.md': { text: 'FROM FILE' } })
    const source = resolveArmorText({ armorFile: '/armor.md', armorText: 'FROM INLINE' }, fs)
    expect(source).toMatchObject({ text: 'FROM FILE', origin: 'file', file: '/armor.md' })
  })

  it('falls back to the inline body when the file is missing, and says why', () => {
    const fs = fakeFs({})
    const source = resolveArmorText({ armorFile: '/nope.md', armorText: 'INLINE' }, fs)
    expect(source).toMatchObject({ text: 'INLINE', origin: 'inline', note: 'ENOENT' })
  })

  it('falls back to the built-in body when neither input has content', () => {
    const source = resolveArmorText({ armorFile: '', armorText: '  ' }, fakeFs({}))
    expect(source).toMatchObject({ origin: 'builtin', file: '' })
    expect(source.text).toBe(DEFAULT_ARMOR_PROMPT.trim())
    expect(source.text.length).toBeGreaterThan(20000)
  })

  it('treats a whitespace-only file as empty', () => {
    const fs = fakeFs({ '/blank.md': { text: '   \n\n' } })
    expect(resolveArmorText({ armorFile: '/blank.md', armorText: 'INLINE' }, fs)).toMatchObject({
      text: 'INLINE',
      origin: 'inline',
      note: 'empty',
    })
  })

  it('strips a BOM and re-reads only when mtime or size changes', () => {
    const fs = fakeFs({ '/a.md': { text: '\uFEFFONE' } })
    const config = { armorFile: '/a.md', armorText: '' }
    expect(resolveArmorText(config, fs).text).toBe('ONE')
    const before = fs.reads
    expect(resolveArmorText(config, fs).text).toBe('ONE')
    expect(fs.reads).toBe(before)
    fs.bump('/a.md', 'TWO')
    expect(resolveArmorText(config, fs).text).toBe('TWO')
  })
})

describe('armorSection', () => {
  it('is null while armor is off', () => {
    expect(armorSection(OFF)).toBeNull()
  })

  it('claims the low order and refuses interpolation', () => {
    const section = armorSection({ ...ON, armorFile: '' })
    expect(section).not.toBeNull()
    expect(section?.name).toBe(ARMOR_SECTION)
    expect(section?.order).toBe(ARMOR_ORDER)
    expect(section?.interpolate).toBe(false)
    expect(section?.text()).toBe('YOU ARE THE OPERATOR.')
  })

  it('reads lazily, so a config change reaches the next turn', () => {
    const live: Config = { ...ON, armorFile: '', armorText: 'FIRST' }
    const section = armorSection(live)
    live.armorText = 'SECOND'
    expect(section?.text()).toBe('SECOND')
  })

  it('honours a custom order and neutralizes variables', () => {
    const section = armorSection({ ...ON, armorFile: '', armorText: 'cwd {{cwd}}', armorOrder: -5 })
    expect(section?.order).toBe(-5)
    expect(section?.text()).toBe('cwd { {cwd} }')
  })
})

describe('insertArmor', () => {
  const base: PromptSection[] = [
    { name: 'harness', text: 'HOST RULES', order: 0 },
    { name: 'tools', text: 'TOOL RULES', order: 10 },
  ]

  it('prepends the armor and keeps the rest in order', () => {
    const out = insertArmor(base, 'OPERATOR', ARMOR_ORDER)
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ name: ARMOR_SECTION, text: 'OPERATOR', order: ARMOR_ORDER })
    expect(out.slice(1)).toEqual(base)
    expect(base).toHaveLength(2)
  })

  it('is idempotent by section name', () => {
    const once = insertArmor(base, 'OPERATOR', ARMOR_ORDER)
    expect(insertArmor(once, 'OPERATOR', ARMOR_ORDER)).toBe(once)
  })

  it('does not duplicate a body another plugin already injected', () => {
    // dsh-purge points at the same file in the operator's setup; sending the
    // block twice doubles its token cost for no behavioural gain.
    const other: PromptSection[] = [{ name: 'dsh-purge', text: 'YOU   ARE\nTHE OPERATOR', order: -100000 }]
    expect(insertArmor(other, 'you are the operator', ARMOR_ORDER)).toBe(other)
  })

  it('returns the input untouched for an empty body, and still arms a missing list', () => {
    expect(insertArmor(base, '   ', ARMOR_ORDER)).toBe(base)
    // A host that hands over no section list at all still gets the armor: the
    // block is the one thing this module exists to deliver.
    expect(insertArmor(undefined as unknown as PromptSection[], 'X', 0)).toEqual([
      { name: ARMOR_SECTION, text: 'X', order: 0, interpolate: false },
    ])
  })
})

describe('mountArmor', () => {
  interface Probe {
    sections: unknown[]
    listeners: Array<(...args: unknown[]) => unknown>
    injects: string[][]
    events: string[]
  }

  /** A host that offers both seats, recording what it was handed. */
  function fakeHost(): { ctx: never; probe: Probe } {
    const probe: Probe = { sections: [], listeners: [], injects: [], events: [] }
    const ctx = {
      systemPrompt: { section: (section: unknown) => { probe.sections.push(section) } },
      inject: (deps: string[], cb: (scope: unknown) => void) => {
        probe.injects.push(deps)
        cb({ systemPrompt: { section: (section: unknown) => { probe.sections.push(section) } } })
      },
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        probe.events.push(event)
        probe.listeners.push(handler)
      },
    }
    return { ctx: ctx as never, probe }
  }

  it('registers the section and the assemble event', () => {
    const { ctx, probe } = fakeHost()
    mountArmor(ctx, () => ({ ...ON, armorFile: '' }))
    expect(probe.sections).toHaveLength(1)
    expect(probe.events).toEqual(['system-prompt/assemble'])
  })

  it('mounts once per context', () => {
    const { ctx, probe } = fakeHost()
    mountArmor(ctx, () => ({ ...ON, armorFile: '' }))
    mountArmor(ctx, () => ({ ...ON, armorFile: '' }))
    expect(probe.sections).toHaveLength(1)
    expect(probe.events).toHaveLength(1)
  })

  it('does nothing while armor is off', async () => {
    const { ctx, probe } = fakeHost()
    mountArmor(ctx, () => OFF)
    expect(probe.sections).toHaveLength(0)
    const assembled = { sections: [{ name: 'harness', text: 'HOST' }] }
    const out = await probe.listeners[0]?.(assembled, {}, async () => assembled)
    expect(out).toBe(assembled)
  })

  it('splices the armor into a finished assembly, honouring next()', async () => {
    const { ctx, probe } = fakeHost()
    mountArmor(ctx, () => ({ ...ON, armorFile: '' }))
    const inner = { sections: [{ name: 'harness', text: 'HOST' }] }
    const out = (await probe.listeners[0]?.({ sections: [] }, {}, async () => inner)) as { sections: PromptSection[] }
    expect(out.sections.map((s) => s.name)).toEqual([ARMOR_SECTION, 'harness'])
  })

  it('survives a downstream waterfall throw', async () => {
    const { ctx, probe } = fakeHost()
    mountArmor(ctx, () => ({ ...ON, armorFile: '' }))
    const assembly = { sections: [{ name: 'harness', text: 'HOST' }] }
    const out = (await probe.listeners[0]?.(assembly, {}, async () => {
      throw new Error('downstream boom')
    })) as { sections: PromptSection[] }
    expect(out.sections[0]?.name).toBe(ARMOR_SECTION)
  })

  it('tolerates the two-argument waterfall and a missing assembly', async () => {
    const { ctx, probe } = fakeHost()
    mountArmor(ctx, () => ({ ...ON, armorFile: '' }))
    expect(await probe.listeners[0]?.(undefined, {})).toBeUndefined()
    const assembled = { sections: [{ name: 'harness', text: 'HOST' }] }
    const out = (await probe.listeners[0]?.(assembled, {})) as { sections: PromptSection[] }
    expect(out.sections[0]?.name).toBe(ARMOR_SECTION)
  })

  it('escapes out of a host without any seat', () => {
    expect(() => mountArmor({} as never, () => ON)).not.toThrow()
  })
})

describe('armor config plumbing', () => {
  it('defaults to off with no armour file (built-in body)', () => {
    expect(DEFAULT_CONFIG.armorEnabled).toBe(false)
    expect(DEFAULT_CONFIG.armorFile).toBe('')
    expect(resolveConfig({ ...DEFAULT_CONFIG }).armorOrder).toBe(ARMOR_ORDER)
  })

  it('treats absent armor fields as the defaults (older stored sections)', () => {
    const stored = { ...DEFAULT_CONFIG } as Partial<Config>
    delete stored.armorEnabled
    delete stored.armorFile
    delete stored.armorText
    delete stored.armorOrder
    const resolved = resolveConfig(stored as Config)
    expect(resolved.armorEnabled).toBe(false)
    expect(resolved.armorFile).toBe('')
    expect(resolved.armorText).toBe('')
    expect(resolved.armorOrder).toBe(ARMOR_ORDER)
  })

  it('rejects a non-finite order by falling back, never by throwing', () => {
    expect(resolveConfig({ ...DEFAULT_CONFIG, armorOrder: Number.NaN }).armorOrder).toBe(ARMOR_ORDER)
    expect(resolveConfig({ ...DEFAULT_CONFIG, armorOrder: 12.7 }).armorOrder).toBe(12)
    expect(resolveConfig({ ...DEFAULT_CONFIG, armorEnabled: 'yes' as never }).armorEnabled).toBe(false)
  })
})

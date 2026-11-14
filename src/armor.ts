/**
 * Prompt armor: an operator-controlled identity block placed above every
 * section the host assembles for a turn.
 *
 * A port of the `dsh-purge` armour (MIT, 小杨 / YuJunZhiXue) reduced to the
 * part that lives entirely inside the prompt. What is kept: the section is
 * prepended at a very low `order`, is marked `interpolate: false`, reads its
 * body lazily so a settings change reaches the very next turn, and its
 * `{{variable}}` tokens are neutralized unless the host itself registers them
 * (an unregistered `{{cwd}}` is a hard prompt-assembly failure — the reason
 * `dsh-purge` 1.4.1 exists). What is deliberately not ported: everything that
 * rewrites the installed application, the approval/sandbox patches, and the
 * red-team console. This module only decides what the model is told.
 *
 * Two independent registration paths, because they fail differently:
 * - `ctx.systemPrompt.section()` — the documented way; the host assembles the
 *   section itself every turn, and an `order` below every built-in section
 *   keeps the block first.
 * - the `system-prompt/assemble` event — a fallback for hosts where the
 *   section seat is absent or the section was registered before the service
 *   was mounted; it splices the block into the finished assembly instead.
 * Both dedupe on the section name, so enabling armor twice cannot send it
 * twice, and a body another plugin already injected verbatim (e.g. `dsh-purge`
 * pointing at the same file) is left alone rather than duplicated.
 * @module dsh-prompt-refine/armor
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config'
import { DEFAULT_ARMOR_PROMPT } from './prompts'

/** Section name the armor claims in the assembled prompt. */
export const ARMOR_SECTION = 'prompt-enhance-armor'

/**
 * Default section order. Negative orders sort before the harness' own
 * sections; `-100000` matches what the block looks like when it comes from
 * `dsh-purge`, so switching providers of the same text does not reorder it.
 */
export const ARMOR_ORDER = -100000

/**
 * Prompt variables the host registers for interpolation itself. Any other
 * `{{name}}` in an operator file is literal text and must not be handed to the
 * interpolator, which throws on unknown names.
 */
const KNOWN_PROMPT_VARS = new Set(['model', 'provider'])

/** One section of an assembled system prompt (host shape, see `dsh-purge`). */
export interface PromptSection {
  name: string
  text: string
  order?: number
  interpolate?: boolean
}

/**
 * Where an armor body came from, for logging and for the settings page hint.
 * `builtin` means neither a file nor an inline body was configured, so the
 * plugin injects its own `DEFAULT_ARMOR_PROMPT` — the shipped armour lives in
 * `prompts.ts` and is therefore on by content, not by a path an operator has
 * to know about. `none` remains only for "armor is on but produced no body".
 */
export type ArmorOrigin = 'file' | 'inline' | 'builtin' | 'none'

/** The resolved armor body. */
export interface ArmorSource {
  /** The body to inject; `''` means "nothing to inject". */
  text: string
  /** Which input won. */
  origin: ArmorOrigin
  /** The expanded file path that was consulted (empty when no file is set). */
  file: string
  /** Why a configured file produced no body (`ENOENT`, unreadable, empty). */
  note?: string
}

/** The filesystem surface `resolveArmorText` needs (injected in tests). */
export interface ArmorFs {
  readFileSync: (file: string, encoding: 'utf8') => string
  statSync: (file: string) => { mtimeMs: number; size: number }
}

const realFs: ArmorFs = {
  readFileSync: (file, encoding) => readFileSync(file, encoding),
  statSync: (file) => statSync(file),
}

/** mtime cache: an operator editing the armor file must not cost a read per turn. */
const fileCache = new Map<string, { mtimeMs: number; size: number; text: string }>()

/**
 * Neutralize `{{variable}}` tokens the host does not know.
 *
 * `{{model}}` / `{{provider}}` are registered by the harness and survive. Every
 * other token collapses to `{ {name} }`: the model still reads the name, but
 * the interpolator never sees a variable it would refuse, which is what turns
 * one stray `{{cwd}}` into a failed turn instead of ugly text.
 * @param text - raw operator body.
 * @returns the body safe to hand to the prompt assembler.
 */
export function neutralizePromptVars(text: string): string {
  return String(text ?? '').replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (whole, name: string) => {
    if (KNOWN_PROMPT_VARS.has(name)) return whole
    return `{ {${name}} }`
  })
}

/**
 * Expand the two prefixes an operator writes in a settings field: `~` (home
 * directory) and `${DSH_HOME}` (the harness home, when the variable is set).
 * Everything else is left verbatim so a Windows path keeps its backslashes.
 * @param file - configured path.
 * @param env - environment to read `DSH_HOME` from.
 * @returns the absolute-ish path, or `''`.
 */
export function expandArmorPath(file: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(file ?? '').trim()
  if (raw === '') return ''
  const home = homedir()
  let out = raw
  if (out === '~') out = home
  else if (out.startsWith('~/') || out.startsWith('~\\')) out = join(home, out.slice(2))
  const dshHome = String(env.DSH_HOME ?? '').trim()
  if (dshHome !== '') out = out.split('${DSH_HOME}').join(dshHome)
  return out
}

/**
 * Resolve the armor body: configured file first, then inline text, then the
 * built-in `DEFAULT_ARMOR_PROMPT`. A configured-but-unreadable file does NOT
 * fall back silently — the returned `note` says why, so a mistyped path is
 * diagnosable instead of looking like "armor is on and doing nothing". The
 * built-in body is the last resort rather than `'none'`: an installation with
 * no armour file carries the armour in code, and clearing both settings fields
 * is a reset to it, never a silent disable (`armorEnabled` is the switch).
 * @param config - the resolved plugin config.
 * @param fsImpl - filesystem surface (defaults to `node:fs`).
 * @returns the resolved body and its provenance.
 */
export function resolveArmorText(
  config: Pick<Config, 'armorFile' | 'armorText'>,
  fsImpl: ArmorFs = realFs,
): ArmorSource {
  const inline = String(config.armorText ?? '').trim()
  // One exit shape for "no body from file or inline": the built-in armour body,
  // carrying the same `note` the caller uses to explain a bad file path.
  const fallback = (file: string, note?: string): ArmorSource => {
    const source = inline === ''
      ? { text: DEFAULT_ARMOR_PROMPT.trim(), origin: 'builtin' as const }
      : { text: inline, origin: 'inline' as const }
    return note === undefined ? { ...source, file } : { ...source, file, note }
  }
  const file = expandArmorPath(config.armorFile ?? '')
  if (file === '') {
    return fallback('')
  }
  let stat: { mtimeMs: number; size: number } | null = null
  try {
    stat = fsImpl.statSync(file)
  } catch (error) {
    const note = (error as NodeJS.ErrnoException)?.code ?? 'unreadable'
    return fallback(file, note)
  }
  const cached = fileCache.get(file)
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    if (cached.text === '') return fallback(file, 'empty')
    return { text: cached.text, origin: 'file', file }
  }
  let raw = ''
  try {
    raw = fsImpl.readFileSync(file, 'utf8')
  } catch (error) {
    const note = (error as NodeJS.ErrnoException)?.code ?? 'unreadable'
    return fallback(file, note)
  }
  const text = raw.replace(/^\uFEFF/, '').trim()
  fileCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, text })
  if (text === '') return fallback(file, 'empty')
  return { text, origin: 'file', file }
}

/** Whitespace-insensitive comparison key: same block, different formatting. */
function comparable(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The section this config would contribute, or `null` when armor is off.
 *
 * `text` stays a function on purpose: the host calls it per assembly, so a
 * saved settings change or an edited armor file reaches the very next turn
 * without remounting the plugin.
 * @param config - the resolved plugin config.
 * @returns the section descriptor, or `null`.
 */
export function armorSection(config: Config): {
  name: string
  order: number
  interpolate: false
  text: () => string
} | null {
  if (config.armorEnabled !== true) return null
  const order = Number.isFinite(config.armorOrder) ? config.armorOrder : ARMOR_ORDER
  return {
    name: ARMOR_SECTION,
    order,
    interpolate: false,
    text: () => {
      const source = resolveArmorText(config)
      if (source.text === '') return ''
      return neutralizePromptVars(source.text)
    },
  }
}

/**
 * Splice the armor into an already-assembled section list.
 *
 * Idempotent on two axes, both of which have bitten this class of plugin: the
 * section name must not already be present (so the event fallback cannot stack
 * on top of the section seat), and a body another plugin already injected
 * verbatim is left alone (so two plugins tracking the same armor file do not
 * both send it). Either way the input list is returned unchanged by identity
 * when nothing was added, which keeps "did we touch it" answerable.
 * @param sections - the assembled sections.
 * @param text - the armor body (raw; neutralization happens here).
 * @param order - the section order to claim.
 * @returns the section list to hand back to the host.
 */
export function insertArmor(sections: PromptSection[], text: string, order: number): PromptSection[] {
  const list = Array.isArray(sections) ? sections : []
  const body = neutralizePromptVars(text).trim()
  if (body === '') return list
  for (const section of list) {
    if (section === null || typeof section !== 'object') continue
    if (section.name === ARMOR_SECTION) return list
  }
  const wanted = comparable(body)
  for (const section of list) {
    if (section === null || typeof section !== 'object') continue
    if (typeof section.text !== 'string') continue
    if (comparable(section.text).includes(wanted)) return list
  }
  return [{ name: ARMOR_SECTION, text: body, order, interpolate: false }, ...list]
}

/** Assembled prompt as the host passes it through the event waterfall. */
interface Assembly {
  sections?: PromptSection[]
  contexts?: unknown[]
  tools?: unknown[]
}

/** Service seat `ctx.systemPrompt.section()`, when the host has it. */
interface SystemPromptSeat {
  section?: (section: unknown) => unknown
}

/** Structural view of the registrant context (no hard `@deepseek-ai/*` types). */
interface ArmorHost {
  inject?: (deps: string[], cb: (scope: ArmorHost) => void) => unknown
  on?: (event: string, handler: (...args: unknown[]) => unknown, options?: { global?: boolean; prepend?: boolean }) => unknown
  systemPrompt?: SystemPromptSeat
}

const MOUNTED = Symbol.for('dsh-prompt-refine.armor')

/** Log at most one line per outcome per process; a per-turn warn would flood. */
const warned = new Set<string>()
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return
  warned.add(key)
  try {
    console.warn(`[prompt-enhance] ${message}`)
  } catch {
    /* a host without console must not break assembly */
  }
}

/**
 * Mount the armor on a registrant context.
 *
 * Both registration paths are installed when the host offers them; they dedupe
 * on the section name, so belt-and-braces cannot double-inject. The event
 * handler mirrors the harness waterfall contract (`(assembly, context[, next])`)
 * and always answers with a usable assembly: a downstream throw falls back to
 * the upstream assembly rather than failing the turn.
 * @param ctx - the plugin's registrant context.
 * @param readConfig - reads the current (volatile) config.
 */
export function mountArmor(ctx: Context, readConfig: () => Config): void {
  const host = ctx as unknown as ArmorHost & { [MOUNTED]?: boolean }
  if (host === null || typeof host !== 'object') return
  if (host[MOUNTED] === true) return
  host[MOUNTED] = true

  const registerSection = (scope: ArmorHost): void => {
    try {
      const seat = scope?.systemPrompt
      if (seat === undefined || seat === null || typeof seat.section !== 'function') return
      const section = armorSection(readConfig())
      if (section === null) return
      try {
        seat.section(section)
      } catch (error) {
        const message = String((error as Error)?.message ?? error)
        if (!message.includes('already registered')) warnOnce('section', `armor section refused: ${message}`)
      }
    } catch {
      /* a proxy that throws on property access simply means "not mounted yet" */
    }
  }

  try {
    if (typeof host.inject === 'function') {
      host.inject(['systemPrompt'], registerSection)
    } else {
      registerSection(host)
    }
  } catch {
    /* no service gate on this host; the event path below still works */
  }

  if (typeof host.on !== 'function') return
  const handler = async (...args: unknown[]): Promise<unknown> => {
    const [assembly] = args as [Assembly | undefined, unknown]
    const tail = args.length >= 3 ? args[args.length - 1] : null
    const next = typeof tail === 'function' ? (tail as () => Promise<Assembly>) : null
    let assembled = assembly
    if (next !== null) {
      try {
        assembled = await next()
      } catch (error) {
        // A downstream listener throwing must not cost the operator the turn.
        warnOnce('waterfall', `system-prompt/assemble rejected downstream: ${String((error as Error)?.message ?? error)}`)
        assembled = assembly
      }
    }
    try {
      const config = readConfig()
      if (config.armorEnabled !== true) return assembled
      if (assembled === undefined || assembled === null || !Array.isArray(assembled.sections)) return assembled
      const source = resolveArmorText(config)
      if (source.text === '') return assembled
      const order = Number.isFinite(config.armorOrder) ? config.armorOrder : ARMOR_ORDER
      const sections = insertArmor(assembled.sections, source.text, order)
      if (sections === assembled.sections) return assembled
      return { ...assembled, sections }
    } catch (error) {
      warnOnce('rewrite', `armor rewrite failed: ${String((error as Error)?.message ?? error)}`)
      return assembled
    }
  }
  try {
    host.on('system-prompt/assemble', handler, { global: true, prepend: true })
  } catch {
    warnOnce('event', 'arming system-prompt/assemble is unavailable on this host')
  }
}

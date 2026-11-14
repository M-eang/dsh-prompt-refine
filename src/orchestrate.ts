/**
 * Shared orchestration for the two host-side enhance entries (the HTTP route
 * and the /enhance slash command): route resolution by precedence, LLM
 * service lookup, one enhanceText call. Keeping both entries on this path
 * prevents their behavior from drifting.
 * @module dsh-prompt-refine/orchestrate
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { effectiveSystemPrompt, type Config } from './config'
import { DEFAULT_SYSTEM_PROMPT, withContextRules, withRefRules, withRewriteStance, withWorkspaceRules } from './prompts'
import { buildConversationContext } from './context'
import {
  formatWorkspaceBlock,
  scanWorkspace,
  WORKSPACE_BLOCK_OPEN,
  type FsFace,
  type WorkspaceOptions,
} from './workspace'
import { EnhanceFailure, enhanceText, failureDimensionOf, resolveRoute, toEnhanceError, type RoutePair } from './enhancer'
import { isEnhanceMode, modeSystemAddon, resolveMaxTokens } from './shared/modes'
import { resolveTemplateId, templateSystemAddon } from './shared/templates'
import { joinSlashPrefix, splitSlashPrefix } from './shared/slash'
import { protectRefs, restoreRefs } from './shared/refs'
import type { EnhanceEvidence, EnhanceResult } from './shared/protocol'
import { countText } from './shared/validate'

/** Structural face of one logged request header (brand types stay off the wire path). */
interface EpochHeaderLike {
  config?: { provider?: unknown; model?: unknown }
}

/**
 * Structural face of the sessions store.
 *
 * `requestHeader` is a **method** in every dsh release checked so far —
 * `Session.requestHeader(): EpochHeader | undefined` (0.1.1-rc.2 `lib/index.js:1497`,
 * 0.1.2-alpha.3 `lib/index.js:1393`). Reading it as a property yields the
 * function object, whose `.config` is `undefined`, which silently disabled this
 * whole precedence layer. The property shape is still accepted defensively so a
 * flip in either direction degrades to the other branch instead of a TypeError.
 */
interface SessionsFace {
  get(id: string): {
    requestHeader?: (() => EpochHeaderLike | undefined) | EpochHeaderLike
    /** The derived LLM message history; absent on hosts that never expose it. */
    deriveMessages?: () => readonly unknown[]
    /**
     * The session's durable creation metadata. `cwd` carries the absolute
     * working directory the session was created in (validated absolute by the
     * session store), which is what the workspace scan reads.
     */
    header?: { cwd?: unknown }
  } | undefined
}

/** Structural face of the settings provider for cross-namespace reads. */
interface SettingsFace {
  get(ns: string): unknown
}

/**
 * Read one entry from a cordis service that historically exposed a Map-like
 * `get`, guarding the service's presence, the method's EXISTENCE, and the call.
 *
 * A structural interface can promise `get`; only a runtime check keeps that
 * promise honest. dsh 0.1.5-rc.3 replaced the settings service with
 * `SettingsForms`, whose surface is configure/describe/update/replace/mutate —
 * **no synchronous `get`**. Calling through the old shape threw
 * `ctx.get(...)?.get is not a function`, and because this sits on every
 * enhance request's route-resolution path it turned every enhancement into a
 * 502. Missing readers must degrade to "no answer", never to a failed enhance.
 * @param ctx - registrant context.
 * @param service - cordis service name (`sessions`, `settings`).
 * @param key - the entry key (session id, settings namespace).
 * @returns the entry, or undefined when the shape cannot answer.
 */
function serviceEntry(ctx: Context, service: string, key: string): unknown {
  const holder = ctx.get(service) as { get?: unknown } | null | undefined
  if (holder === null || holder === undefined) return undefined
  if (typeof holder.get !== 'function') return undefined
  try {
    return (holder.get as (k: string) => unknown).call(holder, key)
  } catch {
    // A store-layer hiccup (unknown id, a future signature change, a getter
    // that throws) degrades to "no entry" — never a failed enhancement.
    return undefined
  }
}

/** Narrow an untrusted provider/model pair into a route (trimmed). */
function routeOf(config: { provider?: unknown; model?: unknown } | null | undefined): RoutePair | undefined {
  if (config === null || config === undefined) return undefined
  const provider = typeof config.provider === 'string' ? config.provider.trim() : ''
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/**
 * The session's logged request route (provider/model of its last request
 * header), when a live session with a request header exists.
 */
export function sessionRouteOf(ctx: Context, sessionId: string | undefined): RoutePair | undefined {
  if (sessionId === undefined || sessionId === '') return undefined
  const session = serviceEntry(ctx, 'sessions', sessionId) as ReturnType<SessionsFace['get']> | undefined
  const header = session?.requestHeader
  let epoch: EpochHeaderLike | undefined
  try {
    epoch = typeof header === 'function' ? header.call(session) : header
  } catch {
    // A session-layer hiccup (frozen object, a future signature change,
    // anything a getter throws) must degrade to the harness default route —
    // never turn one enhance request into a 502 / 「增强失败」.
    return undefined
  }
  return routeOf(epoch?.config)
}

/**
 * Structural face of the dsh >= 0.1.5-rc.3 default-model service
 * (`ctx.agentDefaultModel`). Owned by dsh-agent-default-model, which stopped
 * publishing the selection through the settings namespace.
 */
interface AgentDefaultModelFace {
  currentSelection?: () => { provider?: unknown; model?: unknown } | undefined
}

/**
 * Read a `ModelSelection` out of an untrusted candidate, or nothing.
 *
 * Accepting a loose `unknown` matters here: this reaches across four dsh
 * release lines, and a wrong shape must read as "no answer", never throw.
 */
function selectionOf(candidate: unknown): RoutePair | undefined {
  if (candidate === null || candidate === undefined) return undefined
  const face = candidate as AgentDefaultModelFace
  if (typeof face.currentSelection !== 'function') return undefined
  try {
    return routeOf(face.currentSelection())
  } catch {
    return undefined
  }
}

/** Fetch a cordis service object without letting a cordis-level throw escape. */
function serviceOf(ctx: Context, name: string): unknown {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/** The harness-wide default model selection registered by dsh-agent-default-model. */
export function defaultRouteOf(ctx: Context): RoutePair | undefined {
  // Three ways exist to reach the same selection, one per host generation. Each
  // failure means "try the next", never "fail the enhance request":
  //
  // 1. dsh >= 0.1.5-rc.3 — the `agentDefaultModel` service, fetched BY NAME.
  //    `ctx.get` comes before the property because cordis throws
  //    `cannot get property "agentDefaultModel" without inject` when that
  //    property is read without declaring the dependency, and declaring it via
  //    `inject` is not survivable: hosts lacking the service would then never
  //    activate this plugin at all.
  const byGet = selectionOf(serviceOf(ctx, 'agentDefaultModel'))
  if (byGet !== undefined) return byGet

  // 2. Same service, reached as a property (harnesses that inject it for us).
  try {
    const byProp = selectionOf((ctx as Context & { agentDefaultModel?: AgentDefaultModelFace }).agentDefaultModel)
    if (byProp !== undefined) return byProp
  } catch {
    // Not injected on this host — fall through to the legacy read.
  }

  // 3. Legacy (<= 0.1.2-rc.1): a synchronous settings-namespace read. Those
  //    hosts expose it; later ones do not, and `serviceEntry` answers "no
  //    entry" instead of throwing `ctx.get(...)?.get is not a function` on
  //    every enhance request.
  const value = serviceEntry(ctx, 'settings', 'agent-default-model')
  return routeOf(value as { provider?: unknown; model?: unknown } | undefined)
}

/**
 * One live session's structural face, narrowed to what grounding reads.
 * `header.cwd` is optional in the store, so every read of it re-checks the
 * runtime type instead of trusting the interface.
 */
type SessionLike = NonNullable<ReturnType<SessionsFace['get']>>

/** The two grounding layers of one enhancement, plus what the log line reports. */
export interface ContextBundle {
  /** The framed blocks handed to the model; undefined when neither layer applied. */
  block?: string
  /** True when a `<conversation_context>` layer was assembled. */
  history: boolean
  /** True when a `<workspace_context>` layer was assembled. */
  workspace: boolean
  /** Files whose excerpt made it into the workspace layer (0 without one). */
  files: number
}

/** The scan bounds one enhancement runs under, taken from the resolved config. */
export function workspaceOptionsOf(config: Config): WorkspaceOptions {
  return {
    maxDepth: config.workspaceMaxDepth,
    treeMax: config.workspaceTreeMax,
    maxFiles: config.workspaceMaxFiles,
    maxFileChars: config.workspaceMaxFileChars,
    maxChars: config.workspaceMaxChars,
  }
}

/**
 * The conversation-history snippet of one session, or nothing at all.
 * Split out of {@link conversationContextOf} so the workspace layer can share
 * the single session lookup the caller already performed.
 */
function historyBlockOf(session: SessionLike, config: Config, draft: string): string | undefined {
  if (!config.contextAware) return undefined
  let messages: readonly unknown[]
  try {
    const derived = session.deriveMessages?.()
    if (derived === undefined || !Array.isArray(derived)) return undefined
    messages = derived
  } catch {
    // A session-layer hiccup must not turn one enhance request into a 502.
    return undefined
  }
  return buildConversationContext(
    messages,
    { maxMessages: config.contextMaxMessages, maxChars: config.contextMaxChars },
    draft,
  )
}

/**
 * Bounded reuse of one workspace scan, keyed on the four things a scan is a
 * function of: the `fs` provider, the session (whose `header.cwd` names the
 * root), the resolved root, and the configured bounds.
 *
 * Why: every enhancement re-lists the working directory and re-reads up to
 * `workspaceMaxFiles` excerpts before the model call starts, and the common
 * retry pattern — a timeout or a provider error, then a second click — repeats
 * that work on a tree that has not changed in between. A different session, an
 * edited bound, a re-mounted provider or a changed working directory is always
 * a miss, so the cache never answers a question the scan was not just asked.
 *
 * The risk it introduces is bounded on purpose, and the plan for it is stated
 * where it can be read:
 * - **Staleness is capped in seconds, not in calls.** An entry lives
 *   {@link WORKSPACE_SCAN_TTL_MS}; a file deleted inside that window can still
 *   be named by the rewrite — the same exposure a scan that completed a moment
 *   earlier already has, since the block is evidence, not instructions.
 * - **It can be switched off.** `workspaceAware = false` disables the layer and
 *   this cache with it; nothing else reads the cache.
 * - **Failures are never remembered.** A scan that threw, or that produced no
 *   block at all, stores nothing, so fail-open behaviour is unchanged: the next
 *   call re-probes the provider.
 * - **Memory only.** The entry is the framed excerpt the call already sent to
 *   the model, it is never written to disk, and a stale entry is dropped on the
 *   next store.
 */
const WORKSPACE_SCAN_TTL_MS = 10_000
/** Hard cap on live entries; past it the oldest is dropped on each store. */
const WORKSPACE_SCAN_CACHE_MAX = 64

interface WorkspaceScanCacheEntry {
  at: number
  block: string
  files: number
}

const workspaceScans = new Map<string, WorkspaceScanCacheEntry>()

/**
 * Stable per-object identity for a provider (or session) reference. Identity,
 * not contents: a re-mounted `fs` service or a re-derived session must not be
 * served the previous instance's scan, and neither carries a stable id the
 * plugin could key on.
 */
let nextProviderId = 1
const providerIds = new WeakMap<object, number>()

function providerIdOf(value: object | undefined): number {
  if (value === undefined) return 0
  const existing = providerIds.get(value)
  if (existing !== undefined) return existing
  const assigned = nextProviderId++
  providerIds.set(value, assigned)
  return assigned
}

/** The cache key of one scan: provider + session + root + bounds, as discussed above. */
function workspaceScanKeyOf(service: object, session: SessionLike | undefined, root: string, options: WorkspaceOptions): string {
  const bounds = `${options.maxDepth}|${options.treeMax}|${options.maxFiles}|${options.maxFileChars}|${options.maxChars}`
  return `${providerIdOf(service)}\u0000${providerIdOf(session)}\u0000${root}\u0000${bounds}`
}

/** Remember one successful scan, dropping expired entries and the oldest over cap. */
function rememberWorkspaceScan(key: string, block: string, files: number): void {
  const now = Date.now()
  for (const [existing, entry] of workspaceScans) {
    if (now - entry.at > WORKSPACE_SCAN_TTL_MS) workspaceScans.delete(existing)
  }
  if (workspaceScans.size >= WORKSPACE_SCAN_CACHE_MAX) {
    const oldest = workspaceScans.keys().next()
    if (oldest.done !== true) workspaceScans.delete(oldest.value)
  }
  workspaceScans.set(key, { at: now, block, files })
}

/**
 * Drop every cached scan. Test seam: the cache is module state, so a suite that
 * asserts scan counts must start from an empty one.
 */
export function resetWorkspaceScanCache(): void {
  workspaceScans.clear()
}

/**
 * The workspace snippet of one session, or nothing at all.
 *
 * The root is the configured override when set, otherwise the session's own
 * working directory. The `fs` service is read structurally and defensively:
 * an absent service, a backend missing one of the three methods, an
 * unresolvable root, or any provider throw all mean "no workspace layer",
 * never a failed enhancement.
 * @param ctx - registrant context (optional `fs`).
 * @param session - the live session, when the id resolved to one.
 * @param config - the resolved config (switch, root override, scan bounds).
 * @param signal - caller cancellation, passed through to the provider.
 * @returns the framed block and its file count, or undefined.
 */
export async function workspaceContextOf(
  ctx: Context,
  session: SessionLike | undefined,
  config: Config,
  signal?: AbortSignal,
): Promise<{ block: string; files: number } | undefined> {
  if (!config.workspaceAware) return undefined
  const service = serviceOf(ctx, 'fs') as Partial<FsFace> | undefined
  if (service === undefined || service === null) return undefined
  if (typeof service.resolve !== 'function' || typeof service.listDir !== 'function' || typeof service.readText !== 'function') return undefined
  const sessionCwd = session?.header?.cwd
  const root = config.workspaceRoot !== ''
    ? config.workspaceRoot
    : typeof sessionCwd === 'string' ? sessionCwd : ''
  if (root === '') return undefined
  const options = workspaceOptionsOf(config)
  const cacheKey = workspaceScanKeyOf(service, session, root, options)
  const cached = workspaceScans.get(cacheKey)
  if (cached !== undefined && Date.now() - cached.at <= WORKSPACE_SCAN_TTL_MS) {
    return { block: cached.block, files: cached.files }
  }
  let scan: Awaited<ReturnType<typeof scanWorkspace>>
  try {
    scan = await scanWorkspace(service as FsFace, root, options, signal)
  } catch {
    // The scan is an optimization; a provider-level throw degrades to "no
    // workspace layer" exactly like an unreadable directory, and is never
    // remembered (the next call re-probes rather than failing fast on a
    // transient error).
    return undefined
  }
  if (scan === undefined || (scan.tree.length === 0 && scan.files.length === 0)) return undefined
  const block = formatWorkspaceBlock(scan, options)
  rememberWorkspaceScan(cacheKey, block, scan.files.length)
  return { block, files: scan.files.length }
}

/**
 * Both grounding layers of one enhancement, assembled in one pass.
 *
 * Order matters for the model: history first (what the conversation is about),
 * then the workspace (what the project actually contains), then the raw draft
 * as the thing to rewrite.
 * @param ctx - registrant context.
 * @param sessionId - the session the draft belongs to, when known.
 * @param config - the resolved config.
 * @param draft - the raw draft being enhanced.
 * @param signal - caller cancellation.
 * @returns the block plus per-layer flags; an empty bundle when nothing applied.
 */
export async function gatherContext(
  ctx: Context,
  sessionId: string | undefined,
  config: Config,
  draft: string,
  signal?: AbortSignal,
): Promise<ContextBundle> {
  if (!config.contextAware && !config.workspaceAware) return { history: false, workspace: false, files: 0 }
  const session = sessionId === undefined || sessionId === ''
    ? undefined
    : serviceEntry(ctx, 'sessions', sessionId) as SessionLike | undefined
  const pieces: string[] = []
  let history = false
  let workspace = false
  let files = 0
  if (session !== undefined) {
    const block = historyBlockOf(session, config, draft)
    if (block !== undefined) {
      pieces.push(block)
      history = true
    }
  }
  const found = await workspaceContextOf(ctx, session, config, signal)
  if (found !== undefined) {
    pieces.push(found.block)
    workspace = true
    files = found.files
  }
  if (pieces.length === 0) return { history: false, workspace: false, files: 0 }
  return { block: pieces.join('\n\n'), history, workspace, files }
}

/**
 * The conversation-context snippet for one enhancement, or nothing at all.
 *
 * Every failure mode here degrades to the ORIGINAL single-prompt behaviour:
 * context switched off, no session id (the 0.1.2-rc.1 input slots no longer
 * carry one), unknown session, missing/throws history, or a window too small
 * to admit a single turn. Grounding is an optimization, never a requirement —
 * an enhancement must never fail because history could not be read.
 * @param ctx - registrant context (optional `sessions`).
 * @param sessionId - the session the draft belongs to, when known.
 * @param config - the resolved config (switch + window).
 * @param draft - the raw draft being enhanced.
 * @returns the framed snippet, or undefined to run unconstrained.
 */
export function conversationContextOf(ctx: Context, sessionId: string | undefined, config: Config, draft: string): string | undefined {
  if (!config.contextAware) return undefined
  if (sessionId === undefined || sessionId === '') return undefined
  const session = serviceEntry(ctx, 'sessions', sessionId) as SessionLike | undefined
  if (session === undefined) return undefined
  return historyBlockOf(session, config, draft)
}

/** One orchestration request. */
export interface RunEnhanceOptions {
  /** The raw draft to rewrite (already validated by the caller). */
  text: string
  /** The session's logged request route, when known. */
  sessionRoute?: RoutePair
  /** Caller cancellation (HTTP disconnect / command dispatch). */
  signal?: AbortSignal
  /** Session identity stamped onto the request for adapter routing. */
  sessionId?: string
  /** Pre-built context snippet; when absent it is derived from the session. */
  context?: string
  /**
   * Per-call template override (模板库), for `/enhance <模板> <文本>`. A valid
   * id wins over `config.template`; anything invalid is ignored, never an
   * error — the command plane is allowed to be optimistic about its first word.
   */
  template?: string
  /**
   * Per-call mode override (档位), for `/enhance --mode <档位> <文本>` and the
   * request body's `mode`. A known id wins over `config.mode`; anything else
   * falls back to the configured mode instead of failing the call.
   */
  mode?: string
  /** Receives each text delta for incremental display (display only; may be async). */
  onDelta?: (delta: string) => void | Promise<void>
}

/**
 * Resolve the model route (settings pair → session route → harness default),
 * look up the LLM service, and run one normalized enhancement.
 * @throws an error whose `detail` (via `toEnhanceError`) carries the wire
 *   error — `unconfigured` when no route resolves, `internal` when the LLM
 *   service is absent, or whatever `enhanceText` raised.
 */
export async function runEnhance(ctx: Context, config: Config, options: RunEnhanceOptions): Promise<EnhanceResult> {
  // Structured, single-line observability: request id and sizes only — never
  // the prompt text, the model output, or the provider/model names (those can
  // carry internal gateway or project identifiers). Sizes use the same
  // code-point gauge the input check reports to the user, so the two never
  // disagree.
  //
  // The failure line is not allowed to be less informative than the success
  // line, and "error=upstream" alone is not enough to act on: it gets the same
  // treatment through one extra, non-sensitive dimension — `reason=`, a
  // closed-vocabulary classifier built by `failureDimensionOf` (the stable
  // upstream reason, or the sanitized class of the host-side throw). It
  // replaces neither `error=` nor the rule above it: no message, no prompt, no
  // route ever lands in the log. The success line carries one marker of the
  // same kind, `truncated=1`, when the model stopped at an output cap.
  const requestId = randomUUID().slice(0, 8)
  const started = Date.now()
  try {
    const route = resolveRoute(config, options.sessionRoute, defaultRouteOf(ctx))
    if (route === undefined) {
      // No detail line: the fix instructions are the localized primary copy.
      throw new EnhanceFailure({ code: 'unconfigured' })
    }
    const llm = ctx.get('llm')
    if (llm === undefined) {
      // A host without the LLM service is a deployment fact, not a model
      // failure; the kind keeps the two apart in the failure log.
      throw new EnhanceFailure({ code: 'internal' }, 'no-llm-service')
    }
    // 斜杠命令与正文拆开：命令是给宿主的指令，改写它只会把它改坏
    // （`/logs 200` 变成 `/logs 150 行` 之类）。只增强命令之后的正文，
    // 命令原样拼回。判定规则见 shared/slash.ts。
    const { prefix, body } = splitSlashPrefix(options.text)
    if (prefix !== '' && body === '') {
      // 整段只有一个命令、没有可改写的正文：不发模型调用。provider/model
      // 取已解析出的同一对值 —— 客户端按"两字段非空"判定结果合法性，
      // 空串会被当成坏记录丢掉。
      return { text: options.text, provider: route.provider, model: route.model, elapsedMs: 0 }
    }
    // A caller-supplied block (tests, a future pre-assembled path) is used
    // verbatim; its layer flags are read back off the markers so the system
    // prompt still gets exactly the rules the block can support.
    const bundle: ContextBundle = options.context !== undefined
      ? {
          block: options.context,
          history: options.context.includes('<conversation_context>'),
          workspace: options.context.includes(WORKSPACE_BLOCK_OPEN),
          files: 0,
        }
      : await gatherContext(ctx, options.sessionId, config, body, options.signal)
    const context = bundle.block
    // 引用（`@文件`、`@"带空格的路径"`、`/技能`）是宿主输入框的 chip，不是正文
    // 词：它们的真实文本对模型不可见，模型只看到 `⟦n⟧`，因此不可能把路径译成
    // 中文、给引号补标点、或把 `/code-review` 改写成「代码审查」。还原是机械的，
    // 认不出的占位符会把引用原文追加到末尾，见 shared/refs.ts。
    const protection = protectRefs(body)
    let strategy = DEFAULT_SYSTEM_PROMPT
    if (bundle.history) strategy = withContextRules(strategy)
    if (bundle.workspace) strategy = withWorkspaceRules(strategy)
    // 档位与模板纪律追加在最末（比内置策略与自定义文本更具体），但不覆盖内置的
    // 硬性约束：不编造、只输出正文、保持语言这些规则永远在。默认档
    // `standard` 与「不用模板」的 addon 都是空串，因此默认路径的提示词与历史
    // 逐字节相同。顺序固定为「档位 → 模板」：档位先决定篇幅与颗粒度，模板
    // 再决定交付形状，tests/templates.test.ts 锁定这两句的拼接顺序。
    const templateId = resolveTemplateId(config.template, options.template)
    // 单次档位覆盖优先于设置；未知值退回配置档位，命令面可以乐观解析。
    const mode = isEnhanceMode(options.mode) ? options.mode : config.mode
    strategy += modeSystemAddon(mode) + templateSystemAddon(templateId)
    // 引用纪律比档位与模板更具体：它管的是哪些字符一个字都不许动，所以追加在
    // 最末；没有引用的草稿不加，系统提示与历史调用逐字节相同。
    if (protection.refs.length > 0) strategy = withRefRules(strategy)
    // 改写位声明排在最前：它管的是「这次调用要不要做」，内置策略管的是「怎么做」，
    // 所以它不能覆盖策略里的硬性约束（不编造、只输出正文、保持语言）。
    const system = withRewriteStance(effectiveSystemPrompt(config, strategy), config.rewriterArmor)
    const result0 = await enhanceText(llm, {
      route,
      // The context rules ride along ONLY when there is context to reason
      // about, so a context-free call keeps byte-identical instructions.
      system,
      text: protection.body,
      temperature: config.temperature,
      // 显式填写上限时以该值为准；否则用档位自带的预算（standard = 不设上限）。
      maxTokens: resolveMaxTokens(config.maxOutputTokens, mode),
      timeoutMs: config.timeoutMs,
      signal: options.signal,
      ...(config.fidelity ? { anchors: true } : {}),
      ...(config.fidelityRepair ? { repair: true } : {}),
      ...(config.rewriterArmor ? { refusalRetry: true } : {}),
      ...(context !== undefined ? { context } : {}),
      ...(options.onDelta !== undefined ? { onDelta: options.onDelta } : {}),
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    })
    // 占位符还原成引用原文。丢掉的占位符由 restoreRefs 追加在末尾，所以引用
    // 只可能位置不理想，不可能凭空消失。
    const restored = restoreRefs(result0.text, protection.refs)
    const written = restored.text === result0.text ? result0 : { ...result0, text: restored.text }
    // 命令原样拼回：日志与返回给调用方的都是"命令 + 改写后的正文"。
    const base = prefix === '' ? written : { ...written, text: joinSlashPrefix(prefix, written.text) }
    // 档位/模板只在非默认时标注：默认路径（standard、无模板）的响应与老宿主
    // 逐字节一致，面板也只在有标签时才画历史条目的角标。
    const result: EnhanceResult = {
      ...base,
      ...(mode === 'standard' ? {} : { mode }),
      ...(templateId === undefined ? {} : { template: templateId }),
      // 引用回执只在草稿真的有引用时出现：普通草稿的响应形状与老宿主一致。
      ...(protection.refs.length === 0 ? {} : {
        refs: {
          total: protection.refs.length,
          restored: protection.refs.length - restored.missing.length,
          missing: restored.missing.map((ref) => ref.text),
        },
      }),
    }
    // `truncated=1` only ever appears on a capped-but-successful call: the
    // model returned a partial rewrite that the panel warns about, which an
    // operator diagnosing "why is the result short?" needs to see.
    // `fid=kept/total` appears only when the gate ran on a draft that had
    // literals; `fidrep=1` means the one repair pass ran, `reinj=N` how many
    // facts had to be re-pasted verbatim. No literal text ever enters the log.
    const fid = result.fidelity
    const fidPart = fid === undefined ? '' : `fid=${fid.kept}/${fid.total}${fid.repaired ? ' fidrep=1' : ''}${fid.reinjected > 0 ? ` reinj=${fid.reinjected}` : ''}${fid.bloated ? ' bloated=1' : ''} `
    // `refs=N` counts the host references this call protected; `refsmiss=N` how
    // many placeholders the model dropped and had to be re-appended. Counts
    // only — a reference text is a path, and paths stay out of the log.
    const refsPart = protection.refs.length === 0
      ? ''
      : `refs=${protection.refs.length}${restored.missing.length === 0 ? '' : ` refsmiss=${restored.missing.length}`} `
    // Diagnostics go to stderr, never stdout: under the ACP profile stdout is the
    // JSON-RPC channel and a single console.info there corrupts the stream.
    process.stderr.write(`[prompt-enhance] ${requestId} in=${countText(options.text)} out=${countText(result.text)} ctx=${context === undefined ? 0 : 1} ws=${bundle.files} ${result.elapsedMs}ms ${result.truncated === true ? 'truncated=1 ' : ''}${fidPart}${refsPart}ok\n`)
    // Report which evidence layers actually grounded this call, so the panel can
    // show what was shared with the model provider instead of leaving that to be
    // inferred. Attached only when a layer applied: an ungrounded call keeps the
    // byte-identical response shape older hosts produced, and the browser half
    // treats the field as optional in both directions.
    if (!bundle.history && !bundle.workspace) return result
    const evidence: EnhanceEvidence = {
      history: bundle.history,
      workspace: bundle.workspace,
      files: bundle.files,
    }
    return { ...result, evidence }
  } catch (error) {
    const wire = toEnhanceError(error)
    process.stderr.write(`[prompt-enhance] ${requestId} in=${countText(options.text)} error=${wire.code} reason=${failureDimensionOf(error)} ${Date.now() - started}ms\n`)
    throw error
  }
}

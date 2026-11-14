/**
 * One auxiliary enhancement call through the harness LLM service. Mirrors
 * the dsh-session-title-llm contract: paired route resolution, framed user
 * prompt, composed deadline + caller cancellation rechecked during and
 * after the stream, terminal-finish validation, output normalization.
 * @module dsh-prompt-refine/enhancer
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { EnhanceError, EnhanceFidelity, EnhanceResult } from './shared/protocol'
import { normalizeOutput } from './shared/normalize'
import { buildReinjectionBlock, buildRepairClause, extractAnchors, lengthVerdict, verifyAnchors } from './shared/anchors'
import type { Anchor } from './shared/anchors'
import { frameUserPrompt, REWRITE_STANCE_ESCALATION } from './prompts'
import { isRefusalReply } from './shared/refusal'
/** Structural LLM face so tests stub the stream without a Cordis runtime. */
export interface LlmStreamFace {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** One resolved provider/model route. */
export interface RoutePair {
  provider: string
  model: string
}

/** Internal failure carrying the wire error verbatim. */
export class EnhanceFailure extends Error {
  /**
   * Stable, non-sensitive classifier of the underlying throw, recorded where
   * the raw throw is still known (`abort`, `no-llm-service`, `unknown-finish`,
   * or a class name such as `TypeError`). It never reaches the wire: its only
   * consumer is the host failure-log line, which must stay self-diagnosing
   * without ever recording a provider message, a prompt, or a route.
   */
  constructor(public readonly detail: EnhanceError, public readonly kind?: string) {
    super(detail.message ?? detail.code)
    this.name = 'EnhanceFailure'
  }
}

/**
 * Resolve the call route by precedence: the explicit settings pair, then the
 * session's logged request route, then the harness default-model selection.
 * @param explicit - the plugin settings provider/model pair (both or neither).
 * @param session - the session's current request-header route, when known.
 * @param fallback - the `agent-default-model` selection, when registered.
 * @returns the route, or undefined when no source names one.
 */
export function resolveRoute(explicit: Partial<RoutePair> | undefined, session: RoutePair | undefined, fallback: RoutePair | undefined): RoutePair | undefined {
  // Defensive trim: the explicit pair may come from a hand-edited settings
  // document, and `readConfig` normalization is best-effort defense in depth.
  const provider = typeof explicit?.provider === 'string' ? explicit.provider.trim() : ''
  const model = typeof explicit?.model === 'string' ? explicit.model.trim() : ''
  if (provider !== '' && model !== '') {
    return { provider, model }
  }
  return session ?? fallback
}

/** Options of one enhancement call. */
export interface EnhanceCallOptions {
  route: RoutePair
  /** System prompt text (the effective strategy). */
  system: string
  /** The raw draft to rewrite. */
  text: string
  temperature: number
  /**
   * Output token cap of this call, or `0`/absent for "send no cap": the
   * harness then applies the adapter's own default maximum (and the provider's
   * applies when the adapter reports none), which is the closest thing to no
   * limit this layer can express. A positive value is sent verbatim.
   */
  maxTokens?: number
  /** End-to-end deadline in milliseconds. */
  timeoutMs: number
  /** Caller cancellation (HTTP request / command dispatch). */
  signal?: AbortSignal
  /** Session identity stamped onto the request for adapter routing. */
  sessionId?: string
  /** The framed conversation-context snippet, when the call carries one. */
  context?: string
  /**
   * Receives each text delta as the model produces it (display only). May be
   * async — the streaming route's sink awaits socket backpressure. A throw, or
   * a rejected promise, is swallowed: a broken display path must never fail
   * the enhancement itself.
   */
  onDelta?: (delta: string) => void | Promise<void>
  /**
   * Run the deterministic fidelity gate on the result: extract the draft's
   * literal facts (paths, identifiers, versions, URLs), check the rewrite
   * against them, and re-paste verbatim whatever the model dropped.
   * `false`/absent skips the gate entirely and keeps the old result shape.
   */
  anchors?: boolean
  /**
   * Allow ONE repair pass when the gate finds dropped literals: the missing
   * facts are named in a second request and its full rewrite replaces the
   * first. Ignored without `anchors`. Bounded by construction — the second
   * version is verified, never repaired again — and a failed, empty or
   * cancelled repair keeps the first version.
   */
  repair?: boolean
  /**
   * Allow ONE retry when the reply reads as a refusal rather than a rewrite
   * (see `shared/refusal.ts`): the call is repeated with
   * {@link REWRITE_STANCE_ESCALATION} appended to the system prompt. Bounded
   * like `repair` — a second refusal is terminal and surfaces as the
   * `refused` upstream reason instead of being handed back as a result.
   */
  refusalRetry?: boolean
}

/**
 * Rewrite one draft through the LLM service and normalize the output.
 * @param llm - the `ctx.llm` service (or a structural stub).
 * @param options - the call options (`maxTokens` `0`/absent = no cap of ours).
 * @returns the normalized enhanced text plus the route and duration; a rewrite
 *   that stopped at an output cap comes back with `truncated: true` instead of
 *   being refused.
 * @throws EnhanceFailure with a displayable message; the caller's draft is
 *   never touched by this module.
 */
export async function enhanceText(llm: LlmStreamFace, options: EnhanceCallOptions): Promise<EnhanceResult> {
  const started = Date.now()
  const controller = new AbortController()
  let timedOut = false
  let callerAborted = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  const onCallerAbort = (): void => {
    if (!timedOut) callerAborted = true
    controller.abort()
  }
  options.signal?.addEventListener('abort', onCallerAbort, { once: true })
  // A pre-aborted caller signal must refuse before any model traffic.
  if (options.signal?.aborted) {
    callerAborted = true
    controller.abort()
  }
  const signal = controller.signal
  const fail = (detail: EnhanceError, kind?: string): never => {
    throw new EnhanceFailure(detail, kind)
  }
  try {
    signal.throwIfAborted()
    const messages = [
      createUserMessage({
        content: [{ type: 'text', text: frameUserPrompt(options.text, options.context) }],
        source: { kind: 'plugin', plugin: 'dsh-prompt-refine' },
      }),
    ]
    const generate: GenerateOptions = {
      provider: options.route.provider,
      model: options.route.model,
      system: options.system,
      messages,
      temperature: options.temperature,
      // `0` means "no cap of ours": the field is left off the request entirely
      // so the harness materializes the adapter's own default maximum (or the
      // provider's, when the adapter reports none) instead of ours.
      ...options.maxTokens !== undefined && options.maxTokens > 0 ? { maxTokens: options.maxTokens } : {},
      signal,
      ...options.sessionId !== undefined ? { sessionId: options.sessionId as GenerateOptions['sessionId'] } : {},
    }
    const assembler = await streamOnce(llm, generate, signal, options.onDelta)
    signal.throwIfAborted()
    const finish = assembler.finish
    const finishError = finishToDetail(finish)
    let text = readText(assembler, fail)
    let capped = finish.kind === 'max-tokens' && text !== ''

    // Refusal gate. A provider can answer the *request* instead of performing
    // it — "我没法帮你改写…如果你实际想要的是…" — and that reply is not a
    // rewrite: passing it through would put a policy statement where the
    // user's prompt belongs. One retry under the escalation clause; a second
    // refusal is terminal and says so, because handing back a refusal would
    // look like a successful enhancement.
    let refused = false
    if (options.refusalRetry === true && !capped && text !== '' && isRefusalReply(text)) {
      refused = true
      const retried = await retryRefusal(llm, generate, signal, options)
      if (retried !== undefined && !isRefusalReply(retried)) {
        text = retried
        refused = false
      }
      signal.throwIfAborted()
    }
    if (refused) {
      // The retry did not produce a rewrite either: this provider declines the
      // task, and the fix is to route the call elsewhere (a less filtered model,
      // or a local one). The hint lives in the dictionaries; the code stays a
      // plain upstream reason so every surface localises it the same way.
      fail({ code: 'upstream', params: { reason: 'refused' } })
    }

    // Deterministic fidelity gate. The strategy prompt asks the model to keep
    // literal facts verbatim; this checks whether it did, without asking a
    // model anything. A draft with no fact-shaped tokens never enters the gate,
    // so an ordinary "make this clearer" call pays nothing for it.
    let fidelity: EnhanceFidelity | undefined
    if (options.anchors === true && !capped && text !== '') {
      const anchors = extractAnchors(options.text)
      if (anchors.length > 0) {
        let verdict = verifyAnchors(anchors, text)
        let repaired = false
        if (verdict.missing.length > 0 && options.repair === true) {
          // ONE repair pass, never a loop. A failed, aborted or empty repair
          // keeps the first version: the gate exists to make a rewrite more
          // faithful, so it must never turn one that works into an error.
          repaired = true
          const repairText = await repairOnce(llm, generate, signal, options, verdict.missing)
          if (repairText !== undefined) {
            text = repairText
            verdict = verifyAnchors(anchors, repairText)
          }
        }
        // What the model still refuses to carry is re-pasted verbatim under a
        // label: fidelity outranks tidiness, and a prompt that keeps an exact
        // path in an appendix is strictly better than one that quietly lost it.
        const block = buildReinjectionBlock(verdict.missing)
        if (block !== '') text = `${text}${block}`
        const length = lengthVerdict(options.text, text)
        fidelity = {
          total: verdict.total,
          kept: verdict.kept,
          // Capped for the wire: the count below stays exact, the list is the
          // first few literals for the panel's detail line.
          missing: verdict.missing.slice(0, 8).map((anchor) => anchor.text),
          repaired,
          reinjected: block === '' ? 0 : verdict.missing.length,
          ratio: Math.round(length.ratio * 100) / 100,
          bloated: length.bloated,
        }
      }
    }

    // A cap the model stopped at is the ONE terminal finish that still leaves a
    // usable answer: whatever it wrote before running out is returned with
    // `truncated` so the caller can warn, instead of throwing the whole rewrite
    // away. A cap hit with nothing readable on the wire keeps the old refusal —
    // there is no partial result to hand back, and the empty case is the one
    // the max-tokens hint is actually about.
    if (!capped) {
      // A finish reason this build does not recognize is the one terminal
      // failure with nothing specific to say, so it carries its own kind: the
      // host log line stays diagnosable where the wire error cannot.
      if (finishError !== undefined) fail(finishError, finishError.code === 'internal' ? 'unknown-finish' : undefined)
      if (text === '') {
        fail({ code: 'upstream', params: { reason: 'empty' } })
      }
    }
    return {
      text,
      provider: options.route.provider,
      model: options.route.model,
      elapsedMs: Date.now() - started,
      ...capped ? { truncated: true } : {},
      ...fidelity !== undefined ? { fidelity } : {},
    }
  } catch (error) {
    if (error instanceof EnhanceFailure) throw error
    if (timedOut) {
      throw new EnhanceFailure({ code: 'timeout', params: { seconds: Math.ceil(options.timeoutMs / 1000) } })
    }
    if (callerAborted || (error instanceof Error && error.name === 'AbortError')) {
      // Deliberately no detail line: the caller knows it cancelled. The kind
      // still lets the host log tell a cancellation apart from a real
      // host-side failure without recording anything about the call.
      throw new EnhanceFailure({ code: 'internal' }, 'abort')
    }
    throw new EnhanceFailure({ code: 'internal', message: describe(error) }, errorKindOf(error))
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * Run one model call to exhaustion and return the assembled blocks.
 *
 * Extracted so the fidelity gate's repair pass can reuse the exact same
 * deadline/cancellation discipline as the first call instead of a second,
 * subtly different loop. The caller owns the deadline (via `signal`) and the
 * post-processing (finish reason, tool-call refusal, normalization).
 *
 * @param llm - the LLM service face.
 * @param generate - the fully built request (including its own `signal`).
 * @param signal - the combined deadline + caller signal to race against.
 * @param onDelta - optional display-only delta tap (the repair pass passes
 *   none: the panel already showed the first version, and a silent second pass
 *   keeps it from flickering between two bodies).
 * @returns the assembler holding every block the model produced.
 * @throws whatever the stream throws, including the abort rejection.
 */
async function streamOnce(
  llm: LlmStreamFace,
  generate: GenerateOptions,
  signal: AbortSignal,
  onDelta: EnhanceCallOptions['onDelta'],
): Promise<BlockAssembler> {
  const assembler = new BlockAssembler()
  const iterator = llm.stream(generate)[Symbol.asyncIterator]()
  // Race the iteration against the deadline: an adapter that stalls without
  // yielding must still hit the timeout (per-chunk checks alone would hang).
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      const error = new Error('prompt-enhance: aborted')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  let exhausted = false
  try {
    while (true) {
      signal.throwIfAborted()
      const next = await Promise.race([iterator.next(), aborted])
      if (next.done) {
        exhausted = true
        break
      }
      assembler.push(next.value)
      // Display-only tap: the stream already arrives incrementally, so the
      // panel can show the rewrite as it is written instead of waiting for
      // the final normalization.
      if (next.value.type === 'text-delta' && onDelta !== undefined) {
        try {
          // The sink may be async (the SSE route awaits socket drain), so a
          // rejected promise is attached here too — an unhandled rejection
          // from a display-only path must not surface as a process warning.
          void Promise.resolve(onDelta(next.value.text)).catch(() => {})
        } catch {
          // Never let a broken display path fail the enhancement.
        }
      }
    }
  } finally {
    if (onAbort !== undefined && !signal.aborted) signal.removeEventListener('abort', onAbort)
    // On timeout/cancel the pending next() never settles, so the loop exits
    // without exhausting the iterator — prompt the underlying stream to
    // finalize its connection instead of leaving it to the GC.
    if (!exhausted) {
      void Promise.resolve(iterator.return?.()).catch(() => {})
    }
  }
  return assembler
}

/**
 * Run the single refusal retry: the same call with the escalation clause
 * appended to the system prompt.
 *
 * The system prompt is extended rather than replaced, so the stance block the
 * first call already carried stays in force; the clause only names the previous
 * turn as the error. Deltas are dropped for the same reason the repair pass
 * drops them: the panel already streamed the refusal, and a second body
 * appearing under it would read as a glitch.
 *
 * @param llm - the LLM service face.
 * @param generate - the first call's request (route, sampling, cap, messages).
 * @param signal - the combined deadline + caller signal.
 * @param options - the call options (its `system` is the base to escalate).
 * @returns the retried text, or undefined when there is nothing usable.
 * @throws the cancellation when the caller's deadline fired mid-retry.
 */
async function retryRefusal(
  llm: LlmStreamFace,
  generate: GenerateOptions,
  signal: AbortSignal,
  options: EnhanceCallOptions,
): Promise<string | undefined> {
  try {
    const assembler = await streamOnce(
      llm,
      { ...generate, system: `${options.system}\n\n${REWRITE_STANCE_ESCALATION}` },
      signal,
      undefined,
    )
    return readTextQuiet(assembler)
  } catch (error) {
    // A cancellation belongs to the caller and must map to timeout/abort; any
    // other throw keeps the "refused" verdict, which is the actionable fact.
    if (signal.aborted) throw error
    return undefined
  }
}

/**
 * Read one pass's text, refusing a reply the strategy forbids.
 * @param assembler - the pass's assembler.
 * @param fail - the caller's failure sink (`never`-returning).
 * @returns the normalized text.
 */
function readText(assembler: BlockAssembler, fail: (detail: EnhanceError, kind?: string) => never): string {
  const blocks = assembler.blocks()
  if (blocks.some((block) => block.type === 'tool-call')) {
    fail({ code: 'upstream', params: { reason: 'tool-call' } })
  }
  return normalizeOutput(blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n'))
}

/**
 * Read one pass's text best-effort, for the repair pass: a tool-call or empty
 * reply means "keep the first version" rather than "fail the request".
 * @param assembler - the repair pass's assembler.
 * @returns the normalized text, or undefined when there is nothing usable.
 */
function readTextQuiet(assembler: BlockAssembler): string | undefined {
  const blocks = assembler.blocks()
  if (blocks.some((block) => block.type === 'tool-call')) return undefined
  const text = normalizeOutput(blocks.filter((block) => block.type === 'text').map((block) => block.text).join('\n'))
  return text === '' ? undefined : text
}

/**
 * Run the single repair pass: re-ask for a complete rewrite that keeps the
 * literals the first version dropped.
 *
 * @param llm - the LLM service face.
 * @param generate - the first call's request, reused for route/sampling/cap.
 * @param signal - the combined deadline + caller signal.
 * @param options - the call options (draft, context, stream tap).
 * @param missing - the anchors to name in the clause.
 * @returns the repaired text, undefined to keep the first version, or throws
 *   the cancellation when the caller's deadline fired mid-repair.
 */
async function repairOnce(
  llm: LlmStreamFace,
  generate: GenerateOptions,
  signal: AbortSignal,
  options: EnhanceCallOptions,
  missing: readonly Anchor[],
): Promise<string | undefined> {
  const framed = frameUserPrompt(options.text, options.context)
  const messages = [
    createUserMessage({
      content: [{ type: 'text', text: `${framed}\n${buildRepairClause(missing)}` }],
      source: { kind: 'plugin', plugin: 'dsh-prompt-refine' },
    }),
  ]
  try {
    const assembler = await streamOnce(llm, { ...generate, messages }, signal, undefined)
    return readTextQuiet(assembler)
  } catch (error) {
    // A cancellation is the caller's, not the model's: surface it so the outer
    // handler maps it to the timeout/abort it actually was. Everything else
    // (adapter throw, unrecognized finish) keeps the first version.
    if (signal.aborted) throw error
    return undefined
  }
}

/**
 * Render the model-request route failure the user can act on. Known stable
 * codes map to a dedicated `reason` the dictionaries localize; everything
 * else passes the provider message through as the detail line.
 */
function finishToDetail(reason: FinishReason): EnhanceError | undefined {
  switch (reason.kind) {
    case 'stop':
      return undefined
    case 'max-tokens':
      return { code: 'upstream', params: { reason: 'max-tokens' } }
    case 'tool-calls':
      return { code: 'upstream', params: { reason: 'tool-call' } }
    case 'error':
    case 'aborted':
      return { code: mapCode(reason.failure.code), message: reason.failure.message, ...upstreamReasonOf(reason.failure.code) }
    default:
      return { code: 'internal', message: String(reason) }
  }
}

/** Stable upstream reasons the dictionaries and formatEnhanceError both know. */
export type UpstreamReason =
  | 'auth'
  | 'invalid-credential'
  | 'rate-limit'
  | 'quota'
  | 'empty'
  | 'context-window'
  | 'tool-call'
  | 'max-tokens'
  | 'refused'

/** Known provider failure codes with a dedicated fix hint; others stay generic. */
const REASON_CODES: Record<string, UpstreamReason> = {
  AUTH: 'auth',
  INVALID_CREDENTIAL: 'invalid-credential',
  RATE_LIMIT: 'rate-limit',
  QUOTA_EXCEEDED: 'quota',
  EMPTY_RESPONSE: 'empty',
  CONTEXT_WINDOW_EXCEEDED: 'context-window',
}

/** The params fragment carrying the fix-hint reason, when the code is known. */
function upstreamReasonOf(code: string): { params: { reason: UpstreamReason } } | undefined {
  const reason = REASON_CODES[code]
  return reason === undefined ? undefined : { params: { reason } }
}

/** Map a provider failure code onto the wire taxonomy. */
function mapCode(code: string): EnhanceError['code'] {
  return code === 'NO_ADAPTER' ? 'unconfigured' : 'upstream'
}

/** Host-side zh rendering of one wire error, used by the /enhance command plane. */
const REASON_HINTS: Record<UpstreamReason, string> = {
  auth: '鉴权失败：请检查该 provider 的 API Key 配置。',
  'invalid-credential': '鉴权失败：存储的 API Key 不可用，请修正后重试。',
  'rate-limit': '模型服务限流，请稍后重试。',
  quota: '模型服务配额/余额不足，请检查账户。',
  empty: '模型返回了空响应，请重试。',
  'context-window': '输入超出模型上下文窗口，请精简原文或更换模型。',
  'tool-call': '模型请求了工具调用，提示词增强只需要纯文本；请更换模型后重试。',
  'max-tokens': '重写达到输出上限，且没有可返回的内容：若 maxOutputTokens 为正数，可调大或改为 0（不限）后重试；上限也可能来自服务商侧，此时请精简原文或更换模型。',
  refused: '上游模型拒绝执行改写（它把「改写这段草稿」当成了「生成草稿所指的内容」），重试一次仍未执行。请在插件设置里把增强指向一个不做内容审查的模型（本地或自建模型最稳），再重试；原输入未改动。',
}

/**
 * Render one wire error into displayable Chinese text for host-side surfaces
 * (the /enhance command plane has no browser locale dictionary). The primary
 * line comes from `code`/`params`; a `message` detail (provider raw message,
 * config error) is appended beneath it when present.
 */
export function formatEnhanceError(error: EnhanceError): string {
  const params = error.params ?? {}
  let text: string
  switch (error.code) {
    case 'rejected': text = '增强请求被拒绝。'; break
    case 'rate-limit': text = `请求过于频繁：每分钟最多 ${params.limit ?? '?'} 次增强，请 ${params.retryAfterSeconds ?? '稍候'} 秒后再试。`; break
    case 'concurrency-limit': text = `已有 ${params.max ?? '?'} 个增强在进行中，请等待其中一个完成后再试。`; break
    case 'timeout': text = `增强超时（${params.seconds ?? '?'} 秒），可重试；原输入未改动。`; break
    case 'unconfigured': text = '尚未确定增强用的模型：请在插件设置中成对填写 provider/model，或先在当前会话发送一条消息（将跟随会话模型）。'; break
    case 'upstream': text = typeof params.reason === 'string' ? (REASON_HINTS[params.reason as UpstreamReason] ?? '模型服务返回错误，请重试；原输入未改动。') : '模型服务返回错误，请重试；原输入未改动。'; break
    default: text = '增强失败，请重试；原输入未改动。'
  }
  const detail = error.message
  if (detail !== undefined && detail !== '') return `${text}\n${detail}`
  return text
}

/** Best-effort unknown-error rendering. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * The stable kind of one raw throw, recorded on {@link EnhanceFailure} at the
 * point where the throw itself is still in hand. Reads the class name only —
 * never `message`, which is provider text.
 * @param error - the caught value.
 * @returns a log-safe token (`TypeError`, `abort`, `non-error`, …).
 */
function errorKindOf(error: unknown): string {
  if (error instanceof EnhanceFailure) return error.kind ?? 'internal'
  return error instanceof Error ? stableToken(error.name) : 'non-error'
}

/**
 * Narrow any thrown value into the wire error shape.
 * @param error - the thrown value.
 * @returns the structured error for the response envelope.
 */
export function toEnhanceError(error: unknown): EnhanceError {
  if (error instanceof EnhanceFailure) return error.detail
  const anyError = error as { detail?: EnhanceError } | null
  if (anyError !== null && typeof anyError === 'object' && anyError.detail !== undefined && typeof anyError.detail.code === 'string') {
    return anyError.detail
  }
  return { code: 'internal', message: describe(error) }
}

/**
 * Narrow one untrusted classifier into a log-safe token: a leading letter, then
 * letters, digits, `.`, `_` or `-`, at most 32 characters. Anything else reads
 * as `unexpected`, so a pathological throw cannot smuggle free text — a key, a
 * hostname, a prompt fragment — into the host log through its class name.
 * @param value - the candidate classifier.
 * @returns the token, or `unexpected`.
 */
function stableToken(value: string): string {
  const trimmed = value.trim()
  return /^[A-Za-z][A-Za-z0-9._-]{0,31}$/.test(trimmed) ? trimmed : 'unexpected'
}

/**
 * The failure dimension of one enhance failure: the value of the host log
 * line's `reason=` field.
 *
 * One field, closed vocabulary, no operator data. The log has to answer "which
 * failure was this?" without ever recording anything that can carry a prompt, a
 * model output, a provider/model name or a provider message, so this returns
 * only a single sanitized token:
 *
 * - the stable wire `reason` when the error carries one
 *   (`max-tokens`, `context-window`, `rate-limit`, …) — the same vocabulary the
 *   dictionaries pick their fix hints from;
 * - the kind classified where the raw throw was still known
 *   (`abort`, `no-llm-service`, `unknown-finish`, `TypeError`, …);
 * - the error code itself when it is already the most specific fact
 *   (`timeout`, `unconfigured`, `internal`, …), so the field is never empty.
 *
 * `error.message` is deliberately never read: it is the provider's raw text,
 * which is fine on the wire (the panel shows it as a detail line) and not fine
 * in an operator log.
 * @param error - the value thrown by the orchestration.
 * @returns the log-safe dimension, e.g. `rate-limit` or `no-llm-service`.
 */
export function failureDimensionOf(error: unknown): string {
  const detail = toEnhanceError(error)
  const reason = detail.params?.reason
  if (typeof reason === 'string' && reason !== '') return stableToken(reason)
  if (error instanceof EnhanceFailure) {
    return error.kind === undefined ? detail.code : stableToken(error.kind)
  }
  return error instanceof Error ? stableToken(error.name) : 'non-error'
}

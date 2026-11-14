/**
 * The POST /prompt-enhance/enhance host route: the browser half's single
 * seam. Loopback-fenced, body-capped, per-request config re-read (settings
 * changes land on the very next call), route resolved by precedence
 * (settings pair → session request header → harness default model).
 * @module dsh-prompt-refine/enhance-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { ENHANCE_ENDPOINT, ENHANCE_PREFIX, ENHANCE_STREAM_ENDPOINT, type EnhanceError, type EnhanceRejectReason } from './shared/protocol'
import { createStreamNormalizer } from './shared/stream-text'
import { createSseWriter } from './sse'
import { checkInputText } from './shared/validate'
import { isEnhanceMode } from './shared/modes'
import { type Config } from './config'
import { toEnhanceError } from './enhancer'
import { runEnhance, sessionRouteOf } from './orchestrate'
import { isTrustedRequest } from './loopback'
import { readBoundedJson, writeJson } from './http'

/** Envelope slack over the UTF-8 text cap: JSON quoting can inflate ~2-6x in the worst case. */
const bodyCapOf = (maxInputChars: number): number => maxInputChars * 6 + 4096

/**
 * One routed refusal: a closed-vocabulary reason and nothing else.
 *
 * The refusal sites used to send canned Chinese prose as `message`, which the
 * panel can only render verbatim under its localized primary line — so every
 * canned refusal read as Chinese in a non-Chinese UI. Naming the reason moves
 * that copy to the browser half's dictionaries (`REJECTED_REASON_KEYS`), where
 * it is localizable and testable. Routing every site through this helper keeps
 * the vocabulary closed at compile time.
 * @param reason - the refusal reason the browser half maps to copy.
 * @returns the wire error of that refusal.
 */
const refused = (reason: EnhanceRejectReason): EnhanceError => ({ code: 'rejected', params: { reason } })

/** Per-mount admission state: sliding-window rate stamps + active-call count. */
interface AdmissionGate {
  stamps: number[]
  active: number
}

/**
 * Serve one enhance POST against the request envelope.
 * @param ctx - registrant context (llm, optional sessions/settings).
 * @param readConfig - per-request config reader.
 * @param gate - per-mount admission state.
 * @param pathname - the request path, already parsed by the prefix handler.
 * @param req - the incoming request.
 * @param res - the outgoing response.
 * @param stream - whether to answer with an SSE stream of incremental frames
 *   instead of one JSON envelope. Both modes share the whole admission path;
 *   only the response shape differs.
 */
async function serveEnhance(ctx: Context, readConfig: () => Config, gate: AdmissionGate, pathname: string, req: IncomingMessage, res: ServerResponse, stream: boolean): Promise<void> {
  // The three route-shape guards below answer with a machine-readable English
  // diagnostic (never prose): they are unreachable from the plugin's own page —
  // a same-origin browser POST cannot fail the loopback fence or pick the wrong
  // path/method — so they are for an operator reading a log or a curl, not for
  // the localized panel surface.
  if (!isTrustedRequest(req)) {
    writeJson(res, 403, { ok: false, error: { code: 'internal', message: 'forbidden: loopback-only' } })
    return
  }
  // One route, two exact endpoints (one-shot JSON / incremental SSE):
  // anything else under the prefix is unknown.
  if (pathname !== ENHANCE_ENDPOINT && pathname !== ENHANCE_STREAM_ENDPOINT) {
    writeJson(res, 404, { ok: false, error: { code: 'internal', message: 'not found' } })
    return
  }
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: { code: 'internal', message: 'only POST is allowed' } })
    return
  }
  const contentType = req.headers['content-type']
  if (contentType !== undefined && !String(contentType).toLowerCase().startsWith('application/json')) {
    writeJson(res, 415, { ok: false, error: refused('content-type') })
    return
  }
  let config: Config
  try {
    config = readConfig()
  } catch (error) {
    // resolveConfig fails loud on an invalid section — surface it instead of
    // letting the rejection escape the handler.
    //
    // This is the ONE refusal that keeps free text, because the failing
    // invariant is only known to the validator (which invariant, which field):
    // it is an operator-facing diagnostic under a localized primary line, and
    // the plugin's settings descriptions are Chinese at the source, so there is
    // no second language to translate it into here.
    writeJson(res, 500, { ok: false, error: { code: 'internal', message: `prompt-enhance 配置无效：${error instanceof Error ? error.message : String(error)}` } })
    return
  }
  // Fail before reading the body when the plugin is switched off.
  if (!config.enabled) {
    writeJson(res, 403, { ok: false, error: refused('disabled') })
    return
  }
  // Fast reject on a declared body that already exceeds the cap: refuse before
  // reading a single byte. The streamed cap inside readBoundedJson stays as the
  // backstop for chunked bodies, which carry no Content-Length at all. A caller
  // that declares megabytes and dribbles them (or never sends them) must not
  // hold the connection open, so the socket is destroyed once the 413 lands.
  const cap = bodyCapOf(config.maxInputChars)
  const declaredLength = Number(req.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > cap) {
    res.once('finish', () => res.socket?.destroy())
    writeJson(res, 413, { ok: false, error: refused('body-too-large') })
    return
  }
  let body: unknown
  try {
    body = await readBoundedJson(req, cap)
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'body too large'
    writeJson(res, tooLarge ? 413 : 422, {
      ok: false,
      error: refused(tooLarge ? 'body-too-large' : 'invalid-json'),
    })
    return
  }
  const record = body as { sessionId?: unknown; text?: unknown; mode?: unknown } | null
  if (record === null || typeof record !== 'object' || typeof record.text !== 'string') {
    writeJson(res, 422, { ok: false, error: refused('invalid-body') })
    return
  }
  const sessionId = typeof record.sessionId === 'string' && record.sessionId !== '' ? record.sessionId : undefined
  // 单次档位覆盖：只认已知 id，其余按配置走 —— 与 /enhance 的乐观解析同一条
  // 原则，一个拼错的档位不该让整次请求失败。
  const mode = isEnhanceMode(record.mode) ? record.mode : undefined
  const check = checkInputText(record.text, config.maxInputChars)
  if (!check.ok) {
    // The over-length case carries structured counts so the client renders
    // its localized too-long message (matching the client-side guard);
    // empty text (server-side only — the client guards it first) stays generic.
    writeJson(res, 422, {
      ok: false,
      error: check.code === 'too-long'
        ? { code: 'rejected', params: { count: check.count, max: check.max } }
        : { code: 'rejected' },
    })
    return
  }
  // Admission gate (after validation, so only real calls consume budget):
  // sliding-window rate cap, then concurrency cap. Rejected calls answer 429
  // with the configured limits so the user can act.
  //
  // The rate window counts SUCCESSFUL calls only — a stamp lands after the
  // 200 has been written, never on failure. Counting attempts instead would
  // burn the user's window on a run of timeouts/upstream errors and lock
  // them out right when the model recovers. The concurrency cap below still
  // bounds in-flight calls regardless of outcome, so failed calls cannot be
  // used to hammer the upstream either.
  const now = Date.now()
  // Trim the window in one splice instead of a `while (shift)` loop: with the
  // configured cap at 600 the worst case drops from O(N²) array shifts to a
  // single O(N) relocation. The cap is bounded, so this stays cheap in
  // absolute terms; the point is to avoid the quadratic shape on every call.
  const stamps = gate.stamps
  const cut = now - 60000
  let validFrom = 0
  while (validFrom < stamps.length && (stamps[validFrom] ?? cut) < cut) validFrom++
  if (validFrom > 0) stamps.splice(0, validFrom)
  if (stamps.length >= config.rateLimitPerMinute) {
    // The window is bounded, so the oldest surviving stamp tells exactly when
    // a slot frees up — advertise it instead of making the user guess.
    const oldest = stamps[0] ?? now
    const retryAfterSeconds = Math.max(1, Math.ceil((60000 - (now - oldest)) / 1000))
    res.setHeader('Retry-After', String(retryAfterSeconds))
    writeJson(res, 429, {
      ok: false,
      error: { code: 'rate-limit', params: { limit: config.rateLimitPerMinute, retryAfterSeconds } },
    })
    return
  }
  // No Retry-After here: a busy slot frees whenever some in-flight call
  // settles, which is not a delay this route can predict.
  if (gate.active >= config.maxConcurrent) {
    writeJson(res, 429, {
      ok: false,
      error: { code: 'concurrency-limit', params: { max: config.maxConcurrent } },
    })
    return
  }
  gate.active += 1
  // Cancel the model call when the browser goes away mid-flight. `res.close`
  // also fires after a normal response completes, so guard with
  // `writableEnded` — only a premature close aborts the call.
  const callerAbort = new AbortController()
  const onConnectionClosed = (): void => {
    if (!res.writableEnded) callerAbort.abort()
  }
  res.on('close', onConnectionClosed)
  try {
    const runOptions = {
      text: record.text,
      sessionRoute: sessionRouteOf(ctx, sessionId),
      signal: callerAbort.signal,
      ...sessionId !== undefined ? { sessionId } : {},
      ...mode !== undefined ? { mode } : {},
    }
    if (stream) {
      // The stream already opens before the model call, so the client sees
      // the first token instead of waiting for the whole rewrite. Frames go
      // through the backpressure-aware writer: a slow reader pauses the delta
      // path instead of letting the socket buffer grow without bound.
      const sse = createSseWriter(res)
      try {
        sse.open()
        // Display-only normalization: withhold a fence the final body will not
        // have. The authoritative text still comes from `normalizeOutput` at
        // the end, so this cannot change what the user applies.
        const display = createStreamNormalizer()
        const value = await runEnhance(ctx, config, {
          ...runOptions,
          onDelta: async (delta: string): Promise<void> => {
            const safe = display.push(delta)
            if (safe === '') return
            await sse.write(`event: delta\ndata: ${JSON.stringify({ type: 'delta', text: safe })}\n\n`)
          },
        })
        // End the display stream: release whatever the fence heuristic was
        // still withholding, so the incremental view shows the same text the
        // done frame is about to carry (the model may end inside a fence).
        const tail = display.finish()
        if (tail !== '') {
          await sse.write(`event: delta\ndata: ${JSON.stringify({ type: 'delta', text: tail })}\n\n`)
        }
        await sse.write(`event: done\ndata: ${JSON.stringify({ type: 'done', value })}\n\n`)
        // Terminate the response. Without this the chunked body never receives
        // its closing `0\r\n\r\n`, so the connection stays half-open: a browser
        // client survives only because it returns on the `done` frame and
        // cancels the reader, but any whole-body reader (`response.text()`, a
        // curl, a proxy) waits forever, and the socket can never be reused.
        // Guarded because a client that vanished mid-stream leaves a dead
        // socket, where ending would throw and mask the real outcome.
        if (!res.writableEnded && !res.destroyed) {
          try {
            res.end()
          } catch {
            // Half-closed socket: there is nothing left to terminate.
          }
        }
      } finally {
        // Always release the transport listener, success or failure.
        sse.dispose()
      }
    } else {
      const value = await runEnhance(ctx, config, runOptions)
      writeJson(res, 200, { ok: true, value })
    }
    // Count only on success: failed calls must not consume the sliding window
    // (see the gate note above). `Date.now()` at completion, not admission,
    // keeps the window honest — a slow success still counts as one call.
    stamps.push(Date.now())
  } catch (error) {
    const wire = toEnhanceError(error)
    if (stream && res.headersSent) {
      // Headers are already out: the failure has to ride the same stream.
      if (!res.writableEnded) res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: wire })}\n\n`)
    } else {
      writeJson(res, wire.code === 'timeout' ? 504 : wire.code === 'unconfigured' ? 409 : 502, { ok: false, error: wire })
    }
  } finally {
    res.off('close', onConnectionClosed)
    gate.active -= 1
  }
}

/**
 * Live route ownership, one entry per mounting context.
 *
 * Two jobs, both load-bearing:
 *
 * - Same-context idempotence. The admission gate is created per registration,
 *   so a re-applied plugin (reload, re-link) must not stack a second
 *   registration: two gates would silently double the effective rate and
 *   concurrency limits. A second mount on a live context reuses the first.
 * - Fiber-owned disposal. The disposer `webServer.register()` returns has to be
 *   handed back to cordis, because duplicate (kind, path) pairs are a hard
 *   composition contract — `@deepseek-ai/dsh-host-webserver`: "Duplicate
 *   (kind, path) throws". Up to 0.2.8 the disposer was dropped, so the prefix
 *   route outlived its entry; the next mount then died on
 *   `duplicate prefix route "/prompt-enhance"` and stayed failed until the host
 *   process was restarted. The entry is dropped from this map on teardown, so a
 *   later re-apply on the same context registers again instead of no-opping
 *   against a dead route.
 */
const liveMounts = new WeakMap<Context, () => void>()

/**
 * Register the /prompt-enhance prefix route on the shared webserver, owned by
 * the mounting fiber. Absent webserver (non-web composition) is a silent no-op,
 * matching the describe-image family pattern.
 * @param ctx - registrant context; webServer is required.
 * @param readConfig - per-request config reader so settings changes apply immediately.
 */
export function registerEnhanceRoute(ctx: Context, readConfig: () => Config): void {
  const webserver = ctx.get('webServer')
  if (webserver === undefined) return
  if (liveMounts.has(ctx)) return
  const gate: AdmissionGate = { stamps: [], active: 0 }
  ctx.effect(() => {
    const disposeRoute = webserver.register({
      kind: 'prefix',
      path: ENHANCE_PREFIX,
      handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const pathname = new URL(req.url ?? '/', 'http://x').pathname
        return serveEnhance(ctx, readConfig, gate, pathname, req, res, pathname === ENHANCE_STREAM_ENDPOINT)
      },
    })
    const release = (): void => {
      liveMounts.delete(ctx)
      disposeRoute()
    }
    liveMounts.set(ctx, release)
    return release
  })
}

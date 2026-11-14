/**
 * Wire contract shared by the host route and the browser half: one enhance
 * POST and its typed responses. Pure types and constants only, safe to
 * bundle into both halves.
 * @module dsh-prompt-refine/shared/protocol
 */

import type { EnhanceMode } from './modes'

/** Host route path the browser half POSTs the draft to. */
export const ENHANCE_ENDPOINT = '/prompt-enhance/enhance'

/**
 * Mount prefix of the plugin's host routes. The webserver registration uses it
 * verbatim; it used to be derived from {@link ENHANCE_ENDPOINT} with a
 * `replace(/\/enhance$/, '')`, which would silently mount the WRONG path the
 * day the endpoint constant is renamed.
 */
export const ENHANCE_PREFIX = '/prompt-enhance'

/**
 * Host route path of the incremental variant: same request body, but the
 * response is an SSE stream of {@link EnhanceStreamEvent} frames so the panel
 * can show the rewrite while it is being written.
 */
export const ENHANCE_STREAM_ENDPOINT = '/prompt-enhance/enhance-stream'

/** Request body of one enhance call. */
export interface EnhanceRequestBody {
  /** Session whose model route should serve the call; absent forces settings/defaults. */
  sessionId?: string
  /** The raw draft text to rewrite. */
  text: string
  /**
   * Per-call mode override (档位). A known id wins over the stored setting;
   * an unknown value is ignored rather than rejected, so a client that sends
   * nothing (or a stale id) keeps the configured mode.
   */
  mode?: EnhanceMode
}

/**
 * The grounding layers that actually contributed to one call.
 *
 * Attached to a result ONLY when at least one layer applied, so an ungrounded
 * call (no session, no `fs`, both switches off) keeps the exact response shape
 * older hosts produced. Reported for one reason: the panel can then show which
 * of the user's data was shared with the model provider, instead of leaving the
 * privacy boundary to be inferred from the settings.
 */
export interface EnhanceEvidence {
  /** True when a `<conversation_context>` layer was assembled. */
  history: boolean
  /** True when a `<workspace_context>` layer was assembled. */
  workspace: boolean
  /** File excerpts that entered the workspace layer; 0 when none did. */
  files: number
}

/**
 * What the deterministic fidelity gate found in one rewrite.
 *
 * The gate itself is mechanical (see `shared/anchors.ts`): the draft's literal
 * facts — paths, identifiers, versions, URLs — are extracted, the rewrite is
 * checked against them, at most one repair pass may follow, and anything still
 * missing is re-pasted verbatim in a labeled appendix. This object is the
 * receipt: it lets the panel say what the model did with the facts instead of
 * presenting a rewrite whose omissions the user cannot see.
 *
 * Attached only when the gate ran AND the draft had anchors, so a draft with
 * nothing literal in it keeps the response shape older hosts produced.
 */
export interface EnhanceFidelity {
  /** Anchors the draft contained. */
  total: number
  /** How many the model's own prose carried. */
  kept: number
  /** Literals it dropped, capped for display (draft order). */
  missing: string[]
  /** True when the one repair pass actually ran. */
  repaired: boolean
  /** How many dropped literals were re-pasted verbatim at the end. */
  reinjected: number
  /** Rewrite length divided by draft length, in code points, 2 decimals. */
  ratio: number
  /** True when the rewrite is above both the ratio and the character floor. */
  bloated: boolean
}

/**
 * The reference receipt: what the draft's host references — `@file`,
 * `@"path with spaces"`, `/skill` — went through before the model saw them.
 *
 * The draft's references are chip values, not prose: a rewrite that translates
 * `@src/app.ts` into "the file" or `/code-review` into 「代码审查」 destroys the
 * chip. So each one is swapped for a `⟦n⟧` placeholder before the call and
 * restored verbatim after it. `missing` lists the ones the model dropped the
 * placeholder for; they were re-appended verbatim, so they survive in `text`
 * without being part of the model's own wording.
 *
 * Attached only when the draft actually carried references, so an ordinary
 * draft keeps the response shape older hosts produced.
 */
export interface EnhanceRefs {
  /** References the draft contained. */
  total: number
  /** How many placeholders came back and were restored in place. */
  restored: number
  /** The reference texts that had to be re-appended, capped for display. */
  missing: string[]
}

/** One successful enhancement. */
export interface EnhanceResult {
  /** The rewritten prompt body (already normalized: no fences, trimmed). */
  text: string
  /** Provider route that served the call. */
  provider: string
  /** Model id that served the call. */
  model: string
  /** Wall-clock duration of the model call in milliseconds. */
  elapsedMs: number
  /**
   * True when the model stopped at an output cap and `text` is the partial
   * rewrite it managed to write. The call still SUCCEEDS: a capped rewrite is
   * handed back instead of being thrown away, so every consumer has to say so
   * (the panel warns above the result, the command plane appends a note) —
   * a capped body presented as a complete one would be silent truncation.
   * Absent on every uncapped result.
   */
  truncated?: boolean
  /**
   * The evidence layers behind this rewrite. Absent when neither layer applied
   * — and absent on every host older than the one that added the field, which
   * is why the browser half treats it as optional rather than required.
   */
  evidence?: EnhanceEvidence
  /**
   * The fidelity receipt, when the gate ran and the draft had literal facts.
   * `kept` counts what the model carried in its own prose; a literal listed in
   * `missing` that was also re-pasted (`reinjected`) is present in `text` but
   * not part of the model's rewrite, which is exactly what the panel has to
   * tell the user. Optional for the same compatibility reason as `evidence`.
   */
  fidelity?: EnhanceFidelity
  /**
   * The reference receipt, when the draft carried `@`/`/` references. Optional
   * for the same compatibility reason as `evidence`: hosts and panels that do
   * not know the field ignore it, and an ordinary draft never grows one.
   */
  refs?: EnhanceRefs
  /**
   * The enhancement mode / template that produced this rewrite. Both are
   * omitted on the default path (`standard`, no template) so a plain call keeps
   * the response shape older hosts produced; the panel only uses them to label
   * history entries, so their absence is always fine.
   */
  mode?: string
  template?: string
}

/**
 * The closed vocabulary of `rejected` reasons the host route sends.
 *
 * A refusal never carries user-facing prose any more: the route names a reason
 * and the browser half renders its localized line (see `REJECTED_REASON_KEYS`).
 * The previous shape sent free Chinese text as `message`, which the panel could
 * only display verbatim beneath the localized primary line — so an English UI
 * showed Chinese detail copy for every canned refusal.
 */
export type EnhanceRejectReason =
  | 'content-type'
  | 'body-too-large'
  | 'invalid-json'
  | 'invalid-body'
  | 'disabled'

/**
 * Stable error codes the browser half maps to localized copy. The two
 * admission rejections are separate codes because their recovery conditions
 * differ: the per-minute rate cap clears on a known schedule (the route sends
 * a `Retry-After` in seconds with it), while the concurrency cap clears as
 * soon as an in-flight call finishes — no predictable delay to advertise.
 */
export type EnhanceErrorCode =
  | 'rejected'
  | 'rate-limit'
  | 'concurrency-limit'
  | 'timeout'
  | 'upstream'
  | 'unconfigured'
  | 'internal'

/** Structured failure carried on every non-2xx / ok:false response. */
export interface EnhanceError {
  code: EnhanceErrorCode
  /**
   * Optional diagnostic detail, passed through verbatim: the provider's raw
   * failure message, a config error, or an unknown-error description. The
   * client renders its localized primary line from `code`/`params` and shows
   * this beneath it when present — host-side text is a detail, never the
   * primary line (which used to leak Chinese copy into non-Chinese UIs).
   *
   * It is for text that cannot be expressed as a code/param pair — above all
   * the settings-validator's own message when a stored section is invalid.
   * Routed refusals no longer use it: they carry `params.reason` and the
   * browser half supplies the copy, so no canned refusal has to be translated
   * on the host side.
   */
  message?: string
  /**
   * Structured parameters the localized primary line interpolates:
   * - rate-limit: { limit, retryAfterSeconds }
   * - concurrency-limit: { max }
   * - timeout: { seconds }
   * - rejected with { count, max }: the over-length input message
   * - rejected with { reason }: a routed refusal (`EnhanceRejectReason`)
   *   selecting its own localized line — content type, body size, malformed
   *   JSON, malformed envelope, or the plugin being switched off
   * - upstream: optional { reason } selecting a fix hint (auth, quota, …)
   */
  params?: Record<string, string | number>
  /**
   * Dictionary key for the detail line, set by the BROWSER half only.
   *
   * The browser’s own failures (a host that cannot be reached, an unparsable
   * envelope, a cancelled call) used to travel as Chinese `message` text and
   * were therefore rendered verbatim in an English UI. They name a key in the
   * client locale dictionary instead, and the panel localizes it exactly like
   * the primary line. Never sent by the host, and never trusted from the wire:
   * the client’s parser drops any value that arrives on a response.
   */
  detailKey?: string
  /**
   * Optional pre-localized message the client already rendered in the user's
   * language (set by client-side guards). When present the client shows it
   * alone; otherwise it localizes by `code`/`params` and shows `message` as
   * detail.
   */
  localized?: string
}

/** Response envelope of the enhance route. */
export type EnhanceResponse =
  | { ok: true; value: EnhanceResult }
  | { ok: false; error: EnhanceError }

/**
 * One SSE frame of the incremental route. `delta` carries newly displayable
 * text (already safe to show: leading/trailing fences are withheld), `done`
 * carries the authoritative result — the SAME normalized body the one-shot
 * route returns — and `error` carries the structured failure.
 */
export type EnhanceStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; value: EnhanceResult }
  | { type: 'error'; error: EnhanceError }

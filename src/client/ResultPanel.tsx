/**
 * The preview panel: a fixed overlay comparing the original draft with the
 * enhanced result, with 回填 / 复制 / 取消 in the result phase, a cancellable
 * spinner in the loading phase, and a retryable error message otherwise.
 * Rendered through a portal into document.body by the button component.
 * @module dsh-prompt-refine/client/ResultPanel
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnhanceError, EnhanceEvidence, EnhanceFidelity, EnhanceRejectReason } from '../shared/protocol'
import { ENHANCE_MODES, isEnhanceMode, type EnhanceMode } from '../shared/modes'
import type { EnhanceHistoryEntry } from './history'
import { isPromptEnhanceKey, type PromptEnhanceKey } from './locales'
import { EnhanceStarIcon } from './icons'
import { getStreamingText, subscribeStreaming, type PanelState } from './ui-state'

/** Props of the preview panel. */
export interface ResultPanelProps {
  state: PanelState
  t: TranslateNS<'prompt-enhance'>
  /** Fill the enhanced text back into the composer (the button owns setDraft). */
  onApply: () => void
  /** Close without touching the composer (also aborts an in-flight call). */
  onCancel: () => void
  /** Retry after a retryable error; undefined in non-error phases. */
  onRetry?: () => void
  /**
   * 档位条上高亮的那一档 —— 语义是"下一跑会用哪一档"，不是"上一跑用了哪一档"。
   * 缺省时回落到本次请求记下的档位，再回落到 standard。
   */
  mode?: EnhanceMode
  /**
   * 选中一档。**只选中，不调用模型**：点一下就重跑会让"看看这一档叫什么"变成
   * 一次真实的模型调用。不提供时不渲染档位条（纯展示面板 / 测试用）。
   */
  onPickMode?: (mode: EnhanceMode) => void
  /**
   * 按当前选中的档位重跑同一段正文。与 onPickMode 分开，正是为了把"选"和
   * "花钱"分成两个动作；不提供时不显示重跑按钮。
   */
  onRerun?: () => void
  /**
   * Settled rewrites of this composer, newest first. Absent (or empty) renders
   * no history section at all, which is the state of every panel whose session
   * has not produced one yet.
   */
  history?: readonly EnhanceHistoryEntry[]
  /** Bring one history entry's rewrite back into the composer. */
  onApplyHistory?: (entry: EnhanceHistoryEntry) => void
  /** Forget this composer's history. */
  onClearHistory?: () => void
}

/** First line of a history draft, capped so long prompts stay scannable. */
function previewText(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? ''
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine
}

/** Whether one error phase is worth retrying (model/transport failures). */
const retryable = (code: string | undefined): boolean => code === 'upstream' || code === 'timeout' || code === 'internal'

/**
 * Wire `reason` (`UpstreamReason`, kebab-case as the host sends it) → the
 * dictionary key that carries its fix hint.
 *
 * This is an EXPLICIT table on purpose. The dictionary keys are camelCase
 * (`error.upstream.invalidCredential`) while the wire reasons are kebab-case
 * (`invalid-credential`), so building the key as
 * `` `error.upstream.${reason}` `` silently missed every multi-word reason
 * (`invalid-credential`, `rate-limit`, `context-window`, `tool-call`,
 * `max-tokens` — five of the eight) and always fell back to the generic
 * `error.upstream` copy. Spelling the mapping out keeps the two vocabularies
 * in one place: every entry is a literal key checked by `PromptEnhanceKey`,
 * and `tests/locales.test.ts` asserts each one exists in every dictionary.
 */
export const UPSTREAM_ERROR_KEYS: Record<string, PromptEnhanceKey> = {
  auth: 'error.upstream.auth',
  'invalid-credential': 'error.upstream.invalidCredential',
  'rate-limit': 'error.upstream.rateLimit',
  quota: 'error.upstream.quota',
  empty: 'error.upstream.empty',
  'context-window': 'error.upstream.contextWindow',
  'tool-call': 'error.upstream.toolCall',
  'max-tokens': 'error.upstream.maxTokens',
  // The provider answered the request instead of performing it, and the one
  // automatic retry was declined too: the fix is to route the call elsewhere.
  refused: 'error.upstream.refused',
}

/**
 * Routed refusal reason (`EnhanceRejectReason`, kebab-case as the host sends it)
 * → the dictionary key carrying its localized line.
 *
 * Same reason as {@link UPSTREAM_ERROR_KEYS} for being an explicit table: the
 * refusal sites used to send canned Chinese prose, which the panel could only
 * print verbatim beneath the localized primary line. The table is typed as the
 * exact wire vocabulary (`EnhanceRejectReason`), so a reason added on the host
 * side without copy here fails the typecheck instead of silently rendering the
 * generic line — the same drift class 0.2.3 fixed for the upstream hints.
 * `disabled` reuses the guard's own message so the route's switched-off refusal
 * and the client's local guard read identically.
 */
export const REJECTED_REASON_KEYS: Record<EnhanceRejectReason, PromptEnhanceKey> = {
  'content-type': 'error.rejected.contentType',
  'body-too-large': 'error.rejected.bodyTooLarge',
  'invalid-json': 'error.rejected.invalidJson',
  'invalid-body': 'error.rejected.invalidBody',
  disabled: 'error.disabled',
}

/**
 * The dictionary key of one wire refusal reason, or undefined for a reason this
 * build does not know — a newer host's reason has to fall back to the generic
 * refusal line rather than render raw text.
 */
function rejectedReasonKeyOf(reason: string): PromptEnhanceKey | undefined {
  return (REJECTED_REASON_KEYS as Record<string, PromptEnhanceKey>)[reason]
}

/**
 * Primary line for a server-side error, localized by the stable code and its
 * structured params: an upstream `reason` picks a specific fix hint when one
 * exists, a routed refusal renders its own line, and an over-length rejection
 * reuses the too-long input message the client-side guard shows. The server's
 * `message` (provider raw text, config errors) renders beneath as the diagnostic
 * detail line — see {@link detailTextOf}.
 */
function localizedErrorMessage(
  t: ResultPanelProps['t'],
  code: EnhanceError['code'],
  params: EnhanceError['params'],
): string {
  if (code === 'rejected' && typeof params?.count === 'number' && typeof params?.max === 'number') {
    return t('error.tooLong', { count: params.count, max: params.max })
  }
  if (code === 'rejected' && typeof params?.reason === 'string') {
    const specific = rejectedReasonKeyOf(params.reason)
    if (specific !== undefined) return t(specific)
  }
  if (code === 'upstream' && typeof params?.reason === 'string') {
    const specific = UPSTREAM_ERROR_KEYS[params.reason]
    if (specific !== undefined) return t(specific)
  }
  switch (code) {
    case 'rejected': return t('error.rejected')
    case 'rate-limit': return t('error.rateLimit', params)
    case 'concurrency-limit': return t('error.concurrencyLimit', params)
    case 'timeout': return t('error.timeout', params)
    case 'unconfigured': return t('error.unconfigured')
    case 'upstream': return t('error.upstream')
    default: return t('error.internal')
  }
}

/**
 * The detail line of one error, or undefined when it carries none.
 *
 * A failure the browser half originated names a dictionary key (`detailKey`) and
 * is rendered in the user's language; host-side text (`message`) is the fallback
 * for diagnostics that have no key of their own. The key is verified against the
 * shipped dictionary, so a bogus value can never be printed as raw key text.
 */
export function detailTextOf(t: ResultPanelProps['t'], error: EnhanceError): string | undefined {
  if (error.detailKey !== undefined && isPromptEnhanceKey(error.detailKey)) {
    return t(error.detailKey, error.params)
  }
  return error.message !== undefined && error.message !== '' ? error.message : undefined
}

/**
 * One line naming the evidence layers behind a result — what the call actually
 * shared with the model provider — or undefined when the host reported none.
 *
 * The field is optional on the wire (an ungrounded call, or any host older than
 * the one that added it), so its absence simply renders no line.
 */
export function evidenceTextOf(t: ResultPanelProps['t'], evidence: EnhanceEvidence | undefined): string | undefined {
  if (evidence === undefined) return undefined
  const parts: string[] = []
  if (evidence.history) parts.push(t('panel.evidence.history'))
  if (evidence.workspace) {
    parts.push(evidence.files > 0
      ? t('panel.evidence.workspace', { files: evidence.files })
      : t('panel.evidence.workspaceTree'))
  }
  if (parts.length === 0) return undefined
  return `${t('panel.evidence.label')}${parts.join(' · ')}`
}

/**
 * One line reporting what the fidelity gate did with the draft's literal facts
 * — the receipt for a rewrite the user is about to apply — or undefined when
 * the gate did not run (older host, gate off, or a draft with nothing literal
 * in it).
 *
 * Two verdicts matter to the reader: the model's own rewrite dropped something
 * (and it was re-pasted verbatim at the end, which the panel must not present
 * as the model's prose), and the rewrite came out far longer than the draft.
 * A clean result still gets the count, because "3/3 保留" is the reassurance
 * the gate exists to provide.
 */
export function fidelityTextOf(t: ResultPanelProps['t'], fidelity: EnhanceFidelity | undefined): string | undefined {
  if (fidelity === undefined) return undefined
  const parts = [t('panel.fidelity.kept', { kept: fidelity.kept, total: fidelity.total })]
  if (fidelity.repaired) parts.push(t('panel.fidelity.repaired'))
  if (fidelity.reinjected > 0) parts.push(t('panel.fidelity.reinjected', { count: fidelity.reinjected }))
  if (fidelity.bloated) parts.push(t('panel.fidelity.bloated'))
  return `${t('panel.fidelity.label')}${parts.join(' · ')}`
}

/**
 * Clipboard fallback for insecure contexts (LAN http), where
 * `navigator.clipboard` is undefined: a transient textarea plus the legacy
 * `execCommand('copy')`.
 */
function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * The loading phase's live body: the spinner copy before the first token, the
 * text as it arrives after.
 *
 * It subscribes to the streaming slice alone. The panel around it subscribes to
 * coarse state (phase, result, error), so a token landing mid-call re-renders
 * this one `<pre>` instead of the header, the seven mode chips, the history list
 * and the footer — which is what a long rewrite used to pay for on every chunk.
 * @param props - the locale reader.
 * @returns the incremental view of the streamed rewrite.
 */
function StreamingBody(props: { t: TranslateNS<'prompt-enhance'> }): ReactNode {
  const { t } = props
  const text = useSyncExternalStore(subscribeStreaming, getStreamingText)
  if (text === '') {
    return (
      <>
        <div className="dsh-pe-spin" aria-hidden />
        <div>{t('panel.loading')}</div>
        <div className="dsh-pe-hint">{t('panel.loading.hint')}</div>
      </>
    )
  }
  // Incremental view: the text already generated, replaced by the normalized
  // full body the moment the call settles.
  return (
    <div className="dsh-pe-stream">
      <div className="dsh-pe-col-title">
        <span className="dsh-pe-spin small" aria-hidden />
        {t('panel.streaming')}
      </div>
      <pre className="dsh-pe-col-text">{text}</pre>
    </div>
  )
}

/** One enhancement preview overlay. */
export function ResultPanel(props: ResultPanelProps): ReactNode {
  const { state, t, onApply, onCancel, onRetry, onRerun, history, onApplyHistory, onClearHistory, mode, onPickMode } = props
  // 档位条的高亮：调用方给的选择 → 结果自报的档位 → 本次请求记下的档位。
  const reportedMode = state.result?.mode
  const activeMode: EnhanceMode = isEnhanceMode(mode)
    ? mode
    : isEnhanceMode(reportedMode)
      ? reportedMode
      : state.mode ?? 'standard'
  const modeLabel = (id: EnhanceMode): string => t(`settings.mode.${id}` as PromptEnhanceKey)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle')
  const panelRef = useRef<HTMLElement | null>(null)

  // Keyboard handling: Escape closes (cancels) the panel — except during IME
  // composition, where Esc cancels candidate input — and Tab cycles inside
  // the dialog so focus cannot escape to the page beneath.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onCancel()
        return
      }
      if (event.key === 'Tab') {
        const panel = panelRef.current
        if (panel === null) return
        const focusables = panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (first === undefined || last === undefined) return
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  // The element that owned focus when the panel opened, captured at mount.
  const openerRef = useRef<HTMLElement | null>(null)

  // Move focus into the dialog on open. The restore lives in the SAME effect
  // (not in a second mount-only effect): under React 18 StrictMode the mount
  // effect runs → cleans up → runs again, and a restore that keyed off a
  // second effect's mount-time `document.activeElement` would read the panel
  // itself and hand focus straight back out, neutering the Tab trap and the
  // Escape handler below.
  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    return () => {
      const opener = openerRef.current
      openerRef.current = null
      // Hand focus back to the opener, but never steal it from wherever the
      // user has since moved it (the document body means focus was dropped,
      // not moved on purpose).
      if (opener === null || !opener.isConnected) return
      const active = document.activeElement
      if (active === null || active === document.body) opener.focus()
    }
  }, [])

  const copy = useCallback((): void => {
    if (state.result === undefined) return
    const text = state.result.text
    const done = (ok: boolean): void => setCopied(ok ? 'ok' : 'failed')
    // navigator.clipboard only exists in secure contexts (https / localhost);
    // guard the dereference and fall back for plain-http LAN access.
    if (navigator.clipboard !== undefined) {
      navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)))
      return
    }
    done(fallbackCopy(text))
  }, [state.result])

  const formatMs = (ms: number): string => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)

  // Resolved once per render: the localized detail line of the current error,
  // and the evidence line of the current result.
  const errorDetail = state.error === undefined ? undefined : detailTextOf(t, state.error)
  const evidence = state.result === undefined ? undefined : evidenceTextOf(t, state.result.evidence)
  const fidelity = state.result === undefined ? undefined : fidelityTextOf(t, state.result.fidelity)
  // A rewrite that lost literals is a caveat, not a failure: the missing facts
  // are in the text (re-pasted at the end), so the line warns in the same slot
  // the truncation warning uses and the clean verdict stays quiet.
  const fidelityWarns = state.result?.fidelity !== undefined && state.result.fidelity.reinjected > 0
  // A one-line error or a spinner does not need the comparison panel's width;
  // the narrow variant keeps the shell's own dialogs' proportions instead of
  // stretching an empty 880px card across the composer.
  const narrow = state.phase === 'error' || state.phase === 'loading'

  return (
    <div className="dsh-pe-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <section
        ref={panelRef}
        className={narrow ? 'dsh-pe-panel is-narrow' : 'dsh-pe-panel'}
        role="dialog"
        aria-modal="true"
        aria-label={t('panel.title')}
        tabIndex={-1}
      >
        <header className="dsh-pe-head">
          <span className="dsh-pe-head-title">
            <EnhanceStarIcon size={13} />
            {t('panel.title')}
          </span>
          {state.phase === 'result' && state.result !== undefined && (
            <span className="dsh-pe-meta">
              {t('panel.model', { provider: state.result.provider, model: state.result.model })} · {t('panel.elapsed', { ms: formatMs(state.result.elapsedMs) })}
            </span>
          )}
          <button type="button" className="dsh-pe-close" aria-label={t('panel.close')} onClick={onCancel}>✕</button>
        </header>
        {onPickMode !== undefined && (
          // 换一档不用回设置页，也不用记 /enhance --mode。但点击只负责"选中"：
          // 想让同一段正文按新档再改写一次，走右下角的显式重跑按钮。
          <div className="dsh-pe-modes" role="group" aria-label={t('settings.field.mode.label')} title={t('panel.modes.hint')}>
            {ENHANCE_MODES.map((id) => {
              const active = id === activeMode
              return (
                <button
                  key={id}
                  type="button"
                  className={active ? 'dsh-pe-mode is-active' : 'dsh-pe-mode'}
                  aria-pressed={active}
                  disabled={state.phase === 'loading'}
                  onClick={() => onPickMode(id)}
                >
                  {modeLabel(id)}
                </button>
              )
            })}
          </div>
        )}
        {state.phase === 'loading' && (
          <div className="dsh-pe-loading">
            <StreamingBody t={t} />
          </div>
        )}
        {state.phase === 'error' && state.error !== undefined && (
          <div className="dsh-pe-error">
            {state.error.localized !== undefined ? (
              // Client-side guard failures carry their own pre-localized copy.
              <div>{state.error.localized}</div>
            ) : (
              <>
                <div>{localizedErrorMessage(t, state.error.code, state.error.params)}</div>
                {errorDetail !== undefined && (
                  <div className="dsh-pe-error-detail">{errorDetail}</div>
                )}
              </>
            )}
          </div>
        )}
        {state.phase === 'result' && state.result !== undefined && (
          <div className="dsh-pe-body">
            <div className="dsh-pe-col">
              <div className="dsh-pe-col-title">{t('panel.original')}</div>
              <pre className="dsh-pe-col-text">{state.original}</pre>
            </div>
            <div className="dsh-pe-col">
              <div className="dsh-pe-col-title">{t('panel.enhanced')}</div>
              <pre className="dsh-pe-col-text">{state.result.text}</pre>
            </div>
          </div>
        )}
        {state.phase === 'result' && state.plainRefs === true && (
          // The draft had chips. The rewrite kept them verbatim, but applying
          // it writes back through `setDraft`, which flattens every chip into
          // its literal text. Stated here — the moment before the apply — not
          // after the operator notices the highlight is gone.
          <div className="dsh-pe-evidence dsh-pe-plainrefs">{t('panel.plainRefs')}</div>
        )}
        {state.phase === 'result' && evidence !== undefined && (
          // What this call actually shared with the model provider: the grounding
          // layers the host reported. Absent on an ungrounded call and on every
          // host older than the field, in which case nothing renders here.
          <div className="dsh-pe-evidence">{evidence}</div>
        )}
        {state.phase === 'result' && fidelity !== undefined && (
          // The fidelity receipt: what the deterministic gate found, and — when
          // the model dropped a literal — the fact that it was re-pasted at the
          // end rather than written by the model.
          <div className={fidelityWarns ? 'dsh-pe-stale' : 'dsh-pe-evidence'}>{fidelityWarns ? '⚠ ' : ''}{fidelity}</div>
        )}
        {state.phase === 'result' && state.result !== undefined && state.result.truncated === true && (
          // A capped rewrite is a success with a caveat, never a silent
          // truncation: say it right above the apply/copy actions.
          <div className="dsh-pe-stale">⚠ {t('panel.truncated')}</div>
        )}
        {state.phase === 'result' && state.stale && (
          <div className="dsh-pe-stale">⚠ {t('panel.stale.warn')}</div>
        )}
        {state.phase === 'result' && history !== undefined && history.length > 0 && (
          // 增强历史：撤销条只保留最近一次应用（且会被下一次应用顶掉），这里是
          // 同一个 composer 最近的若干次改写，用来找回更早的结果。
          <details className="dsh-pe-history">
            <summary>{t('panel.history.title', { count: String(history.length) })}</summary>
            <ul className="dsh-pe-history-list">
              {history.map((entry) => (
                <li key={entry.id} className="dsh-pe-history-item">
                  <div className="dsh-pe-history-meta">
                    <span>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {entry.mode !== undefined && <span> · {t('panel.history.mode', { mode: entry.mode })}</span>}
                    {entry.template !== undefined && <span> · {t('panel.history.template', { template: entry.template })}</span>}
                  </div>
                  <div className="dsh-pe-history-text">{t('panel.history.original')}{previewText(entry.original)}</div>
                  {onApplyHistory !== undefined && (
                    <button type="button" className="dsh-pe-btn-action plain" onClick={() => onApplyHistory(entry)}>
                      {t('panel.history.apply')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {onClearHistory !== undefined && (
              <button type="button" className="dsh-pe-btn-action plain" onClick={onClearHistory}>
                {t('panel.history.clear')}
              </button>
            )}
          </details>
        )}
        <footer className="dsh-pe-foot">
          <span className="dsh-pe-grow" />
          {state.phase !== 'loading' && onRerun !== undefined && (
            <button type="button" className="dsh-pe-btn-action plain" onClick={onRerun}>{t('panel.rerun')}</button>
          )}
          {state.phase === 'error' && retryable(state.error?.code) && onRetry !== undefined && (
            <button type="button" className="dsh-pe-btn-action plain" onClick={onRetry}>{t('panel.retry')}</button>
          )}
          {state.phase === 'result' && (
            <>
              <button type="button" className="dsh-pe-btn-action plain" onClick={copy}>
                {copied === 'ok' ? t('panel.copied') : copied === 'failed' ? t('panel.copyFailed') : t('panel.copy')}
              </button>
              <button type="button" className="dsh-pe-btn-action primary" onClick={onApply}>{t('panel.apply')}</button>
            </>
          )}
          {state.phase !== 'result' && (
            <button type="button" className="dsh-pe-btn-action plain" onClick={onCancel}>
              {state.phase === 'loading' ? t('panel.cancel') : t('panel.close')}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

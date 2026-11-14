/**
 * The composer enhance button (conversation.input.right): reads the live
 * draft through the session standard kit, applies every local guard
 * (empty / over-length / images-only / command-or-reference chips / busy),
 * then calls the host route and shows the preview panel. Applying the
 * result remembers the original on the undo stack before setDraft, so one
 * click restores it. The button never blocks the composer: on any failure
 * the draft stays exactly as the user typed it.
 * @module dsh-prompt-refine/client/EnhanceButton
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EnhanceError } from '../shared/protocol'
import type { EnhanceMode } from '../shared/modes'
import { checkInputText } from '../shared/validate'
import { EnhanceClientError, requestEnhance, requestEnhanceStream } from './enhance-client'
import { EnhanceBusyIcon, EnhanceStarIcon } from './icons'
import type { EnhanceHistoryEntry } from './history'
import type { PromptEnhanceKey } from './locales'
import { ModeMenu } from './ModeMenu'
import { ResultPanel } from './ResultPanel'
import * as ui from './ui-state'
import { getClientSettings, subscribeClientSettings } from './settings'
import { useSessionKey, serverSessionId } from './session-key'

/** Props of the input.right entry: the InputZone owner share + session kit + locale seat. */
export type EnhanceButtonProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'prompt-enhance'>

/**
 * Read the length of an optional array-shaped field out of the host's input
 * state.
 *
 * `imageIds` and `occurrences` are part of the conversation input snapshot in
 * the dsh lines this plugin was written against, but a slot host is not
 * obliged to expose them, and reading `.length` off a missing field throws
 * *during render* — which React answers by unmounting the whole slot entry
 * behind its error boundary, so the composer loses the button and the console
 * fills with a stack trace instead of a usable feature. Reading defensively
 * turns an absent or malformed field into "no such count", which at worst
 * suppresses a notice (see the chip caveat in `start`); the enhancement itself
 * still runs.
 * @param value - the untrusted field.
 * @returns the array length, or 0 when the field is absent/not an array.
 */
function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * Read a field that downstream code requires to be a string. `draft` drives
 * `checkInputText`, which iterates the text — an absent field would throw on
 * click instead of on render, but it is the same class of brittleness against
 * an unknown host state shape.
 * @param value - the untrusted field.
 * @returns the string, or `''` when the field is absent/not a string.
 */
function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One composer's enhance trigger. */
export function EnhanceButton(props: EnhanceButtonProps): ReactNode {
  const { t, sessionId, useInput, inputActions } = props
  // 0.1.1-rc.2 carries sessionId on the props; 0.1.2-rc.1 dropped it. Use the
  // host id for UI keying when present, else a stable per-mount fallback.
  const uiKey = useSessionKey(sessionId, inputActions)
  const wireId = serverSessionId(sessionId)
  const draft = useInput((state) => stringOf((state as { draft?: unknown }).draft))
  const phase = useInput((state) => (state as { phase?: unknown }).phase)
  const occurrenceCount = useInput((state) => countOf((state as { occurrences?: unknown }).occurrences))
  const imageCount = useInput((state) => countOf((state as { imageIds?: unknown }).imageIds))
  const settings = useSyncExternalStore(subscribeClientSettings, getClientSettings)
  const panel = useSyncExternalStore(ui.subscribe, ui.getPanel)
  // 提前选档：选中的档位只决定"下一次点星发什么"，它本身不调模型。
  const pickedMode = useSyncExternalStore(ui.subscribe, () => ui.getPickedMode(uiKey))
  const effectiveMode: EnhanceMode = pickedMode ?? settings.mode
  const rootRef = useRef<HTMLButtonElement | null>(null)
  // 菜单开合：星号现在是"选档 + 确认"的入口，不再是"立刻发一次调用"。
  const [menuOpen, setMenuOpen] = useState(false)
  const busy = panel !== undefined && panel.sessionId === uiKey && panel.phase === 'loading'
  // The preview panel is a single shared slot, so the UI admits exactly ONE
  // in-flight enhancement at a time across all sessions: `anyBusy` disables
  // every other composer's button while one request is loading. This is
  // deliberately stricter than the host `maxConcurrent` cap (default 2) —
  // that cap protects the /enhance command plane and multi-client callers,
  // while the single-panel UI cannot show two loading states anyway.
  const anyBusy = panel !== undefined && panel.phase === 'loading'
  // The OTHER composer is the one loading. See the button render below: a
  // cross-session busy state used to disable this button with no explanation,
  // which reads as "broken" in a multi-session layout.
  const otherBusy = anyBusy && !busy

  /** Fetch + panel transition. Shared by the trigger and the panel's mode
   * strip, so a rerun and a fresh enhancement take exactly the same path. */
  const submit = useCallback((text: string, mode: EnhanceMode, hasPlainRefs: boolean): void => {
    const controller = new AbortController()
    ui.openLoading({
      sessionId: uiKey,
      original: text,
      mode,
      ...(hasPlainRefs ? { plainRefs: true } : {}),
      abort: () => controller.abort(),
    })
    const settle = (result: Parameters<typeof ui.settleResult>[1]): void => ui.settleResult(uiKey, result)
    const fail = (error: unknown): void => {
      const detail: EnhanceError = error instanceof EnhanceClientError
        ? error.detail
        : { code: 'internal', message: error instanceof Error ? error.message : String(error) }
      ui.settleError(uiKey, detail)
    }
    // Progressive display when enabled: the panel fills in as the model
    // writes, and degrades to the one-shot call on its own when the host or
    // the transport cannot stream.
    if (settings.streaming) {
      requestEnhanceStream({ sessionId: wireId, text, mode }, {
        signal: controller.signal,
        onDelta: (delta: string): void => ui.appendDelta(uiKey, delta),
      }).then(settle, fail)
      return
    }
    requestEnhance({ sessionId: wireId, text, mode }, controller.signal).then(settle, fail)
  }, [settings.streaming, uiKey, wireId])

  /**
   * Guard chain + fetch + panel transition for this session.
   * @param mode - the mode the operator just confirmed in the menu; absent for
   * the shortcut, which keeps using the remembered selection.
   */
  const start = useCallback((mode?: EnhanceMode): void => {
    if (anyBusy) return
    if (!settings.enabled) {
      const disabled = t('error.disabled')
      ui.openError(uiKey, draft, { code: 'rejected', localized: disabled })
      return
    }
    if (imageCount > 0 && draft.trim() === '') {
      const imagesOnly = t('error.imagesOnly')
      ui.openError(uiKey, draft, { code: 'rejected', localized: imagesOnly })
      return
    }
    const check = checkInputText(draft, settings.maxInputChars)
    if (!check.ok) {
      const message = check.code === 'empty'
        ? t('error.empty')
        : t('error.tooLong', { count: check.count, max: check.max })
      ui.openError(uiKey, draft, { code: 'rejected', localized: message })
      return
    }
    // Reference chips are no longer a refusal. The server protects `@path` and
    // `/name` verbatim (src/shared/refs.ts swaps them for placeholder tokens and
    // restores them byte-for-byte after the model returns), but the only
    // write-back the host exposes is `setDraft`, which clears the composer
    // document and re-inserts plain text — so applying the result brings those
    // chips back as their literal text. That is a loss of affordance, not of
    // meaning: the draft is enhanced, and the result panel names the trade-off
    // (state.plainRefs) instead of blocking the operator before the call.
    const hasPlainRefs = occurrenceCount > 0 || phase === 'claimed'
    // Only the two phases where the host actually owns the document are
    // refused; `plain`, `claimed` and an absent phase field all mean "the
    // operator is still editing this draft".
    if (phase === 'submitting' || phase === 'adjudicating') {
      const busyPhase = t('error.phase')
      ui.openError(uiKey, draft, { code: 'rejected', localized: busyPhase })
      return
    }
    submit(draft, mode ?? effectiveMode, hasPlainRefs)
  }, [anyBusy, draft, effectiveMode, imageCount, occurrenceCount, phase, settings, submit, uiKey, t])

  /**
   * Re-run the panel's own draft under a mode picked on the panel's mode strip.
   * The text comes from the panel, never from the composer: the composer may
   * have moved on, and a rerun must reproduce the text whose result is on
   * screen. The guard chain is skipped on purpose — that draft already passed
   * it (or the panel would be showing the local rejection instead).
   */
  const rerun = useCallback((mode: EnhanceMode): void => {
    if (anyBusy) return
    const current = ui.getPanel()
    if (current === undefined || current.sessionId !== uiKey || current.phase === 'loading') return
    if (phase === 'submitting' || phase === 'adjudicating') return
    // Defense in depth for a panel that never had a call behind it: a locally
    // rejected draft is not something to send now either.
    if (!checkInputText(current.original, settings.maxInputChars).ok) return
    submit(current.original, mode, current.plainRefs === true || occurrenceCount > 0 || phase === 'claimed')
  }, [anyBusy, occurrenceCount, phase, settings.maxInputChars, submit, uiKey])

  /** 选中一档 —— 不发请求。换档不该花掉一次模型调用。 */
  const pick = useCallback((mode: EnhanceMode): void => {
    ui.pickMode(uiKey, mode)
  }, [uiKey])

  // The session registry holds a stable identity; run always dispatches to
  // the latest start callback. The refresh rides an effect (never the render
  // phase, which is unsafe under React 18 concurrent rendering).
  const runRef = useRef<(mode?: EnhanceMode) => void>(start)
  useEffect(() => {
    runRef.current = start
  })
  useEffect(() => {
    const entry: ui.SessionEntry = {
      root: rootRef.current,
      run: () => runRef.current(),
    }
    return ui.registerSession(uiKey, entry)
  }, [uiKey])

  // Draft changed after the request started → flag (or clear) the result
  // panel's stale marker so the user knows the result is based on the
  // pre-enhance text.
  useEffect(() => {
    if (panel !== undefined && panel.sessionId === uiKey && panel.phase === 'result') {
      ui.setStale(uiKey, draft !== panel.original)
    }
  }, [draft, panel, uiKey])

  /** Apply the enhanced result: remember the CURRENT draft (pre-apply, so
   * undo restores exactly this state even if the user typed during the
   * request), then fill the enhanced text back. */
  const apply = useCallback((): void => {
    if (panel === undefined || panel.phase !== 'result' || panel.result === undefined) return
    ui.pushUndo(uiKey, { original: draft, applied: panel.result.text })
    inputActions.setDraft(panel.result.text)
    ui.closePanel()
  }, [draft, inputActions, panel, uiKey])

  /** Bring an older rewrite back from the history: the same undo contract as
   * applying a fresh result (the CURRENT draft is what undo restores). */
  const applyHistory = useCallback((entry: EnhanceHistoryEntry): void => {
    ui.pushUndo(uiKey, { original: draft, applied: entry.result })
    inputActions.setDraft(entry.result)
    ui.closePanel()
  }, [draft, inputActions, uiKey])

  if (!settings.enabled) return null

  const owned = panel !== undefined && panel.sessionId === uiKey ? panel : undefined
  const modeLabel = t(`settings.mode.${effectiveMode}` as PromptEnhanceKey)
  // Retry re-runs the panel's ORIGINAL draft, not whatever the composer holds
  // now, and only for errors that came back from a real call: a local guard
  // rejection (`localized`) has no request to re-send.
  const retryMode = owned !== undefined && owned.phase === 'error' && owned.error?.localized === undefined
    ? owned.mode ?? settings.mode
    : undefined
  /** Stable identity: the menu's document-level listeners depend on it. */
  const closeMenu = useCallback((): void => setMenuOpen(false), [])
  /** 选一档即按该档增强：菜单里的点击就是确认，不再多花一次往返。 */
  const confirmMode = (mode: EnhanceMode): void => {
    closeMenu()
    pick(mode)
    start(mode)
  }
  return (
    <>
      <button
        ref={rootRef}
        type="button"
        className={`dsh-pe-btn${busy ? ' is-busy' : ''}`}
        title={busy
          ? t('button.busy')
          : otherBusy
            ? t('button.otherBusy')
            : t('button.titleWithMode', { mode: modeLabel })}
        aria-label={otherBusy ? t('button.otherBusy') : t('button.titleWithMode', { mode: modeLabel })}
        // `aria-disabled` instead of `disabled`: a disabled button is skipped by
        // the keyboard and by screen readers, so the reason this composer is
        // inert (another session's enhancement occupies the single preview
        // panel) would be unreachable exactly for the users who need it. The
        // click is a no-op either way (`start` returns early on `anyBusy`).
        aria-disabled={otherBusy || undefined}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => {
          if (anyBusy) return
          setMenuOpen((open) => !open)
        }}
      >
        <span className="dsh-pe-btn-icon" aria-hidden>
          {busy ? <EnhanceBusyIcon /> : <EnhanceStarIcon />}
        </span>
      </button>
      {menuOpen && !anyBusy && (
        <ModeMenu
          anchor={rootRef.current}
          value={effectiveMode}
          t={t}
          onPick={confirmMode}
          onClose={closeMenu}
        />
      )}
      {owned !== undefined && (
        createPortal(
          <ResultPanel
            state={owned}
            t={t}
            onApply={apply}
            onCancel={() => ui.closePanel()}
            // 高亮的是"下一跑会用哪一档"，不是"上一跑用了哪一档"。
            mode={effectiveMode}
            // 点档位只选中，不发请求：面板里的点击也不该烧 token。
            onPickMode={pick}
            // 重跑是一个显式动作，且只在这一档确实与上一跑不同时才出现。
            onRerun={owned.mode !== undefined && owned.phase !== 'loading' && effectiveMode !== owned.mode
              ? () => rerun(effectiveMode)
              : undefined}
            onRetry={retryMode === undefined ? undefined : () => rerun(retryMode)}
            history={ui.historyEntries(uiKey)}
            onApplyHistory={applyHistory}
            onClearHistory={() => ui.clearHistory(uiKey)}
          />,
          document.body,
        )
      )}
    </>
  )
}

/**
 * Module-level UI state shared by the slot components and the shortcut
 * listener: one panel state (loading/result/error + its abort controller),
 * one undo stack, one per-session enhancement history, and a registry of
 * mounted per-session triggers so the keyboard shortcut can find the composer
 * the user is working in. Every mutation notifies the external-store
 * subscribers the React components read through.
 * @module dsh-prompt-refine/client/ui-state
 */

import type { EnhanceError, EnhanceResult } from '../shared/protocol'
import type { EnhanceMode } from '../shared/modes'
import { createHistoryStore, type EnhanceHistoryEntry, type EnhanceHistoryStore } from './history'
import { createUndoStack, type UndoStack } from './undo-stack'

/** What the preview panel shows for one enhancement. */
export interface PanelState {
  readonly sessionId: string
  readonly phase: 'loading' | 'result' | 'error'
  /** The draft as it was when the request started (never mutated). */
  readonly original: string
  /**
   * The mode this request was sent with. The panel's mode chips highlight it
   * and a chip click re-runs against it, so it must survive settling even when
   * the result does not echo a mode (standard is reported as nothing).
   */
  readonly mode?: EnhanceMode
  readonly result?: EnhanceResult
  readonly error?: EnhanceError
  /** Cancels the in-flight request; absent once settled. */
  readonly abort?: () => void
  /** The composer draft changed after the request started — the result is based on the old text. */
  readonly stale?: boolean
  /**
   * Text already streamed from the model, shown while the call is still in
   * flight. Display-only: the result phase replaces it with the normalized
   * full body, which is what the user actually applies.
   */
  readonly streaming?: string
  /**
   * The draft carried host reference or command chips (`@path`, `/name`). The
   * call protects them verbatim, but the only write-back the host offers is
   * `setDraft`, which clears the composer document and re-inserts plain text —
   * so applying the result turns those chips into their literal text. Same
   * path, same command, no chip affordance. The result panel says so instead
   * of the operator discovering it after the fact.
   */
  readonly plainRefs?: boolean
}

/** One mounted composer trigger (the input.right button's session presence). */
export interface SessionEntry {
  /** The button's root element, for focused-composer detection. */
  root: HTMLElement | null
  /** Start one enhancement for this session (guards + fetch + panel). */
  run: () => void
}

const listeners = new Set<() => void>()
/**
 * Listeners that render the streamed text only (the panel's live body).
 *
 * A delta changes exactly one string, so waking every subscriber — the
 * composer trigger, the undo bar, the history list — re-rendered the whole
 * panel once per model token: seven mode chips, up to ten history rows and the
 * footer reconciled for every chunk, which is what makes a long rewrite feel
 * sticky. The split turns a delta into one `<pre>` reconciliation instead.
 */
const streamListeners = new Set<() => void>()
let panelState: PanelState | undefined
let version = 0

/** Notify every subscriber (React external store + shortcut bookkeeping). */
function notify(): void {
  version++
  for (const listener of listeners) listener()
}

/**
 * Pending streaming delta batch. Multiple `appendDelta` calls inside the same
 * JS turn (a single model stream tick may yield several delta chunks back to
 * back) are coalesced into one `panelState` mutation + one `notify()` instead
 * of N. This caps the React re-render rate at "once per microtask" instead of
 * "once per model token", which matters on long rewrites where a fast model
 * can push 100+ tokens/second and each sync `notify` triggers a full panel
 * re-render. The trade-off: callers that read `getPanel().streaming` SYNCHRONOUSLY
 * right after `appendDelta` see the OLD value until the microtask flushes;
 * every test or component that needs the new value should `await Promise.resolve()`
 * first. In React this is automatic — the component subscribes via
 * `useSyncExternalStore` and reads during render, which runs after the
 * microtask completes.
 */
let pendingDeltaText = ''
let pendingDeltaSession: string | undefined
let pendingDeltaScheduled = false

/** Drain the pending delta into panelState and notify subscribers. */
function flushPendingDelta(): void {
  pendingDeltaScheduled = false
  if (pendingDeltaText === '' || pendingDeltaSession === undefined) return
  const sessionId = pendingDeltaSession
  const text = pendingDeltaText
  pendingDeltaText = ''
  pendingDeltaSession = undefined
  // Re-check the panel state on flush: the panel may have moved on (settled,
  // replaced, closed) between schedule and flush, in which case the batch
  // must be dropped so a late delta can never leak into another result.
  if (panelState === undefined || panelState.sessionId !== sessionId || panelState.phase !== 'loading') return
  panelState = { ...panelState, streaming: (panelState.streaming ?? '') + text }
  // Streamed text is a slice, not a state transition: only the live body
  // subscribers need to hear about it (see `streamListeners`).
  for (const listener of streamListeners) listener()
}

/** Schedule one microtask flush if none is already pending. */
function scheduleDeltaFlush(): void {
  if (pendingDeltaScheduled) return
  pendingDeltaScheduled = true
  queueMicrotask(flushPendingDelta)
}

/** The shared undo store (depth 3 per session). */
const undoStore: UndoStack = createUndoStack(3)

/** Remember one replacement for a session and notify subscribers. */
export function pushUndo(sessionId: string, entry: Parameters<UndoStack['push']>[1]): void {
  undoStore.push(sessionId, entry)
  notify()
}

/** Newest undo entry of a session, when one exists. */
export function peekUndo(sessionId: string): ReturnType<UndoStack['peek']> {
  return undoStore.peek(sessionId)
}

/** Remove the newest undo entry of a session and notify subscribers. */
export function popUndo(sessionId: string): ReturnType<UndoStack['pop']> {
  const entry = undoStore.pop(sessionId)
  notify()
  return entry
}

/** The shared enhancement history (10 per session, 40 sessions). */
const historyStore: EnhanceHistoryStore = createHistoryStore(10, 40)

/** Newest-first settled rewrites of one session (read-only view). */
export function historyEntries(sessionId: string): readonly EnhanceHistoryEntry[] {
  return historyStore.list(sessionId)
}

/** Forget one session's history and notify subscribers. */
export function clearHistory(sessionId: string): void {
  historyStore.clear(sessionId)
  notify()
}

/**
 * Per-session mode pre-selection: the mode the next star click will send.
 *
 * Picking is deliberately NOT a request. Comparing seven modes costs seven
 * model calls, and the panel strip only exists after the first one — so the
 * only way to avoid paying for a mode you did not want is to pick it before
 * the call is made. Undefined means "not chosen; use the configured default".
 */
const pickedModes = new Map<string, EnhanceMode>()

/** The mode this session selected in the composer, if it selected one. */
export function getPickedMode(sessionId: string): EnhanceMode | undefined {
  return pickedModes.get(sessionId)
}

/**
 * Select the mode this session's next call will send. No model call, no
 * request, no token: this is the whole point of the store.
 * @param sessionId - the composer key.
 * @param mode - the mode to use from now on.
 */
export function pickMode(sessionId: string, mode: EnhanceMode): void {
  if (pickedModes.get(sessionId) === mode) return
  pickedModes.set(sessionId, mode)
  notify()
}

/** Session registry of mounted triggers; the last mounted session is the shortcut fallback. */
const sessions = new Map<string, SessionEntry>()
let lastMountedSession: string | undefined

/**
 * Subscribe to panel/undo mutations.
 * @param listener - called after every mutation.
 * @returns the unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Current snapshot version (React external store change detector). */
export function getVersion(): number {
  return version
}

/**
 * Subscribe to the streamed-text slice alone. Coarse subscribers are
 * deliberately not woken by a delta, so a fast stream cannot re-render the
 * panel chrome.
 * @param listener - called after every coalesced delta flush.
 * @returns the unsubscribe function.
 */
export function subscribeStreaming(listener: () => void): () => void {
  streamListeners.add(listener)
  return () => {
    streamListeners.delete(listener)
  }
}

/**
 * The text streamed so far, or '' outside a streaming load. A primitive, so
 * `useSyncExternalStore` compares by value rather than by snapshot identity.
 * @returns the streamed text of the open panel.
 */
export function getStreamingText(): string {
  if (panelState === undefined || panelState.phase !== 'loading') return ''
  return panelState.streaming ?? ''
}

/** The panel state, or undefined while closed. */
export function getPanel(): PanelState | undefined {
  return panelState
}

/**
 * Abort one in-flight panel request without letting its teardown failure
 * block the transition. The panel is replaced either way: an abort callback
 * that throws must not leave the store half-mutated, or the button inert.
 * @param state - the panel being replaced/closed, when one is open.
 */
function abortOf(state: PanelState | undefined): void {
  try {
    state?.abort?.()
  } catch {
    // A dead fetch/stream is already cancelled; nothing left to do.
  }
}

/** Open (or replace) the panel in the loading phase. Any in-flight request
 * from the replaced panel is aborted first, so it cannot become an orphan. */
export function openLoading(state: Omit<PanelState, 'phase' | 'result' | 'error'>): void {
  abortOf(panelState)
  panelState = { ...state, phase: 'loading' }
  notify()
}

/** Settle the open panel with a result. Ignored when the panel moved on. */
export function settleResult(sessionId: string, result: EnhanceResult): void {
  if (panelState?.sessionId !== sessionId || panelState.phase !== 'loading') return
  const original = panelState.original
  panelState = {
    sessionId,
    phase: 'result',
    original,
    ...(panelState.mode === undefined ? {} : { mode: panelState.mode }),
    result,
    // The chip caveat survives settling: the moment of loss is the apply, not
    // the call, so the notice has to be on screen when the button is clicked.
    ...(panelState.plainRefs === true ? { plainRefs: true } : {}),
  }
  // 同时记入历史：撤销条只保留最近一次应用、且会被下一次应用顶掉，历史是
  // 「刚才那次改写还想再看一眼」的退路。只存面板已经展示过的文本。
  historyStore.record(sessionId, {
    original,
    result: result.text,
    ...(result.mode === undefined ? {} : { mode: result.mode }),
    ...(result.template === undefined ? {} : { template: result.template }),
  })
  notify()
}

/** Settle the open panel with an error. Ignored when the panel moved on. */
export function settleError(sessionId: string, error: EnhanceError): void {
  if (panelState?.sessionId !== sessionId || panelState.phase !== 'loading') return
  panelState = {
    sessionId,
    phase: 'error',
    original: panelState.original,
    ...(panelState.mode === undefined ? {} : { mode: panelState.mode }),
    error,
  }
  notify()
}

/**
 * Append newly displayable text to the loading panel. Multiple calls inside
 * the same JS turn are coalesced into a single panelState mutation (see the
 * `pendingDeltaText` notes above). Dropped synchronously when the panel is
 * gone / on a different session / not in the loading phase, and dropped
 * again on flush if the panel moved on in between — so a late delta from an
 * aborted stream can never leak into another result.
 */
export function appendDelta(sessionId: string, text: string): void {
  if (text === '') return
  if (panelState === undefined || panelState.sessionId !== sessionId || panelState.phase !== 'loading') return
  pendingDeltaText += text
  pendingDeltaSession = sessionId
  scheduleDeltaFlush()
}

/** Open the panel directly in the error phase (local validation failures). */
export function openError(sessionId: string, original: string, error: EnhanceError): void {
  abortOf(panelState)
  panelState = { sessionId, phase: 'error', original, error }
  notify()
}

/**
 * Flag the open result panel as stale (or clear the flag): stale means the
 * composer draft changed after the request started, so the result is based
 * on the old text. Ignored for any other phase or session.
 */
export function setStale(sessionId: string, stale: boolean): void {
  if (panelState?.sessionId !== sessionId || panelState.phase !== 'result' || panelState.stale === stale) return
  panelState = { ...panelState, stale }
  notify()
}

/** Close the panel (cancel/dismiss/apply); aborts an in-flight request. */
export function closePanel(): void {
  abortOf(panelState)
  if (panelState === undefined) return
  panelState = undefined
  notify()
}

/**
 * Register one session's mounted trigger; returns the unregister function.
 * The most recent registration becomes the shortcut's fallback target.
 */
export function registerSession(sessionId: string, entry: SessionEntry): () => void {
  sessions.set(sessionId, entry)
  lastMountedSession = sessionId
  notify()
  return () => {
    if (sessions.get(sessionId) === entry) sessions.delete(sessionId)
    if (lastMountedSession === sessionId) {
      // Fall back to the most recently mounted session still in the registry
      // so the shortcut keeps a target in multi-session layouts.
      const keys = [...sessions.keys()]
      lastMountedSession = keys[keys.length - 1]
    }
    if (panelState?.sessionId === sessionId) closePanel()
    undoStore.clear(sessionId)
    pickedModes.delete(sessionId)
    notify()
  }
}

/**
 * Pick the session the shortcut should act on: the composer containing the
 * focused element when identifiable (the lowest ancestor of the focus that
 * also contains a registered button, within the composer card's depth),
 * otherwise the most recently mounted one. Returns the entry's run callback.
 */
export function shortcutTarget(): (() => void) | undefined {
  const active = document.activeElement
  if (active !== null && active instanceof Element) {
    let node: Element | null = active
    // The composer card sits within a handful of levels above the textarea;
    // stopping here keeps a settings-page focus from matching via <body>.
    for (let depth = 0; depth < 8 && node !== null; depth++) {
      for (const entry of sessions.values()) {
        if (entry.root !== null && (node === entry.root || node.contains(entry.root))) {
          const found = entry
          return () => found.run()
        }
      }
      node = node.parentElement
    }
  }
  const fallback = lastMountedSession !== undefined ? sessions.get(lastMountedSession) : undefined
  return fallback === undefined ? undefined : () => fallback.run()
}

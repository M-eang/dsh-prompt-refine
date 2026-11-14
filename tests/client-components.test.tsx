// @vitest-environment jsdom
/**
 * Component-level regression tests for the composer enhance flow: the guard
 * chain, the loading → result → apply → undo loop (including the apply/
 * pushUndo/setDraft/UndoBar ordering that must survive React batching),
 * stale marking both ways, and busy-state behavior. The host route is
 * mocked; the ui-state module is the real one.
 * @module tests/client-components
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { EnhanceButton } from '../src/client/EnhanceButton'
import { UndoBar } from '../src/client/UndoBar'
import { requestEnhance, requestEnhanceStream } from '../src/client/enhance-client'
import { zh } from '../src/client/locales'
import * as ui from '../src/client/ui-state'
import { DEFAULT_CLIENT_SETTINGS, setClientSettings } from '../src/client/settings'

/**
 * The slice of the conversation input machine this suite drives.
 *
 * Written out rather than imported: `InputState` lives in
 * `dsh-client-ui-conversation/lib/types/client/input/contract.ts` and is
 * deliberately NOT re-exported from the package root or its `./client` entry
 * (its own doc calls that three-tier visibility intentional), so importing it
 * from the package name is a type error — and it cannot be recovered from the
 * slot prop either, because `SnapshotSelectorHook<T>` is itself generic in the
 * selector's result, which erases the state type. Literal types are the honest
 * stand-in; the props below are built as `never` and the double is exercised
 * against the real `EnhanceButton`, so a contract drift still surfaces.
 */
interface InputState {
  readonly draft: string
  readonly imageIds: readonly unknown[]
  readonly occurrences: readonly { readonly hint?: string }[]
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  readonly draftRev: number
  readonly queue: readonly unknown[]
}

vi.mock('../src/client/enhance-client', () => ({
  EnhanceClientError: class extends Error {
    detail: { code: string; message: string }
    constructor(detail: { code: string; message: string }) {
      super(detail.message)
      this.detail = detail
    }
  },
  requestEnhance: vi.fn(),
  requestEnhanceStream: vi.fn(),
}))

const t = ((key: string, params?: Record<string, unknown>): string => {
  let s = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) s = s.split(`{${name}}`).join(String(value))
  return s
}) as TranslateNS<'prompt-enhance'>

/** Minimal fake of the per-session input machine store: synchronous, like the real one. */
function makeFakeInput(initial: Partial<InputState> & { draft: string }) {
  let state: InputState = {
    phase: 'plain',
    occurrences: [],
    imageIds: [],
    draftRev: 0,
    queue: [],
    ...initial,
  } as InputState
  const subscribers = new Set<() => void>()
  function useInput<S>(selector: (s: InputState) => S): S {
    return useSyncExternalStore(
      (onStoreChange) => {
        subscribers.add(onStoreChange)
        return () => {
          subscribers.delete(onStoreChange)
        }
      },
      () => selector(state),
    )
  }
  return {
    useInput,
    /** Simulate one machine publish: new snapshot object, all subscribers notified. */
    set(partial: Partial<InputState>): void {
      state = { ...state, ...partial }
      for (const notify of subscribers) notify()
    },
  }
}

function renderComposer(
  input: ReturnType<typeof makeFakeInput>,
  inputActions: Parameters<typeof EnhanceButton>[0]['inputActions'],
  sessionId: string | undefined,
): void {
  const props = { t, sessionId, useInput: input.useInput, inputActions } as never
  render(
    <>
      <EnhanceButton {...props} />
      <UndoBar {...props} />
    </>,
  )
}

// The star's accessible name now carries the mode it will run, so it is found
// by class: an exact-name lookup would break the moment a mode is picked.
const enhanceButton = (): HTMLButtonElement => {
  const star = document.querySelector<HTMLButtonElement>('button.dsh-pe-btn')
  if (star === null) throw new Error('enhance button missing')
  return star
}

// The one-shot path is the baseline every existing assertion was written
// against; the incremental path gets its own describe with streaming on.
beforeEach(() => {
  vi.mocked(requestEnhance).mockReset()
  vi.mocked(requestEnhanceStream).mockReset()
  setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false })
})

/**
 * Click the star and pick a mode from the menu it opens — the composer's one
 * deliberate gesture since 0.2.16. When no menu opens (busy, another session's
 * panel) the lookup is a no-op, which is exactly what those assertions mean.
 */
const clickEnhance = (mode = 'standard'): void => {
  fireEvent.click(enhanceButton())
  const label = (zh as Record<string, string>)[`settings.mode.${mode}`]
  const row = screen.queryAllByRole('menuitemradio').find((node) => node.getAttribute('aria-label') === label)
  if (row !== undefined) fireEvent.click(row)
}

describe('dsh 0.1.2-rc.1 dual-compat (host omits sessionId)', () => {
  afterEach(cleanup)

  // rc.1 dropped `sessionId` from the input slot standard props. The button
  // (input.right) and the undo bar (input.dock) are separate component trees,
  // so both must still land on the SAME fallback key — otherwise the undo bar
  // silently never appears after an apply.
  it('keys the button and the undo bar to the same composer and drops the session route', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, undefined)
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    clickEnhance()
    expect(await screen.findByText('增强文本')).toBeTruthy()
    // No host id → the server degrades to the harness default model route.
    expect(requestEnhance).toHaveBeenCalledWith({ sessionId: undefined, text: '旧原文', mode: 'standard' }, expect.anything())

    fireEvent.click(screen.getByRole('button', { name: zh['panel.apply'] }))
    expect(setDraft).toHaveBeenCalledWith('增强文本')
    expect(screen.getByText(zh['undo.applied'])).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['undo.undo'] }))
    expect(setDraft).toHaveBeenLastCalledWith('旧原文')
    expect(screen.queryByText(zh['undo.applied'])).toBeNull()
  })
})

describe('EnhanceButton guard chain', () => {
  afterEach(cleanup)

  it('refuses an empty draft with the localized empty message', () => {
    const input = makeFakeInput({ draft: '   ' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    clickEnhance()
    expect(screen.getByText(zh['error.empty'])).toBeTruthy()
    expect(requestEnhance).not.toHaveBeenCalled()
  })

  it('refuses image-only drafts', () => {
    const input = makeFakeInput({ draft: '', imageIds: ['img1' as never] })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    clickEnhance()
    expect(screen.getByText(zh['error.imagesOnly'])).toBeTruthy()
  })

  // Chips used to be a hard refusal ("commands or file references are not
  // supported"). The server now protects them verbatim (src/shared/refs.ts), so
  // the only real caveat is the write-back: `setDraft` flattens chips to text.
  it('enhances a draft containing reference chips and flags the plain-text write-back', () => {
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })
    const input = makeFakeInput({ draft: '看 @src/app.ts 这段为什么慢', occurrences: [{}] as never })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    clickEnhance()
    expect(requestEnhance).toHaveBeenCalled()
    expect(ui.getPanel()?.plainRefs).toBe(true)
  })

  it('enhances a draft whose first line is a slash command claim', () => {
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })
    const input = makeFakeInput({ draft: '/code-review 看下这段', phase: 'claimed' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    clickEnhance()
    expect(requestEnhance).toHaveBeenCalled()
    expect(ui.getPanel()?.plainRefs).toBe(true)
  })

  it('still refuses while the host owns the document', () => {
    const input = makeFakeInput({ draft: '正在发', phase: 'submitting' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    clickEnhance()
    expect(screen.getByText(zh['error.phase'])).toBeTruthy()
    expect(requestEnhance).not.toHaveBeenCalled()
  })

  // Regression: `imageIds` / `occurrences` are part of the input snapshot in
  // the dsh lines this plugin was written against, but a slot host need not
  // expose them. Reading `.length` off a missing field throws DURING RENDER,
  // and React answers that by unmounting the whole slot entry behind its error
  // boundary — the composer silently loses the button and the console fills
  // with a stack trace (observed live as
  // "slot entry crashed in 'conversation.input.right'").
  it('renders when the host input state omits imageIds and occurrences', () => {
    const input = makeFakeInput({ draft: '旧原文' })
    const bare = {
      useInput: <S,>(selector: (s: { draft: string; phase: string }) => S): S => selector({ draft: '旧原文', phase: 'plain' }),
      set: () => {},
    }
    expect(() => {
      render(
        <>
          <EnhanceButton {...({ t, sessionId: 's1', useInput: bare.useInput, inputActions: { setDraft: vi.fn() } } as never)} />
          <UndoBar {...({ t, sessionId: 's1', useInput: bare.useInput, inputActions: { setDraft: vi.fn() } } as never)} />
        </>,
      )
    }).not.toThrow()
    // The button is on screen and none of the advisory guards misfired.
    expect(enhanceButton()).toBeTruthy()
    expect(screen.queryByText(zh['error.imagesOnly'])).toBeNull()
    expect(screen.queryByText(zh['error.phase'])).toBeNull()
    expect(input).toBeDefined()
  })
})

describe('enhance → apply → undo loop', () => {
  afterEach(cleanup)

  it('runs the full loop: loading → result → apply fills back and raises the undo bar → undo restores', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 's1')
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    clickEnhance()
    expect(await screen.findByText('增强文本')).toBeTruthy()
    expect(requestEnhance).toHaveBeenCalledWith({ sessionId: 's1', text: '旧原文', mode: 'standard' }, expect.anything())

    fireEvent.click(screen.getByRole('button', { name: zh['panel.apply'] }))
    expect(setDraft).toHaveBeenCalledWith('增强文本')
    // The undo bar must survive React batching: the pushed entry stays even
    // though the draft just changed to the applied text (regression lock for
    // the apply → pushUndo → setDraft → UndoBar ordering).
    expect(screen.getByText(zh['undo.applied'])).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['undo.undo'] }))
    expect(setDraft).toHaveBeenLastCalledWith('旧原文')
    expect(screen.queryByText(zh['undo.applied'])).toBeNull()
  })

  it('marks the result stale (both ways) when the draft changes after the request started', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    clickEnhance()
    await screen.findByText('增强文本')
    // User edits during the result view → stale warning appears…
    act(() => { input.set({ draft: '编辑后的新文本' }) })
    expect(await screen.findByText(`⚠ ${zh['panel.stale.warn']}`)).toBeTruthy()
    // …and disappears again when the draft matches the source text.
    act(() => { input.set({ draft: '旧原文' }) })
    await screen.findByText(zh['panel.enhanced'])
    expect(screen.queryByText(`⚠ ${zh['panel.stale.warn']}`)).toBeNull()
  })

  it('applying over a diverged draft pushes the CURRENT draft as undo original', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    const setDraft = vi.fn((text: string) => input.set({ draft: text }))
    renderComposer(input, { setDraft } as never, 's1')
    vi.mocked(requestEnhance).mockResolvedValue({ text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 })

    clickEnhance()
    await screen.findByText('增强文本')
    act(() => { input.set({ draft: '用户编辑的新文本' }) })
    fireEvent.click(screen.getByRole('button', { name: zh['panel.apply'] }))
    expect(setDraft).toHaveBeenLastCalledWith('增强文本')
    // Undo restores the user's latest edits, not the stale pre-enhance text.
    fireEvent.click(screen.getByRole('button', { name: zh['undo.undo'] }))
    expect(setDraft).toHaveBeenLastCalledWith('用户编辑的新文本')
  })

  it('ignores a click while this session is already enhancing (no orphaned panel swap)', async () => {
    const input = makeFakeInput({ draft: '草稿' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    vi.mocked(requestEnhance).mockReturnValue(new Promise(() => {}))

    clickEnhance()
    expect(await screen.findByText(zh['panel.loading'])).toBeTruthy()
    clickEnhance()
    // The loading panel is untouched — no error panel swap, request not orphaned.
    expect(screen.getByText(zh['panel.loading'])).toBeTruthy()
    expect(screen.queryByText(zh['error.phase'])).toBeNull()
  })
})

describe('mode selection spends nothing until re-run', () => {
  afterEach(cleanup)

  it('a chip click only selects — no model call', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    vi.mocked(requestEnhance).mockResolvedValueOnce({ text: '第一版', provider: 'p', model: 'm', elapsedMs: 5 })

    clickEnhance()
    await screen.findByText('第一版')
    expect(requestEnhance).toHaveBeenCalledTimes(1)
    expect(requestEnhance).toHaveBeenLastCalledWith({ sessionId: 's1', text: '旧原文', mode: 'standard' }, expect.anything())

    fireEvent.click(screen.getByRole('button', { name: zh['settings.mode.engineering'] }))
    // 选档不是请求：点一下不该再烧一次调用。
    expect(requestEnhance).toHaveBeenCalledTimes(1)
    expect(ui.getPickedMode('s1')).toBe('engineering')
    expect(screen.getByRole('button', { name: zh['settings.mode.engineering'] }).getAttribute('aria-pressed')).toBe('true')
  })

  it('announces the mode it will run, and returns focus only on a keyboard dismissal', () => {
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    const star = enhanceButton()
    expect(star.getAttribute('aria-label')).toContain(zh['settings.mode.standard'])

    fireEvent.click(star)
    expect(screen.queryAllByRole('menuitemradio').length).toBe(7)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryAllByRole('menuitemradio').length).toBe(0)
    expect(document.activeElement).toBe(star)

    // 点空白处关掉不还焦点：没人点星号，它就不该亮出 focus ring。
    fireEvent.click(star)
    fireEvent.pointerDown(document.body)
    expect(screen.queryAllByRole('menuitemradio').length).toBe(0)
    expect(document.activeElement).not.toBe(star)
  })

  it('Tab closes the menu and leaves the caret at the star', () => {
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    const star = enhanceButton()

    fireEvent.click(star)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.queryAllByRole('menuitemradio').length).toBe(0)
    expect(document.activeElement).toBe(star)
  })

  it('the trigger announces the configured mode before any pick', () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: false, mode: 'engineering' })
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    expect(enhanceButton().getAttribute('aria-label')).toContain(zh['settings.mode.engineering'])
  })

  it('the star opens the mode menu, and the picked mode is the one that runs', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')

    // 点星号先出菜单，不发请求：选档和确认是同一次点击，但那次点击之前不花钱。
    fireEvent.click(enhanceButton())
    expect(requestEnhance).not.toHaveBeenCalled()
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.length).toBe(7)
    expect(rows.find((row) => row.getAttribute('aria-checked') === 'true')?.getAttribute('aria-label'))
      .toBe(zh['settings.mode.standard'])

    vi.mocked(requestEnhance).mockResolvedValueOnce({ text: '施工单版', provider: 'p', model: 'm', elapsedMs: 6, mode: 'engineering' })
    fireEvent.click(rows.find((row) => row.getAttribute('aria-label') === zh['settings.mode.engineering']) as HTMLElement)

    expect(await screen.findByText('施工单版')).toBeTruthy()
    expect(requestEnhance).toHaveBeenLastCalledWith({ sessionId: 's1', text: '旧原文', mode: 'engineering' }, expect.anything())
    expect(ui.getPickedMode('s1')).toBe('engineering')
    // 菜单选完就关，不会一直浮在输入框上面。
    expect(screen.queryAllByRole('menuitemradio').length).toBe(0)
  })

  it('re-runs the panel original — not the composer draft — only when asked', async () => {
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    vi.mocked(requestEnhance).mockResolvedValueOnce({ text: '第一版', provider: 'p', model: 'm', elapsedMs: 5 })
    clickEnhance()
    await screen.findByText('第一版')

    // 选中的就是上一跑用的那一档：没有重跑按钮，因为重跑没有意义。
    expect(screen.queryByRole('button', { name: zh['panel.rerun'] })).toBeNull()

    // The composer moves on; the rerun must still rewrite the text whose result
    // is on screen, or the panel would compare two different drafts.
    act(() => { input.set({ draft: '后来改的草稿' }) })
    fireEvent.click(screen.getByRole('button', { name: zh['settings.mode.engineering'] }))
    expect(requestEnhance).toHaveBeenCalledTimes(1)

    vi.mocked(requestEnhance).mockResolvedValueOnce({ text: '施工单版', provider: 'p', model: 'm', elapsedMs: 6, mode: 'engineering' })
    fireEvent.click(screen.getByRole('button', { name: zh['panel.rerun'] }))

    expect(await screen.findByText('施工单版')).toBeTruthy()
    expect(requestEnhance).toHaveBeenLastCalledWith({ sessionId: 's1', text: '旧原文', mode: 'engineering' }, expect.anything())
    expect(screen.getByRole('button', { name: zh['settings.mode.engineering'] }).getAttribute('aria-pressed')).toBe('true')
  })

  it('still shows the strip after a local guard rejection — but no retry and no re-run', async () => {
    const input = makeFakeInput({ draft: '   ' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's1')
    clickEnhance()

    expect(await screen.findByText(zh['error.empty'])).toBeTruthy()
    expect(requestEnhance).not.toHaveBeenCalled()
    // 被拒绝的是这段草稿，不是"选档"这件事：预选仍然可用。
    expect(document.querySelector('.dsh-pe-modes')).not.toBeNull()
    expect(screen.queryByRole('button', { name: zh['panel.retry'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['panel.rerun'] })).toBeNull()
  })
})

describe('incremental streaming display', () => {
  afterEach(cleanup)

  it('shows partial text while the call is in flight and settles on the final body', async () => {
    setClientSettings({ ...DEFAULT_CLIENT_SETTINGS, streaming: true })
    const input = makeFakeInput({ draft: '旧原文' })
    renderComposer(input, { setDraft: vi.fn() } as never, 's2')
    const result = { text: '增强文本', provider: 'p', model: 'm', elapsedMs: 5 }
    let release!: (value: typeof result) => void
    const gate = new Promise<typeof result>((resolve) => { release = resolve })
    vi.mocked(requestEnhanceStream).mockImplementation(async (_body, options) => {
      options.onDelta('增强')
      return gate
    })

    clickEnhance()
    // The first tokens are on screen long before the call settles.
    expect(await screen.findByText('增强')).toBeTruthy()
    expect(screen.getByText(zh['panel.streaming'])).toBeTruthy()
    expect(requestEnhance).not.toHaveBeenCalled()

    release(result)
    // …and the settled panel replaces the partial view with the real result.
    expect(await screen.findByText(zh['panel.enhanced'])).toBeTruthy()
    expect(screen.queryByText(zh['panel.streaming'])).toBeNull()
  })

  it('drops deltas that arrive after the panel moved on', async () => {
    ui.openLoading({ sessionId: 'late', original: 'x', abort: () => {} })
    ui.settleResult('late', { text: 'done', provider: 'p', model: 'm', elapsedMs: 1 })
    ui.appendDelta('late', 'stale text')
    // The stale delta is buffered behind a microtask flush; the panel must
    // still be streaming-undefined after the flush has run.
    await Promise.resolve()
    expect(ui.getPanel()?.streaming).toBeUndefined()
    ui.closePanel()
  })

  // Regression for the P1-1 batching optimization: 50 deltas in the same JS
  // turn must collapse into a single panelState mutation + one subscriber
  // notification, so React re-renders the preview panel exactly once instead
  // of 50 times during a fast model's first second of output.
  it('batches many same-turn deltas into a single panel update', async () => {
    const listener = vi.fn()
    // The flush now wakes the streaming slice only, so that is what a
    // per-delta notification is asserted against.
    const unsubscribe = ui.subscribeStreaming(listener)
    try {
      ui.openLoading({ sessionId: 'batch', original: 'x', abort: () => {} })
      const beforeBatching = listener.mock.calls.length
      for (let i = 0; i < 50; i++) ui.appendDelta('batch', `tok${i} `)
      // Synchronously, the panel is still the pre-batch snapshot — the
      // batching has scheduled the flush but not run it.
      expect(ui.getPanel()?.streaming).toBeUndefined()
      // No listener fire happened yet: the buffer absorbed everything.
      expect(listener.mock.calls.length).toBe(beforeBatching)
      await Promise.resolve()
      expect(ui.getPanel()?.streaming).toBe('tok0 tok1 tok2 tok3 tok4 tok5 tok6 tok7 tok8 tok9 tok10 tok11 tok12 tok13 tok14 tok15 tok16 tok17 tok18 tok19 tok20 tok21 tok22 tok23 tok24 tok25 tok26 tok27 tok28 tok29 tok30 tok31 tok32 tok33 tok34 tok35 tok36 tok37 tok38 tok39 tok40 tok41 tok42 tok43 tok44 tok45 tok46 tok47 tok48 tok49 ')
      // One notify for the whole batch, not 50.
      expect(listener.mock.calls.length).toBe(beforeBatching + 1)
    } finally {
      unsubscribe()
      ui.closePanel()
    }
  })

  // The reason the slice exists: a token must not wake the subscribers that
  // render the panel chrome (trigger, mode chips, history, footer), or a long
  // rewrite reconciles all of it once per chunk.
  it('keeps coarse subscribers asleep while deltas stream', async () => {
    const coarse = vi.fn()
    const fine = vi.fn()
    const stopCoarse = ui.subscribe(coarse)
    const stopFine = ui.subscribeStreaming(fine)
    try {
      ui.openLoading({ sessionId: 'slice', original: 'x', abort: () => {} })
      coarse.mockClear()
      fine.mockClear()
      ui.appendDelta('slice', 'tok')
      await Promise.resolve()
      expect(fine).toHaveBeenCalledTimes(1)
      expect(coarse).not.toHaveBeenCalled()
      expect(ui.getStreamingText()).toBe('tok')
      // Settling IS a transition: the coarse side hears it, and the slice goes
      // blank because the panel now shows the result body instead.
      ui.settleResult('slice', { text: 'done', provider: 'p', model: 'm', elapsedMs: 1 })
      expect(coarse).toHaveBeenCalled()
      expect(ui.getStreamingText()).toBe('')
    } finally {
      stopCoarse()
      stopFine()
      ui.closePanel()
    }
  })
})
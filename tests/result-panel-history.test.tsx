// @vitest-environment jsdom
/**
 * The preview panel's enhancement-history section: what it shows, what it
 * hides, and the two callbacks the shell owns. The store itself is covered by
 * `tests/history.test.ts`; here the REAL panel renders, so a section that
 * silently stopped drawing (or started drawing when it has nothing to show)
 * fails a test instead of shipping.
 * @module tests/result-panel-history
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { zh } from '../src/client/locales'
import { ResultPanel } from '../src/client/ResultPanel'
import type { EnhanceHistoryEntry } from '../src/client/history'
import type { PanelState } from '../src/client/ui-state'

/** Minimal zh renderer matching the shell's `t` seat (placeholders + unknown keys). */
const t = ((key: string, params?: Record<string, unknown>): string => {
  const dict = zh as Record<string, string>
  let text = dict[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.split(`{${name}}`).join(String(value))
  return text
}) as TranslateNS<'prompt-enhance'>

const settled: PanelState = {
  sessionId: 's1',
  phase: 'result',
  original: '帮我写个脚本',
  result: { text: '改写后的正文', provider: 'p', model: 'm', elapsedMs: 1 },
}

const entry = (over: Partial<EnhanceHistoryEntry> = {}): EnhanceHistoryEntry => ({
  id: 1,
  at: Date.now(),
  original: '第一行原文\n第二行',
  result: '旧结果',
  ...over,
})

const renderPanel = (history?: readonly EnhanceHistoryEntry[]): {
  container: HTMLElement
  onApplyHistory: ReturnType<typeof vi.fn>
  onClearHistory: ReturnType<typeof vi.fn>
} => {
  const onApplyHistory = vi.fn()
  const onClearHistory = vi.fn()
  const { container } = render(
    <ResultPanel
      state={settled}
      t={t}
      onApply={() => {}}
      onCancel={() => {}}
      {...(history === undefined ? {} : { history })}
      onApplyHistory={onApplyHistory}
      onClearHistory={onClearHistory}
    />,
  )
  return { container, onApplyHistory, onClearHistory }
}

afterEach(cleanup)

describe('ResultPanel enhancement history', () => {
  it('draws nothing when the shell passed no history', () => {
    expect(renderPanel(undefined).container.querySelector('.dsh-pe-history')).toBeNull()
  })

  it('draws nothing when the history is empty', () => {
    expect(renderPanel([]).container.querySelector('.dsh-pe-history')).toBeNull()
  })

  it('shows the count and only the first line of each draft', () => {
    const { container } = renderPanel([entry(), entry({ id: 2, original: '第二条第原文' })])
    const summary = container.querySelector('.dsh-pe-history > summary')
    expect(summary?.textContent).toBe(zh['panel.history.title'].replace('{count}', '2'))
    const texts = [...container.querySelectorAll('.dsh-pe-history-text')].map((n) => n.textContent)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('第一行原文')
    expect(texts[0]).not.toContain('第二行')
    expect(texts[1]).toContain('第二条第原文')
  })

  it('labels the mode and the template only when the entry carries them', () => {
    const { container } = renderPanel([
      entry(),
      entry({ id: 2, mode: 'spec', template: 'api-doc' }),
    ])
    const metas = [...container.querySelectorAll('.dsh-pe-history-meta')].map((n) => n.textContent ?? '')
    expect(metas[0]).not.toContain('档位')
    expect(metas[0]).not.toContain('模板')
    expect(metas[1]).toContain('spec')
    expect(metas[1]).toContain('api-doc')
  })

  it('hands the clicked entry to the shell and never applies it itself', () => {
    const history = [entry(), entry({ id: 2, original: '第二条' })]
    const { container, onApplyHistory } = renderPanel(history)
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.dsh-pe-history-item button')]
    expect(buttons).toHaveLength(2)
    buttons[1]?.click()
    expect(onApplyHistory).toHaveBeenCalledTimes(1)
    expect(onApplyHistory.mock.calls[0]?.[0]).toBe(history[1])
  })

  it('offers clear and forwards it to the shell', () => {
    const { container, onClearHistory } = renderPanel([entry()])
    const clear = [...container.querySelectorAll<HTMLButtonElement>('.dsh-pe-history button')].find(
      (b) => b.textContent === zh['panel.history.clear'],
    )
    expect(clear).toBeDefined()
    clear?.click()
    expect(onClearHistory).toHaveBeenCalledTimes(1)
  })
})

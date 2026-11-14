// @vitest-environment jsdom
/**
 * The seam between the panel's state machine and the history store: a settled
 * result is what feeds the history section, and it must record exactly what the
 * panel showed (including the mode/template labels) and nothing else. The
 * store's own rules are covered by `tests/history.test.ts`; the rendering by
 * `tests/result-panel-history.test.tsx`.
 * @module tests/history-wiring
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearHistory,
  closePanel,
  historyEntries,
  openLoading,
  settleResult,
  subscribe,
} from '../src/client/ui-state'

const settle = (sessionId: string, extra: Record<string, unknown> = {}): void => {
  settleResult(sessionId, {
    text: '改写后的正文',
    provider: 'p',
    model: 'm',
    elapsedMs: 1,
    ...extra,
  })
}

beforeEach(() => {
  closePanel()
})

describe('enhancement history wiring', () => {
  it('records a settled result with the applied mode and template', () => {
    clearHistory('hw1')
    openLoading({ sessionId: 'hw1', original: '帮我写个脚本' })
    settle('hw1', { mode: 'spec', template: 'api-doc' })
    const entries = historyEntries('hw1')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      original: '帮我写个脚本',
      result: '改写后的正文',
      mode: 'spec',
      template: 'api-doc',
    })
  })

  it('omits mode/template on the default path', () => {
    clearHistory('hw2')
    openLoading({ sessionId: 'hw2', original: '帮我写个脚本' })
    settle('hw2')
    const entry = historyEntries('hw2')[0]!
    expect(entry).not.toHaveProperty('mode')
    expect(entry).not.toHaveProperty('template')
  })

  it('does not record a settle that does not match the open panel', () => {
    clearHistory('hw3')
    openLoading({ sessionId: 'hw3', original: '帮我写个脚本' })
    settle('other-session')
    expect(historyEntries('hw3')).toEqual([])
  })

  it('does not record twice for the same panel', () => {
    clearHistory('hw4')
    openLoading({ sessionId: 'hw4', original: '帮我写个脚本' })
    settle('hw4')
    // 第二次 settle 时面板已离开 loading 阶段：那条守卫也必须挡住历史重复。
    settle('hw4')
    expect(historyEntries('hw4')).toHaveLength(1)
  })

  it('notifies subscribers when a result settles', () => {
    clearHistory('hw5')
    const seen: number[] = []
    const off = subscribe(() => seen.push(1))
    openLoading({ sessionId: 'hw5', original: '帮我写个脚本' })
    settle('hw5')
    off()
    expect(seen.length).toBeGreaterThanOrEqual(2)
  })

  it('forgets exactly one session on clearHistory', () => {
    clearHistory('hw6')
    openLoading({ sessionId: 'hw6', original: '帮我写个脚本' })
    settle('hw6')
    expect(historyEntries('hw6')).toHaveLength(1)
    clearHistory('hw6')
    expect(historyEntries('hw6')).toEqual([])
  })
})

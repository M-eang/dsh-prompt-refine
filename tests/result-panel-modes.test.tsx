// @vitest-environment jsdom
/**
 * 面板里的档位条：哪一枚高亮、点了要求哪一档、什么时候整条不出现、
 * 什么时候整条不可点，以及"重跑"是另一个显式按钮而不是点击的副作用。
 * 真正的重跑接线在 `tests/client-components.test.tsx` 里（那里能驱动真正的
 * 按钮和 ui-state），这里只渲染真实面板。
 * @module tests/result-panel-modes
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ENHANCE_MODES } from '../src/shared/modes'
import { zh } from '../src/client/locales'
import { ResultPanel } from '../src/client/ResultPanel'
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
  mode: 'engineering',
  result: { text: '改写后的正文', provider: 'p', model: 'm', elapsedMs: 1 },
}

interface RenderOptions {
  onPickMode?: (mode: string) => void
  onRerun?: () => void
  mode?: string
}

const renderPanel = (state: PanelState, options: RenderOptions = {}): HTMLElement => {
  const { container } = render(
    <ResultPanel
      state={state}
      t={t}
      onApply={() => {}}
      onCancel={() => {}}
      {...(options.onPickMode === undefined ? {} : { onPickMode: options.onPickMode as never })}
      {...(options.onRerun === undefined ? {} : { onRerun: options.onRerun })}
      {...(options.mode === undefined ? {} : { mode: options.mode as never })}
    />,
  )
  return container
}

const chip = (container: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll<HTMLButtonElement>('.dsh-pe-mode')]
    .find((node) => node.textContent === label)
  if (found === undefined) throw new Error(`no mode chip labelled ${label}`)
  return found
}

afterEach(cleanup)

describe('ResultPanel mode strip', () => {
  it('renders no strip without a selection handler', () => {
    expect(renderPanel(settled).querySelector('.dsh-pe-modes')).toBeNull()
  })

  it('renders every mode in the shared order with the selected one pressed', () => {
    const container = renderPanel(settled, { onPickMode: () => {} })
    const labels = [...container.querySelectorAll('.dsh-pe-mode')].map((node) => node.textContent)
    expect(labels).toEqual(ENHANCE_MODES.map((id) => zh[`settings.mode.${id}`]))
    expect(chip(container, zh['settings.mode.engineering']).getAttribute('aria-pressed')).toBe('true')
    expect(chip(container, zh['settings.mode.concise']).getAttribute('aria-pressed')).toBe('false')
  })

  it('highlights the mode prop over the mode the request used', () => {
    // 语义是"下一跑会用哪一档"：换了选择，高亮必须跟着走，哪怕上一跑用的是别的档。
    const container = renderPanel(settled, { onPickMode: () => {}, mode: 'research' })
    expect(chip(container, zh['settings.mode.research']).getAttribute('aria-pressed')).toBe('true')
    expect(chip(container, zh['settings.mode.engineering']).getAttribute('aria-pressed')).toBe('false')
  })

  it('asks for the clicked mode', () => {
    const onPick = vi.fn()
    const container = renderPanel(settled, { onPickMode: onPick })
    fireEvent.click(chip(container, zh['settings.mode.research']))
    expect(onPick).toHaveBeenCalledWith('research')
  })

  it('keeps the strip visible but inert while a call is in flight', () => {
    const container = renderPanel({ ...settled, phase: 'loading', result: undefined }, { onPickMode: () => {} })
    const chips = [...container.querySelectorAll<HTMLButtonElement>('.dsh-pe-mode')]
    expect(chips.length).toBe(ENHANCE_MODES.length)
    expect(chips.every((node) => node.disabled)).toBe(true)
  })

  it('shows the re-run button only when the caller wires it, and only outside loading', () => {
    expect(renderPanel(settled, { onPickMode: () => {} }).querySelector('.dsh-pe-foot')?.textContent)
      .not.toContain(zh['panel.rerun'])

    const onRerun = vi.fn()
    const container = renderPanel(settled, { onPickMode: () => {}, onRerun })
    const rerun = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((node) => node.textContent === zh['panel.rerun'])
    expect(rerun).toBeTruthy()
    fireEvent.click(rerun as HTMLButtonElement)
    expect(onRerun).toHaveBeenCalledTimes(1)

    const loading = renderPanel({ ...settled, phase: 'loading', result: undefined }, { onPickMode: () => {}, onRerun })
    expect(loading.textContent).not.toContain(zh['panel.rerun'])
  })
})

// @vitest-environment jsdom
/**
 * 星号上挂的档位菜单：七档的顺序与文案、当前档的对勾、点一档即回调、
 * Esc / 点外面才关；以及 ui-state 里"记住这一档"的会话级存储。
 * @module tests/mode-menu
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ENHANCE_MODES } from '../src/shared/modes'
import { zh } from '../src/client/locales'
import { ModeMenu } from '../src/client/ModeMenu'
import * as ui from '../src/client/ui-state'

const t = ((key: string, params?: Record<string, unknown>): string => {
  let text = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) text = text.split(`{${name}}`).join(String(value))
  return text
}) as TranslateNS<'prompt-enhance'>

/** The star the menu hangs off; has to be in the document to have a box to measure. */
function makeAnchor(): HTMLButtonElement {
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  return anchor
}

const renderMenu = (props: { value?: string; onPick?: (mode: string) => void; onClose?: () => void } = {}) => {
  const anchor = makeAnchor()
  const onPick = props.onPick ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  const view = render(
    <ModeMenu
      anchor={anchor}
      value={(props.value ?? 'standard') as never}
      t={t}
      onPick={onPick as never}
      onClose={onClose}
    />,
  )
  return { ...view, anchor, onPick, onClose }
}

afterEach(() => {
  cleanup()
  for (const node of [...document.querySelectorAll('button')]) node.remove()
})

describe('ModeMenu', () => {
  it('lists every mode in the shared order, in the user\'s language', () => {
    const { container } = renderMenu()
    const rows = [...(container.ownerDocument.querySelectorAll('[role="menuitemradio"]'))]
    expect(rows.map((row) => row.getAttribute('aria-label')))
      .toEqual(ENHANCE_MODES.map((id) => zh[`settings.mode.${id}`]))
  })

  it('marks the chosen mode and only that one', () => {
    const { container } = renderMenu({ value: 'engineering' })
    const checked = [...container.ownerDocument.querySelectorAll('[role="menuitemradio"]')]
      .filter((row) => row.getAttribute('aria-checked') === 'true')
    expect(checked.length).toBe(1)
    expect(checked[0].getAttribute('aria-label')).toBe(zh['settings.mode.engineering'])
  })

  it('reports the clicked mode — one click is selection and confirmation', () => {
    const onPick = vi.fn()
    const { container } = renderMenu({ onPick })
    const row = [...container.ownerDocument.querySelectorAll('[role="menuitemradio"]')]
      .find((node) => node.getAttribute('aria-label') === zh['settings.mode.colloquial'])
    fireEvent.click(row as Element)
    expect(onPick).toHaveBeenCalledWith('colloquial')
  })

  it('closes on Escape and on an outside press, but not on a press inside', () => {
    const { container, anchor, onClose } = renderMenu()
    const row = container.ownerDocument.querySelector('[role="menuitemradio"]') as Element
    fireEvent.pointerDown(row)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(anchor)
    // The trigger owns its own toggle: its press must not also dismiss here.
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('leaves arrow keys alone once focus has left the menu', () => {
    const { container } = renderMenu()
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    elsewhere.focus()

    // 文档级监听：焦点不在菜单里时绝不能抢回来，也不能吃掉光标键。
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(elsewhere)

    const row = container.ownerDocument.querySelector('[role="menuitemradio"]') as HTMLElement
    row.focus()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    expect(document.activeElement).not.toBe(row)
    elsewhere.remove()
  })

  it('closes on Tab and hands focus back to the trigger', () => {
    const { container, anchor, onClose } = renderMenu()
    const row = container.ownerDocument.querySelector('[role="menuitemradio"]') as HTMLElement
    row.focus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(onClose).toHaveBeenCalledTimes(1)
    // 焦点从星号继续往前走，而不是随菜单一起消失。
    expect(document.activeElement).toBe(anchor)
  })
})

describe('ui-state picked mode', () => {
  it('remembers a selection per session and notifies subscribers', () => {
    const seen = vi.fn()
    const stop = ui.subscribe(seen)
    ui.pickMode('pick-a', 'engineering')
    expect(ui.getPickedMode('pick-a')).toBe('engineering')
    expect(ui.getPickedMode('pick-b')).toBeUndefined()
    expect(seen).toHaveBeenCalled()
    // 同一档重复选中不该再通知（面板不会为了一个 no-op 重渲染）。
    seen.mockClear()
    ui.pickMode('pick-a', 'engineering')
    expect(seen).not.toHaveBeenCalled()
    stop()
  })

  it('forgets the selection when the composer unmounts', () => {
    ui.pickMode('pick-c', 'spec')
    const unregister = ui.registerSession('pick-c', { root: null, run: () => {} })
    unregister()
    expect(ui.getPickedMode('pick-c')).toBeUndefined()
  })
})

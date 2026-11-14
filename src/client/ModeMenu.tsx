/**
 * The mode menu the enhance trigger opens: pick a mode, and the enhancement
 * runs with it.
 *
 * It replaces the native `<select>` that used to sit next to the star. That
 * control was honest but unreadable — the platform renders it with its own
 * light popup inside a dark composer — and it also put a second, unrelated-
 * looking widget in the operator's row. The menu lives in this plugin's own
 * portal so it inherits the shell's theme tokens like the result panel does,
 * and it hangs off the star that owns the action.
 *
 * Picking a row IS the confirmation: the click names the mode and spends the
 * call it was going to spend anyway, so choosing never costs an extra
 * round trip (the 0.2.15 mistake was making selection free but the run
 * implicit; here both happen on the one deliberate click).
 * @module dsh-prompt-refine/client/ModeMenu
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ENHANCE_MODES, type EnhanceMode } from '../shared/modes'
import type { PromptEnhanceKey } from './locales'

/** Props of the mode menu. */
export interface ModeMenuProps {
  /** The trigger element the menu hangs off; also the click that toggles it. */
  anchor: HTMLElement | null
  /** The mode a row shows as already chosen. */
  value: EnhanceMode
  t: TranslateNS<'prompt-enhance'>
  /** Run the enhancement with this mode (selection and confirmation in one click). */
  onPick: (mode: EnhanceMode) => void
  /** Dismiss without running. */
  onClose: () => void
}

/** Gap between the anchor and the menu, and the minimum distance to the viewport edge. */
const GAP = 6
const MARGIN = 8

/**
 * Render the mode menu into a body-level portal.
 * @param props - anchor, current mode, locale reader, pick/close callbacks.
 * @returns the portalled menu.
 */
export function ModeMenu(props: ModeMenuProps): ReactNode {
  const { anchor, value, t, onPick, onClose } = props
  const menuRef = useRef<HTMLDivElement | null>(null)
  // Only the keyboard dismissal hands focus back; a pointer one has already
  // put focus where the user aimed.
  const keyboardClosed = useRef(false)
  // Undefined until measured: the first paint must not flash at the origin.
  const [pos, setPos] = useState<{ top: number; left: number } | undefined>(undefined)

  // Placement: above the trigger when there is room (the composer sits at the
  // bottom of the window), otherwise below; right edges aligned and clamped.
  useLayoutEffect(() => {
    const element = menuRef.current
    if (element === null || anchor === null) return
    const place = (): void => {
      const box = anchor.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      const above = box.top - rect.height - GAP
      const top = above >= MARGIN ? above : Math.min(box.bottom + GAP, window.innerHeight - rect.height - MARGIN)
      const left = Math.min(Math.max(MARGIN, box.right - rect.width), window.innerWidth - rect.width - MARGIN)
      const nextTop = Math.max(MARGIN, top)
      // Scroll and resize fire far more often than the box actually moves: keep
      // the previous state object when nothing changed, so a scroll frame does
      // not re-render the menu.
      setPos((prev) => (prev !== undefined && prev.top === nextTop && prev.left === left ? prev : { top: nextTop, left }))
    }
    place()
    window.addEventListener('resize', place)
    // The seat is sticky, not fixed: its rect still changes when the composer
    // grows (queue dock, a taller draft) or the transcript scrolls under it.
    window.addEventListener('scroll', place, true)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    if (anchor !== null) observer?.observe(anchor)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [anchor])

  // Focus the chosen row so the menu is usable from the keyboard the moment it
  // opens — and so Escape has an owner inside the menu.
  useEffect(() => {
    const element = menuRef.current
    if (element === null) return
    const target = element.querySelector<HTMLElement>('[aria-checked="true"]')
      ?? element.querySelector<HTMLElement>('button')
    target?.focus()
  }, [])

  // Outside click and Escape dismiss. The pointerdown is captured so a click on
  // the trigger itself is left to the trigger's own toggle (it is excluded
  // here), never double-handled.
  useEffect(() => {
    const onPointerDown = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) === true) return
      if (anchor?.contains(target) === true) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        keyboardClosed.current = true
        onClose()
        return
      }
      // Tab is the key that moves focus out of the menu: close it and let the
      // default move carry on from the trigger, so Tab lands on the control
      // after the star instead of nowhere.
      if (event.key === 'Tab') {
        if (menuRef.current?.contains(document.activeElement) !== true) return
        onClose()
        anchor?.focus()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      // Document-level listener: without this guard a Tab 出去之后按 ↑/↓ would
      // pull focus back into the menu and swallow the caret/scroll key.
      if (menuRef.current?.contains(document.activeElement) !== true) return
      const rows = [...(menuRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
      if (rows.length === 0) return
      event.preventDefault()
      const index = rows.findIndex((row) => row === document.activeElement)
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = rows[(index + step + rows.length) % rows.length]
      next?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchor, onClose])

  // Hand focus back to the trigger only when the keyboard dismissed the menu;
  // a pointer dismissal must not put a focus ring on a star nobody clicked.
  useEffect(() => () => {
    if (keyboardClosed.current) anchor?.focus()
  }, [anchor])

  return createPortal(
    <div
      ref={menuRef}
      className="dsh-pe-menu"
      role="menu"
      aria-label={t('button.mode.title')}
      style={pos === undefined ? { top: 0, left: 0, visibility: 'hidden' } : { top: pos.top, left: pos.left }}
    >
      <div className="dsh-pe-menu-title" role="presentation">{t('menu.title')}</div>
      {ENHANCE_MODES.map((id) => {
        const active = id === value
        const label = t(`settings.mode.${id}` as PromptEnhanceKey)
        return (
          <button
            key={id}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            aria-label={label}
            className={active ? 'dsh-pe-menu-item is-active' : 'dsh-pe-menu-item'}
            onClick={() => onPick(id)}
          >
            <span className="dsh-pe-menu-check" aria-hidden>{active ? '✓' : ''}</span>
            {label}
          </button>
        )
      })}
      <div className="dsh-pe-menu-hint" role="presentation">{t('menu.hint')}</div>
    </div>,
    document.body,
  )
}

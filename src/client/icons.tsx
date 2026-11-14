/**
 * The trigger's glyphs, drawn in the host's own line weight.
 *
 * The button used to render the `✨` emoji. Emoji are font-dependent: on Windows
 * they came out as a heavy orange fill, on macOS as a blue one, and either way
 * they sat visibly denser than the stroke icons the composer ships beside them
 * (the microphone, the send arrow). Drawing the same idea as an SVG keeps one
 * look everywhere and lets the glyph inherit `currentColor`, so it dims with the
 * button's own `opacity: 0.75` and brightens on hover without a second rule.
 *
 * @module dsh-prompt-refine/client/icons
 */

import type { ReactNode } from 'react'

/** Both glyphs are 24-unit drawings rendered at the composer's icon size. */
const BASE = 24

export interface IconProps {
  /** Rendered edge length in pixels; the composer's icons sit at 16. */
  readonly size?: number
  readonly className?: string
}

/** A four-point star with two satellite sparks: "enhance this draft". */
export function EnhanceStarIcon({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${BASE} ${BASE}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11.6 3.4 13 8.2a3.2 3.2 0 0 0 2.2 2.2l4.8 1.4-4.8 1.4a3.2 3.2 0 0 0-2.2 2.2l-1.4 4.8-1.4-4.8a3.2 3.2 0 0 0-2.2-2.2L3.2 11.8l4.8-1.4a3.2 3.2 0 0 0 2.2-2.2z" />
      <path d="M18.6 3.1v3.2" />
      <path d="M20.2 4.7h-3.2" />
      <path d="M5.6 16.6v2.2" />
      <path d="M6.7 17.7H4.5" />
    </svg>
  )
}

/** An open arc: the busy state, spun by `.dsh-pe-btn.is-busy`. */
export function EnhanceBusyIcon({ size = 16, className }: IconProps): ReactNode {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${BASE} ${BASE}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
    </svg>
  )
}

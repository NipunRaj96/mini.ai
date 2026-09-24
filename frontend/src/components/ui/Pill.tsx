import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  /** Selected/active styling — white text on the hover-surface tone, per the
   * real design's "Output Format" active-button pattern (not a colored fill). */
  active?: boolean
  /** Adds a small emerald status dot — the design's one accent, reserved for
   * connected/active/live indicators only. */
  live?: boolean
}

export function Pill({ active = false, live = false, className, children, ...props }: PillProps) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 py-1',
        'font-display text-[11px] font-medium uppercase tracking-[0.03em]',
        active
          ? 'border-rail-border bg-rail-hover text-on-surface'
          : 'border-rail-border bg-rail-elevated text-on-surface-mid',
        className,
      )}
      {...props}
    >
      {live && <span className="h-1 w-1 rounded-full bg-accent" aria-hidden="true" />}
      {children}
    </span>
  )
}

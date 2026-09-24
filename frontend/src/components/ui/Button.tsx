import { forwardRef, type ButtonHTMLAttributes } from 'react'
import clsx from 'clsx'

export type ButtonVariant = 'primary' | 'secondary' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  loading?: boolean
}

const baseClasses =
  'relative inline-flex items-center justify-center gap-2 font-display text-sm font-medium ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'rounded-sm bg-primary px-4 py-2 text-on-primary hover:bg-primary-hover active:bg-primary-hover',
  secondary:
    'rounded-sm border border-rail-border bg-transparent px-4 py-2 text-on-surface-mid ' +
    'hover:bg-rail-elevated hover:text-on-surface active:bg-rail-hover',
  icon: 'h-9 w-9 rounded-sm text-on-surface-mid hover:bg-rail-elevated hover:text-on-surface active:bg-rail-hover',
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        d="M4 12a8 8 0 0 1 8-8"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Primary/secondary/icon button. Loading swaps the label for a spinner
 * without resizing the button — the label stays in the layout (invisible)
 * while the spinner overlays it absolutely.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, disabled, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(baseClasses, variantClasses[variant], className)}
      {...props}
    >
      <span className={clsx(loading && 'invisible')}>{children}</span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
    </button>
  )
})

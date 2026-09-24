import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import clsx from 'clsx'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

/** Form input with label and inline error state, per the Espresso Artisan spec. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = error ? `${inputId}-error` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="font-display text-[11px] font-medium uppercase tracking-[0.03em] text-on-surface-mid"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={clsx(
          'rounded-sm border bg-input px-3 py-2 font-body text-sm text-on-surface transition-colors duration-150',
          'placeholder:text-on-surface-low',
          error ? 'border-error focus-visible:border-error' : 'border-rail-border focus-visible:border-[#383b45]',
          className,
        )}
        {...props}
      />
      {error && (
        <p id={errorId} className="font-body text-xs text-error">
          {error}
        </p>
      )}
    </div>
  )
})

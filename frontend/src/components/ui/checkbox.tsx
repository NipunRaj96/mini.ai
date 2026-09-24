import * as React from 'react'
import { cn } from '@/lib/utils'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import { CheckIcon } from 'lucide-react'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-rail-border bg-input text-on-primary',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center [&>svg]:size-3.5">
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

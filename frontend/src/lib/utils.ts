import clsx, { type ClassValue } from 'clsx'

/** shadcn components expect a `cn()` helper -- reuse this project's existing
 * clsx dependency instead of pulling in a second class-merging package. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

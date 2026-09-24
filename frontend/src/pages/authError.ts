import { ApiError } from '../lib/api'

export interface AuthFormErrors {
  fieldErrors: Record<string, string>
  formError: string | null
}

/**
 * Shared Login/Signup error mapping: 422 becomes per-field errors (falling
 * back to the general banner for any entry without a field), everything else
 * (401 bad credentials, 429 rate limit — api.ts already gives it a friendly
 * message, network errors, ...) becomes the general banner.
 */
export function mapAuthError(err: unknown): AuthFormErrors {
  if (err instanceof ApiError) {
    if (err.status === 422) {
      const fieldErrors: Record<string, string> = {}
      let formError: string | null = null
      for (const fieldError of err.errors) {
        if (fieldError.field) fieldErrors[fieldError.field] = fieldError.message
        else formError = fieldError.message
      }
      return { fieldErrors, formError }
    }
    return { fieldErrors: {}, formError: err.message }
  }
  return { fieldErrors: {}, formError: 'Something went wrong. Please try again.' }
}

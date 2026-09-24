import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../lib/auth'
import { AuthCard } from './AuthCard'
import { mapAuthError } from './authError'

const MIN_PASSWORD_LENGTH = 8

export function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setFormError(null)

    // Client-side check saves a round trip, but the server's 422 stays the
    // source of truth (mapAuthError below) in case its rules ever diverge.
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ password: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` })
      return
    }

    setLoading(true)
    try {
      await signup(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      const mapped = mapAuthError(err)
      setFieldErrors(mapped.fieldErrors)
      setFormError(mapped.formError)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard title="Sign up">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-[var(--space-md)]">
        {formError && (
          <p role="alert" className="rounded-sm bg-error-container px-3 py-2 font-body text-sm text-error">
            {formError}
          </p>
        )}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          required
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
        />
        <Button type="submit" variant="primary" loading={loading}>
          Sign up
        </Button>
        <p className="text-center font-body text-sm text-on-surface-mid">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:text-primary-hover">
            Log in
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}

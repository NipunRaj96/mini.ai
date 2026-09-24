import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../lib/auth'
import { AuthCard } from './AuthCard'
import { mapAuthError } from './authError'

export function Login() {
  const { login } = useAuth()
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
    setLoading(true)
    try {
      await login(email, password)
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
    <AuthCard title="Log in">
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
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
        />
        <Button type="submit" variant="primary" loading={loading}>
          Log in
        </Button>
        <p className="text-center font-body text-sm text-on-surface-mid">
          No account?{' '}
          <Link to="/signup" className="text-primary hover:text-primary-hover">
            Sign up
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}

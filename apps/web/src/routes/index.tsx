import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuthActions } from '@convex-dev/auth/react'
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react'
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { messageFromError } from '../lib/error-message'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <>
      <AuthLoading>
        <AuthLoadingScreen />
      </AuthLoading>

      <Unauthenticated>
        <AuthGate />
      </Unauthenticated>

      <Authenticated>
        <FilesRedirect />
      </Authenticated>
    </>
  )
}

function FilesRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    void navigate({ to: '/files', search: { trash: false } })
  }, [navigate])

  return (
    <main className="auth-shell">
      <Loader2 size={28} className="spin" aria-hidden="true" />
      <p>Opening your files…</p>
    </main>
  )
}

function AuthLoadingScreen() {
  return (
    <main className="auth-shell">
      <Loader2 size={28} className="spin" aria-hidden="true" />
      <p>Connecting to Convex…</p>
    </main>
  )
}

function AuthGate() {
  const { signIn } = useAuthActions()
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    try {
      const formData = new FormData(event.currentTarget)
      formData.set('flow', flow)
      await signIn('password', formData)
    } catch (error) {
      setError(messageFromError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell" aria-label="Sign in to g-customize">
      <section className="auth-card">
        <div className="auth-card-header">
          <div className="auth-mark" aria-hidden="true">
            <KeyRound size={22} />
          </div>
          <div>
            <p className="eyebrow">g-customize</p>
            <h1>{flow === 'signIn' ? 'Sign in' : 'Create your account'}</h1>
          </div>
        </div>

        <p className="auth-lede">
          {flow === 'signIn'
            ? 'Use the email address your admin invited you with.'
            : 'Use the email address your licensor invited so that your account joins the right tenant.'}
        </p>

        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            className={flow === 'signIn' ? 'active' : ''}
            role="tab"
            aria-selected={flow === 'signIn'}
            onClick={() => {
              setFlow('signIn')
              setError(null)
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={flow === 'signUp' ? 'active' : ''}
            role="tab"
            aria-selected={flow === 'signUp'}
            onClick={() => {
              setFlow('signUp')
              setError(null)
            }}
          >
            Create account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </label>
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete={flow === 'signIn' ? 'current-password' : 'new-password'}
              minLength={8}
              required
              placeholder="At least 8 characters"
            />
          </label>

          {error ? (
            <p className="auth-error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              {error}
            </p>
          ) : null}

          <button type="submit" className="primary-action auth-submit" disabled={busy}>
            {busy ? 'Working…' : flow === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </section>
    </main>
  )
}

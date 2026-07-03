import { createFileRoute } from '@tanstack/react-router'
import { useAuthActions } from '@convex-dev/auth/react'
import { AuthLoading, Unauthenticated, useQuery } from 'convex/react'
import { AlertTriangle, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { api } from '@convex/_generated/api'
import { messageFromError } from '../lib/error-message'

export const Route = createFileRoute('/login')({
  component: LoginRoute,
})

function LoginRoute() {
  const status = useQuery(api.superAdmins.currentStatus)

  return (
    <>
      <AuthLoading>
        <main className="login-shell">
          <Loader2 size={28} className="spin" aria-hidden="true" />
          <p>Connecting to Convex…</p>
        </main>
      </AuthLoading>

      <Unauthenticated>
        <SignInForm />
      </Unauthenticated>

      {status?.signedIn && status?.isSuperAdmin ? (
        // Already signed in as superadmin — bounce to dashboard.
        <AlreadySuperAdmin />
      ) : null}

      {status?.signedIn && !status?.isSuperAdmin ? (
        <NotAuthorized email={status.email} />
      ) : null}
    </>
  )
}

function SignInForm() {
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
    <main className="login-shell">
      <section className="login-card">
        <div className="login-card-header">
          <div className="login-mark" aria-hidden="true">
            <KeyRound size={22} />
          </div>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>Platform Console</p>
            <h1>{flow === 'signIn' ? 'Superadmin sign in' : 'Create superadmin account'}</h1>
          </div>
        </div>

        <p className="auth-lede">
          {flow === 'signIn'
            ? 'This panel is restricted to platform operators. Sign in with your superadmin email.'
            : 'Use your superadmin email to create an account. The invitation gate is bypassed for superadmin emails.'}
        </p>

        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            className={flow === 'signIn' ? 'active' : ''}
            role="tab"
            aria-selected={flow === 'signIn'}
            onClick={() => { setFlow('signIn'); setError(null) }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={flow === 'signUp' ? 'active' : ''}
            role="tab"
            aria-selected={flow === 'signUp'}
            onClick={() => { setFlow('signUp'); setError(null) }}
          >
            Create account
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
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
            <p className="banner error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              {error}
            </p>
          ) : null}

          <button type="submit" className="primary-action" disabled={busy}>
            {busy ? 'Working…' : flow === 'signIn' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </section>
    </main>
  )
}

function AlreadySuperAdmin() {
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-card-header">
          <div className="login-mark" aria-hidden="true">
            <ShieldCheck size={22} />
          </div>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>Already signed in</p>
            <h1>You're a superadmin</h1>
          </div>
        </div>
        <a href="/dashboard" className="primary-action">Go to dashboard →</a>
      </section>
    </main>
  )
}

function NotAuthorized({ email }: { email: string | null }) {
  const { signOut } = useAuthActions()
  return (
    <main className="not-authorized-shell">
      <AlertTriangle size={40} aria-hidden="true" />
      <h1 style={{ margin: 0 }}>Not authorized</h1>
      <p className="muted" style={{ margin: 0 }}>
        Signed in as <strong>{email ?? 'unknown'}</strong>, but this account is not a superadmin.
      </p>
      <button type="button" className="ghost-action" onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  )
}

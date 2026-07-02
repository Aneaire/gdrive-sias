import { createFileRoute } from '@tanstack/react-router'
import { useAuthActions } from '@convex-dev/auth/react'
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from 'convex/react'
import { AlertTriangle, KeyRound, Loader2, LogOut, FilePlus2, ShieldCheck, Building2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { api } from '@convex/_generated/api'
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
        <Dashboard />
      </Authenticated>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Loading
// ────────────────────────────────────────────────────────────────────────

function AuthLoadingScreen() {
  return (
    <main className="auth-shell">
      <Loader2 size={28} className="spin" aria-hidden="true" />
      <p>Connecting to Convex…</p>
    </main>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sign in / Create account
// ────────────────────────────────────────────────────────────────────────

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
    <main className="auth-shell" aria-label="Sign in to Survey File System">
      <section className="auth-card">
        <div className="auth-card-header">
          <div className="auth-mark" aria-hidden="true">
            <KeyRound size={22} />
          </div>
          <div>
            <p className="eyebrow">Survey File System</p>
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

// ────────────────────────────────────────────────────────────────────────
// Dashboard — Phase B bridge view
// ────────────────────────────────────────────────────────────────────────

type FileForm = {
  name: string
  categoryId: number
  categoryName: string
  municipality: string
  barangay: string
  size: number
}

const DEFAULT_FORM: FileForm = {
  name: '',
  categoryId: 1,
  categoryName: 'General',
  municipality: 'General',
  barangay: 'General',
  size: 0,
}

function Dashboard() {
  const tenant = useQuery(api.tenants.current)
  const capabilities = useQuery(api.tenants.capabilities)
  const files = useQuery(api.files.list)
  const stats = useQuery(api.files.stats)
  const createMany = useMutation(api.files.createMany)
  const { signOut } = useAuthActions()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FileForm>(DEFAULT_FORM)

  function update<K extends keyof FileForm>(key: K, value: FileForm[K]) {
    setForm((prev: FileForm) => ({ ...prev, [key]: value }))
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createMany({ files: [form] })
      setForm((prev: FileForm) => ({ ...prev, name: '', size: 0 }))
    } catch (error) {
      setError(messageFromError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">{tenant?.branding.productName ?? 'Survey File System'}</p>
          <h1>Dashboard</h1>
        </div>
        <button type="button" className="ghost-action" onClick={() => void signOut()}>
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
      </header>

      <section className="dashboard-grid">
        <div className="info-card">
          <Building2 size={20} aria-hidden="true" />
          <h2>Tenant</h2>
          <dl>
            <dt>Name</dt>
            <dd>{tenant?.name ?? '—'}</dd>
            <dt>Subdomain</dt>
            <dd>{tenant?.subdomain ?? '—'}</dd>
            <dt>Plan</dt>
            <dd>{tenant?.plan ?? '—'}</dd>
            <dt>Role</dt>
            <dd>{tenant?.role ?? '—'}</dd>
          </dl>
        </div>

        <div className="info-card">
          <ShieldCheck size={20} aria-hidden="true" />
          <h2>Capabilities</h2>
          <dl>
            <dt>License status</dt>
            <dd>{capabilities?.licenseStatus ?? '—'}</dd>
            <dt>Seats</dt>
            <dd>{capabilities?.seats ?? '—'}</dd>
            <dt>Mobile</dt>
            <dd>{capabilities ? (capabilities.mobile ? 'yes' : 'no') : '—'}</dd>
            <dt>Audit log</dt>
            <dd>{capabilities ? (capabilities.audit ? 'yes' : 'no') : '—'}</dd>
          </dl>
        </div>

        <div className="info-card">
          <FilePlus2 size={20} aria-hidden="true" />
          <h2>Files</h2>
          <dl>
            <dt>Total files</dt>
            <dd>{stats?.totalFiles ?? '—'}</dd>
            <dt>Total bytes</dt>
            <dd>{stats ? formatBytes(stats.totalBytes) : '—'}</dd>
            <dt>Last upload</dt>
            <dd>{stats?.lastUploadedAt ? new Date(stats.lastUploadedAt).toLocaleString() : '—'}</dd>
          </dl>
        </div>
      </section>

      <section className="file-create">
        <h2>Add a metadata-only file</h2>
        <p className="file-create-lede">
          Phase B bridge: this inserts a <code>metadata_only</code> file row without Drive bytes.
          Useful to verify the tenant scoping of <code>files.list</code>. Once Phase D lands, this
          form will upload the actual bytes to Google Drive too.
        </p>

        <form className="file-create-form" onSubmit={handleCreate}>
          <label>
            <span>File name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="sample-plan.pdf"
              required
            />
          </label>
          <label>
            <span>Size (bytes)</span>
            <input
              type="number"
              min={0}
              value={form.size}
              onChange={(e) => update('size', Number(e.target.value))}
            />
          </label>
          <label>
            <span>Category</span>
            <input
              type="text"
              value={form.categoryName}
              onChange={(e) => {
                update('categoryName', e.target.value)
              }}
              placeholder="General"
            />
          </label>
          <label>
            <span>Municipality</span>
            <input
              type="text"
              value={form.municipality}
              onChange={(e) => update('municipality', e.target.value)}
              placeholder="General"
            />
          </label>
          <label>
            <span>Barangay</span>
            <input
              type="text"
              value={form.barangay}
              onChange={(e) => update('barangay', e.target.value)}
              placeholder="General"
            />
          </label>

          {error ? (
            <p className="auth-error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              {error}
            </p>
          ) : null}

          <button type="submit" className="primary-action" disabled={busy || !form.name.trim()}>
            {busy ? 'Saving…' : 'Add file'}
          </button>
        </form>
      </section>

      <section className="file-list">
        <h2>Files in this tenant</h2>
        {files === undefined ? (
          <p className="muted">Loading…</p>
        ) : files.length === 0 ? (
          <p className="muted">No files yet. Add one above.</p>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Municipality</th>
                <th>Barangay</th>
                <th>Size</th>
                <th>Status</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file._id}>
                  <td>{file.name}</td>
                  <td>{file.categoryName}</td>
                  <td>{file.municipality}</td>
                  <td>{file.barangay}</td>
                  <td>{formatBytes(file.size)}</td>
                  <td>{file.storageStatus}</td>
                  <td>{new Date(file.uploadedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}
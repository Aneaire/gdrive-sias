import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { AlertTriangle, ArrowLeft, Plus, Shield, ShieldOff, UserMinus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { api } from '@convex/_generated/api'
import { messageFromError } from '../lib/error-message'

export const Route = createFileRoute('/settings/members')({
  component: MembersSettingsPage,
})

function MembersSettingsPage() {
  const tenant = useQuery(api.tenants.current)

  if (tenant === undefined) {
    return (
      <main className="dashboard-shell">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (tenant === null) {
    return (
      <main className="dashboard-shell">
        <p>You are not a member of any tenant.</p>
        <Link to="/" className="ghost-action"><ArrowLeft size={14} /> Back to dashboard</Link>
      </main>
    )
  }

  if (tenant.role !== 'admin') {
    return (
      <main className="dashboard-shell">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">{tenant.branding.productName} · Settings</p>
            <h1>Members</h1>
          </div>
          <Link to="/" className="ghost-action"><ArrowLeft size={14} /> Back to dashboard</Link>
        </header>
        <section className="info-card">
          <p>Only tenant admins can manage members. Ask your admin if you need to invite someone.</p>
        </section>
      </main>
    )
  }

  return <MembersManager tenantName={tenant.branding.productName} />
}

function MembersManager({ tenantName }: { tenantName: string }) {
  const members = useQuery(api.tenantMembers.list)
  const seatUsage = useQuery(api.tenantMembers.seatUsage)
  const invite = useMutation(api.tenantMembers.invite)
  const remove = useMutation(api.tenantMembers.remove)
  const changeRole = useMutation(api.tenantMembers.changeRole)
  const resendInvite = useMutation(api.tenantMembers.resendInvite)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await invite({ email, role })
      setOk(`Invitation sent to ${email}. They can sign up with that email address.`)
      setEmail('')
    } catch (error) {
      setError(messageFromError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(memberId: string, memberEmail: string) {
    if (!confirm(`Remove ${memberEmail}? They will lose access immediately.`)) return
    setError(null)
    try {
      await remove({ memberId: memberId as never })
      setOk(`Removed ${memberEmail}.`)
    } catch (error) {
      setError(messageFromError(error))
    }
  }

  async function handleChangeRole(memberId: string, memberEmail: string, newRole: 'admin' | 'member') {
    setError(null)
    try {
      await changeRole({ memberId: memberId as never, role: newRole })
      setOk(`${memberEmail} is now ${newRole}.`)
    } catch (error) {
      setError(messageFromError(error))
    }
  }

  async function handleResend(memberId: string, memberEmail: string) {
    setError(null)
    try {
      await resendInvite({ memberId: memberId as never })
      setOk(`Invitation re-sent to ${memberEmail}.`)
    } catch (error) {
      setError(messageFromError(error))
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">{tenantName} · Settings</p>
          <h1>Members</h1>
        </div>
        <Link to="/" className="ghost-action"><ArrowLeft size={14} /> Back to dashboard</Link>
      </header>

      <section className="info-card">
        <h2>Seats</h2>
        <dl>
          <dt>Used</dt>
          <dd>{seatUsage?.used ?? '—'} / {seatUsage?.seats ?? '—'}</dd>
          <dt>License status</dt>
          <dd>{seatUsage?.licenseStatus ?? '—'}</dd>
        </dl>
        {seatUsage && seatUsage.licenseStatus === 'active' && seatUsage.used >= seatUsage.seats ? (
          <p className="auth-error" style={{ marginTop: '0.5rem' }}>
            <AlertTriangle size={14} aria-hidden="true" />
            Seat limit reached. Remove a member or contact the licensor to add seats.
          </p>
        ) : null}
      </section>

      <section className="file-create">
        <h2>Invite a member</h2>
        <p className="file-create-lede">
          The invited person signs up with the exact email you enter here. They'll join this tenant
          with the role you pick. Make sure the email is correct — they can't be changed after sending.
        </p>
        <form className="file-create-form" onSubmit={handleInvite}>
          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="new.member@example.com" />
          </label>
          <label>
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="primary-action" disabled={busy || !email.trim()}>
            <Plus size={14} aria-hidden="true" />
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </form>
        {error ? (
          <p className="auth-error" role="alert" style={{ marginTop: '0.75rem' }}>
            <AlertTriangle size={16} aria-hidden="true" />
            {error}
          </p>
        ) : null}
        {ok ? (
          <p className="activate-success" role="status" style={{ marginTop: '0.75rem' }}>
            {ok}
          </p>
        ) : null}
      </section>

      <section className="file-list">
        <h2>Team members</h2>
        {members === undefined ? (
          <p className="muted">Loading…</p>
        ) : members.length === 0 ? (
          <p className="muted">No members yet.</p>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Invited</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m._id}>
                  <td>
                    {m.invitedEmail}
                    {m.isSelf ? <span className="muted"> (you)</span> : null}
                  </td>
                  <td>{m.role === 'admin' ? <Shield size={14} aria-hidden="true" /> : null} {m.role}</td>
                  <td>
                    {m.status === 'active' ? 'active'
                      : m.status === 'invited' ? 'invited'
                      : 'removed'}
                  </td>
                  <td>{new Date(m.invitedAt).toLocaleDateString()}</td>
                  <td>{m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}</td>
                  <td>
                    {m.status !== 'removed' && !m.isSelf ? (
                      <span style={{ display: 'flex', gap: '0.25rem' }}>
                        {m.role === 'admin' ? (
                          <button type="button" className="ghost-action" onClick={() => handleChangeRole(m._id, m.invitedEmail, 'member')} title="Demote to member">
                            <ShieldOff size={12} aria-hidden="true" /> Demote
                          </button>
                        ) : (
                          <button type="button" className="ghost-action" onClick={() => handleChangeRole(m._id, m.invitedEmail, 'admin')} title="Promote to admin">
                            <Shield size={12} aria-hidden="true" /> Promote
                          </button>
                        )}
                        {m.status === 'invited' ? (
                          <button type="button" className="ghost-action" onClick={() => handleResend(m._id, m.invitedEmail)} title="Re-send invite">
                            Re-send
                          </button>
                        ) : null}
                        <button type="button" className="ghost-action" onClick={() => handleRemove(m._id, m.invitedEmail)} title="Remove member">
                          <UserMinus size={12} aria-hidden="true" /> Remove
                        </button>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}

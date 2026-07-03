import { createFileRoute, useParams, useNavigate, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { AlertTriangle, ArrowLeft, Plus, Trash2, UserMinus, Shield, ShieldOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import type { Id } from '@convex/_generated/dataModel'
import { api } from '@convex/_generated/api'
import { messageFromError } from '../../lib/error-message'

export const Route = createFileRoute('/_authenticated/tenants/$id')({
  component: TenantDetailPage,
})

function TenantDetailPage() {
  const { id } = useParams({ from: '/_authenticated/tenants/$id' })
  const detail = useQuery(api.superAdminApi.getTenantDetail, { tenantId: id as Id<'tenants'> })

  if (!detail) return <div><p className="muted">Loading…</p></div>
  if (detail === null) {
    return (
      <div>
        <p>Tenant not found.</p>
        <Link to="/tenants" className="ghost-action"><ArrowLeft size={14} /> Back to tenants</Link>
      </div>
    )
  }

  const { tenant, members, licenses, audits } = detail

  return (
    <div>
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">
            <Link to="/tenants" style={{ color: 'var(--muted)' }}>Tenants</Link> › {tenant.name}
          </p>
          <h1>{tenant.name}</h1>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <span className="code">{tenant.subdomain}</span>
            <span className="badge">{tenant.plan}</span>
          </div>
        </div>
      </header>

      <BrandingCard tenantId={tenant._id} initialName={tenant.branding.productName} initialAccent={tenant.branding.accentColor} />

      <MembersCard tenantId={tenant._id} members={members} />

      <LicensesCard licenses={licenses} />

      <AuditsCard audits={audits} />

      <DangerZone subdomain={tenant.subdomain} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Branding
// ────────────────────────────────────────────────────────────────────────

function BrandingCard({
  tenantId,
  initialName,
  initialAccent,
}: {
  tenantId: string
  initialName: string
  initialAccent: string
}) {
  const updateBranding = useMutation(api.superAdminApi.updateTenantBranding)
  const [name, setName] = useState(initialName)
  const [accent, setAccent] = useState(initialAccent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await updateBranding({ tenantId: tenantId as Id<'tenants'>, productName: name, accentColor: accent })
      setOk('Branding updated.')
    } catch (error) {
      setError(messageFromError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Branding</h2>
      <form className="form-grid" onSubmit={submit}>
        <div className="form-field">
          <label htmlFor="brand-name">Product name</label>
          <input id="brand-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-field">
          <label htmlFor="brand-accent">Accent color (CSS)</label>
          <input id="brand-accent" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="oklch(0.56 0.20 254)" required />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button type="submit" className="primary-action" disabled={busy}>Save</button>
          <span style={{ width: '1rem', height: '1rem', background: accent, borderRadius: '0.25rem', border: '1px solid var(--line)' }} aria-hidden="true" />
        </div>
      </form>
      {error ? <p className="banner error"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {ok ? <p className="banner ok">{ok}</p> : null}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Members
// ────────────────────────────────────────────────────────────────────────

type MemberRow = {
  _id: string
  invitedEmail: string
  role: 'admin' | 'member'
  status: 'invited' | 'active' | 'removed'
  invitedAt: number
  joinedAt: number | null
  removedAt: number | null
  userId: string | null
}

function MembersCard({ tenantId, members }: { tenantId: string; members: MemberRow[] }) {
  const invite = useMutation(api.superAdminApi.inviteMember)
  const remove = useMutation(api.superAdminApi.removeMember)
  const changeRole = useMutation(api.superAdminApi.changeMemberRole)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await invite({ tenantId: tenantId as Id<'tenants'>, email, role })
      setEmail('')
    } catch (error) {
      setError(messageFromError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(memberId: string) {
    if (!confirm('Remove this member? They will lose access immediately.')) return
    try {
      await remove({ memberId: memberId as Id<'tenantMembers'> })
    } catch (error) {
      alert(messageFromError(error))
    }
  }

  async function handleChangeRole(memberId: string, newRole: 'admin' | 'member') {
    try {
      await changeRole({ memberId: memberId as Id<'tenantMembers'>, role: newRole })
    } catch (error) {
      alert(messageFromError(error))
    }
  }

  return (
    <section className="card">
      <h2>Members ({members.filter((m) => m.status !== 'removed').length})</h2>

      <form className="form-grid" onSubmit={handleInvite} style={{ marginBottom: '1rem' }}>
        <div className="form-field">
          <label htmlFor="invite-email">Invite email</label>
          <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="new.member@example.com" />
        </div>
        <div className="form-field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit" className="primary-action" disabled={busy}>
          <Plus size={14} aria-hidden="true" /> Invite
        </button>
      </form>

      {error ? <p className="banner error"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}

      <table className="table">
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
              <td>{m.invitedEmail}</td>
              <td>
                <span className={`badge ${m.role === 'admin' ? 'ok' : ''}`}>{m.role}</span>
              </td>
              <td>
                {m.status === 'active' ? <span className="badge ok">active</span>
                  : m.status === 'invited' ? <span className="badge warn">invited</span>
                  : <span className="badge danger">removed</span>}
              </td>
              <td className="muted">{new Date(m.invitedAt).toLocaleDateString()}</td>
              <td className="muted">{m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}</td>
              <td>
                {m.status !== 'removed' ? (
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    {m.role === 'admin' ? (
                      <button type="button" className="row-action" onClick={() => handleChangeRole(m._id, 'member')} title="Demote to member">
                        <ShieldOff size={12} aria-hidden="true" /> Demote
                      </button>
                    ) : (
                      <button type="button" className="row-action" onClick={() => handleChangeRole(m._id, 'admin')} title="Promote to admin">
                        <Shield size={12} aria-hidden="true" /> Promote
                      </button>
                    )}
                    <button type="button" className="row-action danger" onClick={() => handleRemove(m._id)} title="Remove member">
                      <UserMinus size={12} aria-hidden="true" /> Remove
                    </button>
                  </div>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Licenses + devices
// ────────────────────────────────────────────────────────────────────────

type DeviceRow = {
  _id: string
  deviceId: string
  platform: 'desktop' | 'mobile' | 'web'
  label?: string
  activatedAt: number
  lastSeenAt?: number
  revokedAt?: number
}

type LicenseRow = {
  _id: string
  licenseKey: string
  plan: 'standard' | 'office' | 'pro'
  status: 'active' | 'revoked'
  seats: number
  issuedAt: number
  revokedAt: number | null
  issuedBy: string
  saleRef: string | null
  notes: string | null
  devices: DeviceRow[]
}

function LicensesCard({ licenses }: { licenses: LicenseRow[] }) {
  const revokeLicense = useMutation(api.superAdminApi.revokeLicense)
  const revokeDevice = useMutation(api.superAdminApi.revokeDevice)

  async function handleRevokeLicense(licenseKey: string) {
    const reason = prompt(`Revoke license ${licenseKey}? This disables all devices.\nReason (optional):`)
    if (reason === null) return
    try {
      await revokeLicense({ licenseKey, reason: reason || undefined })
    } catch (error) {
      alert(messageFromError(error))
    }
  }

  async function handleRevokeDevice(licenseKey: string, deviceId: string) {
    if (!confirm(`Revoke device ${deviceId}?`)) return
    try {
      await revokeDevice({ licenseKey, deviceId })
    } catch (error) {
      alert(messageFromError(error))
    }
  }

  if (licenses.length === 0) {
    return (
      <section className="card">
        <h2>Licenses</h2>
        <p className="muted">No licenses for this tenant.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Licenses</h2>
      {licenses.map((l) => (
        <div key={l._id} className="card-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span className="code">{l.licenseKey}</span>
                {l.status === 'active' ? <span className="badge ok">active</span> : <span className="badge danger">revoked</span>}
                <span className="badge">{l.plan}</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                {l.seats} seats · issued by {l.issuedBy} on {new Date(l.issuedAt).toLocaleDateString()}
                {l.saleRef ? ` · sale ${l.saleRef}` : ''}
                {l.revokedAt ? ` · revoked ${new Date(l.revokedAt).toLocaleDateString()}` : ''}
              </p>
              {l.notes ? <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>Notes: {l.notes}</p> : null}
            </div>
            {l.status === 'active' ? (
              <button type="button" className="row-action danger" onClick={() => handleRevokeLicense(l.licenseKey)}>
                <Trash2 size={12} aria-hidden="true" /> Revoke license
              </button>
            ) : null}
          </div>

          <h3 style={{ marginTop: '0.75rem' }}>Devices ({l.devices.filter((d) => !d.revokedAt).length} active / {l.devices.length} total)</h3>
          {l.devices.length === 0 ? (
            <p className="muted">No devices activated.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Device ID</th>
                  <th>Platform</th>
                  <th>Label</th>
                  <th>Activated</th>
                  <th>Last seen</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {l.devices.map((d) => (
                  <tr key={d._id}>
                    <td className="code">{d.deviceId}</td>
                    <td>{d.platform}</td>
                    <td className="muted">{d.label ?? '—'}</td>
                    <td className="muted">{new Date(d.activatedAt).toLocaleString()}</td>
                    <td className="muted">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}</td>
                    <td>{d.revokedAt ? <span className="badge danger">revoked</span> : <span className="badge ok">active</span>}</td>
                    <td>
                      {!d.revokedAt ? (
                        <button type="button" className="row-action danger" onClick={() => handleRevokeDevice(l.licenseKey, d.deviceId)}>
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Audits
// ────────────────────────────────────────────────────────────────────────

function AuditsCard({ audits }: { audits: Array<{ _id: string; action: string; targetId: string | null; actorUserId: string | null; createdAt: number }> }) {
  return (
    <section className="card">
      <h2>Recent audit log (last 50)</h2>
      {audits.length === 0 ? (
        <p className="muted">No audit entries.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Target</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a._id}>
                <td><span className="code">{a.action}</span></td>
                <td className="muted">{a.targetId ?? '—'}</td>
                <td className="muted">{new Date(a.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Danger zone (wipe tenant)
// ────────────────────────────────────────────────────────────────────────

function DangerZone({ subdomain }: { subdomain: string }) {
  const wipe = useMutation(api.provisioning.wipeTenantBySubdomain)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const navigate = useNavigate()

  const expected = `wipe:${subdomain}`
  const matches = confirm === expected

  async function handleWipe(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await wipe({ subdomain, confirm })
      if (result.wiped) {
        setDone(`Tenant "${subdomain}" wiped.`)
        setTimeout(() => navigate({ to: '/tenants' }), 1200)
      } else {
        setError(result.reason ?? 'No such tenant.')
      }
    } catch (error) {
      setError(messageFromError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" style={{ borderColor: 'var(--danger-line)' }}>
      <h2 style={{ color: 'var(--danger)' }}>Danger zone</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
        Wiping a tenant permanently deletes all licenses, devices, members, files, share recipients,
        sync states, integrations, and audit rows for this tenant. The orphaned user records are also
        removed if this was their only membership. <strong>This cannot be undone.</strong>
      </p>
      <form className="form-grid" onSubmit={handleWipe}>
        <div className="form-field">
          <label htmlFor="wipe-confirm">Type {expected} to confirm</label>
          <input
            id="wipe-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={expected}
            style={{ fontFamily: 'ui-monospace, monospace' }}
            autoComplete="off"
          />
        </div>
        <button type="submit" className="primary-action danger" disabled={busy || !matches}>
          <Trash2 size={14} aria-hidden="true" /> Wipe tenant
        </button>
      </form>
      {error ? <p className="banner error"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
      {done ? <p className="banner ok">{done}</p> : null}
    </section>
  )
}

import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Eye, KeyRound, Plus, Search, X } from 'lucide-react'
import { useState } from 'react'

import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'

export const Route = createFileRoute('/_authenticated/tenants')({
  component: TenantsPage,
})

type SelectedTenantId = Id<'tenants'> | null

type DialogLicense = {
  _id: string
  licenseKey: string
  status: 'active' | 'revoked'
  plan: 'standard' | 'office' | 'pro'
  seats: number
  issuedAt: number
  devices: Array<{ revokedAt?: number }>
}

function TenantsPage() {
  const [search, setSearch] = useState('')
  const [selectedTenantId, setSelectedTenantId] = useState<SelectedTenantId>(null)
  const tenants = useQuery(api.superAdminApi.listTenants, search.trim() ? { search: search.trim() } : {})

  return (
    <div>
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Tenants</h1>
        </div>
        <Link to="/provision" className="primary-action">
          <Plus size={16} aria-hidden="true" /> Provision new tenant
        </Link>
      </header>

      <div className="toolbar">
        <Search size={16} aria-hidden="true" style={{ color: 'var(--muted)' }} />
        <input
          type="search"
          placeholder="Search by name, subdomain, or admin email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="spacer" />
      </div>

      <section className="card">
        {tenants === undefined ? (
          <p className="muted">Loading…</p>
        ) : tenants.length === 0 ? (
          <p className="muted">No tenants match. Provision one to get started.</p>
        ) : (
          <table className="table clickable-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Subdomain</th>
                <th>Plan</th>
                <th>Licenses</th>
                <th>Seats</th>
                <th>Members</th>
                <th>Devices</th>
                <th>Files</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t._id} onClick={() => setSelectedTenantId(t._id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' ? setSelectedTenantId(t._id) : undefined}>
                  <td><strong>{t.name}</strong></td>
                  <td><span className="code">{t.subdomain}</span></td>
                  <td><span className="badge">{t.plan}</span></td>
                  <td>
                    <span className="badge">{t.licenseCount} key{t.licenseCount === 1 ? '' : 's'}</span>{' '}
                    {t.licenseStatus === 'revoked' ? <span className="badge danger">revoked</span> : t.licenseStatus === 'active' ? <span className="badge ok">active</span> : null}
                  </td>
                  <td>{t.seats}</td>
                  <td>{t.memberCount}</td>
                  <td>{t.deviceCount}</td>
                  <td>{t.fileCount}</td>
                  <td className="muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td><button type="button" className="row-action" onClick={(e) => { e.stopPropagation(); setSelectedTenantId(t._id) }}><Eye size={12} /> View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedTenantId ? <TenantInfoDialog tenantId={selectedTenantId} onClose={() => setSelectedTenantId(null)} /> : null}
    </div>
  )
}

function TenantInfoDialog({ tenantId, onClose }: { tenantId: Id<'tenants'>; onClose: () => void }) {
  const [showLicenses, setShowLicenses] = useState(false)
  const detail = useQuery(api.superAdminApi.getTenantDetail, { tenantId })

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-panel tenant-modal" role="dialog" aria-modal="true" aria-label="Tenant information" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <p className="eyebrow">Tenant dossier</p>
            <h2>{detail?.tenant.name ?? 'Loading…'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </header>

        {detail === undefined ? <p className="muted">Loading tenant information…</p> : detail === null ? <p className="muted">Tenant not found.</p> : (
          <>
            <div className="detail-grid">
              <Info label="Subdomain" value={detail.tenant.subdomain} code />
              <Info label="Plan" value={detail.tenant.plan} />
              <Info label="Created" value={new Date(detail.tenant.createdAt).toLocaleString()} />
              <Info label="Product name" value={detail.tenant.branding.productName} />
              <Info label="Accent" value={detail.tenant.branding.accentColor} code />
              <Info label="Members" value={String(detail.members.length)} />
              <Info label="Licenses" value={`${detail.licenses.length} key${detail.licenses.length === 1 ? '' : 's'}`} />
              <Info label="Devices" value={String(detail.licenses.reduce((sum, l) => sum + l.devices.length, 0))} />
            </div>

            <div className="card-section">
              <h3>Members</h3>
              <table className="table">
                <thead><tr><th>Email / user</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead>
                <tbody>{detail.members.map((m) => <tr key={m._id}><td>{m.invitedEmail ?? m.userId ?? '—'}</td><td>{m.role}</td><td>{m.status}</td><td className="muted">{m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : '—'}</td></tr>)}</tbody>
              </table>
            </div>

            <div className="card-section">
              <div className="section-heading-row">
                <div>
                  <h3>Licenses</h3>
                  <p className="muted">Keys are hidden by default. Use the button only when you need to copy or audit them.</p>
                </div>
                <button type="button" className="row-action" onClick={() => setShowLicenses((v) => !v)}><KeyRound size={12} /> {showLicenses ? 'Hide licenses' : `Show licenses (${detail.licenses.length})`}</button>
              </div>
              {showLicenses ? <LicensesTable licenses={detail.licenses} /> : null}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function Info({ label, value, code }: { label: string; value: string; code?: boolean }) {
  return <div className="detail-tile"><span>{label}</span><strong className={code ? 'code' : undefined}>{value}</strong></div>
}

function LicensesTable({ licenses }: { licenses: DialogLicense[] }) {
  if (licenses.length === 0) return <p className="muted">No licenses for this tenant.</p>
  return (
    <table className="table">
      <thead><tr><th>License key</th><th>Status</th><th>Plan</th><th>Seats</th><th>Devices</th><th>Issued</th></tr></thead>
      <tbody>{licenses.map((l) => <tr key={l._id}><td><span className="code">{l.licenseKey}</span></td><td>{l.status === 'active' ? <span className="badge ok">active</span> : <span className="badge danger">revoked</span>}</td><td>{l.plan}</td><td>{l.seats}</td><td>{l.devices.filter((d) => !d.revokedAt).length} / {l.devices.length}</td><td className="muted">{new Date(l.issuedAt).toLocaleDateString()}</td></tr>)}</tbody>
    </table>
  )
}

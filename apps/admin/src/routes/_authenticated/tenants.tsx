import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'

import { api } from '@convex/_generated/api'

export const Route = createFileRoute('/_authenticated/tenants')({
  component: TenantsPage,
})

function TenantsPage() {
  const [search, setSearch] = useState('')
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
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Subdomain</th>
                <th>Plan</th>
                <th>License</th>
                <th>Seats</th>
                <th>Members</th>
                <th>Devices</th>
                <th>Files</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t._id}>
                  <td>
                    <Link to="/tenants/$id" params={{ id: t._id }}>{t.name}</Link>
                  </td>
                  <td><span className="code">{t.subdomain}</span></td>
                  <td><span className="badge">{t.plan}</span></td>
                  <td>
                    {t.licenseStatus === 'active' ? (
                      <span className="badge ok">active</span>
                    ) : t.licenseStatus === 'revoked' ? (
                      <span className="badge danger">revoked</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{t.seats}</td>
                  <td>{t.memberCount}</td>
                  <td>{t.deviceCount}</td>
                  <td>{t.fileCount}</td>
                  <td className="muted">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

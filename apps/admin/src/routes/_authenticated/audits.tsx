import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Search } from 'lucide-react'
import { useState } from 'react'

import type { Id } from '@convex/_generated/dataModel'
import { api } from '@convex/_generated/api'

export const Route = createFileRoute('/_authenticated/audits')({
  component: AuditsPage,
})

const PAGE_SIZE = 50

function AuditsPage() {
  const [actionFilter, setActionFilter] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(0)

  const result = useQuery(api.superAdminApi.listAudits, {
    paginationOpts: { numItems: PAGE_SIZE, cursor: cursor ?? null, id: 0 },
    actionContains: actionFilter.trim() || undefined,
    tenantId: tenantFilter.trim() ? (tenantFilter.trim() as Id<'tenants'>) : undefined,
  })

  const rows = result?.page ?? []
  const isDone = result?.isDone ?? false
  const nextCursor = result?.continueCursor

  function next() {
    if (nextCursor && !isDone) {
      setCursor(nextCursor)
      setPage((p) => p + 1)
    }
  }

  function prev() {
    if (page === 0) return
    setCursor(undefined)
    setPage(0)
  }

  return (
    <div>
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Audit log</h1>
        </div>
      </header>

      <div className="toolbar">
        <Search size={16} aria-hidden="true" style={{ color: 'var(--muted)' }} />
        <input
          type="search"
          placeholder="Filter by action (e.g. superadmin.provision)…"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setCursor(undefined); setPage(0) }}
        />
        <input
          type="search"
          placeholder="Filter by tenant ID…"
          value={tenantFilter}
          onChange={(e) => { setTenantFilter(e.target.value); setCursor(undefined); setPage(0) }}
          style={{ minWidth: '12rem' }}
        />
      </div>

      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">{result === undefined ? 'Loading…' : 'No audit entries match the filters.'}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Tenant</th>
                <th>Actor</th>
                <th>Target</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a._id}>
                  <td><span className="code">{a.action}</span></td>
                  <td>
                    <Link to="/tenants/$id" params={{ id: a.tenantId }}>
                      {a.tenantId.slice(-8)}
                    </Link>
                  </td>
                  <td>{a.actorEmail ?? '—'}</td>
                  <td className="muted">{a.targetId ?? '—'}</td>
                  <td className="muted">{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="toolbar">
        <button type="button" className="ghost-action" onClick={prev} disabled={page === 0}>
          ← First page
        </button>
        <div className="spacer" />
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Page {page + 1}{isDone ? ' (end)' : ''}
        </span>
        <button type="button" className="ghost-action" onClick={next} disabled={isDone || !nextCursor}>
          Next page →
        </button>
      </div>
    </div>
  )
}

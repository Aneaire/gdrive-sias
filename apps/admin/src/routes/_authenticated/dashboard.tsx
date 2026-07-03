import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Building2, KeyRound, Smartphone, Users, FileText, Activity } from 'lucide-react'

import { api } from '@convex/_generated/api'

export const Route = createFileRoute('/_authenticated/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const stats = useQuery(api.superAdminApi.dashboardStats)

  return (
    <div>
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Dashboard</h1>
        </div>
      </header>

      {!stats ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="stat-grid">
            <StatCard
              icon={<Building2 size={18} />}
              label="Total tenants"
              value={stats.tenants}
              sub={`standard ${stats.tenantsByPlan.standard} · office ${stats.tenantsByPlan.office} · pro ${stats.tenantsByPlan.pro}`}
            />
            <StatCard
              icon={<Users size={18} />}
              label="Members"
              value={stats.activeMembers}
              sub={`${stats.invitedMembers} pending invites`}
            />
            <StatCard
              icon={<KeyRound size={18} />}
              label="Licenses"
              value={stats.activeLicenses}
              sub={`${stats.revokedLicenses} revoked`}
            />
            <StatCard
              icon={<KeyRound size={18} />}
              label="Seats sold"
              value={stats.seatsSold}
              sub="active licenses only"
            />
            <StatCard
              icon={<Smartphone size={18} />}
              label="Active devices"
              value={stats.activeDevices}
              sub={`${stats.totalDevices} all-time`}
            />
            <StatCard
              icon={<FileText size={18} />}
              label="Files"
              value={stats.filesUploaded}
              sub={`${stats.filesStored} stored in Drive`}
            />
          </section>

          <section className="card">
            <h2>
              <Activity size={16} aria-hidden="true" style={{ display: 'inline', marginRight: '0.4rem' }} />
              Recent activity
            </h2>
            {stats.recentAudits.length === 0 ? (
              <p className="muted">No audit entries yet.</p>
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
                  {stats.recentAudits.map((a) => (
                    <tr key={a._id}>
                      <td><span className="code">{a.action}</span></td>
                      <td>{a.tenantName}</td>
                      <td>{a.actorEmail ?? '—'}</td>
                      <td className="muted">{a.targetId ?? '—'}</td>
                      <td>{new Date(a.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: number
  sub?: string
}) {
  return (
    <div className="stat-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', color: 'var(--muted)' }}>
        <p className="stat-label">{label}</p>
        <span aria-hidden="true">{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  )
}

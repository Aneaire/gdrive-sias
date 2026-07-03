import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Trash2 } from 'lucide-react'
import { api } from '@convex/_generated/api'
import { messageFromError } from '../../lib/error-message'

export const Route = createFileRoute('/_authenticated/licenses')({
  component: LicensesPage,
})

function LicensesPage() {
  const licenses = useQuery(api.superAdminApi.listAllLicenses)
  const revoke = useMutation(api.superAdminApi.revokeLicense)

  async function handleRevoke(licenseKey: string) {
    const reason = prompt(`Revoke license ${licenseKey}? This disables all bound devices.\nReason (optional):`)
    if (reason === null) return
    try {
      await revoke({ licenseKey, reason: reason || undefined })
    } catch (error) {
      alert(messageFromError(error))
    }
  }

  return (
    <div>
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Licenses</h1>
        </div>
      </header>

      <section className="card">
        {licenses === undefined ? (
          <p className="muted">Loading…</p>
        ) : licenses.length === 0 ? (
          <p className="muted">No licenses issued yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>License key</th>
                <th>Tenant</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Seats</th>
                <th>Devices (active/total)</th>
                <th>Issued</th>
                <th>Issued by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {licenses.map((l) => (
                <tr key={l._id}>
                  <td><span className="code">{l.licenseKey}</span></td>
                  <td>
                    {l.tenantSubdomain ? (
                      <Link to="/tenants/$id" params={{ id: l.tenantId }}>{l.tenantName}</Link>
                    ) : l.tenantName}
                  </td>
                  <td><span className="badge">{l.plan}</span></td>
                  <td>
                    {l.status === 'active' ? <span className="badge ok">active</span> : <span className="badge danger">revoked</span>}
                  </td>
                  <td>{l.seats}</td>
                  <td>{l.activeDevices} / {l.totalDevices}</td>
                  <td className="muted">{new Date(l.issuedAt).toLocaleDateString()}</td>
                  <td className="muted">{l.issuedBy}</td>
                  <td>
                    {l.status === 'active' ? (
                      <button type="button" className="row-action danger" onClick={() => handleRevoke(l.licenseKey)}>
                        <Trash2 size={12} aria-hidden="true" /> Revoke
                      </button>
                    ) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

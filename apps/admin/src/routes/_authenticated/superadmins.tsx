import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { api } from '@convex/_generated/api'
import { messageFromError } from '../../lib/error-message'

export const Route = createFileRoute('/_authenticated/superadmins')({
  component: SuperAdminsPage,
})

function SuperAdminsPage() {
  const admins = useQuery(api.superAdmins.list)
  const add = useMutation(api.superAdmins.add)
  const remove = useMutation(api.superAdmins.remove)

  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const result = await add({ email })
      setOk(`Added ${result.email} as a superadmin.`)
      setEmail('')
    } catch (error) {
      setError(messageFromError(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(email: string) {
    if (!confirm(`Remove ${email} from superadmins? They will lose panel access immediately.`)) return
    try {
      const result = await remove({ email })
      if (result.removed) {
        setOk(`Removed ${result.email}.`)
      } else {
        setError(result.reason ?? 'No such superadmin.')
      }
    } catch (error) {
      setError(messageFromError(error))
    }
  }

  return (
    <div>
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Superadmins</h1>
        </div>
      </header>

      <section className="card">
        <h2>Add superadmin</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Superadmins can sign in to this panel, provision tenants, revoke licenses, and manage
          members across all tenants. They can sign up without an invitation (the normal signup
          gate is bypassed for superadmin emails).
        </p>
        <form className="form-grid" onSubmit={handleAdd}>
          <div className="form-field">
            <label htmlFor="sa-email">Email</label>
            <input id="sa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="operator@example.com" />
          </div>
          <button type="submit" className="primary-action" disabled={busy}>
            <Plus size={14} aria-hidden="true" /> Add superadmin
          </button>
        </form>
        {error ? <p className="banner error"><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}
        {ok ? <p className="banner ok">{ok}</p> : null}
      </section>

      <section className="card">
        <h2>Current superadmins</h2>
        {admins === undefined ? (
          <p className="muted">Loading…</p>
        ) : admins.length === 0 ? (
          <p className="muted">No superadmins in the table. (Bootstrap operators still have access via the failsafe allowlist in convex/superAdmins.ts.)</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Added by</th>
                <th>Added at</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a._id}>
                  <td><strong>{a.email}</strong></td>
                  <td className="muted">{a.addedBy}</td>
                  <td className="muted">{new Date(a.addedAt).toLocaleString()}</td>
                  <td>
                    <button type="button" className="row-action danger" onClick={() => handleRemove(a.email)}>
                      <Trash2 size={12} aria-hidden="true" /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="banner warn">
        <AlertTriangle size={16} aria-hidden="true" />
        <div>
          <strong>Bootstrap failsafe:</strong> the operator email(s) hardcoded in
          <span className="code"> convex/superAdmins.ts </span> remain superadmins even if removed
          from the table, so you can never lock yourself out. To remove a bootstrap operator, edit
          that file and redeploy.
        </div>
      </section>
    </div>
  )
}

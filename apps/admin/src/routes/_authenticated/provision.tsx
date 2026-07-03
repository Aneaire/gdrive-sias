import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { AlertTriangle, Check, Copy, Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { api } from '@convex/_generated/api'
import { messageFromError } from '../../lib/error-message'

export const Route = createFileRoute('/_authenticated/provision')({
  component: ProvisionPage,
})

type ProvisionResult = {
  licenseKey: string
  tenantId: string
  subdomain: string
  adminEmail: string
  plan: 'standard' | 'office' | 'pro'
  seats: number
  actor: string | null
}

function ProvisionPage() {
  const provision = useMutation(api.provisioning.provision)
  const navigate = useNavigate()

  const [form, setForm] = useState({
    name: '',
    subdomain: '',
    plan: 'office' as 'standard' | 'office' | 'pro',
    seats: 5,
    adminEmail: '',
    saleRef: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProvisionResult | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await provision({
        name: form.name,
        subdomain: form.subdomain.toLowerCase(),
        plan: form.plan,
        seats: Number(form.seats),
        adminEmail: form.adminEmail,
        saleRef: form.saleRef || undefined,
        notes: form.notes || undefined,
        issuedBy: undefined,
      })
      setResult(res as ProvisionResult)
    } catch (error) {
      setError(messageFromError(error))
    } finally {
      setBusy(false)
    }
  }

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div>
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">Back office</p>
          <h1>Provision a new tenant</h1>
        </div>
      </header>

      <section className="card">
        <h2>Tenant details</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="p-name">Customer / tenant name *</label>
            <input id="p-name" value={form.name} onChange={(e) => update('name', e.target.value)} required placeholder="Acme Surveying" />
          </div>
          <div className="form-field">
            <label htmlFor="p-subdomain">Subdomain *</label>
            <input
              id="p-subdomain"
              value={form.subdomain}
              onChange={(e) => update('subdomain', e.target.value.toLowerCase())}
              required
              placeholder="acme"
              pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]"
              title="3-32 chars, lowercase a-z 0-9 and hyphens"
            />
          </div>
          <div className="form-field">
            <label htmlFor="p-plan">Plan *</label>
            <select id="p-plan" value={form.plan} onChange={(e) => update('plan', e.target.value as typeof form.plan)}>
              <option value="standard">standard</option>
              <option value="office">office</option>
              <option value="pro">pro</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="p-seats">Seats *</label>
            <input id="p-seats" type="number" min={1} value={form.seats} onChange={(e) => update('seats', Number(e.target.value))} required />
          </div>
          <div className="form-field">
            <label htmlFor="p-admin">Admin email *</label>
            <input id="p-admin" type="email" value={form.adminEmail} onChange={(e) => update('adminEmail', e.target.value)} required placeholder="admin@acme.example" />
          </div>
          <div className="form-field">
            <label htmlFor="p-saleref">Sale reference (optional)</label>
            <input id="p-saleref" value={form.saleRef} onChange={(e) => update('saleRef', e.target.value)} placeholder="INV-1042" />
          </div>
          <div className="form-field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="p-notes">Notes (optional)</label>
            <textarea id="p-notes" value={form.notes} onChange={(e) => update('notes', e.target.value)} rows={2} placeholder="Annual license, paid by wire" />
          </div>

          {error ? <p className="banner error" style={{ gridColumn: '1 / -1' }}><AlertTriangle size={16} aria-hidden="true" />{error}</p> : null}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" className="primary-action" disabled={busy}>
              {busy ? <><Loader2 size={14} className="spin" aria-hidden="true" /> Provisioning…</> : 'Provision tenant'}
            </button>
          </div>
        </form>
      </section>

      {result ? (
        <section className="card" style={{ borderColor: 'var(--ok-line)' }}>
          <h2 style={{ color: 'var(--ok)' }}><Check size={16} aria-hidden="true" style={{ display: 'inline', marginRight: '0.4rem' }} />Tenant provisioned</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Hand these to the buyer. The admin can sign up at the subdomain URL with the admin email below —
            their invitation is already in the system.
          </p>

          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.5rem 1rem', fontSize: '0.9rem', margin: '1rem 0 0' }}>
            <dt>License key</dt>
            <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="code">{result.licenseKey}</span>
              <button type="button" className="row-action" onClick={() => copy(result.licenseKey, 'license')}>
                {copied === 'license' ? <Check size={12} /> : <Copy size={12} />} Copy
              </button>
            </dd>

            <dt>Subdomain URL</dt>
            <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="code">https://{result.subdomain}.yourdomain.com</span>
              <button type="button" className="row-action" onClick={() => copy(`https://${result.subdomain}.yourdomain.com`, 'url')}>
                {copied === 'url' ? <Check size={12} /> : <Copy size={12} />} Copy
              </button>
            </dd>

            <dt>Admin email</dt>
            <dd style={{ margin: 0 }}>{result.adminEmail}</dd>

            <dt>Plan / seats</dt>
            <dd style={{ margin: 0 }}>{result.plan} · {result.seats} seats</dd>

            <dt>Tenant ID</dt>
            <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="code">{result.tenantId}</span>
              <button type="button" className="row-action" onClick={() => copy(result.tenantId, 'id')}>
                {copied === 'id' ? <Check size={12} /> : <Copy size={12} />} Copy
              </button>
            </dd>
          </dl>

          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
            <button type="button" className="primary-action" onClick={() => navigate({ to: '/tenants/$id', params: { id: result.tenantId } })}>
              View tenant →
            </button>
            <button type="button" className="ghost-action" onClick={() => setResult(null)}>Provision another</button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

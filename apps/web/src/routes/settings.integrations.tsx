import { createFileRoute, Link, redirect, useNavigate, useSearch } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cloud,
  DatabaseZap,
  FolderCheck,
  Plug,
  PlugZap,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '@convex/_generated/api'
import { getConvexHttpUrl } from '../integrations/convex/provider'
import { messageFromError } from '../lib/error-message'

export const Route = createFileRoute('/settings/integrations')({
  validateSearch: (search: Record<string, unknown>) => ({
    drive_code:
      typeof search.drive_code === 'string'
        ? search.drive_code
        : typeof search.code === 'string'
          ? search.code
          : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  beforeLoad: ({ location }) => {
    const raw = new URLSearchParams(location.search)
    if (raw.has('iss')) {
      throw redirect({
        to: '/settings/integrations',
        search: {
          drive_code: raw.get('drive_code') ?? raw.get('code') ?? undefined,
          state: raw.get('state') ?? undefined,
          error: raw.get('error') ?? undefined,
        },
      })
    }
  },
  component: IntegrationsSettingsPage,
})

function IntegrationsSettingsPage() {
  const tenant = useQuery(api.tenants.current)
  const integration = useQuery(api.tenantIntegrations.get)
  const disconnect = useMutation(api.tenantIntegrations.disconnect)
  const startOauth = useAction(api.driveOauthActions.startDriveOauth)
  const navigate = useNavigate()
  const { drive_code: code, state, error: oauthError } = useSearch({ from: '/settings/integrations' })

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(oauthError ?? null)
  const [ok, setOk] = useState<string | null>(null)
  const callbackSent = useRef(false)

  useEffect(() => {
    if (code && state && !callbackSent.current) {
      callbackSent.current = true
      setBusy(true)
      const convexUrl = getConvexHttpUrl('/drive-oauth/callback')
      if (!convexUrl) {
        setError('Convex URL not configured.')
        setBusy(false)
        return
      }
      fetch(convexUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.connected) {
            setOk(`Google Drive connected as ${data.connectedEmail}.`)
          } else {
            setError(data.error ?? 'Failed to connect Google Drive.')
          }
        })
        .catch((err) => {
          setError(messageFromError(err))
        })
        .finally(() => {
          setBusy(false)
          navigate({ to: '/settings/integrations', replace: true, search: { drive_code: undefined, state: undefined, error: undefined } })
        })
    }
  }, [code, state, navigate])

  if (tenant === undefined) {
    return (
      <main className="dashboard-shell integrations-shell">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (tenant === null) {
    return (
      <main className="dashboard-shell integrations-shell">
        <section className="integration-empty-card">
          <p>You are not a member of any tenant.</p>
          <Link to="/" className="ghost-action">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
        </section>
      </main>
    )
  }

  if (tenant.role !== 'admin') {
    return (
      <main className="dashboard-shell integrations-shell">
        <IntegrationHeader tenantName={tenant.branding.productName} />
        <section className="integration-empty-card">
          <p>Only tenant admins can manage integrations.</p>
        </section>
      </main>
    )
  }

  if (busy && !callbackSent.current) {
    return <ConnectingState tenantName={tenant.branding.productName} />
  }

  return (
    <main className="dashboard-shell integrations-shell">
      <IntegrationHeader tenantName={tenant.branding.productName} />

      {error ? (
        <p className="integration-alert error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="integration-alert success" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          {ok}
        </p>
      ) : null}

      <section className="integration-card">
        <div className="integration-card-glow" aria-hidden="true" />
        <div className="integration-card-header">
          <div className="integration-icon-stack" aria-hidden="true">
            <Cloud size={24} />
          </div>
          <div>
            <p className="eyebrow">Storage provider</p>
            <h2>Google Drive</h2>
          </div>
        </div>
        {integration === undefined ? (
          <p className="muted">Loading…</p>
        ) : integration && integration.status === 'connected' ? (
          <ConnectedState
            integration={integration}
            onDisconnect={async () => {
              setError(null)
              setOk(null)
              try {
                await disconnect()
                setOk('Google Drive disconnected.')
              } catch (err) {
                setError(messageFromError(err))
              }
            }}
          />
        ) : integration && integration.status === 'error' ? (
          <ErrorState onReconnect={buildReconnectHandler(startOauth)} />
        ) : (
          <DisconnectedState onConnect={buildConnectHandler(startOauth)} />
        )}
      </section>
    </main>
  )
}

function IntegrationHeader({ tenantName }: { tenantName: string }) {
  return (
    <header className="dashboard-header integrations-header">
      <div>
        <p className="eyebrow">{tenantName} · Settings</p>
        <h1>Integrations</h1>
        <p className="integrations-lede">Connect the tenant’s private Drive vault for uploads, downloads, and desktop sync.</p>
      </div>
      <Link to="/" className="ghost-action integration-back">
        <ArrowLeft size={14} /> Back to dashboard
      </Link>
    </header>
  )
}

function ConnectingState({ tenantName }: { tenantName: string }) {
  return (
    <main className="dashboard-shell integrations-shell">
      <IntegrationHeader tenantName={tenantName} />
      <section className="integration-card connecting">
        <div className="integration-icon-stack" aria-hidden="true">
          <Cloud size={24} />
        </div>
        <p className="muted">Connecting to Google Drive…</p>
      </section>
    </main>
  )
}

function ConnectedState({
  integration,
  onDisconnect,
}: {
  integration: { connectedEmail: string; status: string }
  onDisconnect: () => Promise<void>
}) {
  return (
    <div className="integration-connected-grid">
      <div className="integration-status-panel">
        <span className="integration-status-pill"><CheckCircle2 size={15} /> Connected</span>
        <h3>Tenant Drive vault is online</h3>
        <p>New uploads will be stored in the connected Google Drive folder while tenant access remains scoped through Convex.</p>
        <dl className="integration-account">
          <dt>Account</dt>
          <dd>{integration.connectedEmail}</dd>
        </dl>
        <button type="button" className="ghost-action integration-danger" onClick={onDisconnect}>
          <PlugZap size={14} aria-hidden="true" /> Disconnect
        </button>
      </div>
      <div className="integration-benefits" aria-label="Connected capabilities">
        <div><FolderCheck size={18} /><span>Dedicated Drive folder</span></div>
        <div><ShieldCheck size={18} /><span>Tenant-scoped access</span></div>
        <div><DatabaseZap size={18} /><span>Upload/download ready</span></div>
      </div>
    </div>
  )
}

function DisconnectedState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="integration-disconnected">
      <h3>Bring your own Google Drive storage</h3>
      <p>Connect an admin-owned Drive account to create the tenant vault and enable file uploads.</p>
      <button type="button" className="primary-action" onClick={onConnect}>
        <Plug size={14} aria-hidden="true" /> Connect Google Drive
      </button>
    </div>
  )
}

function ErrorState({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="integration-disconnected">
      <p className="integration-alert error">
        <AlertTriangle size={16} aria-hidden="true" />
        Google Drive access expired. Reconnect to continue uploading files.
      </p>
      <button type="button" className="primary-action" onClick={onReconnect}>
        <RefreshCw size={14} aria-hidden="true" /> Reconnect Google Drive
      </button>
    </div>
  )
}

function buildConnectHandler(startOauth: ReturnType<typeof useAction>) {
  return async () => {
    const hostname = window.location.host
    try {
      const { consentUrl } = await startOauth({ hostname })
      window.location.href = consentUrl
    } catch (err) {
      // error will be surfaced via the page's error state
      throw err
    }
  }
}

function buildReconnectHandler(startOauth: ReturnType<typeof useAction>) {
  return buildConnectHandler(startOauth)
}

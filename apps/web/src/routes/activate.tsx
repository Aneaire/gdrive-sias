import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2, ShieldAlert, KeyRound } from 'lucide-react'

import { getConvexHttpUrl, isConvexConfigured } from '../integrations/convex/provider'

export const Route = createFileRoute('/activate')({ component: ActivateScreen })

const DESKTOP_API: DesktopApi | null =
  typeof window !== 'undefined'
    ? (window as unknown as DesktopWindow).gcustomizeDesktop ?? null
    : null

type ActivationResponse = {
  tenantId: string
  tenant: { slug: string; subdomain: string; plan: 'standard' | 'office' | 'pro' }
  branding: {
    productName: string
    logoStorageKey: string | null
    accentColor: string
    faviconStorageKey: string | null
  }
  firstActivation: boolean
}

type State =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'activating' }
  | { kind: 'success'; branding: ActivationResponse['branding']; tenant: ActivationResponse['tenant'] }
  | { kind: 'error'; message: string }

export function ActivateScreen() {
  const [licenseKey, setLicenseKey] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })

  if (!isConvexConfigured()) {
    return <ErrorRow message="Convex is not configured. Set VITE_CONVEX_URL before launching." />
  }

  if (!DESKTOP_API) {
    // Browsers hitting /activate will jump to the host-based branded sign-in
    // flow at the apex or subdomain — this page is desktop-only.
    return (
      <div className="activate-shell">
        <KeyRound size={28} aria-hidden="true" />
        <h1>Activate a license</h1>
        <p>This page is for desktop and mobile apps. To sign in on the web, visit your subdomain at <code>{typeof window !== 'undefined' ? window.location.host : ''}</code>.</p>
      </div>
    )
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = licenseKey.trim().toUpperCase()
    if (!trimmed || state.kind === 'activating' || state.kind === 'validating') return

    setState({ kind: 'activating' })
    try {
      const deviceId = await DESKTOP_API!.getDeviceId()
      const endpoint = getConvexHttpUrl('/license/activate')
      if (!endpoint) throw new Error('License endpoint is not configured.')

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          licenseKey: trimmed,
          deviceId,
          platform: 'desktop',
          deviceLabel: await DESKTOP_API!.getDeviceLabel().catch(() => null),
        }),
      })

      if (response.status === 403) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'License is not active. Contact support.')
      }
      if (response.status === 409) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Seat limit reached.')
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? `Activation failed (HTTP ${response.status}).`)
      }

      const result: ActivationResponse = await response.json()
      await DESKTOP_API!.setLicenseConfig({
        licenseKey: trimmed,
        deviceId,
        tenantId: result.tenantId,
        tenantSubdomain: result.tenant.subdomain,
        branding: result.branding,
      })
      await DESKTOP_API!.applyBranding(result.branding)
      setState({ kind: 'success', branding: result.branding, tenant: result.tenant })
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Unexpected error during activation.',
      })
    }
  }

  return (
    <div className="activate-shell">
      <KeyRound size={32} aria-hidden="true" />
      <h1>Activate your license</h1>
      <p className="activate-lede">
        Enter the license key you received when you purchased this product. We'll
        bind this device to your tenant and remember it for next time.
      </p>

      <form className="activate-form" onSubmit={onSubmit}>
        <label className="activate-field">
          <span>License key</span>
          <input
            type="text"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={state.kind === 'activating'}
          />
        </label>

        {state.kind === 'error' ? (
          <p className="activate-error" role="alert">
            <ShieldAlert size={16} aria-hidden="true" />
            {state.message}
          </p>
        ) : null}

        {state.kind === 'success' ? (
          <p className="activate-success" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            Activated as <strong>{state.branding.productName}</strong> ({state.tenant.subdomain}). Apply branding and continue to sign-in.
          </p>
        ) : null}

        <button type="submit" className="primary-action" disabled={state.kind === 'activating' || !licenseKey.trim()}>
          {state.kind === 'activating' ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null}
          {state.kind === 'activating' ? 'Activating…' : 'Activate'}
        </button>

        {state.kind === 'success' ? (
          <button type="button" className="primary-action ghost" onClick={() => window.location.assign('/')}>
            Continue to sign-in
          </button>
        ) : null}
      </form>
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="activate-shell">
      <ShieldAlert size={28} aria-hidden="true" />
      <h1>Can't proceed</h1>
      <p className="activate-error">{message}</p>
    </div>
  )
}

type DesktopApi = {
  getDeviceId(): Promise<string>
  getDeviceLabel(): Promise<string>
  setLicenseConfig(config: {
    licenseKey: string
    deviceId: string
    tenantId: string
    tenantSubdomain: string
    branding: ActivationResponse['branding']
  }): Promise<void>
  applyBranding(branding: ActivationResponse['branding']): Promise<void>
  validateLicense(licenseKey: string, deviceId: string): Promise<{ revoked: boolean; reason?: string }>
}

type DesktopWindow = {
  gcustomizeDesktop?: DesktopApi
}
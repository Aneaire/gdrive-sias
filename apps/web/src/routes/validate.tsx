import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'

import { getConvexHttpUrl } from '../integrations/convex/provider'

export const Route = createFileRoute('/validate')({ component: ValidateScreen })

const DESKTOP_API: DesktopApi | null =
  typeof window !== 'undefined'
    ? (window as unknown as DesktopWindow).gcustomizeDesktop ?? null
    : null

/**
 * Periodic / on-launch validation screen. Desktop shell navigates here after
 * the renderer loads so we can call /license/validate through the renderer
 * (which knows the Convex site URL) and dispatch the right outcome:
 *   - revoked:false → navigate to /files (sign-in or file browser)
 *   - revoked:true  → show the contact-support screen
 */
export function ValidateScreen() {
  const navigate = useNavigate()
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    void runValidation()
  }, [])

  async function runValidation() {
    try {
      if (!DESKTOP_API) {
        // Not the desktop app — go to the branded file/sign-in route.
        navigate({ to: '/files', search: { trash: false } })
        return
      }

      const config = await DESKTOP_API.getLicenseConfig()
      if (!config) {
        navigate({ to: '/activate' })
        return
      }

      const endpoint = getConvexHttpUrl('/license/validate')
      if (!endpoint) {
        setReason('Convex is not configured on this device.')
        return
      }

      const result = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: config.licenseKey,
          deviceId: config.deviceId,
        }),
      }).then((r) => r.json())

      if (result.revoked) {
        setReason(result.reason ?? 'Your license is no longer active.')
        await DESKTOP_API.clearLicenseConfig()
        return
      }

      // Refresh cached branding if the tenant admin changed it.
      if (result.branding && result.branding.productName !== config.branding?.productName) {
        await DESKTOP_API.setLicenseConfig({ ...config, branding: result.branding })
        await DESKTOP_API.applyBranding(result.branding)
      } else if (result.branding && config.branding?.accentColor !== result.branding.accentColor) {
        await DESKTOP_API.setLicenseConfig({ ...config, branding: result.branding })
        await DESKTOP_API.applyBranding(result.branding)
      }

      navigate({ to: '/files', search: { trash: false } })
    } catch (error) {
      setReason(error instanceof Error ? error.message : 'Unexpected error validating your license.')
    }
  }

  if (reason) {
    return (
      <div className="activate-shell">
        <ShieldAlert size={32} aria-hidden="true" />
        <h1>License inactive</h1>
        <p className="activate-error">{reason}</p>
        <p className="activate-lede">Contact the person who sold you this app to renew or restore your license.</p>
      </div>
    )
  }

  return (
    <div className="activate-shell" role="status" aria-live="polite">
      <Loader2 size={32} className="spin" aria-hidden="true" />
      <h1>Verifying your license…</h1>
    </div>
  )
}

type LicenseConfig = {
  licenseKey: string
  deviceId: string
  tenantId: string
  tenantSubdomain: string
  branding: {
    productName: string
    accentColor: string
    logoStorageKey: string | null
    faviconStorageKey: string | null
  }
}

type Branding = LicenseConfig['branding']

type DesktopApi = {
  getDeviceId(): Promise<string>
  getDeviceLabel(): Promise<string>
  getLicenseConfig(): Promise<LicenseConfig | null>
  setLicenseConfig(config: LicenseConfig): Promise<void>
  clearLicenseConfig(): Promise<void>
  applyBranding(branding: Branding): Promise<void>
}

type DesktopWindow = {
  gcustomizeDesktop?: DesktopApi
}
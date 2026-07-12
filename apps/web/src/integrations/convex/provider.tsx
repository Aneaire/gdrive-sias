import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'

preserveGoogleDriveOauthCode()

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined
const convexSiteUrl =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ?? deriveSiteUrl(convexUrl)
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null

export function isConvexConfigured() {
  return Boolean(convexClient)
}

/**
 * Returns the Convex HTTP-actions base URL (e.g. for /license/activate).
 *
 * - In production: VITE_CONVEX_URL is `https://<dep>.convex.cloud`, and
 *   HTTP actions live at `https://<dep>.convex.site`.
 * - Locally (anonymous dev deployment): VITE_CONVEX_URL is
 *   `http://127.0.0.1:3210`, and HTTP actions are at port 3211 on the
 *   same host.
 * - Override: set `VITE_CONVEX_SITE_URL` explicitly.
 */
export function getConvexHttpUrl(path: string) {
  if (!convexSiteUrl) return null
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${convexSiteUrl}${normalizedPath}`
}

export default function AppConvexProvider({
  children,
}: {
  children: React.ReactNode
}) {
  if (!convexClient) return <>{children}</>
  return <ConvexAuthProvider client={convexClient}>{children}</ConvexAuthProvider>
}

function preserveGoogleDriveOauthCode() {
  if (typeof window === 'undefined') return
  if (!window.location.pathname.endsWith('/settings/integrations')) return

  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const issuer = url.searchParams.get('iss')
  const scope = url.searchParams.get('scope')
  const looksLikeGoogleDriveCallback =
    Boolean(code && state) &&
    (issuer === 'https://accounts.google.com' || scope?.includes('googleapis.com/auth/drive'))

  if (!looksLikeGoogleDriveCallback || !code) return

  // Convex Auth's Password provider also consumes a top-level `?code=` query
  // parameter for email-code sign-in. Google Drive OAuth returns its auth code
  // with the same name, so move it before ConvexAuthProvider initializes.
  url.searchParams.set('drive_code', code)
  url.searchParams.delete('code')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

function deriveSiteUrl(clientUrl: string | undefined): string | undefined {
  if (!clientUrl) return undefined
  if (clientUrl.endsWith('.convex.cloud')) {
    return clientUrl.replace(/\.convex\.cloud$/, '.convex.site')
  }
  // Anonymous local dev: replace :3210 with :3211.
  const portMatch = clientUrl.match(/:(\d+)\/?$/)
  if (portMatch && portMatch[1] === '3210') {
    return clientUrl.replace(/:3210\/?$/, ':3211')
  }
  // Fall back to the client URL itself (best-effort; some deployments don't
  // separate the site URL).
  return clientUrl
}
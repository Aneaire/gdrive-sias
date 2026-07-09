import { httpRouter } from 'convex/server'

import { auth } from './auth'
import { httpAction } from './_generated/server'
import { activateLicense, revokeLicense, validateLicense } from './licenseHttp'
import { handleDriveOauthCallback } from './driveOauth'
import { handleDriveUpload, handleDriveDownload } from './googleDrive'

const http = httpRouter()

auth.addHttpRoutes(http)

// ────────────────────────────────────────────────────────────────────────
// Public licensing routes (no Convex Auth — the license key IS the proof)
// ────────────────────────────────────────────────────────────────────────

const preflight = httpAction(async (_ctx, req) => {
  const origin = req.headers.get('origin') ?? '*'
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  })
})

http.route({ path: '/license/activate', method: 'OPTIONS', handler: preflight })
http.route({ path: '/license/activate', method: 'POST', handler: activateLicense })

http.route({ path: '/license/validate', method: 'OPTIONS', handler: preflight })
http.route({ path: '/license/validate', method: 'POST', handler: validateLicense })

http.route({ path: '/license/revoke', method: 'OPTIONS', handler: preflight })
http.route({ path: '/license/revoke', method: 'POST', handler: revokeLicense })

// Phase D: OAuth callback + tenant-scoped Drive routes
http.route({ path: '/drive-oauth/callback', method: 'OPTIONS', handler: preflight })
http.route({ path: '/drive-oauth/callback', method: 'POST', handler: handleDriveOauthCallback })

http.route({ path: '/drive-upload',  method: 'OPTIONS', handler: preflight })
http.route({ path: '/drive-upload',  method: 'POST',    handler: handleDriveUpload })

http.route({ path: '/drive-download', method: 'OPTIONS', handler: preflight })
http.route({ path: '/drive-download', method: 'GET',     handler: handleDriveDownload })

export default http
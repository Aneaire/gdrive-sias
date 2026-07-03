import { httpAction } from './_generated/server'
import { internal } from './_generated/api'

import { requireSuperAdmin } from './tenantHelpers'

type Platform = 'desktop' | 'mobile' | 'web'

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

type ValidateResponse =
  | {
      revoked: false
      lastSeenAt: number
      branding: ActivationResponse['branding']
      tenant: ActivationResponse['tenant']
    }
  | { revoked: true; reason: string }

/**
 * Activate a license against the shared deployment. The license key IS the
 * proof — no Convex Auth required.
 *
 * POST body: { licenseKey, deviceId, platform: 'desktop'|'mobile'|'web',
 *              deviceLabel?: string }
 * 200 → ActivationResponse
 * 403 → license is not active / unknown key
 * 409 → seat cap reached OR device was previously revoked
 */
export const activateLicense = httpAction(async (ctx, req) => {
  const headers = corsHeaders(req)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400, headers)
  }

  const parsed = parseActivationBody(body)
  if ('error' in parsed) return json({ error: parsed.error }, 400, headers)

  const { licenseKey, deviceId, platform, deviceLabel } = parsed

  const license = await ctx.runQuery(internal.licenses.findLicenseByKey, { licenseKey })
  if (!license || license.status === 'revoked') {
    return json({ error: 'License is not active.' }, 403, headers)
  }

  const existingDevice = await ctx.runQuery(internal.licenses.findDevice, {
    licenseKey,
    deviceId,
  })

  let firstActivation: boolean
  if (existingDevice) {
    if (existingDevice.revokedAt !== undefined) {
      return json(
        { error: 'Device was revoked by an admin. Ask them to release the seat first.' },
        409,
        headers,
      )
    }
    await ctx.runMutation(internal.licenses.touchDevice, { licenseKey, deviceId })
    firstActivation = false
  } else {
    const activeCount = await ctx.runQuery(internal.licenses.listActiveDeviceCount, {
      licenseKey,
    })
    if (activeCount >= license.seats) {
      return json(
        { error: 'Seat limit reached. Ask the admin to release a device in Settings → Devices.' },
        409,
        headers,
      )
    }
    await ctx.runMutation(internal.licenses.upsertDevice, {
      licenseKey,
      deviceId,
      platform,
      label: deviceLabel,
    })
    firstActivation = true
  }

  const tenant = await ctx.runQuery(internal.licenses.getTenantBrandingForActivation, {
    tenantId: license.tenantId,
  })
  if (!tenant) return json({ error: 'Tenant for license not found.' }, 500, headers)

  const response: ActivationResponse = {
    tenantId: tenant.tenantId,
    tenant: { slug: tenant.slug, subdomain: tenant.subdomain, plan: tenant.plan },
    branding: tenant.branding,
    firstActivation,
  }
  return json(response, 200, headers)
})

/**
 * Periodic re-check by launched apps (desktop/mobile per-launch; web per
 * session). Same key-as-proof principle.
 *
 * POST body: { licenseKey, deviceId }
 * 200 → ValidateResponse (revoked:false on success, revoked:true once revoked)
 */
export const validateLicense = httpAction(async (ctx, req) => {
  const headers = corsHeaders(req)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400, headers)
  }

  const parsed = parseValidateBody(body)
  if ('error' in parsed) return json({ error: parsed.error }, 400, headers)

  const { licenseKey, deviceId } = parsed

  const license = await ctx.runQuery(internal.licenses.findLicenseByKey, { licenseKey })
  if (!license) {
    return json(
      { revoked: true, reason: 'License not found. Contact the licensor.' },
      200,
      headers,
    )
  }

  if (license.status === 'revoked') {
    return json(
      { revoked: true, reason: 'License revoked by the licensor. Contact support.' },
      200,
      headers,
    )
  }

  const device = await ctx.runQuery(internal.licenses.findDevice, { licenseKey, deviceId })
  if (!device) {
    return json(
      { revoked: true, reason: 'Device is not bound to this license. Run activation first.' },
      200,
      headers,
    )
  }
  if (device.revokedAt !== undefined) {
    return json(
      { revoked: true, reason: 'Device was revoked by the admin.' },
      200,
      headers,
    )
  }

  await ctx.runMutation(internal.licenses.touchDevice, { licenseKey, deviceId })

  const tenant = await ctx.runQuery(internal.licenses.getTenantBrandingForActivation, {
    tenantId: license.tenantId,
  })
  if (!tenant) {
    return json({ revoked: true, reason: 'Tenant not found.' }, 200, headers)
  }

  const validateResponse: ValidateResponse = {
    revoked: false,
    lastSeenAt: Date.now(),
    branding: tenant.branding,
    tenant: { slug: tenant.slug, subdomain: tenant.subdomain, plan: tenant.plan },
  }
  return json(validateResponse, 200, headers)
})

/**
 * Superadmin-only kill switch. Marks the license and bound devices revoked.
 *
 * POST body: { licenseKey, reason? }
 * 200 → { revoked: true, tenantId, revokedDevices, actor }
 * 401 → not authenticated / not superadmin
 * 404 → license not found
 */
export const revokeLicense = httpAction(async (ctx, req) => {
  const headers = corsHeaders(req)

  let identity
  try {
    // httpAction ctx has the same `auth` + `db` shape that requireSuperAdmin
    // needs; the cast bridges the stricter ActionCtx type to AuthedCtx.
    identity = await requireSuperAdmin(ctx as unknown as Parameters<typeof requireSuperAdmin>[0])
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Superadmin access required.' },
      401,
      headers,
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400, headers)
  }

  const parsed = parseRevokeBody(body)
  if ('error' in parsed) return json({ error: parsed.error }, 400, headers)

  const { licenseKey, reason } = parsed

  const result = await ctx.runMutation(internal.licenses.revokeLicenseAndDevices, {
    licenseKey,
    reason,
  })

  if (!result.found) return json({ error: 'License not found.' }, 404, headers)

  if (result.tenantId !== null) {
    await ctx.runMutation(internal.licenses.recordAuditInternal, {
      tenantId: result.tenantId,
      action: 'license.revoke',
      targetId: licenseKey,
    })
  }

  return json(
    {
      revoked: true,
      tenantId: result.tenantId,
      revokedDevices: result.revokedDevices,
      actor: identity.email,
    },
    200,
    headers,
  )
})

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function parseActivationBody(body: unknown):
  | { licenseKey: string; deviceId: string; platform: Platform; deviceLabel?: string }
  | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object.' }
  const raw = body as Record<string, unknown>
  const licenseKey = typeof raw.licenseKey === 'string' ? raw.licenseKey.trim() : ''
  const deviceId = typeof raw.deviceId === 'string' ? raw.deviceId.trim() : ''
  const platform =
    raw.platform === 'desktop' || raw.platform === 'mobile' || raw.platform === 'web'
      ? raw.platform
      : undefined

  if (!licenseKey) return { error: 'licenseKey is required.' }
  if (!deviceId) return { error: 'deviceId is required.' }
  if (!platform) return { error: 'platform must be one of desktop|mobile|web.' }

  const deviceLabel =
    typeof raw.deviceLabel === 'string' ? raw.deviceLabel.trim() || undefined : undefined

  return { licenseKey, deviceId, platform, deviceLabel }
}

function parseValidateBody(
  body: unknown,
): { licenseKey: string; deviceId: string } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object.' }
  const raw = body as Record<string, unknown>
  const licenseKey = typeof raw.licenseKey === 'string' ? raw.licenseKey.trim() : ''
  const deviceId = typeof raw.deviceId === 'string' ? raw.deviceId.trim() : ''
  if (!licenseKey) return { error: 'licenseKey is required.' }
  if (!deviceId) return { error: 'deviceId is required.' }
  return { licenseKey, deviceId }
}

function parseRevokeBody(body: unknown):
  | { licenseKey: string; reason?: string }
  | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object.' }
  const raw = body as Record<string, unknown>
  const licenseKey = typeof raw.licenseKey === 'string' ? raw.licenseKey.trim() : ''
  if (!licenseKey) return { error: 'licenseKey is required.' }
  const reason =
    typeof raw.reason === 'string' ? raw.reason.trim() || undefined : undefined
  return { licenseKey, reason }
}

function corsHeaders(
  req: Request,
  extra?: Record<string, string>,
): Record<string, string> {
  const origin = req.headers.get('origin') ?? '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Content-Type': 'application/json',
    ...extra,
  }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers })
}
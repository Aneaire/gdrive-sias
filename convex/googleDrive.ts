import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { DriveNotConnectedError, DriveReconnectNeededError, requireTenantMember } from './tenantHelpers'
import { decryptAes256Gcm, encryptAes256Gcm } from './driveOauth'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const GOOGLE_DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

type CtxShape = {
  runQuery: (fn: any, args: Record<string, any>) => Promise<any>
  runMutation: (fn: any, args: Record<string, any>) => Promise<any>
}

/**
 * Resolves a fresh Google Drive access token for the given tenant.
 * Uses the cached token if still valid, otherwise refreshes via the
 * stored refresh_token. Throws DriveNotConnectedError or
 * DriveReconnectNeededError on failure.
 */
export async function getTenantAccessToken(
  ctx: CtxShape,
  tenantId: Id<'tenants'>,
): Promise<string> {
  const integration = await ctx.runQuery(internal.tenantIntegrations.getForUpload, { tenantId })
  if (!integration || integration.status !== 'connected') {
    throw new DriveNotConnectedError()
  }

  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY not configured')

  const cacheMargin = 60_000
  if (
    integration.accessToken &&
    integration.accessTokenExpiresAt &&
    integration.accessTokenExpiresAt > Date.now() + cacheMargin
  ) {
    return await decryptAes256Gcm(integration.accessToken, encryptionKey)
  }

  const refreshToken = await decryptAes256Gcm(integration.refreshToken, encryptionKey)
  const clientId = integration.clientId
    ? await decryptAes256Gcm(integration.clientId, encryptionKey)
    : process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = integration.clientSecret
    ? await decryptAes256Gcm(integration.clientSecret, encryptionKey)
    : process.env.GOOGLE_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth client credentials not configured.')
  }

  let response: Response
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
  } catch {
    throw new Error('Failed to contact Google token endpoint.')
  }

  if (response.status === 400 || response.status === 401) {
    let errorBody = ''
    try {
      errorBody = (await response.json()).error as string
    } catch { /* ignore parse error */ }

    if (errorBody === 'invalid_grant') {
      await ctx.runMutation(internal.tenantIntegrations.markIntegrationError, {
        tenantId,
        error: 'Google Drive access revoked. Reconnect in Settings.',
      })
      throw new DriveReconnectNeededError()
    }
    throw new Error(`Token refresh failed: ${errorBody || response.statusText}`)
  }

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.statusText}`)
  }

  const tokens = await response.json()
  const accessToken = tokens.access_token as string
  const expiresIn = (tokens.expires_in as number) ?? 3600
  const expiresAt = Date.now() + expiresIn * 1000

  const encAccessToken = await encryptAes256Gcm(accessToken, encryptionKey)

  await ctx.runMutation(internal.tenantIntegrations.updateTokenCache, {
    tenantId,
    accessToken: encAccessToken,
    accessTokenExpiresAt: expiresAt,
  })

  return accessToken
}

export async function ensureFolderPath(rootFolderId: string): Promise<string> {
  return rootFolderId
}

/**
 * POST /drive-upload
 *
 * Uploads a file to the tenant's Google Drive.
 * Accepts JSON body: { name, mimeType?, base64Content, fileId, folderId? }
 */
export const handleDriveUpload = httpAction(async (ctx, req) => {
  const headers = corsHeaders(req)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400, headers)
  }

  const name = typeof body.name === 'string' ? body.name : ''
  const base64Content = typeof body.base64Content === 'string' ? body.base64Content : ''
  const fileId = typeof body.fileId === 'string' ? body.fileId : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'application/octet-stream'
  const folderId = typeof body.folderId === 'string' ? body.folderId : undefined

  if (!name) return json({ error: 'name is required.' }, 400, headers)
  if (!base64Content) return json({ error: 'base64Content is required.' }, 400, headers)
  if (!fileId) return json({ error: 'fileId is required.' }, 400, headers)

  let tenantId: Id<'tenants'>
  try {
    const member = await requireTenantMember(ctx as any)
    tenantId = member.tenantId
  } catch (error: any) {
    return json({ error: error.message ?? 'Not authenticated.' }, 401, headers)
  }

  let accessToken: string
  try {
    accessToken = await getTenantAccessToken(ctx, tenantId)
  } catch (error: any) {
    const status = error instanceof DriveNotConnectedError ? 403 : 502
    return json({ error: error.message }, status, headers)
  }

  const targetFolderId = folderId ?? (await resolveRootFolder(ctx, tenantId))

  const fileBytes = base64ToBytes(base64Content)
  const metadata = { name, mimeType, parents: [targetFolderId] }
  const boundary = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

  const encoder = new TextEncoder()
  const parts = [
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    encoder.encode(JSON.stringify(metadata)),
    encoder.encode(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBytes,
    encoder.encode(`\r\n--${boundary}--\r\n`),
  ]
  const totalLen = parts.reduce((s, p) => s + p.byteLength, 0)
  const bodyArr = new Uint8Array(totalLen)
  let offset = 0
  for (const p of parts) {
    bodyArr.set(p, offset)
    offset += p.byteLength
  }

  let driveRes: Response
  try {
    driveRes = await fetch(`${GOOGLE_DRIVE_UPLOAD}?uploadType=multipart`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(totalLen),
      },
      body: bodyArr,
    })
  } catch {
    return json({ error: 'Failed to upload to Google Drive.' }, 502, headers)
  }

  if (!driveRes.ok) {
    const errorText = await driveRes.text().catch(() => '')
    return json({ error: `Drive upload failed: ${errorText}` }, driveRes.status, headers)
  }

  const driveFile = await driveRes.json()

  await ctx.runMutation(internal.files.markDriveUploadStored, {
    id: fileId as Id<'files'>,
    driveFileId: driveFile.id as string,
    driveFolderId: targetFolderId,
    driveWebViewLink: driveFile.webViewLink as string | undefined,
    driveWebContentLink: driveFile.webContentLink as string | undefined,
    driveMd5Checksum: driveFile.md5Checksum as string | undefined,
    mimeType: driveFile.mimeType as string | undefined,
    size: driveFile.size ? Number(driveFile.size) : undefined,
  })

  return json(
    {
      success: true,
      driveFileId: driveFile.id,
      driveWebViewLink: driveFile.webViewLink,
      name: driveFile.name,
    },
    200,
    headers,
  )
})

/**
 * GET /drive-download
 *
 * Proxies a file download from the tenant's Google Drive.
 * Query params: driveFileId
 */
export const handleDriveDownload = httpAction(async (ctx, req) => {
  const headers = corsHeaders(req)
  const url = new URL(req.url)
  const driveFileId = url.searchParams.get('driveFileId')

  if (!driveFileId) {
    return json({ error: 'driveFileId is required.' }, 400, headers)
  }

  let tenantId: Id<'tenants'>
  try {
    const member = await requireTenantMember(ctx as any)
    tenantId = member.tenantId
  } catch (error: any) {
    return json({ error: error.message ?? 'Not authenticated.' }, 401, headers)
  }

  let accessToken: string
  try {
    accessToken = await getTenantAccessToken(ctx, tenantId)
  } catch (error: any) {
    const status = error instanceof DriveNotConnectedError ? 403 : 502
    return json({ error: error.message }, status, headers)
  }

  let driveRes: Response
  try {
    driveRes = await fetch(`${GOOGLE_DRIVE_API}/${driveFileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return json({ error: 'Failed to fetch from Google Drive.' }, 502, headers)
  }

  if (!driveRes.ok) {
    return json({ error: 'Drive download failed.' }, driveRes.status, headers)
  }

  const contentType = driveRes.headers.get('Content-Type') ?? 'application/octet-stream'
  const contentDisposition = driveRes.headers.get('Content-Disposition')
  const contentLength = driveRes.headers.get('Content-Length')

  const responseHeaders: Record<string, string> = {
    ...headers,
    'Content-Type': contentType,
  }
  if (contentDisposition) responseHeaders['Content-Disposition'] = contentDisposition
  if (contentLength) responseHeaders['Content-Length'] = contentLength

  return new Response(driveRes.body, {
    status: driveRes.status,
    headers: responseHeaders,
  })
})

async function resolveRootFolder(ctx: CtxShape, tenantId: Id<'tenants'>): Promise<string> {
  const integration = await ctx.runQuery(internal.tenantIntegrations.getForUpload, { tenantId })
  return integration?.rootFolderId ?? 'root'
}

function base64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const binary = atob(normalized)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.codePointAt(i)!
    }
    return bytes
  } catch {
    return new Uint8Array(0)
  }
}

function corsHeaders(req: Request, extra?: Record<string, string>): Record<string, string> {
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

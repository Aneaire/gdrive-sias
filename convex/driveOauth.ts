import { httpAction } from './_generated/server'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'

export const handleDriveOauthCallback = httpAction(async (ctx, req) => {
  const headers = corsHeaders(req)

  const body = await parseJsonBody<{ code: string; state: string }>(req)
  if (!body || typeof body.code !== 'string' || typeof body.state !== 'string') {
    return json({ error: 'code and state are required.' }, 400, headers)
  }

  const { code, state } = body

  const oauthStateSecret = process.env.OAUTH_STATE_SECRET
  if (!oauthStateSecret) return json({ error: 'OAUTH_STATE_SECRET not configured.' }, 500, headers)

  const statePayload = await verifyStateJwt(state, oauthStateSecret)
  if (!statePayload) return json({ error: 'Invalid or expired state.' }, 403, headers)

  if (Date.now() > statePayload.exp) {
    return json({ error: 'State expired. Try connecting again.' }, 403, headers)
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return json({ error: 'Google OAuth not configured.' }, 500, headers)
  }

  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? ''
  const host = origin ? new URL(origin).host : ''
  const redirectUri = host
    ? `https://${host}/settings/integrations`
    : 'https://localhost:3000/settings/integrations'

  let tokenResponse: Response
  try {
    tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
  } catch {
    return json({ error: 'Failed to contact Google token endpoint.' }, 502, headers)
  }

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text()
    return json(
      { error: `Google token exchange failed: ${errorBody}` },
      tokenResponse.status,
      headers,
    )
  }

  const tokens = await tokenResponse.json()
  const refreshToken = tokens.refresh_token as string | undefined
  const accessToken = tokens.access_token as string
  const expiresIn = (tokens.expires_in as number) ?? 3600

  if (!refreshToken) {
    return json(
      {
        error:
          'No refresh token returned. Remove the app from myaccount.google.com/permissions and try again.',
      },
      400,
      headers,
    )
  }

  let connectedEmail: string
  try {
    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const userInfo = await userInfoRes.json()
    connectedEmail = userInfo.email as string
  } catch {
    connectedEmail = 'unknown'
  }

  const tenant = await ctx.runQuery(api.tenants.getBySubdomain, {
    subdomain: statePayload.subdomain,
  })
  if (!tenant) return json({ error: 'Tenant not found.' }, 404, headers)

  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey) return json({ error: 'ENCRYPTION_KEY not configured.' }, 500, headers)

  let encryptedRefresh: string
  try {
    encryptedRefresh = await encryptAes256Gcm(refreshToken, encryptionKey)
  } catch {
    return json({ error: 'Encryption failed.' }, 500, headers)
  }

  const encAccessToken = await encryptAes256Gcm(accessToken, encryptionKey)

  const productName = tenant.branding.productName || 'g-customize'
  const folderName = `${productName} — Files`

  let rootFolderId: string
  try {
    rootFolderId = await findOrCreateRootFolder(accessToken, folderName)
  } catch {
    return json({ error: 'Failed to create root folder in Google Drive.' }, 502, headers)
  }

  await ctx.runMutation(internal.tenantIntegrations.upsert, {
    tenantId: statePayload.tenantId as Id<'tenants'>,
    provider: 'google_drive',
    status: 'connected',
    refreshToken: encryptedRefresh,
    accessToken: encAccessToken,
    accessTokenExpiresAt: Date.now() + expiresIn * 1000,
    rootFolderId,
    connectedEmail,
    connectedAt: Date.now(),
  })

  return json({ connected: true, connectedEmail, rootFolderId }, 200, headers)
})

async function findOrCreateRootFolder(accessToken: string, folderName: string): Promise<string> {
  const listRes = await fetch(
    `${GOOGLE_DRIVE_FILES_URL}?q=name='${encodeURIComponent(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false&spaces=drive`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const list = await listRes.json()
  const existing = list.files?.[0]
  if (existing) return existing.id

  const createRes = await fetch(GOOGLE_DRIVE_FILES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  })
  const created = await createRes.json()
  return created.id
}

export async function verifyHmacSha256(
  secret: string,
  data: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const sigBytes = base64urlDecode(signature).buffer as ArrayBuffer
  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data))
}

export async function encryptAes256Gcm(
  plaintext: string,
  keyMaterial: string,
): Promise<string> {
  const encoder = new TextEncoder()
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(keyMaterial))
  const key = await crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, [
    'encrypt',
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext).buffer as ArrayBuffer,
  )
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), iv.length)
  return base64urlEncode(combined)
}

export async function decryptAes256Gcm(
  ciphertextB64: string,
  keyMaterial: string,
): Promise<string> {
  const encoder = new TextEncoder()
  const combined = base64urlDecode(ciphertextB64)
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)
  const keyHash = await crypto.subtle.digest('SHA-256', encoder.encode(keyMaterial))
  const key = await crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, [
    'decrypt',
  ])
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data.buffer as ArrayBuffer,
  )
  return new TextDecoder().decode(decrypted)
}

export async function signHmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return base64urlEncode(new Uint8Array(signature))
}

export async function verifyStateJwt(
  state: string,
  secret: string,
): Promise<{ tenantId: string; subdomain: string; exp: number } | null> {
  const dotIndex = state.lastIndexOf('.')
  if (dotIndex === -1) return null
  const payloadB64 = state.slice(0, dotIndex)
  const sigB64 = state.slice(dotIndex + 1)
  if (!payloadB64 || !sigB64) return null

  const valid = await verifyHmacSha256(secret, payloadB64, sigB64)
  if (!valid) return null

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)))
    if (typeof payload.tenantId !== 'string' || typeof payload.subdomain !== 'string') {
      return null
    }
    return { tenantId: payload.tenantId, subdomain: payload.subdomain, exp: payload.exp ?? 0 }
  } catch {
    return null
  }
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCodePoint(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.codePointAt(i)!
  }
  return bytes
}

async function parseJsonBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
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

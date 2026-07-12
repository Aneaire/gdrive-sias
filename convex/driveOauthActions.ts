import { v } from 'convex/values'
import { action } from './_generated/server'
import { internal } from './_generated/api'

export const startDriveOauth = action({
  args: { hostname: v.string() },
  returns: v.object({ consentUrl: v.string() }),
  handler: async (ctx, args): Promise<{ consentUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Not authenticated.')

    const result: unknown = await ctx.runQuery(internal.tenants.getMyTenantInfo, {})
    const info = result as { tenantId: string; subdomain: string } | null
    if (!info) throw new Error('Tenant admin access required.')

    const oauthSecret: string | undefined = process.env.OAUTH_STATE_SECRET as string | undefined
    const clientId: string | undefined = process.env.GOOGLE_OAUTH_CLIENT_ID as string | undefined
    if (!oauthSecret) throw new Error('OAUTH_STATE_SECRET not configured.')
    if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID not configured.')

    const { signHmacSha256 } = await import('./driveOauth')
    const encoder = new TextEncoder()

    const nonce: string = crypto.randomUUID()
    const exp: number = Date.now() + 5 * 60 * 1000
    const payload: Record<string, unknown> = { tenantId: info.tenantId, subdomain: info.subdomain, nonce, exp }
    const payloadB64: string = btoa(
      String.fromCodePoint(...new Uint8Array(encoder.encode(JSON.stringify(payload)))),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const signature: string = await signHmacSha256(oauthSecret, payloadB64)
    const state: string = `${payloadB64}.${signature}`

    const protocol: string = args.hostname === 'localhost:3000' ? 'http:' : 'https:'
    const redirectUri: string = `${protocol}//${args.hostname}/settings/integrations`
    const scope: string = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email'

    const params: URLSearchParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    })

    return { consentUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }
  },
})
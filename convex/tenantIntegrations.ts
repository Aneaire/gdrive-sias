import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { internalQuery, mutation, query } from './_generated/server'
import { requireTenantAdmin } from './tenantHelpers'

/**
 * Loads the tenant's Google Drive integration row.
 * Caller must be a tenant admin (the Settings → Integrations page is admin-only).
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireTenantAdmin(ctx)
    return await getForTenant(ctx, admin.tenantId)
  },
})

/**
 * Internal query used by `getTenantAccessToken()` (Phase D) during upload/download actions.
 */
export const getForUpload = internalQuery({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, args) => {
    return await getForTenant(ctx, args.tenantId)
  },
})

async function getForTenant(ctx: QueryCtx, tenantId: Id<'tenants'>) {
  return await ctx.db
    .query('tenantIntegrations')
    .withIndex('by_tenant_provider', (q) =>
      q.eq('tenantId', tenantId).eq('provider', 'google_drive'),
    )
    .unique()
}

/**
 * Disconnects Google Drive for the tenant. Marks the integration row revoked
 * and clears cached access tokens. The next upload will throw
 * `DriveNotConnectedError` until the admin re-connects.
 */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireTenantAdmin(ctx)
    const existing = await getForTenant(ctx, admin.tenantId)
    if (!existing) return null

    await ctx.db.patch(existing._id, {
      status: 'revoked',
      revokedAt: Date.now(),
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      lastError: 'Disconnected by admin',
    })

    return { revokedAt: Date.now() }
  },
})
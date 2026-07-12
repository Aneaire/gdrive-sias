import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { AuthRequiredError, requireTenantAdmin, TenantMembershipRequiredError } from './tenantHelpers'

/**
 * Loads the tenant's Google Drive integration row.
 * Caller must be a tenant admin (the Settings → Integrations page is admin-only).
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    try {
      const admin = await requireTenantAdmin(ctx)
      return await getForTenant(ctx, admin.tenantId)
    } catch (e) {
      if (e instanceof AuthRequiredError || e instanceof TenantMembershipRequiredError) return null
      throw e
    }
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

/**
 * Internal: upserts a Google Drive integration row for the given tenant.
 * Used by the OAuth callback httpAction after successful token exchange.
 */
export const upsert = internalMutation({
  args: {
    tenantId: v.id('tenants'),
    provider: v.literal('google_drive'),
    status: v.union(v.literal('connected'), v.literal('error')),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    rootFolderId: v.string(),
    connectedEmail: v.string(),
    connectedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('tenantIntegrations')
      .withIndex('by_tenant_provider', (q) =>
        q.eq('tenantId', args.tenantId).eq('provider', 'google_drive'),
      )
      .unique()

    const data = {
      provider: args.provider,
      status: args.status,
      refreshToken: args.refreshToken,
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      rootFolderId: args.rootFolderId,
      connectedEmail: args.connectedEmail,
      connectedAt: args.connectedAt,
      revokedAt: undefined,
      lastError: undefined,
    }

    if (existing) {
      await ctx.db.patch(existing._id, data)
    } else {
      await ctx.db.insert('tenantIntegrations', {
        tenantId: args.tenantId,
        ...data,
      })
    }
  },
})

/**
 * Generates the OAuth state JWT and returns the Google consent URL.
 * Called from the frontend when the admin clicks "Connect Google Drive".
 */
/**
 * Internal: caches a fresh access token after a successful refresh.
 */
export const updateTokenCache = internalMutation({
  args: {
    tenantId: v.id('tenants'),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('tenantIntegrations')
      .withIndex('by_tenant_provider', (q) =>
        q.eq('tenantId', args.tenantId).eq('provider', 'google_drive'),
      )
      .unique()
    if (!existing) return
    await ctx.db.patch(existing._id, {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      lastError: undefined,
    })
  },
})

/**
 * Internal: marks an integration as errored (e.g. after an invalid_grant).
 */
export const markIntegrationError = internalMutation({
  args: {
    tenantId: v.id('tenants'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('tenantIntegrations')
      .withIndex('by_tenant_provider', (q) =>
        q.eq('tenantId', args.tenantId).eq('provider', 'google_drive'),
      )
      .unique()
    if (!existing) return
    await ctx.db.patch(existing._id, {
      status: 'error',
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      lastError: args.error,
    })
  },
})


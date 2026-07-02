import { v } from 'convex/values'

import { internalMutation, mutation, query } from './_generated/server'
import { requireLicenseActive, requireTenantMember } from './tenantHelpers'

/**
 * Reports the calling device's sync state for the tenant admin dashboard.
 * Called by the desktop sync service periodically.
 */
export const report = internalMutation({
  args: {
    deviceId: v.string(),
    tenantId: v.id('tenants'),
    online: v.boolean(),
    syncRunning: v.boolean(),
    totalFiles: v.number(),
    cachedFileCount: v.number(),
    pendingUploadCount: v.number(),
    pendingDownloadCount: v.number(),
    failedUploadCount: v.number(),
    failedDownloadCount: v.number(),
    diskBytes: v.number(),
    fullSyncComplete: v.boolean(),
    lastSuccessfulSyncAt: v.optional(v.number()),
    lastMetadataSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('deviceSyncStates')
      .withIndex('by_tenant_device_id', (q) =>
        q.eq('tenantId', args.tenantId).eq('deviceId', args.deviceId),
      )
      .unique()

    const payload = {
      lastSeenAt: Date.now(),
      online: args.online,
      syncRunning: args.syncRunning,
      totalFiles: args.totalFiles,
      cachedFileCount: args.cachedFileCount,
      pendingUploadCount: args.pendingUploadCount,
      pendingDownloadCount: args.pendingDownloadCount,
      failedUploadCount: args.failedUploadCount,
      failedDownloadCount: args.failedDownloadCount,
      diskBytes: args.diskBytes,
      fullSyncComplete: args.fullSyncComplete,
      lastSuccessfulSyncAt: args.lastSuccessfulSyncAt,
      lastMetadataSyncAt: args.lastMetadataSyncAt,
      lastError: args.lastError,
    }

    if (existing) {
      await ctx.db.patch(existing._id, payload)
      return existing._id
    }

    return await ctx.db.insert('deviceSyncStates', {
      tenantId: args.tenantId,
      deviceId: args.deviceId,
      ...payload,
    })
  },
})

/**
 * Lists all devices syncing for the admin's tenant.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireTenantMember(ctx)
    return await ctx.db
      .query('deviceSyncStates')
      .withIndex('by_tenant_last_seen_at', (q) => q.eq('tenantId', admin.tenantId))
      .order('desc')
      .collect()
  },
})

/**
 * Admin-revokes a device sync state entry (cleans up stale devices).
 */
export const remove = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const { tenantId } = await requireLicenseActive(ctx, args.deviceId)
    const existing = await ctx.db
      .query('deviceSyncStates')
      .withIndex('by_tenant_device_id', (q) =>
        q.eq('tenantId', tenantId).eq('deviceId', args.deviceId),
      )
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  },
})
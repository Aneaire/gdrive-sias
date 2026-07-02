import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { mutation, query } from './_generated/server'
import { requireTenantAdmin } from './tenantHelpers'

/**
 * Writes a single audit entry. Called from admin actions (license revoke,
 * member invite, branding change, Drive disconnect). Non-admin members
 * cannot write audits.
 */
export const record = mutation({
  args: {
    action: v.string(),
    targetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireTenantAdmin(ctx)
    return await ctx.db.insert('audits', {
      tenantId: admin.tenantId,
      actorUserId: admin.membership.userId ?? undefined,
      action: args.action,
      targetId: args.targetId,
      createdAt: Date.now(),
    })
  },
})

/**
 * Admin-only: paginated audit entries for the tenant, newest first.
 * Phase G adds optional date-range filtering on top once the audit UI ships.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requireTenantAdmin(ctx)
    return await ctx.db
      .query('audits')
      .withIndex('by_tenant_created_at', (q) => q.eq('tenantId', admin.tenantId))
      .order('desc')
      .paginate(args.paginationOpts)
  },
})
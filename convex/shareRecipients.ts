import { v } from 'convex/values'

import { internalQuery, mutation, query } from './_generated/server'
import { requireTenantAdmin } from './tenantHelpers'

const normalizeEmail = (email: string) => email.trim().toLowerCase()
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Lists the tenant's Auto-share Gmail addresses (admin-only).
 * Every upload to the tenant's Drive is shared with these emails as editor.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireTenantAdmin(ctx)
    return await ctx.db
      .query('shareRecipients')
      .withIndex('by_tenant_email', (q) => q.eq('tenantId', admin.tenantId))
      .collect()
  },
})

export const add = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireTenantAdmin(ctx)
    const email = normalizeEmail(args.email)
    if (!emailPattern.test(email)) throw new Error('Enter a valid email address.')

    const existing = await ctx.db
      .query('shareRecipients')
      .withIndex('by_tenant_email', (q) =>
        q.eq('tenantId', admin.tenantId).eq('email', email),
      )
      .unique()

    if (existing) return existing._id

    return await ctx.db.insert('shareRecipients', {
      tenantId: admin.tenantId,
      email,
      createdAt: Date.now(),
    })
  },
})

export const remove = mutation({
  args: { id: v.id('shareRecipients') },
  handler: async (ctx, args) => {
    const admin = await requireTenantAdmin(ctx)
    const recipient = await ctx.db.get(args.id)
    if (!recipient || recipient.tenantId !== admin.tenantId) return
    await ctx.db.delete(args.id)
  },
})

/**
 * Internal: returns the tenant's recipient emails for the upload pipeline.
 * Passed a tenantId explicitly so the storage action (already auth'd) can
 * share the new Drive file without re-doing membership checks.
 */
export const listEmailsForUpload = internalQuery({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, args) => {
    const recipients = await ctx.db
      .query('shareRecipients')
      .withIndex('by_tenant_email', (q) => q.eq('tenantId', args.tenantId))
      .collect()
    return recipients.map((recipient) => recipient.email)
  },
})
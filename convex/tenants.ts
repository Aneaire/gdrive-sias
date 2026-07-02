import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { query } from './_generated/server'
import { requireTenantAdmin, requireTenantMember } from './tenantHelpers'

/**
 * Public (unauthenticated) lookup used by the web app's subdomain resolver.
 * Returns only non-sensitive branding fields — no secrets leave Convex.
 * The result is cached briefly on the edge (Vercel) for first paint.
 */
export const getBySubdomain = query({
  args: { subdomain: v.string() },
  handler: async (ctx, args) => {
    const tenant = await ctx.db
      .query('tenants')
      .withIndex('by_subdomain', (q) => q.eq('subdomain', args.subdomain))
      .unique()

    if (!tenant) return null

    return {
      tenantId: tenant._id as Id<'tenants'>,
      slug: tenant.slug,
      subdomain: tenant.subdomain,
      plan: tenant.plan,
      branding: {
        productName: tenant.branding.productName,
        logoStorageKey: tenant.branding.logoStorageKey ?? null,
        accentColor: tenant.branding.accentColor,
        faviconStorageKey: tenant.branding.faviconStorageKey ?? null,
      },
    }
  },
})

/**
 * Returns the caller's current tenant context (used by apps for nav, branding,
 * capability flags, and member state).
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const member = await requireTenantMember(ctx)
    const tenant = await ctx.db.get(member.tenantId)
    if (!tenant) return null

    return {
      tenantId: tenant._id,
      slug: tenant.slug,
      subdomain: tenant.subdomain,
      plan: tenant.plan,
      name: tenant.name,
      role: member.role,
      branding: tenant.branding,
    }
  },
})

/**
 * Capability flags derived from `plan`. Used by web/mobile to hide
 * feature-gated UI (`mobile`, `audit`, `byoOauth`) and from the backend
 * helpers to enforce the same gates server-side.
 */
export const capabilities = query({
  args: {},
  handler: async (ctx) => {
    const member = await requireTenantMember(ctx)
    const tenant = await ctx.db.get(member.tenantId)
    if (!tenant) return null

    const license = await ctx.db
      .query('licenses')
      .withIndex('by_tenant', (q) => q.eq('tenantId', tenant._id))
      .first()

    const plan = tenant.plan
    return {
      web: true,
      mobile: plan !== 'standard',
      audit: plan !== 'standard',
      byoOauth: plan === 'pro',
      storageCap: plan === 'standard' ? 50 * 1024 * 1024 * 1024 : null,
      seats: license?.seats ?? 0,
      licenseStatus: license?.status ?? 'active',
    }
  },
})

/**
 * Admin-only: returns the tenant's branding row for the /settings/branding page.
 */
export const brandingForAdmin = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireTenantAdmin(ctx)
    const tenant = await ctx.db.get(admin.tenantId)
    return tenant?.branding ?? null
  },
})
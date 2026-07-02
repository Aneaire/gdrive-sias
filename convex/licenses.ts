import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { requireTenantMember } from './tenantHelpers'

/**
 * LOOKUP / MUTATION PRIMITIVES
 *
 * These run as internal functions called from the HTTP routes
 * (`/license/activate`, `/validate`, `/revoke`). They bypass the zwy
 * `requireTenantMember` check because the licensing flow happens *before*
 * the caller has a Convex Auth identity — the license key IS the proof.
 */

export const findLicenseByKey = internalQuery({
  args: { licenseKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('licenses')
      .withIndex('by_key', (q) => q.eq('licenseKey', args.licenseKey))
      .unique()
  },
})

export const getTenantBrandingForActivation = internalQuery({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId)
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

export const listActiveDeviceCount = internalQuery({
  args: { licenseKey: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key', (q) => q.eq('licenseKey', args.licenseKey))
      .collect()
    return rows.filter((row) => row.revokedAt === undefined).length
  },
})

export const findDevice = internalQuery({
  args: { licenseKey: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('licenseDevices')
      .withIndex('by_key_device', (q) =>
        q.eq('licenseKey', args.licenseKey).eq('deviceId', args.deviceId),
      )
      .unique()
  },
})

export const upsertDevice = internalMutation({
  args: {
    licenseKey: v.string(),
    deviceId: v.string(),
    platform: v.union(
      v.literal('desktop'),
      v.literal('mobile'),
      v.literal('web'),
    ),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ firstActivation: boolean }> => {
    const existing = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key_device', (q) =>
        q.eq('licenseKey', args.licenseKey).eq('deviceId', args.deviceId),
      )
      .unique()

    const now = Date.now()
    if (existing) {
      if (existing.revokedAt !== undefined) {
        throw new Error('Device was revoked by admin. Ask them to release the seat first.')
      }
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        label: args.label ?? existing.label,
      })
      return { firstActivation: false }
    }

    await ctx.db.insert('licenseDevices', {
      licenseKey: args.licenseKey,
      deviceId: args.deviceId,
      platform: args.platform,
      label: args.label,
      activatedAt: now,
      lastSeenAt: now,
    })
    return { firstActivation: true }
  },
})

export const touchDevice = internalMutation({
  args: { licenseKey: v.string(), deviceId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key_device', (q) =>
        q.eq('licenseKey', args.licenseKey).eq('deviceId', args.deviceId),
      )
      .unique()

    if (!existing) return { bound: false }
    await ctx.db.patch(existing._id, { lastSeenAt: Date.now() })
    return { bound: true, revokedAt: existing.revokedAt ?? null }
  },
})

export const revokeLicenseAndDevices = internalMutation({
  args: { licenseKey: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const license = await ctx.db
      .query('licenses')
      .withIndex('by_key', (q) => q.eq('licenseKey', args.licenseKey))
      .unique()

    if (!license) {
      return { found: false, tenantId: null, revokedDevices: 0 }
    }

    await ctx.db.patch(license._id, {
      status: 'revoked',
      revokedAt: Date.now(),
      notes: args.reason
        ? (license.notes ?? '') + ` | Revoked: ${args.reason}`.trim()
        : license.notes,
    })

    const devices = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key', (q) => q.eq('licenseKey', args.licenseKey))
      .collect()

    for (const device of devices) {
      if (device.revokedAt !== undefined) continue
      await ctx.db.patch(device._id, { revokedAt: Date.now() })
    }

    return {
      found: true,
      tenantId: license.tenantId,
      revokedDevices: devices.filter((d) => d.revokedAt === undefined).length,
    }
  },
})

/**
 * Direct audit insertion from the revoke flow. Avoids requiring a tenant-admin
 * auth context (revoke is run by the platform superadmin, possibly without
 * a tenant membership themselves).
 */
export const recordAuditInternal = internalMutation({
  args: {
    tenantId: v.id('tenants'),
    action: v.string(),
    targetId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('audits', {
      tenantId: args.tenantId,
      action: args.action,
      targetId: args.targetId,
      createdAt: Date.now(),
    })
  },
})

/**
 * Revokes a single device from the seats list. Called by an admin from
 * /settings/devices on the web app.
 */
export const revokeDevice = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const member = await requireTenantMember(ctx)
    const license = await ctx.db
      .query('licenses')
      .withIndex('by_tenant', (q) => q.eq('tenantId', member.tenantId))
      .unique()
    if (!license) throw new Error('No license found for tenant.')

    const device = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key_device', (q) =>
        q.eq('licenseKey', license.licenseKey).eq('deviceId', args.deviceId),
      )
      .unique()
    if (!device) return null
    if (device.revokedAt !== undefined) return device._id

    await ctx.db.patch(device._id, { revokedAt: Date.now() })
    return device._id
  },
})

/**
 * Lists the activated devices for the caller's tenant (admin view at
 * /settings/devices). Includes revoked devices so the admin can see history.
 */
export const listDevicesForTenant = query({
  args: {},
  handler: async (ctx) => {
    const member = await requireTenantMember(ctx)
    const license = await ctx.db
      .query('licenses')
      .withIndex('by_tenant', (q) => q.eq('tenantId', member.tenantId))
      .unique()
    if (!license) return []

    const devices = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key', (q) => q.eq('licenseKey', license.licenseKey))
      .order('desc')
      .collect()

    return devices.map((device) => ({
      _id: device._id,
      deviceId: device.deviceId,
      platform: device.platform,
      label: device.label ?? null,
      activatedAt: device.activatedAt,
      lastSeenAt: device.lastSeenAt ?? null,
      revokedAt: device.revokedAt ?? null,
    }))
  },
})

/**
 * Lists the licenses for the tenant (admin view; today one-per-tenant).
 */
export const listLicensesForTenant = query({
  args: {},
  handler: async (ctx) => {
    const member = await requireTenantMember(ctx)
    const licenses = await ctx.db
      .query('licenses')
      .withIndex('by_tenant', (q) => q.eq('tenantId', member.tenantId))
      .order('desc')
      .collect()
    return licenses.map((license) => ({
      _id: license._id,
      licenseKey: license.licenseKey,
      plan: license.plan,
      seats: license.seats,
      status: license.status,
      issuedAt: license.issuedAt,
      revokedAt: license.revokedAt ?? null,
      saleRef: license.saleRef ?? null,
      notes: license.notes ?? null,
    }))
  },
})
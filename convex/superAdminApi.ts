import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { mutation, query } from './_generated/server'
import { requireSuperAdmin } from './tenantHelpers'

// ────────────────────────────────────────────────────────────────────────
// QUERIES
// ────────────────────────────────────────────────────────────────────────

type Plan = 'standard' | 'office' | 'pro'
type LicenseStatus = 'active' | 'revoked'

type TenantWithStats = {
  _id: Id<'tenants'>
  name: string
  slug: string
  subdomain: string
  plan: Plan
  createdAt: number
  licenseStatus: LicenseStatus | null
  licenseKey: string | null
  licenseCount: number
  seats: number
  memberCount: number
  deviceCount: number
  fileCount: number
}

/**
 * Lists every tenant with rolled-up stats for the superadmin tenants page.
 * Optional `search` filters by name/slug/subdomain/admin email (case-insensitive
 * substring match).
 */
export const listTenants = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx)

    const tenants = await ctx.db.query('tenants').order('desc').collect()
    const search = args.search?.trim().toLowerCase()

    let filtered = tenants
    if (search) {
      const matchingMemberTenantIds = new Set(
        (
          await ctx.db
            .query('tenantMembers')
            .withIndex('by_invited_email', (q) => q.eq('invitedEmail', search))
            .collect()
        ).map((m) => m.tenantId),
      )
      filtered = tenants.filter((t) => {
        return (
          t.name.toLowerCase().includes(search) ||
          t.slug.toLowerCase().includes(search) ||
          t.subdomain.toLowerCase().includes(search) ||
          matchingMemberTenantIds.has(t._id)
        )
      })
    }

    return Promise.all(filtered.map((t) => withStats(ctx, t)))
  },
})

async function withStats(ctx: Pick<QueryCtx, 'db'>, tenant: Doc<'tenants'>): Promise<TenantWithStats> {
  const licenses = await ctx.db
    .query('licenses')
    .withIndex('by_tenant', (q) => q.eq('tenantId', tenant._id))
    .collect()
  const license = licenses[0]

  let deviceCount = 0
  for (const row of licenses) {
    const devices = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key', (q) => q.eq('licenseKey', row.licenseKey))
      .collect()
    deviceCount += devices.filter((d) => d.revokedAt === undefined).length
  }

  const members = await ctx.db
    .query('tenantMembers')
    .withIndex('by_tenant', (q) => q.eq('tenantId', tenant._id))
    .filter((m) => m.neq('status', 'removed'))
    .collect()

  const files = await ctx.db
    .query('files')
    .withIndex('by_tenant_uploaded_at', (q) => q.eq('tenantId', tenant._id))
    .collect()

  return {
    _id: tenant._id,
    name: tenant.name,
    slug: tenant.slug,
    subdomain: tenant.subdomain,
    plan: tenant.plan,
    createdAt: tenant.createdAt,
    licenseStatus: license?.status ?? null,
    licenseKey: license?.licenseKey ?? null,
    licenseCount: licenses.length,
    seats: licenses.reduce((sum, row) => sum + row.seats, 0),
    memberCount: members.length,
    deviceCount,
    fileCount: files.length,
  }
}




/**
 * Returns full detail for one tenant: branding, members (with role/status),
 * licenses + devices, and the most recent 50 audit rows.
 */
export const getTenantDetail = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx)
    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) return null

    const [members, licenses, audits] = await Promise.all([
      ctx.db
        .query('tenantMembers')
        .withIndex('by_tenant', (q) => q.eq('tenantId', args.tenantId))
        .order('asc')
        .collect(),
      ctx.db
        .query('licenses')
        .withIndex('by_tenant', (q) => q.eq('tenantId', args.tenantId))
        .order('desc')
        .collect(),
      ctx.db
        .query('audits')
        .withIndex('by_tenant_created_at', (q) => q.eq('tenantId', args.tenantId))
        .order('desc')
        .take(50),
    ])

    const devicesPerLicense = await Promise.all(
      licenses.map(async (license) => {
        const devices = await ctx.db
          .query('licenseDevices')
          .withIndex('by_key', (q) => q.eq('licenseKey', license.licenseKey))
          .order('desc')
          .collect()
        return { licenseId: license._id, devices }
      }),
    )

    return {
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        subdomain: tenant.subdomain,
        plan: tenant.plan,
        createdAt: tenant.createdAt,
        branding: tenant.branding,
      },
      members: members.map((m) => ({
        _id: m._id,
        invitedEmail: m.invitedEmail,
        role: m.role,
        status: m.status,
        invitedAt: m.invitedAt,
        joinedAt: m.joinedAt ?? null,
        removedAt: m.removedAt ?? null,
        userId: m.userId ?? null,
      })),
      licenses: licenses.map((l) => ({
        _id: l._id,
        licenseKey: l.licenseKey,
        plan: l.plan,
        status: l.status,
        seats: l.seats,
        issuedAt: l.issuedAt,
        revokedAt: l.revokedAt ?? null,
        issuedBy: l.issuedBy,
        saleRef: l.saleRef ?? null,
        notes: l.notes ?? null,
        devices: devicesPerLicense.find((d) => d.licenseId === l._id)?.devices ?? [],
      })),
      audits: audits.map((a) => ({
        _id: a._id,
        action: a.action,
        targetId: a.targetId ?? null,
        actorUserId: a.actorUserId ?? null,
        createdAt: a.createdAt,
      })),
    }
  },
})

/**
 * Lists every license across all tenants for the superadmin licenses page.
 */
export const listAllLicenses = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx)
    const licenses = await ctx.db.query('licenses').order('desc').collect()
    return Promise.all(
      licenses.map(async (l) => {
        const tenant = await ctx.db.get(l.tenantId)
        const devices = await ctx.db
          .query('licenseDevices')
          .withIndex('by_key', (q) => q.eq('licenseKey', l.licenseKey))
          .collect()
        return {
          _id: l._id,
          licenseKey: l.licenseKey,
          tenantId: l.tenantId,
          tenantName: tenant?.name ?? '(deleted tenant)',
          tenantSubdomain: tenant?.subdomain ?? null,
          plan: l.plan,
          status: l.status,
          seats: l.seats,
          issuedAt: l.issuedAt,
          revokedAt: l.revokedAt ?? null,
          issuedBy: l.issuedBy,
          saleRef: l.saleRef ?? null,
          notes: l.notes ?? null,
          activeDevices: devices.filter((d) => d.revokedAt === undefined).length,
          totalDevices: devices.length,
        }
      }),
    )
  },
})

/**
 * Paginated audit log across ALL tenants. Optional filters: tenantId, action
 * substring, actor email. Superadmin-only. Returns a consistent shape with
 * `actorEmail` resolved per row (best-effort; null if the user was wiped).
 */
export const listAudits = query({
  args: {
    paginationOpts: paginationOptsValidator,
    tenantId: v.optional(v.id('tenants')),
    actionContains: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx)

    const actionContains = args.actionContains?.trim().toLowerCase()

    // Fetch candidate rows. When a tenant filter is supplied we can use the
    // tenant-scoped index; otherwise full-scan newest-first (v1 audit
    // volumes are low; add a global `by_created_at` index if this becomes
    // hot).
    let candidates: Array<Doc<'audits'>>
    if (args.tenantId) {
      candidates = await ctx.db
        .query('audits')
        .withIndex('by_tenant_created_at', (q) => q.eq('tenantId', args.tenantId!))
        .order('desc')
        .take(500)
    } else {
      candidates = await ctx.db.query('audits').order('desc').take(500)
    }

    const filtered = actionContains
      ? candidates.filter((a) => a.action.toLowerCase().includes(actionContains))
      : candidates

    // Manual cursor pagination over the filtered slice.
    const start = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0
    const slice = filtered.slice(start, start + args.paginationOpts.numItems)
    const page = await Promise.all(slice.map((a) => augmentAudit(ctx, a)))

    return {
      page,
      isDone: start + args.paginationOpts.numItems >= filtered.length,
      continueCursor: String(start + slice.length),
    }
  },
})

type AugmentedAudit = {
  _id: Id<'audits'>
  tenantId: Id<'tenants'>
  tenantName: string
  action: string
  targetId: string | null
  actorUserId: Id<'users'> | null
  actorEmail: string | null
  createdAt: number
}

async function augmentAudit(
  ctx: Pick<QueryCtx, 'db'>,
  a: Doc<'audits'>,
): Promise<AugmentedAudit> {
  let actorEmail: string | null = null
  if (a.actorUserId) {
    const user = await ctx.db.get(a.actorUserId)
    actorEmail = user?.email ?? null
  }
  const tenant = await ctx.db.get(a.tenantId)
  return {
    _id: a._id,
    tenantId: a.tenantId,
    tenantName: tenant?.name ?? '(deleted)',
    action: a.action,
    targetId: a.targetId ?? null,
    actorUserId: a.actorUserId ?? null,
    actorEmail,
    createdAt: a.createdAt,
  }
}

/**
 * Top-line numbers for the dashboard landing page.
 */
export const dashboardStats = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx)

    const [tenants, licenses, members, devices, files] = await Promise.all([
      ctx.db.query('tenants').collect(),
      ctx.db.query('licenses').collect(),
      ctx.db.query('tenantMembers').collect(),
      ctx.db.query('licenseDevices').collect(),
      ctx.db.query('files').collect(),
    ])

    const tenantsByPlan = {
      standard: tenants.filter((t) => t.plan === 'standard').length,
      office: tenants.filter((t) => t.plan === 'office').length,
      pro: tenants.filter((t) => t.plan === 'pro').length,
    }

    const seatsSold = licenses
      .filter((l) => l.status === 'active')
      .reduce((sum, l) => sum + l.seats, 0)

    const activeMembers = members.filter((m) => m.status === 'active').length
    const invitedMembers = members.filter((m) => m.status === 'invited').length

    const activeDevices = devices.filter((d) => d.revokedAt === undefined).length

    const activeLicenses = licenses.filter((l) => l.status === 'active').length
    const revokedLicenses = licenses.filter((l) => l.status === 'revoked').length

    const filesUploaded = files.length
    const filesStored = files.filter((f) => f.storageStatus === 'stored').length

    const recentAuditsRaw = await ctx.db.query('audits').order('desc').take(10)
    const recentAudits = await Promise.all(
      recentAuditsRaw.map(async (a) => {
        let actorEmail: string | null = null
        if (a.actorUserId) {
          const user = await ctx.db.get(a.actorUserId)
          actorEmail = user?.email ?? null
        }
        const tenant = await ctx.db.get(a.tenantId)
        return {
          _id: a._id,
          tenantId: a.tenantId,
          tenantName: tenant?.name ?? '(deleted)',
          action: a.action,
          targetId: a.targetId ?? null,
          actorEmail,
          createdAt: a.createdAt,
        }
      }),
    )

    return {
      tenants: tenants.length,
      tenantsByPlan,
      seatsSold,
      activeMembers,
      invitedMembers,
      activeDevices,
      totalDevices: devices.length,
      activeLicenses,
      revokedLicenses,
      filesUploaded,
      filesStored,
      recentAudits,
    }
  },
})

// ────────────────────────────────────────────────────────────────────────
// MUTATIONS
// ────────────────────────────────────────────────────────────────────────

/**
 * Superadmin override of a tenant's branding. Use to fix typos or rebrand
 * a tenant without involving their admin.
 */
export const updateTenantBranding = mutation({
  args: {
    tenantId: v.id('tenants'),
    productName: v.string(),
    accentColor: v.string(),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('Tenant not found.')

    await ctx.db.patch(args.tenantId, {
      branding: {
        ...tenant.branding,
        productName: args.productName.trim() || tenant.branding.productName,
        accentColor: args.accentColor.trim() || tenant.branding.accentColor,
      },
    })

    await ctx.db.insert('audits', {
      tenantId: args.tenantId,
      action: 'superadmin.branding.update',
      targetId: args.tenantId,
      createdAt: Date.now(),
    })

    return { ok: true, actor: identity.email ?? null }
  },
})

/**
 * Superadmin-triggered member invite for a specific tenant. Acts on behalf
 * of (or instead of) the tenant admin. Inserts a `tenantMembers` row with
 * status='invited'. Rejects if the email already has a non-removed membership
 * anywhere (v1: no multi-tenant users).
 */
export const inviteMember = mutation({
  args: {
    tenantId: v.id('tenants'),
    email: v.string(),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    const normalized = args.email.trim().toLowerCase()
    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) {
      throw new Error('A valid email is required.')
    }

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('Tenant not found.')

    const existing = await ctx.db
      .query('tenantMembers')
      .withIndex('by_invited_email', (q) => q.eq('invitedEmail', normalized))
      .filter((m) => m.neq('status', 'removed'))
      .first()
    if (existing) {
      throw new Error(
        `Email "${normalized}" already has a pending or active membership in another tenant.`,
      )
    }

    const now = Date.now()
    const id = await ctx.db.insert('tenantMembers', {
      tenantId: args.tenantId,
      role: args.role,
      status: 'invited',
      invitedEmail: normalized,
      invitedAt: now,
    })

    await ctx.db.insert('audits', {
      tenantId: args.tenantId,
      action: 'superadmin.member.invite',
      targetId: normalized,
      createdAt: now,
    })

    return { id, actor: identity.email ?? null }
  },
})

/**
 * Soft-removes a member. Sets status='removed' and removedAt=now. Preserves
 * the row for audit trail. The user record itself is not touched.
 */
export const removeMember = mutation({
  args: { memberId: v.id('tenantMembers') },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member) throw new Error('Membership not found.')

    await ctx.db.patch(args.memberId, {
      status: 'removed',
      removedAt: Date.now(),
    })

    await ctx.db.insert('audits', {
      tenantId: member.tenantId,
      action: 'superadmin.member.remove',
      targetId: member.invitedEmail,
      createdAt: Date.now(),
    })

    return { ok: true, actor: identity.email ?? null }
  },
})

/**
 * Toggles a member between admin and member. Superadmin-only variant of the
 * tenant-admin role change.
 */
export const changeMemberRole = mutation({
  args: {
    memberId: v.id('tenantMembers'),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member) throw new Error('Membership not found.')

    await ctx.db.patch(args.memberId, { role: args.role })

    await ctx.db.insert('audits', {
      tenantId: member.tenantId,
      action: 'superadmin.member.role',
      targetId: `${member.invitedEmail} → ${args.role}`,
      createdAt: Date.now(),
    })

    return { ok: true, actor: identity.email ?? null }
  },
})

/**
 * Revokes a license and all bound devices. Mirrors the existing HTTP
 * `/license/revoke` route but as a UI-friendly mutation. Records an audit
 * entry against the tenant.
 */
export const revokeLicense = mutation({
  args: {
    licenseKey: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)

    const license = await ctx.db
      .query('licenses')
      .withIndex('by_key', (q) => q.eq('licenseKey', args.licenseKey))
      .unique()
    if (!license) throw new Error('License not found.')

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

    await ctx.db.insert('audits', {
      tenantId: license.tenantId,
      action: 'license.revoke',
      targetId: args.licenseKey,
      createdAt: Date.now(),
    })

    return {
      revoked: true,
      tenantId: license.tenantId,
      revokedDevices: devices.filter((d) => d.revokedAt === undefined).length,
      actor: identity.email ?? null,
    }
  },
})

/**
 * Revokes a single device under a license. Superadmin variant of the
 * tenant-admin `licenses:revokeDevice` mutation.
 */
export const revokeDevice = mutation({
  args: {
    licenseKey: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    const device = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key_device', (q) =>
        q.eq('licenseKey', args.licenseKey).eq('deviceId', args.deviceId),
      )
      .unique()
    if (!device) throw new Error('Device not found.')
    if (device.revokedAt !== undefined) return { alreadyRevoked: true }

    await ctx.db.patch(device._id, { revokedAt: Date.now() })

    const license = await ctx.db
      .query('licenses')
      .withIndex('by_key', (q) => q.eq('licenseKey', args.licenseKey))
      .unique()

    if (license) {
      await ctx.db.insert('audits', {
        tenantId: license.tenantId,
        action: 'license.device.revoke',
        targetId: args.deviceId,
        createdAt: Date.now(),
      })
    }

    return { revoked: true, actor: identity.email ?? null }
  },
})

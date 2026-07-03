import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { mutation } from './_generated/server'
import { requireSuperAdmin } from './tenantHelpers'

const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'mail',
  'app',
  'admin',
  'blog',
  'docs',
  'status',
  'staging',
  'test',
  'demo',
  'sandbox',
  'cdn',
])

const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

const DEFAULT_ACCENT = 'oklch(0.56 0.20 254)'

/**
 * Back-office provisioning mutation. Creates a tenant + license + admin
 * invitation in one transaction.
 *
 * Access: superadmin-only. The gate is `requireSuperAdmin(ctx)` — the
 * signed-in Convex Auth identity's email must be in the `superAdmins`
 * table (or the bootstrap failsafe allowlist). The legacy `bunx convex run
 * provisioning:provision` CLI path still works because the CLI runs with a
 * Convex Auth identity — if the operator's email is a superadmin, the gate
 * passes; otherwise it throws.
 *
 * Idempotent on `subdomain`: re-running with the same subdomain is an error
 * to prevent duplicate sales. Pass `--force` in the JSON to retune branding
 * / seats on an existing tenant without re-issuing rows (planned for Phase G).
 */
export const provision = mutation({
  args: {
    name: v.string(),
    subdomain: v.string(),
    plan: v.union(
      v.literal('standard'),
      v.literal('office'),
      v.literal('pro'),
    ),
    seats: v.number(),
    licenseKey: v.optional(v.string()),
    adminEmail: v.string(),
    saleRef: v.optional(v.string()),
    notes: v.optional(v.string()),
    issuedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    validateArgs(args)

    // Reject duplicate subdomains.
    const existingTenant = await ctx.db
      .query('tenants')
      .withIndex('by_subdomain', (q) => q.eq('subdomain', args.subdomain))
      .unique()
    if (existingTenant) {
      throw new Error(`Subdomain "${args.subdomain}" is already provisioned.`)
    }

    const slug = args.subdomain
    const now = Date.now()
    const productName = args.name.trim()

    const tenantId: Id<'tenants'> = await ctx.db.insert('tenants', {
      name: productName,
      slug,
      subdomain: args.subdomain,
      plan: args.plan,
      createdAt: now,
      branding: {
        productName,
        accentColor: DEFAULT_ACCENT,
      },
    })

    const licenseKey = (args.licenseKey ?? generateLicenseKey()).toUpperCase()
    const existingLicense = await ctx.db
      .query('licenses')
      .withIndex('by_key', (q) => q.eq('licenseKey', licenseKey))
      .unique()
    if (existingLicense) throw new Error(`License key ${licenseKey} already exists.`)

    await ctx.db.insert('licenses', {
      licenseKey,
      tenantId,
      plan: args.plan,
      status: 'active',
      seats: args.seats,
      issuedAt: now,
      issuedBy: args.issuedBy ?? 'provision.mjs',
      saleRef: args.saleRef,
      notes: args.notes,
    })

    const normalizedEmail = args.adminEmail.trim().toLowerCase()
    const existingInvite = await ctx.db
      .query('tenantMembers')
      .withIndex('by_invited_email', (q) => q.eq('invitedEmail', normalizedEmail))
      .first()
    if (existingInvite) {
      // A single email can only be admin of one tenant in v1 (no multi-tenant users).
      throw new Error(
        `Email "${normalizedEmail}" already has a pending or active invitation to another tenant.`,
      )
    }
    await ctx.db.insert('tenantMembers', {
      tenantId,
      role: 'admin',
      status: 'invited',
      invitedEmail: normalizedEmail,
      invitedAt: now,
    })

    await ctx.db.insert('audits', {
      tenantId,
      actorUserId: undefined,
      action: 'superadmin.provision',
      targetId: licenseKey,
      createdAt: now,
    })

    return {
      licenseKey,
      tenantId,
      subdomain: args.subdomain,
      adminEmail: normalizedEmail,
      plan: args.plan,
      seats: args.seats,
      actor: identity.email?.trim().toLowerCase() ?? null,
    }
  },
})

function validateArgs(args: {
  name: string
  subdomain: string
  plan: string
  seats: number
  adminEmail: string
}) {
  if (!args.name.trim()) throw new Error('--name is required.')
  if (!SUBDOMAIN_PATTERN.test(args.subdomain)) {
    throw new Error('--subdomain must be 3-32 chars lowercase a-z0-9 with hyphens.')
  }
  if (RESERVED_SUBDOMAINS.has(args.subdomain)) {
    throw new Error(`Subdomain "${args.subdomain}" is reserved.`)
  }
  if (!Number.isInteger(args.seats) || args.seats < 1) {
    throw new Error('--seats must be a positive integer.')
  }
  if (!/^\S+@\S+\.\S+$/.test(args.adminEmail.trim())) {
    throw new Error('--admin-email must be a valid email address.')
  }
}

/**
 * Crockford base32 license key generator. Avoids ambiguous chars (0/O/1/I/L/U).
 * 24 chars + 5 hyphens = 30 chars total: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
 */
function generateLicenseKey(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXZ'
  const bytes = new Uint8Array(24)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  let raw = ''
  for (let i = 0; i < bytes.length; i += 1) raw += alphabet[bytes[i] % alphabet.length]
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 24)}`
}

/**
 * Superadmin-only teardown: completely removes a tenant including its
 * licenses, devices, members, files, audit rows, share recipients, sync
 * states. Makes end-to-end re-provisioning simple.
 *
 * Access: superadmin-only via `requireSuperAdmin(ctx)`. The CLI path
 * (`bunx convex run provisioning:wipeTenantBySubdomain`) still works for
 * the operator whose email is a superadmin.
 *
 * Passes a confirmation string `confirm: "wipe:<subdomain>"` to prevent
 * accidental wipes via copy-paste typos.
 */
export const wipeTenantBySubdomain = mutation({
  args: {
    subdomain: v.string(),
    confirm: v.string(),
  },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    const expected = `wipe:${args.subdomain}`
    if (args.confirm !== expected) {
      throw new Error(`Confirmation mismatch. Pass --confirm='${expected}'.`)
    }

    const tenant = await ctx.db
      .query('tenants')
      .withIndex('by_subdomain', (q) => q.eq('subdomain', args.subdomain))
      .unique()
    if (!tenant) return { wiped: false, reason: 'No such tenant.' }

    const { _id: tenantId } = tenant

    // Wipe related rows in dependency order.
    const licenses = await ctx.db
      .query('licenses')
      .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
      .collect()
    for (const row of licenses) {
      const devices = await ctx.db
        .query('licenseDevices')
        .withIndex('by_key', (q) => q.eq('licenseKey', row.licenseKey))
        .collect()
      for (const device of devices) await ctx.db.delete(device._id)
      await ctx.db.delete(row._id)
    }

    const memberRows = await ctx.db
      .query('tenantMembers')
      .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
      .collect()
    for (const row of memberRows) await ctx.db.delete(row._id)

    const fileRows = await ctx.db
      .query('files')
      .withIndex('by_tenant_uploaded_at', (q) => q.eq('tenantId', tenantId))
      .collect()
    for (const row of fileRows) await ctx.db.delete(row._id)

    const shareRows = await ctx.db
      .query('shareRecipients')
      .withIndex('by_tenant_email', (q) => q.eq('tenantId', tenantId))
      .collect()
    for (const row of shareRows) await ctx.db.delete(row._id)

    const syncRows = await ctx.db
      .query('deviceSyncStates')
      .withIndex('by_tenant_device_id', (q) => q.eq('tenantId', tenantId))
      .collect()
    for (const row of syncRows) await ctx.db.delete(row._id)

    const integrationRows = await ctx.db
      .query('tenantIntegrations')
      .withIndex('by_tenant_provider', (q) => q.eq('tenantId', tenantId))
      .collect()
    for (const row of integrationRows) await ctx.db.delete(row._id)

    const auditRows = await ctx.db
      .query('audits')
      .withIndex('by_tenant_created_at', (q) => q.eq('tenantId', tenantId))
      .collect()
    for (const row of auditRows) await ctx.db.delete(row._id)

    // Clean up orphaned users whose only membership was this tenant.
    // (v1 has no multi-tenant users, so any user admin-email-matching this
    // tenant and no other tenantMembers row can be safely removed.)
    for (const member of memberRows) {
      if (!member.userId) continue
      const otherMemberships = await ctx.db
        .query('tenantMembers')
        .withIndex('by_user', (q) => q.eq('userId', member.userId!))
        .collect()
      const hasOtherActiveMembership = otherMemberships.some(
        (row) => row._id !== member._id && row.tenantId !== tenantId,
      )
      if (!hasOtherActiveMembership) {
        await ctx.db.delete(member.userId!)
      }
    }

    await ctx.db.delete(tenantId)
    return { wiped: true, tenantId, actor: identity.email?.trim().toLowerCase() ?? null }
  },
})
import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { mutation, query } from './_generated/server'
import { requireTenantAdmin, requireTenantMember } from './tenantHelpers'

/**
 * Tenant-admin member management. Called from the in-app /settings/members
 * page (apps/web) — NOT the superadmin panel. Every function is scoped to
 * the caller's own tenant via `requireTenantAdmin`.
 */

/**
 * Lists all members of the caller's tenant (admins see invited + active +
 * removed). For v1, there is exactly one tenant per signed-in user.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireTenantAdmin(ctx)
    const members = await ctx.db
      .query('tenantMembers')
      .withIndex('by_tenant', (q) => q.eq('tenantId', admin.tenantId))
      .order('asc')
      .collect()

    return members.map((m) => ({
      _id: m._id as Id<'tenantMembers'>,
      invitedEmail: m.invitedEmail,
      role: m.role,
      status: m.status,
      invitedAt: m.invitedAt,
      joinedAt: m.joinedAt ?? null,
      removedAt: m.removedAt ?? null,
      isSelf: m.userId === admin.membership.userId || m.invitedEmail === admin.identity.email,
    }))
  },
})

/**
 * Invites a new member to the caller's tenant. Rejects:
 *  - invalid email
 *  - email already has a non-removed membership anywhere (v1: no
 *    multi-tenant users)
 *  - active member count would exceed the license seat cap (admins +
 *    members count against seats)
 */
export const invite = mutation({
  args: {
    email: v.string(),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const admin = await requireTenantAdmin(ctx)
    const normalized = args.email.trim().toLowerCase()
    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) {
      throw new Error('A valid email is required.')
    }

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

    // Seat enforcement: count non-removed members for this tenant and
    // compare against the license seat cap.
    const license = await ctx.db
      .query('licenses')
      .withIndex('by_tenant', (q) => q.eq('tenantId', admin.tenantId))
      .first()
    if (license && license.status === 'active') {
      const members = await ctx.db
        .query('tenantMembers')
        .withIndex('by_tenant', (q) => q.eq('tenantId', admin.tenantId))
        .filter((m) => m.neq('status', 'removed'))
        .collect()
      if (members.length >= license.seats) {
        throw new Error(
          `Seat limit reached (${license.seats}). Remove a member or ask the licensor to raise the seat count.`,
        )
      }
    }

    const now = Date.now()
    const id = await ctx.db.insert('tenantMembers', {
      tenantId: admin.tenantId,
      role: args.role,
      status: 'invited',
      invitedEmail: normalized,
      invitedAt: now,
    })

    await ctx.db.insert('audits', {
      tenantId: admin.tenantId,
      actorUserId: admin.membership.userId,
      action: 'member.invite',
      targetId: normalized,
      createdAt: now,
    })

    return { id }
  },
})

/**
 * Soft-removes a member from the caller's tenant. Admin cannot remove
 * themselves (use the superadmin panel for force-remove). Preserves the
 * row for audit trail.
 */
export const remove = mutation({
  args: { memberId: v.id('tenantMembers') },
  handler: async (ctx, args) => {
    const admin = await requireTenantAdmin(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member || member.tenantId !== admin.tenantId) {
      throw new Error('Membership not found in your tenant.')
    }
    if (member.invitedEmail === admin.identity.email?.trim().toLowerCase()) {
      throw new Error('You cannot remove yourself. Ask another admin or the platform operator.')
    }

    await ctx.db.patch(args.memberId, {
      status: 'removed',
      removedAt: Date.now(),
    })

    await ctx.db.insert('audits', {
      tenantId: admin.tenantId,
      actorUserId: admin.membership.userId,
      action: 'member.remove',
      targetId: member.invitedEmail,
      createdAt: Date.now(),
    })

    return { ok: true }
  },
})

/**
 * Toggles a member's role between admin and member. Admin cannot demote
 * themselves (use another admin or the superadmin panel).
 */
export const changeRole = mutation({
  args: {
    memberId: v.id('tenantMembers'),
    role: v.union(v.literal('admin'), v.literal('member')),
  },
  handler: async (ctx, args) => {
    const admin = await requireTenantAdmin(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member || member.tenantId !== admin.tenantId) {
      throw new Error('Membership not found in your tenant.')
    }
    if (member.invitedEmail === admin.identity.email?.trim().toLowerCase()) {
      throw new Error('You cannot change your own role. Ask another admin.')
    }

    await ctx.db.patch(args.memberId, { role: args.role })

    await ctx.db.insert('audits', {
      tenantId: admin.tenantId,
      actorUserId: admin.membership.userId,
      action: 'member.role',
      targetId: `${member.invitedEmail} → ${args.role}`,
      createdAt: Date.now(),
    })

    return { ok: true }
  },
})

/**
 * Resends the invitation for a member who hasn't signed in yet. In v1 this
 * just bumps `invitedAt` so the admin can see "re-invited at" in the UI;
 * the actual email isn't sent (Convex Auth's Password provider doesn't
 * send email — the user signs up with the invited email directly).
 */
export const resendInvite = mutation({
  args: { memberId: v.id('tenantMembers') },
  handler: async (ctx, args) => {
    const admin = await requireTenantAdmin(ctx)
    const member = await ctx.db.get(args.memberId)
    if (!member || member.tenantId !== admin.tenantId) {
      throw new Error('Membership not found in your tenant.')
    }
    if (member.status !== 'invited') {
      throw new Error('Only pending invitations can be re-sent.')
    }

    await ctx.db.patch(args.memberId, { invitedAt: Date.now() })

    await ctx.db.insert('audits', {
      tenantId: admin.tenantId,
      actorUserId: admin.membership.userId,
      action: 'member.resend_invite',
      targetId: member.invitedEmail,
      createdAt: Date.now(),
    })

    return { ok: true }
  },
})

/**
 * Member-facing: returns the caller's own tenant's seat usage so the
 * /settings/members page can show "3 / 5 seats used".
 */
export const seatUsage = query({
  args: {},
  handler: async (ctx) => {
    const member = await requireTenantMember(ctx)
    const license = await ctx.db
      .query('licenses')
      .withIndex('by_tenant', (q) => q.eq('tenantId', member.tenantId))
      .first()
    const members = await ctx.db
      .query('tenantMembers')
      .withIndex('by_tenant', (q) => q.eq('tenantId', member.tenantId))
      .filter((m) => m.neq('status', 'removed'))
      .collect()
    return {
      seats: license?.seats ?? 0,
      used: members.length,
      licenseStatus: license?.status ?? 'active',
    }
  },
})

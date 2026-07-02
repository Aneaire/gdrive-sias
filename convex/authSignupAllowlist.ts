import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

const normalizeEmail = (email: unknown) => String(email ?? '').trim().toLowerCase()

/**
 * Replaces the legacy `createOrUpdateAllowedUser` callback.
 *
 * Sign-up is no longer allowlist-gated. Instead a user joins a tenant only if
 * there is a pending `tenantMembers` row with `status==='invited'` matching
 * their email (pre-provisioned by `npm run provision` or an admin invite).
 *
 * On first sign-in we set `tenantMembers.status='active'`, `userId`, and
 * `joinedAt`. Without an invitation we throw a helpful "ask your admin"
 * message — no open signup; sales are not self-service.
 */
export async function createOrUpdateInvitedUser(
  ctx: Pick<MutationCtx, 'db'>,
  args: {
    existingUserId: Id<'users'> | null
    profile: { email?: unknown }
    profileInput?: { email?: unknown }
  },
) {
  const email = normalizeEmail(args.profile.email ?? args.profileInput?.email)
  if (!email) throw new Error('Enter a valid email address.')

  // Look up the pending invitation BEFORE re-using an existing user record.
  // This must run even when `existingUserId` is set, because a wiped tenant
  // may have left an orphaned `users` row while a fresh seed created a new
  // `tenantMembers.invited` row for the same email.
  const invitation = await ctx.db
    .query('tenantMembers')
    .withIndex('by_invited_email', (q) => q.eq('invitedEmail', email))
    .filter((m) => m.eq('status', 'invited'))
    .first()

  if (!invitation) {
    // Re-use an existing user only if they already have an ACTIVE membership
    // (so we don't bypass the invitation gate on a stale orphaned row).
    const existingUserId = args.existingUserId
    if (existingUserId) {
      const activeMembership = await ctx.db
        .query('tenantMembers')
        .withIndex('by_user', (q) => q.eq('userId', existingUserId))
        .filter((m) => m.eq('status', 'active'))
        .first()
      if (activeMembership) return existingUserId
    }
    throw new Error(
      'No invitation found for this email. Ask your admin to invite you, ' +
        'or use the invite link in the email you received.',
    )
  }

  // Resolve the user record: prefer the caller-supplied existingUserId,
  // then any user with the same email, otherwise insert a fresh row.
  const userId: Id<'users'> =
    args.existingUserId ??
    (await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .unique())?._id ??
    (await ctx.db.insert('users', { email }))

  // If the invitation already has a userId matching this user, no patch needed.
  if (invitation.userId === userId) return userId

  await ctx.db.patch(invitation._id, {
    userId,
    status: 'active',
    joinedAt: Date.now(),
  })

  return userId
}
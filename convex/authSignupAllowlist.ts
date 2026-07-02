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
  if (args.existingUserId) return args.existingUserId

  const email = normalizeEmail(args.profile.email ?? args.profileInput?.email)
  if (!email) throw new Error('Enter a valid email address.')

  const invitation = await ctx.db
    .query('tenantMembers')
    .withIndex('by_invited_email', (q) => q.eq('invitedEmail', email))
    .filter((m) => m.eq('status', 'invited'))
    .first()

  if (!invitation) {
    throw new Error(
      'No invitation found for this email. Ask your admin to invite you, ' +
        'or use the invite link in the email you received.',
    )
  }

  const existingUser = await ctx.db
    .query('users')
    .withIndex('email', (q) => q.eq('email', email))
    .unique()

  const userId: Id<'users'> =
    existingUser?._id ?? await ctx.db.insert('users', { email })

  await ctx.db.patch(invitation._id, {
    userId,
    status: 'active',
    joinedAt: Date.now(),
  })

  return userId
}
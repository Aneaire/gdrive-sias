import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

import { isSuperAdminEmail } from './superAdmins'

/**
 * Thrown when the caller has no Convex Auth identity (not signed in).
 */
export class AuthRequiredError extends Error {
  constructor() {
    super('Not authenticated.')
    this.name = 'AuthRequiredError'
  }
}

/**
 * Thrown when the signed-in user is not a member of any tenant.
 */
export class TenantMembershipRequiredError extends Error {
  constructor() {
    super('You are not a member of any tenant. Ask your admin to invite you.')
    this.name = 'TenantMembershipRequiredError'
  }
}

/**
 * Thrown when the caller is a tenant member but not an admin.
 */
export class TenantAdminRequiredError extends Error {
  constructor() {
    super('Tenant admin access required.')
    this.name = 'TenantAdminRequiredError'
  }
}

/**
 * Thrown when the caller's license has been revoked.
 */
export class LicenseRevokedError extends Error {
  constructor(licenseKey: string) {
    super(`License ${licenseKey} is revoked. Contact support.`)
    this.name = 'LicenseRevokedError'
  }
}

/**
 * Thrown when activating against a tenant whose Google Drive is not connected.
 * Surfaced in the UI as "Connect your Google Drive in Settings → Integrations."
 */
export class DriveNotConnectedError extends Error {
  constructor() {
    super('Google Drive is not connected. Connect it in Settings → Integrations.')
    this.name = 'DriveNotConnectedError'
  }
}

export type TenantMembership = {
  identity: NonNullable<Awaited<ReturnType<QueryCtx['auth']['getUserIdentity']>>>
  tenantId: Id<'tenants'>
  role: 'admin' | 'member'
  membership: Doc<'tenantMembers'>
}

/**
 * Minimal structural context for tenant helpers — accepts QueryCtx, MutationCtx,
 * or ActionCtx (each has `auth` and a database reader/writer assignable to
 * `DatabaseReader`). The Pick keeps helper signatures clean and avoids the
 * distributive-union collapse that strips `.query()` typing off `ctx.db`.
 */
type AuthedCtx = Pick<QueryCtx, 'auth' | 'db'>

/**
 * Resolves the caller's Auth identity. Throws AuthRequiredError if none.
 */
export async function requireUserIdentity(ctx: AuthedCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new AuthRequiredError()
  return identity
}

/**
 * Resolves the caller's Convex Auth identity and verifies the corresponding
 * email is in {@link isSuperAdminEmail}. Used to gate `/license/revoke` and
 * other platform-level back-office forms. Does NOT require the superadmin
 * to be a member of any tenant.
 */
export async function requireSuperAdmin(ctx: AuthedCtx) {
  const identity = await requireUserIdentity(ctx)
  const email = identity.email?.trim().toLowerCase()
  if (!isSuperAdminEmail(email)) {
    throw new Error('Superadmin access required.')
  }
  return { identity, email: email! }
}

export function isAuthRequiredError(error: unknown) {
  return error instanceof AuthRequiredError
}

/**
 * Looks up the tenant membership for a signed-in user.
 * Returns the first active membership (v1 does not support multi-tenant users).
 */
async function getActiveMembership(ctx: AuthedCtx) {
  const identity = await requireUserIdentity(ctx)
  const directEmail = identity.email?.trim().toLowerCase()
  if (!directEmail) throw new TenantMembershipRequiredError()

  const userByEmail = await ctx.db
    .query('users')
    .withIndex('email', (q) => q.eq('email', directEmail))
    .unique()

  const userId = userByEmail?._id

  const membership =
    userId
      ? await ctx.db
          .query('tenantMembers')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .filter((m) => m.eq('status', 'active'))
          .first()
      : null

  if (!membership) {
    const invitedByEmail = await ctx.db
      .query('tenantMembers')
      .withIndex('by_invited_email', (q) => q.eq('invitedEmail', directEmail))
      .filter((m) => m.eq('status', 'active'))
      .first()

    if (!invitedByEmail) throw new TenantMembershipRequiredError()
    return { identity, membership: invitedByEmail }
  }

  return { identity, membership }
}

/**
 * Resolves the caller's tenant membership. Every data-scoped query/mutation/action
 * calls this and uses the returned tenantId to filter rows.
 */
export async function requireTenantMember(ctx: AuthedCtx): Promise<TenantMembership> {
  const { identity, membership } = await getActiveMembership(ctx)
  return {
    identity,
    tenantId: membership.tenantId,
    role: membership.role,
    membership,
  }
}

/**
 * Like {@link requireTenantMember} but enforces role === 'admin'.
 * Use for invite/revoke/branding actions.
 */
export async function requireTenantAdmin(ctx: AuthedCtx): Promise<TenantMembership> {
  const member = await requireTenantMember(ctx)
  if (member.role !== 'admin') throw new TenantAdminRequiredError()
  return member
}

/**
 * Verifies the caller's license is still active for the tenant.
 * Call this from data-scoped mutations to enforce revocation even if a
 * tampered client skips the local /license/validate check.
 *
 * Pass an optional deviceId to verify the device is bound + non-revoked.
 */
export async function requireLicenseActive(
  ctx: AuthedCtx,
  deviceId?: string,
): Promise<TenantMembership & { license: Doc<'licenses'> }> {
  const member = await requireTenantMember(ctx)
  const license = await ctx.db
    .query('licenses')
    .withIndex('by_tenant', (q) => q.eq('tenantId', member.tenantId))
    .first()

  if (!license || license.status === 'revoked') {
    throw new LicenseRevokedError(license?.licenseKey ?? '')
  }

  if (deviceId) {
    const device = await ctx.db
      .query('licenseDevices')
      .withIndex('by_key_device', (q) =>
        q.eq('licenseKey', license.licenseKey).eq('deviceId', deviceId),
      )
      .unique()

    if (device?.revokedAt !== undefined) {
      throw new Error('Device revoked by admin. Ask your admin to release a seat.')
    }
  }

  return { ...member, license }
}
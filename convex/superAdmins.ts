import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import { mutation, query } from './_generated/server'
import { requireSuperAdmin, resolveEmailFromSubject } from './tenantHelpers'

/**
 * Failsafe allowlist. These emails are always treated as superadmins, even
 * if the `superAdmins` table is empty (e.g. before bootstrap or after a
 * catastrophic wipe). This guarantees the platform operator can never lock
 * themselves out of the admin panel — they can always sign in and re-seed
 * the table.
 *
 * To add more bootstrap operators, edit this list and redeploy. For runtime
 * operator management, use the admin panel (superAdmins:add / superAdmins:remove).
 */
const BOOTSTRAP_SUPER_ADMIN_EMAILS = new Set<string>([
  'aneaire010@gmail.com',
])

type DbCtx = Pick<QueryCtx, 'db'>

/**
 * Returns true if `email` is a superadmin. Checks the `superAdmins` table
 * first, then falls back to {@link BOOTSTRAP_SUPER_ADMIN_EMAILS} as a
 * failsafe. Case-insensitive.
 */
export async function isSuperAdminEmail(
  ctx: DbCtx,
  email: string | undefined | null,
): Promise<boolean> {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false

  const row = await ctx.db
    .query('superAdmins')
    .withIndex('by_email', (q) => q.eq('email', normalized))
    .unique()
  if (row) return true

  return BOOTSTRAP_SUPER_ADMIN_EMAILS.has(normalized)
}

/**
 * Lists every superadmin (table rows). Does NOT include bootstrap-only
 * operators who aren't in the table — those are an implicit failsafe and
 * shouldn't clutter the admin UI.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx)
    const rows = await ctx.db.query('superAdmins').order('asc').collect()
    return rows.map((row) => ({
      _id: row._id,
      email: row.email,
      addedAt: row.addedAt,
      addedBy: row.addedBy,
    }))
  },
})

/**
 * Returns whether the *currently signed-in* user is a superadmin. Never
 * throws — returns `false` if unauthenticated or not a superadmin. Used by
 * the admin panel's `_authenticated` layout to gate the UI without
 * surfacing error toasts.
 */
export const currentStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return { signedIn: false, isSuperAdmin: false, email: null }

    // Convex Auth's Password provider doesn't include email in the JWT;
    // the subject format is `userId|accountId`. The first part is the
    // users table ID — use it to look up the email.
    let email = identity.email?.trim().toLowerCase() ?? null
    if (!email) {
      email = await resolveEmailFromSubject(ctx, identity.subject)
    }

    if (!email) return { signedIn: true, isSuperAdmin: false, email: null }
    const isSuperAdmin = await isSuperAdminEmail(ctx, email)
    return { signedIn: true, isSuperAdmin, email }
  },
})

/**
 * One-shot bootstrap. Inserts the bootstrap email into `superAdmins` so the
 * operator is no longer relying on the failsafe alone. Idempotent: re-running
 * on an already-seeded email is a no-op. Callable only via `bunx convex run
 * superAdmins:bootstrap` — the CLI privilege IS the auth (same model as
 * `provisioning:provision`).
 *
 * Usage:
 *   bunx convex run superAdmins:bootstrap '{"email":"you@example.com"}'
 */
export const bootstrap = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const normalized = args.email.trim().toLowerCase()
    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) {
      throw new Error('A valid email is required.')
    }
    const existing = await ctx.db
      .query('superAdmins')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .unique()
    if (existing) return { id: existing._id, email: normalized, alreadyExisted: true }
    const id = await ctx.db.insert('superAdmins', {
      email: normalized,
      addedAt: Date.now(),
      addedBy: 'bootstrap',
    })
    return { id, email: normalized, alreadyExisted: false }
  },
})

/**
 * Adds a superadmin. Superadmin-only. Cannot add an email that's already
 * a superadmin.
 */
export const add = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    const normalized = args.email.trim().toLowerCase()
    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) {
      throw new Error('A valid email is required.')
    }
    const existing = await ctx.db
      .query('superAdmins')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .unique()
    if (existing) throw new Error(`${normalized} is already a superadmin.`)
    const id = await ctx.db.insert('superAdmins', {
      email: normalized,
      addedAt: Date.now(),
      addedBy: identity.email?.trim().toLowerCase() ?? 'unknown',
    })
    return { id, email: normalized }
  },
})

/**
 * Removes a superadmin. Superadmin-only. A superadmin cannot remove
 * themselves (prevents accidental self-lockout). Bootstrap-only operators
 * remain superadmins regardless of the table state.
 */
export const remove = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const { identity } = await requireSuperAdmin(ctx)
    const normalized = args.email.trim().toLowerCase()
    const selfEmail = identity.email?.trim().toLowerCase()
    if (normalized === selfEmail) {
      throw new Error('You cannot remove yourself as a superadmin.')
    }
    const existing = await ctx.db
      .query('superAdmins')
      .withIndex('by_email', (q) => q.eq('email', normalized))
      .unique()
    if (!existing) return { removed: false, reason: 'No such superadmin.' }
    await ctx.db.delete(existing._id)
    return { removed: true, email: normalized }
  },
})

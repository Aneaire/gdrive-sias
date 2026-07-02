/**
 * v1 superadmin allowlist (hardcoded by email).
 *
 * `requireSuperAdmin(ctx)` gates /license/revoke and other back-office
 * mutations. Add more addresses here as staff grow. Swap for a `superAdmins`
 * table later if needed.
 *
 * The first entry is the seeded superadmin per the Phase A decisions doc.
 */
export const SUPER_ADMIN_EMAILS = new Set<string>([
  'aneaire010@gmail.com',
])

export function isSuperAdminEmail(email: string | undefined | null): boolean {
  if (!email) return false
  return SUPER_ADMIN_EMAILS.has(email.trim().toLowerCase())
}
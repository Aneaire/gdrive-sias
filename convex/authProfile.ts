type PasswordProfileParams = Record<string, unknown>

/**
 * Convex Auth `profile` callback for the Password provider.
 *
 * On the packaged branch we accept ANY valid email (not Gmail-only), because
 * buyers use company addresses like admin@acme.example. The scoped
 * tenant-join logic lives in `authSignupAllowlist.ts` (kept named after the
 * legacy file for muscle memory; renamed concept = "invitation accept").
 */
export function passwordProfile(params: PasswordProfileParams) {
  const email = String(params.email ?? '').trim().toLowerCase()

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('Enter a valid email address.')
  }

  return { email }
}
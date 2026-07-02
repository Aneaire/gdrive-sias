import { Password } from '@convex-dev/auth/providers/Password'
import { convexAuth } from '@convex-dev/auth/server'

import { passwordProfile } from './authProfile'
import { createOrUpdateInvitedUser } from './authSignupAllowlist'

/**
 * Convex Auth configuration for the packaged product.
 *
 * - Password provider (any valid email — see `authProfile.ts`)
 * - Google OAuth provider added for one-tap sign-in (Phase E)
 *
 * `createOrUpdateUser` joins the caller to the tenant whose `tenantMembers`
 * row matches their email (invitation-based — no open signup).
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: passwordProfile,
    }),
  ],
  callbacks: {
    createOrUpdateUser: createOrUpdateInvitedUser,
  },
})
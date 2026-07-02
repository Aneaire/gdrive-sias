# Auth

The current code has three auth-related restrictions baked in. All three are removed/replaced on the packaged branch.

## Restriction 1: Gmail-only signup

### Today
`convex/authProfile.ts`:
```
if (!/^\S+@gmail\.com$/.test(email)) {
  throw new Error('Enter a valid Gmail address ending in @gmail.com.')
}
```

### Packaged
Accept any valid email:
```
const email = String(params.email ?? '').trim().toLowerCase()
if (!/^\S+@\S+\.\S+$/.test(email)) {
  throw new Error('Enter a valid email address.')
}
return { email }
```

Rationale: buyers may use company email addresses (`admin@acme.example`), not Gmail. The product is sold outside the original RIELAN office.

## Restriction 2: Allowlist-gated signup

### Today
`convex/authSignupAllowlist.ts` rejects new accounts unless the email is already in the `shareRecipients` table — i.e. an admin (the bootstrap owner) must preemptively add Gmail addresses.

### Packaged
Replace `createOrUpdateAllowedUser` with `acceptTenantInviteOrDeny`:

```ts
export async function createOrUpdateUser(ctx, { existingUserId, profile, profileInput }) {
  if (existingUserId) return existingUserId  // already logged in before

  const email = normalizeEmail(profile.email ?? profileInput?.email)
  if (!email) throw new Error('Enter a valid email address.')

  // Look up pending invitation to any tenant
  const invitation = await ctx.db
    .query('tenantMembers')
    .withIndex('by_invited_email', (q) => q.eq('invitedEmail', email))
    .filter((m) => m.eq('status', 'invited'))
    .first()

  if (!invitation) {
    throw new Error(
      'No invitation found for this email. Ask your admin to invite you, ' +
      'or sign up using the invite link in the email you received.'
    )
  }

  // Create or reuse the user record
  const existingUser = await ctx.db
    .query('users')
    .withIndex('email', (q) => q.eq('email', email))
    .unique()
  const userId = existingUser?._id ?? await ctx.db.insert('users', { email })

  // Activate the membership
  await ctx.db.patch(invitation._id, {
    userId,
    status: 'active',
    joinedAt: Date.now(),
  })

  return userId
}
```

Signup becomes **invitation-based**, not allowlist-based. Pre-provisioning is via the `npm run provision --admin-email=...` (creates a `tenantMembers` row with status `invited`); tenant admins can also invite members at `/settings/members` (which inserts more `tenantMembers` rows).

## Restriction 3: One bootstrap owner (`aneaire010@gmail.com`)

### Today
`convex/ownership.ts:8` hardcodes `BOOTSTRAP_OWNER_EMAIL = 'aneaire010@gmail@gmail.com'` and `ownerSettings` stores a single owner email; the admin is whoever matches that email.

### Packaged
- Drop `ownerSettings` and `convex/ownership.ts` entirely.
- The "admin" concept becomes `tenantMembers.role === 'admin'`.
- The first admin is set during `npm run provision` (the `--admin-email` inserted with role `admin`).
- Admins can invite more members; they may set other members as admins.
- Transferring admin is a single-row patch on `tenantMembers.role`.

New helper (replaces `requireOwnerIdentity`) — `requireTenantAdmin(ctx)`:
```ts
async function requireTenantAdmin(ctx) {
  const membership = await requireTenantMember(ctx)
  if (membership.role !== 'admin') throw new Error('Tenant admin access required.')
  return membership
}
```

## Auto-share — retained, scoped per-tenant

`convex/shareRecipients.ts` keeps the same shape — admin adds Gmail addresses; every Drive upload auto-shares with them.

Changes:
- Add `tenantId` to the table and `by_tenant_email` index.
- Mutations require `requireTenantAdmin(ctx)` (instead of the global `requireOwnerIdentity`).
- The `internal listEmailsForUpload` query changes to accept `tenantId` and return only that tenant's recipients (the upload action already has the tenant context from `requireTenantMember`).

Auto-share is now **completely decoupled from signup** — it only drives Drive sharing, matching the feature name.

## Add Google OAuth provider

Recommended because (a) the buyer is connecting to Google Drive anyway, and (b) one-tap sign-in lowers support load (no password resets).

### `convex/auth.config.ts`

```ts
import { google } from '@convex-dev/auth/providers/Google'

export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: 'convex',
    },
    google,  // or with explicit client_id/secret env names if needed
  ],
}
```

You'll register a *separate* OAuth Client for Convex Auth (different from the Drive one — different scopes, just `email profile`).

### `convex/auth.ts`

```ts
import { Password } from '@convex-dev/auth/providers/Password'
import { google } from '@convex-dev/auth/providers/Google'

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({ profile: passwordProfile }), google],
  callbacks: { createOrUpdateUser: createOrUpdateUser /* see above */ },
})
```

### Sign-in UI

Add a "Sign in with Google" button next to the existing email/password form. Convex Auth handles the OAuth flow; after redirect, `createOrUpdateUser` runs the same tenant-join logic.

## Superadmin auth (just for you)

You need to call `/license/revoke` and run provision flows. Three options:

1. **Hardcoded allowlist** (`convex/superAdmins.ts`): an array `['you@yourdomain.com']`. `requireSuperAdmin(ctx)` checks if the caller's email is in the list.
2. **`superAdmins` table**: easier to add more staff over time.
3. **CLI-only revocation**: skip auth entirely, require the script to run server-side with the Convex deployment URL + admin key. Simplest, no auth system needed.

Recommend option 1 for v1. Anyone trying to call `/license/revoke` without being in the allowlist gets 403.

## What "signing in" looks like, end-to-end

### Desktop after activation

```
1. POST /license/activate → caches {tenantId, convexUrl, branding}
2. BrowserWindow loads bundled renderer
3. Existing Convex Auth screen renders: email/password OR "Sign in with Google"
4. User signs in → Convex Auth issues a token
5. Convex queries/mutations now run with the auth identity
6. createOrUpdateUser matches invitedEmail, joins tenant, sets status active
7. App receives stamped token; every subsequent call carries it
8. requireTenantMember(ctx) reads the identity, looks up tenantMembers, returns the membership
```

### Web (subdomain)

```
1. User navigates to https://acme.yourdomain.com
2. Subdomain resolver injects BrandingContext + Convex client
3. Unauthenticated → existing sign-in screen, branded
4. Signs in → same join flow → file command center renders, scoped to tenantId
```

### Mobile

Same as desktop. `expo-auth-session` to Google; or just email/password v1 to keep mobile scope tight.
# Phased execution

Recommended order. Each phase has a clear end-state you can verify before moving on.

## Phase A — Fresh deployment + schema (foundation)

**Goal**: A working shared Convex with multi-tenant isolation primitives. No UI changes yet.

**Tasks**:
1. Branch the monorepo at the current revision (`packaged` branch or a fresh repo).
2. Run `npx convex dev` in a new directory → spin up a fresh empty Convex deployment.
3. Add new tables from `DATA-MODEL.md`: `licenses`, `licenseDevices`, `tenants`, `tenantMembers`, `tenantIntegrations`, `audits`.
4. Add `tenantId` to `files`, `shareRecipients`, `deviceSyncStates`. Convert every index to `by_tenant_*` (compound, leading with `tenantId`).
5. Remove `ownerSettings` table and `convex/ownership.ts`. Remove `convex/authSignupAllowlist.ts`.
6. Write `convex/tenantHelpers.ts` with `requireTenantMember`, `requireTenantAdmin`, `requireLicenseActive`. Replace every `requireUserIdentity` call in data-scoped functions with `requireTenantMember`.
7. Update the schema-driven query/mutation bodies in `convex/files.ts`, `convex/shareRecipients.ts`, `convex/deviceSyncStates.ts` to filter by `tenantId`.
8. Set Convex env vars: `OAUTH_STATE_SECRET`, `ENCRYPTION_KEY` (generate 32 random bytes base64). **Remove** all legacy `GOOGLE_*` env vars from the packaged branch entirely.
9. Update `apps/web/.env.production` with the packaged `VITE_CONVEX_URL` (placeholder until deployment exists).

**Verification**:
- `npx convex deploy` succeeds with the new schema and zero functions throwing type errors.
- Manually seed one tenant + one member via a scratch script; run `files.list` as that user → only returns the tenant's files (an empty array, no crashes).
- Try calling as a user outside the tenant → 403 / "Not a member of this tenant."

**Definition of done**: A second seeded tenant cannot read the first tenant's files.

---

## Phase B — Licensing + provisioning (sale-readiness)

**Goal**: You can sell the product: run a provision script, hand the buyer a key, and they activate the desktop app.

**Tasks**:
1. Implement `/license/activate`, `/license/validate`, `/license/revoke` HTTP routes in `convex/licenseHttp.ts` (registered in `http.ts`).
2. Implement `requireSuperAdmin(ctx)` (hardcoded email list for v1).
3. Write `scripts/provision.mjs` per `LICENSING.md` — creates tenants + licenses + tenantMembers.invited row, prints the buyer-facing summary.
4. Add the desktop license first-run flow:
   - New TanStack route `/activate` (in `apps/web/src/routes/`) that the desktop shell navigates to on first launch.
   - Activation form → `POST /license/activate` → persists `{licenseKey, deviceId, tenantId, branding}` to `userData/rielan.config.json` via a preload IPC.
   - On every desktop launch: `POST /license/validate`; if revoked → render contact-support screen.
5. Wire `requireLicenseActive(ctx, deviceId)` into a few key mutations (`files.createDriveUploadRecord`, `files.createMany`) as defense-in-depth.
6. Apply branding at desktop startup: window title, accent CSS variable injected before renderer load.

**Verification**:
- Provision a fake tenant, run `/license/activate` from a script twice → second call should reject with "seat limit reached" if you set `--seats=1`.
- Revoke it via `/license/revoke` → next activate/validate fails with revoked.
- Permissions stay correct during revocation (existing tokens invalidated).

**Definition of done**: You can run the full sale→activate→revoke flow with curl/scripts, end-to-end.

---

## Phase C — Web per-tenant routing + branding

**Goal**: One web app serves N tenants at `*.yourdomain.com` with their branding.

**Tasks**:
1. Add `api.tenants.getBySubdomain(subdomain)` query (public-ish; returns only branding + slug, no secrets).
2. Implement the subdomain resolver in `apps/web/src/routes/__root.tsx`'s `beforeLoad` (apex vs subdomain branch). Use `import.meta.env.VITE_CONVEX_URL` everywhere (constant per build).
3. Add `BrandingContext` provider — applies `--blueprint`, `--blueprint-strong`, `--blueprint-soft` overrides at runtime; swaps favicon; renders logo if present.
4. Apex route group: `/`, `/pricing`, `/contact` (content can be placeholder for now).
5. New routes on subdomains only:
   - `/settings/integrations` (stub for Phase D — just renders "Google Drive — connect")
   - `/settings/members` (admin invites via `tenantMembers.insert`)
   - `/settings/devices` (admin sees license devices + can revoke)
   - `/settings/branding` (upload logo, pick accent)
6. Add a "Sign in" page on the apex that asks for a subdomain → redirects to `https://<subdomain>.yourdomain.com`.
7. Drop the existing `ConvexSetupPanel` rendering on subdomains (dev-only).

**Verification**:
- Visit `acme.localhost:3000` (or use a hosts file tweak against your Vercel preview) → branded with `acme`'s values.
- Visit `yourdomain.com` → marketing pages.
- Sign up with the invited email → joined to the tenant automatically; only see that tenant's files.

**Definition of done**: Branding resolves correctly per hostname; an unknown subdomain shows a graceful 404 page.

---

## Phase D — Connect Google Drive button

**Goal**: A tenant admin can authorize their Google Drive in one click. The existing `/drive-upload` and `/drive-download` routes use per-tenant OAuth.

**Tasks**:
1. In GCP: enable Drive API, create Web OAuth Client, add wildcard redirect URI, configure consent screen with `drive.file` scope (see `GOOGLE-DRIVE.md`).
2. Set Convex env vars: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`, `ENCRYPTION_KEY`.
3. Implement `convex/driveOauth.ts`:
   - `POST /drive-oauth/callback` HTTP route — verify state JWT, exchange code, encrypt refresh_token, create root folder, upsert `tenantIntegrations` row.
4. Implement `api.tenantIntegrations.get`, `disconnect` mutation.
5. Refactor `getAccessToken()` in `convex/googleDrive.ts` (line 149) and `convex/http.ts` (line 223) into `getTenantAccessToken(ctx, tenantId)`:
   - Load integration; if not connected → `DriveNotConnectedError`.
   - If cached access token fresh, use it. Else refresh, cache.
   - On 401 invalid_grant → mark `status='error'`, throw `DriveReconnectNeededError`.
6. Refactor `ensureFolderPath` in both files to use `tenantIntegrations.rootFolderId`.
7. Wire `/drive-upload` and `/drive-download` HTTP routes to call `requireTenantMember` (replacing `requireUserIdentity`) and pass `tenantId` to `getTenantAccessToken`.
8. Build the UI in `/settings/integrations`:
   - "Connect Google Drive" button → builds consent URL → redirects.
   - "Connected as <email> · Reconnect · Disconnect" state after route-back.
9. Surface `DriveNotConnectedError` and `DriveReconnectNeededError` in upload UI with banners.
10. Add `apps/web/src/lib/encryption.ts` (front-end only handles what's needed — the actual encryption happens server-side in actions/HTTP). The Convex action `POST /drive-oauth/callback` does encrypt/decrypt.

**Verification**:
- Activate a fake tenant, sign in as admin, click "Connect Google Drive", authorize your test Google account, see the "Connected as ..." state, upload a file → it lands in the tenant's own Drive root folder.
- Disconnect → uploads fail with the "Connect your Google Drive" banner.
- Revoke the tenant's Google access from `myaccount.google.com/permissions` → next upload surfaces the "Reconnect needed" banner.

**Definition of done**: Driving tenants BYO Drive works end-to-end, no CLI env-vars involved.

---

## Phase E — Auth refactor

**Goal**: Drop Gmail-only; invitation-based tenant join; Google OAuth provider.

**Tasks**:
1. Update `convex/authProfile.ts` to accept any valid email.
2. Replace `convex/authSignupAllowlist.ts` content with `acceptTenantInviteOrDeny` logic per `AUTH.md`.
3. Add Google OAuth provider to `convex/auth.config.ts` and `convex/auth.ts` (register a separate OAuth client for Convex Auth — `email profile` scope only).
4. Add a `Sign in with Google` button next to the existing email/password screen.
5. Scope `shareRecipients` mutations by `tenantId`; switch `requireOwnerIdentity` to `requireTenantAdmin`. Update the `internal listEmailsForUpload` query to accept `tenantId`.

**Verification**:
- Sign up with a non-Gmail address present in a `tenantMembers.invitedEmail` row → succeeds, joined as member.
- Sign up with a non-Gmail address not in any invitation → fails with the helpful "ask your admin to invite you" message.
- Google OAuth flow ends at the same post-join state as email/password.

**Definition of done**: New tenants don't need Gmail; admins can invite any email; Google one-tap sign-in works.

---

## Phase F — Mobile app

**Goal**: A first mobile app that activates with a license key and shows the same data scoped to the tenant.

**Tasks**:
1. Create `apps/mobile` (Expo managed, SDK 52+), add to root `package.json` workspaces.
2. Configure TanStack Router; reuse `convex/_generated/api` from the repo root (the Convex client works in RN).
3. Build `ActivateScreen` → `POST /license/activate` keyed by `Application.androidId`/iOS `identifierForVendor`; save config to `expo-secure-store`.
4. Build sign-in screen (email/password for v1; add Google OAuth later — RN OAuth is fiddly).
5. Build the file command center with the stacked layout from `DESIGN.md`.
6. Add capability gating: `api.tenants.capabilities` called on boot; if `mobile !== true` → "Upgrade" screen.
7. Implement file download/viewer using the existing `/drive-download` Range route (movable to a streaming download via RN fetch + filesystem).
8. Entry on `apps/desktop/src/main.cjs` should remain unaffected — the existing bundling path is unchanged.

**Verification**:
- Activate the Expo app with a license key for a `standard` tenant → "Upgrade" screen.
- Activate with a key for an `office` tenant → sign in, see the command center, browse files, download one.

**Definition of done**: The mobile app works for `office`/`pro` tenants.

---

## Phase G — Polish + ops

**Goal**: Production-grade operations for actual sales.

**Tasks**:
1. Audit log UI at `/settings/audit`: admin views `audits.by_tenant_created_at` filtered by date range.
2. Admin device-revoke UI at `/settings/devices`: revoke a `licenseDevices` row → marks `revokedAt`; counts against `seatsUsed` adjust accordingly.
3. Storage quota displayed at `/settings/devices` (free space used / cap).
4. Resiliate support: `/settings/integrations` shows the connected Drive's quota and a "Test connection" button that just refreshes the access token.
5. Rehearse full revocation: revoke a tenant → everyone on desktop/mobile gets the contact-support screen, web session signs out via Convex Auth session rotation.
6. Vercel environment variables: `VITE_CONVEX_URL` (the packaged Convex) baked into the web build via `apps/web/.env.production`.
7. Update `.github/workflows/release-windows.yml`: one secret `VITE_CONVEX_URL`, one runner, release it as `v1.0.0-packaged` (or whatever versioning you pick).

**Definition of done**: You can run a fake sale all the way through provisioning → activation → use → revocation with no surprises.
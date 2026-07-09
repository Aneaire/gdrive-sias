# Architecture — current runtime reality

Describes how the running system **actually works today**. For intended design and
the full end-state, see [`../SaaS/ARCHITECTURE.md`](../SaaS/ARCHITECTURE.md) and the
rest of `SaaS/`. Where reality diverges from the plan, this file wins for behavior.

## Platforms (`apps/`)

- **`web/`** — TanStack Start + Vite + React 19. The Vercel deploy target; one build
  serves all tenant subdomains (planned). Local dev: `http://localhost:3000`.
- **`admin/`** — Superadmin / platform-operator console (same TanStack stack). Local
  dev: `http://localhost:3001`. Gates everything via `requireSuperAdmin`.
- **`desktop/`** — Electron shell bundling the offline renderer. License-key first
  run + offline SQLite sync. Run via `bun run dev:desktop`.
- **Mobile** — removed for now. Phase F remains a future rebuild if needed; there is no active `apps/mobile` package.

## Backend (`convex/`)

One shared Convex deployment (current dev: `aromatic-peacock-54`, see `.env.local`).
**Every** data table is tenant-scoped via a `tenantId` field and `by_tenant_*` indexes.
There are no per-tenant Convex deployments and never will be (see `SaaS/README.md`).

### Tenant isolation helpers (`convex/tenantHelpers.ts`)

Every tenant-scoped query/mutation must go through one of:

- `requireTenantMember(ctx)` — resolves the caller's active `tenantMembers` row.
- `requireTenantAdmin(ctx)` — same, plus `role === 'admin'`.
- `requireLicenseActive(ctx)` — also verifies the tenant's license isn't revoked.
- `requireSuperAdmin(ctx)` — for platform-operator (admin panel) functions; does NOT
  require a tenant membership.

Never write a query/mutation that reads tenant data without one of these — it breaks
isolation. `getActiveMembership` (called by `requireTenantMember`) is the choke point
for resolving which tenant a signed-in user belongs to.

## Tenant resolution — membership-based, NOT subdomain-based

This is the most important (and most easily misunderstood) fact:

**A signed-in user's tenant is determined by their `tenantMembers` row, not by the
subdomain of the URL they're on.**

Flow (`apps/web/src/routes/index.tsx` → `api.tenants.current` → `requireTenantMember`):

1. Convex Auth issues a token on sign-in.
2. `requireUserIdentity(ctx)` reads the identity; resolves email from the
   `userId|accountId` subject via `resolveEmailFromSubject` if the JWT lacks email.
3. `getActiveMembership(ctx)` looks up a `tenantMembers` row with `status === 'active'`
   matching the user — by `userId` (index `by_user`), or by `invitedEmail` (index
   `by_invited_email`) as a fallback.
4. That membership's `tenantId` is the caller's tenant for the whole request.

Because of this, logging in on plain `localhost:3000` (no subdomain) works — the
subdomain of the URL plays **no role** in tenant resolution today.

## Subdomain — metadata + future routing key

Today the `subdomain` field on a tenant is:

- **Set at provisioning** (`convex/provisioning.ts`): validated against
  `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`, rejects 13 reserved words (`www`, `api`,
  `mail`, `app`, `admin`, `blog`, `docs`, `status`, `staging`, `test`, `demo`,
  `sandbox`, `cdn`) and rejects duplicates (index `by_subdomain`).
- **Displayed** in the admin tenants table and the web dashboard
  (`apps/web/src/routes/index.tsx`).
- **Stored on the desktop license config** (`activate.tsx` → `tenantSubdomain`) so the
  Electron shell knows its tenant.
- **Queryable** via `api.tenants.getBySubdomain` (`convex/tenants.ts`) — a public,
  unauthenticated lookup returning only branding fields, intended for edge-cached
  first paint.

What it is **not** today: a routing key. The web frontend does **not** read the host
header or call `getBySubdomain`. No `BrandingContext`, no host-based branching in
`__root.tsx`. Wiring that up is a planned work item — see
[`plan/subdomain-resolver.md`](./plan/subdomain-resolver.md). The full intended design
lives in [`../SaaS/WEB-HOSTING.md`](../SaaS/WEB-HOSTING.md).

## Auth (`convex/auth.ts`, `authSignupAllowlist.ts`, `authProfile.ts`, `superAdmins.ts`)

Convex Auth with the Password provider. Signup is **invitation-based** (no open
self-service; sales are operator-run):

1. A superadmin provisions a tenant (`provisioning.ts:provision`) → inserts a
   `tenantMembers` row with `status: 'invited'`, `role: 'admin'`, and the buyer's
   `invitedEmail`.
2. The buyer signs up on the web (or desktop) with that email.
3. The `createOrUpdateUser` callback (`createOrUpdateInvitedUser` in
   `authSignupAllowlist.ts`) finds the invited `tenantMembers` row by email, patches
   it to `status: 'active'`, sets `userId` + `joinedAt`, and returns the user.
4. From then on, `getActiveMembership` resolves that membership → tenant is known.

**Superadmins bypass the invitation gate.** `isSuperAdminEmail` checks the
`superAdmins` table, then a hardcoded failsafe allowlist
(`BOOTSTRAP_SUPER_ADMIN_EMAILS` in `convex/superAdmins.ts`, currently
`aneaire010@gmail.com`). This is how the operator signs into `apps/admin` without a
tenant membership. The failsafe guarantees you can never lock yourself out.

## Provisioning + wipe (`convex/provisioning.ts`)

- `provision` (superadmin-only): creates `tenants` + `licenses` + an invited admin
  `tenantMembers` row in one transaction. Returns `{ licenseKey, tenantId, subdomain,
  adminEmail, plan, seats }`.
- `wipeTenantBySubdomain` (superadmin-only): fully removes a tenant and all related
  rows (licenses, devices, members, files, share recipients, sync states,
  integrations, audits) + orphaned users. Requires `confirm: "wipe:<subdomain>"`.

## Deployment model

- **Web:** one Vercel deployment, intended to serve `yourdomain.com` (apex marketing)
  + `*.yourdomain.com` (one branded tenant per subdomain) via a wildcard domain. New
  sale = a Convex `tenants` row + wildcard DNS already covers it — **no redeploy, no
  per-tenant hosting.** Not yet live (see subdomain section above).
- **Backend:** one Convex deployment, all tenants share it, isolated by `tenantId`.
- **Desktop:** one public installer; license key binds the device to a tenant at first run.
  Mobile is not currently shipped.

## Local dev

- `bun dev` → Convex (`convex dev`, pushes `convex/` on save) + web (`:3000`) +
  admin (`:3001`) concurrently.
- `bun run dev:desktop` → web + Electron.
- Convex env vars come from `.env.local` (`CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`,
  `CONVEX_URL`, `CONVEX_SITE_URL`). Both apps read the same `VITE_CONVEX_URL`, so
  web and admin always talk to the same deployment.

## What's wired vs stubbed (headlines)

- **Wired:** tenant schema + isolation helpers, invitation-based auth, superadmin
  console (dashboard/tenants/licenses/audits/superadmins/provision), web sign-in +
  folder browser, desktop license activate/validate HTTP routes, tenant-admin member
  management.
- **Stubbed / not wired:** subdomain host-based resolver + branding injection
  (Phase C), "Connect Google Drive" per-tenant OAuth (Phase D), Google OAuth sign-in
  provider (Phase E), mobile rebuild (Phase F). See [`../SaaS/PHASES.md`](../SaaS/PHASES.md)
  for the full phase plan.

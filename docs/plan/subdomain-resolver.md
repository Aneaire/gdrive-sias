# Plan: Subdomain resolver + branding injection (Phase C)

**Status:** not started
**Design spec:** [`../../SaaS/WEB-HOSTING.md`](../../SaaS/WEB-HOSTING.md)
**Phase:** C (see [`../../SaaS/PHASES.md`](../../SaaS/PHASES.md))

## Goal

Make `apps/web` resolve the tenant from the URL host and render that tenant's branding
(product name, logo, accent color, favicon) on first paint, so each buyer gets their
white-labeled sign-in / file command center at `https://<subdomain>.yourdomain.com`.

## Current state (read first)

- **Tenant resolution today is membership-based, not subdomain-based.** See
  [`../architecture.md`](../architecture.md#tenant-resolution--membership-based-not-subdomain-based).
  The signed-in user's `tenantMembers` row determines their tenant. The subdomain
  resolver is for **branding / first paint and apex-vs-subdomain routing only** — it
  does **not** replace membership-based tenant data scoping (that stays server-side
  via `requireTenantMember`).
- **`api.tenants.getBySubdomain` already exists** (`convex/tenants.ts`) — public,
  unauthenticated, returns branding fields only. **No frontend calls it yet.** This
  is the query the resolver should use.
- **`__root.tsx`** (`apps/web/src/routes/__root.tsx`) currently has no host branching.
  It just mounts `ConvexProvider`.
- **`apps/web/src/routes/index.tsx`** is a single route that shows sign-in (unauth) or
  the dashboard (auth). There is no apex marketing route group yet.
- **CSS** (`apps/web/src/styles.css`) defines `--blueprint`, `--blueprint-strong`,
  `--blueprint-soft`. The resolver is meant to override these at runtime from
  `tenants.branding.accentColor`.

## Scope

1. **Host → tenant resolution** in `__root.tsx` (a TanStack Start `beforeLoad` /
   `loader`): read `req.headers.host`, split the first label, decide apex vs.
   reserved vs. tenant subdomain vs. unknown (table in `SaaS/WEB-HOSTING.md`).
2. **`BrandingContext`** carrying `productName`, `logoUrl`, `accentColor`,
   `faviconUrl`, injected from `getBySubdomain` for tenant subdomains.
3. **Apex marketing routes** (`yourdomain.com`) — static, no tenant-data queries.
4. **CSS theme override** at `:root` from `tenants.branding.accentColor` (and derived
   strong/soft stops).
5. **"This subdomain doesn't exist" page** linking back to the apex.
6. **Logo + favicon** rendering (logo via storage key → signed URL or a
   `/tenant-logo?tenantId=...` route; type/size validation at upload is a separate
   admin-settings concern).

## Notes / constraints

- **Don't break local dev.** When host is `localhost` / `127.0.0.1` / an IP, skip the
  resolver and fall back to the current membership-based flow (the dashboard must
  still work on `http://localhost:3000`). See [`../gotchas.md`](../gotchas.md#local-dev-uses-localhost-not-subdomains).
- **Server-side branding load** so first paint is already branded (no flash of
  generic UI). Cache per-subdomain briefly; 30s edge TTL on Vercel for apex pages.
- **Convex URL is the same for every subdomain** (`VITE_CONVEX_URL`) — no per-tenant
  Convex. Don't introduce per-tenant client URLs.
- **Tenant data still flows through auth identity → `tenantMembers`** (server-enforced).
  The resolver only picks branding + which route group to show; it does not authorize
  tenant data access.
- **Reserved subdomains** are already enforced at provision time
  (`convex/provisioning.ts`); the resolver should also treat them as apex/redirect so
  a `www.yourdomain.com` or `admin.yourdomain.com` doesn't try a tenant lookup.
- **`ConvexSetupPanel`** (dev-only, shown when `VITE_CONVEX_URL` is missing) must stay
  dev-only — never render it on a packaged subdomain.

## Pointers

- Full design: [`../../SaaS/WEB-HOSTING.md`](../../SaaS/WEB-HOSTING.md) (hostname
  table, BrandingContext, CSS overrides, wildcard TLS + DNS setup, prohibited subdomains).
- Apex vs. subdomain auth: apex must **not** allow tenant sign-in; sign-in happens on
  subdomains (`SaaS/WEB-HOSTING.md` "Apex marketing site").
- Vercel setup (one-time): wildcard `*.yourdomain.com` → Vercel issues a wildcard TLS
  cert; new sale = a Convex row, no DNS/cert/redeploy per sale.

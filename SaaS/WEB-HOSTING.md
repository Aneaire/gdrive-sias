# Web hosting — apex + per-tenant subdomains

One TanStack Start app (`apps/web`) serves both the marketing apex and every tenant's white-labeled web app.

## Hostname → tenant resolution

### Route root (`apps/web/src/routes/__root.tsx`)

A `beforeLoad` (or `loader`) reads `req.headers.host`, splits the first label, and decides:

| Host | Branch |
|---|---|
| `yourdomain.com` (apex, possibly with `www.`) | Marketing route group: `/`, `/pricing`, `/contact`, `/license/activate` (optional hub). No Convex queries of tenant data. |
| `<label>.yourdomain.com` where `<label>` is reserved (`www`, `api`, `admin`, `mail`, etc.) | Treat as apex (redirect to apex or 404). |
| `<label>.yourdomain.com` (anything else) | Look up `api.tenants.getBySubdomain(label)` → inject `BrandingContext`; render the file command center (**not** the marketing pages). |
| Unknown/missing subdomain | Show a "This subdomain doesn't exist" page that links to `yourdomain.com`. |

### What the resolver injects

- `BrandingContext` carrying `productName`, `logoUrl` (resolved via the logo storage key), `accentColor` (overrides `--blueprint` token), `faviconUrl`.
- The Convex URL — same `VITE_CONVEX_URL` for every subdomain (the shared deployment). No per-tenant Convex.
- A `tenantId` that passes into Convex queries through the existing auth identity → `tenantMembers` lookup (server-enforced).

### Avoiding client/host leaks

- Branding must be loaded server-side (TanStack Start `loader`) so the first paint is already branded. No flash of generic UI.
- Cache the tenant record per subdomain briefly (Convex query responses are already reactive); cache a 30s edge TTL on Vercel for the apex marketing pages.

## CSS theme overrides at runtime

`apps/web/src/styles.css` defines `--blueprint`, `--blueprint-strong`, `--blueprint-soft`. The resolver injects a `<style>` block (or a CSS-in-JS override) that re-assigns these to the tenant's `accentColor`. Process:

1. Read `tenants.branding.accentColor` (OKLCH string, validated against a basic sanity regex).
2. Derive `--blueprint-strong` (mix toward ink) and `--blueprint-soft` (mix toward paper) at runtime, or store all three on the tenant record and let the admin pick via a 3-stop picker.
3. Override the same variables on `:root`. The existing CSS rules continue to apply.

Logo:
- Tenant admin uploads via `/settings/branding`; stored as a blob in Convex file storage (or S3) with a `logoStorageKey`. The web renders `<img src=...>` either from a signed URL or a `/tenant-logo?tenantId=...` route.
- Validate file type (`image/png`, `image/svg+xml`, `image/webp`) and size (< 200 KB) at upload.
- Fallback: skip the `<img>` if missing; show the product name in full weight.

Favicon: optional. Default to the apex favicon.

## Apex marketing site

- Static routes; no Convex tenant-data queries.
- Lives in `apps/web/src/routes/(!marketing)/...` or a parallel route group. The root resolver just chooses between the apex group and the subdomain group.
- Content: hero, pricing table (the three plans from `PLANS-QUOTAS.md`), contact form, install/activation FAQ. You write this once.
- The apex **does not** allow tenant sign-in — that happens on subdomains. (You might add a single "Sign in" button on the apex that asks "Enter your subdomain" then redirects to `https://<subdomain>.yourdomain.com`.)

## Wildcard TLS + DNS on Vercel

1. In your domain registrar, point `yourdomain.com` and `*.yourdomain.com` to Vercel's nameservers (or CNAME `*.yourdomain.com` to `cname.vercel-dns.com`).
2. In the Vercel project for `apps/web` → Settings → Domains → Add Domain:
   - Add `yourdomain.com` (primary).
   - Add `*.yourdomain.com` (wildcard). Vercel automatically issues a wildcard TLS cert via Let's Encrypt.
3. Vercel's edge serves the same Next.js/TanStack Start app for any matching subdomain. Your resolver handles the rest.

New sale = insert a `tenants` row with `subdomain='acme'`. **No DNS or cert changes per sale.**

## Setup panel removal

The existing `ConvexSetupPanel` (`apps/web/src/routes/index.tsx:2296`) is dev-only (when `VITE_CONVEX_URL` is missing). In the packaged build, `VITE_CONVEX_URL` is always set (baked into the build). Keep the panel for local development only; never render it on a packaged subdomain.

## Prohibited subdomains

Reserved (the provision script must reject): `www`, `api`, `mail`, `app`, `admin`, `blog`, `docs`, `status`, `staging`, `test`, `demo`, `sandbox`, `cdn`. Plus a regex: lowercase ASCII letters/digits/hyphens, 3–32 chars, no leading/trailing hyphen.
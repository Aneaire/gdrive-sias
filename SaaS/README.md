# RIELAN Survey File System — Packaged Product Plan

A buyer pays once and "owns" the desktop app, the mobile apps, and a web app at their own subdomain. You stay in control: one shared Convex + one shared web app, tenant isolation by `tenantId`, white-labeled branding tied to the sale, perpetual-but-revocable license keys validated on first run.

**There is no Stripe. There are no per-customer builds. There is no per-customer Convex.** Sales are not self-service — you provision each buyer manually.

## Documents in this folder

| File | Purpose |
|---|---|
| `README.md` | This overview. Start here. |
| `ARCHITECTURE.md` | High-level architecture, diagrams, request flows. |
| `DECISIONS.md` | Every product decision locked in during planning, with rationale. |
| `DATA-MODEL.md` | New and patched Convex tables, indexes, and helpers. |
| `LICENSING.md` | License key flow, activation server, provisioning script, revocation. |
| `GOOGLE-DRIVE.md` | "Connect Google Drive" button, per-tenant OAuth, token storage. |
| `WEB-HOSTING.md` | Apex vs. subdomain routing, white-label branding, wildcard TLS. |
| `DESKTOP-MOBILE.md` | Public installer + license-key first run, device binding, mobile app. |
| `AUTH.md` | Dropping Gmail-only, invitation-based tenants, Google OAuth provider. |
| `PLANS-QUOTAS.md` | Plan tiers, capability flags, quota enforcement. |
| `PHASES.md` | Phased execution plan (A → G) with verification gates. |
| `MIGRATION.md` | How the new packaged product relates to the existing RIELAN operator deployment. |

## Quick summary

- **Backend**: one shared Convex deployment, partitioned by `tenantId` on every table.
- **Licensing**: license key + `/license/activate` + `/license/validate` on Convex; perpetual, revocable.
- **Web hosting**: apex (`yourdomain.com` = marketing/sales) + wildcard `*.yourdomain.com` (one white-labeled web app per tenant's subdomain).
- **Branding depth**: product name + logo + one accent color, driven by per-tenant settings.
- **Packaging**: one public desktop installer, one public mobile app. On first launch, the buyer enters their license key; the app activates against Convex, caches `{tenantId, convexUrl, branding}`, and proceeds to sign-in.
- **Existing RIELAN operator**: untouched. The packaged product is a **branch + fresh Convex**, not a migration of the live operator. See `MIGRATION.md`.

## Non-goals (explicitly excluded)

- Self-service signup / checkout / payment processing.
- Per-customer Convex deployments.
- Per-customer compiled binaries.
- Migrating the current RIELAN office data into the packaged product (deferred indefinitely; `MIGRATION.md`).
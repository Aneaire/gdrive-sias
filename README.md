# g-customize

The packaged, saleable version of the RIELAN Survey File System.

A buyer pays once and "owns" a desktop app and a web app at their own subdomain. One shared Convex deployment + one shared web build; tenants are isolated by `tenantId`. Per-customer branding (name, logo, accent color) is driven by per-tenant rows. License keys are perpetual and revocable, validated server-side on every app launch.

The full plan lives in [`SaaS/`](./SaaS). Read [`SaaS/README.md`](./SaaS/README.md) first.

## Repository layout

```
apps/
  web/        TanStack Start + Vite + React 19 (shared by all subdomains; Vercel deploy target)
  desktop/    Electron shell with bundled offline renderer (Phase B wires license-key first run)
convex/       Backend: schema, auth, tenant helpers, files queries (all tenant-scoped)
SaaS/         Architecture, decisions, data model, licensing, OAuth, phases — the source of truth
scripts/
  copy-vercel-output.mjs   Vercel Build Output copier
  provision.mjs            Buyer provisioning (Phase B)
  seed.mjs                 Phase A verification seed (prints commands you run via the dashboard)
package.json               npm workspaces root
tsconfig.base.json         shared TS compiler options
vercel.json                Vercel deploy config
.env.example               all required env vars (Convex URL + 4 server secrets)
```

## Phase A status (current)

Scaffold complete. Remaining manual steps to finish Phase A:

1. Install dependencies + create + link a fresh Convex deployment by running in your terminal:

   ```bash
   bun install
   bunx convex dev
   ```

   `bunx convex dev` is interactive — it will prompt you to create a new project (you're already logged in per the plan). On success, `.env.local` is populated with `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL`, and `convex/_generated/` is created.

2. Run the TypeScript codegen step (re-runs automatically on `convex dev`, but useful for a clean first sync):

   ```bash
   bun run convex:codegen
   ```

3. Seed a test tenant via `bun run seed -- --subdomain=acme --name="Acme Surveying" --admin-email=admin@acme.test`. The script prints the exact Convex mutation to run from the dashboard (Phase A is schema-only — Phase B automates this via the provision script).

4. Sign up via the web app using the seeded admin email (after Phase E's auth landing page; for now you can drive the join mutation from the Convex dashboard). `api.tenants.current` should return the seeded tenant; `api.files.list` should return `[]` scoped to that tenant.

## Running

Start both Convex and the web app in one command:

```bash
bun install
bun dev
```

- Convex dev server: hot-reloads `convex/` on save
- Web app: http://localhost:3000

Separate pieces:

```bash
bun run dev:convex     # only Convex
bun run dev:web        # only the web app
bun run dev:desktop     # web + Electron
bun run desktop        # only Electron
```

## Phase A scope (what's done now)

- Multi-tenant Convex schema (`SaaS/DATA-MODEL.md`): `tenants`, `tenantMembers`, `licenses`, `licenseDevices`, `tenantIntegrations`, `audits` added; `files` / `shareRecipients` / `deviceSyncStates` patched with `tenantId` and `by_tenant_*` indexes.
- Tenant-scoped helpers (`convex/tenantHelpers.ts`): `requireTenantMember`, `requireTenantAdmin`, `requireLicenseActive`, plus typed errors (`AuthRequiredError`, `TenantMembershipRequiredError`, `TenantAdminRequiredError`, `LicenseRevokedError`, `DriveNotConnectedError`).
- Convex Auth with invitation-based signup (`convex/auth.ts`, `convex/authSignupAllowlist.ts`, `convex/authProfile.ts`): Gmail-only restriction dropped; signup is gated by a `tenantMembers.invited` row matching the caller's email.
- Superadmin allowlist (`convex/superAdmins.ts`): seeded with `aneaire010@gmail.com` for the Phase B `/license/revoke` kill switch.
- Auth and existing product functions ported to tenant scoping: `files.ts` (list, listByScope, search, stats, desktopSync, create*, remove), `shareRecipients.ts`, `deviceSyncStates.ts`, `tenantIntegrations.ts` (disconnect only — full Connect-Drive flow lands in Phase D), `tenants.ts` (getBySubdomain, current, capabilities, brandingForAdmin), `audits.ts`.
- Web workspace shell (TanStack Start + Vite + Tailwind) with a stub home route; Phase C replaces it with the subdomain resolver + branded file command center.
- Desktop shell (minimal Electron) wired for `bun run dev:desktop`. Phase B introduces the license-activation first run; Phase D wires the offline SQLite sync.
- Mobile app scaffold removed for now; Phase F remains a future rebuild if needed.
- Scripts: `copy-vercel-output.mjs`, `provision.mjs` (stub), `seed.mjs`.

## Next phases (see `SaaS/PHASES.md`)

- **Phase B** — Licensing HTTP routes (`/license/activate` `/validate` `/revoke`), full `provision.mjs`, desktop license-key first-run screen.
- **Phase C** — Subdomain resolver, branding injection, apex marketing pages, settings pages (members, devices, branding).
- **Phase D** — "Connect Google Drive" button, per-tenant OAuth, `getTenantAccessToken`, refactor `/drive-upload` and `/drive-download`.
- **Phase E** — Google OAuth provider, auth nav polish.
- **Phase F** — Mobile app rebuild if needed.
- **Phase G** — Audit log UI, device revoke, release-windows.yml packaging simplification.

## Environment

See [`.env.example`](./.env.example) for the four server-side secrets Convex will need once Phase D ships. For Phase A verification, only the two Convex deployment values (`CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`) are required, and `bunx convex dev` writes them automatically.

## Legacy note

The original single-operator RIELAN Survey File System lives at `../ryan/Survey-plan` on this machine and stays untouched. The packaged product is a fresh branch + fresh Convex per `SaaS/MIGRATION.md`. No data migrates.
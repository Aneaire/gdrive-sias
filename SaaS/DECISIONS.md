# Decisions Locked

Every decision below was confirmed during planning. Do not deviate without re-opening the question with the product owner.

## 1. Backend isolation: Shared Convex + `tenantId`

- One Convex project for all customers.
- Every table carries `tenantId`; every query/mutation filters by it.
- Rationale: scales to tens/hundreds of sales without per-deployment operational cost. Data isolation is enforced at the function layer (`requireTenantMember`), not at the database boundary.

## 2. Licensing: License key + activation server, perpetual + revocable

- Every sale gets an opaque license key issued by you (via `npm run provision`).
- Desktop/mobile/web validate the key on first run via Convex HTTP routes; the key binds to a device id.
- License is **perpetual** (no expiry, no recurring billing) but **revocable** — you retain a kill switch for refunds/abuse.
- There is no Stripe and no payment processing inside the app.

## 3. Web hosting: Apex + per-tenant subdomains

- `yourdomain.com` = your marketing/sales apex.
- `*.yourdomain.com` = wildcard that serves **one** TanStack Start web app.
- Each tenant's web app is at `https://<subdomain>.yourdomain.com`. The web app reads the hostname, resolves the tenant, and injects branding.
- Wildcard TLS + DNS via Vercel. No DNS or cert work per sale.

## 4. White-label depth: Name + logo + one accent color

- Tenant admin sets product name, uploads a logo, picks one accent color (overrides the `--blueprint` design token in `apps/web/src/styles.css` at runtime).
- All other design tokens and the field-office command-center layout stay unchanged (per `DESIGN.md`).
- Rationale: keeps maintenance sane; one product, lightly themed.

## 5. Existing RIELAN operator: Untouched branch + fresh Convex

- The current live single-operator deployment is left alone.
- The packaged product is a **new branch + a fresh empty Convex deployment**.
- No backfill. No cut-over for RIELAN. If they ever want to move to the packaged product, write a copy script then. Deferred indefinitely.
- See `MIGRATION.md`.

## 6. Subdomain provisioning: Manual one-line script

- After each sale, you run `npm run provision -- --key=XXXX --name="..." --subdomain=... --seats=N --plan=office`.
- DNS + TLS are wildcard; nothing per sale changes there.
- Rationale: sales are not self-service; tight control over who gets provisioned; no admin UI to maintain.

## 7. App distribution: Public installer + license-key first run

- **One** desktop installer, **one** mobile app — both public, both generic until activated.
- On first launch, user pastes license key → app calls `/license/activate` → caches `{tenantId, convexUrl, branding}` → proceeds to sign-in.
- No per-customer binaries. No baked-in tenant ID at build time.

## 8. Google Drive: Bring-your-own-Drive per tenant

- Each tenant clicks **Connect Google Drive** in Settings → Integrations and authorizes their own Drive.
- You operate **one** Web OAuth Client in your GCP project (used by all tenants — each tenant grants access to *their* Drive, but the OAuth client is yours).
- `refresh_token` is **encrypted at rest** (AES-256-GCM with a per-deployment `ENCRYPTION_KEY` Convex env var) in a `tenantIntegrations` row, keyed by `tenantId`.
- Files land in the customer's own Drive, not yours. They own their data.
- See `GOOGLE-DRIVE.md`.

## 9. Auth providers: Email/password (any email) + Google OAuth

- Drop the current Gmail-only restriction (`convex/authProfile.ts`).
- Open signup is removed; new users join a tenant only via pre-provisioned invitation in `tenantMembers`.
- A Google OAuth provider is added for one-tap sign-in on the web (useful since the buyer is connecting to Google Drive anyway).
- Auto-share is retained, scoped per-tenant — fully decoupled from signup.

## 10. Activation server location: Convex functions + `licenses` table

- The license activation server is just three Convex HTTP routes + the `licenses`/`licenseDevices` tables.
- No separate service to host. One operational unit.

## 11. Plans: Tier flags, not payments

- `plan` is a string on the `licenses`/`tenants` row (`standard`/`office`/`pro`).
- You set it at provisioning time. Upgrading is a one-row patch from your side.
- Capability flags drive UI gating and quota enforcement — no money flow anywhere.
- See `PLANS-QUOTAS.md`.
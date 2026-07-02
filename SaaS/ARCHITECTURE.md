# Architecture

## Diagram

```
                  yourdomain.com (apex: marketing / sales)
                            │
                            │  *.yourdomain.com  ──── wildcard TLS + DNS (Vercel)
                            │
                            ▼
            One shared TanStack Start web app (apps/web)
            reads hostname → resolves tenant → injects branding
                                    │
                                    ▼
            Shared Convex deployment (fresh; tenantId-partitioned)
            ┌───────────────────────────────────────────────────────┐
            │ licenses            licenseDevices                   │
            │ tenants             tenantMembers                     │
            │ tenantIntegrations  files                             │
            │ shareRecipients     deviceSyncStates                  │
            │ audits              usage (optional)                  │
            └───────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴─────────────────┐
            │                                 │
            ▼                                 ▼
    Public desktop installer          Public mobile app (Expo)
    (apps/desktop)                    (apps/mobile, NEW)
      first run: paste                first run: paste license key
      license key → /activate         → /activate
      → cache {tenantId,               → SecureStore cache
        convexUrl, branding}          → brand-aware home screen
      → Convex Auth sign-in
```

## Three "fronts" on the shared Convex

### 1. Licensing front (HTTP routes, no app auth)
- `POST /license/activate` — `{licenseKey, deviceId, deviceLabel, platform}` → validates key active + not revoked + device cap under `seats`, inserts `licenseDevices`, returns `{tenantId, convexUrl, branding:{productName, logoUrl, accentColor}}`.
- `POST /license/validate` — `{licenseKey, deviceId}` → periodic re-check; returns `{revoked:false}` normally; revocation causes the app to show a contact-support screen.
- `POST /license/revoke` — your superadmin-only kill switch. Marks `licenses.status='revoked'`, marks all `licenseDevices` revoked, rotates the tenant's Convex auth sessions so already-issued tokens fail.

### 2. Public OAuth front (HTTP routes)
- `POST /drive-oauth/callback` — verifies signed `state` JWT, exchanges Google `code` for `refresh_token`, **encrypts** it, creates the tenant's root Drive folder, writes `tenantIntegrations`. See `GOOGLE-DRIVE.md`.

### 3. App front (queries/mutations/actions)
- Existing product functions, now partitioned by `tenantId`.
- `requireTenantMember(ctx)`/`requireTenantAdmin(ctx)`/`requireLicenseActive(ctx, deviceId)` enforce scoping and active-license checks on every call.

## Request flow — first desktop launch

```
Buyer opens installer
  → License activation screen (renderer)
  → POST /license/activate {licenseKey, deviceId, platform:'desktop'}
  → Convex validates → returns {tenantId, convexUrl, branding}
  → Renderer persists to Electron userData
  → Applies branding (window title, accent theme)
  → Convex Auth sign-in (email/password or Google)
  → tenantMembers.invitedEmail matches → joins tenant as admin/member
  → File command center loads, scoped to tenantId
```

## Request flow — every subsequent launch

```
App boots
  → POST /license/validate {licenseKey, deviceId}
  → {revoked:false} → proceed
  → Convex queries carry auth token; requireLicenseActive re-checks binding
  → If revoked: contact-support screen, Convex rejects too
```

## Request flow — web app visit

```
Browser visits https://acme.yourdomain.com
  → TanStack Start __root.tsx reads req.headers.host
  → api.tenants.getBySubdomain('acme')
  → Injects BrandingContext (productName, logoUrl, accentColor)
  → VITE_CONVEX_URL points at shared Convex (same for all subdomains)
  → User signs in → queries auto-scoped by tenantId via requireTenantMember
```

## Request flow — upload a file

```
Renderer POST /drive-upload?fileId=... with Authorization: Bearer <authToken>
  → Convex http.ts requireTenantMember(ctx) → {tenantId}
  → getTenantAccessToken(ctx, tenantId)
       load tenantIntegrations row
       decrypt refreshToken
       refresh access_token if expiry near
  → ensureFolderPath using tenantIntegrations.rootFolderId
  → createResumableUploadSession → forward req.body to Drive
  → getDriveFile → markDriveUploadStored
  → shareDriveFile with tenant's shareRecipients (Auto-share)
```

## Single-tenant → multi-tenant transition

The whole codebase already operates against one operator. The transition is **schema + helper scoping**, not feature work:

- Every existing index becomes `by_tenant_*` (compound, leading with `tenantId`).
- Every Convex query/mutation/action filters `q.eq('tenantId', caller.tenantId)`.
- `requireUserIdentity` (in `convex/authHelpers.ts`) is retained where identity-only is enough, but data-scoped calls switch to `requireTenantMember`.

## Operationally simple

- **One** Convex project (cheap, one thing to operate).
- **One** web build (Vercel) serving all subdomains via wildcard TLS.
- **One** desktop installer artifact per release (electron-builder Windows NSIS, can be extended to macOS/Linux).
- **One** mobile app listing per store.
- New sale = one `npm run provision` command. DNS and TLS don't change.
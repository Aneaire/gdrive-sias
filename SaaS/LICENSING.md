# Licensing

The licensing system is the spine of the packaged product. It replaces billing.

## Roles

- **You (superadmin)**: issue keys via `npm run provision`, revoke them when needed, and own the apex marketing site.
- **Buyer (tenant admin)**: receives a license key + an admin invite email; activates desktop/mobile, signs in on the web at `https://<subdomain>.yourdomain.com`.
- **Tenant member**: invited by the admin; signs in with email or Google; cannot provision or revoke the license.

## License lifecycle

```
You (after sale)
   │  npm run provision -- --key=XXXX --name="Acme" --subdomain=acme --seats=5 --plan=office
   ▼
Convex writes:
   tenants          {slug:'acme', subdomain:'acme', plan:'office', branding:{productName:'Acme Surveying', ...}}
   licenses         {licenseKey:'XXXX', tenantId:..., plan:'office', status:'active', seats:5, issuedBy:'you@yourdomain.com'}
   tenantMembers    {tenantId:..., role:'admin', status:'invited', invitedEmail:'admin@acme.example'}
   │
   │  You hand the buyer: license key + subdomain URL + install links + admin invite email
   ▼
Buyer:
   1. Opens desktop installer (or mobile app)
   2. Pastes license key → renderer POST /license/activate {licenseKey, deviceId, platform:'desktop'}
      → Convex checks status active, not revoked, deviceCount < seats
      → inserts licenseDevices row
      → returns {tenantId, convexUrl, branding:{productName, logoUrl, accentColor}}
   3. Renderer persists to Electron userData (desktop) / SecureStore (mobile)
   4. Applies branding (window title, accent theme)
   5. Convex Auth sign-in — invitedEmail matches tenantMembers → joins as admin
   6. Web user signs in at https://acme.yourdomain.com — same flow, no key on the web (auth identity is the source of truth there)
```

### Per-launch validation

Every desktop/mobile launch calls `POST /license/validate {licenseKey, deviceId}`:

- `{revoked:false,lastSeenAt:now}` → proceed.
- `{revoked:true}` → contact-support screen, no Convex access.
- Convex queries additionally enforce via `requireLicenseActive(ctx, deviceId)` — defense in depth; a tampered client cannot skip past the function-layer check.

### Heartbeat (optional)

Device reports `lastSeenAt` on a 24-hour cadence; admins can see "Last active" in /settings/devices and revoke stale devices.

## Provisioning script

New file: `scripts/provision.mjs`

```
Usage:
  npm run provision -- --key=XXXX --name="Acme Surveying" --subdomain=acme \
                      --seats=5 --plan=office --admin-email=admin@acme.example \
                      [--sale-ref=INV-1042] [--notes="Annual license, paid by wire"]

What it does:
  1. Validates --subdomain format (lowercase a-z, 0-9, hyphens; 3–32 chars; not reserved: 'www','admin','app','api','mail')
  2. Checks tenants.by_subdomain is empty (no duplicate sales)
  3. Generates an opaque license key if --key is omitted (24 chars, base32, no ambiguous chars)
  4. Inserts tenants row with default branding (productName=name, accent fallback to --blueprint)
  5. Inserts licenses row status active
  6. Sends tenantMembers row status invited with invitedEmail=admin-email
  7. Prints the buyer-facing summary: license key, subdomain URL, install URLs, invite email
  8. Optionally emails the buyer via your transactional provider (or just prints for manual send)
```

Reserved subdomains (hardcoded list, never issued): `www`, `api`, `mail`, `app`, `admin`, `blog`, `docs`, `status`, `staging`, `test`.

## HTTP routes (`convex/licenseHttp.ts`, mounted from `http.ts`)

### `POST /license/activate`

Body: `{ licenseKey: string, deviceId: string, deviceLabel?: string, platform: 'desktop'|'mobile'|'web' }`

Logic:
1. Look up `licenses.by_key`; if missing or `status !== 'active'` → 403 `{error:'License is not active.'}`.
2. Count `licenseDevices.by_key` activated (not revoked); if `>= licenses.seats` and the device isn't already bound → 409 `{error:'Seat limit reached.'}`.
3. Upsert `licenseDevices` (idempotent on `(licenseKey, deviceId)`); update `lastSeenAt`.
4. Return 200 with:
   ```
   {
     tenantId,
     convexUrl,         // shared SaaS Convex URL — same for all tenants
     branding: { productName, logoUrl, accentColor, faviconUrl? },
     tenant: { slug, subdomain }
   }
   ```

Auth: none (the key IS the proof). Rate-limit by IP if spam becomes a problem.

### `POST /license/validate`

Body: `{ licenseKey, deviceId }`

Logic:
1. Look up `licenses.by_key`; if missing → 404.
2. If `status === 'revoked'` → return 200 `{revoked:true, reason}`. (200 so the client just reads `revoked` rather than tripping on 4xx.)
3. Verify the device is in `licenseDevices.by_key_device` and not revoked; if revoked → `{revoked:true, reason:'Device revoked by admin.'}`.
4. Update `licenseDevices.lastSeenAt = now`.
5. Return 200 `{revoked:false, lastSeenAt:now, branding:...}` (re-check branding for live updates).

### `POST /license/revoke`

Body: `{ licenseKey }` (or `tenantId`).

Auth: superadmin only — verified by `requireSuperAdmin(ctx)` (your account, hardcoded by email or by a `superAdmins` table).

Logic:
1. Patch `licenses.status = 'revoked'`, `revokedAt = now`.
2. Patch all `licenseDevices.by_key` → `revokedAt = now`.
3. **Rotate Convex auth sessions for the tenant** — emit a tenant-wide auth-signing-key rotation so already-issued tokens fail. (Convex Auth: invalidate sessions for all tenantMembers' userIds.)
4. Insert `audits` row action `license.revoked`.
5. Return 200 `{revoked:true}`.

## Device binding rules

- `deviceId` is the stable per-install UUID from `apps/desktop/src/sync-database.cjs` (`getOrCreateDeviceId`). For mobile, generate via Expo `Application.androidId`/`ios identifierForVendor` or a SecureStore UUID on first launch.
- One device = one row. Same physical install re-activating is idempotent (the row already exists; `lastSeenAt` updates).
- Admin can revoke a device from `/settings/devices` on the web (sets `licenseDevices.revokedAt`, does not consume a seat anymore).
- `seats` counts **active** (non-revoked) devices AND members; the total cap is `licenses.seats`. Pick a generous number for office plans.
- A user signing into the web counts as a `web` device row (or simply consumes a seat at the member level — see `PLANS-QUOTAS.md`).

## Key format

- 24 characters, base32 (Crockford alphabet, no ambiguous chars: no `0/O/1/I/L`).
- Generated either by the provision script (`--key` omitted) or pre-supplied (e.g. you want it printed on a physical card or invoice).
- Also acceptable: include hyphens for readability: `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. Strip hyphens server-side before lookup.

## Revocation policy (operational)

- Refund → revoke immediately. The app stops working on next launch.
- License sharing detected (unusual device IPs, way more seats than expected) → revoke + email buyer.
- You can un-revoke by patching the row back to `active` and clearing `revokedAt`. Tokens issued during the revoked window are already invalidated — they'll be re-issued on next sign-in.
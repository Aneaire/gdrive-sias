# Desktop & Mobile — public installer + license-key first run

One public desktop installer. One public mobile app. Both generic until the buyer activates them with their license key.

## Desktop (`apps/desktop`)

### What changes from the current code

- **`VITE_CONVEX_URL` baked into the web build** at compile time for the packaged product (single shared Convex URL for all customers). Removes the per-release config dance described in `README.md:99` and `release-windows.yml`.
  - For local dev: keep loading from `.env.local`.
  - For production builds of the packaged product: hardcode via `apps/web/.env.production` or inject at `npm run build:web`.
- **First-launch license activation screen** (new `apps/desktop/src/license-activation.cjs` or a tiny renderer route in the bundled web app, easiest is a new TanStack route at `/activate` that the desktop shell routes to on first run).

### First-launch flow

```
1. App boots; preload reads {licenseKey, deviceId, tenantId, convexUrl, branding}
   from Electron's userData/gcustomize/license-config.json.
2. If licenseKey is missing → render the /activate route:
   - Input field for license key (with hyphens for readability)
   - "Activate" button → POST /license/activate {licenseKey, deviceId, platform:'desktop', deviceLabel:pcHostname}
   - On 200: persist config to userData, apply branding, redirect to / (sign-in)
   - On 403: "License is not active. Contact support at <yourdomain.com/contact>."
   - On 409: "Seat limit reached. Ask your admin to release a device in Settings → Devices."
3. If licenseKey is present:
   - POST /license/validate {licenseKey, deviceId}
   - On {revoked:false}: proceed; sync branding if changed
   - On {revoked:true}: render the contact-support screen (no app access)
4. Load the bundled offline renderer OR the shared web URL (per `main.cjs:67 resolveApplicationUrl`).
   - Same Sign-in screen as before; user signs in via Convex Auth.
5. Existing offline SQLite sync (`sync-service.cjs`) keeps working; queries now carry
   tenantId implicitly through the user's auth identity → requireTenantMember.
```

### `deviceId`

- Reuse the stable per-install UUID from `apps/desktop/src/sync-database.cjs` (`getOrCreateDeviceId`).
- Not unique to the buyer's machine hardware — it's a per-install UUID persisted in the SQLite DB. Re-installing the app on the same machine generates a new deviceId (consumes a new seat; the admin can revoke the old one).

### Branding application

On activation, the renderer persists a `branding.json` in `userData/branding/`:
- Product name → update the window title via `BrowserWindow.setTitle` and the app icon label.
- Logo → download to `userData/branding/logo.png` (or hold the signed URL); the bundled web app reads it from a preload-exposed API.
- Accent color → set a CSS custom property before the renderer loads, so the first paint is already themed.

The desktop app's `BrowserWindow` constructor (`main.cjs:31 backgroundColor: '#f4f0e6'`) stays; the accent only overrides blueprint-related UI tokens inside the web view.

### Validation cadence

- On every app launch: call `/license/validate`.
- Optional heartbeat every 24h while running (depends on whether you want active-use tracking; can defer).
- Defense in depth: every Convex query/mutation runs `requireLicenseActive(ctx, deviceId)`; a tampered client that skips the validate call is still blocked at the function layer.

### Sign-in flow unchanged

The existing Convex Auth email/password screen works as-is. The new behavior: **after** activate, navigate to the existing sign-in route; the user signs in with the email that matches `tenantMembers.invitedEmail`, and is auto-joined to the tenant.

### Release workflow

`.github/workflows/release-windows.yml`:
- One secret needed: `VITE_CONVEX_URL` (the packaged SaaS Convex URL).
- One runner, one Windows NSIS installer artifact, one GitHub Release entry. **No per-customer artifacts.**
- (Future: add macOS notarization + Linux AppImage once you're ready to sell on those platforms.)

## Mobile (`apps/mobile` — NEW)

### Stack

- **Expo** (managed workflow, SDK 52+) + **React Native** + **TypeScript** + **TanStack Router**.
- New workspace in root `package.json` `workspaces`: `apps/mobile`.

### Reusing the backend

- Same Convex generated client (`convex/api`) — point the Expo app at the shared `VITE_CONVEX_URL`.
- Same `/drive-upload` and `/drive-download` HTTP routes — CORS is already configured in `convex/http.ts:485`, so the mobile runtime (React Native fetch with streaming) works directly.
- For large file downloads, use `Range` headers already supported by `/drive-download` (`convex/http.ts:454`); resume chunked downloads if needed.

### Layout

- The desktop three-pane layout (category rail / workspace / inspector) collapses to a stack on mobile.
- This is already specified in `DESIGN.md`: "The layout collapses to a stacked structure on smaller screens." So we use the same components, reorganized.

### First-launch flow

Same as desktop. React Native screens:

1. `ActivateScreen` — text input for license key, "Activate" button → `POST /license/activate {licenseKey, deviceId, platform:'mobile', deviceLabel:deviceModel}`.
2. `SignInScreen` — convex-auth-react inside React Native (works — fetch the auth endpoints from the React Native runtime).
3. `CommandCenterScreen` — the collapsed file command center.

### `deviceId` on mobile

- iOS: `expo-application` → `Application.iosIdentifier` (vendor identifier).
- Android: `expo-application` → `Application.androidId` (scoped to your signing key).
- Wrap in `expo-secure-store` so config persists.

### Capability gating

- On app open, fetch `api.tenants.capabilities` (driven by `plan`).
- If `mobile !== true` (i.e. plan is `standard`), show an "Upgrade" screen: "Your plan doesn't include mobile access. Contact your admin or the licensor to upgrade."
- All other UI is gated by capability flags in `PLANS-QUOTAS.md`.

### Offline (deferred)

- v1: online-only. Same as the web app.
- v2: mirror the desktop SQLite sync to a React Native SQLite (e.g. `expo-sqlite`) — same logic, just a different storage abstraction. The desktop sync code (`sync-database.cjs`) is isolated enough that porting is straightforward.

### App store reality

- Apple App Store and Google Play do not allow per-customer listings (one app, one developer account).
- The published listing uses your generic product name and a neutral icon.
- On first run, the tenant's branding takes over the in-app home screen (logo at the top of the screen, colored accent) — the app *store* listing stays generic.
- Updates: ship one update via the normal store process; the activated devices pick up the new version. No customer-by-customer rollouts.

### Distribution

- TestFlight + Internal track for your QA.
- Public release on App Store + Play Store. Submit a generic store listing (description = field-office survey document manager; screenshots of the three-pane layout in brand-neutral form).
- Buyers don't download anything from you — they get the app from the store and enter the key you emailed them. No firewall, no MDM concerns.
- Desktop still hosted on GitHub Releases (or your own CDN later if you want a marketing-page download button).
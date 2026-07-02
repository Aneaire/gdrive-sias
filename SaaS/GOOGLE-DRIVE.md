# "Connect Google Drive" — per-tenant

Replaces the CLI env-var setup (`npm run google:drive:oauth` + 4 `npx convex env set`) with a one-click button in Settings → Integrations.

## One-time Google Cloud setup (by you)

1. Open your GCP project.
2. Enable the **Google Drive API**.
3. Create an **OAuth Client ID** of type **Web application** (not Desktop).
4. Authorized redirect URIs:
   ```
   https://*.yourdomain.com/settings/integrations/google-drive/callback
   ```
   Add the apex too if you want a hub/admin view:
   ```
   https://yourdomain.com/settings/integrations/google-drive/callback
   ```
5. Set the consent screen drive scope to `https://www.googleapis.com/auth/drive.file` (restricts the app to files it created — keeps buyers comfortable).
6. Verify the app with Google (OAuth verification, drive.file scope) so buyers don't see a "Unverified app" warning. Required before shipping.
7. Copy the `client_id` and `client_secret`. Set as Convex env vars (set **once**, used by all tenants):
   ```
   npx convex env set GOOGLE_OAUTH_CLIENT_ID "..."
   npx convex env set GOOGLE_OAUTH_CLIENT_SECRET "..."
   npx convex env set OAUTH_STATE_SECRET "..."     # HMAC for the state JWT
   npx convex env set ENCRYPTION_KEY "..."         # 32 bytes, AES-256-GCM
   ```

These four env vars are the **only** Google secrets on the backend. The legacy four (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`) are removed from the packaged branch entirely.

## The flow

```
1. Tenant admin opens Settings → Integrations on https://acme.yourdomain.com
   - api.tenantIntegrations.get returns null → UI shows "Connect Google Drive" button

2. Admin clicks the button
   - Web route GET /settings/integrations/google-drive/start
   - Builds Google consent URL:
       client_id       = process.env.GOOGLE_OAUTH_CLIENT_ID
       redirect_uri    = https://<host>/settings/integrations/google-drive/callback
       scope           = drive.file
       access_type     = offline
       prompt          = consent
       include_granted_scopes = true
       state           = HMAC-signed JWT { tenantId, userId, nonce, exp: now+5min }
   - Redirects browser to the consent URL

3. Google redirects back to the callback URL:
   https://acme.yourdomain.com/settings/integrations/google-drive/callback?code=...&state=...

4. The app POSTs {code, state} to convex POST /drive-oauth/callback
   - Server:
       a. Verify state JWT (HMAC OAUTH_STATE_SECRET, not expired, tenantId matches caller's auth)
       b. POST to https://oauth2.googleapis.com/token with code, client_id, client_secret,
          redirect_uri, grant_type=authorization_code → refresh_token + access_token
       c. (If refresh_token is missing, the user already authorized once before; tell them
          to remove the app from https://myaccount.google.com/permissions and try again.)
       d. Get the Drive user's email: GET userinfo endpoint, OR use the id_token payload
       e. Create the tenant's root Drive folder
          - name = tenants.branding.productName + " — Files" (or default "RIELAN Survey File System")
          - mimeType = application/vnd.google-apps.folder
          - First list folders with that name (root level) to avoid duplicates
       f. Encrypt refresh_token with AES-256-GCM + ENCRYPTION_KEY
       g. Upsert tenantIntegrations row:
            { tenantId, provider:'google_drive', status:'connected',
              refreshToken:ciphertext, rootFolderId, connectedEmail, connectedAt }
       h. Optionally cache access_token (encrypted) + accessTokenExpiresAt (now + 1h)
       i. Return { connected:true, connectedEmail, rootFolderUrl }

5. UI polls api.tenantIntegrations.get → shows "Connected as <email> · Reconnect · Disconnect"
```

## Backend refactor

### `convex/googleDrive.ts` and `convex/http.ts`

Replace the env-var-based `getAccessToken()` (lines 149 and 223 respectively) with:

```ts
async function getTenantAccessToken(ctx, tenantId: Id<'tenants'>): Promise<string> {
  const integration = await ctx.runQuery(internal.tenantIntegrations.get, { tenantId })
  if (!integration || integration.status !== 'connected') {
    throw new DriveNotConnectedError()
  }
  if (integration.accessToken && integration.accessTokenExpiresAt && integration.accessTokenExpiresAt > Date.now() + 60_000) {
    return decrypt(integration.accessToken)
  }
  // refresh
  const refreshToken = decrypt(integration.refreshToken)
  const clientId = integration.clientId ? decrypt(integration.clientId) : process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = integration.clientSecret ? decrypt(integration.clientSecret) : process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  // on 401 invalid_grant → patch tenantIntegrations.status='error', throw DriveReconnectNeededError
  // on success → cache access_token (encrypted) + accessTokenExpiresAt, return access_token
}
```

### `ensureFolderPath`

Replace `readRequiredEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID')` with `integration.rootFolderId`. Folder segments remain unchanged (`convex/googleDrive.ts:331`).

### HTTP routes `/drive-upload` / `/drive-download`

- Extend `requireUserIdentity(ctx)` calls to `requireTenantMember(ctx)`; get `tenantId` back.
- Pass `tenantId` into `getTenantAccessToken(ctx, tenantId)`.
- `requireLicenseActive` is also called so a revoked license can't load Drive either.
- CORS stays as configured in `corsHeaders()` (`convex/http.ts:485`).

### New: `convex/driveOauth.ts`

- Holdings: `POST /drive-oauth/callback` HTTP route (registered in `http.ts`).
- `api.tenantIntegrations.get` query (admin-gated), `disconnect` mutation (status → 'revoked', `revokedAt = now`).
- `internal.tenantIntegrations.get` for `getTenantAccessToken` to call.

## Error surface in the UI

| Error | UI behavior |
|---|---|
| `DriveNotConnectedError` | Settings → Integrations shows the Connect button; uploads show "Connect your Google Drive in Settings → Integrations to upload." with a link. |
| `DriveReconnectNeededError` | Top banner: "Google Drive access expired. Reconnect in Settings → Integrations." + inline upload errors. |
| `LicenseRevokedError` | App shows the contact-support screen — license revoked, not a Drive issue. |

## Pro tier: bring your own Google Cloud OAuth client

For the `pro` plan, an admin can paste their own `client_id` / `client_secret` in `/settings/integrations`. The encrypted client_id/secret live in `tenantIntegrations.clientId/clientSecret`. `getTenantAccessToken` prefers these over the env defaults. This gives a paranoid buyer true isolation: their refresh tokens are minted by their own OAuth client, so even a leak of your OAuth client secret does not affect them.

Not needed for v1; ship with the shared client. Add the BYO columns and UI when you have a customer who asks.
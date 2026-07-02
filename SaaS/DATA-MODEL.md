# Data Model

## New tables (`convex/schema.ts`)

### `licenses`
```
licenses: defineTable({
  licenseKey: v.string(),     // opaque, unique; e.g. 24-base32 chars
  tenantId: v.id('tenants'),
  plan: v.union(
    v.literal('standard'),
    v.literal('office'),
    v.literal('pro'),
  ),
  status: v.union(
    v.literal('active'),
    v.literal('revoked'),
  ),
  seats: v.number(),          // max members + max devices combined cap
  issuedAt: v.number(),
  revokedAt: v.optional(v.number()),
  issuedBy: v.string(),       // your superadmin email/account
  saleRef: v.optional(v.string()), // your external sales/invoice ref
  notes: v.optional(v.string()),
})
  .index('by_key', ['licenseKey'])        // unique
  .index('by_tenant', ['tenantId'])
  .index('by_status', ['status'])
```

### `licenseDevices`
```
licenseDevices: defineTable({
  licenseKey: v.string(),
  deviceId: v.string(),
  platform: v.union(
    v.literal('desktop'),
    v.literal('mobile'),
    v.literal('web'),
  ),
  label: v.optional(v.string()),          // user-visible device name
  activatedAt: v.number(),
  lastSeenAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index('by_key_device', ['licenseKey', 'deviceId'])  // unique
  .index('by_key', ['licenseKey'])
```

### `tenants`
```
tenants: defineTable({
  name: v.string(),
  slug: v.string(),
  subdomain: v.string(),                   // unique; e.g. "acme"
  plan: v.union(
    v.literal('standard'),
    v.literal('office'),
    v.literal('pro'),
  ),
  createdAt: v.number(),
  createdByUserId: v.id('users'),
  branding: v.object({
    productName: v.string(),
    logoStorageKey: v.optional(v.string()),
    accentColor: v.string(),               // OKLCH string, overrides --blueprint
    faviconStorageKey: v.optional(v.string()),
  }),
})
  .index('by_slug', ['slug'])
  .index('by_subdomain', ['subdomain'])    // unique
```

### `tenantMembers`
```
tenantMembers: defineTable({
  tenantId: v.id('tenants'),
  userId: v.optional(v.id('users')),       // set once user signs up/logs in
  role: v.union(
    v.literal('admin'),
    v.literal('member'),
  ),
  status: v.union(
    v.literal('invited'),
    v.literal('active'),
  ),
  invitedEmail: v.string(),
  invitedAt: v.number(),
  joinedAt: v.optional(v.number()),
})
  .index('by_tenant', ['tenantId'])
  .index('by_user', ['userId'])
  .index('by_invited_email', ['invitedEmail'])
```

### `tenantIntegrations`
```
tenantIntegrations: defineTable({
  tenantId: v.id('tenants'),
  provider: v.literal('google_drive'),
  status: v.union(
    v.literal('connected'),
    v.literal('revoked'),
    v.literal('error'),
  ),
  refreshToken: v.string(),                  // AES-256-GCM ciphertext
  accessToken: v.optional(v.string()),      // short-lived cache (ciphertext)
  accessTokenExpiresAt: v.optional(v.number()),
  rootFolderId: v.string(),                  // per-tenant Google Drive root
  connectedEmail: v.string(),                // Google account that authorized
  connectedAt: v.number(),
  revokedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  // Optional: pro tier — BYO Google Cloud OAuth client
  clientId: v.optional(v.string()),         // ciphertext if present
  clientSecret: v.optional(v.string()),     // ciphertext if present
})
  .index('by_tenant_provider', ['tenantId', 'provider'])  // unique
```

### `audits`
```
audits: defineTable({
  tenantId: v.id('tenants'),
  actorUserId: v.optional(v.id('users')),
  action: v.string(),
  targetId: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_tenant_created_at', ['tenantId', 'createdAt'])
```

## Patched existing tables

### `files` — add `tenantId`, convert indexes to `by_tenant_*`
```
files: defineTable({
  tenantId: v.id('tenants'),     // NEW
  categoryId: v.number(),
  categoryName: v.string(),
  municipality: v.string(),
  barangay: v.string(),
  name: v.string(),
  mimeType: v.optional(v.string()),
  size: v.number(),
  notes: v.optional(v.string()),
  uploadedAt: v.number(),
  updatedAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
  deletedByDeviceId: v.optional(v.string()),
  clientUploadId: v.optional(v.string()),
  deviceId: v.optional(v.string()),
  contentSha256: v.optional(v.string()),
  storageStatus: v.union(
    v.literal('metadata_only'),
    v.literal('pending'),
    v.literal('stored'),
    v.literal('failed'),
  ),
  storageProvider: v.optional(v.literal('google_drive')),
  driveFileId: v.optional(v.string()),
  driveFolderId: v.optional(v.string()),
  driveWebViewLink: v.optional(v.string()),
  driveWebContentLink: v.optional(v.string()),
  driveMd5Checksum: v.optional(v.string()),
  uploadError: v.optional(v.string()),
})
  .index('by_tenant_scope', ['tenantId', 'categoryId', 'municipality', 'barangay'])
  .index('by_tenant_scope_deleted_uploaded',
      ['tenantId', 'categoryId', 'municipality', 'barangay', 'deletedAt', 'uploadedAt'])
  .index('by_tenant_uploaded_at', ['tenantId', 'uploadedAt'])
  .index('by_tenant_deleted_uploaded', ['tenantId', 'deletedAt', 'uploadedAt'])
  .index('by_tenant_updated_at', ['tenantId', 'updatedAt'])
  .index('by_tenant_client_upload_id', ['tenantId', 'clientUploadId'])
  .index('by_tenant_drive_file_id', ['tenantId', 'driveFileId'])
  .index('by_tenant_category', ['tenantId', 'categoryId'])
```

### `shareRecipients` — add `tenantId`
```
shareRecipients: defineTable({
  tenantId: v.id('tenants'),     // NEW
  email: v.string(),
  createdAt: v.number(),
})
  .index('by_tenant_email', ['tenantId', 'email'])
```

### `deviceSyncStates` — add `tenantId`
```
deviceSyncStates: defineTable({
  tenantId: v.id('tenants'),     // NEW
  deviceId: v.string(),
  lastSeenAt: v.number(),
  lastSuccessfulSyncAt: v.optional(v.number()),
  lastMetadataSyncAt: v.optional(v.number()),
  fullSyncComplete: v.boolean(),
  online: v.boolean(),
  syncRunning: v.boolean(),
  totalFiles: v.number(),
  cachedFileCount: v.number(),
  pendingUploadCount: v.number(),
  pendingDownloadCount: v.number(),
  failedUploadCount: v.number(),
  failedDownloadCount: v.number(),
  diskBytes: v.number(),
  lastError: v.optional(v.string()),
})
  .index('by_tenant_device_id', ['tenantId', 'deviceId'])      // unique
  .index('by_tenant_last_seen_at', ['tenantId', 'lastSeenAt'])
```

### Removed: `ownerSettings`
- Superseded by `tenantMembers.role === 'admin'`.
- The bootstrap-owner concept in `convex/ownership.ts` is dropped on the packaged branch.

## Server helpers (new `convex/tenantHelpers.ts` or extend `authHelpers.ts`)

```
// Resolves caller -> { identity, tenantId, role, licenseActive }
async function requireTenantMember(ctx): Promise<{
  identity, tenantId: Id<'tenants'>, role: 'admin'|'member', membership: Doc<'tenantMembers'>
}>

// Same as above but enforces role === 'admin'. Use for invite/revoke/branding/actions.
async function requireTenantAdmin(ctx): Promise<...>

// Also checks the caller's license is active for the given deviceId.
// Throws LicenseRevokedError if licenses.status === 'revoked'.
async function requireLicenseActive(ctx, deviceId?: string): Promise<...>

// Maps the auth identity -> tenantMembers row (status active, license active)
async function getTenantMembershipForUser(ctx, userId): Promise<Doc<'tenantMembers'> | null>
```

## Defensive scoping rules

- No query/mutation/action returns rows from a `tenantId` other than the caller's.
- Indexes always lead with `tenantId` so queries are O(tenant) across the whole deployment.
- HTTP routes (`/drive-upload`, `/drive-download`, `/license/*`) enforce the same rules — they don't bypass tenant scoping.
- A user from tenant A physically cannot read tenant B data even by guessing an ID — `requireTenantMember` filters before results are returned, and writes are validated against the same tenant.
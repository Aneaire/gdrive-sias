import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  ...authTables,

  // ────────────────────────────────────────────────────────────────────────
  // Platform operators (superadmins). Seeded via `bunx convex run
  // superAdmins:bootstrap`. Queried by `isSuperAdminEmail` to gate every
  // back-office mutation. A hardcoded failsafe allowlist in superAdmins.ts
  // guarantees the operator can never lock themselves out.
  // ────────────────────────────────────────────────────────────────────────

  superAdmins: defineTable({
    email: v.string(),
    addedAt: v.number(),
    addedBy: v.string(),
  }).index('by_email', ['email']),

  // ────────────────────────────────────────────────────────────────────────
  // Licensing + tenancy
  // ────────────────────────────────────────────────────────────────────────

  tenants: defineTable({
    name: v.string(),
    slug: v.string(),
    subdomain: v.string(),
    plan: v.union(
      v.literal('standard'),
      v.literal('office'),
      v.literal('pro'),
    ),
    createdAt: v.number(),
    createdByUserId: v.optional(v.id('users')),
    branding: v.object({
      productName: v.string(),
      logoStorageKey: v.optional(v.string()),
      accentColor: v.string(),
      faviconStorageKey: v.optional(v.string()),
    }),
  })
    .index('by_slug', ['slug'])
    .index('by_subdomain', ['subdomain']),

  tenantMembers: defineTable({
    tenantId: v.id('tenants'),
    userId: v.optional(v.id('users')),
    role: v.union(
      v.literal('admin'),
      v.literal('member'),
    ),
    status: v.union(
      v.literal('invited'),
      v.literal('active'),
      v.literal('removed'),
    ),
    invitedEmail: v.string(),
    invitedAt: v.number(),
    joinedAt: v.optional(v.number()),
    removedAt: v.optional(v.number()),
  })
    .index('by_tenant', ['tenantId'])
    .index('by_user', ['userId'])
    .index('by_invited_email', ['invitedEmail']),

  licenses: defineTable({
    licenseKey: v.string(),
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
    seats: v.number(),
    issuedAt: v.number(),
    revokedAt: v.optional(v.number()),
    issuedBy: v.string(),
    saleRef: v.optional(v.string()),
    notes: v.optional(v.string()),
  })
    .index('by_key', ['licenseKey'])
    .index('by_tenant', ['tenantId'])
    .index('by_status', ['status']),

  licenseDevices: defineTable({
    licenseKey: v.string(),
    deviceId: v.string(),
    platform: v.union(
      v.literal('desktop'),
      v.literal('mobile'),
      v.literal('web'),
    ),
    label: v.optional(v.string()),
    activatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_key_device', ['licenseKey', 'deviceId'])
    .index('by_key', ['licenseKey']),

  tenantIntegrations: defineTable({
    tenantId: v.id('tenants'),
    provider: v.literal('google_drive'),
    status: v.union(
      v.literal('connected'),
      v.literal('revoked'),
      v.literal('error'),
    ),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    rootFolderId: v.string(),
    connectedEmail: v.string(),
    connectedAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
  })
    .index('by_tenant_provider', ['tenantId', 'provider']),

  audits: defineTable({
    tenantId: v.id('tenants'),
    actorUserId: v.optional(v.id('users')),
    action: v.string(),
    targetId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_tenant_created_at', ['tenantId', 'createdAt']),

  // ────────────────────────────────────────────────────────────────────────
  // Existing product tables — now scoped by tenantId
  // ────────────────────────────────────────────────────────────────────────

  files: defineTable({
    tenantId: v.id('tenants'),
    folderId: v.optional(v.id('folders')),
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
    storageProvider: v.optional(v.union(v.literal('google_drive'), v.literal('convex'))),
    convexStorageId: v.optional(v.id('_storage')),
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
    .index('by_tenant_folder_deleted_uploaded', ['tenantId', 'folderId', 'deletedAt', 'uploadedAt'])
    .index('by_tenant_updated_at', ['tenantId', 'updatedAt'])
    .index('by_tenant_client_upload_id', ['tenantId', 'clientUploadId'])
    .index('by_tenant_drive_file_id', ['tenantId', 'driveFileId'])
    .index('by_tenant_category', ['tenantId', 'categoryId']),

  folders: defineTable({
    tenantId: v.id('tenants'),
    parentId: v.optional(v.id('folders')),
    name: v.string(),
    createdAt: v.number(),
    createdByUserId: v.optional(v.id('users')),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
    driveFolderId: v.optional(v.string()),
  })
    .index('by_tenant_parent_deleted_name', ['tenantId', 'parentId', 'deletedAt', 'name'])
    .index('by_tenant_deleted', ['tenantId', 'deletedAt'])
    .index('by_tenant_drive_folder_id', ['tenantId', 'driveFolderId']),

  // Short-lived, single-use bearer tokens allow a browser download to be
  // authorized by the app without requiring the browser's Google account.
  downloadTokens: defineTable({
    tenantId: v.id('tenants'),
    fileId: v.id('files'),
    token: v.string(),
    expiresAt: v.number(),
  }).index('by_token', ['token']),

  shareRecipients: defineTable({
    tenantId: v.id('tenants'),
    email: v.string(),
    createdAt: v.number(),
  })
    .index('by_tenant_email', ['tenantId', 'email']),

  deviceSyncStates: defineTable({
    tenantId: v.id('tenants'),
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
    .index('by_tenant_device_id', ['tenantId', 'deviceId'])
    .index('by_tenant_last_seen_at', ['tenantId', 'lastSeenAt']),
})
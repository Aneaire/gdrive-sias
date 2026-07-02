import { paginationOptsValidator } from 'convex/server'
import { type Infer, v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server'
import { requireLicenseActive, requireTenantMember } from './tenantHelpers'

const normalize = (value: string) => value.trim().toLowerCase()
const MAX_SEARCH_RESULTS = 500

const fileValidator = v.object({
  categoryId: v.number(),
  categoryName: v.string(),
  municipality: v.string(),
  barangay: v.string(),
  name: v.string(),
  mimeType: v.optional(v.string()),
  size: v.number(),
  notes: v.optional(v.string()),
})

/**
 * Lists all non-deleted files for the caller's tenant, newest first.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { tenantId } = await requireTenantMember(ctx)
    return await ctx.db
      .query('files')
      .withIndex('by_tenant_deleted_uploaded', (q) =>
        q.eq('tenantId', tenantId).eq('deletedAt', undefined),
      )
      .order('desc')
      .collect()
  },
})

/**
 * Lists files for one category/municipality/barangay scope within the tenant.
 */
export const listByScope = query({
  args: {
    categoryId: v.number(),
    municipality: v.string(),
    barangay: v.string(),
  },
  handler: async (ctx, args) => {
    const { tenantId } = await requireTenantMember(ctx)
    return await ctx.db
      .query('files')
      .withIndex('by_tenant_scope_deleted_uploaded', (q) =>
        q
          .eq('tenantId', tenantId)
          .eq('categoryId', args.categoryId)
          .eq('municipality', args.municipality)
          .eq('barangay', args.barangay)
          .eq('deletedAt', undefined),
      )
      .order('desc')
      .collect()
  },
})

/**
 * Case-insensitive substring search across file name, category, location, mime, notes.
 * Scoped to the tenant.
 */
export const search = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const { tenantId } = await requireTenantMember(ctx)
    const needle = normalize(args.query)
    if (!needle) return []

    const files = await ctx.db
      .query('files')
      .withIndex('by_tenant_deleted_uploaded', (q) =>
        q.eq('tenantId', tenantId).eq('deletedAt', undefined),
      )
      .order('desc')
      .take(MAX_SEARCH_RESULTS)

    return files.filter((file) => {
      const haystack = [
        file.name,
        file.categoryName,
        file.municipality,
        file.barangay,
        file.mimeType ?? '',
        file.notes ?? '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(needle)
    })
  },
})

/**
 * Tenant-wide stats: per-category counts, total bytes, last uploaded timestamp.
 */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const { tenantId } = await requireTenantMember(ctx)
    const files = await ctx.db
      .query('files')
      .withIndex('by_tenant_deleted_uploaded', (q) =>
        q.eq('tenantId', tenantId).eq('deletedAt', undefined),
      )
      .order('desc')
      .collect()

    const categoryCounts: Record<string, number> = {}
    let totalBytes = 0

    for (const file of files) {
      categoryCounts[file.categoryId] = (categoryCounts[file.categoryId] ?? 0) + 1
      totalBytes += file.size
    }

    return {
      totalFiles: files.length,
      totalBytes,
      categoryCounts,
      lastUploadedAt: files[0]?.uploadedAt ?? null,
    }
  },
})

/**
 * Desktop sync: paginated full tenant file list (oldest first).
 */
export const desktopSyncPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { tenantId } = await requireTenantMember(ctx)
    const page = await ctx.db
      .query('files')
      .withIndex('by_tenant_uploaded_at', (q) => q.eq('tenantId', tenantId))
      .order('asc')
      .paginate(args.paginationOpts)

    return { ...page, serverTime: Date.now() }
  },
})

/**
 * Desktop sync: paginated delta since a timestamp (used for incremental sync).
 */
export const desktopSyncSince = query({
  args: {
    since: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { tenantId } = await requireTenantMember(ctx)
    const page = await ctx.db
      .query('files')
      .withIndex('by_tenant_updated_at', (q) =>
        q.eq('tenantId', tenantId).gte('updatedAt', args.since),
      )
      .order('asc')
      .paginate(args.paginationOpts)

    return { ...page, serverTime: Date.now() }
  },
})

/**
 * Records file metadata in bulk (offline desktop uploads, queued records).
 * Storage status is `metadata_only` until a Drive upload completes.
 */
export const createMany = mutation({
  args: { files: v.array(fileValidator) },
  handler: async (ctx, args) => {
    const { tenantId } = await requireLicenseActive(ctx)
    const uploadedAt = Date.now()

    const ids: Id<'files'>[] = []
    for (const file of args.files) {
      ids.push(
        await ctx.db.insert('files', {
          ...file,
          tenantId,
          name: file.name.trim(),
          notes: file.notes?.trim() || undefined,
          uploadedAt,
          updatedAt: uploadedAt,
          storageStatus: 'metadata_only',
        }),
      )
    }

    return ids
  },
})

/**
 * Creates a single pending Drive-upload record (used by the desktop sync service
 * and the web upload flow before bytes hit Drive).
 */
export const createDriveUploadRecord = mutation({
  args: { file: fileValidator },
  handler: async (ctx, args) => {
    const ids = await createDriveUploadRecordsHelper(ctx, [args.file])
    return ids[0]
  },
})

export const createDriveUploadRecords = mutation({
  args: { files: v.array(fileValidator) },
  handler: async (ctx, args) => {
    return await createDriveUploadRecordsHelper(ctx, args.files)
  },
})

async function createDriveUploadRecordsHelper(
  ctx: MutationCtx,
  files: Array<Infer<typeof fileValidator>>,
) {
  const { tenantId } = await requireLicenseActive(ctx)
  const uploadedAt = Date.now()
  const ids: Id<'files'>[] = []

  for (const file of files) {
    ids.push(
      await ctx.db.insert('files', {
        ...file,
        tenantId,
        name: file.name.trim() || 'Untitled file',
        notes: file.notes?.trim() || undefined,
        uploadedAt,
        updatedAt: uploadedAt,
        storageStatus: 'pending',
        storageProvider: 'google_drive',
      }),
    )
  }

  return ids
}

/**
 * Offline upload record (deduplicated by `clientUploadId` for the tenant).
 */
export const createOfflineUploadRecord = mutation({
  args: {
    clientUploadId: v.string(),
    deviceId: v.string(),
    contentSha256: v.optional(v.string()),
    file: fileValidator,
  },
  handler: async (ctx, args) => {
    const { tenantId } = await requireLicenseActive(ctx, args.deviceId)
    const clientUploadId = args.clientUploadId.trim()
    if (!clientUploadId) throw new Error('clientUploadId is required.')

    const existing = await ctx.db
      .query('files')
      .withIndex('by_tenant_client_upload_id', (q) =>
        q.eq('tenantId', tenantId).eq('clientUploadId', clientUploadId),
      )
      .unique()

    if (existing) return existing._id

    const fileName = args.file.name.trim()
    const uploadedAt = Date.now()

    return await ctx.db.insert('files', {
      ...args.file,
      tenantId,
      name: fileName || 'Untitled file',
      notes: args.file.notes?.trim() || 'Queued from desktop offline sync.',
      uploadedAt,
      updatedAt: uploadedAt,
      clientUploadId,
      deviceId: args.deviceId,
      contentSha256: args.contentSha256,
      storageStatus: 'pending',
      storageProvider: 'google_drive',
    })
  },
})

/**
 * Marks a pending upload as permanently failed (used by the sync service when retries exhaust).
 */
export const failDriveUpload = mutation({
  args: {
    id: v.id('files'),
    error: v.string(),
    driveFileId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { tenantId } = await requireTenantMember(ctx)
    const file = await ctx.db.get(args.id)
    if (!file || file.tenantId !== tenantId) return
    if (file.storageStatus === 'stored') return

    const patch: {
      storageStatus: 'failed'
      storageProvider: 'google_drive'
      uploadError: string
      updatedAt: number
      driveFileId?: string
    } = {
      storageStatus: 'failed',
      storageProvider: 'google_drive',
      uploadError: args.error.slice(0, 1000),
      updatedAt: Date.now(),
    }

    if (args.driveFileId) patch.driveFileId = args.driveFileId

    await ctx.db.patch(args.id, patch)
  },
})

/**
 * Removes a file (soft delete via the web UI).
 * Drive-side trashing happens in the googleDrive action (Phase D).
 */
export const remove = mutation({
  args: { id: v.id('files') },
  handler: async (ctx, args) => {
    const { tenantId } = await requireTenantMember(ctx)
    const file = await ctx.db.get(args.id)
    if (!file || file.tenantId !== tenantId) return

    await ctx.db.patch(args.id, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
      uploadError: undefined,
    })
  },
})

/**
 * Internal: returns a file by id for the storage pipeline.
 * Does not enforce tenant scoping — only callable from other Convex functions
 * that have already verified the caller's membership.
 */
export const getForStorage = internalQuery({
  args: { id: v.id('files') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id)
  },
})

export const markDriveUploadStarted = internalMutation({
  args: {
    id: v.id('files'),
    driveFolderId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      storageStatus: 'pending',
      storageProvider: 'google_drive',
      driveFolderId: args.driveFolderId,
      uploadError: undefined,
      updatedAt: Date.now(),
    })
  },
})

export const markDriveUploadStored = internalMutation({
  args: {
    id: v.id('files'),
    driveFileId: v.string(),
    driveFolderId: v.optional(v.string()),
    driveWebViewLink: v.optional(v.string()),
    driveWebContentLink: v.optional(v.string()),
    driveMd5Checksum: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: {
      storageStatus: 'stored'
      storageProvider: 'google_drive'
      driveFileId: string
      updatedAt: number
      driveFolderId?: string
      driveWebViewLink?: string
      driveWebContentLink?: string
      driveMd5Checksum?: string
      mimeType?: string
      size?: number
      uploadError?: undefined
    } = {
      storageStatus: 'stored',
      storageProvider: 'google_drive',
      driveFileId: args.driveFileId,
      updatedAt: Date.now(),
      uploadError: undefined,
    }

    if (args.driveFolderId) patch.driveFolderId = args.driveFolderId
    if (args.driveWebViewLink) patch.driveWebViewLink = args.driveWebViewLink
    if (args.driveWebContentLink) patch.driveWebContentLink = args.driveWebContentLink
    if (args.driveMd5Checksum) patch.driveMd5Checksum = args.driveMd5Checksum
    if (args.mimeType) patch.mimeType = args.mimeType
    if (args.size !== undefined) patch.size = args.size

    await ctx.db.patch(args.id, patch)
  },
})

export const markDeletedInternal = internalMutation({
  args: {
    id: v.id('files'),
    deviceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.id)
    if (!file) return

    const deletedAt = file.deletedAt ?? Date.now()
    await ctx.db.patch(args.id, {
      deletedAt,
      deletedByDeviceId: args.deviceId,
      updatedAt: Date.now(),
      uploadError: undefined,
    })
  },
})

export const removeInternal = internalMutation({
  args: { id: v.id('files') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
  },
})
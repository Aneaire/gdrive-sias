import { v } from 'convex/values'

import type { Id } from './_generated/dataModel'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { requireLicenseActive, requireTenantMember } from './tenantHelpers'

const MAX_SUBTREE_ITEMS = 5000

function cleanName(name: string) {
  const value = name.trim().replace(/\s+/g, ' ')
  if (!value) throw new Error('Folder name is required.')
  if (value.length > 120) throw new Error('Folder name must be 120 characters or less.')
  return value
}

async function assertFolder(ctx: QueryCtx | MutationCtx, tenantId: Id<'tenants'>, folderId: Id<'folders'>) {
  const folder = await ctx.db.get(folderId)
  if (!folder || folder.tenantId !== tenantId) throw new Error('Folder not found.')
  return folder
}

async function assertParent(ctx: QueryCtx | MutationCtx, tenantId: Id<'tenants'>, parentId?: Id<'folders'>) {
  if (parentId !== undefined) await assertFolder(ctx, tenantId, parentId)
}

export const listChildren = query({
  args: { folderId: v.optional(v.id('folders')) },
  handler: async (ctx, args) => {
    const { tenantId } = await requireTenantMember(ctx)
    if (args.folderId !== undefined) await assertFolder(ctx, tenantId, args.folderId)

    const [folders, files] = await Promise.all([
      ctx.db
        .query('folders')
        .withIndex('by_tenant_parent_deleted_name', (q) =>
          q.eq('tenantId', tenantId).eq('parentId', args.folderId).eq('deletedAt', undefined),
        )
        .collect(),
      ctx.db
        .query('files')
        .withIndex('by_tenant_folder_deleted_uploaded', (q) =>
          q.eq('tenantId', tenantId).eq('folderId', args.folderId).eq('deletedAt', undefined),
        )
        .order('desc')
        .collect(),
    ])

    const filesWithAccess = await Promise.all(
      files.map(async (file) => {
        // Older uploads predate link metadata. A Drive file ID is enough to
        // construct its stable viewer URL, so they remain usable too.
        const driveWebViewLink = file.driveWebViewLink ?? (file.driveFileId
          ? `https://drive.google.com/file/d/${encodeURIComponent(file.driveFileId)}/view`
          : undefined)
        const driveDownloadLink = file.driveWebContentLink ?? (file.driveFileId
          ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(file.driveFileId)}`
          : undefined)

        return {
          ...file,
          driveWebViewLink,
          // Convex Storage URLs are short-lived; Drive URLs retain the Drive
          // permissions configured for this tenant.
          downloadUrl: file.storageProvider === 'convex' && file.convexStorageId
            ? await ctx.storage.getUrl(file.convexStorageId)
            : driveDownloadLink,
        }
      }),
    )

    return {
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      files: filesWithAccess,
    }
  },
})

export const getBreadcrumb = query({
  args: { folderId: v.optional(v.id('folders')) },
  handler: async (ctx, args) => {
    const { tenantId } = await requireTenantMember(ctx)
    if (args.folderId === undefined) return []

    const chain = []
    let currentId: Id<'folders'> | undefined = args.folderId
    for (let i = 0; currentId && i < 100; i++) {
      const folder = await assertFolder(ctx, tenantId, currentId)
      chain.push(folder)
      currentId = folder.parentId
    }
    return chain.reverse()
  },
})

export const listTrash = query({
  args: {},
  handler: async (ctx) => {
    const { tenantId } = await requireTenantMember(ctx)
    const [folders, files] = await Promise.all([
      ctx.db.query('folders').withIndex('by_tenant_deleted', (q) => q.eq('tenantId', tenantId)).collect(),
      ctx.db.query('files').withIndex('by_tenant_deleted_uploaded', (q) => q.eq('tenantId', tenantId)).collect(),
    ])
    return {
      folders: folders.filter((f) => f.deletedAt !== undefined).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
      files: files.filter((f) => f.deletedAt !== undefined),
    }
  },
})

export const create = mutation({
  args: { name: v.string(), parentId: v.optional(v.id('folders')) },
  handler: async (ctx, args) => {
    const { tenantId, membership } = await requireLicenseActive(ctx)
    await assertParent(ctx, tenantId, args.parentId)
    const now = Date.now()
    return await ctx.db.insert('folders', {
      tenantId,
      parentId: args.parentId,
      name: cleanName(args.name),
      createdAt: now,
      createdByUserId: membership.userId,
      updatedAt: now,
    })
  },
})

export const rename = mutation({
  args: { folderId: v.id('folders'), name: v.string() },
  handler: async (ctx, args) => {
    const { tenantId } = await requireLicenseActive(ctx)
    await assertFolder(ctx, tenantId, args.folderId)
    await ctx.db.patch(args.folderId, { name: cleanName(args.name), updatedAt: Date.now() })
  },
})

export const move = mutation({
  args: {
    itemId: v.union(v.id('folders'), v.id('files')),
    kind: v.union(v.literal('folder'), v.literal('file')),
    targetParentId: v.optional(v.id('folders')),
  },
  handler: async (ctx, args) => {
    const { tenantId } = await requireLicenseActive(ctx)
    await assertParent(ctx, tenantId, args.targetParentId)
    const now = Date.now()

    if (args.kind === 'file') {
      const file = await ctx.db.get(args.itemId as Id<'files'>)
      if (!file || file.tenantId !== tenantId) throw new Error('File not found.')
      await ctx.db.patch(file._id, { folderId: args.targetParentId, updatedAt: now })
      return
    }

    const folderId = args.itemId as Id<'folders'>
    const folder = await assertFolder(ctx, tenantId, folderId)
    if (args.targetParentId === folderId) throw new Error('A folder cannot be moved into itself.')

    let current = args.targetParentId
    for (let i = 0; current && i < 100; i++) {
      if (current === folderId) throw new Error('A folder cannot be moved into one of its descendants.')
      const parent = await assertFolder(ctx, tenantId, current)
      current = parent.parentId
    }

    await ctx.db.patch(folder._id, { parentId: args.targetParentId, updatedAt: now })
  },
})

async function collectSubtree(ctx: MutationCtx, tenantId: Id<'tenants'>, rootId: Id<'folders'>) {
  const folders: Id<'folders'>[] = []
  const files: Id<'files'>[] = []
  const queue: Id<'folders'>[] = [rootId]

  while (queue.length) {
    const folderId = queue.shift()!
    folders.push(folderId)
    if (folders.length + files.length > MAX_SUBTREE_ITEMS) {
      throw new Error(`Folder contains more than ${MAX_SUBTREE_ITEMS} items. Delete smaller batches first.`)
    }

    const [childFolders, childFiles] = await Promise.all([
      ctx.db
        .query('folders')
        .withIndex('by_tenant_parent_deleted_name', (q) => q.eq('tenantId', tenantId).eq('parentId', folderId))
        .collect(),
      ctx.db
        .query('files')
        .withIndex('by_tenant_folder_deleted_uploaded', (q) => q.eq('tenantId', tenantId).eq('folderId', folderId))
        .collect(),
    ])
    queue.push(...childFolders.map((f) => f._id))
    files.push(...childFiles.map((f) => f._id))
  }
  return { folders, files }
}

export const trash = mutation({
  args: { folderId: v.id('folders') },
  handler: async (ctx, args) => {
    const { tenantId } = await requireLicenseActive(ctx)
    await assertFolder(ctx, tenantId, args.folderId)
    const { folders, files } = await collectSubtree(ctx, tenantId, args.folderId)
    const now = Date.now()
    await Promise.all([
      ...folders.map((id) => ctx.db.patch(id, { deletedAt: now, updatedAt: now })),
      ...files.map((id) => ctx.db.patch(id, { deletedAt: now, updatedAt: now, uploadError: undefined })),
    ])
  },
})

export const restore = mutation({
  args: { folderId: v.optional(v.id('folders')), fileId: v.optional(v.id('files')) },
  handler: async (ctx, args) => {
    const { tenantId } = await requireLicenseActive(ctx)
    const now = Date.now()
    if (args.fileId) {
      const file = await ctx.db.get(args.fileId)
      if (!file || file.tenantId !== tenantId) throw new Error('File not found.')
      await ctx.db.patch(file._id, { deletedAt: undefined, updatedAt: now })
      return
    }
    if (!args.folderId) throw new Error('Nothing selected to restore.')
    await assertFolder(ctx, tenantId, args.folderId)
    const { folders, files } = await collectSubtree(ctx, tenantId, args.folderId)
    await Promise.all([
      ...folders.map((id) => ctx.db.patch(id, { deletedAt: undefined, updatedAt: now })),
      ...files.map((id) => ctx.db.patch(id, { deletedAt: undefined, updatedAt: now })),
    ])
  },
})

export const purge = mutation({
  args: { folderId: v.optional(v.id('folders')), fileId: v.optional(v.id('files')) },
  handler: async (ctx, args) => {
    const { tenantId } = await requireLicenseActive(ctx)
    if (args.fileId) {
      const file = await ctx.db.get(args.fileId)
      if (!file || file.tenantId !== tenantId) throw new Error('File not found.')
      if (file.deletedAt === undefined) throw new Error('File is not in trash.')
      await ctx.db.delete(file._id)
      return
    }
    if (!args.folderId) throw new Error('Nothing selected to delete permanently.')
    const folder = await assertFolder(ctx, tenantId, args.folderId)
    if (folder.deletedAt === undefined) throw new Error('Folder is not in trash.')
    const { folders, files } = await collectSubtree(ctx, tenantId, args.folderId)
    await Promise.all([...files.map((id) => ctx.db.delete(id)), ...folders.reverse().map((id) => ctx.db.delete(id))])
  },
})

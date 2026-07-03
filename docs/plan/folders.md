# Plan: Google-Drive-style folder experience

**Status:** not started
**Phase:** follows Phase A (folder model lands before Phase D Drive connect)
**Design spec:** this file is the spec — the folder model **diverges from**
[`../../SaaS/DATA-MODEL.md`](../../SaaS/DATA-MODEL.md), which intentionally has no
`folders` table. This plan is the source of truth for folders; `SaaS/` still governs
Drive OAuth / hosting / licensing.

## Goal

Give users a Google-Drive-like folder experience in `apps/web`: create folders at the
root and inside other folders, navigate into them with breadcrumbs, and get full CRUD
(rename, move, delete/trash, restore). Folders become the primary organization axis,
replacing the flat `categoryId` / `municipality` / `barangay` survey-scope tuple (those
fields stay on each file as metadata only).

## Locked decisions

1. **Folders replace scope** as the organizing axis. `categoryId` / `categoryName` /
   `municipality` / `barangay` remain on `files` as metadata/tags, not as the navigation
   key.
2. **Adopt shadcn/ui** (Radix + Tailwind v4) and establish a real
   `apps/web/src/components/` directory.
3. **Full CRUD + move** in v1: create, rename, delete (recursive trash), restore,
   move folders & files between folders, breadcrumb navigation. **Drag-and-drop is
   phase 2** — move happens via a folder-picker dialog in v1.
4. **Drive mirroring 1:1** when Phase D lands: each app folder maps to a real Drive
   folder; uploads into a folder go to the matching Drive folder. The schema
   accommodates this now (nullable `driveFolderId` on folders); the mirroring logic
   itself is Phase D and is **not** built here.

## Current state (read first)

- **No `folders` table exists.** `convex/schema.ts` (lines 140–179) defines only a
  `files` table, organized **flat** by the scope tuple (`categoryId` + `municipality`
  + `barangay`). There is no `parentId` / `folderId` field anywhere. `driveFolderId`
  on a file (line 165) is the Google Drive *storage location*, not an in-app parent.
- **File API** (`convex/files.ts`, 17 exports): `list`, `listByScope`, `search`,
  `stats`, `desktopSyncPage`/`desktopSyncSince`, `createMany`,
  `createDriveUploadRecord(s)`, `createOfflineUploadRecord`, `remove`, `failDriveUpload`,
  and `internal*` storage-pipeline helpers. All tenant-scoped via `requireTenantMember` /
  `requireLicenseActive` (see [`convex/tenantHelpers.ts`](../../convex/tenantHelpers.ts)).
- **Web has no browser UI.** `apps/web/src/routes/index.tsx` is a single Dashboard that
  renders files in a flat `<table className="file-table">` (lines ~335–369) with an
  inline metadata-only "Add file" form (lines ~264–333). There is **no `components/`
  directory, no design system** — just hand-written `apps/web/src/styles.css`
  (self-described "Phase A scaffold"), Tailwind v4 imported but underused, and
  `lucide-react`. No sidebar, top bar, breadcrumbs, grid, tree, or "New folder" button.
- **Tenant resolution is membership-based**, not subdomain-based. Every new query/mutation
  must go through `requireTenantMember` / `requireLicenseActive` and lead every index
  with `tenantId`. See [`../architecture.md`](../architecture.md) and
  [`../gotchas.md`](../gotchas.md).
- **Desktop sync** (`files.desktopSyncPage` / `desktopSyncSince`) reads all files for a
  tenant. Adding a nullable `folderId` is non-breaking for desktop — it just gets extra
  data it can ignore. No `apps/desktop` changes are part of this plan.

## Scope

**In scope:** `convex/` (shared backend) + `apps/web/` only, per the AGENTS.md
new-feature workflow. **Finish web, then stop and ask before porting** to
desktop / mobile / admin.

### Backend — `convex/`

**Schema** (`convex/schema.ts`):

- New `folders` table (insert after `files`, ~line 179):

  ```
  folders: defineTable({
    tenantId: v.id('tenants'),
    parentId: v.optional(v.id('folders')),   // undefined = root
    name: v.string(),
    createdAt: v.number(),
    createdByUserId: v.optional(v.id('users')),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),        // soft-delete (trash)
    driveFolderId: v.optional(v.string()),    // Phase D: real Drive folder id (nullable now)
  })
    .index('by_tenant_parent_deleted_name', ['tenantId', 'parentId', 'deletedAt', 'name'])
    .index('by_tenant_deleted', ['tenantId', 'deletedAt'])
    .index('by_tenant_drive_folder_id', ['tenantId', 'driveFolderId'])
  ```

- Patch `files` table: add `folderId: v.optional(v.id('folders'))` (undefined = root —
  existing rows become root automatically, **non-breaking, no migration**) and index
  `by_tenant_folder_deleted_uploaded` = `['tenantId', 'folderId', 'deletedAt', 'uploadedAt']`.
  Keep the old `by_tenant_scope*` indexes (harmless; scope is now metadata). Keep
  `categoryId` / `categoryName` / `municipality` / `barangay` **required** with
  empty/zero defaults from the browser UI (non-breaking; avoids touching desktop sync).

**New module** `convex/folders.ts` (all tenant-scoped):

| Export | Kind | Purpose |
|---|---|---|
| `listChildren` | query | Optional `folderId` → `{ folders, files }` at that parent (root if null). |
| `getBreadcrumb` | query | Walk `parentId` up from a folder → ancestor chain (root → … → current). |
| `listTrash` | query | All trashed folders + files for the tenant (`deletedAt` set). |
| `create` | mutation | `{ name, parentId? }` → insert folder. `requireLicenseActive`. |
| `rename` | mutation | `{ folderId, name }`. Verify `tenantId` ownership. |
| `move` | mutation | `{ itemId, kind: 'folder'\|'file', targetParentId? }`. **Cycle check** for folders: walk target's ancestors, reject if `itemId` appears. |
| `trash` | mutation | `{ folderId }` → recursive soft-delete subtree (folders + files). Guard: cap subtree size (e.g. 5000) and throw a clear error above it (Convex transaction limits). |
| `restore` | mutation | Un-delete a trashed subtree. |
| `purge` | mutation | Hard-delete trashed items (permanent delete from trash). |

**Patch `convex/files.ts`:** `createMany`, `createDriveUploadRecord(s)`,
`createOfflineUploadRecord` accept optional `folderId`. `remove`/soft-delete unchanged
(folders module handles subtree; file-level trash reuses the same `deletedAt` pattern).

### Web — `apps/web/`

1. **shadcn/ui setup.** `bunx shadcn@latest init` (Tailwind v4 preset). Configure
   `components.json` alias to match the existing `#/*` path alias
   (`apps/web/package.json` line 6). Add primitives: `button`, `dialog`,
   `alert-dialog`, `dropdown-menu`, `context-menu`, `breadcrumb`, `input`, `label`,
   `tooltip`, `skeleton`, `separator`, `sonner` (toasts). Keep `lucide-react` for icons.
2. **Routing** (TanStack Router file-based). Introduce a real app shell (currently
   `__root.tsx` is bare):
   - `routes/files.tsx` — **layout route** (sidebar + topbar + `<Outlet/>`). `beforeLoad`
     enforces the auth gate (moved out of `index.tsx`).
   - `routes/files.index.tsx` — root folder view (`folderId = null`).
   - `routes/files.$folderId.tsx` — subfolder view.
   - `routes/__root.tsx` — `<Outlet/>` + `<Toaster/>` (sonner) + `ConvexProvider`.
   - Make `/` redirect to `/files` when signed in; keep `/settings/members`,
     `/activate`, `/validate` as-is.
3. **Components** (new `apps/web/src/components/`): `FolderBrowser` (shell),
   `BreadcrumbNav`, `FolderGrid` / `FolderList`, `FolderTile` / `FileTile`, `NewItemMenu`,
   `NewFolderDialog`, `RenameDialog`, `MoveDialog` (folder-picker tree),
   `DeleteDialog` (shows "will delete N folders and M files inside"), `TrashView`,
   `EmptyState`.
4. **UX details.** Grid default + list toggle; sort by name/modified/size. Clickable
   breadcrumbs at every level ("My Files" = root). Context menu (right-click + ⋯):
   Open, Rename, Move, Delete. Keyboard: Enter opens, `F2`/double-click renames,
   `Delete` trashes, `Ctrl/Cmd+Shift+N` new folder. Optimistic updates with `sonner`
   toasts on failure. Loading skeletons and clear empty states. Radix primitives give
   keyboard nav + ARIA for menus/dialogs. **No drag-and-drop in v1.**
5. **Tear down the old inline UI.** Remove the flat `<table className="file-table">`
   and the metadata-only `FileForm` from `routes/index.tsx` (lines ~170–378). Keep a
   minimal "Add file" affordance inside a folder for metadata-only entries (Phase D
   wires real upload).

## Notes / constraints

- **Convex gotchas** ([`../gotchas.md`](../gotchas.md)): `storageStatus` is a
  `v.union(v.literal(...))` field — never `.filter((m) => m.eq('storageStatus','stored'))`;
  filter in JS after `.collect()`. Every index leads with `tenantId`.
- **Optional-id `eq` in indexes.** Root folders/files have `parentId` / `folderId` =
  `undefined`. Verify `q.eq('parentId', undefined)` matches root rows on Convex 1.42.x
  for optional id fields (the gotchas only flag union-literal equality, not optional
  ids, so this should be safe — fallback: JS-side filter on `by_tenant_deleted`).
- **Recursive trash transaction size.** Convex mutations have transaction limits. Cap
  subtree size in `trash`; for very large trees, a background action is a follow-up.
- **Drive mirroring is Phase D.** This plan only adds `folders.driveFolderId` (nullable)
  so the schema is ready. When Phase D lands, `ensureFolderPath` walks the app folder
  chain, creates/resolves real Drive folders, stores `driveFolderId` on each, and
  uploads go to the matching Drive folder. No mirroring work is done now.
- **Scope fields stay required on `files`** with empty/zero defaults from the browser
  to stay non-breaking for desktop sync. Making them optional is a possible follow-up.
- **Don't touch `apps/desktop` / `apps/mobile` / `apps/admin`** in this work item.

## Verification

No `typecheck` / `lint` script exists in either `package.json` (root or `apps/web`).
Run:

- `bunx tsc --noEmit` (root — covers `convex/` + workspaces).
- `bunx tsc --noEmit -p apps/web` (or `bun run build:web` — Vite build also typechecks).
- `bun run dev:convex` to apply schema changes + confirm Convex accepts the new table
  and indexes.
- `bun run test` (vitest — currently `passWithNoTests`; add folder cycle / move unit
  tests if worthwhile).
- Manual smoke: create root folder → create subfolder inside → rename → move between
  folders → delete (trash) → restore → empty trash; verify tenant isolation still holds.

## Pointers

- Tenant scoping helpers: [`../../convex/tenantHelpers.ts`](../../convex/tenantHelpers.ts)
  (`requireTenantMember`, `requireTenantAdmin`, `requireLicenseActive`).
- File API to patch: [`../../convex/files.ts`](../../convex/files.ts).
- Schema to patch: [`../../convex/schema.ts`](../../convex/schema.ts) (`files` at lines
  140–179).
- Runtime gotchas: [`../gotchas.md`](../gotchas.md).
- Current architecture: [`../architecture.md`](../architecture.md).
- Drive connect design (Phase D, the mirroring partner to this plan):
  [`../../SaaS/GOOGLE-DRIVE.md`](../../SaaS/GOOGLE-DRIVE.md) and
  [`../../SaaS/DATA-MODEL.md`](../../SaaS/DATA-MODEL.md).

## Execution order

1. Schema (`folders` table + `files.folderId` + indexes) → `bun run dev:convex` to apply.
2. `convex/folders.ts` + `files.ts` patches → backend smoke via Convex dashboard.
3. shadcn/ui init + primitives.
4. App shell + routes (`files.tsx` layout, `files.index.tsx`, `files.$folderId.tsx`).
5. Components (browser, breadcrumb, grid/list, dialogs, context menu, trash).
6. Tear down old inline table in `index.tsx`.
7. Typecheck + build + manual smoke.

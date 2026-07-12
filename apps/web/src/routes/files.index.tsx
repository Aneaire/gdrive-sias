import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { FileText, Folder, Grid3X3, List, Loader2, MoreVertical, Plus, RotateCcw, Table2, Trash2, UploadCloud, X } from 'lucide-react'
import { toast } from 'sonner'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Id } from '@convex/_generated/dataModel'

import { api } from '@convex/_generated/api'
import { messageFromError } from '../lib/error-message'
import { getConvexHttpUrl } from '../integrations/convex/provider'

type ItemKind = 'folder' | 'file'
type MoveTarget = { kind: ItemKind; itemId: Id<'folders'> | Id<'files'>; name: string } | null
type ViewCallbacks = {
  navigate: (folderId: Id<'folders'>) => void
  onRename: (target: { id: Id<'folders'>; name: string }) => void
  onMove: (target: MoveTarget) => void
  onDelete: (target: DeleteTarget) => void
}
type DeleteTarget =
  | { kind: 'folder'; id: Id<'folders'>; name: string }
  | { kind: 'file'; id: Id<'files'>; name: string }
  | null

export const Route = createFileRoute('/files/')({
  validateSearch: (search) => ({ trash: search.trash === true || search.trash === 'true' }),
  component: RootFolder,
})

function RootFolder() {
  const { trash } = Route.useSearch()
  return trash ? <TrashView /> : <FolderView folderId={undefined} />
}

export function FolderView({ folderId }: { folderId?: Id<'folders'> }) {
  const data = useQuery(api.folders.listChildren, { folderId })
  const crumb = useQuery(api.folders.getBreadcrumb, { folderId })
  const createFolder = useMutation(api.folders.create)
  const renameFolder = useMutation(api.folders.rename)
  const moveItem = useMutation(api.folders.move)
  const trashFolder = useMutation(api.folders.trash)
  const deleteFile = useMutation(api.files.remove)
  const createDriveUploadRecord = useMutation(api.files.createDriveUploadRecord)
  const uploadToDrive = useAction(api.googleDrive.uploadFile)
  const navigate = useNavigate()

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: Id<'folders'>; name: string } | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'details'>('grid')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const dragCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openFolder = useCallback((folderId: Id<'folders'>) => {
    void navigate({ to: '/files/$folderId', params: { folderId } })
  }, [navigate])

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    try {
      await action()
      if (successMessage) toast.success(successMessage)
    } catch (error) {
      toast.error(messageFromError(error))
    }
  }

  async function handleFiles(files: FileList | File[]) {
    setUploading(true)
    const total = files.length
    let completed = 0
    let failed = 0

    for (const file of Array.from(files)) {
      try {
        const id = await createDriveUploadRecord({
          file: {
            name: file.name,
            size: file.size,
            mimeType: file.type || undefined,
            folderId,
            categoryId: 0,
            categoryName: '',
            municipality: '',
            barangay: '',
          },
        })
        await uploadToDrive({ id, bytes: await file.arrayBuffer() })
        completed++
      } catch (error) {
        failed++
        console.error(`Failed to upload "${file.name}":`, error)
      }
    }

    setUploading(false)
    if (completed > 0) toast.success(`${completed} of ${total} file(s) uploaded`)
    if (failed > 0) toast.error(`${failed} file(s) failed to upload`)
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragOver(false)
    if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files)
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function handleDragEnter(event: React.DragEvent) {
    event.preventDefault()
    dragCounter.current++
    if (dragCounter.current === 1) setDragOver(true)
  }

  function handleDragLeave(event: React.DragEvent) {
    event.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragOver(false)
    }
  }

  function handleFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (files && files.length > 0) void handleFiles(files)
    event.target.value = ''
  }

  return (
    <div className="browser-panel">
      <header className="browser-header">
        <div>
          <div className="breadcrumbs">
            <Link to="/files" search={{ trash: false }}>My Files</Link>
            {crumb?.map((f) => <span key={f._id}>/ <Link to="/files/$folderId" params={{ folderId: f._id }}>{f.name}</Link></span>)}
          </div>
          <h1>{crumb?.at(-1)?.name ?? 'My Files'}</h1>
        </div>
        <div className="browser-actions">
          <div className="view-toggle" role="radiogroup" aria-label="View mode">
            <button type="button" className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} aria-label="Grid view" aria-checked={viewMode === 'grid'} role="radio"><Grid3X3 size={16}/></button>
            <button type="button" className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} aria-label="List view" aria-checked={viewMode === 'list'} role="radio"><List size={16}/></button>
            <button type="button" className={viewMode === 'details' ? 'active' : ''} onClick={() => setViewMode('details')} aria-label="Details view" aria-checked={viewMode === 'details'} role="radio"><Table2 size={16}/></button>
          </div>
          <button className="primary-action" onClick={() => setNewFolderOpen(true)}><Plus size={16}/> New folder</button>
        </div>
      </header>

      <div
        className={`drop-zone${uploading ? ' uploading' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="drop-overlay" aria-hidden="true">
            <UploadCloud size={36} />
            <strong>Drop files anywhere to upload</strong>
          </div>
        )}

        <section
          className={`drop-indicator${dragOver ? ' drag-over' : ''}${uploading ? ' uploading' : ''}`}
          aria-label="Click to upload files"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              fileInputRef.current?.click()
            }
          }}
        >
          {uploading ? <Loader2 size={28} className="spin" aria-hidden="true" /> : <UploadCloud size={28} aria-hidden="true" />}
          <div>
            {uploading
              ? <strong>Uploading files…</strong>
              : <strong>Drop files here, or click to upload</strong>}
            <p>You can also drop files anywhere in this area.</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="file-input-hidden"
            aria-hidden="true"
            onChange={handleFilePick}
          />
        </section>

        {data === undefined ? <FolderSkeleton /> : data.folders.length + data.files.length === 0 ? <div className="empty-state"><Folder size={42}/><h2>This folder is empty</h2><p>Create a folder or drop files here to start organizing.</p></div> :
          viewMode === 'grid' ? <GridView data={data} navigate={openFolder} onRename={setRenameTarget} onMove={setMoveTarget} onDelete={setDeleteTarget} /> :
          viewMode === 'list' ? <ListView data={data} navigate={openFolder} onRename={setRenameTarget} onMove={setMoveTarget} onDelete={setDeleteTarget} /> :
          <DetailsView data={data} navigate={openFolder} onRename={setRenameTarget} onMove={setMoveTarget} onDelete={setDeleteTarget} />}
      </div>

      <NameDialog
        open={newFolderOpen}
        title="New folder"
        description="Create a folder in the current location."
        label="Folder name"
        submitLabel="Create folder"
        onOpenChange={setNewFolderOpen}
        onSubmit={async (name) => {
          await run(() => createFolder({ name, parentId: folderId }), 'Folder created')
          setNewFolderOpen(false)
        }}
      />

      <NameDialog
        open={renameTarget !== null}
        title="Rename folder"
        description="Choose a clear name your team will recognize."
        label="Folder name"
        submitLabel="Save name"
        initialValue={renameTarget?.name}
        onOpenChange={(open) => { if (!open) setRenameTarget(null) }}
        onSubmit={async (name) => {
          if (!renameTarget) return
          await run(() => renameFolder({ folderId: renameTarget.id, name }), 'Folder renamed')
          setRenameTarget(null)
        }}
      />

      <MoveDialog
        target={moveTarget}
        onOpenChange={(open) => { if (!open) setMoveTarget(null) }}
        onSubmit={async (targetParentId) => {
          if (!moveTarget) return
          await run(() => moveItem({ kind: moveTarget.kind, itemId: moveTarget.itemId, targetParentId }), 'Item moved')
          setMoveTarget(null)
        }}
      />

      <ConfirmDialog
        target={deleteTarget}
        title="Move to trash?"
        description={deleteTarget?.kind === 'folder'
          ? `“${deleteTarget.name}” and its contents will move to trash. You can restore it later.`
          : `“${deleteTarget?.name ?? ''}” will move to trash. You can restore it later.`}
        actionLabel="Move to trash"
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        onConfirm={async () => {
          if (!deleteTarget) return
          if (deleteTarget.kind === 'folder') await run(() => trashFolder({ folderId: deleteTarget.id }), 'Moved to trash')
          else await run(() => deleteFile({ id: deleteTarget.id }), 'Moved to trash')
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}

function FolderSkeleton() {
  return (
    <div className="drive-grid" aria-label="Loading folder contents">
      {Array.from({ length: 8 }).map((_, index) => (
        <article className="drive-tile skeleton-tile" key={index}>
          <div className="skeleton-icon" />
          <div className="skeleton-line wide" />
          <div className="skeleton-line" />
        </article>
      ))}
    </div>
  )
}

function Menu(props: { onRename?: () => void; showFileActions?: boolean; onOpenInDrive?: () => void; onCopyLink?: () => void; onDownload?: () => void; onMove: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  function choose(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div className="tile-menu" ref={menuRef} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="tile-menu-trigger"
        aria-label="Open item menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={16}/>
      </button>
      {open ? (
        <div className="tile-menu-content">
          {props.onRename ? <button type="button" onClick={() => choose(props.onRename!)}>Rename</button> : null}
          {props.showFileActions ? <>
            <button type="button" disabled={!props.onOpenInDrive} onClick={() => props.onOpenInDrive && choose(props.onOpenInDrive)}>Open in Drive</button>
            <button type="button" disabled={!props.onCopyLink} onClick={() => props.onCopyLink && choose(props.onCopyLink)}>Copy link</button>
            <button type="button" disabled={!props.onDownload} onClick={() => props.onDownload && choose(props.onDownload)}>Download</button>
          </> : null}
          <button type="button" onClick={() => choose(props.onMove)}>Move</button>
          <button type="button" onClick={() => choose(props.onDelete)}>Delete</button>
        </div>
      ) : null}
    </div>
  )
}

function NameDialog(props: { open: boolean; title: string; description: string; label: string; submitLabel: string; initialValue?: string; onOpenChange: (open: boolean) => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(props.initialValue ?? '')
  const [busy, setBusy] = useState(false)

  function handleOpenChange(open: boolean) {
    if (open) setName(props.initialValue ?? '')
    props.onOpenChange(open)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = name.trim()
    if (!value) return
    setBusy(true)
    try { await props.onSubmit(value) } finally { setBusy(false) }
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Close className="dialog-close" aria-label="Close"><X size={18} /></Dialog.Close>
          <Dialog.Title className="dialog-title">{props.title}</Dialog.Title>
          <Dialog.Description className="dialog-description">{props.description}</Dialog.Description>
          <form className="dialog-form" onSubmit={handleSubmit}>
            <label><span>{props.label}</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Field surveys" /></label>
            <div className="dialog-actions"><Dialog.Close type="button" className="ghost-action">Cancel</Dialog.Close><button className="primary-action" disabled={busy || !name.trim()}>{busy ? 'Saving…' : props.submitLabel}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MoveDialog(props: { target: MoveTarget; onOpenChange: (open: boolean) => void; onSubmit: (targetParentId?: Id<'folders'>) => Promise<void> }) {
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try { await props.onSubmit(targetId.trim() ? targetId.trim() as Id<'folders'> : undefined) } finally { setBusy(false) }
  }

  return (
    <Dialog.Root open={props.target !== null} onOpenChange={(open) => { if (open) setTargetId(''); props.onOpenChange(open) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Close className="dialog-close" aria-label="Close"><X size={18} /></Dialog.Close>
          <Dialog.Title className="dialog-title">Move {props.target?.kind}</Dialog.Title>
          <Dialog.Description className="dialog-description">Move “{props.target?.name}”. Leave the field empty to move it to My Files.</Dialog.Description>
          <form className="dialog-form" onSubmit={handleSubmit}>
            <label><span>Destination folder ID</span><input autoFocus value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Leave blank for My Files" /></label>
            <div className="dialog-actions"><Dialog.Close type="button" className="ghost-action">Cancel</Dialog.Close><button className="primary-action" disabled={busy}>{busy ? 'Moving…' : 'Move item'}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ConfirmDialog(props: { target: DeleteTarget; title: string; description: string; actionLabel: string; onOpenChange: (open: boolean) => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog.Root open={props.target !== null} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog-content">
          <AlertDialog.Title className="dialog-title">{props.title}</AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">{props.description}</AlertDialog.Description>
          <div className="dialog-actions"><AlertDialog.Cancel className="ghost-action">Cancel</AlertDialog.Cancel><AlertDialog.Action className="danger-action" disabled={busy} onClick={async (event) => { event.preventDefault(); setBusy(true); try { await props.onConfirm() } finally { setBusy(false) } }}>{busy ? 'Working…' : props.actionLabel}</AlertDialog.Action></div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

function TrashView() {
  const trash = useQuery(api.folders.listTrash)
  const restore = useMutation(api.folders.restore)
  const purge = useMutation(api.folders.purge)
  const [purgeTarget, setPurgeTarget] = useState<DeleteTarget>(null)
  async function run(action: () => Promise<unknown>, successMessage?: string) { try { await action(); if (successMessage) toast.success(successMessage) } catch (error) { toast.error(messageFromError(error)) } }
  return <div className="browser-panel"><header className="browser-header"><div><p className="eyebrow">Trash</p><h1>Deleted items</h1></div></header>{trash === undefined ? <p className="muted">Loading trash…</p> : trash.folders.length + trash.files.length === 0 ? <div className="empty-state"><Trash2 size={42}/><h2>Trash is empty</h2></div> : <div className="trash-list">{trash.folders.map((f) => <div key={f._id}><Folder/><strong>{f.name}</strong><button onClick={() => run(() => restore({ folderId: f._id }), 'Restored')}><RotateCcw size={14}/> Restore</button><button onClick={() => setPurgeTarget({ kind: 'folder', id: f._id, name: f.name })}>Purge</button></div>)}{trash.files.map((f) => <div key={f._id}><FileText/><strong>{f.name}</strong><button onClick={() => run(() => restore({ fileId: f._id }), 'Restored')}><RotateCcw size={14}/> Restore</button><button onClick={() => setPurgeTarget({ kind: 'file', id: f._id, name: f.name })}>Purge</button></div>)}</div>}<ConfirmDialog target={purgeTarget} title="Delete permanently?" description={`“${purgeTarget?.name ?? ''}” will be permanently deleted. This cannot be undone.`} actionLabel="Delete permanently" onOpenChange={(open) => { if (!open) setPurgeTarget(null) }} onConfirm={async () => { if (!purgeTarget) return; if (purgeTarget.kind === 'folder') await run(() => purge({ folderId: purgeTarget.id }), 'Permanently deleted'); else await run(() => purge({ fileId: purgeTarget.id }), 'Permanently deleted'); setPurgeTarget(null) }} /></div>
}

function formatBytes(bytes: number) { if (bytes === 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(1024)); return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}` }

type ChildrenData = {
  folders: Array<{ _id: Id<'folders'>; name: string }>
  files: Array<{
    _id: Id<'files'>
    name: string
    size: number
    storageStatus: string
    driveWebViewLink?: string
    driveFileId?: string
    downloadUrl?: string | null
  }>
}

async function copyFileLink(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Link copied')
  } catch {
    toast.error('Could not copy the link. Please copy it from the address bar.')
  }
}

function downloadFile(url: string, name: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function FileMenu({ file, onMove, onDelete }: { file: ChildrenData['files'][number]; onMove: () => void; onDelete: () => void }) {
  const createDriveDownloadToken = useMutation(api.files.createDriveDownloadToken)
  const driveLink = file.driveWebViewLink
  const fileLink = driveLink ?? file.downloadUrl
  const storageDownloadUrl = file.downloadUrl

  async function downloadDriveFile() {
    const endpoint = getConvexHttpUrl('/drive-download')
    if (!endpoint) {
      toast.error('Download service is not configured.')
      return
    }
    try {
      const { token } = await createDriveDownloadToken({ fileId: file._id })
      downloadFile(`${endpoint}?token=${encodeURIComponent(token)}`, file.name)
    } catch (error) {
      toast.error(messageFromError(error))
    }
  }

  return <Menu
    showFileActions
    onOpenInDrive={driveLink ? () => window.open(driveLink, '_blank', 'noopener,noreferrer') : undefined}
    onCopyLink={fileLink ? () => void copyFileLink(fileLink) : undefined}
    onDownload={file.driveFileId ? () => void downloadDriveFile() : storageDownloadUrl ? () => downloadFile(storageDownloadUrl, file.name) : undefined}
    onMove={onMove}
    onDelete={onDelete}
  />
}

function GridView({ data, navigate, onRename, onMove, onDelete }: { data: ChildrenData } & ViewCallbacks) {
  return (
    <div className="drive-grid">
      {data.folders.map((f) => (
        <article className="drive-tile clickable" key={f._id} role="link" tabIndex={0}
          onClick={() => navigate(f._id)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(f._id) } }}>
          <Folder className="folder-icon"/><Link to="/files/$folderId" params={{ folderId: f._id }} onClick={(event) => event.stopPropagation()}>{f.name}</Link>
          <Menu onRename={() => onRename({ id: f._id, name: f.name })} onMove={() => onMove({ kind: 'folder', itemId: f._id, name: f.name })} onDelete={() => onDelete({ kind: 'folder', id: f._id, name: f.name })} />
        </article>
      ))}
      {data.files.map((f) => (
        <article className="drive-tile file clickable" key={f._id} tabIndex={0} aria-label={`${f.name}, ${formatBytes(f.size)}, ${f.storageStatus}`}>
          <FileText/><strong>{f.name}</strong><small>{formatBytes(f.size)} · {f.storageStatus}</small>
          <FileMenu file={f} onMove={() => onMove({ kind: 'file', itemId: f._id, name: f.name })} onDelete={() => onDelete({ kind: 'file', id: f._id, name: f.name })} />
        </article>
      ))}
    </div>
  )
}

function ListView({ data, navigate, onRename, onMove, onDelete }: { data: ChildrenData } & ViewCallbacks) {
  return (
    <div className="list-view">
      {[...data.folders.map((f) => ({ ...f, kind: 'folder' as const })), ...data.files.map((f) => ({ ...f, kind: 'file' as const }))].map((item) => (
        <div className={`list-row ${item.kind}`} key={item._id} role="link" tabIndex={0}
          onClick={() => item.kind === 'folder' ? navigate((item as any)._id) : undefined}
          onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && item.kind === 'folder') { event.preventDefault(); navigate((item as any)._id) } }}>
          <span className="list-row-icon">{item.kind === 'folder' ? <Folder className="folder-icon" size={18}/> : <FileText size={18}/>}</span>
          <span className="list-row-name">{item.name}</span>
          <span className="list-row-meta">{item.kind === 'file' ? `${formatBytes((item as any).size)} · ${(item as any).storageStatus}` : 'Folder'}</span>
          <div className="list-row-menu" onClick={(event) => event.stopPropagation()}>
            {item.kind === 'folder'
              ? <Menu onRename={() => onRename({ id: item._id, name: item.name })} onMove={() => onMove({ kind: 'folder', itemId: item._id, name: item.name })} onDelete={() => onDelete({ kind: 'folder', id: item._id, name: item.name })} />
              : <FileMenu file={item} onMove={() => onMove({ kind: 'file', itemId: item._id, name: item.name })} onDelete={() => onDelete({ kind: 'file', id: item._id, name: item.name })} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function DetailsView({ data, navigate, onRename, onMove, onDelete }: { data: ChildrenData } & ViewCallbacks) {
  return (
    <table className="details-table">
      <thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>
        {data.folders.map((f) => (
          <tr key={f._id} className="details-row" role="link" tabIndex={0} onClick={() => navigate(f._id)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(f._id) } }}>
            <td><Folder className="folder-icon" size={16}/> {f.name}</td>
            <td>Folder</td><td>—</td><td>—</td>
            <td className="details-menu"><Menu onRename={() => onRename({ id: f._id, name: f.name })} onMove={() => onMove({ kind: 'folder', itemId: f._id, name: f.name })} onDelete={() => onDelete({ kind: 'folder', id: f._id, name: f.name })} /></td>
          </tr>
        ))}
        {data.files.map((f) => (
          <tr key={f._id} className="details-row">
            <td><FileText size={16}/> {f.name}</td>
            <td>File</td><td>{formatBytes(f.size)}</td><td>{f.storageStatus}</td>
            <td className="details-menu"><FileMenu file={f} onMove={() => onMove({ kind: 'file', itemId: f._id, name: f.name })} onDelete={() => onDelete({ kind: 'file', id: f._id, name: f.name })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

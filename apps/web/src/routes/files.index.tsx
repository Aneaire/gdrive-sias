import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { FileText, Folder, MoreVertical, Plus, RotateCcw, Trash2, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Id } from '@convex/_generated/dataModel'

import { api } from '@convex/_generated/api'
import { messageFromError } from '../lib/error-message'

type ItemKind = 'folder' | 'file'
type MoveTarget = { kind: ItemKind; itemId: Id<'folders'> | Id<'files'>; name: string } | null
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
  const navigate = useNavigate()

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ id: Id<'folders'>; name: string } | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      alert(messageFromError(error))
    }
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
          <button className="primary-action" onClick={() => setNewFolderOpen(true)}><Plus size={16}/> New folder</button>
        </div>
      </header>

      <section className="drop-indicator" aria-label="Folder upload area">
        <UploadCloud size={28} aria-hidden="true" />
        <div>
          <strong>Create folders here, or drop folders and files into this space.</strong>
          <p>Use New folder now. Drag-and-drop upload is the next Drive-backed step, so this area shows users where their documents will land.</p>
        </div>
      </section>

      {data === undefined ? <FolderSkeleton /> : data.folders.length + data.files.length === 0 ? <div className="empty-state"><Folder size={42}/><h2>This folder is empty</h2><p>Select <strong>New folder</strong> to start organizing, or drop folders/files here once upload is connected.</p></div> :
        <div className="drive-grid">
          {data.folders.map((f) => (
            <article
              className="drive-tile clickable"
              key={f._id}
              role="link"
              tabIndex={0}
              onClick={() => void navigate({ to: '/files/$folderId', params: { folderId: f._id } })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void navigate({ to: '/files/$folderId', params: { folderId: f._id } })
                }
              }}
            >
              <Folder className="folder-icon"/><Link to="/files/$folderId" params={{ folderId: f._id }} onClick={(event) => event.stopPropagation()}>{f.name}</Link>
              <Menu
                onRename={() => setRenameTarget({ id: f._id, name: f.name })}
                onMove={() => setMoveTarget({ kind: 'folder', itemId: f._id, name: f.name })}
                onDelete={() => setDeleteTarget({ kind: 'folder', id: f._id, name: f.name })}
              />
            </article>
          ))}
          {data.files.map((f) => (
            <article className="drive-tile file clickable" key={f._id} tabIndex={0} aria-label={`${f.name}, ${formatBytes(f.size)}, ${f.storageStatus}`}>
              <FileText/><strong>{f.name}</strong><small>{formatBytes(f.size)} · {f.storageStatus}</small>
              <Menu
                onMove={() => setMoveTarget({ kind: 'file', itemId: f._id, name: f.name })}
                onDelete={() => setDeleteTarget({ kind: 'file', id: f._id, name: f.name })}
              />
            </article>
          ))}
        </div>}

      <NameDialog
        open={newFolderOpen}
        title="New folder"
        description="Create a folder in the current location."
        label="Folder name"
        submitLabel="Create folder"
        onOpenChange={setNewFolderOpen}
        onSubmit={async (name) => {
          await run(() => createFolder({ name, parentId: folderId }))
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
          await run(() => renameFolder({ folderId: renameTarget.id, name }))
          setRenameTarget(null)
        }}
      />

      <MoveDialog
        target={moveTarget}
        onOpenChange={(open) => { if (!open) setMoveTarget(null) }}
        onSubmit={async (targetParentId) => {
          if (!moveTarget) return
          await run(() => moveItem({ kind: moveTarget.kind, itemId: moveTarget.itemId, targetParentId }))
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
          if (deleteTarget.kind === 'folder') await run(() => trashFolder({ folderId: deleteTarget.id }))
          else await run(() => deleteFile({ id: deleteTarget.id }))
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

function Menu(props: { onRename?: () => void; onMove: () => void; onDelete: () => void }) {
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
  async function run(action: () => Promise<unknown>) { try { await action() } catch (error) { alert(messageFromError(error)) } }
  return <div className="browser-panel"><header className="browser-header"><div><p className="eyebrow">Trash</p><h1>Deleted items</h1></div></header>{trash === undefined ? <p className="muted">Loading trash…</p> : trash.folders.length + trash.files.length === 0 ? <div className="empty-state"><Trash2 size={42}/><h2>Trash is empty</h2></div> : <div className="trash-list">{trash.folders.map((f) => <div key={f._id}><Folder/><strong>{f.name}</strong><button onClick={() => run(() => restore({ folderId: f._id }))}><RotateCcw size={14}/> Restore</button><button onClick={() => setPurgeTarget({ kind: 'folder', id: f._id, name: f.name })}>Purge</button></div>)}{trash.files.map((f) => <div key={f._id}><FileText/><strong>{f.name}</strong><button onClick={() => run(() => restore({ fileId: f._id }))}><RotateCcw size={14}/> Restore</button><button onClick={() => setPurgeTarget({ kind: 'file', id: f._id, name: f.name })}>Purge</button></div>)}</div>}<ConfirmDialog target={purgeTarget} title="Delete permanently?" description={`“${purgeTarget?.name ?? ''}” will be permanently deleted. This cannot be undone.`} actionLabel="Delete permanently" onOpenChange={(open) => { if (!open) setPurgeTarget(null) }} onConfirm={async () => { if (!purgeTarget) return; if (purgeTarget.kind === 'folder') await run(() => purge({ folderId: purgeTarget.id })); else await run(() => purge({ fileId: purgeTarget.id })); setPurgeTarget(null) }} /></div>
}

function formatBytes(bytes: number) { if (bytes === 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(1024)); return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}` }

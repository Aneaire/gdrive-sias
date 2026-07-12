import { Authenticated, AuthLoading, Unauthenticated, useQuery } from 'convex/react'
import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { useAuthActions } from '@convex-dev/auth/react'
import { FolderOpen, LogOut, Menu, Plug, Settings, Trash2, X } from 'lucide-react'

import { api } from '@convex/_generated/api'
import { useState } from 'react'

export const Route = createFileRoute('/files')({ component: FilesLayout })

function FilesLayout() {
  return (
    <>
      <AuthLoading>
        <main className="drive-loading-shell" aria-label="Loading your workspace">
          <div className="drive-loading-card">
            <div className="drive-loading-mark">
              <FolderOpen size={26} aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">g-customize</p>
              <h1>Preparing your files</h1>
              <p>Checking your session and loading your workspace…</p>
            </div>
            <div className="drive-loading-bar" aria-hidden="true"><span /></div>
          </div>
        </main>
      </AuthLoading>
      <Unauthenticated>
        <main className="auth-shell"><p>Please sign in from the home page.</p><Link className="primary-action" to="/">Go to sign in</Link></main>
      </Unauthenticated>
      <Authenticated><Shell /></Authenticated>
    </>
  )
}

function Shell() {
  const tenant = useQuery(api.tenants.current)
  const { signOut } = useAuthActions()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (tenant === null) {
    return (
      <main className="auth-shell">
        <div className="drive-no-membership-card">
          <div className="drive-no-membership-icon">
            <FolderOpen size={32} />
          </div>
          <h2>No tenant access</h2>
          <p>
            You are not a member of any tenant. Ask your admin to invite you, or
            sign out and try a different account.
          </p>
          <button
            type="button"
            className="primary-action"
            onClick={() => void signOut()}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={`drive-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <button
        type="button"
        className="mobile-menu-button"
        aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      {sidebarOpen ? <button type="button" className="sidebar-scrim" aria-label="Close navigation menu" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className="drive-sidebar">
        <div className="drive-brand"><FolderOpen size={22} /><div><p className="eyebrow">{tenant?.branding.productName ?? 'g-customize'}</p><strong>{tenant?.name ?? 'My Files'}</strong></div></div>
        <nav className="drive-nav">
          <Link to="/files" search={{ trash: false }} onClick={() => setSidebarOpen(false)}><FolderOpen size={16} /> My Files</Link>
          <Link to="/files" search={{ trash: true }} onClick={() => setSidebarOpen(false)}><Trash2 size={16} /> Trash</Link>
          {tenant?.role === 'admin' ? (
            <Link to="/settings/members" onClick={() => setSidebarOpen(false)}><Settings size={16} /> Members</Link>
          ) : null}
          {tenant?.role === 'admin' ? (
            <Link to="/settings/integrations" search={{ drive_code: undefined, state: undefined, error: undefined }} onClick={() => setSidebarOpen(false)}><Plug size={16} /> Integrations</Link>
          ) : null}
        </nav>
        <button type="button" className="ghost-action" onClick={() => void signOut()}><LogOut size={16} /> Sign out</button>
      </aside>
      <section className="drive-main"><Outlet /></section>
    </main>
  )
}

import { createFileRoute, Outlet, Link, useRouterState, useNavigate } from '@tanstack/react-router'
import { AuthLoading, Unauthenticated, useQuery } from 'convex/react'
import { useAuthActions } from '@convex-dev/auth/react'
import { AlertTriangle, LayoutDashboard, Building2, KeyRound, ScrollText, ShieldCheck, LogOut, Loader2, Plus } from 'lucide-react'
import { api } from '@convex/_generated/api'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    // The actual gate is the status query in the component. beforeLoad runs
    // before the component mounts, and we don't have a synchronous way to
    // check Convex Auth here, so we just let the component render and gate
    // via the `currentStatus` query. This avoids races with the auth
    // bootstrap on first page load.
    return { location }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const status = useQuery(api.superAdmins.currentStatus)

  return (
    <>
      <AuthLoading>
        <main className="login-shell">
          <Loader2 size={28} className="spin" aria-hidden="true" />
          <p>Connecting to Convex…</p>
        </main>
      </AuthLoading>

      <Unauthenticated>
        <RedirectToLogin />
      </Unauthenticated>

      {status?.signedIn && !status?.isSuperAdmin ? (
        <NotAuthorizedShell email={status.email} />
      ) : null}

      {status?.signedIn && status?.isSuperAdmin ? (
        <AdminShell email={status.email ?? 'unknown'} />
      ) : null}
    </>
  )
}

function RedirectToLogin() {
  const navigate = useNavigate()
  // Defer the navigation so it doesn't happen during render.
  void Promise.resolve().then(() => navigate({ to: '/login' }))
  return (
    <main className="login-shell">
      <Loader2 size={28} className="spin" aria-hidden="true" />
      <p>Redirecting to sign in…</p>
    </main>
  )
}

function AdminShell({ email }: { email: string }) {
  const { signOut } = useAuthActions()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/tenants', label: 'Tenants', icon: Building2 },
    { to: '/licenses', label: 'Licenses', icon: KeyRound },
    { to: '/audits', label: 'Audit log', icon: ScrollText },
    { to: '/superadmins', label: 'Superadmins', icon: ShieldCheck },
  ]

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="admin-brand-mark" aria-hidden="true">
            <ShieldCheck size={20} />
          </div>
          <div className="admin-brand-text">
            <strong>G-customize</strong>
            <span>Platform Console</span>
          </div>
        </div>

        <nav className="admin-nav">
          <div className="admin-nav-section">Operations</div>
          {navItems.map((item) => {
            const Icon = item.icon
            const active = pathname === item.to || pathname.startsWith(item.to + '/')
            return (
              <Link
                key={item.to}
                to={item.to}
                className={active ? 'active' : ''}
              >
                <Icon size={16} aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
          <div className="admin-nav-section">Back office</div>
          <Link to="/provision">
            <Plus size={16} aria-hidden="true" />
            Provision tenant
          </Link>
        </nav>

        <div className="admin-sidebar-footer">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <div style={{ color: '#8b9bd8', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Signed in as</div>
              <div style={{ color: '#fff', fontSize: '0.8rem', wordBreak: 'break-all' }}>{email}</div>
            </div>
            <button type="button" onClick={() => void signOut()} style={{ alignSelf: 'flex-start' }}>
              <LogOut size={14} aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}

function NotAuthorizedShell({ email }: { email: string | null }) {
  const { signOut } = useAuthActions()
  return (
    <main className="not-authorized-shell">
      <AlertTriangle size={40} aria-hidden="true" />
      <h1 style={{ margin: 0 }}>Not authorized</h1>
      <p className="muted" style={{ margin: 0 }}>
        Signed in as <strong>{email ?? 'unknown'}</strong>, but this account is not a superadmin.
      </p>
      <button type="button" className="ghost-action" onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  )
}

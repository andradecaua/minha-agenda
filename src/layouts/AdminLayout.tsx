import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  FileText,
  LifeBuoy,
  LogOut,
  Menu,
  Package,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'

import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: typeof BarChart3
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: 'Visão geral', icon: BarChart3, end: true },
  { to: '/admin/users', label: 'Usuários', icon: Users },
  { to: '/admin/plans', label: 'Planos', icon: Package },
  { to: '/admin/tickets', label: 'Suporte', icon: LifeBuoy },
  { to: '/admin/reports', label: 'Auditoria', icon: FileText },
]

export function AdminLayout() {
  const { signOut, user } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-background md:flex">
        <Sidebar
          onNavigate={() => undefined}
          onSignOut={handleSignOut}
          email={user?.email ?? null}
        />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <Link to="/admin" className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          Admin
        </Link>
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-2 hover:bg-accent"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-background shadow-xl">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="font-semibold">Admin</span>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <Sidebar
              onNavigate={() => setMobileOpen(false)}
              onSignOut={handleSignOut}
              email={user?.email ?? null}
            />
          </div>
        </div>
      )}

      <main className="md:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
          <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Sessão administrativa autenticada em duas etapas (AAL2).
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

interface SidebarProps {
  onNavigate: () => void
  onSignOut: () => void
  email: string | null
}

function Sidebar({ onNavigate, onSignOut, email }: SidebarProps) {
  return (
    <>
      <div className="hidden h-14 items-center gap-2 border-b px-6 font-semibold md:flex">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        Admin · Minha Agenda
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t p-3">
        <Link
          to="/dashboard"
          onClick={onNavigate}
          className="mb-2 block rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
        >
          ← Voltar ao dashboard
        </Link>
        {email && (
          <div className="mb-2 truncate px-3 text-xs text-muted-foreground" title={email}>
            {email}
          </div>
        )}
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground"
          onClick={onSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </>
  )
}

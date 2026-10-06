import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  Images,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Scissors,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAdminSession } from '@/hooks/queries/useAdminSession'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSIONS, type PermissionCode } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  /** Se definido, esconde o item quando o plano não inclui a permissão. */
  permission?: PermissionCode
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { to: '/dashboard/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/dashboard/clientes', label: 'Clientes', icon: Users },
  { to: '/dashboard/servicos', label: 'Serviços', icon: Scissors },
  {
    to: '/dashboard/portfolio',
    label: 'Portfólio',
    icon: Images,
    permission: PERMISSIONS.PORTFOLIO_MANAGE,
  },
  {
    to: '/dashboard/produtos',
    label: 'Produtos',
    icon: Package,
    permission: PERMISSIONS.PRODUCTS_MANAGE,
  },
  { to: '/dashboard/configuracoes', label: 'Configurações', icon: Settings },
]

export function DashboardLayout() {
  const { signOut, user } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { data: adminStatus } = useAdminSession()
  const { can, loading: permsLoading } = usePermissions()
  const isAdminUser = !!adminStatus?.is_admin_user

  // Enquanto o plano não chega, deixa o item visível — melhor que
  // piscar sumindo e aparecendo. A rota protegida mostra o upgrade
  // se o usuário realmente não puder acessar.
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => !item.permission || permsLoading || can(item.permission),
  )

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-background md:flex md:flex-col">
        <SidebarContent
          items={visibleNavItems}
          onNavigate={() => undefined}
          onSignOut={handleSignOut}
          email={user?.email ?? null}
          isAdmin={isAdminUser}
        />
      </aside>

      {/* Topbar mobile */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <Link to="/dashboard" className="font-semibold">
          Minha Agenda
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

      {/* Drawer mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-background shadow-xl">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="font-semibold">Menu</span>
              <button
                type="button"
                aria-label="Fechar menu"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent
              items={visibleNavItems}
              onNavigate={() => setMobileOpen(false)}
              onSignOut={handleSignOut}
              email={user?.email ?? null}
              isAdmin={isAdminUser}
            />
          </div>
        </div>
      )}

      <main className="md:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

interface SidebarContentProps {
  items: NavItem[]
  onNavigate: () => void
  onSignOut: () => void
  email: string | null
  isAdmin: boolean
}

function SidebarContent({ items, onNavigate, onSignOut, email, isAdmin }: SidebarContentProps) {
  return (
    <>
      <div className="hidden h-14 items-center border-b px-6 font-semibold md:flex">
        Minha Agenda
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
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
        {isAdmin && (
          <NavLink
            to="/admin"
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'mt-2 flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-primary/20 text-primary hover:bg-primary/10',
              )
            }
          >
            <ShieldCheck className="h-4 w-4" />
            Área admin
          </NavLink>
        )}
      </nav>
      <div className="border-t p-3">
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

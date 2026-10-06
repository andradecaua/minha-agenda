import { NavLink, Outlet } from 'react-router-dom'
import { CalendarClock, CreditCard, SlidersHorizontal, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const ITEMS = [
  { to: '/dashboard/configuracoes/perfil', label: 'Perfil', icon: User },
  { to: '/dashboard/configuracoes/horarios', label: 'Horários', icon: CalendarClock },
  { to: '/dashboard/configuracoes/agendamento', label: 'Agendamento', icon: SlidersHorizontal },
  { to: '/dashboard/configuracoes/assinatura', label: 'Assinatura', icon: CreditCard },
]

export function SettingsLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Personalize seu perfil público, horários e regras de agendamento.
        </p>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex gap-2 overflow-x-auto md:w-56 md:flex-col md:overflow-visible">
          {ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
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

        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

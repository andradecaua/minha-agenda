import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Images,
  Loader2,
  Package,
  Scissors,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { useDashboardStats } from '@/hooks/queries/useDashboardStats'
import { useMyPlan } from '@/hooks/queries/useMyPermissions'
import { formatCurrencyBRL } from '@/lib/utils'

export function DashboardHomePage() {
  const { data: profile } = useMyProfile()
  const { data: stats, isLoading } = useDashboardStats(profile?.id)
  const { data: myPlan } = useMyPlan()

  const greeting = useGreeting()
  const firstName = profile?.name.split(/\s+/)[0] ?? ''

  // Mostra o convite de upgrade apenas pra quem está no `free`. Qualquer
  // plano pago (mesmo expirado) oculta — a página de assinatura trata
  // "renovar" caso o status não seja `active`.
  const showUpgradeBanner = myPlan?.plan_code === 'free'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}
            {firstName && (
              <>
                , <span className="text-primary">{firstName}</span>
              </>
            )}
            .
          </h1>
          <p className="text-sm text-muted-foreground">
            Visão geral da sua agenda.
          </p>
        </div>
        <Button asChild>
          <Link to="/dashboard/agenda/novo">
            <CalendarPlus className="h-4 w-4" />
            Novo agendamento
          </Link>
        </Button>
      </div>

      {isLoading || !stats ? (
        <StatsSkeleton />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={CalendarCheck}
            label="Hoje"
            value={String(stats.today.count)}
            hint={
              stats.today.count === 0
                ? 'Nenhum agendamento'
                : `${formatCurrencyBRL(stats.today.revenue_cents)} previstos`
            }
          />
          <StatCard
            icon={CalendarDays}
            label="Próximos 7 dias"
            value={String(stats.week.count)}
            hint={stats.week.count === 1 ? 'agendamento' : 'agendamentos'}
          />
          <StatCard
            icon={Users}
            label="Clientes"
            value={String(stats.clients_total)}
            hint="cadastrados"
          />
          <StatCard
            icon={TrendingUp}
            label="Faturamento do mês"
            value={formatCurrencyBRL(stats.month.revenue_cents)}
            hint="atendimentos concluídos"
          />
        </div>
      )}

      {showUpgradeBanner && <UpgradeBanner />}

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Atalhos
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ShortcutCard
            to="/dashboard/agenda"
            icon={CalendarDays}
            title="Agenda"
            description="Ver e gerenciar agendamentos"
          />
          <ShortcutCard
            to="/dashboard/servicos"
            icon={Scissors}
            title="Serviços"
            description="O que você oferece"
          />
          <ShortcutCard
            to="/dashboard/portfolio"
            icon={Images}
            title="Portfólio"
            description="Fotos de trabalhos"
          />
          <ShortcutCard
            to="/dashboard/produtos"
            icon={Package}
            title="Produtos"
            description="Itens que você vende"
          />
        </div>
      </section>
    </div>
  )
}

/* ============================================================ */

interface StatCardProps {
  icon: typeof CalendarCheck
  label: string
  value: string
  hint: string
}

function StatCard({ icon: Icon, label, value, hint }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <CardTitle className="text-3xl">{value}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

function StatsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

interface ShortcutCardProps {
  to: string
  icon: typeof CalendarCheck
  title: string
  description: string
}

function ShortcutCard({ to, icon: Icon, title, description }: ShortcutCardProps) {
  return (
    <Link
      to={to}
      className="group block rounded-xl border bg-background p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <p className="mt-3 font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </Link>
  )
}

function UpgradeBanner() {
  return (
    <Link
      to="/dashboard/configuracoes/assinatura"
      className="group flex flex-col items-start justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5 transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="font-medium">Desbloqueie mais recursos</p>
          <p className="text-sm text-muted-foreground">
            Você está no plano gratuito. Veja os planos pagos e assine com Pix,
            cartão ou boleto.
          </p>
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 self-end rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-transform group-hover:translate-x-0.5 sm:self-auto">
        Ver planos
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </Link>
  )
}

function useGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Boa madrugada'
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

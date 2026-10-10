import {
  CalendarCheck,
  CalendarX,
  Loader2,
  Package,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminMetrics } from '@/hooks/queries/useAdminMetrics'
import { formatCurrencyBRL } from '@/lib/utils'

export function AdminOverviewPage() {
  const { data, isLoading, error } = useAdminMetrics()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Visão geral da plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Métricas agregadas de todos os profissionais. Atualizado sob demanda.
        </p>
      </header>

      {isLoading || !data ? (
        <SkeletonGrid />
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível carregar as métricas. Verifique sua sessão.
        </div>
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Usuários</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Users} label="Total de usuários" value={String(data.users_total)} hint="profissionais cadastrados" />
              <StatCard icon={UserPlus} label="Novos (7 dias)" value={String(data.users_new_7d)} hint="assinaram esta semana" />
              <StatCard icon={UserPlus} label="Novos (30 dias)" value={String(data.users_new_30d)} hint="assinaram no mês" />
              <StatCard icon={ShieldCheck} label="Administradores" value={String(data.admin_count)} hint="com acesso elevado" />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Agendamentos (30 dias)</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={CalendarCheck} label="Criados" value={String(data.appointments_30d)} hint="novos no período" />
              <StatCard icon={CalendarCheck} label="Concluídos" value={String(data.appointments_completed_30d)} hint="atendimentos finalizados" />
              <StatCard icon={CalendarX} label="Cancelados" value={String(data.appointments_cancelled_30d)} hint="cancelados no período" />
              <StatCard icon={TrendingUp} label="Faturamento" value={formatCurrencyBRL(data.revenue_completed_30d_cents)} hint="de concluídos" />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Assinaturas</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={Package} label="Assinaturas ativas" value={String(data.active_subscriptions)} hint="exclui administradores" />
              <StatCard icon={Package} label="Planos ativos" value={String(data.plans_active)} hint="disponíveis para contratar" />
              <StatCard icon={Users} label="Clientes totais" value={String(data.clients_total)} hint="somando todos os profissionais" />
              <StatCard icon={CalendarCheck} label="Agendamentos totais" value={String(data.appointments_total)} hint="histórico completo" />
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            Gerado em {new Date(data.generated_at).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </div>
  )
}

interface StatCardProps {
  icon: typeof Users
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
        <CardTitle className="text-2xl">{value}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
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

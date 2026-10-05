import { supabase } from '@/lib/supabase'

export interface DashboardStats {
  today: {
    count: number
    revenue_cents: number
  }
  week: {
    count: number
  }
  month: {
    revenue_cents: number
  }
  clients_total: number
}

/**
 * Agregações da home do dashboard. Faz 3 queries pequenas e
 * paralelas — não precisa trazer a lista inteira, só as somas.
 *
 * Regras:
 *   - "Hoje" = agendamentos (pending/confirmed/completed) com
 *      start_at >= início do dia local e < início do dia seguinte.
 *      Faturamento = sum(total_price_cents) desses.
 *   - "Semana" = próximos 7 dias (de hoje 00:00 até +7d), mesmos
 *      status.
 *   - "Mês atual" = faturamento (sum) de appointments COMPLETED no
 *      mês corrente.
 *   - Clientes = count da tabela clients.
 */
export async function getDashboardStats(
  professionalId: string,
): Promise<DashboardStats> {
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
  const startOfWeekPlus = new Date(startOfToday)
  startOfWeekPlus.setDate(startOfWeekPlus.getDate() + 7)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [todayRes, weekRes, monthRes, clientsRes] = await Promise.all([
    supabase
      .from('appointments')
      .select('total_price_cents, status')
      .eq('professional_id', professionalId)
      .in('status', ['pending', 'confirmed', 'completed'])
      .gte('start_at', startOfToday.toISOString())
      .lt('start_at', startOfTomorrow.toISOString()),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('professional_id', professionalId)
      .in('status', ['pending', 'confirmed', 'completed'])
      .gte('start_at', startOfToday.toISOString())
      .lt('start_at', startOfWeekPlus.toISOString()),
    supabase
      .from('appointments')
      .select('total_price_cents')
      .eq('professional_id', professionalId)
      .eq('status', 'completed')
      .gte('start_at', startOfMonth.toISOString())
      .lt('start_at', startOfNextMonth.toISOString()),
    supabase
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .eq('professional_id', professionalId),
  ])

  if (todayRes.error) throw todayRes.error
  if (weekRes.error) throw weekRes.error
  if (monthRes.error) throw monthRes.error
  if (clientsRes.error) throw clientsRes.error

  const todayRows = (todayRes.data ?? []) as Array<{
    total_price_cents: number
    status: string
  }>
  const todayRevenue = todayRows.reduce((acc, a) => acc + a.total_price_cents, 0)

  const monthRows = (monthRes.data ?? []) as Array<{ total_price_cents: number }>
  const monthRevenue = monthRows.reduce((acc, a) => acc + a.total_price_cents, 0)

  return {
    today: {
      count: todayRows.length,
      revenue_cents: todayRevenue,
    },
    week: {
      count: weekRes.count ?? 0,
    },
    month: {
      revenue_cents: monthRevenue,
    },
    clients_total: clientsRes.count ?? 0,
  }
}

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarX, Clock, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { useAppointmentsRange } from '@/hooks/queries/useAppointmentsRange'
import type { AppointmentDetails } from '@/services/appointments'
import { formatCurrencyBRL, formatMinutesDuration, cn } from '@/lib/utils'
import { MiniCalendar, dateKey } from './MiniCalendar'
import { AppointmentDetailsDialog, StatusChip } from './AppointmentDetails'

export function AgendaPage() {
  const { data: profile } = useMyProfile()

  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()))
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  // Guardamos APENAS o id — o appointment atual é derivado da query a
  // cada render, assim as mudanças de status refletem no dialog aberto.
  const [openedId, setOpenedId] = useState<string | null>(null)

  // Faixa consultada = mês visível ± 7 dias de margem, para cobrir
  // dias "spill-over" que aparecem no mini calendário.
  const { from, to } = useMemo(() => {
    const start = new Date(visibleMonth)
    start.setDate(start.getDate() - 7)
    start.setHours(0, 0, 0, 0)
    const end = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1)
    end.setDate(end.getDate() + 7)
    end.setHours(0, 0, 0, 0)
    return { from: start, to: end }
  }, [visibleMonth])

  const { data: appointments, isLoading } = useAppointmentsRange(profile?.id, from, to)

  const daysWithAppointments = useMemo(() => {
    const set = new Set<string>()
    for (const a of appointments ?? []) {
      if (a.status === 'cancelled') continue
      set.add(dateKey(new Date(a.start_at)))
    }
    return set
  }, [appointments])

  const dayAppointments = useMemo(() => {
    const key = dateKey(selectedDate)
    return (appointments ?? [])
      .filter((a) => dateKey(new Date(a.start_at)) === key)
      .sort(
        (x, y) => new Date(x.start_at).getTime() - new Date(y.start_at).getTime(),
      )
  }, [appointments, selectedDate])

  const dayTotal = dayAppointments
    .filter((a) => a.status === 'confirmed' || a.status === 'completed')
    .reduce((acc, a) => acc + a.total_price_cents, 0)

  const opened = openedId
    ? (appointments ?? []).find((a) => a.id === openedId) ?? null
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Visualize e gerencie seus agendamentos.
          </p>
        </div>
        <Button asChild>
          <Link
            to={`/dashboard/agenda/novo?date=${encodeURIComponent(dateKey(selectedDate))}`}
          >
            <Plus className="h-4 w-4" />
            Novo agendamento
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <MiniCalendar
          month={visibleMonth}
          onMonthChange={setVisibleMonth}
          selected={selectedDate}
          onSelect={setSelectedDate}
          daysWithAppointments={daysWithAppointments}
        />

        <div className="space-y-4">
          <DayHeader
            date={selectedDate}
            count={dayAppointments.length}
            revenue={dayTotal}
          />

          {isLoading ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Carregando...
              </CardContent>
            </Card>
          ) : dayAppointments.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-10 text-center text-sm text-muted-foreground">
                <CalendarX className="mb-2 h-6 w-6" aria-hidden="true" />
                Nenhum agendamento para este dia.
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-2">
              {dayAppointments.map((a) => (
                <li key={a.id}>
                  <AppointmentRow
                    appointment={a}
                    onClick={() => setOpenedId(a.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <AppointmentDetailsDialog
        open={!!opened}
        onClose={() => setOpenedId(null)}
        appointment={opened}
      />
    </div>
  )
}

/* ============================================================ */

function DayHeader({
  date,
  count,
  revenue,
}: {
  date: Date
  count: number
  revenue: number
}) {
  const label = date.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold capitalize">{label}</h2>
        <p className="text-sm text-muted-foreground">
          {count === 0
            ? 'Nenhum agendamento'
            : `${count} ${count === 1 ? 'agendamento' : 'agendamentos'}`}
        </p>
      </div>
      {count > 0 && (
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Previsto no dia</p>
          <p className="text-lg font-semibold">{formatCurrencyBRL(revenue)}</p>
        </div>
      )}
    </div>
  )
}

interface AppointmentRowProps {
  appointment: AppointmentDetails
  onClick: () => void
}

function AppointmentRow({ appointment, onClick }: AppointmentRowProps) {
  const start = new Date(appointment.start_at)
  const end = new Date(appointment.end_at)
  const time = start.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const endTime = end.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const servicesSummary =
    appointment.services.length === 1
      ? appointment.services[0]!.service.name
      : `${appointment.services[0]!.service.name} +${appointment.services.length - 1}`

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border bg-background p-4 text-left transition-colors',
        'hover:border-foreground/20 hover:bg-accent/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        appointment.status === 'cancelled' && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 text-center">
          <p className="text-sm font-semibold leading-none">{time}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">até {endTime}</p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{appointment.client.name}</p>
            <StatusChip status={appointment.status} />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {servicesSummary}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatMinutesDuration(appointment.total_duration_minutes)}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-semibold">
            {formatCurrencyBRL(appointment.total_price_cents)}
          </p>
        </div>
      </div>
    </button>
  )
}

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

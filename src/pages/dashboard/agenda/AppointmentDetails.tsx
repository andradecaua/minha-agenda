import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  Check,
  CheckCircle2,
  Loader2,
  MessageCircle,
  Phone,
  UserX,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { updateAppointmentStatus, type AppointmentDetails } from '@/services/appointments'
import { APPOINTMENT_STATUS_LABEL, type AppointmentStatus } from '@/types/domain'
import { formatCurrencyBRL, formatMinutesDuration } from '@/lib/utils'
import { formatPhoneBR, telLink, waLinkBR } from '@/lib/phone'
import { cn } from '@/lib/utils'

interface AppointmentDetailsDialogProps {
  open: boolean
  onClose: () => void
  appointment: AppointmentDetails | null
}

export function AppointmentDetailsDialog({
  open,
  onClose,
  appointment,
}: AppointmentDetailsDialogProps) {
  const queryClient = useQueryClient()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AppointmentStatus }) =>
      updateAppointmentStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      setError(null)
    },
    onError: () => {
      setError('Não foi possível atualizar. Tente novamente.')
    },
  })

  if (!appointment) return null

  const start = new Date(appointment.start_at)
  const end = new Date(appointment.end_at)
  const dateStr = start.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
  const timeStr = `${start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`

  function act(status: AppointmentStatus) {
    setError(null)
    mutation.mutate({ id: appointment!.id, status })
  }

  const now = new Date()
  const ended = end <= now

  const canCancel = appointment.status === 'pending' || appointment.status === 'confirmed'
  const canConfirm = appointment.status === 'pending'
  // Só pode concluir DEPOIS do horário final — para evitar baixa precoce.
  const canComplete = appointment.status === 'confirmed' && ended
  const canNoShow =
    (appointment.status === 'confirmed' || appointment.status === 'pending') && ended

  return (
    <>
      <Dialog
        open={open}
        onClose={() => {
          if (mutation.isPending) return
          onClose()
        }}
        title="Agendamento"
        description={`${dateStr} · ${timeStr}`}
        size="md"
      >
        <div className="space-y-5">
          <StatusChip status={appointment.status} />

          {/* Cliente */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Cliente</h3>
            <div className="rounded-xl border bg-muted/20 p-3">
              <p className="font-medium">{appointment.client.name}</p>
              {appointment.client.phone && (
                <p className="text-sm text-muted-foreground">
                  {formatPhoneBR(appointment.client.phone)}
                </p>
              )}
              {appointment.client.email && (
                <p className="text-sm text-muted-foreground truncate">
                  {appointment.client.email}
                </p>
              )}
              {appointment.client.phone && (
                <div className="mt-3 flex gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={telLink(appointment.client.phone)}>
                      <Phone className="h-3.5 w-3.5" />
                      Ligar
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={waLinkBR(
                        appointment.client.phone,
                        `Olá, ${appointment.client.name}! Falando sobre seu agendamento.`,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </section>

          {/* Serviços */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Serviços</h3>
            <div className="rounded-xl border bg-muted/20 p-3">
              <ul className="space-y-1 text-sm">
                {appointment.services.map((line) => (
                  <li key={line.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      {line.service.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatCurrencyBRL(line.price_cents_snapshot)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
                <span className="text-muted-foreground">
                  {formatMinutesDuration(appointment.total_duration_minutes)}
                </span>
                <span className="text-base font-semibold">
                  {formatCurrencyBRL(appointment.total_price_cents)}
                </span>
              </div>
            </div>
          </section>

          {/* Observações */}
          {appointment.notes && (
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Observações</h3>
              <p className="rounded-xl border bg-muted/20 p-3 text-sm text-muted-foreground">
                {appointment.notes}
              </p>
            </section>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {/* Ações */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              {canConfirm && (
                <Button
                  size="sm"
                  onClick={() => act('confirmed')}
                  disabled={mutation.isPending}
                >
                  <Check className="h-4 w-4" />
                  Confirmar
                </Button>
              )}
              {canComplete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act('completed')}
                  disabled={mutation.isPending}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Concluir
                </Button>
              )}
              {canNoShow && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => act('no_show')}
                  disabled={mutation.isPending}
                >
                  <UserX className="h-4 w-4" />
                  Não compareceu
                </Button>
              )}
              {canCancel && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmCancel(true)}
                  disabled={mutation.isPending}
                >
                  <Ban className="h-4 w-4" />
                  Cancelar
                </Button>
              )}
              {mutation.isPending && (
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  atualizando...
                </span>
              )}
            </div>

            {!ended &&
              (appointment.status === 'confirmed' ||
                appointment.status === 'pending') && (
                <p className="text-xs text-muted-foreground">
                  Concluir e marcar como "não compareceu" ficam disponíveis
                  após o horário final do atendimento.
                </p>
              )}
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false)
          act('cancelled')
        }}
        title="Cancelar agendamento?"
        description="O cliente deixará de ocupar esse horário. Essa ação não pode ser desfeita."
        confirmLabel="Cancelar agendamento"
        cancelLabel="Voltar"
        destructive
      />
    </>
  )
}

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-emerald-100 text-emerald-900',
  completed: 'bg-primary/10 text-primary',
  cancelled: 'bg-muted text-muted-foreground line-through',
  no_show: 'bg-destructive/10 text-destructive',
}

export function StatusChip({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLE[status],
      )}
    >
      {APPOINTMENT_STATUS_LABEL[status]}
    </span>
  )
}

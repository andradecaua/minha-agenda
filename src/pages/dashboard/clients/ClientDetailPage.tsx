import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, MessageCircle, Phone } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useClient, clientsQueryKey } from '@/hooks/queries/useClients'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { updateClientNotes } from '@/services/clients'
import { StatusChip } from '@/pages/dashboard/agenda/AppointmentDetails'
import { formatCurrencyBRL, formatMinutesDuration } from '@/lib/utils'
import { formatPhoneBR, isValidPhoneBR, telLink, waLinkBR } from '@/lib/phone'
import type { ClientHistoryItem } from '@/services/clients'

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { data: profile } = useMyProfile()
  const { data: client, isLoading } = useClient(id)

  const [notes, setNotes] = useState('')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)

  useEffect(() => {
    if (client) setNotes(client.notes ?? '')
  }, [client])

  const notesMutation = useMutation({
    mutationFn: (value: string) => {
      if (!id) throw new Error('id ausente')
      return updateClientNotes(id, value.trim() || null)
    },
    onSuccess: () => {
      setSavedAt(new Date())
      setNotesError(null)
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      if (profile) {
        queryClient.invalidateQueries({ queryKey: clientsQueryKey(profile.id) })
      }
    },
    onError: () => {
      setNotesError('Não foi possível salvar. Tente novamente.')
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando cliente...
        </CardContent>
      </Card>
    )
  }

  if (!client) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Cliente não encontrado.
          <div className="mt-4">
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/clientes">Voltar para a lista</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const phoneValid = !!client.phone && isValidPhoneBR(client.phone)
  const firstLabel = client.first_appointment_at
    ? new Date(client.first_appointment_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'
  const lastLabel = client.last_appointment_at
    ? new Date(client.last_appointment_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'

  const notesChanged = (client.notes ?? '') !== notes

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/dashboard/clientes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Clientes
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{client.name}</CardTitle>
          <CardDescription>
            {client.phone ? formatPhoneBR(client.phone) : 'sem telefone'}
            {client.email ? ` · ${client.email}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {phoneValid && (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href={telLink(client.phone!)}>
                  <Phone className="h-4 w-4" />
                  Ligar
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a
                  href={waLinkBR(
                    client.phone!,
                    `Olá, ${client.name}! Falando sobre seus atendimentos.`,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Agendamentos" value={String(client.appointments_count)} />
        <StatCard label="Concluídos" value={String(client.completed_count)} />
        <StatCard
          label="Total gasto"
          value={formatCurrencyBRL(client.total_spent_cents)}
        />
        <StatCard label="Primeiro / último" value={`${firstLabel} · ${lastLabel}`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Observações</CardTitle>
          <CardDescription>
            Visíveis apenas para você. Útil para preferências, alergias ou lembretes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: prefere corte mais curto nas laterais."
          />
          {notesError && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {notesError}
            </p>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {savedAt
                ? `Salvo às ${savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </span>
            <Button
              size="sm"
              onClick={() => notesMutation.mutate(notes)}
              disabled={!notesChanged || notesMutation.isPending}
            >
              {notesMutation.isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Histórico</h2>
        {client.history.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nenhum agendamento registrado.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {client.history.map((h) => (
              <li key={h.id}>
                <HistoryRow item={h} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function HistoryRow({ item }: { item: ClientHistoryItem }) {
  const start = new Date(item.start_at)
  const dateStr = start.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const timeStr = start.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const summary =
    item.services.length === 0
      ? '—'
      : item.services.length === 1
        ? item.services[0]!.name ?? '—'
        : `${item.services[0]!.name ?? '—'} +${item.services.length - 1}`

  return (
    <div className="rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">
              {dateStr}
              <span className="text-muted-foreground"> · {timeStr}</span>
            </p>
            <StatusChip status={item.status} />
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {summary}
          </p>
          {item.notes && (
            <p className="mt-2 text-sm text-muted-foreground border-l-2 pl-3">
              {item.notes}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold">
            {formatCurrencyBRL(item.total_price_cents)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatMinutesDuration(item.total_duration_minutes)}
          </p>
        </div>
      </div>
    </div>
  )
}

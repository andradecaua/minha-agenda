import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Clock, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { useServices } from '@/hooks/queries/useServices'
import { useClients } from '@/hooks/queries/useClients'
import { useAvailableSlots } from '@/hooks/queries/useAvailableSlots'
import { createAppointmentManual } from '@/services/appointments'
import { BOOKING_ERROR_LABEL, type AppointmentStatus } from '@/types/domain'
import { isValidPhoneBR, normalizePhone } from '@/lib/phone'
import { formatCurrencyBRL, formatMinutesDuration, cn } from '@/lib/utils'
import { ClientPicker, type ClientSelection } from './ClientPicker'
import { SlotsGrid } from '@/pages/public/booking/SlotsGrid'

type TimeMode = 'free' | 'suggestions'

export function NewAppointmentPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const initialDate = useMemo(() => {
    const d = params.get('date')
    if (!d) return new Date()
    const parsed = new Date(`${d}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed
  }, [params])

  const { data: profile } = useMyProfile()
  const { data: services } = useServices(profile?.id)
  const { data: clients } = useClients(profile?.id)

  const [client, setClient] = useState<ClientSelection>({ kind: 'none' })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [dateStr, setDateStr] = useState(() => toInputDate(initialDate))
  const [timeMode, setTimeMode] = useState<TimeMode>('free')
  const [timeStr, setTimeStr] = useState('09:00')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<AppointmentStatus>('confirmed')
  const [serverError, setServerError] = useState<string | null>(null)

  const onlyActive = useMemo(
    () => (services ?? []).filter((s) => s.active),
    [services],
  )
  const selectedServices = useMemo(
    () => selectedIds.map((id) => onlyActive.find((s) => s.id === id)!).filter(Boolean),
    [onlyActive, selectedIds],
  )
  const totalDuration = selectedServices.reduce((a, s) => a + s.duration_minutes, 0)
  const totalPrice = selectedServices.reduce((a, s) => a + s.price_cents, 0)

  const dateObj = useMemo(() => {
    if (!dateStr) return null
    const d = new Date(`${dateStr}T00:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }, [dateStr])

  // Slots sugeridos (só carrega quando modo = 'suggestions' e tem serviços escolhidos)
  const slotsQuery = useAvailableSlots(
    timeMode === 'suggestions' && profile ? profile.slug : undefined,
    timeMode === 'suggestions' ? selectedIds : [],
    timeMode === 'suggestions' ? dateObj : null,
  )

  // Setar status default conforme serviços escolhidos (admin sempre pode trocar)
  const todayInput = toInputDate(new Date())
  const isToday = dateStr === todayInput
  const minTimeToday = useMemo(() => {
    if (!isToday) return undefined
    const n = new Date()
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
  }, [isToday])

  const mutation = useMutation({
    mutationFn: () => {
      if (selectedIds.length === 0) throw new Error('nenhum serviço')
      if (!dateStr || !timeStr) throw new Error('data/hora ausentes')
      const startAt = new Date(`${dateStr}T${timeStr}:00`)
      const base = {
        serviceIds: selectedIds,
        startAt,
        notes: notes.trim() || null,
        status,
      }
      if (client.kind === 'existing') {
        return createAppointmentManual({ ...base, clientId: client.clientId })
      }
      if (client.kind === 'new') {
        return createAppointmentManual({
          ...base,
          clientName: client.name,
          clientPhone: normalizePhone(client.phone),
          clientEmail: client.email || null,
        })
      }
      throw new Error('cliente ausente')
    },
    onSuccess: (res) => {
      if (res.status === 'ok') {
        queryClient.invalidateQueries({ queryKey: ['appointments'] })
        navigate('/dashboard/agenda')
      } else {
        setServerError(BOOKING_ERROR_LABEL[res.error] ?? `Erro: ${res.error}`)
      }
    },
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error('createAppointmentManual failed:', err)
      const msg = err instanceof Error ? err.message : 'Falha ao criar agendamento.'
      if (msg.toLowerCase().includes('find the function')) {
        setServerError(
          'A migration 0013 não foi aplicada. Rode supabase/migrations/0013_admin_create_appointment.sql no SQL Editor.',
        )
      } else {
        setServerError(msg)
      }
    },
  })

  function validate(): string | null {
    if (client.kind === 'none') return 'Selecione um cliente ou cadastre um novo.'
    if (client.kind === 'new') {
      if (!client.name.trim()) return 'Informe o nome do cliente.'
      if (!isValidPhoneBR(normalizePhone(client.phone))) {
        return 'Telefone inválido (DDD + número).'
      }
    }
    if (selectedIds.length === 0) return 'Selecione pelo menos um serviço.'
    if (!dateStr || !timeStr) return 'Informe data e horário.'
    const startAt = new Date(`${dateStr}T${timeStr}:00`)
    if (Number.isNaN(startAt.getTime())) return 'Data/horário inválidos.'
    if (startAt.getTime() < Date.now() - 60_000) {
      return 'Não é possível agendar para uma data/hora que já passou.'
    }
    return null
  }

  function handleSubmit() {
    const err = validate()
    if (err) {
      setServerError(err)
      return
    }
    setServerError(null)
    mutation.mutate()
  }

  function toggleService(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  // Quando um slot sugerido é escolhido, muda o modo pra 'free' já com o horário.
  function pickSuggestedSlot(iso: string) {
    const d = new Date(iso)
    const h = String(d.getHours()).padStart(2, '0')
    const m = String(d.getMinutes()).padStart(2, '0')
    setTimeStr(`${h}:${m}`)
  }

  const canSubmit = !mutation.isPending

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/dashboard/agenda"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Agenda
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo agendamento</h1>
        <p className="text-sm text-muted-foreground">
          Marque um atendimento manualmente — você pode encaixar fora do expediente.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Coluna principal - form */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Cliente</CardTitle>
              <CardDescription>
                Escolha alguém que já atendeu ou cadastre agora.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ClientPicker clients={clients ?? []} value={client} onChange={setClient} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Serviços</CardTitle>
              <CardDescription>
                Marque um ou mais — a duração total soma automaticamente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {onlyActive.length === 0 ? (
                <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Nenhum serviço ativo. Crie um em{' '}
                  <Link to="/dashboard/servicos" className="underline">
                    Serviços
                  </Link>
                  .
                </p>
              ) : (
                <ul className="grid gap-2">
                  {onlyActive.map((svc) => {
                    const selected = selectedIds.includes(svc.id)
                    return (
                      <li key={svc.id}>
                        <button
                          type="button"
                          onClick={() => toggleService(svc.id)}
                          aria-pressed={selected}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                            selected
                              ? 'border-primary bg-primary/5'
                              : 'bg-background hover:border-foreground/20 hover:bg-accent/40',
                          )}
                        >
                          <div
                            className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                              selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input',
                            )}
                          >
                            {selected && <Check className="h-3.5 w-3.5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{svc.name}</p>
                            {svc.description && (
                              <p className="line-clamp-1 text-xs text-muted-foreground">
                                {svc.description}
                              </p>
                            )}
                            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {formatMinutesDuration(svc.duration_minutes)}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-medium">
                            {formatCurrencyBRL(svc.price_cents)}
                          </p>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quando</CardTitle>
              <CardDescription>
                Escolha o horário diretamente ou veja as sugestões disponíveis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="na-date">Data</Label>
                  <Input
                    id="na-date"
                    type="date"
                    min={todayInput}
                    value={dateStr}
                    onChange={(e) => setDateStr(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="na-time">Horário</Label>
                  <Input
                    id="na-time"
                    type="time"
                    min={minTimeToday}
                    value={timeStr}
                    onChange={(e) => setTimeStr(e.target.value)}
                  />
                  {isToday && (
                    <p className="text-xs text-muted-foreground">
                      Hoje: só horários a partir de agora.
                    </p>
                  )}
                </div>
              </div>

              {/* Toggle: ver sugestões */}
              <div className="rounded-xl border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Sugestões disponíveis</p>
                    <p className="text-xs text-muted-foreground">
                      Mostra apenas horários livres no expediente — opcional.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={timeMode === 'suggestions' ? 'default' : 'outline'}
                    onClick={() =>
                      setTimeMode(timeMode === 'suggestions' ? 'free' : 'suggestions')
                    }
                    disabled={selectedIds.length === 0}
                  >
                    {timeMode === 'suggestions' ? 'Ocultar' : 'Ver sugestões'}
                  </Button>
                </div>
                {timeMode === 'suggestions' && (
                  <div className="mt-3">
                    <SlotsGrid
                      slots={slotsQuery.data ?? []}
                      selected={null}
                      onSelect={pickSuggestedSlot}
                      loading={slotsQuery.isLoading || slotsQuery.isFetching}
                    />
                    {!slotsQuery.isLoading && (slotsQuery.data?.length ?? 0) > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Dica: clicar numa sugestão preenche o horário acima.
                      </p>
                    )}
                  </div>
                )}
                {selectedIds.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Escolha os serviços primeiro para ver sugestões.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Observações</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Combinado por WhatsApp, cliente VIP, preferências..."
              />
            </CardContent>
          </Card>
        </div>

        {/* Coluna lateral — resumo + CTA */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Resumo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Row label="Cliente">
                {client.kind === 'existing' ? (
                  client.name
                ) : client.kind === 'new' ? (
                  client.name || <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="text-muted-foreground">não escolhido</span>
                )}
              </Row>

              <div>
                <p className="text-xs text-muted-foreground">Serviços</p>
                {selectedServices.length === 0 ? (
                  <p className="text-muted-foreground">nenhum</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {selectedServices.map((s) => (
                      <li key={s.id} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">{s.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatCurrencyBRL(s.price_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Row label="Quando">
                {dateObj && timeStr ? (
                  <>
                    {dateObj.toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}{' '}
                    às {timeStr}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>

              <Row label="Duração">
                {totalDuration > 0 ? (
                  formatMinutesDuration(totalDuration)
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Row>

              <div className="flex items-center justify-between border-t pt-3">
                <span className="text-xs text-muted-foreground">Total</span>
                <span className="text-base font-semibold">
                  {formatCurrencyBRL(totalPrice)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status inicial</CardTitle>
              <CardDescription>Como entra na agenda ao salvar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <StatusOption
                label="Confirmado"
                description="Já combinado — bloqueia o horário imediatamente."
                selected={status === 'confirmed'}
                onClick={() => setStatus('confirmed')}
              />
              <StatusOption
                label="Pendente"
                description="Aguardando confirmação. Também reserva o horário."
                selected={status === 'pending'}
                onClick={() => setStatus('pending')}
              />
            </CardContent>
          </Card>

          {serverError && (
            <Card>
              <CardContent className="py-3 text-sm text-destructive" role="alert">
                {serverError}
              </CardContent>
            </Card>
          )}

          <Button
            size="lg"
            className="w-full"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Criando...
              </>
            ) : (
              'Criar agendamento'
            )}
          </Button>

          <Button
            variant="outline"
            className="w-full"
            asChild
            disabled={mutation.isPending}
          >
            <Link to="/dashboard/agenda">Cancelar</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

function toInputDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  )
}

interface StatusOptionProps {
  label: string
  description: string
  selected: boolean
  onClick: () => void
}

function StatusOption({ label, description, selected, onClick }: StatusOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5'
          : 'bg-background hover:border-foreground/20 hover:bg-accent/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        {selected && <Check className="h-4 w-4 text-primary" />}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </button>
  )
}


import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Clock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PhoneInput } from '@/components/ui/phone-input'
import type { BookingSettings, Service } from '@/types/database'
import { bookAppointment } from '@/services/booking'
import { useAvailableSlots } from '@/hooks/queries/useAvailableSlots'
import { BOOKING_ERROR_LABEL } from '@/types/domain'
import { isValidPhoneBR, normalizePhone } from '@/lib/phone'
import { formatCurrencyBRL, formatMinutesDuration } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { DateStrip } from './DateStrip'
import { SlotsGrid } from './SlotsGrid'

interface BookingFlowProps {
  open: boolean
  onClose: () => void
  slug: string
  professionalName: string
  services: Service[]
  settings: BookingSettings | null
}

type Step = 'services' | 'when' | 'details'

export function BookingFlow({
  open,
  onClose,
  slug,
  professionalName,
  services,
  settings,
}: BookingFlowProps) {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('services')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [date, setDate] = useState<Date | null>(null)
  const [slotISO, setSlotISO] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Reset ao abrir/fechar — zera tudo quando o Dialog fecha.
  useEffect(() => {
    if (open) {
      setStep('services')
      // Pré-seleciona se só existe um serviço
      setSelectedIds(services.length === 1 ? [services[0]!.id] : [])
    } else {
      const t = setTimeout(() => {
        setStep('services')
        setSelectedIds([])
        setDate(null)
        setSlotISO(null)
        setName('')
        setPhone('')
        setEmail('')
        setNotes('')
        setFormError(null)
      }, 150)
      return () => clearTimeout(t)
    }
  }, [open, services])

  const selectedServices = useMemo(
    () => selectedIds.map((id) => services.find((s) => s.id === id)!).filter(Boolean),
    [selectedIds, services],
  )

  const totalDuration = selectedServices.reduce(
    (acc, s) => acc + s.duration_minutes,
    0,
  )
  const totalPrice = selectedServices.reduce((acc, s) => acc + s.price_cents, 0)

  const maxDays = settings?.maximum_advance_days ?? 30
  const slotsQuery = useAvailableSlots(slug, selectedIds, date)

  async function handleSubmit() {
    if (selectedIds.length === 0 || !slotISO) return
    setFormError(null)

    if (!name.trim()) {
      setFormError('Informe seu nome.')
      return
    }
    const digits = normalizePhone(phone)
    if (!isValidPhoneBR(digits)) {
      setFormError('Telefone inválido (DDD + número).')
      return
    }

    setSubmitting(true)
    try {
      const result = await bookAppointment({
        slug,
        serviceIds: selectedIds,
        startAt: slotISO,
        clientName: name.trim(),
        clientPhone: digits,
        clientEmail: email.trim() || null,
        notes: notes.trim() || null,
      })

      if (result.status === 'ok') {
        // Fecha o modal e leva o cliente para a página do próprio
        // agendamento — a URL já serve de "comprovante": pode favoritar,
        // compartilhar e voltar depois para cancelar.
        onClose()
        navigate(`/p/${slug}/a/${result.cancel_token}?created=1`)
        return
      } else {
        setFormError(
          BOOKING_ERROR_LABEL[result.error] ??
            'Não foi possível concluir o agendamento.',
        )
      }
    } catch {
      setFormError('Falha de conexão. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  const title = useMemo(() => {
    if (step === 'services') return 'Escolha os serviços'
    if (step === 'when') return 'Quando?'
    if (step === 'details') return 'Seus dados'
    return 'Agendar'
  }, [step])

  const description = useMemo(() => {
    if (step === 'services')
      return `Com ${professionalName}. Selecione um ou mais.`
    if (step === 'when' && selectedServices.length > 0)
      return `${selectedServices.length} ${selectedServices.length === 1 ? 'serviço' : 'serviços'} · ${formatMinutesDuration(totalDuration)} · ${formatCurrencyBRL(totalPrice)}`
    if (step === 'details') return 'Para confirmarmos sua reserva.'
    return undefined
  }, [step, selectedServices.length, totalDuration, totalPrice, professionalName])

  function back() {
    setFormError(null)
    if (step === 'details') setStep('when')
    else if (step === 'when') setStep('services')
  }

  function toggleService(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
    // Serviços mudaram → invalida data/slot escolhidos (duração total mudou)
    setDate(null)
    setSlotISO(null)
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (submitting) return
        onClose()
      }}
      title={title}
      description={description}
      size="lg"
    >
      {step !== 'services' && (
        <button
          type="button"
          onClick={back}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </button>
      )}

      {step === 'services' && (
        <ServicesStep
          services={services}
          selectedIds={selectedIds}
          onToggle={toggleService}
          totalDuration={totalDuration}
          totalPrice={totalPrice}
          onContinue={() => setStep('when')}
        />
      )}

      {step === 'when' && selectedIds.length > 0 && (
        <WhenStep
          date={date}
          onDate={(d) => {
            setDate(d)
            setSlotISO(null)
          }}
          slots={slotsQuery.data ?? []}
          slotsLoading={slotsQuery.isLoading || slotsQuery.isFetching}
          selectedSlot={slotISO}
          onSlot={(iso) => {
            setSlotISO(iso)
            setStep('details')
          }}
          maxDays={maxDays}
        />
      )}

      {step === 'details' && selectedServices.length > 0 && slotISO && (
        <DetailsStep
          services={selectedServices}
          slotISO={slotISO}
          totalDuration={totalDuration}
          totalPrice={totalPrice}
          name={name}
          onName={setName}
          phone={phone}
          onPhone={setPhone}
          email={email}
          onEmail={setEmail}
          notes={notes}
          onNotes={setNotes}
          onSubmit={handleSubmit}
          submitting={submitting}
          errorMessage={formError}
          requireConfirmation={!!settings?.require_confirmation}
        />
      )}

    </Dialog>
  )
}

/* ============================================================
 * Step: Serviços (multi-seleção)
 * ============================================================ */

interface ServicesStepProps {
  services: Service[]
  selectedIds: string[]
  onToggle: (id: string) => void
  totalDuration: number
  totalPrice: number
  onContinue: () => void
}

function ServicesStep({
  services,
  selectedIds,
  onToggle,
  totalDuration,
  totalPrice,
  onContinue,
}: ServicesStepProps) {
  if (services.length === 0) {
    return (
      <p className="rounded-md border bg-muted/20 py-6 text-center text-sm text-muted-foreground">
        Nenhum serviço disponível para agendamento no momento.
      </p>
    )
  }

  const count = selectedIds.length

  return (
    <div className="space-y-4">
      <ul className="grid gap-2">
        {services.map((svc) => {
          const selected = selectedIds.includes(svc.id)
          return (
            <li key={svc.id}>
              <button
                type="button"
                onClick={() => onToggle(svc.id)}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'bg-background hover:border-foreground/20 hover:bg-accent/40',
                )}
              >
                <div
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input',
                  )}
                >
                  {selected && <Check className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{svc.name}</p>
                  {svc.description && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                      {svc.description}
                    </p>
                  )}
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {formatMinutesDuration(svc.duration_minutes)}
                  </p>
                </div>
                <p className="shrink-0 text-base font-semibold">
                  {formatCurrencyBRL(svc.price_cents)}
                </p>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="sticky bottom-0 -mx-5 border-t bg-background/95 px-5 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            {count === 0 ? (
              <span className="text-muted-foreground">
                Selecione pelo menos um serviço.
              </span>
            ) : (
              <>
                <span className="font-medium">
                  {count} {count === 1 ? 'serviço' : 'serviços'}
                </span>
                <span className="text-muted-foreground">
                  {' · '}
                  {formatMinutesDuration(totalDuration)} ·{' '}
                  {formatCurrencyBRL(totalPrice)}
                </span>
              </>
            )}
          </div>
          <Button onClick={onContinue} disabled={count === 0}>
            Continuar
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * Step: Quando
 * ============================================================ */

interface WhenStepProps {
  date: Date | null
  onDate: (d: Date) => void
  slots: string[]
  slotsLoading: boolean
  selectedSlot: string | null
  onSlot: (iso: string) => void
  maxDays: number
}

function WhenStep({
  date,
  onDate,
  slots,
  slotsLoading,
  selectedSlot,
  onSlot,
  maxDays,
}: WhenStepProps) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-medium">Data</h3>
        <DateStrip
          selected={date}
          onSelect={onDate}
          days={Math.min(Math.max(maxDays, 7), 60)}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Horário</h3>
        {date ? (
          <SlotsGrid
            slots={slots}
            selected={selectedSlot}
            onSelect={onSlot}
            loading={slotsLoading}
          />
        ) : (
          <p className="rounded-md border bg-muted/20 py-6 text-center text-sm text-muted-foreground">
            Escolha uma data acima.
          </p>
        )}
      </div>
    </div>
  )
}

/* ============================================================
 * Step: Dados do cliente
 * ============================================================ */

interface DetailsStepProps {
  services: Service[]
  slotISO: string
  totalDuration: number
  totalPrice: number
  name: string
  onName: (v: string) => void
  phone: string
  onPhone: (v: string) => void
  email: string
  onEmail: (v: string) => void
  notes: string
  onNotes: (v: string) => void
  onSubmit: () => void
  submitting: boolean
  errorMessage: string | null
  requireConfirmation: boolean
}

function DetailsStep({
  services,
  slotISO,
  totalDuration,
  totalPrice,
  name,
  onName,
  phone,
  onPhone,
  email,
  onEmail,
  notes,
  onNotes,
  onSubmit,
  submitting,
  errorMessage,
  requireConfirmation,
}: DetailsStepProps) {
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <Summary
        services={services}
        slotISO={slotISO}
        totalDuration={totalDuration}
        totalPrice={totalPrice}
      />

      <div className="space-y-2">
        <Label htmlFor="bk-name">Nome</Label>
        <Input
          id="bk-name"
          autoComplete="name"
          required
          value={name}
          onChange={(e) => onName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bk-phone">Telefone</Label>
        <PhoneInput id="bk-phone" value={normalizePhone(phone)} onChange={onPhone} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bk-email">E-mail (opcional)</Label>
        <Input
          id="bk-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bk-notes">Observações (opcional)</Label>
        <Textarea
          id="bk-notes"
          rows={2}
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="Algo que o profissional precise saber."
        />
      </div>

      {errorMessage && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      )}

      {requireConfirmation && (
        <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
          O profissional precisa <strong>confirmar</strong> este agendamento.
          Você receberá contato se for aceito.
        </p>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={submitting}>
        {submitting ? 'Enviando...' : requireConfirmation ? 'Solicitar agendamento' : 'Confirmar agendamento'}
      </Button>
    </form>
  )
}

interface SummaryProps {
  services: Service[]
  slotISO: string
  totalDuration: number
  totalPrice: number
}

function Summary({ services, slotISO, totalDuration, totalPrice }: SummaryProps) {
  const d = new Date(slotISO)
  const date = d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
  const time = d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <ul className="space-y-1 text-sm">
        {services.map((s) => (
          <li key={s.id} className="flex items-start justify-between gap-3">
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatCurrencyBRL(s.price_cents)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm">
        <span className="text-muted-foreground">
          {date} às {time} · {formatMinutesDuration(totalDuration)}
        </span>
        <span className="text-base font-semibold">
          {formatCurrencyBRL(totalPrice)}
        </span>
      </div>
    </div>
  )
}


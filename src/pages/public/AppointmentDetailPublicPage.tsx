import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Ban,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  MessageCircle,
  PartyPopper,
  Phone,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  cancelAppointmentByToken,
  getAppointmentByToken,
  type AppointmentPublicView,
} from '@/services/appointment-public'
import { useDocumentHead } from '@/hooks/useDocumentHead'
import { formatCurrencyBRL, formatMinutesDuration, cn } from '@/lib/utils'
import { formatPhoneBR, isValidPhoneBR, telLink, waLinkBR } from '@/lib/phone'
import {
  APPOINTMENT_STATUS_LABEL,
  BOOKING_ERROR_LABEL,
  type AppointmentStatus,
} from '@/types/domain'

export function AppointmentDetailPublicPage() {
  const { slug, token } = useParams<{ slug: string; token: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const justCreated = searchParams.get('created') === '1'
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['public-appointment', slug, token],
    queryFn: async () => {
      if (!slug || !token) throw new Error('params ausentes')
      const res = await getAppointmentByToken(slug, token)
      if (res.status === 'error') throw new Error(res.error)
      return res.view
    },
    enabled: !!slug && !!token,
    retry: false,
  })

  useDocumentHead({
    title: query.data
      ? `Agendamento · ${query.data.professional.name}`
      : 'Agendamento',
  })

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!slug || !token) throw new Error('params ausentes')
      const res = await cancelAppointmentByToken(slug, token)
      if (res.status === 'error') throw new Error(res.error)
    },
    onSuccess: () => {
      setConfirmOpen(false)
      setActionError(null)
      queryClient.invalidateQueries({ queryKey: ['public-appointment', slug, token] })
    },
    onError: (err) => {
      const code = err instanceof Error ? err.message : 'unknown'
      setActionError(BOOKING_ERROR_LABEL[code] ?? 'Não foi possível cancelar. Tente novamente.')
      setConfirmOpen(false)
    },
  })

  if (query.isLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Carregando…
        </div>
      </Shell>
    )
  }

  if (query.isError || !query.data) {
    return (
      <Shell>
        <NotFoundState slug={slug} />
      </Shell>
    )
  }

  const view = query.data

  function dismissBanner() {
    searchParams.delete('created')
    setSearchParams(searchParams, { replace: true })
  }

  async function copyLink() {
    if (typeof window === 'undefined') return
    const url = window.location.href.split('?')[0]
    try {
      await navigator.clipboard.writeText(url ?? '')
    } catch {
      /* ignore */
    }
  }

  return (
    <Shell>
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10 sm:py-14">
        {justCreated && (
          <CreatedBanner
            status={view.appointment.status}
            professionalName={view.professional.name}
            onCopyLink={copyLink}
            onDismiss={dismissBanner}
          />
        )}

        <Hero view={view} />

        <section aria-labelledby="svc-heading" className="space-y-3">
          <h2 id="svc-heading" className="text-sm font-medium text-muted-foreground">
            Serviços
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {view.services.map((s, idx) => (
              <li key={idx} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name ?? '—'}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {formatMinutesDuration(s.duration_minutes)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-semibold">
                  {formatCurrencyBRL(s.price_cents)}
                </p>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 bg-muted/20 p-4">
              <span className="text-sm text-muted-foreground">
                Duração total: {formatMinutesDuration(view.appointment.total_duration_minutes)}
              </span>
              <span className="text-base font-semibold">
                {formatCurrencyBRL(view.appointment.total_price_cents)}
              </span>
            </li>
          </ul>
        </section>

        {view.appointment.notes && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">Observações</h2>
            <p className="rounded-xl border bg-card p-4 text-sm">
              {view.appointment.notes}
            </p>
          </section>
        )}

        {/* Contato do profissional */}
        {view.professional.phone && isValidPhoneBR(view.professional.phone) && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Falar com {view.professional.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={telLink(view.professional.phone)}>
                  <Phone className="h-4 w-4" />
                  {formatPhoneBR(view.professional.phone)}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a
                  href={waLinkBR(
                    view.professional.phone,
                    `Olá, ${view.professional.name}! Sobre meu agendamento.`,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
              </Button>
            </div>
          </section>
        )}

        <CancelSection
          view={view}
          onRequestCancel={() => {
            setActionError(null)
            setConfirmOpen(true)
          }}
          error={actionError}
          loading={cancelMutation.isPending}
        />

        <div className="pt-4 text-center">
          <Link
            to={`/p/${view.professional.slug}`}
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Ver página de {view.professional.name}
          </Link>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => cancelMutation.mutate()}
        title="Cancelar agendamento?"
        description="Essa ação não pode ser desfeita. O horário ficará livre para outra reserva."
        confirmLabel="Cancelar agendamento"
        cancelLabel="Voltar"
        destructive
        loading={cancelMutation.isPending}
      />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>
}

/* ============================================================ */

function Hero({ view }: { view: AppointmentPublicView }) {
  const start = new Date(view.appointment.start_at)
  const dateStr = start.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const timeStr = start.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <header className="text-center">
      <StatusBadge status={view.appointment.status} />
      <div className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" aria-hidden="true" />
        <span className="capitalize">{dateStr}</span>
      </div>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
        às {timeStr}
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Olá, <strong className="text-foreground">{view.client.name}</strong>! Seu
        atendimento com <strong className="text-foreground">{view.professional.name}</strong>.
      </p>
    </header>
  )
}

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-emerald-100 text-emerald-900',
  completed: 'bg-primary/10 text-primary',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium',
        STATUS_STYLE[status],
      )}
    >
      {APPOINTMENT_STATUS_LABEL[status]}
    </span>
  )
}

interface CancelSectionProps {
  view: AppointmentPublicView
  onRequestCancel: () => void
  error: string | null
  loading: boolean
}

function CancelSection({ view, onRequestCancel, error, loading }: CancelSectionProps) {
  const status = view.appointment.status

  if (status === 'cancelled') {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <Ban className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-medium">Este agendamento foi cancelado.</p>
            <p className="text-muted-foreground">
              Para marcar um novo, visite a página do profissional.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'completed') {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="font-medium">Atendimento concluído.</p>
            <p className="text-muted-foreground">
              Obrigado pela visita!
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'no_show') {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-4 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-medium">Marcado como não comparecido.</p>
            <p className="text-muted-foreground">
              Entre em contato com o profissional para remarcar.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // pending ou confirmed
  if (!view.cancellation_enabled) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          O profissional não permite cancelamento online. Entre em contato
          direto para alterar ou cancelar.
        </CardContent>
      </Card>
    )
  }

  if (!view.can_cancel) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          O prazo para cancelar já passou. Entre em contato com o profissional
          para remarcar.
        </CardContent>
      </Card>
    )
  }

  const cancelUntil = view.cancel_until ? new Date(view.cancel_until) : null

  return (
    <section className="space-y-3">
      {cancelUntil && (
        <p className="text-xs text-muted-foreground">
          Você pode cancelar até{' '}
          <strong className="text-foreground">
            {cancelUntil.toLocaleString('pt-BR', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </strong>
          .
        </p>
      )}
      <Button
        variant="outline"
        className="w-full text-destructive hover:bg-destructive hover:text-destructive-foreground"
        onClick={onRequestCancel}
        disabled={loading}
      >
        <Ban className="h-4 w-4" />
        Cancelar agendamento
      </Button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

interface CreatedBannerProps {
  status: AppointmentStatus
  professionalName: string
  onCopyLink: () => void
  onDismiss: () => void
}

function CreatedBanner({
  status,
  professionalName,
  onCopyLink,
  onDismiss,
}: CreatedBannerProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await onCopyLink()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div
      role="status"
      className="relative overflow-hidden rounded-xl border border-primary/30 bg-primary/5 p-4"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fechar aviso"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <PartyPopper className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {status === 'confirmed'
              ? 'Agendamento confirmado!'
              : 'Pedido enviado!'}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {status === 'confirmed' ? (
              <>Seu horário com <strong>{professionalName}</strong> está marcado.</>
            ) : (
              <>Enviamos seu pedido para <strong>{professionalName}</strong>. Você receberá contato quando for confirmado.</>
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Esta é a página do seu agendamento. Salve nos favoritos ou copie o
            link — você pode voltar aqui para ver detalhes ou cancelar.
          </p>
          <div className="mt-3">
            <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Link copiado!' : 'Copiar link'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NotFoundState({ slug }: { slug: string | undefined }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Agendamento não encontrado</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        O link pode ter sido digitado errado ou o agendamento foi removido.
      </p>
      {slug && (
        <Button asChild variant="outline" className="mt-6">
          <Link to={`/p/${slug}`}>Voltar para a página do profissional</Link>
        </Button>
      )}
    </div>
  )
}

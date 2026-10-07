import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, LifeBuoy, Loader2, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMyTickets, myTicketsKey } from '@/hooks/queries/useTickets'
import { useMyPlan } from '@/hooks/queries/useMyPermissions'
import { createTicket, type TicketStatus } from '@/services/tickets'
import { cn } from '@/lib/utils'

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
  closed: 'Fechado',
}

const STATUS_CLASS: Record<TicketStatus, string> = {
  open: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-muted text-muted-foreground',
}

export function SupportPage() {
  const { data: tickets, isLoading, error } = useMyTickets()
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suporte</h1>
          <p className="text-sm text-muted-foreground">
            Abra um ticket pra falar com nosso time. Respondemos aqui e por email.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Abrir ticket
        </Button>
      </header>

      <SlaBanner />

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando tickets...
          </CardContent>
        </Card>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível carregar seus tickets. Tente recarregar a página.
        </div>
      ) : !tickets || tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center text-sm text-muted-foreground">
            <LifeBuoy className="mb-2 h-6 w-6" aria-hidden="true" />
            <p className="font-medium text-foreground">Nenhum ticket ainda</p>
            <p className="mt-1 max-w-sm">
              Quando precisar de ajuda, clique em "Abrir ticket" e descreva o
              que está acontecendo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                to={`/dashboard/suporte/${t.id}`}
                className="block rounded-xl border bg-background p-4 transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-medium">{t.subject}</h3>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          STATUS_CLASS[t.status],
                        )}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Aberto em {formatDateBR(t.created_at)} · {t.messages_count} mensagem
                      {t.messages_count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <SlaBadge sla={t.sla_due_at} status={t.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewTicketDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

function SlaBanner() {
  const { data: plan } = useMyPlan()
  const paid =
    !!plan &&
    plan.plan_code !== null &&
    plan.plan_price_cents !== null &&
    plan.plan_price_cents > 0 &&
    (plan.subscription_status === 'active' ||
      plan.subscription_status === 'trialing' ||
      plan.subscription_status === 'past_due')

  return (
    <div className="flex items-start gap-3 rounded-md border bg-muted/40 p-3 text-sm">
      <AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="font-medium">
          {paid ? 'Resposta em até 24h úteis (plano pago)' : 'Resposta em até 72h úteis (plano grátis)'}
        </p>
        <p className="text-xs text-muted-foreground">
          {paid
            ? 'Seu plano pago entra em fila prioritária.'
            : 'Assine um plano pago pra receber prioridade (24h úteis).'}
        </p>
      </div>
    </div>
  )
}

function SlaBadge({ sla, status }: { sla: string; status: TicketStatus }) {
  if (status === 'resolved' || status === 'closed') return null
  const dueAt = new Date(sla)
  const now = new Date()
  const diffH = (dueAt.getTime() - now.getTime()) / (1000 * 60 * 60)
  if (diffH < 0) {
    return (
      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
        SLA vencido
      </span>
    )
  }
  if (diffH < 6) {
    return (
      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
        SLA em &lt; {Math.max(1, Math.round(diffH))}h
      </span>
    )
  }
  return null
}

function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (subject.trim().length < 3) {
      setErr('O assunto precisa ter pelo menos 3 caracteres.')
      return
    }
    if (body.trim().length === 0) {
      setErr('Escreva uma descrição do problema.')
      return
    }
    setSubmitting(true)
    try {
      await createTicket({ subject: subject.trim(), body: body.trim() })
      await qc.invalidateQueries({ queryKey: myTicketsKey })
      setSubject('')
      setBody('')
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível criar o ticket.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title="Abrir ticket de suporte"
      description="Descreva o problema com o máximo de detalhes possível."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="ticket-subject">Assunto</Label>
          <Input
            id="ticket-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder="Ex.: Não consigo criar um novo agendamento"
            required
            disabled={submitting}
          />
        </div>
        <div>
          <Label htmlFor="ticket-body">Descrição</Label>
          <Textarea
            id="ticket-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            rows={6}
            placeholder="O que está acontecendo? Quando começou? Já tentou algo?"
            required
            disabled={submitting}
          />
        </div>
        {err && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Abrir ticket
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function formatDateBR(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

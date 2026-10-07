import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useMyTicket, myTicketKey, myTicketsKey } from '@/hooks/queries/useTickets'
import { replyMyTicket, type TicketStatus } from '@/services/tickets'
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

export function SupportTicketPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, error } = useMyTicket(id)
  const qc = useQueryClient()
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState<string | null>(null)

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!id) return
    setSendErr(null)
    if (reply.trim().length === 0) return
    setSending(true)
    try {
      await replyMyTicket(id, reply.trim())
      setReply('')
      await Promise.all([
        qc.invalidateQueries({ queryKey: myTicketKey(id) }),
        qc.invalidateQueries({ queryKey: myTicketsKey }),
      ])
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Não foi possível enviar.')
    } finally {
      setSending(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando ticket...
        </CardContent>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link to="/dashboard/suporte" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Ticket não encontrado.'}
        </div>
      </div>
    )
  }

  const { ticket, messages } = data
  const canReply = ticket.status !== 'closed'

  return (
    <div className="space-y-6">
      <div>
        <Link to="/dashboard/suporte" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{ticket.subject}</h1>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_CLASS[ticket.status])}>
            {STATUS_LABEL[ticket.status]}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Aberto em {formatDateTimeBR(ticket.created_at)} · Resposta esperada em {formatDateTimeBR(ticket.sla_due_at)}
        </p>
      </header>

      <ol className="space-y-3">
        {messages.map((m) => (
          <li
            key={m.id}
            className={cn(
              'rounded-xl border p-4',
              m.author_kind === 'admin'
                ? 'border-primary/30 bg-primary/5'
                : 'bg-background',
            )}
          >
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-medium">
                {m.author_kind === 'admin' ? 'Suporte · Minha Agenda' : 'Você'}
              </span>
              <span>{formatDateTimeBR(m.created_at)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
          </li>
        ))}
      </ol>

      {canReply ? (
        <form onSubmit={handleSend} className="space-y-2">
          <label htmlFor="ticket-reply" className="text-sm font-medium">
            Sua resposta
          </label>
          <Textarea
            id="ticket-reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={5000}
            rows={5}
            placeholder="Escreva uma resposta..."
            disabled={sending}
          />
          {sendErr && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {sendErr}
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={sending || reply.trim().length === 0}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Enviar resposta
            </Button>
          </div>
        </form>
      ) : (
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          Este ticket foi fechado. Abra um novo se precisar de mais ajuda.
        </div>
      )}
    </div>
  )
}

function formatDateTimeBR(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

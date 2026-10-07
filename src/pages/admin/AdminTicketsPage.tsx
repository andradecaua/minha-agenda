import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Loader2, LifeBuoy } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { useAdminTickets } from '@/hooks/queries/useAdminTickets'
import type { AdminTicketPriority, AdminTicketStatus } from '@/services/admin'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 50

const STATUS_LABEL: Record<AdminTicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em andamento',
  resolved: 'Resolvido',
  closed: 'Fechado',
}

const STATUS_CLASS: Record<AdminTicketStatus, string> = {
  open: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-blue-100 text-blue-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-muted text-muted-foreground',
}

interface FilterChipProps {
  label: string
  active: boolean
  onClick: () => void
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background text-muted-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  )
}

export function AdminTicketsPage() {
  const [status, setStatus] = useState<AdminTicketStatus | null>('open')
  const [priority, setPriority] = useState<AdminTicketPriority | null>(null)
  const { data, isLoading, error } = useAdminTickets({
    status,
    priority,
    limit: PAGE_SIZE,
    offset: 0,
  })

  const total = data?.total ?? 0

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tickets de suporte</h1>
        <p className="text-sm text-muted-foreground">
          {total === 0 ? 'Nenhum ticket' : `${total} ticket${total === 1 ? '' : 's'}`} no filtro atual.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground self-center mr-1">
          Status:
        </span>
        <FilterChip label="Todos" active={status === null} onClick={() => setStatus(null)} />
        <FilterChip label="Abertos" active={status === 'open'} onClick={() => setStatus('open')} />
        <FilterChip
          label="Em andamento"
          active={status === 'in_progress'}
          onClick={() => setStatus('in_progress')}
        />
        <FilterChip label="Resolvidos" active={status === 'resolved'} onClick={() => setStatus('resolved')} />
        <FilterChip label="Fechados" active={status === 'closed'} onClick={() => setStatus('closed')} />
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground self-center mr-1">
          Prioridade:
        </span>
        <FilterChip label="Todas" active={priority === null} onClick={() => setPriority(null)} />
        <FilterChip
          label="Alta (pago)"
          active={priority === 'high'}
          onClick={() => setPriority('high')}
        />
        <FilterChip
          label="Normal (grátis)"
          active={priority === 'normal'}
          onClick={() => setPriority('normal')}
        />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando tickets...
          </CardContent>
        </Card>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível carregar os tickets.
        </div>
      ) : !data || data.tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center text-sm text-muted-foreground">
            <LifeBuoy className="mb-2 h-6 w-6" aria-hidden="true" />
            Nenhum ticket encontrado nesse filtro.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Ticket</th>
                <th className="px-4 py-3 font-medium">Usuário</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Prioridade</th>
                <th className="px-4 py-3 font-medium">SLA</th>
                <th className="px-4 py-3 font-medium">Última msg</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.tickets.map((t) => (
                <tr key={t.id} className="hover:bg-accent/30">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/tickets/${t.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {t.subject}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {t.messages_count} mensagem{t.messages_count === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.user_name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{t.user_email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        STATUS_CLASS[t.status],
                      )}
                    >
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {t.priority === 'high' ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
                        Alta
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Normal</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.sla_breached ? (
                      <span className="inline-flex items-center gap-1 text-red-700">
                        <AlertTriangle className="h-3 w-3" />
                        Vencido
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {formatRelative(t.sla_due_at)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {t.last_message_at ? formatDateBR(t.last_message_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diffMs = d.getTime() - Date.now()
  const diffH = Math.round(diffMs / (1000 * 60 * 60))
  if (diffH < 1) return 'em menos de 1h'
  if (diffH < 24) return `em ${diffH}h`
  const diffD = Math.round(diffH / 24)
  return `em ${diffD}d`
}

function formatDateBR(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

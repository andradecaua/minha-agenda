import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search, UserRound, Users } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { useClients } from '@/hooks/queries/useClients'
import { normalizePhone, formatPhoneBR } from '@/lib/phone'
import { formatCurrencyBRL } from '@/lib/utils'
import type { ClientWithStats } from '@/services/clients'

export function ClientsPage() {
  const { data: profile } = useMyProfile()
  const { data: clients, isLoading } = useClients(profile?.id)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = normalizePhone(q)
    if (!q) return clients ?? []
    return (clients ?? []).filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true
      if (qDigits && c.phone && normalizePhone(c.phone).includes(qDigits)) return true
      if (c.email && c.email.toLowerCase().includes(q)) return true
      return false
    })
  }, [clients, search])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Pessoas que já agendaram com você.
        </p>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          placeholder="Buscar por nome, telefone ou e-mail..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          aria-label="Buscar clientes"
        />
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando clientes...
          </CardContent>
        </Card>
      ) : (clients?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center text-sm text-muted-foreground">
            <Users className="mb-2 h-6 w-6" aria-hidden="true" />
            <p className="font-medium text-foreground">Nenhum cliente ainda</p>
            <p className="mt-1 max-w-sm">
              Assim que alguém agendar pela sua página pública, aparecerá aqui.
            </p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado para "{search}".
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li key={c.id}>
              <ClientRow client={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ClientRow({ client }: { client: ClientWithStats }) {
  const initials = client.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?'

  const lastLabel = client.last_appointment_at
    ? new Date(client.last_appointment_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '—'

  return (
    <Link
      to={`/dashboard/clientes/${client.id}`}
      className="block rounded-xl border bg-background p-4 transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-4">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
        >
          {initials.length > 0 ? initials : <UserRound className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{client.name}</p>
          <p className="text-sm text-muted-foreground truncate">
            {client.phone ? formatPhoneBR(client.phone) : 'sem telefone'}
            {client.email ? ` · ${client.email}` : ''}
          </p>
        </div>

        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium">
            {client.appointments_count}{' '}
            <span className="font-normal text-muted-foreground">
              {client.appointments_count === 1 ? 'agendamento' : 'agendamentos'}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">último: {lastLabel}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm text-muted-foreground">Gasto</p>
          <p className="font-semibold">
            {formatCurrencyBRL(client.total_spent_cents)}
          </p>
        </div>
      </div>
    </Link>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Search, ShieldCheck } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAdminUsers } from '@/hooks/queries/useAdminUsers'

const PAGE_SIZE = 25

export function AdminUsersPage() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const debounced = useDebouncedValue(search, 300)

  const { data, isLoading, error } = useAdminUsers({
    search: debounced,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            {total === 0 ? 'Nenhum usuário' : `${total} usuário${total === 1 ? '' : 's'}`} cadastrado{total === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, slug ou e-mail..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="pl-9"
          />
        </div>
      </header>

      {isLoading ? (
        <SkeletonList />
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível carregar os usuários.
        </div>
      ) : !data || data.users.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum usuário encontrado.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Usuário</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Plano</th>
                  <th className="px-4 py-3 font-medium text-right">Agendamentos</th>
                  <th className="px-4 py-3 font-medium text-right">Clientes</th>
                  <th className="px-4 py-3 font-medium">Criado em</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.users.map((u) => (
                  <tr key={u.user_id} className="hover:bg-accent/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{u.name}</span>
                        {u.is_admin && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
                            title="Administrador"
                          >
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">/p/{u.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      {u.plan_name ? (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                          {u.plan_name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem plano</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.appointments_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.clients_count}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/admin/users/${u.user_id}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Abrir →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  )
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Página {page + 1} de {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          ← Anterior
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          Próxima →
        </button>
      </div>
    </div>
  )
}

function SkeletonList() {
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </CardContent>
    </Card>
  )
}

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [state, setState] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setState(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return state
}

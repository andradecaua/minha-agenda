import { useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { useAdminAuditLog } from '@/hooks/queries/useAdminAuditLog'

const PAGE_SIZE = 50

/**
 * Trilha de auditoria: toda ação administrativa (criar/alterar plano,
 * promover admin, atualizar perfil de usuário, etc) grava uma linha
 * em admin_audit_log via SECURITY DEFINER das RPCs admin_*.
 *
 * Fonte da verdade imutável para "quem fez o quê e quando".
 */
export function AdminReportsPage() {
  const [page, setPage] = useState(0)
  const { data: logs, isLoading, error } = useAdminAuditLog({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trilha de auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Registro imutável de ações administrativas. Toda operação sensível
          (promover admin, alterar plano, editar usuário) deixa um rastro aqui.
        </p>
      </header>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </CardContent>
        </Card>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Não foi possível carregar o log.
        </div>
      ) : !logs || logs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma ação registrada ainda.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Quando</th>
                  <th className="px-4 py-3 font-medium">Admin</th>
                  <th className="px-4 py-3 font-medium">Ação</th>
                  <th className="px-4 py-3 font-medium">Alvo</th>
                  <th className="px-4 py-3 font-medium">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                      {new Date(l.created_at).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 text-xs">{l.admin_email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <code className="rounded-md bg-muted px-2 py-0.5 text-xs">
                        {l.action}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {l.target_type ? (
                        <>
                          {l.target_type}
                          {l.target_id && (
                            <>
                              {' · '}
                              <span className="font-mono">{l.target_id.slice(0, 8)}</span>
                            </>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {l.metadata && Object.keys(l.metadata).length > 0 ? (
                        <details>
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Ver JSON
                          </summary>
                          <pre className="mt-1 max-w-md overflow-x-auto rounded-md bg-muted p-2 text-[11px]">
                            {JSON.stringify(l.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Página {page + 1}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
              >
                ← Anterior
              </button>
              <button
                type="button"
                onClick={() => setPage(page + 1)}
                disabled={logs.length < PAGE_SIZE}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent disabled:opacity-50"
              >
                Próxima →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

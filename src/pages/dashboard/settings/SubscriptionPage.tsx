import { useState } from 'react'
import { ArrowRight, Check, Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn, formatCurrencyBRL } from '@/lib/utils'
import { usePublicPlans } from '@/hooks/queries/usePublicPlans'
import { useMyPlan } from '@/hooks/queries/useMyPermissions'
import { usePermissionCatalog } from '@/hooks/queries/usePermissionCatalog'
import {
  CHECKOUT_ERROR_LABEL,
  createCheckoutForPlan,
} from '@/services/checkout'
import type { Plan } from '@/types/admin'

/**
 * Página /dashboard/configuracoes/assinatura.
 *
 * Permite ao usuário logado ver o plano atual e assinar/trocar de plano
 * sem precisar sair da área autenticada (antes só dava pela landing).
 * Reusa `createCheckoutForPlan` — mesma edge, mesmo redirect para o MP.
 *
 * Plano grátis não dispara checkout (a `handle_new_user` já assina o
 * free por default; se um dia virar "downgrade", é RPC separada).
 */
export function SubscriptionPage() {
  const { data: plans, isLoading: plansLoading } = usePublicPlans()
  const { data: myPlan, isLoading: myPlanLoading } = useMyPlan()
  const { data: catalog } = usePermissionCatalog()

  const [startingPlanId, setStartingPlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const permissionNameByCode = new Map<string, string>()
  for (const entry of catalog ?? []) {
    permissionNameByCode.set(entry.code, entry.name)
  }

  async function handleSubscribe(plan: Plan) {
    setError(null)
    setStartingPlanId(plan.id)
    try {
      const { init_point } = await createCheckoutForPlan(plan.id)
      window.location.href = init_point
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      setError(
        CHECKOUT_ERROR_LABEL[code] ?? 'Não foi possível abrir o checkout.',
      )
      setStartingPlanId(null)
    }
  }

  const loading = plansLoading || myPlanLoading

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Assinatura</h2>
        <p className="text-sm text-muted-foreground">
          Gerencie seu plano. Pague com Pix, cartão ou boleto — a renovação é
          mensal e feita manualmente ao fim do período.
        </p>
      </div>

      <CurrentPlanCard
        planName={myPlan?.plan_name ?? null}
        planCode={myPlan?.plan_code ?? null}
        status={myPlan?.subscription_status ?? null}
        expiresAt={myPlan?.expires_at ?? null}
        loading={myPlanLoading}
      />

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Planos disponíveis
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando planos...
          </div>
        ) : !plans || plans.length === 0 ? (
          <p className="py-10 text-sm text-muted-foreground">
            Nenhum plano disponível no momento.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrent={myPlan?.plan_code === plan.code}
                isSubscribing={startingPlanId === plan.id}
                anySubscribing={startingPlanId !== null}
                onSubscribe={() => handleSubscribe(plan)}
                permissionName={(code) =>
                  permissionNameByCode.get(code) ?? code
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ============================================================ */

interface CurrentPlanCardProps {
  planName: string | null
  planCode: string | null
  status: 'active' | 'past_due' | 'cancelled' | 'trialing' | null
  expiresAt: string | null
  loading: boolean
}

function CurrentPlanCard({
  planName,
  planCode,
  status,
  expiresAt,
  loading,
}: CurrentPlanCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription>Plano atual</CardDescription>
        <CardTitle className="flex flex-wrap items-center gap-2 text-2xl">
          {loading ? (
            <span className="flex items-center gap-2 text-base font-normal text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando...
            </span>
          ) : (
            <>
              <span>{planName ?? 'Sem plano ativo'}</span>
              {planCode && (
                <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {planCode}
                </span>
              )}
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        {status && <StatusLine status={status} />}
        {expiresAt && (
          <p>
            Próxima renovação:{' '}
            <span className="font-medium text-foreground">
              {formatDateBR(expiresAt)}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function StatusLine({
  status,
}: {
  status: 'active' | 'past_due' | 'cancelled' | 'trialing'
}) {
  const label: Record<typeof status, string> = {
    active: 'Ativo',
    past_due: 'Pagamento em atraso',
    cancelled: 'Cancelado',
    trialing: 'Em período de teste',
  }
  const tone =
    status === 'active' || status === 'trialing'
      ? 'text-emerald-600'
      : 'text-amber-600'
  return (
    <p>
      Status:{' '}
      <span className={cn('font-medium', tone)}>{label[status]}</span>
    </p>
  )
}

/* ============================================================ */

interface PlanCardProps {
  plan: Plan
  isCurrent: boolean
  isSubscribing: boolean
  anySubscribing: boolean
  onSubscribe: () => void
  permissionName: (code: string) => string
}

function PlanCard({
  plan,
  isCurrent,
  isSubscribing,
  anySubscribing,
  onSubscribe,
  permissionName,
}: PlanCardProps) {
  const isFree = plan.price_cents === 0
  const benefits = Array.isArray(plan.features) ? (plan.features as string[]) : []
  const permissions = plan.permissions ?? []

  return (
    <article
      className={cn(
        'relative flex h-full flex-col gap-4 rounded-xl border bg-background p-5 transition-colors',
        isCurrent ? 'border-primary/40 bg-primary/5' : 'hover:bg-accent/30',
      )}
    >
      {isCurrent && (
        <span className="absolute -top-2.5 left-5 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary-foreground">
          Plano atual
        </span>
      )}

      <header className="space-y-1">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {plan.code}
        </div>
        <h4 className="text-lg font-semibold tracking-tight">{plan.name}</h4>
        {plan.description && (
          <p className="text-sm text-muted-foreground">{plan.description}</p>
        )}
      </header>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight">
          {isFree ? 'R$ 0' : formatCurrencyBRL(plan.price_cents)}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          /{translateInterval(plan.billing_interval)}
        </span>
      </div>

      {benefits.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {benefits.map((b, i) => (
            <li key={i} className="flex items-start gap-2">
              <Check
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-foreground"
                aria-hidden="true"
              />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}

      {permissions.length > 0 && (
        <div className="space-y-1.5 border-t pt-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Inclui
          </div>
          <ul className="space-y-1 text-[13px]">
            {permissions.map((code) => (
              <li key={code} className="flex items-start gap-2">
                <span
                  className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-foreground/40"
                  aria-hidden="true"
                />
                <span>{permissionName(code)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(plan.max_services !== null ||
        plan.max_appointments_per_month !== null) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          <span>
            {plan.max_services !== null
              ? `${plan.max_services} serviços`
              : 'serviços ilimitados'}
          </span>
          <span>
            {plan.max_appointments_per_month !== null
              ? `${plan.max_appointments_per_month} agend./mês`
              : 'agendamentos ilimitados'}
          </span>
        </div>
      )}

      <div className="mt-auto pt-2">
        {isCurrent ? (
          <Button variant="outline" className="w-full" disabled>
            Você está neste plano
          </Button>
        ) : isFree ? (
          // Nunca "fazemos downgrade" por aqui — plano free é padrão
          // automático; se o usuário cancela o pago, volta ao free
          // pela expiração. Mostramos o card só pra ele saber o que o
          // free entrega.
          <Button variant="outline" className="w-full" disabled>
            Plano padrão
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={onSubscribe}
            disabled={anySubscribing}
          >
            {isSubscribing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Abrindo checkout...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Assinar {plan.name}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </Button>
        )}
      </div>
    </article>
  )
}

/* ============================================================ */

function translateInterval(i: string): string {
  if (i === 'monthly') return 'mês'
  if (i === 'yearly') return 'ano'
  return 'vitalício'
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

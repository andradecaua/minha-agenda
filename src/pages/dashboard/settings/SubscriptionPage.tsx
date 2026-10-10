import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Check, Info, Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn, formatCurrencyBRL } from '@/lib/utils'
import { usePublicPlans } from '@/hooks/queries/usePublicPlans'
import { useMyPlan } from '@/hooks/queries/useMyPermissions'
import { usePermissionCatalog } from '@/hooks/queries/usePermissionCatalog'
import { useAuth } from '@/hooks/useAuth'
import {
  CANCEL_ERROR_LABEL,
  CHECKOUT_ERROR_LABEL,
  cancelMySubscription,
  createCheckoutForPlan,
  type CheckoutInterval,
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
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [startingPlanId, setStartingPlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [interval, setInterval] = useState<CheckoutInterval>('monthly')

  const permissionNameByCode = new Map<string, string>()
  for (const entry of catalog ?? []) {
    permissionNameByCode.set(entry.code, entry.name)
  }

  // Trava anti-duplicata: se já há assinatura paga ativa e não expirada,
  // bloqueia qualquer "Assinar" novo. Evita cobrar duas vezes se o user
  // clica outra vez sem perceber que já pagou. `cancelled`/`past_due`
  // liberam o botão — é o caminho de retomar/renovar manualmente.
  const expiresAt = myPlan?.expires_at ? new Date(myPlan.expires_at) : null
  const hasActivePaidSub =
    myPlan?.subscription_status === 'active' &&
    myPlan?.plan_code !== null &&
    myPlan?.plan_code !== 'free' &&
    expiresAt !== null &&
    expiresAt > new Date()
  const isCancelled = myPlan?.cancel_at_period_end === true

  async function handleSubscribe(plan: Plan) {
    setError(null)
    setStartingPlanId(plan.id)
    // Se o toggle tá em "yearly" mas o plano não oferece, cai pro
    // mensal — a edge rejeitaria com 'yearly_not_offered'.
    const effectiveInterval: CheckoutInterval =
      interval === 'yearly' && plan.price_yearly_cents ? 'yearly' : 'monthly'
    try {
      const { init_point } = await createCheckoutForPlan(plan.id, effectiveInterval)
      window.location.href = init_point
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      setError(
        CHECKOUT_ERROR_LABEL[code] ?? 'Não foi possível abrir o checkout.',
      )
      setStartingPlanId(null)
    }
  }

  async function handleCancel() {
    setError(null)
    setCancelling(true)
    try {
      await cancelMySubscription()
      // Força `my_plan` a re-buscar — hook cacheia 5min por padrão.
      await queryClient.invalidateQueries({ queryKey: ['my-plan', user?.id] })
      setCancelOpen(false)
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err)
      setError(
        CANCEL_ERROR_LABEL[code] ?? 'Não foi possível cancelar agora. Tente de novo.',
      )
    } finally {
      setCancelling(false)
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
        cancelAtPeriodEnd={isCancelled}
        canCancel={hasActivePaidSub && !isCancelled}
        onCancel={() => setCancelOpen(true)}
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

      {isCancelled && expiresAt && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            aria-hidden="true"
          />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">
              Renovação cancelada.
            </p>
            <p className="text-muted-foreground">
              Seu acesso ao plano continua até{' '}
              <span className="font-medium text-foreground">
                {formatDateBR(expiresAt.toISOString())}
              </span>
              . Depois dessa data, você volta ao plano gratuito. Pra manter o
              plano pago, basta assinar de novo quando o período atual acabar.
            </p>
          </div>
        </div>
      )}

      {hasActivePaidSub && !isCancelled && expiresAt && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
        >
          <Info
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">
              Você já tem uma assinatura ativa.
            </p>
            <p className="text-muted-foreground">
              Novas assinaturas serão liberadas após{' '}
              <span className="font-medium text-foreground">
                {formatDateBR(expiresAt.toISOString())}
              </span>
              . Isso evita cobrança duplicada no mesmo período.
            </p>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={handleCancel}
        loading={cancelling}
        destructive
        title="Cancelar assinatura?"
        description={
          expiresAt
            ? `Você continuará com acesso ao plano até ${formatDateBR(expiresAt.toISOString())}. Depois dessa data, sua conta volta ao plano gratuito. Nada é cobrado automaticamente — você pode assinar de novo quando quiser.`
            : 'Você continuará com acesso até o fim do período atual. Depois disso, sua conta volta ao plano gratuito.'
        }
        confirmLabel="Sim, cancelar"
        cancelLabel="Manter assinatura"
      />

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Planos disponíveis
          </h3>
          {plans?.some((p) => p.price_yearly_cents != null) && (
            <IntervalToggle value={interval} onChange={setInterval} />
          )}
        </div>

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
                interval={interval}
                isCurrent={myPlan?.plan_code === plan.code}
                isSubscribing={startingPlanId === plan.id}
                anySubscribing={startingPlanId !== null}
                lockedUntilExpire={hasActivePaidSub}
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
  /** Flag `cancel_at_period_end`. Troca o rótulo de "renovação" por "acesso até". */
  cancelAtPeriodEnd: boolean
  /** `true` só se há assinatura paga vigente E ainda não cancelada. */
  canCancel: boolean
  onCancel: () => void
  loading: boolean
}

function CurrentPlanCard({
  planName,
  planCode,
  status,
  expiresAt,
  cancelAtPeriodEnd,
  canCancel,
  onCancel,
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
              Carregando…
            </span>
          ) : (
            <>
              <span>{planName ?? 'Sem plano ativo'}</span>
              {planCode && (
                <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {planCode}
                </span>
              )}
              {cancelAtPeriodEnd && (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-700">
                  Renovação cancelada
                </span>
              )}
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <div className="space-y-1">
          {status && <StatusLine status={status} />}
          {expiresAt && (
            <p>
              {cancelAtPeriodEnd ? 'Acesso até' : 'Próxima renovação'}:{' '}
              <span className="font-medium text-foreground">
                {formatDateBR(expiresAt)}
              </span>
            </p>
          )}
        </div>
        {canCancel && (
          <div className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              Cancelar assinatura
            </Button>
          </div>
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
  /** Intervalo selecionado no toggle. Se o plano não oferece anual, exibimos mensal mesmo. */
  interval: CheckoutInterval
  isCurrent: boolean
  isSubscribing: boolean
  anySubscribing: boolean
  /** Já existe assinatura paga ativa — bloqueia novo "Assinar". */
  lockedUntilExpire: boolean
  onSubscribe: () => void
  permissionName: (code: string) => string
}

function PlanCard({
  plan,
  interval,
  isCurrent,
  isSubscribing,
  anySubscribing,
  lockedUntilExpire,
  onSubscribe,
  permissionName,
}: PlanCardProps) {
  const isFree = plan.price_cents === 0
  const benefits = Array.isArray(plan.features) ? (plan.features as string[]) : []
  const permissions = plan.permissions ?? []
  const showYearly =
    interval === 'yearly' && plan.price_yearly_cents != null && plan.price_yearly_cents > 0
  const discountPct = showYearly
    ? Math.round(
        ((plan.price_cents * 12 - (plan.price_yearly_cents ?? 0)) /
          (plan.price_cents * 12)) *
          100,
      )
    : 0

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
      {showYearly && discountPct > 0 && !isCurrent && (
        <span className="absolute -top-2.5 right-5 rounded-full bg-emerald-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">
          -{discountPct}%
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

      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight">
            {isFree
              ? 'R$ 0'
              : showYearly
                ? formatCurrencyBRL((plan.price_yearly_cents ?? 0) / 12)
                : formatCurrencyBRL(plan.price_cents)}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            /mês
          </span>
        </div>
        {showYearly && (
          <p className="text-xs text-muted-foreground">
            Cobrado anualmente:{' '}
            <span className="font-medium text-foreground">
              {formatCurrencyBRL(plan.price_yearly_cents ?? 0)}
            </span>
          </p>
        )}
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
        ) : lockedUntilExpire ? (
          // Já existe assinatura paga vigente — bloqueia o clique pra
          // evitar cobrança duplicada no mesmo período.
          <Button variant="outline" className="w-full" disabled>
            Assinatura ativa em outro plano
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

function IntervalToggle({
  value,
  onChange,
}: {
  value: CheckoutInterval
  onChange: (next: CheckoutInterval) => void
}) {
  return (
    <div className="inline-flex rounded-full border bg-background p-0.5">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={cn(
          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
          value === 'monthly'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Mensal
      </button>
      <button
        type="button"
        onClick={() => onChange('yearly')}
        className={cn(
          'rounded-full px-3 py-1 text-xs font-medium transition-colors',
          value === 'yearly'
            ? 'bg-foreground text-background'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        Anual
      </button>
    </div>
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

import { Loader2, Lock } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { usePermissions } from '@/hooks/usePermissions'
import type { PermissionCode } from '@/lib/permissions'
import { usePublicPlans } from '@/hooks/queries/usePublicPlans'
import { useStartCheckout } from '@/hooks/useCheckout'

interface RequirePermissionProps {
  code: PermissionCode
}

/**
 * Guard de rota que exige uma permissão. Montado DENTRO do
 * ProtectedRoute no AppRoutes — assume sessão já validada.
 *
 * Comportamento:
 *  - Carregando o plano → spinner. Evita flash do upgrade quando a
 *    permissão de fato existe.
 *  - Sem permissão        → tela de upgrade (não redireciona para
 *    outra rota: a URL direta precisa dar uma dica útil, não sumir).
 *  - Com permissão        → Outlet.
 *
 * O enforcement real é no banco (RLS em products/portfolio_items).
 * Isso aqui é só UX — se alguém burlar o frontend, a RLS rejeita.
 */
export function RequirePermission({ code }: RequirePermissionProps) {
  const { can, loading, planName } = usePermissions()

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Verificando plano…
      </div>
    )
  }

  if (!can(code)) {
    return <UpgradePrompt code={code} currentPlanName={planName} />
  }

  return <Outlet />
}

interface UpgradePromptProps {
  code: PermissionCode
  currentPlanName: string | null
}

function UpgradePrompt({ code, currentPlanName }: UpgradePromptProps) {
  const { data: plans } = usePublicPlans()
  const checkout = useStartCheckout()

  // Primeiro plano pago que libera a permissão bloqueada. Simplifica
  // o CTA: "Assinar o X" em vez de listar os planos.
  const upgradePlan = plans?.find(
    (p) =>
      p.price_cents > 0 &&
      p.active &&
      (p.permissions ?? []).includes(code),
  )

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-5 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Lock className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Recurso indisponível no seu plano</h1>
        <p className="text-sm text-muted-foreground">
          {currentPlanName
            ? `Seu plano atual (${currentPlanName}) não inclui este recurso.`
            : 'Este recurso exige um plano com acesso liberado.'}
        </p>
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
          permissão: {code}
        </p>
      </div>

      {checkout.error && (
        <p role="alert" className="text-sm text-destructive">
          {checkout.error.message}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-2">
        {upgradePlan && (
          <Button
            onClick={() => checkout.mutate(upgradePlan.id)}
            disabled={checkout.isPending}
          >
            {checkout.isPending
              ? 'Abrindo checkout…'
              : `Assinar ${upgradePlan.name}`}
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to="/#planos">Ver planos</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/dashboard">Voltar</Link>
        </Button>
      </div>
    </div>
  )
}

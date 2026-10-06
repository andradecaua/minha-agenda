import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { usePublicPlans } from '@/hooks/queries/usePublicPlans'
import {
  CHECKOUT_ERROR_LABEL,
  createCheckoutForPlan,
} from '@/services/checkout'

/**
 * Rota `/checkout/:planCode`. Entrada única pra "quero assinar". A
 * ideia é tornar o CTA de assinar idempotente — tanto visitante
 * quanto logado chegam aqui.
 *
 * Fluxo:
 *   - Visitante: ProtectedRoute pai redireciona pra /login com
 *     `redirectTo` apontando pra cá. Volta após login e dispara.
 *   - Email de confirmação de signup: `emailRedirectTo` aponta pra
 *     cá, então o clique no email já cai aqui autenticado.
 *   - Já logado: cai direto, chamada à edge e redirect pro MP.
 *
 * O effect é guard-ado com um ref pra evitar double-fire do React
 * StrictMode (dev). Em prod é inofensivo — a função é idempotente,
 * mas evitamos criar duas Preferences desnecessárias.
 */
export function CheckoutRedirectPage() {
  const { planCode } = useParams<{ planCode: string }>()
  const navigate = useNavigate()
  const { data: plans, isLoading: plansLoading } = usePublicPlans()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  const plan = plans?.find((p) => p.code === planCode)

  useEffect(() => {
    if (plansLoading || started.current) return
    if (!plan) {
      // Esperamos o hook terminar antes de decidir "não existe".
      if (!plansLoading && plans) {
        setError('Plano não encontrado ou inativo.')
      }
      return
    }
    if (plan.price_cents === 0) {
      // Plano grátis: não há checkout. Manda pro dashboard.
      navigate('/dashboard', { replace: true })
      return
    }

    started.current = true
    createCheckoutForPlan(plan.id)
      .then(({ init_point }) => {
        window.location.href = init_point
      })
      .catch((err: unknown) => {
        const code = err instanceof Error ? err.message : String(err)
        setError(CHECKOUT_ERROR_LABEL[code] ?? 'Não foi possível abrir o checkout.')
        started.current = false
      })
  }, [plan, plans, plansLoading, navigate])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-sm space-y-5 rounded-xl border bg-background p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Checkout indisponível</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/#planos">Ver planos</Link>
            </Button>
            <Button asChild>
              <Link to="/dashboard">Ir para o dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/30 px-4 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">
        Abrindo checkout seguro do Mercado Pago...
      </p>
      <p className="text-xs text-muted-foreground/70">
        Você será redirecionado em instantes.
      </p>
    </div>
  )
}

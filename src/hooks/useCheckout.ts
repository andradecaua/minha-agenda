import { useMutation } from '@tanstack/react-query'
import {
  CHECKOUT_ERROR_LABEL,
  createCheckoutForPlan,
} from '@/services/checkout'

/**
 * Mutation que inicia o checkout: cria preapproval no MP e redireciona
 * o browser para o `init_point`. Em caso de erro, lança uma Error já
 * com mensagem em pt-BR via `CHECKOUT_ERROR_LABEL`.
 */
export function useStartCheckout() {
  return useMutation({
    mutationFn: async (planId: string) => {
      try {
        const { init_point } = await createCheckoutForPlan(planId)
        // Redirect imediato — o fluxo acontece no site do MP. O user
        // volta pro `back_url` (/dashboard?checkout=return) depois.
        window.location.href = init_point
        // Retorno nunca é usado, mas resolve a Promise.
        return { init_point }
      } catch (err) {
        const code = err instanceof Error ? err.message : String(err)
        const label = CHECKOUT_ERROR_LABEL[code] ?? 'Não foi possível iniciar o checkout.'
        throw new Error(label)
      }
    },
  })
}

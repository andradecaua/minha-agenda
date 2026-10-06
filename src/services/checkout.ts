import { supabase } from '@/lib/supabase'

/**
 * Chama a edge function `create-subscription`, que cria uma Preference
 * no Mercado Pago (Checkout Pro) para o usuário atual + plano escolhido.
 * A ativação local só acontece quando o webhook `payment.updated` chega
 * com status `approved` — aqui a gente só devolve a URL do checkout.
 *
 * Erros possíveis (`error` field no retorno):
 *  - unauthorized      → sessão expirou
 *  - plan_not_found    → id inválido
 *  - plan_is_free      → plano gratuito (não deveria chegar aqui)
 *  - mp_error          → o MP respondeu com erro
 *  - mp_token_missing  → MP_ACCESS_TOKEN não configurado nos secrets
 */
export interface CreateCheckoutResult {
  init_point: string
  preference_id: string
}

export async function createCheckoutForPlan(
  planId: string,
): Promise<CreateCheckoutResult> {
  const { data, error } = await supabase.functions.invoke<
    { status: 'ok'; init_point: string; preference_id: string }
    | { status: 'error'; error: string }
  >('create-subscription', { body: { plan_id: planId } })

  if (error) throw error
  if (!data) throw new Error('invalid_response')
  if (data.status === 'error') throw new Error(data.error)
  return { init_point: data.init_point, preference_id: data.preference_id }
}

/** Traduções dos códigos de erro das edges (sem expor cru pro user). */
export const CHECKOUT_ERROR_LABEL: Record<string, string> = {
  unauthorized: 'Sessão expirada. Faça login novamente.',
  plan_not_found: 'Plano não encontrado.',
  plan_inactive: 'Este plano não está mais disponível.',
  plan_is_free: 'Plano gratuito — não precisa pagar.',
  mp_error:
    'O Mercado Pago retornou um erro. Tente de novo em instantes.',
  mp_token_missing:
    'Pagamentos ainda não foram configurados. Contate o administrador.',
  db_error: 'Erro interno. Tente de novo.',
  invalid_body: 'Requisição inválida.',
  plan_id_required: 'Plano não informado.',
}

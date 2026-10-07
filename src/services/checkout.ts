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

export type CheckoutInterval = 'monthly' | 'yearly'

export async function createCheckoutForPlan(
  planId: string,
  interval: CheckoutInterval = 'monthly',
): Promise<CreateCheckoutResult> {
  const { data, error } = await supabase.functions.invoke<
    { status: 'ok'; init_point: string; preference_id: string }
    | { status: 'error'; error: string }
  >('create-subscription', { body: { plan_id: planId, interval } })

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
  yearly_not_offered:
    'Este plano não oferece opção anual. Escolha mensal ou outro plano.',
}

/**
 * Cancela a assinatura do usuário logado (modelo Preference — 0023 e
 * 0024). Idempotente: re-chamar quando já está cancelada é no-op OK.
 *
 * O backend só marca `cancel_at_period_end=true`; o acesso ao plano
 * segue válido até `current_period_end`, depois o `has_feature()`
 * rebaixa pro free automaticamente. Nenhuma chamada ao MP é feita —
 * no modelo Preference eles já cobraram uma única vez.
 */
export interface CancelResult {
  current_period_end: string | null
}

export async function cancelMySubscription(): Promise<CancelResult> {
  const { data, error } = await supabase.rpc('cancel_my_subscription')

  if (error) throw new Error(error.message)
  if (!data || typeof data !== 'object') throw new Error('invalid_response')

  const payload = data as { status: string; error?: string; current_period_end?: string }
  if (payload.status !== 'ok') {
    throw new Error(payload.error ?? 'unknown_error')
  }
  return { current_period_end: payload.current_period_end ?? null }
}

export const CANCEL_ERROR_LABEL: Record<string, string> = {
  unauthorized: 'Sessão expirada. Faça login novamente.',
  nothing_to_cancel: 'Você não tem uma assinatura paga ativa.',
}

import { supabase } from '@/lib/supabase'
import type { Plan } from '@/types/admin'

/**
 * Lista planos públicos (ativos) para landing e cadastro. A RLS
 * `plans_public_select` em 0018 libera leitura para `anon` quando
 * `active = true` — não precisa de sessão.
 *
 * Ordenação por preço ascendente é intencional: o cartão mais barato
 * à esquerda ajuda a comunicar o funil (grátis → pago).
 */
export async function listPublicPlans(): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, code, name, description, price_cents, price_yearly_cents, billing_interval, features, permissions, max_services, max_appointments_per_month, active, created_at, updated_at',
    )
    .eq('active', true)
    .order('price_cents', { ascending: true })
  if (error) throw error
  return (data ?? []) as Plan[]
}

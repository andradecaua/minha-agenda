import { supabase } from '@/lib/supabase'
import type { PermissionCatalogEntry, PermissionCode } from '@/lib/permissions'

/**
 * Snapshot do plano do usuário atual (resposta de `public.my_plan`).
 * `permissions` é a lista de códigos ativos no plano assinado;
 * `max_*` são quotas numéricas (`null` = sem limite).
 */
export interface MyPlan {
  plan_id: string | null
  plan_code: string | null
  plan_name: string | null
  permissions: PermissionCode[]
  max_services: number | null
  max_appointments_per_month: number | null
  subscription_status: 'active' | 'past_due' | 'cancelled' | 'trialing' | null
  expires_at: string | null
}

/**
 * Snapshot leve de uso vs. quota (resposta de `public.my_usage`).
 * Separado de `MyPlan` porque muda a cada create/cancel — cache
 * mais curto no hook correspondente.
 */
export interface MyUsage {
  services_count: number
  max_services: number | null
  appointments_this_month: number
  max_appointments_per_month: number | null
}

export async function getMyPermissions(): Promise<PermissionCode[]> {
  const { data, error } = await supabase.rpc('my_permissions')
  if (error) throw error
  // RPC retorna `text[]` — supabase-js devolve como `string[]`.
  return (data ?? []) as PermissionCode[]
}

export async function getMyPlan(): Promise<MyPlan> {
  const { data, error } = await supabase.rpc('my_plan')
  if (error) throw error
  // RPC devolve JSONB; shape já casa com MyPlan.
  return data as MyPlan
}

export async function getMyUsage(): Promise<MyUsage> {
  const { data, error } = await supabase.rpc('my_usage')
  if (error) throw error
  return data as MyUsage
}

export async function listPermissionCatalog(): Promise<PermissionCatalogEntry[]> {
  const { data, error } = await supabase
    .from('permission_catalog')
    .select('code, name, description, category')
    .order('category', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as PermissionCatalogEntry[]
}

/**
 * Erros com SQLSTATE `P0100` vêm dos triggers de quota (0020). O
 * supabase-js propaga o SQLSTATE como `code` no `PostgrestError`.
 * Também cobre a `AuthApiError` genérica caso venha de uma RPC.
 */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: string }).code
  return code === 'P0100'
}

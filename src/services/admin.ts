import { supabase } from '@/lib/supabase'
import type {
  AdminAuditLogEntry,
  AdminMetricsOverview,
  AdminSessionStatus,
  AdminUserListResult,
  AdminUserReport,
  BillingInterval,
  Plan,
  SubscriptionStatus,
} from '@/types/admin'

/**
 * Camada de acesso às RPCs admin (0018_admin_and_plans.sql).
 *
 * Convenções:
 *  - TODA chamada retorna `{status: 'ok', ...}` ou `{status: 'error', error}`.
 *  - Mapeamos erros via `ADMIN_ERROR_LABEL` para mensagens pt-BR.
 *  - Nunca propagamos SQLSTATE/mensagem cru do Postgres ao usuário final.
 *  - Qualquer rejeição pelo banco (ex.: 'forbidden') significa que
 *    OU o usuário não é admin, OU a sessão não está em AAL2.
 */

export const ADMIN_ERROR_LABEL: Record<string, string> = {
  forbidden: 'Acesso negado. Verifique a autenticação em duas etapas.',
  not_found: 'Registro não encontrado.',
  code_taken: 'Já existe um plano com esse código.',
  slug_taken: 'Esse identificador (slug) já está em uso.',
  plan_in_use: 'Não é possível excluir: existem assinaturas ligadas a este plano.',
  plan_not_found: 'Plano não encontrado.',
  user_not_found: 'Usuário não encontrado.',
  invalid_input: 'Campos obrigatórios ausentes.',
  invalid_price: 'Preço inválido.',
  invalid_status: 'Status inválido.',
  invalid_permission: 'Permissão desconhecida: confira os códigos no catálogo.',
  cannot_self_demote: 'Você não pode remover a si mesmo do grupo de administradores.',
}

type RpcResult<T> = ({ status: 'ok' } & T) | { status: 'error'; error: string }

function parseResult<T>(data: unknown): ({ status: 'ok' } & T) | { status: 'error'; error: string } {
  if (!data || typeof data !== 'object' || !('status' in data)) {
    return { status: 'error', error: 'invalid_response' }
  }
  return data as RpcResult<T>
}

function throwOnError<T>(result: RpcResult<T>): asserts result is { status: 'ok' } & T {
  if (result.status === 'error') {
    const label = ADMIN_ERROR_LABEL[result.error] ?? 'Operação não permitida.'
    throw new Error(label)
  }
}

// =============== Sessão / status ===================

export async function getAdminSessionStatus(): Promise<AdminSessionStatus> {
  const { data, error } = await supabase.rpc('admin_session_status')
  if (error) {
    // Fallback: se a RPC não existir / sem permissão, consideramos NÃO admin.
    return { is_admin_user: false, is_elevated: false, aal: 'aal1' }
  }
  const parsed = data as AdminSessionStatus | null
  return (
    parsed ?? { is_admin_user: false, is_elevated: false, aal: 'aal1' }
  )
}

// =============== Métricas ===================

export async function getAdminMetricsOverview(): Promise<AdminMetricsOverview> {
  const { data, error } = await supabase.rpc('admin_metrics_overview')
  if (error) throw error
  const result = parseResult<AdminMetricsOverview>(data)
  throwOnError(result)
  const { status: _s, ...rest } = result
  return rest as AdminMetricsOverview
}

// =============== Usuários ===================

export async function listAdminUsers(params: {
  search?: string
  limit?: number
  offset?: number
}): Promise<AdminUserListResult> {
  const { data, error } = await supabase.rpc('admin_list_users', {
    p_search: params.search ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  const result = parseResult<AdminUserListResult>(data)
  throwOnError(result)
  return { total: result.total, users: result.users }
}

export async function getAdminUserReport(userId: string): Promise<AdminUserReport> {
  const { data, error } = await supabase.rpc('admin_user_report', { p_user_id: userId })
  if (error) throw error
  const result = parseResult<AdminUserReport>(data)
  throwOnError(result)
  const { status: _s, ...rest } = result
  return rest as AdminUserReport
}

export async function adminUpdateUserProfile(input: {
  user_id: string
  name?: string | null
  slug?: string | null
  city?: string | null
  phone?: string | null
  bio?: string | null
}): Promise<void> {
  const { data, error } = await supabase.rpc('admin_update_user_profile', {
    p_user_id: input.user_id,
    p_name: input.name ?? null,
    p_slug: input.slug ?? null,
    p_city: input.city ?? null,
    p_phone: input.phone ?? null,
    p_bio: input.bio ?? null,
  })
  if (error) throw error
  const result = parseResult<unknown>(data)
  throwOnError(result)
}

export async function adminSetAdminFlag(userId: string, isAdmin: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('admin_set_admin_flag', {
    p_user_id: userId,
    p_is_admin: isAdmin,
  })
  if (error) throw error
  const result = parseResult<unknown>(data)
  throwOnError(result)
}

export async function adminSetUserPlan(input: {
  user_id: string
  plan_id: string
  expires_at?: string | null
  status?: SubscriptionStatus
}): Promise<void> {
  const { data, error } = await supabase.rpc('admin_set_user_plan', {
    p_user_id: input.user_id,
    p_plan_id: input.plan_id,
    p_expires_at: input.expires_at ?? null,
    p_status: input.status ?? 'active',
  })
  if (error) throw error
  const result = parseResult<unknown>(data)
  throwOnError(result)
}

// =============== Planos ===================

export async function listAdminPlans(): Promise<Plan[]> {
  const { data, error } = await supabase.rpc('admin_list_plans')
  if (error) throw error
  const result = parseResult<{ plans: Plan[] }>(data)
  throwOnError(result)
  return result.plans
}

export interface CreatePlanInput {
  code: string
  name: string
  description?: string | null
  price_cents: number
  /** Opcional. `null` ou ausente = plano não oferece opção anual. */
  price_yearly_cents?: number | null
  billing_interval: BillingInterval
  features?: string[]
  /** Códigos canônicos do catálogo (ver `src/lib/permissions.ts`). */
  permissions?: string[]
  max_services?: number | null
  max_appointments_per_month?: number | null
  active?: boolean
}

export async function createPlan(input: CreatePlanInput): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_plan', {
    p_code: input.code,
    p_name: input.name,
    p_description: input.description ?? null,
    p_price_cents: input.price_cents,
    p_billing_interval: input.billing_interval,
    p_features: (input.features ?? []) as unknown as object,
    p_max_services: input.max_services ?? null,
    p_max_appointments_per_month: input.max_appointments_per_month ?? null,
    p_active: input.active ?? true,
    p_permissions: input.permissions ?? [],
    p_price_yearly_cents: input.price_yearly_cents ?? null,
  })
  if (error) throw error
  const result = parseResult<{ plan_id: string }>(data)
  throwOnError(result)
  return result.plan_id
}

export interface UpdatePlanInput {
  plan_id: string
  name?: string
  description?: string | null
  price_cents?: number
  /**
   * `undefined` = não altera. `number` = seta/atualiza. `null` =
   * desliga a opção anual (traduzido pro sentinel -1 que a RPC
   * reconhece como "clear").
   */
  price_yearly_cents?: number | null
  billing_interval?: BillingInterval
  features?: string[]
  /** `undefined` = não altera. Passe `[]` para esvaziar. */
  permissions?: string[]
  max_services?: number | null
  max_appointments_per_month?: number | null
  active?: boolean
}

export async function updatePlan(input: UpdatePlanInput): Promise<void> {
  // Sentinel pra limpar (ver 0025): -1 vira NULL no SQL; number real
  // vira o novo preço; undefined vira NULL "não altera".
  const yearly =
    input.price_yearly_cents === undefined
      ? null
      : input.price_yearly_cents === null
        ? -1
        : input.price_yearly_cents

  const { data, error } = await supabase.rpc('admin_update_plan', {
    p_plan_id: input.plan_id,
    p_name: input.name ?? null,
    p_description: input.description ?? null,
    p_price_cents: input.price_cents ?? null,
    p_billing_interval: input.billing_interval ?? null,
    p_features: (input.features ?? null) as unknown as object | null,
    p_max_services: input.max_services ?? null,
    p_max_appointments_per_month: input.max_appointments_per_month ?? null,
    p_active: input.active ?? null,
    p_permissions: input.permissions ?? null,
    p_price_yearly_cents: yearly,
  })
  if (error) throw error
  const result = parseResult<unknown>(data)
  throwOnError(result)
}

export async function deletePlan(planId: string): Promise<void> {
  const { data, error } = await supabase.rpc('admin_delete_plan', { p_plan_id: planId })
  if (error) throw error
  const result = parseResult<unknown>(data)
  throwOnError(result)
}

// =============== Auditoria ===================

export async function listAdminAuditLog(params: {
  limit?: number
  offset?: number
}): Promise<AdminAuditLogEntry[]> {
  const { data, error } = await supabase.rpc('admin_audit_log_list', {
    p_limit: params.limit ?? 100,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  const result = parseResult<{ logs: AdminAuditLogEntry[] }>(data)
  throwOnError(result)
  return result.logs
}

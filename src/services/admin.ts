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
  body_required: 'Escreva uma mensagem.',
  invalid_team_cap: 'Tamanho da equipe inválido (precisa ser 1 ou mais).',
  invalid_price_yearly: 'Preço anual inválido.',
  code_in_use: 'Já existe um plano com esse código.',
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
  /**
   * Vagas totais na equipe (dono incluído). `null`/ausente = plano
   * individual (sem equipe). `N ≥ 1` = equipe com N vagas totais.
   */
  max_team_members?: number | null
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
    p_max_team_members: input.max_team_members ?? null,
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
  /**
   * Mesma semântica do price_yearly_cents: `undefined` = não altera;
   * `number` = seta; `null` = volta a plano individual (RPC traduz
   * pro sentinel -1 pra limpar).
   */
  max_team_members?: number | null
  active?: boolean
}

export async function updatePlan(input: UpdatePlanInput): Promise<void> {
  // Sentinel pra limpar (ver 0025 e 0031): -1 vira NULL no SQL;
  // number real vira o novo valor; undefined vira NULL "não altera".
  const yearly =
    input.price_yearly_cents === undefined
      ? null
      : input.price_yearly_cents === null
        ? -1
        : input.price_yearly_cents
  const teamCap =
    input.max_team_members === undefined
      ? null
      : input.max_team_members === null
        ? -1
        : input.max_team_members

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
    p_max_team_members: teamCap,
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

// =============== Tickets ===================

export type AdminTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type AdminTicketPriority = 'normal' | 'high'

export interface AdminTicketRow {
  id: string
  user_id: string
  subject: string
  status: AdminTicketStatus
  priority: AdminTicketPriority
  sla_due_at: string
  plan_code_at_open: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  sla_breached: boolean
  messages_count: number
  last_message_at: string | null
  user_name: string | null
  user_slug: string | null
  user_email: string | null
}

export interface AdminTicketListResult {
  total: number
  tickets: AdminTicketRow[]
}

export interface AdminTicketMessage {
  id: string
  ticket_id: string
  author_kind: 'user' | 'admin'
  author_id: string | null
  body: string
  created_at: string
}

export interface AdminTicketDetail {
  id: string
  user_id: string
  subject: string
  status: AdminTicketStatus
  priority: AdminTicketPriority
  sla_due_at: string
  plan_code_at_open: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  user_name: string | null
  user_slug: string | null
  user_email: string | null
}

export async function listAdminTickets(params: {
  status?: AdminTicketStatus | null
  priority?: AdminTicketPriority | null
  limit?: number
  offset?: number
}): Promise<AdminTicketListResult> {
  const { data, error } = await supabase.rpc('admin_list_support_tickets', {
    p_status: params.status ?? null,
    p_priority: params.priority ?? null,
    p_limit: params.limit ?? 50,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  const result = parseResult<AdminTicketListResult>(data)
  throwOnError(result)
  return { total: result.total, tickets: result.tickets }
}

export async function getAdminTicket(
  ticketId: string,
): Promise<{ ticket: AdminTicketDetail; messages: AdminTicketMessage[] }> {
  const { data, error } = await supabase.rpc('admin_get_support_ticket', {
    p_ticket_id: ticketId,
  })
  if (error) throw error
  const result = parseResult<{ ticket: AdminTicketDetail; messages: AdminTicketMessage[] }>(data)
  throwOnError(result)
  return { ticket: result.ticket, messages: result.messages }
}

export async function adminReplyTicket(ticketId: string, body: string): Promise<void> {
  const { data, error } = await supabase.rpc('admin_reply_support_ticket', {
    p_ticket_id: ticketId,
    p_body: body,
  })
  if (error) throw error
  const result = parseResult<{ message_id: string }>(data)
  throwOnError(result)
  // Fire-and-forget: notifica o dono do ticket.
  void supabase.functions
    .invoke('send-ticket-notification', {
      body: { ticket_id: ticketId, event: 'admin_reply' },
    })
    .catch((err) => {
      console.warn('[admin.tickets] falha ao notificar usuário:', err)
    })
}

export async function adminUpdateTicketStatus(
  ticketId: string,
  status: AdminTicketStatus,
): Promise<void> {
  const { data, error } = await supabase.rpc('admin_update_support_ticket_status', {
    p_ticket_id: ticketId,
    p_status: status,
  })
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

// Tipos do domínio admin (0018_admin_and_plans.sql). Mantidos à parte
// de `database.ts` apenas para separar o core do SaaS da área admin.

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trialing'
export type BillingInterval = 'monthly' | 'yearly' | 'lifetime'

export interface Plan {
  id: string
  code: string
  name: string
  description: string | null
  price_cents: number
  /**
   * Preço anual opcional em centavos. `null` quando o plano não
   * oferece opção anual — nesse caso só o `price_cents` (mensal)
   * é cobrado. Ver migration 0025.
   */
  price_yearly_cents: number | null
  billing_interval: BillingInterval
  /**
   * Mantido por compat com RPCs antigas (0018). O campo canônico de
   * permissões agora é `permissions` (ver 0019).
   */
  features: string[] | Record<string, unknown>
  /** Permissões ativas no plano. Vazio = plano sem feature extra. */
  permissions: string[]
  max_services: number | null
  max_appointments_per_month: number | null
  /**
   * Quantidade total de membros aceitos na equipe (dono incluído).
   * NULL = plano individual (sem conceito de equipe). N ≥ 1 = plano
   * de equipe com N vagas. Quotas somam a equipe inteira.
   */
  max_team_members: number | null
  active: boolean
  created_at: string
  updated_at: string
  active_subscribers?: number
}

export interface Subscription {
  id: string
  user_id: string
  plan_id: string
  status: SubscriptionStatus
  started_at: string
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface AdminSessionStatus {
  is_admin_user: boolean
  is_elevated: boolean
  aal: 'aal1' | 'aal2'
}

export interface AdminMetricsOverview {
  users_total: number
  users_new_30d: number
  users_new_7d: number
  appointments_total: number
  appointments_30d: number
  appointments_completed_30d: number
  appointments_cancelled_30d: number
  revenue_completed_30d_cents: number
  clients_total: number
  active_subscriptions: number
  plans_active: number
  admin_count: number
  generated_at: string
}

export interface AdminUserRow {
  profile_id: string
  user_id: string
  name: string
  slug: string
  city: string | null
  phone: string | null
  avatar_url: string | null
  created_at: string
  email: string | null
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  is_admin: boolean
  plan_code: string | null
  plan_name: string | null
  appointments_count: number
  clients_count: number
}

export interface AdminUserListResult {
  total: number
  users: AdminUserRow[]
}

export interface AdminUserReport {
  profile: {
    id: string
    user_id: string
    name: string
    slug: string
    bio: string | null
    avatar_url: string | null
    phone: string | null
    city: string | null
    timezone: string
    created_at: string
    updated_at: string
  }
  auth: {
    email: string | null
    created_at: string | null
    last_sign_in_at: string | null
    email_confirmed_at: string | null
  } | null
  is_admin: boolean
  subscription: Subscription | null
  plan: Plan | null
  metrics: {
    appointments_total: number
    appointments_completed: number
    appointments_cancelled: number
    appointments_pending: number
    revenue_total_cents: number
    revenue_30d_cents: number
    clients_total: number
    services_active: number
    products_active: number
    portfolio_items: number
  }
}

export interface AdminAuditLogEntry {
  id: string
  action: string
  target_type: string | null
  target_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  admin_email: string | null
}

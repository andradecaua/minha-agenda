/**
 * Catálogo canônico de permissões do app. Fonte da verdade no banco:
 * tabela `public.permission_catalog` (migration 0019). Esses códigos
 * têm que bater exatamente — não altere sem rodar a migration junto.
 *
 * Boolean = tem ou não tem. Para quotas numéricas (ex.: max_services)
 * use `MyPlan.max_services`, não permissões.
 */

export const PERMISSIONS = {
  AGENDA_MANUAL_BOOKING: 'agenda.manual_booking',
  CLIENTS_MANAGE: 'clients.manage',
  SERVICES_MANAGE: 'services.manage',
  PRODUCTS_MANAGE: 'products.manage',
  PORTFOLIO_MANAGE: 'portfolio.manage',
  PUBLIC_PAGE_ENABLED: 'public_page.enabled',
  BOOKING_CANCELLATION_RULES: 'booking.cancellation_rules',
  REPORTS_ADVANCED: 'reports.advanced',
} as const

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ALL_PERMISSIONS: PermissionCode[] = Object.values(PERMISSIONS)

/**
 * Entrada do catálogo como retornada pelo banco. Usada na UI de edição
 * de plano (checkbox list) e para rotular as permissões do usuário.
 */
export interface PermissionCatalogEntry {
  code: PermissionCode
  name: string
  description: string | null
  category: string
}

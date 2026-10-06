import { useMemo } from 'react'
import { useMyPlan } from '@/hooks/queries/useMyPermissions'
import type { PermissionCode } from '@/lib/permissions'

export interface UsePermissionsResult {
  /** Fonte da verdade: o conjunto de códigos ativos no plano. */
  permissions: Set<PermissionCode>
  /** Checagem booleana. Falso enquanto `loading` para evitar flash. */
  can: (code: PermissionCode) => boolean
  /** `true` enquanto a RPC não retornou. UI deve mostrar skeleton. */
  loading: boolean
  /** Útil para "você está no plano X" e tela de upgrade. */
  planCode: string | null
  planName: string | null
  /** Quotas numéricas (`null` = sem limite). */
  maxServices: number | null
  maxAppointmentsPerMonth: number | null
}

/**
 * API ergonômica em cima do hook de query. Prefira `can()` a comparar
 * strings direto — centraliza a decisão num só lugar.
 */
export function usePermissions(): UsePermissionsResult {
  const { data, isLoading } = useMyPlan()

  return useMemo(() => {
    const perms = new Set<PermissionCode>(data?.permissions ?? [])
    return {
      permissions: perms,
      can: (code: PermissionCode) => perms.has(code),
      loading: isLoading,
      planCode: data?.plan_code ?? null,
      planName: data?.plan_name ?? null,
      maxServices: data?.max_services ?? null,
      maxAppointmentsPerMonth: data?.max_appointments_per_month ?? null,
    }
  }, [data, isLoading])
}

import { useQuery } from '@tanstack/react-query'
import { listAdminAuditLog } from '@/services/admin'

export function useAdminAuditLog(params: { limit?: number; offset?: number; enabled?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'audit-log', params.limit ?? 100, params.offset ?? 0],
    queryFn: () => listAdminAuditLog({ limit: params.limit, offset: params.offset }),
    enabled: params.enabled ?? true,
    staleTime: 30 * 1000,
  })
}

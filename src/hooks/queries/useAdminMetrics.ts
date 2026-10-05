import { useQuery } from '@tanstack/react-query'
import { getAdminMetricsOverview } from '@/services/admin'

export function useAdminMetrics(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'metrics-overview'],
    queryFn: getAdminMetricsOverview,
    enabled,
    staleTime: 60 * 1000,
  })
}

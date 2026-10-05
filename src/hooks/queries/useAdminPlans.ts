import { useQuery } from '@tanstack/react-query'
import { listAdminPlans } from '@/services/admin'

export function useAdminPlans(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listAdminPlans,
    enabled,
    staleTime: 60 * 1000,
  })
}

import { useQuery } from '@tanstack/react-query'
import { getDashboardStats } from '@/services/dashboard-stats'

export function useDashboardStats(professionalId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard-stats', professionalId],
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return getDashboardStats(professionalId)
    },
    enabled: !!professionalId,
    staleTime: 60 * 1000,
  })
}

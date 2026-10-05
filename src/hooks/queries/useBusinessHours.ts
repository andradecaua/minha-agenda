import { useQuery } from '@tanstack/react-query'
import { listBusinessHours } from '@/services/business-hours'

export function useBusinessHours(professionalId: string | undefined) {
  return useQuery({
    queryKey: ['business-hours', professionalId],
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return listBusinessHours(professionalId)
    },
    enabled: !!professionalId,
  })
}

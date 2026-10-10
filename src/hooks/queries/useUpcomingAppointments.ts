import { useQuery } from '@tanstack/react-query'
import { listUpcomingAppointments } from '@/services/appointments'

export function useUpcomingAppointments(
  professionalId: string | undefined,
  limit = 5,
) {
  return useQuery({
    queryKey: ['appointments', 'upcoming', professionalId, limit],
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return listUpcomingAppointments(professionalId, limit)
    },
    enabled: !!professionalId,
    staleTime: 30 * 1000,
  })
}

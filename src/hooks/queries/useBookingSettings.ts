import { useQuery } from '@tanstack/react-query'
import { getBookingSettings } from '@/services/booking-settings'

export function useBookingSettings(professionalId: string | undefined) {
  return useQuery({
    queryKey: ['booking-settings', professionalId],
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return getBookingSettings(professionalId)
    },
    enabled: !!professionalId,
  })
}

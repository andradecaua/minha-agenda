import { useQuery } from '@tanstack/react-query'
import { listAppointmentsRange } from '@/services/appointments'

function toKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export const appointmentsQueryKey = (
  professionalId: string | undefined,
  from: Date,
  to: Date,
) => ['appointments', professionalId, toKey(from), toKey(to)] as const

export function useAppointmentsRange(
  professionalId: string | undefined,
  from: Date,
  to: Date,
) {
  return useQuery({
    queryKey: appointmentsQueryKey(professionalId, from, to),
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return listAppointmentsRange(professionalId, from, to)
    },
    enabled: !!professionalId,
    staleTime: 15 * 1000,
  })
}

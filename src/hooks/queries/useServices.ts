import { useQuery } from '@tanstack/react-query'
import { listServices } from '@/services/services'

export const servicesQueryKey = (professionalId: string | undefined) =>
  ['services', professionalId] as const

export function useServices(professionalId: string | undefined) {
  return useQuery({
    queryKey: servicesQueryKey(professionalId),
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return listServices(professionalId)
    },
    enabled: !!professionalId,
  })
}

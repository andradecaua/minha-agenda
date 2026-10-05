import { useQuery } from '@tanstack/react-query'
import { getClient, listClients } from '@/services/clients'

export const clientsQueryKey = (professionalId: string | undefined) =>
  ['clients', professionalId] as const

export function useClients(professionalId: string | undefined) {
  return useQuery({
    queryKey: clientsQueryKey(professionalId),
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return listClients(professionalId)
    },
    enabled: !!professionalId,
    staleTime: 30 * 1000,
  })
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: () => {
      if (!id) throw new Error('id ausente')
      return getClient(id)
    },
    enabled: !!id,
  })
}

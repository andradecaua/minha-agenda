import { useQuery } from '@tanstack/react-query'
import { listServices } from '@/services/services'

// Services são do TIME desde 0038. Chave sempre em cima de teamId
// pra que owner e member compartilhem o mesmo cache (um invalida,
// o outro vê).
export const servicesQueryKey = (teamId: string | undefined) =>
  ['services', teamId] as const

export function useServices(teamId: string | undefined) {
  return useQuery({
    queryKey: servicesQueryKey(teamId),
    queryFn: () => {
      if (!teamId) throw new Error('teamId ausente')
      return listServices(teamId)
    },
    enabled: !!teamId,
  })
}

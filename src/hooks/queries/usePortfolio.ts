import { useQuery } from '@tanstack/react-query'
import { listPortfolio } from '@/services/portfolio'

export const portfolioQueryKey = (professionalId: string | undefined) =>
  ['portfolio', professionalId] as const

export function usePortfolio(professionalId: string | undefined) {
  return useQuery({
    queryKey: portfolioQueryKey(professionalId),
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return listPortfolio(professionalId)
    },
    enabled: !!professionalId,
  })
}

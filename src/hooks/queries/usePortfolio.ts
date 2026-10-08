import { useQuery } from '@tanstack/react-query'
import { listPortfolio } from '@/services/portfolio'

export const portfolioQueryKey = (teamId: string | undefined) =>
  ['portfolio', teamId] as const

export function usePortfolio(teamId: string | undefined) {
  return useQuery({
    queryKey: portfolioQueryKey(teamId),
    queryFn: () => {
      if (!teamId) throw new Error('teamId ausente')
      return listPortfolio(teamId)
    },
    enabled: !!teamId,
  })
}

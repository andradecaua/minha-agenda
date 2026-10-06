import { useQuery } from '@tanstack/react-query'
import { listPublicPlans } from '@/services/plans'

/**
 * Planos públicos da landing/cadastro. Como mudam pouco, cache
 * agressivo. Admin invalida via `['admin', 'plans']` — essa aqui
 * não precisa estar sincronizada em tempo real.
 */
export function usePublicPlans() {
  return useQuery({
    queryKey: ['public-plans'],
    queryFn: listPublicPlans,
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}

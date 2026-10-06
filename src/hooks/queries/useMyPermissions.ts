import { useQuery } from '@tanstack/react-query'
import { getMyPlan, type MyPlan } from '@/services/permissions'
import { useAuth } from '@/hooks/useAuth'

/**
 * Busca o plano + permissões do usuário logado uma vez por sessão.
 * Retornado como `my_plan` (RPC consolidada) porque frontend precisa
 * tanto do array de permissões quanto das quotas numéricas e do nome
 * do plano (para UI de upgrade).
 */
export function useMyPlan() {
  const { user } = useAuth()

  return useQuery<MyPlan>({
    queryKey: ['my-plan', user?.id],
    queryFn: getMyPlan,
    enabled: !!user,
    // Permissões não mudam toda hora. 5min evita refetches em cada
    // navegação; invalidar explicitamente após `adminSetUserPlan`.
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

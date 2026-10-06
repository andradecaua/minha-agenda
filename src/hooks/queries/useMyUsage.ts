import { useQuery } from '@tanstack/react-query'
import { getMyUsage, type MyUsage } from '@/services/permissions'
import { useAuth } from '@/hooks/useAuth'

export const myUsageQueryKey = (userId?: string) => ['my-usage', userId] as const

/**
 * Snapshot de uso (serviços cadastrados, agendamentos no mês). O
 * cache é curto porque o número muda a cada create/cancel — depois
 * de uma mutação, invalide essa queryKey para refletir imediato.
 */
export function useMyUsage() {
  const { user } = useAuth()

  return useQuery<MyUsage>({
    queryKey: myUsageQueryKey(user?.id),
    queryFn: getMyUsage,
    enabled: !!user,
    staleTime: 30 * 1000,
    retry: false,
  })
}

import { useQuery } from '@tanstack/react-query'
import { getAdminUserReport } from '@/services/admin'

export function useAdminUserReport(userId: string | undefined) {
  return useQuery({
    queryKey: ['admin', 'user-report', userId],
    queryFn: () => {
      if (!userId) throw new Error('userId ausente')
      return getAdminUserReport(userId)
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
  })
}

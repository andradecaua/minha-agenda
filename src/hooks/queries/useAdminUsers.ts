import { useQuery } from '@tanstack/react-query'
import { listAdminUsers } from '@/services/admin'

export function useAdminUsers(params: {
  search?: string
  limit?: number
  offset?: number
  enabled?: boolean
}) {
  return useQuery({
    queryKey: ['admin', 'users', params.search ?? '', params.limit ?? 50, params.offset ?? 0],
    queryFn: () =>
      listAdminUsers({
        search: params.search,
        limit: params.limit,
        offset: params.offset,
      }),
    enabled: params.enabled ?? true,
    staleTime: 30 * 1000,
  })
}

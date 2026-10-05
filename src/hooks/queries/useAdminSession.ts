import { useQuery } from '@tanstack/react-query'
import { getAdminSessionStatus } from '@/services/admin'
import { useAuth } from '@/hooks/useAuth'

/**
 * Combina a sessão do Supabase (user, aal lido do JWT) com a RPC
 * `admin_session_status` do banco. A RPC é a fonte da verdade para
 * `is_admin_user` (consulta a tabela `admin_users`). O JWT já traz
 * o `aal`, mas a RPC também devolve — útil quando a sessão acabou
 * de ser elevada e queremos re-sincronizar.
 */
export function useAdminSession() {
  const { user, aal } = useAuth()

  return useQuery({
    queryKey: ['admin-session', user?.id, aal],
    queryFn: getAdminSessionStatus,
    enabled: !!user,
    staleTime: 30 * 1000,
    retry: false,
  })
}

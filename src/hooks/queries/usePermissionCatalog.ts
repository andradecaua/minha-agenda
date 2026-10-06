import { useQuery } from '@tanstack/react-query'
import { listPermissionCatalog } from '@/services/permissions'

/**
 * Catálogo canônico de permissões. Varia pouco; cache longo com
 * `staleTime: Infinity` evita refetch desnecessário entre navegações
 * do admin. Invalidar manualmente só se um admin editar a tabela.
 */
export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['permission-catalog'],
    queryFn: listPermissionCatalog,
    staleTime: Infinity,
    retry: false,
  })
}

import { useQuery } from '@tanstack/react-query'
import { listProducts } from '@/services/products'

export const productsQueryKey = (professionalId: string | undefined) =>
  ['products', professionalId] as const

export function useProducts(professionalId: string | undefined) {
  return useQuery({
    queryKey: productsQueryKey(professionalId),
    queryFn: () => {
      if (!professionalId) throw new Error('professionalId ausente')
      return listProducts(professionalId)
    },
    enabled: !!professionalId,
  })
}

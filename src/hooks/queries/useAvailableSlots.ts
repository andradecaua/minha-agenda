import { useQuery } from '@tanstack/react-query'
import { getAvailableSlots } from '@/services/booking'

function toKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function useAvailableSlots(
  slug: string | undefined,
  serviceIds: string[],
  date: Date | null,
) {
  const dateKey = date ? toKey(date) : null
  // Ordem na key não importa para o cache; ordenamos antes de serializar.
  const serviceKey = [...serviceIds].sort().join(',')
  return useQuery({
    queryKey: ['slots', slug, serviceKey, dateKey],
    queryFn: () => {
      if (!slug || serviceIds.length === 0 || !date) {
        throw new Error('parâmetros ausentes')
      }
      return getAvailableSlots(slug, serviceIds, date)
    },
    enabled: !!slug && serviceIds.length > 0 && !!date,
    staleTime: 30 * 1000,
  })
}

import { useQuery } from '@tanstack/react-query'
import { getMyTicket, listMyTickets } from '@/services/tickets'

export const myTicketsKey = ['my-tickets'] as const
export const myTicketKey = (id: string | undefined) => ['my-ticket', id] as const

export function useMyTickets() {
  return useQuery({
    queryKey: myTicketsKey,
    queryFn: listMyTickets,
    staleTime: 30 * 1000,
  })
}

export function useMyTicket(id: string | undefined) {
  return useQuery({
    queryKey: myTicketKey(id),
    queryFn: () => {
      if (!id) throw new Error('id ausente')
      return getMyTicket(id)
    },
    enabled: !!id,
    staleTime: 10 * 1000,
  })
}

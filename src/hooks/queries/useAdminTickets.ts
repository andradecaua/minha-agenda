import { useQuery } from '@tanstack/react-query'
import {
  getAdminTicket,
  listAdminTickets,
  type AdminTicketPriority,
  type AdminTicketStatus,
} from '@/services/admin'

interface ListParams {
  status?: AdminTicketStatus | null
  priority?: AdminTicketPriority | null
  limit?: number
  offset?: number
}

export const adminTicketsKey = (params: ListParams) =>
  ['admin-tickets', params.status ?? null, params.priority ?? null, params.limit ?? 50, params.offset ?? 0] as const

export const adminTicketKey = (id: string | undefined) => ['admin-ticket', id] as const

export function useAdminTickets(params: ListParams) {
  return useQuery({
    queryKey: adminTicketsKey(params),
    queryFn: () => listAdminTickets(params),
    staleTime: 15 * 1000,
  })
}

export function useAdminTicket(id: string | undefined) {
  return useQuery({
    queryKey: adminTicketKey(id),
    queryFn: () => {
      if (!id) throw new Error('id ausente')
      return getAdminTicket(id)
    },
    enabled: !!id,
    staleTime: 10 * 1000,
  })
}

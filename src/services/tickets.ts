import { supabase } from '@/lib/supabase'

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type TicketPriority = 'normal' | 'high'

export interface TicketSummary {
  id: string
  subject: string
  status: TicketStatus
  priority: TicketPriority
  sla_due_at: string
  created_at: string
  updated_at: string
  resolved_at: string | null
  messages_count: number
  last_message_at: string | null
}

export interface TicketDetail {
  id: string
  user_id: string
  subject: string
  status: TicketStatus
  priority: TicketPriority
  sla_due_at: string
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface TicketMessage {
  id: string
  ticket_id: string
  author_kind: 'user' | 'admin'
  body: string
  created_at: string
}

export interface TicketWithThread {
  ticket: TicketDetail
  messages: TicketMessage[]
}

type RpcResult<T> = ({ status: 'ok' } & T) | { status: 'error'; error: string }

const ERROR_LABEL: Record<string, string> = {
  unauthorized: 'Faça login novamente.',
  subject_too_short: 'O assunto precisa ter pelo menos 3 caracteres.',
  body_required: 'Escreva uma mensagem.',
  not_found: 'Ticket não encontrado.',
  forbidden: 'Você não tem acesso a este ticket.',
  ticket_closed: 'Este ticket foi fechado. Abra um novo.',
}

function parseOrThrow<T>(data: unknown): { status: 'ok' } & T {
  if (!data || typeof data !== 'object' || !('status' in data)) {
    throw new Error('Resposta inválida do servidor.')
  }
  const result = data as RpcResult<T>
  if (result.status === 'error') {
    throw new Error(ERROR_LABEL[result.error] ?? 'Não foi possível concluir.')
  }
  return result
}

export async function listMyTickets(): Promise<TicketSummary[]> {
  const { data, error } = await supabase.rpc('list_my_support_tickets')
  if (error) throw error
  return (data ?? []) as TicketSummary[]
}

export async function getMyTicket(ticketId: string): Promise<TicketWithThread> {
  const { data, error } = await supabase.rpc('get_my_support_ticket', {
    p_ticket_id: ticketId,
  })
  if (error) throw error
  const parsed = parseOrThrow<{ ticket: TicketDetail; messages: TicketMessage[] }>(data)
  return { ticket: parsed.ticket, messages: parsed.messages }
}

export interface CreateTicketInput {
  subject: string
  body: string
}

export interface CreateTicketResult {
  ticket_id: string
  sla_due_at: string
  priority: TicketPriority
}

export async function createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
  const { data, error } = await supabase.rpc('create_support_ticket', {
    p_subject: input.subject,
    p_body: input.body,
  })
  if (error) throw error
  const parsed = parseOrThrow<CreateTicketResult>(data)
  // Fire-and-forget: notifica o suporte. Falha de email não bloqueia
  // a criação — o ticket já está salvo e aparece no painel admin.
  void supabase.functions
    .invoke('send-ticket-notification', {
      body: { ticket_id: parsed.ticket_id, event: 'created' },
    })
    .catch((err) => {
      console.warn('[tickets] falha ao notificar suporte:', err)
    })
  return {
    ticket_id: parsed.ticket_id,
    sla_due_at: parsed.sla_due_at,
    priority: parsed.priority,
  }
}

export async function replyMyTicket(ticketId: string, body: string): Promise<void> {
  const { data, error } = await supabase.rpc('reply_my_support_ticket', {
    p_ticket_id: ticketId,
    p_body: body,
  })
  if (error) throw error
  parseOrThrow<{ message_id: string }>(data)
  void supabase.functions
    .invoke('send-ticket-notification', {
      body: { ticket_id: ticketId, event: 'user_reply' },
    })
    .catch((err) => {
      console.warn('[tickets] falha ao notificar suporte:', err)
    })
}

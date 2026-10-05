// Enums e tipos de domínio.
// Mantém espelho fiel ao banco. Qualquer mudança no schema SQL deve
// atualizar aqui.

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
] as const

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
  no_show: 'Não compareceu',
}

// Erros retornados pela RPC book_appointment — traduções amigáveis.
export const BOOKING_ERROR_LABEL: Record<string, string> = {
  profile_not_found: 'Profissional não encontrado.',
  bookings_disabled: 'Este profissional não está aceitando agendamentos online no momento.',
  service_not_found: 'Serviço indisponível.',
  service_inactive: 'Serviço indisponível.',
  invalid_name: 'Informe o nome do cliente.',
  invalid_phone: 'Informe um telefone válido.',
  too_soon: 'É necessário agendar com mais antecedência.',
  too_far: 'Não é possível agendar tão longe no futuro.',
  outside_hours: 'Horário fora do expediente.',
  conflict: 'Esse horário já está ocupado. Escolha outro.',
  // Erros específicos do admin_create_appointment
  unauthorized: 'Sessão expirada. Faça login novamente.',
  client_not_found: 'Cliente não encontrado.',
  start_in_past: 'Não é possível agendar para uma data/hora que já passou.',
  // Erros de cancelamento pelo cliente (token)
  not_found: 'Agendamento não encontrado ou link inválido.',
  not_cancellable: 'Esse agendamento não pode mais ser cancelado.',
  cancellation_disabled: 'O profissional desativou o cancelamento pelo cliente.',
  cancel_deadline_passed: 'O prazo para cancelar já passou. Entre em contato com o profissional.',
}

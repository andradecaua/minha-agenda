import { supabase } from '@/lib/supabase'
import type { AppointmentStatus } from '@/types/domain'
import type { Appointment } from '@/types/database'

export interface CreateAppointmentManualPayload {
  serviceIds: string[]
  startAt: Date | string
  clientId?: string | null
  clientName?: string | null
  clientPhone?: string | null
  clientEmail?: string | null
  notes?: string | null
  status?: AppointmentStatus
}

export type CreateAppointmentManualResult =
  | { status: 'ok'; appointment_id: string; total_price_cents: number; total_duration_minutes: number }
  | { status: 'error'; error: string }

export async function createAppointmentManual(
  payload: CreateAppointmentManualPayload,
): Promise<CreateAppointmentManualResult> {
  const { data, error } = await supabase.rpc('admin_create_appointment', {
    p_service_ids: payload.serviceIds,
    p_start_at:
      typeof payload.startAt === 'string'
        ? payload.startAt
        : payload.startAt.toISOString(),
    p_client_id: payload.clientId ?? null,
    p_client_name: payload.clientName ?? null,
    p_client_phone: payload.clientPhone ?? null,
    p_client_email: payload.clientEmail ?? null,
    p_notes: payload.notes ?? null,
    p_status: payload.status ?? 'confirmed',
  })
  if (error) throw error
  return data as CreateAppointmentManualResult
}

export interface AppointmentServiceLine {
  id: string
  position: number
  price_cents_snapshot: number
  duration_minutes_snapshot: number
  service: { id: string; name: string }
}

export interface AppointmentDetails extends Appointment {
  client: {
    id: string
    name: string
    phone: string | null
    email: string | null
  }
  services: AppointmentServiceLine[]
}

/**
 * Lista agendamentos de um profissional entre `from` e `to`, com
 * cliente e os serviços associados já joinados. A RLS garante que
 * só retorne os do dono logado.
 */
export async function listAppointmentsRange(
  professionalId: string,
  from: Date,
  to: Date,
): Promise<AppointmentDetails[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(
      `
      *,
      client:clients(id, name, phone, email),
      services:appointment_services(
        id, position, price_cents_snapshot, duration_minutes_snapshot,
        service:services(id, name)
      )
    `,
    )
    .eq('professional_id', professionalId)
    .gte('start_at', from.toISOString())
    .lt('start_at', to.toISOString())
    .order('start_at', { ascending: true })

  if (error) throw error

  // Supabase retorna a linha de appointment_services com `services` em
  // array (quando é relação) — mas aqui é FK → objeto. Normalizamos a
  // ordem por position para garantir previsibilidade.
  const list = (data ?? []) as unknown as AppointmentDetails[]
  for (const a of list) {
    a.services = [...(a.services ?? [])].sort((x, y) => x.position - y.position)
  }
  return list
}

/**
 * Próximos agendamentos a partir de agora, limitado a `limit`.
 * Status considerados: `pending` e `confirmed` (os que de fato
 * vão acontecer). Ordem crescente por `start_at`.
 */
export async function listUpcomingAppointments(
  professionalId: string,
  limit: number,
): Promise<AppointmentDetails[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(
      `
      *,
      client:clients(id, name, phone, email),
      services:appointment_services(
        id, position, price_cents_snapshot, duration_minutes_snapshot,
        service:services(id, name)
      )
    `,
    )
    .eq('professional_id', professionalId)
    .in('status', ['pending', 'confirmed'])
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(limit)

  if (error) throw error

  const list = (data ?? []) as unknown as AppointmentDetails[]
  for (const a of list) {
    a.services = [...(a.services ?? [])].sort((x, y) => x.position - y.position)
  }
  return list
}

export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

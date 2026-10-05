import { supabase } from '@/lib/supabase'
import type { BookAppointmentResult } from '@/types/database'

export interface BookPayload {
  slug: string
  serviceIds: string[]
  startAt: Date | string
  clientName: string
  clientPhone: string
  clientEmail?: string | null
  notes?: string | null
}

/**
 * Pede os horários disponíveis para (slug, lista de serviços, data).
 * O passo da RPC é a soma das durações dos serviços informados.
 * A RPC é SECURITY DEFINER: retorna só os timestamps dos slots,
 * nunca expõe appointments.
 */
export async function getAvailableSlots(
  slug: string,
  serviceIds: string[],
  date: Date,
): Promise<string[]> {
  const isoDate = toISODate(date)
  const { data, error } = await supabase.rpc('get_available_slots', {
    p_slug: slug,
    p_service_ids: serviceIds,
    p_date: isoDate,
  })
  if (error) throw error
  return (data ?? []) as string[]
}

/**
 * Reserva via RPC `book_appointment`. Aceita múltiplos serviços;
 * a RPC soma durações/preços e grava um registro em
 * `appointment_services` por serviço (com snapshot).
 */
export async function bookAppointment(
  payload: BookPayload,
): Promise<BookAppointmentResult> {
  const { data, error } = await supabase.rpc('book_appointment', {
    p_slug: payload.slug,
    p_service_ids: payload.serviceIds,
    p_start_at:
      typeof payload.startAt === 'string'
        ? payload.startAt
        : payload.startAt.toISOString(),
    p_client_name: payload.clientName,
    p_client_phone: payload.clientPhone,
    p_client_email: payload.clientEmail ?? null,
    p_notes: payload.notes ?? null,
  })
  if (error) throw error
  return data as BookAppointmentResult
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

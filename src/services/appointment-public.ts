import { supabase } from '@/lib/supabase'
import type { AppointmentStatus } from '@/types/domain'

export interface AppointmentPublicView {
  appointment: {
    id: string
    start_at: string
    end_at: string
    status: AppointmentStatus
    notes: string | null
    total_price_cents: number
    total_duration_minutes: number
  }
  professional: {
    name: string
    slug: string
    phone: string | null
    avatar_url: string | null
  }
  client: {
    name: string
  }
  services: Array<{
    name: string | null
    price_cents: number
    duration_minutes: number
  }>
  can_cancel: boolean
  cancel_until: string | null
  cancellation_enabled: boolean
}

export type GetAppointmentResult =
  | { status: 'ok'; view: AppointmentPublicView }
  | { status: 'error'; error: string }

export async function getAppointmentByToken(
  slug: string,
  token: string,
): Promise<GetAppointmentResult> {
  const { data, error } = await supabase.rpc('get_appointment_by_token', {
    p_slug: slug,
    p_token: token,
  })
  if (error) throw error
  const result = data as
    | ({ status: 'ok' } & AppointmentPublicView)
    | { status: 'error'; error: string }
  if (result.status === 'error') return result
  // Reorganiza no formato tipado
  const { status, ...view } = result
  void status
  return { status: 'ok', view: view as AppointmentPublicView }
}

export type CancelAppointmentResult =
  | { status: 'ok' }
  | { status: 'error'; error: string }

export async function cancelAppointmentByToken(
  slug: string,
  token: string,
): Promise<CancelAppointmentResult> {
  const { data, error } = await supabase.rpc('cancel_appointment_by_token', {
    p_slug: slug,
    p_token: token,
  })
  if (error) throw error
  return data as CancelAppointmentResult
}

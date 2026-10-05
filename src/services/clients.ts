import { supabase } from '@/lib/supabase'
import type { Client } from '@/types/database'
import type { AppointmentStatus } from '@/types/domain'

/** Appointment "slim" embarcado para calcular stats do cliente sem joins extras. */
interface AppointmentSlim {
  id: string
  status: AppointmentStatus
  start_at: string
  total_price_cents: number
}

export interface ClientWithStats extends Client {
  appointments_count: number
  completed_count: number
  total_spent_cents: number
  first_appointment_at: string | null
  last_appointment_at: string | null
}

export interface ClientHistoryItem {
  id: string
  start_at: string
  end_at: string
  status: AppointmentStatus
  notes: string | null
  total_price_cents: number
  total_duration_minutes: number
  services: Array<{ id: string; name: string | null }>
}

export interface ClientDetails extends ClientWithStats {
  history: ClientHistoryItem[]
}

function aggregate(appointments: AppointmentSlim[]): Omit<ClientWithStats, keyof Client> {
  let completed = 0
  let total = 0
  let first: string | null = null
  let last: string | null = null

  for (const a of appointments) {
    if (first === null || a.start_at < first) first = a.start_at
    if (a.status === 'completed') {
      completed += 1
      total += a.total_price_cents
      if (last === null || a.start_at > last) last = a.start_at
    }
  }
  return {
    appointments_count: appointments.length,
    completed_count: completed,
    total_spent_cents: total,
    first_appointment_at: first,
    last_appointment_at: last,
  }
}

export async function listClients(
  professionalId: string,
): Promise<ClientWithStats[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(`
      *,
      appointments:appointments(id, status, start_at, total_price_cents)
    `)
    .eq('professional_id', professionalId)
    .order('name', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => {
    const { appointments, ...client } = row as Client & {
      appointments: AppointmentSlim[]
    }
    return {
      ...client,
      ...aggregate(appointments ?? []),
    }
  })
}

export async function getClient(id: string): Promise<ClientDetails | null> {
  const { data, error } = await supabase
    .from('clients')
    .select(`
      *,
      appointments:appointments(
        id, start_at, end_at, status, notes,
        total_price_cents, total_duration_minutes,
        appointment_services(position, service:services(id, name))
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as unknown as Client & {
    appointments: Array<{
      id: string
      start_at: string
      end_at: string
      status: AppointmentStatus
      notes: string | null
      total_price_cents: number
      total_duration_minutes: number
      appointment_services: Array<{
        position: number
        service: { id: string; name: string | null } | null
      }>
    }>
  }

  const { appointments, ...client } = row
  const stats = aggregate(
    (appointments ?? []).map((a) => ({
      id: a.id,
      status: a.status,
      start_at: a.start_at,
      total_price_cents: a.total_price_cents,
    })),
  )

  const history: ClientHistoryItem[] = (appointments ?? [])
    .map((a) => {
      const services = [...(a.appointment_services ?? [])]
        .sort((x, y) => x.position - y.position)
        .map((s) => ({
          id: s.service?.id ?? '',
          name: s.service?.name ?? null,
        }))
      return {
        id: a.id,
        start_at: a.start_at,
        end_at: a.end_at,
        status: a.status,
        notes: a.notes,
        total_price_cents: a.total_price_cents,
        total_duration_minutes: a.total_duration_minutes,
        services,
      }
    })
    .sort((x, y) => (x.start_at < y.start_at ? 1 : -1))

  return {
    ...client,
    ...stats,
    history,
  }
}

export async function updateClientNotes(id: string, notes: string | null): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .update({ notes })
    .eq('id', id)
  if (error) throw error
}

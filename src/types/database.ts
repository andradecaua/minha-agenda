// Tipos espelho do schema Postgres. Até integrarmos a geração automática
// (`supabase gen types typescript`), mantemos manual — qualquer mudança
// nas migrations exige atualização correspondente aqui e no CONTEXT.md.

import type { AppointmentStatus } from './domain'

export interface Profile {
  id: string
  user_id: string
  slug: string
  name: string
  bio: string | null
  avatar_url: string | null
  phone: string | null
  city: string | null
  timezone: string
  created_at: string
  updated_at: string
}

export interface BookingSettings {
  id: string
  professional_id: string
  minimum_advance_minutes: number
  maximum_advance_days: number
  require_confirmation: boolean
  cancellation_enabled: boolean
  cancellation_deadline_minutes: number
  default_interval_minutes: number
  online_booking_enabled: boolean
  created_at: string
  updated_at: string
}

export interface BusinessHour {
  id: string
  professional_id: string
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6
  start_time: string // 'HH:MM:SS'
  end_time: string
  active: boolean
  created_at: string
}

export interface Service {
  id: string
  professional_id: string
  name: string
  description: string | null
  price_cents: number
  duration_minutes: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface Client {
  id: string
  professional_id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Appointment {
  id: string
  professional_id: string
  client_id: string
  /** Serviço principal (= primeiro adicionado). Para a lista completa use `appointment_services`. */
  service_id: string
  start_at: string
  end_at: string
  status: AppointmentStatus
  notes: string | null
  total_price_cents: number
  total_duration_minutes: number
  created_at: string
  updated_at: string
}

export interface AppointmentService {
  id: string
  appointment_id: string
  service_id: string
  price_cents_snapshot: number
  duration_minutes_snapshot: number
  position: number
  created_at: string
}

export interface PortfolioItem {
  id: string
  professional_id: string
  image_url: string
  storage_path: string
  title: string | null
  description: string | null
  position: number
  created_at: string
}

export interface Product {
  id: string
  professional_id: string
  name: string
  description: string | null
  price_cents: number
  stock: number
  sku: string | null
  image_url: string | null
  active: boolean
  created_at: string
  updated_at: string
}

// Payload de resposta da RPC book_appointment
export type BookAppointmentResult =
  | {
      status: 'ok'
      appointment_id: string
      appointment_status: AppointmentStatus
      cancel_token: string
      total_price_cents: number
      total_duration_minutes: number
    }
  | { status: 'error'; error: string }

// Tipos admin / planos — ver 0018_admin_and_plans.sql e src/types/admin.ts
export type { Plan, Subscription } from './admin'

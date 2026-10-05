import { supabase } from '@/lib/supabase'
import type { BookingSettings } from '@/types/database'

export type BookingSettingsUpdate = Partial<
  Pick<
    BookingSettings,
    | 'minimum_advance_minutes'
    | 'maximum_advance_days'
    | 'require_confirmation'
    | 'cancellation_enabled'
    | 'cancellation_deadline_minutes'
    | 'default_interval_minutes'
    | 'online_booking_enabled'
  >
>

export async function getBookingSettings(
  professionalId: string,
): Promise<BookingSettings | null> {
  const { data, error } = await supabase
    .from('booking_settings')
    .select('*')
    .eq('professional_id', professionalId)
    .maybeSingle()
  if (error) throw error
  return (data as BookingSettings | null) ?? null
}

export async function updateBookingSettings(
  professionalId: string,
  patch: BookingSettingsUpdate,
): Promise<BookingSettings> {
  const { data, error } = await supabase
    .from('booking_settings')
    .update(patch)
    .eq('professional_id', professionalId)
    .select()
    .single()
  if (error) throw error
  return data as BookingSettings
}

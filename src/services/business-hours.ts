import { supabase } from '@/lib/supabase'
import type { BusinessHour } from '@/types/database'

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface BusinessHourInput {
  weekday: Weekday
  start_time: string // 'HH:MM' ou 'HH:MM:SS'
  end_time: string
  active?: boolean
}

export async function listBusinessHours(
  professionalId: string,
): Promise<BusinessHour[]> {
  const { data, error } = await supabase
    .from('business_hours')
    .select('*')
    .eq('professional_id', professionalId)
    .order('weekday', { ascending: true })
    .order('start_time', { ascending: true })
  if (error) throw error
  return (data ?? []) as BusinessHour[]
}

/**
 * Substitui TODAS as janelas de um weekday pelas fornecidas.
 * Mais simples e previsível que diff-and-apply.
 */
export async function replaceWeekdayHours(
  professionalId: string,
  weekday: Weekday,
  windows: Array<Omit<BusinessHourInput, 'weekday'>>,
): Promise<void> {
  const { error: delErr } = await supabase
    .from('business_hours')
    .delete()
    .eq('professional_id', professionalId)
    .eq('weekday', weekday)
  if (delErr) throw delErr

  if (windows.length === 0) return

  const rows = windows.map((w) => ({
    professional_id: professionalId,
    weekday,
    start_time: w.start_time,
    end_time: w.end_time,
    active: w.active ?? true,
  }))

  const { error: insErr } = await supabase.from('business_hours').insert(rows)
  if (insErr) throw insErr
}

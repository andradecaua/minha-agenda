import { supabase } from '@/lib/supabase'
import type { Service } from '@/types/database'

export type ServiceInput = Pick<
  Service,
  'name' | 'description' | 'price_cents' | 'duration_minutes' | 'active'
>

export async function listServices(
  professionalId: string,
): Promise<Service[]> {
  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('professional_id', professionalId)
    .order('active', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Service[]
}

export async function createService(
  professionalId: string,
  input: ServiceInput,
): Promise<Service> {
  const { data, error } = await supabase
    .from('services')
    .insert({ professional_id: professionalId, ...input })
    .select()
    .single()
  if (error) throw error
  return data as Service
}

export async function updateService(
  id: string,
  patch: Partial<ServiceInput>,
): Promise<Service> {
  const { data, error } = await supabase
    .from('services')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Service
}

export async function toggleServiceActive(
  id: string,
  active: boolean,
): Promise<Service> {
  return updateService(id, { active })
}

/**
 * Pode falhar se o serviço tiver agendamentos (FK ON DELETE RESTRICT).
 * O frontend traduz o erro e sugere apenas desativar.
 */
export async function deleteService(id: string): Promise<void> {
  const { error } = await supabase.from('services').delete().eq('id', id)
  if (error) throw error
}

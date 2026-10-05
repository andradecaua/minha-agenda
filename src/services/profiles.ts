import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/database'

export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export type ProfileUpdate = Partial<
  Pick<Profile, 'name' | 'slug' | 'bio' | 'avatar_url' | 'phone' | 'city' | 'timezone'>
>

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return (data as Profile | null) ?? null
}

export async function updateMyProfile(
  profileId: string,
  patch: ProfileUpdate,
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', profileId)
    .select()
    .single()
  if (error) throw error
  return data as Profile
}

/**
 * Verifica se o slug está livre para uso. Ignora o próprio profile
 * (usado durante edição). Em caso de erro de rede, assume indisponível
 * de maneira conservadora — o backend ainda enforcia via UNIQUE.
 */
export async function isSlugAvailable(
  slug: string,
  exceptProfileId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('slug', slug)
    .neq('id', exceptProfileId)
    .maybeSingle()
  if (error) return false
  return !data
}

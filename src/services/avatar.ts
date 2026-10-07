import { supabase } from '@/lib/supabase'
import { uploadImage } from '@/services/storage'
import type { Profile } from '@/types/database'

/**
 * Faz upload do novo avatar e grava o URL no profile. O blob antigo
 * é removido automaticamente pelo trigger
 * `profiles_cleanup_avatar_upd` (migration 0029) quando `avatar_url`
 * muda — não precisamos limpar aqui.
 *
 * Se o UPDATE do profile falhar, propagamos o erro; o blob recém
 * subido fica órfão (raríssimo — eventual cleanup via query manual
 * ou o próprio trigger de orphans se o pattern se repetir).
 */
export async function replaceAvatar(
  professional: Pick<Profile, 'id' | 'avatar_url'>,
  file: File,
): Promise<string> {
  const { publicUrl } = await uploadImage('avatars', professional.id, file)

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', professional.id)
  if (error) throw error

  return publicUrl
}

/** Remove o avatar atual. Trigger limpa o blob. */
export async function removeAvatar(
  professional: Pick<Profile, 'id' | 'avatar_url'>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', professional.id)
  if (error) throw error
}

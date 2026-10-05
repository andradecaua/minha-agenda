import { supabase } from '@/lib/supabase'
import { deleteImage, pathFromPublicUrl, uploadImage } from '@/services/storage'
import type { Profile } from '@/types/database'

/**
 * Faz upload do novo avatar, atualiza o profile e remove o arquivo antigo
 * (se existir). Se qualquer passo falhar, propaga o erro — a UI mostra
 * a mensagem apropriada.
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

  // Best-effort: remove o avatar antigo. Falha de delete não aborta.
  const oldPath = pathFromPublicUrl('avatars', professional.avatar_url)
  if (oldPath) {
    try {
      await deleteImage('avatars', oldPath)
    } catch {
      /* ignore */
    }
  }

  return publicUrl
}

export async function removeAvatar(
  professional: Pick<Profile, 'id' | 'avatar_url'>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', professional.id)
  if (error) throw error

  const path = pathFromPublicUrl('avatars', professional.avatar_url)
  if (path) {
    try {
      await deleteImage('avatars', path)
    } catch {
      /* ignore */
    }
  }
}

import { supabase } from '@/lib/supabase'
import { deleteImage, uploadImage } from '@/services/storage'
import type { PortfolioItem } from '@/types/database'

/**
 * Portfólio é COMPARTILHADO pela equipe (migration 0033). Qualquer
 * membro do time lista/adiciona/edita/remove. `professional_id`
 * continua gravado como "quem subiu" pra atribuição futura.
 */
export async function listPortfolio(
  teamId: string,
): Promise<PortfolioItem[]> {
  const { data, error } = await supabase
    .from('portfolio_items')
    .select('*')
    .eq('team_id', teamId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PortfolioItem[]
}

export interface AddPortfolioInput {
  file: File
  title?: string | null
  description?: string | null
}

export async function addPortfolioItem(
  teamId: string,
  uploaderProfessionalId: string,
  input: AddPortfolioInput,
): Promise<PortfolioItem> {
  // Upload sob o path `portfolio/{team_id}/<rand>.ext` — storage
  // policy `portfolio_team_insert` (0033) exige folder == team_id.
  const { path, publicUrl } = await uploadImage('portfolio', teamId, input.file)

  // Próxima position dentro do TIME (não do profissional).
  const { data: last } = await supabase
    .from('portfolio_items')
    .select('position')
    .eq('team_id', teamId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPos = (last?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('portfolio_items')
    .insert({
      team_id: teamId,
      professional_id: uploaderProfessionalId,
      image_url: publicUrl,
      storage_path: path,
      title: input.title?.trim() || null,
      description: input.description?.trim() || null,
      position: nextPos,
    })
    .select()
    .single()

  if (error) {
    // Rollback best-effort do blob
    try {
      await deleteImage('portfolio', path)
    } catch {
      /* ignore */
    }
    throw error
  }

  return data as PortfolioItem
}

export async function updatePortfolioItem(
  id: string,
  patch: Partial<Pick<PortfolioItem, 'title' | 'description' | 'position'>>,
): Promise<PortfolioItem> {
  const { data, error } = await supabase
    .from('portfolio_items')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as PortfolioItem
}

export async function deletePortfolioItem(item: PortfolioItem): Promise<void> {
  // Trigger `portfolio_items_cleanup_blob` (migration 0029) apaga o
  // blob na mesma transação. Nada de storage.remove() daqui.
  const { error } = await supabase
    .from('portfolio_items')
    .delete()
    .eq('id', item.id)
  if (error) throw error
}

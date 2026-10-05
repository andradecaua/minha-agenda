import { supabase } from '@/lib/supabase'
import { deleteImage, uploadImage } from '@/services/storage'
import type { PortfolioItem } from '@/types/database'

export async function listPortfolio(
  professionalId: string,
): Promise<PortfolioItem[]> {
  const { data, error } = await supabase
    .from('portfolio_items')
    .select('*')
    .eq('professional_id', professionalId)
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
  professionalId: string,
  input: AddPortfolioInput,
): Promise<PortfolioItem> {
  const { path, publicUrl } = await uploadImage('portfolio', professionalId, input.file)

  // Próxima position: max(position)+1. Falhando a consulta, usa 0.
  const { data: last } = await supabase
    .from('portfolio_items')
    .select('position')
    .eq('professional_id', professionalId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPos = (last?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('portfolio_items')
    .insert({
      professional_id: professionalId,
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
  const { error } = await supabase
    .from('portfolio_items')
    .delete()
    .eq('id', item.id)
  if (error) throw error
  // Best-effort — mesmo se o blob falhar em sumir, a linha já saiu.
  try {
    await deleteImage('portfolio', item.storage_path)
  } catch {
    /* ignore */
  }
}

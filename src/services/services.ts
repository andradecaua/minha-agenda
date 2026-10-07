import { supabase } from '@/lib/supabase'
import { deleteImage, uploadImage } from '@/services/storage'
import type { Service } from '@/types/database'

export type ServiceInput = Pick<
  Service,
  'name' | 'description' | 'price_cents' | 'duration_minutes' | 'icon' | 'active'
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

/**
 * Opções de imagem no create. Separadas do payload principal porque
 * upload acontece ANTES do INSERT (padrão do products.ts) — se o
 * INSERT falhar, a gente limpa o blob.
 *
 * `imageFile` só é respeitado se o chamador tem a permissão
 * `custom_images` — o form é responsável por não enviar o arquivo
 * quando o usuário não pode (gate no UI, não no RLS).
 */
export interface CreateServiceOptions {
  imageFile?: File | null
}

export async function createService(
  professionalId: string,
  input: ServiceInput,
  { imageFile }: CreateServiceOptions = {},
): Promise<Service> {
  let imageUrl: string | null = null
  let uploadedPath: string | null = null

  if (imageFile) {
    const { publicUrl, path } = await uploadImage('services', professionalId, imageFile)
    imageUrl = publicUrl
    uploadedPath = path
  }

  const { data, error } = await supabase
    .from('services')
    .insert({
      professional_id: professionalId,
      image_url: imageUrl,
      image_storage_path: uploadedPath,
      ...input,
    })
    .select()
    .single()

  if (error) {
    if (uploadedPath) {
      try {
        await deleteImage('services', uploadedPath)
      } catch {
        /* ignore */
      }
    }
    throw error
  }
  return data as Service
}

export interface UpdateServiceOptions {
  /** Novo arquivo substitui a imagem atual. */
  imageFile?: File | null
  /** Se true, remove a imagem atual (sem substituir). */
  removeImage?: boolean
}

export async function updateService(
  current: Service,
  patch: Partial<ServiceInput>,
  { imageFile, removeImage }: UpdateServiceOptions = {},
): Promise<Service> {
  const update: Partial<Service> = { ...patch }
  let newUploadPath: string | null = null

  if (imageFile) {
    const { publicUrl, path } = await uploadImage(
      'services',
      current.professional_id,
      imageFile,
    )
    update.image_url = publicUrl
    update.image_storage_path = path
    newUploadPath = path
  } else if (removeImage) {
    update.image_url = null
    update.image_storage_path = null
  }

  const { data, error } = await supabase
    .from('services')
    .update(update)
    .eq('id', current.id)
    .select()
    .single()

  if (error) {
    if (newUploadPath) {
      try {
        await deleteImage('services', newUploadPath)
      } catch {
        /* ignore */
      }
    }
    throw error
  }

  // Blob antigo é apagado por trigger (`services_cleanup_blob_upd`,
  // migration 0029) quando `image_url`/`image_storage_path` mudam.

  return data as Service
}

export async function toggleServiceActive(
  service: Service,
  active: boolean,
): Promise<Service> {
  return updateService(service, { active })
}

/**
 * Pode falhar se o serviço tiver agendamentos (FK ON DELETE RESTRICT).
 * O frontend traduz o erro e sugere apenas desativar.
 *
 * Trigger `services_cleanup_blob_del` (migration 0029) remove o blob
 * na mesma transação do DELETE quando este é bem-sucedido.
 */
export async function deleteService(service: Service): Promise<void> {
  const { error } = await supabase.from('services').delete().eq('id', service.id)
  if (error) throw error
}

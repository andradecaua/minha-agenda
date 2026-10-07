import { supabase } from '@/lib/supabase'
import { deleteImage, uploadImage } from '@/services/storage'
import type { Product } from '@/types/database'

export type ProductInput = Pick<
  Product,
  'name' | 'description' | 'price_cents' | 'stock' | 'sku' | 'icon' | 'active'
>

export async function listProducts(
  professionalId: string,
): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('professional_id', professionalId)
    .order('active', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Product[]
}

export async function createProduct(
  professionalId: string,
  input: ProductInput,
  imageFile?: File | null,
): Promise<Product> {
  let imageUrl: string | null = null
  let uploadedPath: string | null = null

  if (imageFile) {
    const { publicUrl, path } = await uploadImage('products', professionalId, imageFile)
    imageUrl = publicUrl
    uploadedPath = path
  }

  const { data, error } = await supabase
    .from('products')
    .insert({ professional_id: professionalId, image_url: imageUrl, ...input })
    .select()
    .single()

  if (error) {
    // Rollback do blob se o INSERT falhar
    if (uploadedPath) {
      try {
        await deleteImage('products', uploadedPath)
      } catch {
        /* ignore */
      }
    }
    throw error
  }
  return data as Product
}

export interface UpdateProductOptions {
  /** Novo arquivo substitui a imagem atual. */
  imageFile?: File | null
  /** Se true, remove a imagem atual (sem substituir). */
  removeImage?: boolean
}

export async function updateProduct(
  current: Product,
  patch: Partial<ProductInput>,
  { imageFile, removeImage }: UpdateProductOptions = {},
): Promise<Product> {
  const update: Partial<Product> = { ...patch }
  let newUploadPath: string | null = null

  if (imageFile) {
    const { publicUrl, path } = await uploadImage('products', current.professional_id, imageFile)
    update.image_url = publicUrl
    newUploadPath = path
  } else if (removeImage) {
    update.image_url = null
  }

  const { data, error } = await supabase
    .from('products')
    .update(update)
    .eq('id', current.id)
    .select()
    .single()

  if (error) {
    if (newUploadPath) {
      try {
        await deleteImage('products', newUploadPath)
      } catch {
        /* ignore */
      }
    }
    throw error
  }

  // Blob antigo é apagado por trigger (`products_cleanup_blob_upd`,
  // migration 0029) quando o UPDATE muda `image_url`. Não precisamos
  // mais chamar `storage.remove` daqui.

  return data as Product
}

export async function toggleProductActive(
  product: Product,
  active: boolean,
): Promise<Product> {
  return updateProduct(product, { active })
}

export async function deleteProduct(product: Product): Promise<void> {
  // Trigger `products_cleanup_blob_del` (migration 0029) remove o blob
  // na mesma transação do DELETE.
  const { error } = await supabase.from('products').delete().eq('id', product.id)
  if (error) throw error
}

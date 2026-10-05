import { supabase } from '@/lib/supabase'

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const PORTFOLIO_MAX_BYTES = 5 * 1024 * 1024
export const PRODUCTS_MAX_BYTES = 5 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type UploadBucket = 'avatars' | 'portfolio' | 'products'

export interface UploadResult {
  path: string
  publicUrl: string
}

export class UploadValidationError extends Error {
  constructor(public code: 'invalid_type' | 'too_large', message: string) {
    super(message)
    this.name = 'UploadValidationError'
  }
}

function assertFileOk(file: File, maxBytes: number) {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new UploadValidationError(
      'invalid_type',
      'Formato inválido. Use JPG, PNG ou WEBP.',
    )
  }
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024))
    throw new UploadValidationError('too_large', `Arquivo muito grande (máx. ${mb}MB).`)
  }
}

function randomFileName(originalName: string): string {
  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ext.length <= 5 ? ext : 'jpg'
  const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `${rand}.${safeExt}`
}

const MAX_BY_BUCKET: Record<UploadBucket, number> = {
  avatars: AVATAR_MAX_BYTES,
  portfolio: PORTFOLIO_MAX_BYTES,
  products: PRODUCTS_MAX_BYTES,
}

export async function uploadImage(
  bucket: UploadBucket,
  professionalId: string,
  file: File,
): Promise<UploadResult> {
  const maxBytes = MAX_BY_BUCKET[bucket]
  assertFileOk(file, maxBytes)

  const path = `${professionalId}/${randomFileName(file.name)}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  })
  if (error) throw error

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return { path, publicUrl: data.publicUrl }
}

export async function deleteImage(
  bucket: UploadBucket,
  path: string,
): Promise<void> {
  if (!path) return
  const { error } = await supabase.storage.from(bucket).remove([path])
  if (error) throw error
}

/**
 * Deriva o `storage_path` a partir de uma public URL do Supabase Storage.
 * Útil quando temos só a URL salva e queremos limpar o blob antigo.
 * Retorna null se não for uma URL deste bucket.
 */
export function pathFromPublicUrl(
  bucket: UploadBucket,
  publicUrl: string | null,
): string | null {
  if (!publicUrl) return null
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  return publicUrl.slice(idx + marker.length)
}

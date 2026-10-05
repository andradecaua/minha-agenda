import { supabase } from '@/lib/supabase'
import type {
  BookingSettings,
  PortfolioItem,
  Product,
  Profile,
  Service,
} from '@/types/database'

export interface PublicProfessional {
  profile: Profile
  settings: BookingSettings | null
  services: Service[]
  portfolio: PortfolioItem[]
  products: Product[]
}

/**
 * Busca a visão pública de um profissional por slug. Usa a chave anon
 * — a RLS garante que apenas o que é público (profile completo,
 * services active=true, booking_settings) seja retornado.
 *
 * Retorna `null` quando o slug não corresponde a nenhum profissional.
 */
export async function getPublicProfessional(
  slug: string,
): Promise<PublicProfessional | null> {
  const normalized = slug.trim().toLowerCase()
  if (!normalized) return null

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('slug', normalized)
    .maybeSingle()

  if (profileErr) throw profileErr
  if (!profile) return null

  const [settingsResult, servicesResult, portfolioResult, productsResult] =
    await Promise.all([
      supabase
        .from('booking_settings')
        .select('*')
        .eq('professional_id', profile.id)
        .maybeSingle(),
      supabase
        .from('services')
        .select('*')
        .eq('professional_id', profile.id)
        .eq('active', true)
        .order('price_cents', { ascending: true }),
      supabase
        .from('portfolio_items')
        .select('*')
        .eq('professional_id', profile.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select('*')
        .eq('professional_id', profile.id)
        .eq('active', true)
        .order('name', { ascending: true }),
    ])

  if (settingsResult.error) throw settingsResult.error
  if (servicesResult.error) throw servicesResult.error
  if (portfolioResult.error) throw portfolioResult.error
  if (productsResult.error) throw productsResult.error

  return {
    profile: profile as Profile,
    settings: (settingsResult.data as BookingSettings | null) ?? null,
    services: (servicesResult.data ?? []) as Service[],
    portfolio: (portfolioResult.data ?? []) as PortfolioItem[],
    products: (productsResult.data ?? []) as Product[],
  }
}

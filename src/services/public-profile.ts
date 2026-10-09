import { supabase } from '@/lib/supabase'
import type {
  BookingSettings,
  PortfolioItem,
  Product,
  Profile,
  Service,
} from '@/types/database'

export interface PublicTeamSummary {
  id: string
  slug: string
  name: string
  owner_user_id: string
  /** Plano de fundo da página pública (0039). */
  background_url: string | null
  /**
   * Profiles de todos os membros do time (owner incluído), ordenados
   * com owner primeiro. Usado pra renderizar o "pick a professional"
   * quando a equipe tem múltiplos membros.
   */
  members: Array<Pick<Profile, 'id' | 'user_id' | 'slug' | 'name' | 'bio' | 'avatar_url' | 'city'> & {
    role: 'owner' | 'member'
  }>
}

export interface PublicProfessional {
  profile: Profile
  /** Equipe do profissional. Sempre presente (todo profile tem solo team). */
  team: PublicTeamSummary | null
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

  // Portfolio é compartilhado pela equipe (migration 0033). Resolve o
  // team do profile via team_members pra consultar na coluna certa.
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', profile.user_id)
    .maybeSingle()
  const teamId = (teamMember?.team_id as string | undefined) ?? null

  // Carrega team completo (teams + todos os membros com profile).
  // Em paralelo com o resto; team_members tem SELECT público (0032).
  let publicTeam: PublicTeamSummary | null = null
  if (teamId) {
    const [{ data: teamRow }, { data: memberRows }] = await Promise.all([
      supabase
        .from('teams')
        .select('id, slug, name, owner_user_id, background_url')
        .eq('id', teamId)
        .maybeSingle(),
      supabase
        .from('team_members')
        .select('user_id, role')
        .eq('team_id', teamId),
    ])
    if (teamRow && memberRows && memberRows.length > 0) {
      const userIds = memberRows.map((r) => r.user_id as string)
      const { data: memberProfiles } = await supabase
        .from('profiles')
        .select('id, user_id, slug, name, bio, avatar_url, city')
        .in('user_id', userIds)
      const profilesByUser = new Map(
        (memberProfiles ?? []).map((p) => [p.user_id as string, p]),
      )
      const members = memberRows
        .map((m) => {
          const p = profilesByUser.get(m.user_id as string)
          if (!p) return null
          return {
            id: p.id as string,
            user_id: p.user_id as string,
            slug: p.slug as string,
            name: p.name as string,
            bio: (p.bio as string | null) ?? null,
            avatar_url: (p.avatar_url as string | null) ?? null,
            city: (p.city as string | null) ?? null,
            role: m.role as 'owner' | 'member',
          }
        })
        .filter((v): v is NonNullable<typeof v> => v !== null)
        .sort((a, b) => {
          // Owner primeiro, depois ordem alfabética.
          if (a.role !== b.role) return a.role === 'owner' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      publicTeam = {
        id: teamRow.id as string,
        slug: teamRow.slug as string,
        name: teamRow.name as string,
        owner_user_id: teamRow.owner_user_id as string,
        background_url: (teamRow.background_url as string | null) ?? null,
        members,
      }
    }
  }

  const [settingsResult, servicesResult, portfolioResult, productsResult] =
    await Promise.all([
      supabase
        .from('booking_settings')
        .select('*')
        .eq('professional_id', profile.id)
        .maybeSingle(),
      // Services ficam no team desde 0038 (compartilhados). O
      // visitante na página pública vê TODOS os serviços do time,
      // independente de qual pro ele clicou.
      teamId
        ? supabase
            .from('services')
            .select('*')
            .eq('team_id', teamId)
            .eq('active', true)
            .order('price_cents', { ascending: true })
        : Promise.resolve({ data: [] as unknown[], error: null }),
      teamId
        ? supabase
            .from('portfolio_items')
            .select('*')
            .eq('team_id', teamId)
            .order('position', { ascending: true })
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as unknown[], error: null }),
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
    team: publicTeam,
    settings: (settingsResult.data as BookingSettings | null) ?? null,
    services: (servicesResult.data ?? []) as Service[],
    portfolio: (portfolioResult.data ?? []) as PortfolioItem[],
    products: (productsResult.data ?? []) as Product[],
  }
}

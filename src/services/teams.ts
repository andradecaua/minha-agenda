import { supabase } from '@/lib/supabase'

export type TeamRole = 'owner' | 'member'

export interface Team {
  id: string
  slug: string
  name: string
  owner_user_id: string
  created_at: string
  updated_at: string
}

export interface TeamMember {
  team_id: string
  user_id: string
  role: TeamRole
  joined_at: string
}

export interface TeamMemberWithProfile extends TeamMember {
  profile: {
    id: string
    name: string
    slug: string
    avatar_url: string | null
  } | null
}

/**
 * Resolve o team do usuário atual via `current_team_id()` + leitura
 * da linha. Em sessões autenticadas sempre retorna um team — todo
 * profile é provisionado com um team solo (migration 0032).
 */
export async function getMyTeam(): Promise<Team | null> {
  const { data: teamIdResult, error: teamIdErr } = await supabase.rpc('current_team_id')
  if (teamIdErr) throw teamIdErr
  const teamId = teamIdResult as string | null
  if (!teamId) return null

  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .maybeSingle()
  if (error) throw error
  return (data as Team | null) ?? null
}

/**
 * Lista membros do team com perfil associado. Faz 2 queries + merge
 * em JS porque `team_members.user_id` referencia `auth.users` (não
 * `profiles`) e o PostgREST não consegue inferir o relacionamento
 * via FK — mais previsível manual.
 */
export async function listTeamMembers(teamId: string): Promise<TeamMemberWithProfile[]> {
  const { data: rows, error } = await supabase
    .from('team_members')
    .select('team_id, user_id, role, joined_at')
    .eq('team_id', teamId)
    .order('role', { ascending: true })
    .order('joined_at', { ascending: true })
  if (error) throw error
  const members = (rows ?? []) as TeamMember[]
  if (members.length === 0) return []

  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, user_id, name, slug, avatar_url')
    .in('user_id', members.map((m) => m.user_id))
  if (profErr) throw profErr

  const profMap = new Map(
    (profiles ?? []).map((p) => [
      p.user_id as string,
      {
        id: p.id as string,
        name: p.name as string,
        slug: p.slug as string,
        avatar_url: (p.avatar_url as string | null) ?? null,
      },
    ]),
  )

  return members.map((m) => ({
    ...m,
    profile: profMap.get(m.user_id) ?? null,
  }))
}

/**
 * Atualiza nome do time (visível na página pública se o team tem
 * múltiplos membros). Só owner pode (RLS).
 */
export async function updateTeamName(teamId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('teams')
    .update({ name: name.trim() })
    .eq('id', teamId)
  if (error) throw error
}

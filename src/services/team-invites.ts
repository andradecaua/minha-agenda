import { supabase } from '@/lib/supabase'

export type TeamInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface TeamInvite {
  id: string
  team_id: string
  email: string
  token: string
  invited_by: string | null
  status: TeamInviteStatus
  expires_at: string
  created_at: string
  accepted_at: string | null
  accepted_by: string | null
}

export interface ResolvedInvite {
  invite_id: string
  email: string
  team_id: string
  team_name: string
  expires_at: string
}

type RpcResult<T> = ({ status: 'ok' } & T) | { status: 'error'; error: string }

const ERROR_LABEL: Record<string, string> = {
  unauthorized: 'Faça login novamente.',
  no_team: 'Você não está em uma equipe.',
  forbidden_not_owner: 'Só o dono da equipe pode fazer isso.',
  plan_not_team: 'Seu plano não permite equipe — faça upgrade.',
  capacity_full: 'A equipe já está no limite de vagas do plano.',
  already_member: 'Esse email já faz parte da equipe.',
  already_invited: 'Já existe um convite pendente para esse email.',
  invalid_email: 'Email inválido.',
  not_found: 'Convite não encontrado.',
  not_pending: 'Convite não está mais pendente.',
  expired: 'Esse convite expirou.',
  revoked: 'Esse convite foi cancelado.',
  accepted: 'Esse convite já foi aceito.',
  email_mismatch: 'O email não bate com o do convite.',
  already_in_team: 'Você já está em outra equipe.',
  paid_plan_in_use: 'Sua equipe atual tem plano pago. Cancele antes de aceitar outro convite.',
  weak_password: 'A senha precisa ter pelo menos 6 caracteres.',
  set_password_failed: 'Não foi possível salvar a senha. Tente novamente.',
  user_not_found: 'Conta não encontrada. Peça para a equipe reenviar o convite.',
}

function parseOrThrow<T>(data: unknown): { status: 'ok' } & T {
  if (!data || typeof data !== 'object' || !('status' in data)) {
    throw new Error('Resposta inválida do servidor.')
  }
  const result = data as RpcResult<T>
  if (result.status === 'error') {
    throw new Error(ERROR_LABEL[result.error] ?? 'Operação não permitida.')
  }
  return result
}

/**
 * Owner cria convite. Depois dispara o email via edge function.
 */
export async function createInvite(email: string): Promise<{ invite_id: string; token: string }> {
  const { data, error } = await supabase.rpc('create_team_invite', {
    p_email: email,
  })
  if (error) throw error
  const parsed = parseOrThrow<{ invite_id: string; token: string }>(data)
  // Fire-and-forget: manda o email. Se falhar, dono pode re-chamar.
  void supabase.functions
    .invoke('send-team-invite', {
      body: { invite_id: parsed.invite_id },
    })
    .catch((err) => console.warn('[team-invites] falha ao enviar email:', err))
  return { invite_id: parsed.invite_id, token: parsed.token }
}

/**
 * Lista convites pendentes do time atual (visível só pro owner via RLS).
 */
export async function listTeamInvites(teamId: string): Promise<TeamInvite[]> {
  const { data, error } = await supabase
    .from('team_invites')
    .select('*')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as TeamInvite[]
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { data, error } = await supabase.rpc('revoke_team_invite', {
    p_invite_id: inviteId,
  })
  if (error) throw error
  parseOrThrow<unknown>(data)
}

/**
 * Chamado pela página pública /convite/<token> antes de aceitar
 * — mostra "você foi convidado para EQUIPE X".
 */
export async function resolveInvite(token: string): Promise<ResolvedInvite> {
  const { data, error } = await supabase.rpc('resolve_team_invite', {
    p_token: token,
  })
  if (error) throw error
  const parsed = parseOrThrow<ResolvedInvite>(data)
  return parsed
}

/**
 * Aceita o convite — chama a edge function que seta senha e move
 * o user pro team. Retorna o email pra o frontend conseguir fazer
 * signIn automaticamente logo depois.
 */
export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ email: string; team_id: string }> {
  const { data, error } = await supabase.functions.invoke('accept-team-invite', {
    body: { token, password },
  })
  if (error) {
    // Edge function retorna status=error no body do erro.
    const msg = error.message || 'Não foi possível aceitar o convite.'
    throw new Error(ERROR_LABEL[msg] ?? msg)
  }
  const result = (data ?? {}) as {
    status?: string
    error?: string
    email?: string
    team_id?: string
  }
  if (result.status !== 'ok' || !result.email || !result.team_id) {
    throw new Error(ERROR_LABEL[result.error ?? ''] ?? 'Falha ao aceitar.')
  }
  return { email: result.email, team_id: result.team_id }
}

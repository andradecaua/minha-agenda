import { supabase } from '@/lib/supabase'

/**
 * Camada fina sobre `supabase.auth.mfa.*` para TOTP (RFC 6238).
 *
 * O fluxo é padrão Supabase:
 *  1. enroll → cria um "factor" `unverified` e retorna QR code + secret.
 *  2. challenge → gera um `challengeId` com validade curta.
 *  3. verify   → o usuário informa o código do app; sessão sobe para AAL2.
 *
 * O status de admin elevado é checado no banco via `is_admin()`
 * (0018_admin_and_plans.sql), que exige `auth.jwt() ->> 'aal' = 'aal2'`.
 * Enquanto a sessão estiver em AAL1, mesmo o admin tem acesso negado.
 */

export interface MfaFactor {
  id: string
  friendly_name: string | null
  factor_type: 'totp'
  status: 'verified' | 'unverified'
  created_at: string
  updated_at: string
}

export interface EnrollResult {
  factor_id: string
  qr_svg: string
  secret: string
  uri: string
}

export interface AssuranceLevel {
  current: 'aal1' | 'aal2' | null
  next: 'aal1' | 'aal2' | null
}

export async function listFactors(): Promise<MfaFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  const all = (data?.all ?? []) as MfaFactor[]
  return all.filter((f) => f.factor_type === 'totp')
}

export async function getAssuranceLevel(): Promise<AssuranceLevel> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  return {
    current: (data?.currentLevel as AssuranceLevel['current']) ?? null,
    next: (data?.nextLevel as AssuranceLevel['next']) ?? null,
  }
}

export async function enrollTotp(friendlyName = 'Admin'): Promise<EnrollResult> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
    issuer: 'Minha Agenda',
  })
  if (error) throw error
  if (!data) throw new Error('Falha ao iniciar enrolamento')
  return {
    factor_id: data.id,
    qr_svg: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  }
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const challenge = await supabase.auth.mfa.challenge({ factorId })
  if (challenge.error) throw challenge.error
  const challengeId = challenge.data?.id
  if (!challengeId) throw new Error('Não foi possível gerar challenge')
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code: code.replace(/\s+/g, ''),
  })
  if (error) throw error
}

export async function unenroll(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (!error) return
  // DELETE é idempotente: se o fator já não existe no servidor (404),
  // o estado desejado — ausência — já está satisfeito. Acontece quando
  // listFactors devolve um fator stale que foi removido fora da UI.
  const status = (error as { status?: number }).status
  if (status === 404) return
  throw error
}

/**
 * Traduz códigos de erro do Supabase MFA em mensagens em pt-BR.
 * Nunca exibir mensagem crua do servidor ao usuário final.
 *
 * `context` diferencia erros do enroll (gerar QR) dos erros de verify
 * (checar código) — o fallback muda, porque "código inválido" não faz
 * sentido quando ainda nem geramos o QR.
 */
export function translateMfaError(err: unknown, context: 'enroll' | 'verify' = 'verify'): string {
  // Log cru pra diagnóstico — nunca mostrado ao usuário.
  // eslint-disable-next-line no-console
  console.error('[mfa]', context, err)
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (msg.includes('rate')) return 'Muitas tentativas. Aguarde um momento.'
  if (msg.includes('not enabled') || msg.includes('disabled') || msg.includes('mfa_disabled')) {
    return 'MFA/TOTP não está habilitado no projeto Supabase. Habilite em Auth → Providers → TOTP.'
  }
  if (msg.includes('session') || msg.includes('jwt') || msg.includes('authenticated')) {
    return 'Sessão expirada. Faça login de novo.'
  }
  if (context === 'enroll') {
    if (msg.includes('already') && msg.includes('exist')) {
      return 'Já existe um fator MFA. Recarregue a página para começar de novo.'
    }
    return 'Não foi possível gerar o QR code. Verifique se TOTP está habilitado no Supabase e tente de novo.'
  }
  if (msg.includes('invalid') && msg.includes('code')) return 'Código inválido. Tente novamente.'
  if (msg.includes('expired')) return 'Código expirado. Gere um novo no app autenticador.'
  return 'Não foi possível validar o código. Tente novamente.'
}

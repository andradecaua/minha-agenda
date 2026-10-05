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
  if (error) throw error
}

/**
 * Traduz códigos de erro do Supabase MFA em mensagens em pt-BR.
 * Nunca exibir mensagem crua do servidor ao usuário final.
 */
export function translateMfaError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (msg.includes('invalid') && msg.includes('code')) return 'Código inválido. Tente novamente.'
  if (msg.includes('expired')) return 'Código expirado. Gere um novo no app autenticador.'
  if (msg.includes('rate')) return 'Muitas tentativas. Aguarde um momento.'
  if (msg.includes('not enabled') || msg.includes('disabled')) {
    return 'MFA não está habilitado no projeto Supabase. Habilite em Auth → MFA.'
  }
  return 'Não foi possível validar o código. Tente novamente.'
}

import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface SignUpResult {
  /**
   * `true` quando o e-mail já pertence a uma conta existente. O Supabase
   * retorna um "fake user" com `identities: []` nesse caso (para não
   * revelar enumeration por padrão); nós tratamos para dar feedback claro.
   */
  alreadyRegistered: boolean
}

export type Aal = 'aal1' | 'aal2'

export interface SignUpOptions {
  /**
   * URL absoluta pra onde o link do email de confirmação deve
   * redirecionar o usuário. Em geral `${origin}/checkout/<planCode>`
   * quando o cadastro veio da seção de planos. Default: `${origin}`.
   */
  emailRedirectTo?: string
}

export interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /**
   * Authenticator Assurance Level da sessão atual.
   * - `aal1` → só senha
   * - `aal2` → senha + MFA verificada nessa sessão
   * Admin UI exige `aal2` (checado no banco via `is_admin()`).
   */
  aal: Aal
  /**
   * `true` quando a sessão atual veio do link de recovery (evento
   * `PASSWORD_RECOVERY` do Supabase). Guards de rota usam isso pra
   * forçar passagem por `/reset-password` antes de dar acesso ao
   * resto do app — senão o usuário cairia logado só clicando no
   * link, o que contorna a prova de posse do email.
   *
   * Persiste em localStorage (chave `RECOVERY_FLAG_KEY`) pra
   * sobreviver a refresh/nova aba. Limpa em `signOut`.
   */
  isRecoverySession: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    name: string,
    options?: SignUpOptions,
  ) => Promise<SignUpResult>
  /**
   * `scope: 'global'` revoga TODAS as sessões do usuário no Supabase
   * (todos os devices). Usado no fim do fluxo de recovery pra que
   * nenhum device antigo continue logado com a senha velha.
   * Default: `'local'` (só este device).
   */
  signOut: (opts?: { scope?: 'global' | 'local' | 'others' }) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  /** Troca a senha da sessão atual. Usado tanto pelo fluxo de
   *  "esqueci a senha" (quando a sessão é de recovery) quanto por
   *  um usuário logado alterando a própria senha. */
  updatePassword: (newPassword: string) => Promise<void>
  resendSignupEmail: (email: string) => Promise<void>
  refreshAal: () => Promise<void>
}

const RECOVERY_FLAG_KEY = 'minha-agenda:recovery-session'

function readRecoveryFlag(): boolean {
  try {
    return localStorage.getItem(RECOVERY_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function writeRecoveryFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(RECOVERY_FLAG_KEY, '1')
    else localStorage.removeItem(RECOVERY_FLAG_KEY)
  } catch {
    /* storage cheio / modo privado — ignorar */
  }
}

/**
 * Inspeciona `window.location.hash` sincronamente antes do SDK do
 * Supabase processar a URL. Blinda contra o PASSWORD_RECOVERY ser
 * emitido antes do `onAuthStateChange` ter listener (o SDK inicia
 * no import do client — nossa subscription é feita só no mount do
 * provider, janela pequena mas existe). Também cobre refresh da
 * página quando o SDK já processou e removeu o hash.
 */
function detectRecoveryHashOnBoot(): boolean {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash
  if (!hash || !hash.includes('type=recovery')) return false
  return true
}

export const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

function readAalFromJwt(session: Session | null): Aal {
  const token = session?.access_token
  if (!token) return 'aal1'
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''))
    return payload?.aal === 'aal2' ? 'aal2' : 'aal1'
  } catch {
    return 'aal1'
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [aal, setAal] = useState<Aal>('aal1')
  const [isRecoverySession, setIsRecoverySession] = useState<boolean>(() => {
    const fromHash = detectRecoveryHashOnBoot()
    if (fromHash) writeRecoveryFlag(true)
    return fromHash || readRecoveryFlag()
  })

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setAal(readAalFromJwt(data.session))
      // Se não há sessão viva no boot, limpa flag residual (ex.: usuário
      // fechou a aba no meio do fluxo e o Supabase expirou o token).
      if (!data.session && readRecoveryFlag()) {
        writeRecoveryFlag(false)
        setIsRecoverySession(false)
      }
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setAal(readAalFromJwt(next))
      if (event === 'PASSWORD_RECOVERY') {
        writeRecoveryFlag(true)
        setIsRecoverySession(true)
      } else if (event === 'SIGNED_OUT') {
        writeRecoveryFlag(false)
        setIsRecoverySession(false)
      }
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      aal,
      isRecoverySession,
      async refreshAal() {
        // Força refresh do access_token para pegar o novo `aal` após
        // `supabase.auth.mfa.verify()`. Supabase emite TOKEN_REFRESHED,
        // mas aqui garantimos sincronia imediata.
        const { data } = await supabase.auth.refreshSession()
        setSession(data.session)
        setAal(readAalFromJwt(data.session))
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      },
      async signUp(email, password, name, options) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
            emailRedirectTo: options?.emailRedirectTo,
          },
        })
        if (error) {
          // Alguns setups Supabase retornam erro direto; outros retornam
          // um fake user. Tratamos ambos.
          const msg = error.message.toLowerCase()
          if (msg.includes('already registered') || msg.includes('already been registered')) {
            return { alreadyRegistered: true }
          }
          throw error
        }
        // Padrão novo do Supabase: user vem com identities vazio quando
        // o e-mail já existe (anti-enumeration). Detectamos aqui.
        const alreadyRegistered =
          !!data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0
        return { alreadyRegistered }
      },
      async signOut(opts) {
        // Apaga o claim de sessão única ANTES do signOut do Supabase —
        // depois do signOut o JWT some e a policy RLS self-only não deixa
        // deletar. Best-effort: se falhar, só loga; na pior das hipóteses
        // a linha fica stale até o próximo login sobrescrevê-la via upsert.
        const uid = session?.user.id
        if (uid) {
          const { error: delErr } = await supabase
            .from('user_sessions')
            .delete()
            .eq('user_id', uid)
          if (delErr) {
            console.warn(
              '[auth] falha ao limpar user_sessions no signOut:',
              delErr.message,
            )
          }
        }
        const { error } = await supabase.auth.signOut(
          opts?.scope ? { scope: opts.scope } : undefined,
        )
        if (error) throw error
      },
      async sendPasswordReset(email) {
        // `/reset-password` fica FORA do GuestOnlyRoute pra que a
        // sessão de recovery (criada automaticamente pelo SDK quando
        // o browser abre o link do email) não dispare redirect pro
        // dashboard antes do user conseguir setar a nova senha.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        })
        if (error) throw error
      },
      async updatePassword(newPassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword })
        if (error) throw error
      },
      async resendSignupEmail(email) {
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
          },
        })
        if (error) throw error
      },
    }),
    [session, loading, aal, isRecoverySession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

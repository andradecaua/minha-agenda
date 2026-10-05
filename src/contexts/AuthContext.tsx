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
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<SignUpResult>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  resendSignupEmail: (email: string) => Promise<void>
  refreshAal: () => Promise<void>
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

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setAal(readAalFromJwt(data.session))
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAal(readAalFromJwt(next))
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
      async signUp(email, password, name) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
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
      async signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      },
      async sendPasswordReset(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        })
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
    [session, loading, aal],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/**
 * Página de destino do link "esqueci minha senha". FORA do
 * `GuestOnlyRoute`: ao abrir o link do email, o Supabase SDK processa
 * o hash fragment e cria uma sessão de recovery — se a rota estivesse
 * sob GuestOnly, o usuário seria redirecionado pro dashboard antes de
 * conseguir setar a senha nova.
 *
 * Fluxo:
 *   1. User clica no link do email.
 *   2. Browser abre /reset-password#access_token=...&type=recovery.
 *   3. Supabase SDK (detectSessionInUrl:true, default) cria sessão
 *      + dispara `PASSWORD_RECOVERY` → AuthContext marca
 *      `isRecoverySession = true`. ProtectedRoute/GuestOnlyRoute
 *      trancam qualquer rota exceto esta enquanto a flag estiver on.
 *   4. User digita a nova senha e confirma → `updatePassword` → a
 *      gente força `signOut()` e manda pro /login com a flag `?reset=ok`.
 *      Força-se re-autenticação explícita (o usuário tem que PROVAR
 *      posse digitando a senha nova — a sessão de recovery sozinha
 *      não vira "logado automático").
 *
 * Se o user chegar aqui sem sessão (link expirado, URL copiada
 * errada), mostramos erro + volta pro /forgot-password.
 */
export function ResetPasswordPage() {
  const { session, loading, updatePassword, signOut, isRecoverySession } =
    useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Dá um beat pro SDK terminar de processar o hash. Depois disso,
  // se ainda não houver sessão, assumimos link inválido.
  const [waitedForSdk, setWaitedForSdk] = useState(false)
  useEffect(() => {
    if (!loading && !session) {
      const t = window.setTimeout(() => setWaitedForSdk(true), 500)
      return () => window.clearTimeout(t)
    }
    setWaitedForSdk(false)
  }, [loading, session])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('A senha precisa ter no mínimo 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não conferem.')
      return
    }

    setSubmitting(true)
    try {
      await updatePassword(password)
      // Se foi fluxo de recovery, revoga TODAS as sessões do usuário
      // (global) e manda pro login. Objetivo: nenhum device fica
      // logado automaticamente só pelo link do email — todos têm que
      // provar posse com a senha nova. Se o user chegou aqui logado
      // (trocando senha a partir do dashboard, hipotético), mantém
      // a sessão viva — não é o caso hoje, mas defende o futuro.
      if (isRecoverySession) {
        try {
          await signOut({ scope: 'global' })
        } catch {
          /* ignora — o importante é tirar o claim local */
        }
      }
      setDone(true)
      window.setTimeout(() => {
        navigate(isRecoverySession ? '/login?reset=ok' : '/dashboard', {
          replace: true,
        })
      }, 1500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Supabase retorna 'same_password' quando a nova é igual à anterior.
      if (msg.toLowerCase().includes('same')) {
        setError('A nova senha precisa ser diferente da anterior.')
      } else if (msg.toLowerCase().includes('session')) {
        setError('Sessão expirada. Peça um novo link.')
      } else {
        setError('Não foi possível trocar a senha. Tente de novo.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Nova senha</CardTitle>
          <CardDescription>
            Defina uma senha nova pra sua conta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : done ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">Senha atualizada.</p>
              <p className="text-xs text-muted-foreground">
                Redirecionando pra tela de login…
              </p>
            </div>
          ) : !session && waitedForSdk ? (
            <div className="space-y-4">
              <p className="text-sm text-destructive">
                Link inválido ou expirado.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/forgot-password">Pedir um novo link</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="password">Nova senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmar senha</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Salvando…' : 'Salvar nova senha'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

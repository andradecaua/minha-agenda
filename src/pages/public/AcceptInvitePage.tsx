import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import {
  acceptInvite,
  resolveInvite,
  type ResolvedInvite,
} from '@/services/team-invites'

/**
 * `/convite/:token` — chegada pelo link do email de convite. Faz:
 *   1. `resolveInvite(token)` pra validar e mostrar "você foi
 *      convidado para X".
 *   2. Pede senha (+ confirmação) e aceita via edge function. A
 *      edge seta senha e move o user pro team.
 *   3. Faz signIn automático com o email devolvido + senha → leva
 *      pro dashboard.
 */
export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const [invite, setInvite] = useState<ResolvedInvite | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!token) {
        setLoadErr('Link inválido.')
        setLoading(false)
        return
      }
      try {
        const result = await resolveInvite(token)
        if (cancelled) return
        setInvite(result)
      } catch (err) {
        if (cancelled) return
        setLoadErr(err instanceof Error ? err.message : 'Convite inválido.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !invite) return
    setSubmitErr(null)

    const trimmedName = name.trim()
    if (trimmedName.length < 2) {
      setSubmitErr('Digite seu nome (pelo menos 2 caracteres).')
      return
    }
    if (trimmedName.length > 60) {
      setSubmitErr('Nome muito longo (máx. 60 caracteres).')
      return
    }
    if (password.length < 6) {
      setSubmitErr('A senha precisa ter pelo menos 6 caracteres.')
      return
    }
    if (password !== passwordConfirm) {
      setSubmitErr('As duas senhas não são iguais.')
      return
    }

    setSubmitting(true)
    try {
      const { email } = await acceptInvite(token, password, trimmedName)
      // Login automático pra cair direto no dashboard
      try {
        await signIn(email, password)
      } catch {
        // Se login falhar por algum motivo, redireciona pro /login
        navigate('/login', { replace: true })
        return
      }
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : 'Não foi possível aceitar.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Centered>
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando convite...
          </CardContent>
        </Card>
      </Centered>
    )
  }

  if (loadErr || !invite) {
    return (
      <Centered>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center text-sm">
            <div className="rounded-full bg-amber-100 p-3">
              <ShieldAlert className="h-5 w-5 text-amber-700" aria-hidden="true" />
            </div>
            <p className="font-medium">Convite não disponível</p>
            <p className="text-muted-foreground">{loadErr ?? 'Convite inválido.'}</p>
            <Link to="/" className="mt-2 text-xs text-primary hover:underline">
              Ir para o site
            </Link>
          </CardContent>
        </Card>
      </Centered>
    )
  }

  return (
    <Centered>
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-3">
              <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Convite para {invite.team_name}
              </h1>
              <p className="text-xs text-muted-foreground">
                Você vai entrar como membro da equipe <strong>{invite.team_name}</strong>.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={invite.email} readOnly disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Seu nome</Label>
              <Input
                id="invite-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                maxLength={60}
                placeholder="Como você quer aparecer na página pública"
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-pw">Defina uma senha</Label>
              <Input
                id="invite-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-pw-confirm">Confirme a senha</Label>
              <Input
                id="invite-pw-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                disabled={submitting}
              />
            </div>
            {submitErr && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {submitErr}
              </div>
            )}
            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Entrar na equipe
            </Button>
          </form>

          <p className="text-xs text-muted-foreground">
            Ao continuar você concorda em migrar sua conta pra equipe{' '}
            <strong>{invite.team_name}</strong>. Sua agenda e clientes atuais
            continuam seus — apenas o portfólio passa a ser compartilhado.
          </p>
        </CardContent>
      </Card>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

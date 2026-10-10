import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmEmailScreen } from '@/pages/auth/components/ConfirmEmailScreen'
import { usePublicPlans } from '@/hooks/queries/usePublicPlans'

type Phase = 'form' | 'already_registered' | 'success'

export function SignupPage() {
  const { signUp, session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('form')

  // "Pra onde ir depois do cadastro" vem de dois lugares, nessa ordem:
  //   1. location.state.redirectTo (set pelo ProtectedRoute quando o
  //      visitante clicou "Assinar" na landing).
  //   2. ?plan=<code> na URL (deep link direto, ex.: "/signup?plan=pro"
  //      compartilhado em algum lugar) — reconstrói "/checkout/<code>".
  // Nenhum dos dois → cai no dashboard depois.
  const locationState = location.state as { redirectTo?: string } | null
  const planCodeFromQuery = searchParams.get('plan')
  // `?interval=yearly` chega da landing quando o toggle estava em
  // anual. Propaga pro `/checkout/<code>?interval=yearly` reconstruído.
  const intervalFromQuery = searchParams.get('interval')
  const intervalSuffix =
    intervalFromQuery === 'yearly' ? '?interval=yearly' : ''
  const redirectTo =
    locationState?.redirectTo ??
    (planCodeFromQuery
      ? `/checkout/${planCodeFromQuery}${intervalSuffix}`
      : null)

  // Plano de intenção pra exibir no notice. Tenta extrair o code do
  // redirectTo (/checkout/pro → "pro") ou usa o ?plan= direto. Como
  // o redirectTo pode trazer `?interval=yearly`, strip query antes.
  const checkoutPlanCode = useMemo(() => {
    if (planCodeFromQuery) return planCodeFromQuery
    if (redirectTo?.startsWith('/checkout/')) {
      return redirectTo.slice('/checkout/'.length).split('?')[0] ?? null
    }
    return null
  }, [planCodeFromQuery, redirectTo])

  const { data: plans } = usePublicPlans()
  const intendedPlan = useMemo(
    () => plans?.find((p) => p.code === checkoutPlanCode) ?? null,
    [plans, checkoutPlanCode],
  )

  // Se o signup não exige confirmação de email (Supabase pode estar
  // configurado assim), a sessão fica ativa imediato depois do
  // `signUp`. Nesse caso, naveguemos pro destino de intenção direto —
  // sem passar pela tela "verifique seu email".
  useEffect(() => {
    if (phase === 'success' && session) {
      navigate(redirectTo ?? '/dashboard', { replace: true })
    }
  }, [phase, session, redirectTo, navigate])

  function resetForm() {
    setName('')
    setEmail('')
    setPassword('')
    setError(null)
    setPhase('form')
  }

  function editEmail() {
    // Volta ao form mantendo nome preenchido para o usuário só corrigir o e-mail.
    setPassword('')
    setError(null)
    setPhase('form')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    setSubmitting(true)
    try {
      // Monta a URL absoluta pro email de confirmação devolver o
      // usuário direto no destino de intenção (ex.: /checkout/pro).
      const emailRedirectTo = redirectTo
        ? `${window.location.origin}${redirectTo}`
        : undefined
      const result = await signUp(email.trim(), password, name.trim(), {
        emailRedirectTo,
      })
      if (result.alreadyRegistered) {
        setPhase('already_registered')
      } else {
        setPhase('success')
      }
    } catch {
      setError('Não foi possível criar sua conta. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'already_registered') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>E-mail já cadastrado</CardTitle>
            <CardDescription>
              Já existe uma conta usando <strong>{email}</strong>. Você pode
              entrar com sua senha ou reiniciar o cadastro com outro e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() =>
                navigate('/login', {
                  state: { prefillEmail: email.trim(), redirectTo },
                })
              }
            >
              Entrar nessa conta
            </Button>
            <Button variant="outline" className="w-full" onClick={resetForm}>
              Usar outro e-mail
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Esqueceu a senha?{' '}
              <Link to="/forgot-password" className="hover:underline">
                Recuperar
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (phase === 'success') {
    return <ConfirmEmailScreen email={email.trim()} onEdit={editEmail} />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Criar conta</CardTitle>
          <CardDescription>Comece sua agenda profissional em minutos.</CardDescription>
        </CardHeader>
        <CardContent>
          <PlanIntentNotice plan={intendedPlan} planCodeFromQuery={checkoutPlanCode} />
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Mínimo de 8 caracteres.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Criando…' : 'Criar conta'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Já tem conta?{' '}
              <Link
                to="/login"
                state={redirectTo ? { redirectTo } : undefined}
                className="font-medium text-foreground hover:underline"
              >
                Entrar
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

interface PlanIntentNoticeProps {
  plan: { code: string; name: string } | null
  planCodeFromQuery: string | null
}

/**
 * Linha informativa sobre o plano. Hoje todo cadastro cria uma
 * subscription no `free` (via trigger `handle_new_user`), então o
 * texto esclarece isso — mesmo quando o visitante chegou de
 * `/signup?plan=pro`, ele cria conta no free e sobe depois (quando
 * o checkout estiver pronto).
 */
function PlanIntentNotice({ plan, planCodeFromQuery }: PlanIntentNoticeProps) {
  const showPending = planCodeFromQuery && plan && plan.code !== 'free'
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-md border bg-muted/40 p-3">
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-0.5 text-xs text-muted-foreground">
        {showPending ? (
          <>
            <p className="text-foreground">
              Você escolheu o plano <strong>{plan.name}</strong>.
            </p>
            <p>
              Vamos criar sua conta no plano Gratuito e abrir o checkout
              do {plan.name} quando o pagamento estiver disponível.
            </p>
          </>
        ) : (
          <>
            <p className="text-foreground">Você começa no plano Gratuito.</p>
            <p>
              Faça upgrade quando quiser —{' '}
              <Link to="/#planos" className="underline hover:text-foreground">
                ver planos
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  )
}

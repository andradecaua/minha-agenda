import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Inbox, MailCheck, RefreshCw, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'

interface ConfirmEmailScreenProps {
  email: string
  /** Volta ao formulário de cadastro para corrigir o e-mail. */
  onEdit: () => void
}

const COOLDOWN_SECONDS = 60

export function ConfirmEmailScreen({ email, onEdit }: ConfirmEmailScreenProps) {
  const navigate = useNavigate()
  const { resendSignupEmail } = useAuth()

  // Começa travado por COOLDOWN_SECONDS após o cadastro — o e-mail
  // acabou de ser enviado, não faz sentido reenviar imediatamente.
  const [secondsLeft, setSecondsLeft] = useState(COOLDOWN_SECONDS)
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [resendError, setResendError] = useState<string | null>(null)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
    }
  }, [])

  async function handleResend() {
    setResendError(null)
    setResendState('sending')
    try {
      await resendSignupEmail(email)
      setResendState('sent')
      setSecondsLeft(COOLDOWN_SECONDS)
    } catch (err) {
      // Supabase retorna "rate limit" se o cliente insistir — tratamos
      // como mensagem amigável.
      const msg = err instanceof Error ? err.message.toLowerCase() : ''
      if (msg.includes('rate') || msg.includes('too many')) {
        setResendError('Aguarde um pouco antes de reenviar novamente.')
      } else {
        setResendError('Não foi possível reenviar. Tente novamente em instantes.')
      }
      setResendState('error')
    }
  }

  const canResend = secondsLeft === 0 && resendState !== 'sending'

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MailCheck className="h-7 w-7" aria-hidden="true" />
          </div>
          <CardTitle>Confirme seu e-mail</CardTitle>
          <CardDescription>
            Enviamos um link de confirmação para
            <br />
            <strong className="text-foreground">{email}</strong>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <ol className="space-y-3 text-sm">
            <Step
              icon={Inbox}
              title="Abra sua caixa de entrada"
              description="O e-mail chega em até 2 minutos. Procure por “Confirme seu e-mail”."
            />
            <Step
              icon={ShieldAlert}
              title="Não achou? Veja o spam"
              description="Primeiros envios costumam parar em “Spam” ou “Promoções”. Marque como “Não é spam” para receber bem."
            />
            <Step
              icon={MailCheck}
              title="Clique no link e volte aqui"
              description="Depois de confirmar, você poderá entrar normalmente."
            />
          </ol>

          <div className="space-y-2">
            <Button className="w-full" onClick={() => navigate('/login')}>
              Já confirmei — ir para o login
            </Button>

            <Button
              variant="outline"
              className="w-full"
              onClick={handleResend}
              disabled={!canResend}
            >
              <RefreshCw
                className={`h-4 w-4 ${resendState === 'sending' ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {resendState === 'sending'
                ? 'Reenviando…'
                : canResend
                  ? 'Reenviar e-mail'
                  : `Reenviar em ${secondsLeft}s`}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden="true" />
              Corrigir o e-mail
            </button>
            <Link to="/login" className="hover:text-foreground hover:underline">
              Voltar ao login
            </Link>
          </div>

          <ResendFeedback state={resendState} error={resendError} />
        </CardContent>
      </Card>
    </div>
  )
}

interface StepProps {
  icon: typeof Inbox
  title: string
  description: string
}

function Step({ icon: Icon, title, description }: StepProps) {
  return (
    <li className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </li>
  )
}

interface ResendFeedbackProps {
  state: 'idle' | 'sending' | 'sent' | 'error'
  error: string | null
}

function ResendFeedback({ state, error }: ResendFeedbackProps) {
  if (state === 'sent') {
    return (
      <p className="text-center text-xs text-green-600" role="status">
        E-mail reenviado. Verifique sua caixa de entrada.
      </p>
    )
  }
  if (state === 'error' && error) {
    return (
      <p className="text-center text-xs text-destructive" role="alert">
        {error}
      </p>
    )
  }
  return null
}

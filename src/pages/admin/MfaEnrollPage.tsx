import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { enrollTotp, listFactors, translateMfaError, unenroll, verifyTotp } from '@/services/mfa'

/**
 * Enrolamento de MFA (TOTP) obrigatório para administradores que ainda
 * não configuraram. A sessão é elevada a AAL2 ao fim do verify, então
 * em seguida redirecionamos para /admin direto.
 *
 * Importante: se já existir um fator `unverified` (um enroll anterior
 * que não foi concluído), limpamos antes de criar um novo — evita o
 * erro `factor_already_exists` do Supabase.
 */
export function MfaEnrollPage() {
  const navigate = useNavigate()
  const { refreshAal } = useAuth()
  const [state, setState] = useState<
    | { stage: 'loading' }
    | { stage: 'enrolled'; factorId: string; qrSvg: string; secret: string }
    | { stage: 'error'; message: string }
  >({ stage: 'loading' })
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        // Limpa qualquer fator anterior ainda não verificado.
        const existing = await listFactors()
        for (const f of existing) {
          if (f.status === 'unverified') {
            await unenroll(f.id).catch(() => undefined)
          }
        }
        const enrolled = await enrollTotp('Admin TOTP')
        if (!active) return
        setState({
          stage: 'enrolled',
          factorId: enrolled.factor_id,
          qrSvg: enrolled.qr_svg,
          secret: enrolled.secret,
        })
      } catch (err) {
        if (!active) return
        setState({ stage: 'error', message: translateMfaError(err) })
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault()
    if (state.stage !== 'enrolled') return
    setVerifyError(null)
    setVerifying(true)
    try {
      await verifyTotp(state.factorId, code)
      await refreshAal()
      navigate('/admin', { replace: true })
    } catch (err) {
      setVerifyError(translateMfaError(err))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-background p-6 shadow-sm">
        <header className="space-y-2 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">Configure sua autenticação em duas etapas</h1>
          <p className="text-sm text-muted-foreground">
            Administradores precisam de MFA (TOTP). Escaneie o QR code com um app
            autenticador — Google Authenticator, 1Password, Authy, etc. — e
            confirme com o código de 6 dígitos.
          </p>
        </header>

        {state.stage === 'loading' && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Gerando chave...
          </div>
        )}

        {state.stage === 'error' && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {state.message}
          </div>
        )}

        {state.stage === 'enrolled' && (
          <>
            <div className="flex flex-col items-center gap-3">
              <div
                className="rounded-md border bg-white p-3"
                dangerouslySetInnerHTML={{ __html: state.qrSvg }}
              />
              <div className="w-full rounded-md bg-muted p-3 text-center">
                <p className="text-xs text-muted-foreground">
                  Ou digite esta chave manualmente:
                </p>
                <code className="mt-1 block select-all break-all font-mono text-sm">
                  {state.secret}
                </code>
              </div>
            </div>

            <form onSubmit={handleVerify} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="totp-code">Código de 6 dígitos</Label>
                <Input
                  id="totp-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </div>
              {verifyError && (
                <p className="text-sm text-destructive" role="alert">
                  {verifyError}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={verifying || code.length !== 6}
              >
                {verifying ? 'Verificando...' : 'Ativar MFA e continuar'}
              </Button>
            </form>

            <p className="text-xs text-muted-foreground">
              Guarde o acesso ao app autenticador em local seguro. Se perder,
              outro administrador precisará remover o fator pelo painel do
              Supabase.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

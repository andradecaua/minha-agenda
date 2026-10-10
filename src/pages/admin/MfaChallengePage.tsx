import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { listFactors, translateMfaError, verifyTotp } from '@/services/mfa'

/**
 * Challenge de MFA: eleva a sessão de AAL1 para AAL2. Usado quando
 * um admin já tem fator cadastrado mas abriu o /admin em uma sessão
 * recém-logada (que começa sempre em AAL1).
 */
export function MfaChallengePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshAal } = useAuth()
  const redirectTo = (location.state as { redirectTo?: string } | null)?.redirectTo ?? '/admin'

  const [factorId, setFactorId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    listFactors()
      .then((factors) => {
        if (!active) return
        const verified = factors.find((f) => f.status === 'verified')
        if (!verified) {
          // Nenhum fator verificado — volta para enrolar.
          navigate('/admin/mfa/enroll', { replace: true })
          return
        }
        setFactorId(verified.id)
      })
      .catch((err) => {
        if (active) setError(translateMfaError(err))
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [navigate])

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault()
    if (!factorId) return
    setError(null)
    setVerifying(true)
    try {
      await verifyTotp(factorId, code)
      await refreshAal()
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(translateMfaError(err))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm space-y-5 rounded-xl border bg-background p-6 shadow-sm">
        <header className="space-y-2 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold">Verificação em duas etapas</h1>
          <p className="text-sm text-muted-foreground">
            Para acessar a área administrativa, informe o código do seu app
            autenticador.
          </p>
        </header>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparando…
          </div>
        ) : (
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
                autoFocus
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={verifying || code.length !== 6}>
              {verifying ? 'Verificando…' : 'Verificar e entrar'}
            </Button>
          </form>
        )}

        <p className="text-xs text-muted-foreground">
          O código muda a cada 30 segundos. Se continuar inválido, verifique a
          hora do seu dispositivo.
        </p>
      </div>
    </div>
  )
}

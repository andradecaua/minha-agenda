import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useSessionGuard } from '@/hooks/useSessionGuard'

/**
 * Overlay fullscreen que aparece quando outro device assumiu a conta.
 * Fica fora das rotas pra cobrir qualquer tela — dashboard, admin,
 * landing lida com user autenticado via RootEntry.
 */
export function SessionGuard() {
  const { kicked } = useSessionGuard()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  async function handleReconnect() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      navigate('/login', { replace: true })
    }
  }

  if (!kicked) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-kicked-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-xl border bg-background p-6 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
          <ShieldAlert className="h-5 w-5 text-amber-700" aria-hidden="true" />
        </div>
        <h2
          id="session-kicked-title"
          className="text-lg font-semibold tracking-tight"
        >
          Sessão encerrada
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Sua conta foi acessada em outro dispositivo agora há pouco. Por
          segurança, encerramos esta sessão aqui.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Se não foi você, troque sua senha ao entrar novamente.
        </p>
        <Button
          className="mt-6 w-full"
          onClick={handleReconnect}
          disabled={signingOut}
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Entrar novamente
        </Button>
      </div>
    </div>
  )
}

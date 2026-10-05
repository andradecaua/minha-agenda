import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'

import { useAuth } from '@/hooks/useAuth'
import { useAdminSession } from '@/hooks/queries/useAdminSession'
import { listFactors } from '@/services/mfa'
import { Button } from '@/components/ui/button'

/**
 * Guard de rotas /admin/*. Fluxo:
 *
 *   1. Sem sessão                       → /login (preserva redirectTo).
 *   2. Logado, mas NÃO é admin          → 403 (bloqueia e não vaza info).
 *   3. Admin, sem MFA cadastrada        → /admin/mfa/enroll (obrigatório).
 *   4. Admin, com MFA mas sessão AAL1   → /admin/mfa/challenge.
 *   5. Admin + AAL2                     → libera.
 *
 * O frontend é defesa em profundidade: as RPCs admin_* checam
 * `public.is_admin()` no banco, que exige AAL2 + presença em
 * admin_users independentemente deste guard.
 */
export function AdminRoute() {
  const { session, loading: authLoading, aal } = useAuth()
  const location = useLocation()
  const { data: adminStatus, isLoading: statusLoading } = useAdminSession()
  const [factorState, setFactorState] = useState<
    | { status: 'loading' }
    | { status: 'none' }
    | { status: 'unverified'; factorId: string }
    | { status: 'verified'; factorId: string }
  >({ status: 'loading' })

  const isAdminUser = !!adminStatus?.is_admin_user

  useEffect(() => {
    let active = true
    // Só consulta fatores se já confirmamos que é admin — evita
    // chamar MFA quando o guard vai bloquear mesmo.
    if (!isAdminUser) {
      setFactorState({ status: 'none' })
      return
    }
    setFactorState({ status: 'loading' })
    listFactors()
      .then((factors) => {
        if (!active) return
        const verified = factors.find((f) => f.status === 'verified')
        if (verified) {
          setFactorState({ status: 'verified', factorId: verified.id })
          return
        }
        const any = factors[0]
        if (any) {
          setFactorState({ status: 'unverified', factorId: any.id })
          return
        }
        setFactorState({ status: 'none' })
      })
      .catch(() => {
        if (active) setFactorState({ status: 'none' })
      })
    return () => {
      active = false
    }
  }, [isAdminUser, aal])

  if (authLoading || statusLoading || factorState.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Verificando permissões...
      </div>
    )
  }

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ redirectTo: location.pathname + location.search }}
      />
    )
  }

  if (!isAdminUser) {
    return <ForbiddenScreen />
  }

  // Admin sem nenhum fator → forçar enrolamento antes de qualquer ação.
  if (factorState.status === 'none' || factorState.status === 'unverified') {
    if (location.pathname !== '/admin/mfa/enroll') {
      return <Navigate to="/admin/mfa/enroll" replace />
    }
    return <Outlet />
  }

  // Admin com fator verified mas sessão AAL1 → challenge para elevar.
  if (aal !== 'aal2') {
    if (location.pathname !== '/admin/mfa/challenge') {
      return (
        <Navigate
          to="/admin/mfa/challenge"
          replace
          state={{ redirectTo: location.pathname + location.search }}
        />
      )
    }
    return <Outlet />
  }

  return <Outlet />
}

function ForbiddenScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">Acesso restrito</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Esta área é exclusiva para administradores da plataforma.
          Se acredita que deveria ter acesso, entre em contato com um
          administrador existente.
        </p>
      </div>
      <Button asChild variant="outline">
        <a href="/dashboard">Voltar para o dashboard</a>
      </Button>
    </div>
  )
}

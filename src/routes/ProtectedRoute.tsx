import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function ProtectedRoute() {
  const { session, loading, isRecoverySession } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    )
  }

  // Sessão de recovery (veio do link do email) não vale como login — o
  // usuário tem que trocar a senha primeiro. Qualquer rota protegida
  // redireciona pra /reset-password enquanto a flag estiver on.
  if (isRecoverySession) {
    return <Navigate to="/reset-password" replace />
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

  return <Outlet />
}

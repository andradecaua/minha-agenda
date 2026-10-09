import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

/**
 * Oposto do ProtectedRoute: se o usuário já tem sessão, manda para o
 * dashboard. Usado para /login, /signup e /forgot-password — evita
 * que um usuário autenticado veja telas de autenticação.
 *
 * Caso especial: sessão de recovery (link do email) NÃO vale como
 * login. Força a passagem por /reset-password antes de qualquer
 * outra rota ser acessada.
 */
export function GuestOnlyRoute() {
  const { session, loading, isRecoverySession } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando...
      </div>
    )
  }

  if (isRecoverySession) {
    return <Navigate to="/reset-password" replace />
  }

  if (session) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

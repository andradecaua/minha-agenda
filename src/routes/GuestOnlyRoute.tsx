import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

/**
 * Oposto do ProtectedRoute: se o usuário já tem sessão, manda para o
 * dashboard. Usado para /login, /signup e /forgot-password — evita
 * que um usuário autenticado veja telas de autenticação.
 */
export function GuestOnlyRoute() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando...
      </div>
    )
  }

  if (session) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

import { lazy } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

// Landing é lazy — usuário autenticado nunca baixa o bundle.
const LandingPage = lazy(() =>
  import('@/pages/public/LandingPage').then((m) => ({ default: m.LandingPage })),
)

/**
 * Dispatcher da raiz "/":
 *  - Autenticado  → /dashboard
 *  - Visitante    → landing pública (Suspense herdado de AppRoutes)
 *  - Carregando   → placeholder (evita flash)
 */
export function RootRedirect() {
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

  return <LandingPage />
}

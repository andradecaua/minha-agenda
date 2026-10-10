import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { PublicLayout } from '@/layouts/PublicLayout'
import { DashboardLayout } from '@/layouts/DashboardLayout'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { GuestOnlyRoute } from '@/routes/GuestOnlyRoute'
import { AdminRoute } from '@/routes/AdminRoute'
import { RequirePermission } from '@/routes/RequirePermission'
import { PERMISSIONS } from '@/lib/permissions'
import { useAuth } from '@/hooks/useAuth'

// Páginas de auth — pequenas, mantidas estáticas para não piscar no
// primeiro carregamento (que geralmente cai em /login).
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

// Páginas de dashboard/públicas — code-split por rota via React.lazy.
// Ganho principal: o visitante que só abre `/p/:slug` nunca baixa o
// bundle do dashboard, e vice-versa.
const DashboardHomePage = lazy(() =>
  import('@/pages/dashboard/DashboardHomePage').then((m) => ({
    default: m.DashboardHomePage,
  })),
)
const AgendaPage = lazy(() =>
  import('@/pages/dashboard/agenda/AgendaPage').then((m) => ({
    default: m.AgendaPage,
  })),
)
const NewAppointmentPage = lazy(() =>
  import('@/pages/dashboard/agenda/NewAppointmentPage').then((m) => ({
    default: m.NewAppointmentPage,
  })),
)
const ClientsPage = lazy(() =>
  import('@/pages/dashboard/clients/ClientsPage').then((m) => ({
    default: m.ClientsPage,
  })),
)
const ClientDetailPage = lazy(() =>
  import('@/pages/dashboard/clients/ClientDetailPage').then((m) => ({
    default: m.ClientDetailPage,
  })),
)
const ServicesPage = lazy(() =>
  import('@/pages/dashboard/services/ServicesPage').then((m) => ({
    default: m.ServicesPage,
  })),
)
const ProductsPage = lazy(() =>
  import('@/pages/dashboard/products/ProductsPage').then((m) => ({
    default: m.ProductsPage,
  })),
)
const PortfolioPage = lazy(() =>
  import('@/pages/dashboard/portfolio/PortfolioPage').then((m) => ({
    default: m.PortfolioPage,
  })),
)
const SettingsLayout = lazy(() =>
  import('@/pages/dashboard/settings/SettingsLayout').then((m) => ({
    default: m.SettingsLayout,
  })),
)
const SettingsIndexPage = lazy(() =>
  import('@/pages/dashboard/settings/SettingsIndexPage').then((m) => ({
    default: m.SettingsIndexPage,
  })),
)
const ProfilePage = lazy(() =>
  import('@/pages/dashboard/settings/ProfilePage').then((m) => ({
    default: m.ProfilePage,
  })),
)
const BusinessHoursPage = lazy(() =>
  import('@/pages/dashboard/settings/BusinessHoursPage').then((m) => ({
    default: m.BusinessHoursPage,
  })),
)
const BookingSettingsPage = lazy(() =>
  import('@/pages/dashboard/settings/BookingSettingsPage').then((m) => ({
    default: m.BookingSettingsPage,
  })),
)
const SubscriptionPage = lazy(() =>
  import('@/pages/dashboard/settings/SubscriptionPage').then((m) => ({
    default: m.SubscriptionPage,
  })),
)
const NotificationsPage = lazy(() =>
  import('@/pages/dashboard/settings/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
)
const SupportPage = lazy(() =>
  import('@/pages/dashboard/support/SupportPage').then((m) => ({
    default: m.SupportPage,
  })),
)
const TeamSettingsPage = lazy(() =>
  import('@/pages/dashboard/team/TeamSettingsPage').then((m) => ({
    default: m.TeamSettingsPage,
  })),
)
const SupportTicketPage = lazy(() =>
  import('@/pages/dashboard/support/SupportTicketPage').then((m) => ({
    default: m.SupportTicketPage,
  })),
)
const ProfessionalPage = lazy(() =>
  import('@/pages/public/ProfessionalPage').then((m) => ({
    default: m.ProfessionalPage,
  })),
)
const AppointmentDetailPublicPage = lazy(() =>
  import('@/pages/public/AppointmentDetailPublicPage').then((m) => ({
    default: m.AppointmentDetailPublicPage,
  })),
)
const AcceptInvitePage = lazy(() =>
  import('@/pages/public/AcceptInvitePage').then((m) => ({
    default: m.AcceptInvitePage,
  })),
)
// Landing é lazy — visitante que entra direto em outra rota não baixa.
// Renderizada em `/` só para visitantes anônimos vindos da web: usuário
// com sessão vai direto pro /dashboard, e PWA instalada (standalone)
// pula pro /login pra não ter cara de site. Ver `RootEntry` abaixo.
const LandingPage = lazy(() =>
  import('@/pages/public/LandingPage').then((m) => ({ default: m.LandingPage })),
)
const CheckoutRedirectPage = lazy(() =>
  import('@/pages/CheckoutRedirectPage').then((m) => ({
    default: m.CheckoutRedirectPage,
  })),
)

// Admin — code-split em bundle próprio. Nenhum usuário comum baixa isso.
const AdminLayout = lazy(() =>
  import('@/layouts/AdminLayout').then((m) => ({ default: m.AdminLayout })),
)
const AdminOverviewPage = lazy(() =>
  import('@/pages/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
)
const AdminUsersPage = lazy(() =>
  import('@/pages/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
)
const AdminUserDetailPage = lazy(() =>
  import('@/pages/admin/AdminUserDetailPage').then((m) => ({ default: m.AdminUserDetailPage })),
)
const AdminPlansPage = lazy(() =>
  import('@/pages/admin/AdminPlansPage').then((m) => ({ default: m.AdminPlansPage })),
)
const AdminReportsPage = lazy(() =>
  import('@/pages/admin/AdminReportsPage').then((m) => ({ default: m.AdminReportsPage })),
)
const AdminTicketsPage = lazy(() =>
  import('@/pages/admin/AdminTicketsPage').then((m) => ({ default: m.AdminTicketsPage })),
)
const AdminTicketDetailPage = lazy(() =>
  import('@/pages/admin/AdminTicketDetailPage').then((m) => ({ default: m.AdminTicketDetailPage })),
)
const MfaEnrollPage = lazy(() =>
  import('@/pages/admin/MfaEnrollPage').then((m) => ({ default: m.MfaEnrollPage })),
)
const MfaChallengePage = lazy(() =>
  import('@/pages/admin/MfaChallengePage').then((m) => ({ default: m.MfaChallengePage })),
)

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      Carregando...
    </div>
  )
}

/**
 * Entrada da raiz `/`. Decide entre landing, dashboard ou login:
 *
 * - Com sessão → `/dashboard`, independente de onde o acesso veio.
 * - Sem sessão + PWA aberta em standalone → `/login`, pra passar
 *   sensação de app (quem instalou já é usuário, não visitante).
 * - Sem sessão + browser normal → landing (marketing).
 *
 * `start_url` do manifest continua `/` porque o validador WebAPK do
 * Chrome Android rejeita rotas autenticadas; a decisão vive aqui no
 * SPA, que já tem o estado da sessão em mãos.
 */
function RootEntry() {
  const { session, loading } = useAuth()

  if (loading) return <RouteFallback />
  if (session) return <Navigate to="/dashboard" replace />
  if (isStandaloneDisplay()) return <Navigate to="/login" replace />
  return <LandingPage />
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari expõe `navigator.standalone` (non-standard, legacy).
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<RootEntry />} />

        <Route element={<GuestOnlyRoute />}>
          <Route element={<PublicLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
        </Route>

        {/* /reset-password NÃO entra no GuestOnlyRoute: quando o
            usuário abre o link do email, o Supabase SDK cria uma
            sessão de recovery, e um Guest guard mandaria pro
            dashboard antes de dar chance de setar a nova senha. */}
        <Route element={<PublicLayout />}>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>

        <Route element={<PublicLayout />}>
          <Route path="/p/:slug" element={<ProfessionalPage />} />
          <Route path="/p/:slug/a/:token" element={<AppointmentDetailPublicPage />} />
        </Route>

        {/* `/convite/:token` fica FORA do GuestOnlyRoute: o user pode
            já estar logado em outro device e aceitar o convite daqui
            (a edge function troca a senha e move pro novo team). */}
        <Route path="/convite/:token" element={<AcceptInvitePage />} />

        <Route element={<ProtectedRoute />}>
          {/* Checkout de assinatura — tela de "loading" full-screen que
              dispara a edge e redireciona pro MP. Fica FORA do
              DashboardLayout pra não mostrar sidebar em telas de passagem. */}
          <Route path="/checkout/:planCode" element={<CheckoutRedirectPage />} />

          {/* /admin/* exige admin + MFA (AAL2). Páginas MFA ficam dentro
              do AdminRoute mas FORA do AdminLayout (telas focadas, full-screen). */}
          <Route element={<AdminRoute />}>
            <Route path="/admin/mfa/enroll" element={<MfaEnrollPage />} />
            <Route path="/admin/mfa/challenge" element={<MfaChallengePage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverviewPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="users/:id" element={<AdminUserDetailPage />} />
              <Route path="plans" element={<AdminPlansPage />} />
              <Route path="tickets" element={<AdminTicketsPage />} />
              <Route path="tickets/:id" element={<AdminTicketDetailPage />} />
              <Route path="reports" element={<AdminReportsPage />} />
            </Route>
          </Route>

          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<DashboardHomePage />} />
            <Route path="/dashboard/agenda" element={<AgendaPage />} />
            <Route path="/dashboard/agenda/novo" element={<NewAppointmentPage />} />
            <Route path="/dashboard/clientes" element={<ClientsPage />} />
            <Route path="/dashboard/clientes/:id" element={<ClientDetailPage />} />
            <Route path="/dashboard/servicos" element={<ServicesPage />} />
            <Route element={<RequirePermission code={PERMISSIONS.PRODUCTS_MANAGE} />}>
              <Route path="/dashboard/produtos" element={<ProductsPage />} />
            </Route>
            <Route element={<RequirePermission code={PERMISSIONS.PORTFOLIO_MANAGE} />}>
              <Route path="/dashboard/portfolio" element={<PortfolioPage />} />
            </Route>
            <Route path="/dashboard/suporte" element={<SupportPage />} />
            <Route path="/dashboard/suporte/:id" element={<SupportTicketPage />} />
            <Route path="/dashboard/equipe" element={<TeamSettingsPage />} />
            <Route path="/dashboard/configuracoes" element={<SettingsLayout />}>
              <Route index element={<SettingsIndexPage />} />
              <Route path="perfil" element={<ProfilePage />} />
              <Route path="horarios" element={<BusinessHoursPage />} />
              <Route path="agendamento" element={<BookingSettingsPage />} />
              <Route path="notificacoes" element={<NotificationsPage />} />
              <Route path="assinatura" element={<SubscriptionPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

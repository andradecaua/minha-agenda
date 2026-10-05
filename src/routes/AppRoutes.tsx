import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { PublicLayout } from '@/layouts/PublicLayout'
import { DashboardLayout } from '@/layouts/DashboardLayout'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { GuestOnlyRoute } from '@/routes/GuestOnlyRoute'
import { RootRedirect } from '@/routes/RootRedirect'
import { AdminRoute } from '@/routes/AdminRoute'

// Páginas de auth — pequenas, mantidas estáticas para não piscar no
// primeiro carregamento (que geralmente cai em /login).
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
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

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

        <Route element={<GuestOnlyRoute />}>
          <Route element={<PublicLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
        </Route>

        <Route element={<PublicLayout />}>
          <Route path="/p/:slug" element={<ProfessionalPage />} />
          <Route path="/p/:slug/a/:token" element={<AppointmentDetailPublicPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
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
            <Route path="/dashboard/produtos" element={<ProductsPage />} />
            <Route path="/dashboard/portfolio" element={<PortfolioPage />} />
            <Route path="/dashboard/configuracoes" element={<SettingsLayout />}>
              <Route index element={<SettingsIndexPage />} />
              <Route path="perfil" element={<ProfilePage />} />
              <Route path="horarios" element={<BusinessHoursPage />} />
              <Route path="agendamento" element={<BookingSettingsPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  )
}

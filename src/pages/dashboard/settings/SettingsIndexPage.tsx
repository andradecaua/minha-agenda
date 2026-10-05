import { Navigate } from 'react-router-dom'

export function SettingsIndexPage() {
  return <Navigate to="/dashboard/configuracoes/perfil" replace />
}

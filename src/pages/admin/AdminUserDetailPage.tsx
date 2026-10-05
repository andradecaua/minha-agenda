import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CalendarCheck,
  CalendarX,
  Clock,
  Images,
  Loader2,
  Package,
  Pencil,
  Scissors,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAdminPlans } from '@/hooks/queries/useAdminPlans'
import { useAdminUserReport } from '@/hooks/queries/useAdminUserReport'
import {
  adminSetAdminFlag,
  adminSetUserPlan,
  adminUpdateUserProfile,
} from '@/services/admin'
import { formatCurrencyBRL } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import type { SubscriptionStatus } from '@/types/admin'

export function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user: currentUser } = useAuth()
  const { data, isLoading, error } = useAdminUserReport(id)
  const queryClient = useQueryClient()

  const [editOpen, setEditOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [confirmAdmin, setConfirmAdmin] = useState<null | { makeAdmin: boolean }>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'user-report', id] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }

  const toggleAdmin = useMutation({
    mutationFn: (makeAdmin: boolean) => {
      if (!id) throw new Error('userId ausente')
      return adminSetAdminFlag(id, makeAdmin)
    },
    onSuccess: () => {
      setConfirmAdmin(null)
      setActionError(null)
      invalidate()
    },
    onError: (err: Error) => setActionError(err.message),
  })

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando relatório...
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        Não foi possível carregar os dados deste usuário.
      </div>
    )
  }

  const self = currentUser?.id === data.profile.user_id

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/users" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" />
          Voltar para usuários
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{data.profile.name}</h1>
            {data.is_admin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                <ShieldCheck className="h-3 w-3" />
                Admin
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {data.auth?.email ?? '—'} · /p/{data.profile.slug}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Editar perfil
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPlanOpen(true)}>
            <Package className="h-3.5 w-3.5" />
            Alterar plano
          </Button>
          <Button
            variant={data.is_admin ? 'destructive' : 'default'}
            size="sm"
            disabled={self && data.is_admin}
            onClick={() => setConfirmAdmin({ makeAdmin: !data.is_admin })}
            title={self && data.is_admin ? 'Você não pode remover a si mesmo' : undefined}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {data.is_admin ? 'Remover admin' : 'Promover a admin'}
          </Button>
        </div>
      </header>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Resumo</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={CalendarCheck} label="Agendamentos" value={String(data.metrics.appointments_total)} hint={`${data.metrics.appointments_completed} concluídos`} />
          <StatCard icon={CalendarX} label="Cancelados" value={String(data.metrics.appointments_cancelled)} hint="histórico" />
          <StatCard icon={Clock} label="Pendentes" value={String(data.metrics.appointments_pending)} hint="aguardando confirmação" />
          <StatCard icon={TrendingUp} label="Faturamento total" value={formatCurrencyBRL(data.metrics.revenue_total_cents)} hint={`${formatCurrencyBRL(data.metrics.revenue_30d_cents)} nos últimos 30d`} />
          <StatCard icon={Users} label="Clientes" value={String(data.metrics.clients_total)} hint="cadastrados" />
          <StatCard icon={Scissors} label="Serviços ativos" value={String(data.metrics.services_active)} hint="disponíveis para booking" />
          <StatCard icon={Package} label="Produtos ativos" value={String(data.metrics.products_active)} hint="vendidos" />
          <StatCard icon={Images} label="Portfólio" value={String(data.metrics.portfolio_items)} hint="itens publicados" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Assinatura</h2>
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            {data.plan ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{data.plan.name}</span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{data.plan.code}</span>
                </div>
                <div className="text-muted-foreground">
                  {formatCurrencyBRL(data.plan.price_cents)} / {translateInterval(data.plan.billing_interval)}
                </div>
                {data.subscription && (
                  <div className="text-xs text-muted-foreground">
                    Status: {data.subscription.status} · Desde {new Date(data.subscription.started_at).toLocaleDateString('pt-BR')}
                    {data.subscription.expires_at && (
                      <> · Expira em {new Date(data.subscription.expires_at).toLocaleDateString('pt-BR')}</>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground">Nenhum plano atribuído.</div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Autenticação</h2>
        <Card>
          <CardContent className="space-y-1 pt-6 text-sm text-muted-foreground">
            <div>
              <span className="text-foreground">Criado em:</span>{' '}
              {data.auth?.created_at ? new Date(data.auth.created_at).toLocaleString('pt-BR') : '—'}
            </div>
            <div>
              <span className="text-foreground">Último login:</span>{' '}
              {data.auth?.last_sign_in_at ? new Date(data.auth.last_sign_in_at).toLocaleString('pt-BR') : '—'}
            </div>
            <div>
              <span className="text-foreground">E-mail confirmado:</span>{' '}
              {data.auth?.email_confirmed_at ? 'Sim' : 'Não'}
            </div>
          </CardContent>
        </Card>
      </section>

      {editOpen && (
        <EditProfileDialog
          userId={data.profile.user_id}
          initial={{
            name: data.profile.name,
            slug: data.profile.slug,
            city: data.profile.city ?? '',
            phone: data.profile.phone ?? '',
            bio: data.profile.bio ?? '',
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false)
            invalidate()
          }}
        />
      )}

      {planOpen && (
        <AssignPlanDialog
          userId={data.profile.user_id}
          currentPlanId={data.plan?.id ?? null}
          currentStatus={data.subscription?.status ?? 'active'}
          currentExpires={data.subscription?.expires_at ?? null}
          onClose={() => setPlanOpen(false)}
          onSaved={() => {
            setPlanOpen(false)
            invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmAdmin}
        onClose={() => setConfirmAdmin(null)}
        onConfirm={() => confirmAdmin && toggleAdmin.mutate(confirmAdmin.makeAdmin)}
        title={confirmAdmin?.makeAdmin ? 'Promover a administrador?' : 'Remover acesso de admin?'}
        description={
          confirmAdmin?.makeAdmin
            ? 'Este usuário terá acesso a toda a área administrativa (após configurar MFA).'
            : 'Este usuário perderá acesso à área administrativa imediatamente.'
        }
        confirmLabel={confirmAdmin?.makeAdmin ? 'Promover' : 'Remover'}
        destructive={!confirmAdmin?.makeAdmin}
        loading={toggleAdmin.isPending}
      />
    </div>
  )
}

function translateInterval(i: string): string {
  if (i === 'monthly') return 'mês'
  if (i === 'yearly') return 'ano'
  return 'vitalício'
}

interface StatCardProps {
  icon: typeof Users
  label: string
  value: string
  hint: string
}
function StatCard({ icon: Icon, label, value, hint }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>{label}</CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <CardTitle className="text-xl">{value}</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

interface EditProfileDialogProps {
  userId: string
  initial: { name: string; slug: string; city: string; phone: string; bio: string }
  onClose: () => void
  onSaved: () => void
}
function EditProfileDialog({ userId, initial, onClose, onSaved }: EditProfileDialogProps) {
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr(null)
    try {
      await adminUpdateUserProfile({
        user_id: userId,
        name: form.name,
        slug: form.slug,
        city: form.city,
        phone: form.phone,
        bio: form.bio,
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Editar perfil"
      description="Alterar dados públicos do profissional. Mudanças aparecem em /p/:slug imediatamente."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={(e) => handleSave(e as unknown as React.FormEvent)} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-name">Nome</Label>
          <Input id="edit-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-slug">Slug (/p/:slug)</Label>
          <Input
            id="edit-slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-city">Cidade</Label>
            <Input id="edit-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-phone">Telefone</Label>
            <Input id="edit-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-bio">Bio</Label>
          <Textarea id="edit-bio" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </form>
    </Dialog>
  )
}

interface AssignPlanDialogProps {
  userId: string
  currentPlanId: string | null
  currentStatus: SubscriptionStatus
  currentExpires: string | null
  onClose: () => void
  onSaved: () => void
}
function AssignPlanDialog({
  userId,
  currentPlanId,
  currentStatus,
  currentExpires,
  onClose,
  onSaved,
}: AssignPlanDialogProps) {
  const { data: plans, isLoading } = useAdminPlans()
  const [planId, setPlanId] = useState(currentPlanId ?? '')
  const [status, setStatus] = useState<SubscriptionStatus>(currentStatus)
  const [expires, setExpires] = useState(currentExpires ? currentExpires.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!planId) {
      setErr('Selecione um plano.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await adminSetUserPlan({
        user_id: userId,
        plan_id: planId,
        expires_at: expires ? new Date(expires + 'T23:59:59').toISOString() : null,
        status,
      })
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Alterar plano do usuário"
      description="Define o plano atual, status e data de expiração opcional."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={(e) => handleSave(e as unknown as React.FormEvent)} disabled={saving || !planId}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSave} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="assign-plan">Plano</Label>
          <select
            id="assign-plan"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            required
          >
            <option value="">Selecione...</option>
            {isLoading ? (
              <option disabled>Carregando...</option>
            ) : (
              plans?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatCurrencyBRL(p.price_cents)} / {translateInterval(p.billing_interval)}
                  {!p.active && ' (inativo)'}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="assign-status">Status</Label>
            <select
              id="assign-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="active">Ativo</option>
              <option value="trialing">Trial</option>
              <option value="past_due">Em atraso</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assign-expires">Expira em</Label>
            <Input
              id="assign-expires"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </div>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </form>
    </Dialog>
  )
}

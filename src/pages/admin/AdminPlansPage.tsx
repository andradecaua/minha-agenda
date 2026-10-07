import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Pencil, Plus, Shield, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CurrencyInput } from '@/components/ui/currency-input'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAdminPlans } from '@/hooks/queries/useAdminPlans'
import { usePermissionCatalog } from '@/hooks/queries/usePermissionCatalog'
import {
  createPlan,
  deletePlan,
  updatePlan,
  type CreatePlanInput,
} from '@/services/admin'
import { formatCurrencyBRL } from '@/lib/utils'
import type { PermissionCatalogEntry } from '@/lib/permissions'
import type { BillingInterval, Plan } from '@/types/admin'

export function AdminPlansPage() {
  const { data: plans, isLoading } = useAdminPlans()
  const [editing, setEditing] = useState<Plan | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null)
  const queryClient = useQueryClient()
  const [err, setErr] = useState<string | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] })

  const removeMut = useMutation({
    mutationFn: (planId: string) => deletePlan(planId),
    onSuccess: () => {
      setDeleteTarget(null)
      setErr(null)
      invalidate()
    },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Planos</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de assinaturas disponíveis para os profissionais.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Novo plano
        </Button>
      </header>

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </CardContent>
        </Card>
      ) : !plans || plans.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum plano cadastrado. Crie o primeiro para começar.
            </p>
            <Button className="mt-4" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Criar primeiro plano
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className={p.active ? '' : 'opacity-60'}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold">{p.name}</h3>
                      {!p.active && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Inativo
                        </span>
                      )}
                    </div>
                    <code className="text-xs text-muted-foreground">{p.code}</code>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setEditing(p)} aria-label="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTarget(p)}
                      aria-label="Excluir"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {formatCurrencyBRL(p.price_cents)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    por {translateInterval(p.billing_interval)}
                  </div>
                  {p.price_yearly_cents != null && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        + anual {formatCurrencyBRL(p.price_yearly_cents)}
                      </span>
                    </div>
                  )}
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground">{p.description}</p>
                )}
                {Array.isArray(p.features) && p.features.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {(p.features as string[]).map((f, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {p.permissions.length > 0 && (
                  <div className="space-y-1.5 border-t pt-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      <Shield className="h-3 w-3" aria-hidden="true" />
                      Permissões
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {p.permissions.map((code) => (
                        <code
                          key={code}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {code}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-3 text-xs text-muted-foreground">
                  {p.max_services !== null && <span>Serviços: {p.max_services}</span>}
                  {p.max_appointments_per_month !== null && (
                    <span>Agendamentos/mês: {p.max_appointments_per_month}</span>
                  )}
                  {p.active_subscribers !== undefined && (
                    <span>Assinantes: {p.active_subscribers}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <PlanFormDialog
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            invalidate()
          }}
        />
      )}
      {editing && (
        <PlanFormDialog
          mode="edit"
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && removeMut.mutate(deleteTarget.id)}
        title="Excluir plano?"
        description={`O plano "${deleteTarget?.name ?? ''}" será removido. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        destructive
        loading={removeMut.isPending}
      />
    </div>
  )
}

function translateInterval(i: string): string {
  if (i === 'monthly') return 'mês'
  if (i === 'yearly') return 'ano'
  return 'vitalício'
}

/**
 * Mostra o desconto percentual do anual vs 12x o mensal. Verde
 * quando positivo, âmbar quando o anual sai mais CARO (ou igual)
 * — sinal de que admin provavelmente digitou errado.
 */
function YearlyDiscountPreview({
  priceCentsMonthly,
  priceCentsYearly,
}: {
  priceCentsMonthly: number
  priceCentsYearly: number
}) {
  if (priceCentsMonthly <= 0 || priceCentsYearly <= 0) {
    return (
      <div className="h-10 rounded-md border border-dashed border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Defina os dois preços
      </div>
    )
  }
  const yearIfMonthly = priceCentsMonthly * 12
  const discountPct = (yearIfMonthly - priceCentsYearly) / yearIfMonthly
  const pct = Math.round(discountPct * 100)
  const positive = discountPct > 0
  return (
    <div
      className={
        'flex h-10 items-center gap-2 rounded-md border px-3 text-xs ' +
        (positive
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700'
          : 'border-amber-500/40 bg-amber-500/5 text-amber-700')
      }
    >
      <span className="text-lg font-semibold tabular-nums">
        {positive ? `-${pct}%` : `+${Math.abs(pct)}%`}
      </span>
      <span className="text-[11px] opacity-80">
        {positive ? 'vs pagar 12 × mensal' : 'anual mais caro que mensal'}
      </span>
    </div>
  )
}

interface PlanFormDialogProps {
  mode: 'create' | 'edit'
  plan?: Plan
  onClose: () => void
  onSaved: () => void
}
function PlanFormDialog({ mode, plan, onClose, onSaved }: PlanFormDialogProps) {
  const { data: catalog, isLoading: catalogLoading } = usePermissionCatalog()
  const [form, setForm] = useState({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    price_cents: plan?.price_cents ?? 0,
    billing_interval: (plan?.billing_interval ?? 'monthly') as BillingInterval,
    features: Array.isArray(plan?.features) ? (plan!.features as string[]).join('\n') : '',
    max_services: plan?.max_services?.toString() ?? '',
    max_appointments_per_month: plan?.max_appointments_per_month?.toString() ?? '',
    active: plan?.active ?? true,
    offerYearly: plan?.price_yearly_cents != null,
    price_yearly_cents: plan?.price_yearly_cents ?? 0,
  })
  const [permissions, setPermissions] = useState<Set<string>>(
    () => new Set(plan?.permissions ?? []),
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function togglePermission(code: string) {
    setPermissions((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setSaving(true)
    try {
      const features = form.features
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      // Preço anual: ligado via toggle. Quando desligado, mandamos
      // `null` pro service — que, em update, vira o sentinel -1 pra
      // RPC limpar a coluna; em create, vira NULL de verdade.
      const yearlyPrice = form.offerYearly ? form.price_yearly_cents : null
      const payload: CreatePlanInput = {
        code: form.code,
        name: form.name,
        description: form.description || null,
        price_cents: form.price_cents,
        price_yearly_cents: yearlyPrice,
        billing_interval: form.billing_interval,
        features,
        permissions: Array.from(permissions),
        max_services: form.max_services ? Number(form.max_services) : null,
        max_appointments_per_month: form.max_appointments_per_month
          ? Number(form.max_appointments_per_month)
          : null,
        active: form.active,
      }
      if (mode === 'create') {
        await createPlan(payload)
      } else if (plan) {
        await updatePlan({ plan_id: plan.id, ...payload })
      }
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
      title={mode === 'create' ? 'Novo plano' : 'Editar plano'}
      description="Preço em reais, duração em quantidade de serviços/mês opcionais."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={(e) => handleSubmit(e as unknown as React.FormEvent)} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar plano'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="plan-code">Código *</Label>
            <Input
              id="plan-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
              placeholder="free, pro, business..."
              required
              disabled={mode === 'edit'}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Nome *</Label>
            <Input
              id="plan-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-desc">Descrição</Label>
          <Textarea
            id="plan-desc"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="plan-price">Preço mensal *</Label>
            <CurrencyInput
              id="plan-price"
              valueCents={form.price_cents}
              onChangeCents={(cents) => setForm({ ...form, price_cents: cents })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-interval">Cobrança principal</Label>
            <select
              id="plan-interval"
              value={form.billing_interval}
              onChange={(e) => setForm({ ...form, billing_interval: e.target.value as BillingInterval })}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="monthly">Mensal</option>
              <option value="yearly">Anual</option>
              <option value="lifetime">Vitalício</option>
            </select>
          </div>
        </div>

        {/* Preço anual opcional — habilita o toggle mensal/anual
            na landing e no SubscriptionPage. Desconto é derivado. */}
        {form.price_cents > 0 && (
          <div className="space-y-3 rounded-md border border-dashed border-input p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="plan-offer-yearly" className="cursor-pointer">
                  Oferecer plano anual
                </Label>
                <p className="text-xs text-muted-foreground">
                  Mostra toggle "mensal/anual" na landing com o desconto
                  calculado automaticamente.
                </p>
              </div>
              <Switch
                id="plan-offer-yearly"
                checked={form.offerYearly}
                onCheckedChange={(v) => setForm({ ...form, offerYearly: v })}
              />
            </div>
            {form.offerYearly && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plan-price-yearly">Preço anual</Label>
                  <CurrencyInput
                    id="plan-price-yearly"
                    valueCents={form.price_yearly_cents}
                    onChangeCents={(cents) =>
                      setForm({ ...form, price_yearly_cents: cents })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>Desconto vs mensal</Label>
                  <YearlyDiscountPreview
                    priceCentsMonthly={form.price_cents}
                    priceCentsYearly={form.price_yearly_cents}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="plan-features">Benefícios (um por linha)</Label>
          <Textarea
            id="plan-features"
            value={form.features}
            onChange={(e) => setForm({ ...form, features: e.target.value })}
            rows={4}
            placeholder={'Agendamentos ilimitados\nPortfólio em destaque\nSuporte prioritário'}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="plan-max-serv">Limite de serviços</Label>
            <Input
              id="plan-max-serv"
              type="number"
              min={0}
              value={form.max_services}
              onChange={(e) => setForm({ ...form, max_services: e.target.value })}
              placeholder="Vazio = sem limite"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan-max-appt">Agendamentos/mês</Label>
            <Input
              id="plan-max-appt"
              type="number"
              min={0}
              value={form.max_appointments_per_month}
              onChange={(e) => setForm({ ...form, max_appointments_per_month: e.target.value })}
              placeholder="Vazio = sem limite"
            />
          </div>
        </div>
        <PermissionsPicker
          catalog={catalog}
          loading={catalogLoading}
          selected={permissions}
          onToggle={togglePermission}
        />
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label htmlFor="plan-active">Plano ativo</Label>
            <p className="text-xs text-muted-foreground">
              Planos inativos ficam ocultos para novos usuários.
            </p>
          </div>
          <Switch
            id="plan-active"
            checked={form.active}
            onCheckedChange={(v) => setForm({ ...form, active: v })}
          />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </form>
    </Dialog>
  )
}

interface PermissionsPickerProps {
  catalog: PermissionCatalogEntry[] | undefined
  loading: boolean
  selected: Set<string>
  onToggle: (code: string) => void
}

/**
 * Checkbox list agrupada por categoria. Fonte: `permission_catalog`
 * no banco. Códigos novos aparecem aqui automaticamente — não é
 * preciso tocar neste componente ao adicionar permissão nova.
 */
function PermissionsPicker({ catalog, loading, selected, onToggle }: PermissionsPickerProps) {
  const grouped = useMemo(() => {
    if (!catalog) return [] as [string, PermissionCatalogEntry[]][]
    const map = new Map<string, PermissionCatalogEntry[]>()
    for (const entry of catalog) {
      const bucket = map.get(entry.category) ?? []
      bucket.push(entry)
      map.set(entry.category, bucket)
    }
    return Array.from(map.entries())
  }, [catalog])

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label>Permissões liberadas</Label>
        <span className="text-xs text-muted-foreground">
          {selected.size} selecionada{selected.size === 1 ? '' : 's'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Marque os recursos que este plano desbloqueia. O enforcement
        acontece no banco (RLS) e no frontend (guards de rota).
      </p>
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando catálogo...
        </div>
      ) : grouped.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          Catálogo vazio. Rode a migration 0019.
        </p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([category, entries]) => (
            <div key={category}>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {category}
              </div>
              <div className="space-y-1.5">
                {entries.map((entry) => (
                  <label
                    key={entry.code}
                    className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-0.5 hover:bg-accent/50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-primary"
                      checked={selected.has(entry.code)}
                      onChange={() => onToggle(entry.code)}
                    />
                    <span className="flex-1 text-xs">
                      <span className="font-medium">{entry.name}</span>
                      <code className="ml-2 text-muted-foreground">{entry.code}</code>
                      {entry.description && (
                        <span className="block text-[11px] text-muted-foreground">
                          {entry.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

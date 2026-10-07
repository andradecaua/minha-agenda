import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus, Scissors, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useMyProfile } from '@/hooks/queries/useMyProfile'
import { servicesQueryKey, useServices } from '@/hooks/queries/useServices'
import { myUsageQueryKey, useMyUsage } from '@/hooks/queries/useMyUsage'
import {
  createService,
  deleteService,
  toggleServiceActive,
  updateService,
} from '@/services/services'
import { isQuotaError } from '@/services/permissions'
import type { Service } from '@/types/database'
import { formatCurrencyBRL, formatMinutesDuration } from '@/lib/utils'
import { getIcon } from '@/lib/icons'
import { ServiceForm, type ServiceFormResult } from './ServiceForm'

export function ServicesPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useMyProfile()
  const { data: services, isLoading } = useServices(profile?.id)
  const { data: usage } = useMyUsage()

  const [editing, setEditing] = useState<Service | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Service | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const maxServices = usage?.max_services ?? null
  const servicesCount = usage?.services_count ?? services?.length ?? 0
  const atQuota = maxServices !== null && servicesCount >= maxServices

  function invalidate() {
    if (profile) {
      queryClient.invalidateQueries({ queryKey: servicesQueryKey(profile.id) })
    }
    // Refresca o contador — o novo serviço mudou `services_count`.
    queryClient.invalidateQueries({ queryKey: myUsageQueryKey() })
  }

  const createMutation = useMutation({
    mutationFn: ({ result }: { result: ServiceFormResult }) => {
      if (!profile) throw new Error('Perfil não carregado')
      return createService(profile.id, result.input, { imageFile: result.imageFile })
    },
    onSuccess: () => {
      invalidate()
      setCreating(false)
      setFormError(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ current, result }: { current: Service; result: ServiceFormResult }) =>
      updateService(current, result.input, {
        imageFile: result.imageFile,
        removeImage: result.removeImage,
      }),
    onSuccess: () => {
      invalidate()
      setEditing(null)
      setFormError(null)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ service, active }: { service: Service; active: boolean }) =>
      toggleServiceActive(service, active),
    onSuccess: invalidate,
    onError: () => {
      setListError('Não foi possível atualizar o status. Tente novamente.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (service: Service) => deleteService(service),
    onSuccess: () => {
      invalidate()
      setDeleting(null)
      setListError(null)
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message.toLowerCase() : ''
      // FK ON DELETE RESTRICT: appointments referenciando este serviço.
      if (msg.includes('foreign key') || msg.includes('violates')) {
        setListError(
          'Esse serviço já foi usado em agendamentos. Em vez de excluir, desative-o.',
        )
      } else {
        setListError('Não foi possível excluir. Tente novamente.')
      }
      setDeleting(null)
    },
  })

  async function handleSave(result: ServiceFormResult) {
    setFormError(null)
    try {
      if (editing) {
        await updateMutation.mutateAsync({ current: editing, result })
      } else {
        await createMutation.mutateAsync({ result })
      }
    } catch (err) {
      // Trigger de quota (0020) emite SQLSTATE P0100.
      if (isQuotaError(err)) {
        setFormError(
          maxServices
            ? `Você atingiu o limite do seu plano (${maxServices} serviços). Exclua um existente ou faça upgrade.`
            : 'Limite de serviços do plano atingido.',
        )
        queryClient.invalidateQueries({ queryKey: myUsageQueryKey() })
      } else {
        setFormError('Não foi possível salvar. Tente novamente.')
      }
    }
  }

  if (isLoading || !profile) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando serviços...
        </CardContent>
      </Card>
    )
  }

  const hasAny = (services?.length ?? 0) > 0
  const dialogOpen = creating || editing !== null
  const submitting = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Serviços</h1>
          <p className="text-sm text-muted-foreground">
            O que você oferece. Serviços inativos não aparecem na sua página pública.
          </p>
          {maxServices !== null && (
            <p
              className={`mt-1 text-xs ${atQuota ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {servicesCount} de {maxServices} serviços utilizados
              {atQuota && ' — limite atingido'}
            </p>
          )}
        </div>
        <Button
          onClick={() => {
            setFormError(null)
            setCreating(true)
          }}
          disabled={atQuota}
          title={atQuota ? 'Limite do plano atingido' : undefined}
        >
          <Plus className="h-4 w-4" />
          Novo serviço
        </Button>
      </div>

      {listError && (
        <Card>
          <CardContent className="py-3 text-sm text-destructive" role="alert">
            {listError}
          </CardContent>
        </Card>
      )}

      {!hasAny ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="grid gap-3">
          {services!.map((svc) => (
            <ServiceRow
              key={svc.id}
              service={svc}
              onEdit={() => {
                setFormError(null)
                setEditing(svc)
              }}
              onToggle={(active) =>
                toggleMutation.mutate({ service: svc, active })
              }
              onDelete={() => setDeleting(svc)}
              toggling={
                toggleMutation.isPending &&
                toggleMutation.variables?.service.id === svc.id
              }
            />
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => {
          if (submitting) return
          setCreating(false)
          setEditing(null)
        }}
        title={editing ? 'Editar serviço' : 'Novo serviço'}
        description={
          editing
            ? 'Atualize os dados deste serviço.'
            : 'Preencha os dados do serviço que você oferece.'
        }
        size="md"
      >
        {/* Montagem condicional garante form limpo a cada abertura —
            o Dialog em <dialog> nativo só esconde visualmente. */}
        {dialogOpen && (
          <ServiceForm
            initial={editing ?? undefined}
            submitting={submitting}
            errorMessage={formError}
            onSubmit={handleSave}
            onCancel={() => {
              setCreating(false)
              setEditing(null)
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting)
        }}
        title="Excluir serviço?"
        description={
          deleting
            ? `"${deleting.name}" será removido permanentemente. Essa ação não pode ser desfeita.`
            : ''
        }
        confirmLabel="Excluir"
        destructive
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

interface ServiceRowProps {
  service: Service
  onEdit: () => void
  onToggle: (active: boolean) => void
  onDelete: () => void
  toggling: boolean
}

function ServiceRow({ service, onEdit, onToggle, onDelete, toggling }: ServiceRowProps) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 py-4">
        <div className="flex flex-1 items-center gap-3 min-w-0">
          <ServiceThumb service={service} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{service.name}</p>
            <p className="text-sm text-muted-foreground">
              {formatCurrencyBRL(service.price_cents)} ·{' '}
              {formatMinutesDuration(service.duration_minutes)}
              {!service.active && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                  inativo
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={service.active}
            onCheckedChange={onToggle}
            disabled={toggling}
            aria-label={service.active ? 'Desativar serviço' : 'Ativar serviço'}
          />
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Excluir"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Precedência da thumb: foto personalizada > ícone escolhido > ícone
 * default (Scissors). Mesma hierarquia é usada na página pública.
 */
function ServiceThumb({ service }: { service: Service }) {
  if (service.image_url) {
    return (
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
        <img
          src={service.image_url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    )
  }

  const Icon = getIcon(service.icon) ?? Scissors
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    </div>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Scissors className="h-5 w-5" aria-hidden="true" />
        </div>
        <CardTitle className="mt-2">Nenhum serviço ainda</CardTitle>
        <CardDescription>
          Cadastre o que você oferece para que seus clientes possam reservar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center pb-6">
        <Button onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Criar primeiro serviço
        </Button>
      </CardContent>
    </Card>
  )
}

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2, ShieldAlert, Smartphone } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  useDisablePush,
  useEnablePush,
  usePushStatus,
} from '@/hooks/queries/usePushStatus'

export function NotificationsPage() {
  const { data: status, isLoading, refetch } = usePushStatus()
  const enable = useEnablePush()
  const disable = useDisablePush()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handler = () => refetch()
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [refetch])

  const busy = enable.isPending || disable.isPending || isLoading
  const subscribed = status === 'subscribed'

  async function onEnable() {
    setError(null)
    try {
      const next = await enable.mutateAsync()
      if (next === 'denied') {
        setError(
          'Permissão negada. Abra as configurações do navegador e permita notificações desse site.',
        )
      } else if (next === 'default') {
        setError('Permissão não concedida. Tente novamente.')
      } else if (next === 'unsupported') {
        setError('Este navegador não suporta notificações push.')
      } else if (next === 'unconfigured') {
        setError('Push ainda não está configurado no servidor.')
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Falha ao ativar notificações. Tente novamente.',
      )
    }
  }

  async function onDisable() {
    setError(null)
    try {
      await disable.mutateAsync()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Falha ao desativar. Tente novamente.',
      )
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Notificações</h2>
        <p className="text-sm text-muted-foreground">
          Receba alertas quando um cliente marcar ou cancelar um horário.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div className="flex items-start gap-3">
            <div
              className={
                subscribed
                  ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary'
                  : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground'
              }
            >
              {subscribed ? (
                <Bell className="h-4 w-4" aria-hidden="true" />
              ) : (
                <BellOff className="h-4 w-4" aria-hidden="true" />
              )}
            </div>
            <div>
              <CardTitle className="text-base">
                Alertas de agendamento neste dispositivo
              </CardTitle>
              <CardDescription>
                Notificações aparecem na sua tela mesmo com o site fechado.
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <StatusDetail status={status} />

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {subscribed ? (
              <Button onClick={onDisable} disabled={busy} variant="outline">
                {disable.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Desativar neste dispositivo
              </Button>
            ) : (
              <Button
                onClick={onEnable}
                disabled={
                  busy ||
                  status === 'unsupported' ||
                  status === 'unconfigured' ||
                  status === 'denied'
                }
              >
                {enable.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Ativar notificações
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <IosHint />
    </div>
  )
}

/* ============================================================ */

function StatusBadge({ status }: { status: PushStatusLike }) {
  const label = BADGE_LABEL[status ?? 'default']
  const tone = BADGE_TONE[status ?? 'default']
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ' +
        tone
      }
    >
      {label}
    </span>
  )
}

function StatusDetail({ status }: { status: PushStatusLike }) {
  switch (status) {
    case 'subscribed':
      return (
        <p className="text-sm text-muted-foreground">
          Tudo pronto. Você vai receber uma notificação toda vez que um cliente
          marcar ou cancelar pelo link público.
        </p>
      )
    case 'granted-off':
      return (
        <p className="text-sm text-muted-foreground">
          A permissão já foi concedida, mas este dispositivo não está inscrito.
          Clique em "Ativar notificações" pra inscrever.
        </p>
      )
    case 'default':
      return (
        <p className="text-sm text-muted-foreground">
          Você ainda não decidiu. Ao clicar em "Ativar", o navegador vai pedir
          permissão.
        </p>
      )
    case 'denied':
      return (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            As notificações estão bloqueadas pra este site. Abra as configurações
            do navegador, permita notificações e volte aqui.
          </span>
        </div>
      )
    case 'unsupported':
      return (
        <p className="text-sm text-muted-foreground">
          Este navegador não suporta Web Push. Tente usar Chrome, Firefox, Edge
          ou um iPhone com o app instalado na tela inicial (iOS 16.4+).
        </p>
      )
    case 'unconfigured':
      return (
        <p className="text-sm text-muted-foreground">
          O servidor ainda não foi configurado pra enviar push. Fale com o
          administrador.
        </p>
      )
    default:
      return (
        <p className="text-sm text-muted-foreground">Carregando status...</p>
      )
  }
}

function IosHint() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex items-start gap-3 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Smartphone className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">No iPhone, instale o app na tela inicial.</p>
          <p className="text-muted-foreground">
            Notificações push no iPhone só funcionam dentro do app instalado
            (iOS 16.4 ou superior). No Safari, toque em "Compartilhar" →
            "Adicionar à Tela de Início", abra pelo ícone e ative aqui dentro.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

type PushStatusLike = ReturnType<typeof usePushStatus>['data']

const BADGE_LABEL: Record<string, string> = {
  subscribed: 'Ativo',
  'granted-off': 'Pausado',
  default: 'Desativado',
  denied: 'Bloqueado',
  unsupported: 'Não suportado',
  unconfigured: 'Indisponível',
}
const BADGE_TONE: Record<string, string> = {
  subscribed: 'bg-emerald-100 text-emerald-900',
  'granted-off': 'bg-amber-100 text-amber-900',
  default: 'bg-muted text-muted-foreground',
  denied: 'bg-destructive/10 text-destructive',
  unsupported: 'bg-muted text-muted-foreground',
  unconfigured: 'bg-muted text-muted-foreground',
}

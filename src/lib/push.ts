import { supabase } from '@/lib/supabase'

/**
 * Camada mínima pra Web Push:
 *   - detecta suporte do browser + estado atual
 *   - subscribe/unsubscribe no PushManager
 *   - replica (register/remove) na tabela `push_subscriptions`
 *
 * Decisões:
 *   - A chave pública VAPID vem do env (`VITE_VAPID_PUBLIC_KEY`).
 *     Sem ela, `isPushConfigured()` devolve false e a UI esconde o
 *     toggle — evita um pedido de permissão que vai falhar.
 *   - `getPushStatus()` resolve estados compostos (sem SW, com SW
 *     mas sem subscription, inscrito, negado…) num enum único.
 *   - O service worker em si registra via `useRegisterSW` já
 *     existente — aqui só pegamos o `ready` promise.
 */

export type PushStatus =
  | 'unsupported' // browser sem SW/PushManager/Notification
  | 'unconfigured' // VAPID_PUBLIC_KEY ausente
  | 'denied' // user negou permissão (lembra entre sessões)
  | 'default' // nunca pediu
  | 'granted-off' // permissão ok, mas sem subscription ativa
  | 'subscribed' // tudo pronto

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as
  | string
  | undefined

export function isPushConfigured(): boolean {
  return !!VAPID_PUBLIC_KEY && VAPID_PUBLIC_KEY.length > 0
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  if (!isPushConfigured()) return 'unconfigured'

  const permission = Notification.permission
  if (permission === 'denied') return 'denied'

  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return permission === 'granted' ? 'granted-off' : 'default'

  const sub = await reg.pushManager.getSubscription()
  if (sub) return 'subscribed'
  return permission === 'granted' ? 'granted-off' : 'default'
}

export async function enablePush(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  if (!isPushConfigured()) return 'unconfigured'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return permission === 'denied' ? 'denied' : 'default'
  }

  const reg = await navigator.serviceWorker.ready

  // Se já tiver subscription, só re-registra no banco (idempotente).
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY as string),
    }))

  await persistSubscription(sub)
  return 'subscribed'
}

export async function disablePush(): Promise<PushStatus> {
  if (!isPushSupported()) return 'unsupported'
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return 'default'
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return Notification.permission === 'granted' ? 'granted-off' : 'default'

  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  await supabase.rpc('remove_push_subscription', { p_endpoint: endpoint })
  return Notification.permission === 'granted' ? 'granted-off' : 'default'
}

async function persistSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  const endpoint = json.endpoint ?? sub.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    throw new Error('subscription inválida — endpoint/keys ausentes')
  }
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth_token: auth,
    p_user_agent:
      typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 255) : null,
  })
  if (error) throw error
}

function urlB64ToUint8Array(base64: string): BufferSource {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buf = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return view
}

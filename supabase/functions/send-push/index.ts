// Envia Web Push (VAPID) pros devices inscritos de um user.
//
// Chamada por trigger do Postgres (`notify_push_appointment`) com
// autenticação via Bearer = SERVICE_ROLE_KEY. Não aceita JWT de user
// — este endpoint não é pro frontend.
//
// Entrada:
//   {
//     event: 'appointment_created' | 'appointment_cancelled',
//     user_id: uuid,
//     appointment_id: uuid
//   }
//
// Comportamento:
//   - Busca appointment + client + services pra compor title/body
//     em pt-BR.
//   - Envia Web Push via lib `web-push` (npm). Em 404/410 marca
//     `revoked_at` da subscription. Em sucesso atualiza
//     `last_used_at`.
//   - Retorna `{status:'ok', sent, revoked}`.
//
// Segredos (Supabase > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY  — base64url (mesma do frontend)
//   VAPID_PRIVATE_KEY — base64url
//   VAPID_SUBJECT     — "mailto:..." ou URL do site

import webpush from 'npm:web-push@3.6.7'
import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/supabase.ts'

type PushEvent = 'appointment_created' | 'appointment_cancelled'

interface Body {
  event?: PushEvent
  user_id?: string
  appointment_id?: string
}

interface AppointmentRow {
  id: string
  start_at: string
  status: string
  professional_id: string
  client: { name: string } | null
  services: { position: number; service: { name: string } | null }[]
}

interface SubRow {
  id: string
  endpoint: string
  p256dh: string
  auth_token: string
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 405)

    const auth = req.headers.get('authorization') ?? ''
    const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!expected || auth !== `Bearer ${expected}`) {
      return errorResponse('unauthorized', 401)
    }

    const vapidPub = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY')
    const vapidSub = Deno.env.get('VAPID_SUBJECT')
    if (!vapidPub || !vapidPriv || !vapidSub) {
      console.error('[send-push] vapid secrets ausentes')
      return errorResponse('missing_vapid', 500)
    }
    webpush.setVapidDetails(vapidSub, vapidPub, vapidPriv)

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.event || !body.user_id || !body.appointment_id) {
      return errorResponse('invalid_body', 400)
    }

    const db = serviceClient()

    const { data: appt, error: apptErr } = await db
      .from('appointments')
      .select(
        `
        id, start_at, status, professional_id,
        client:clients(name),
        services:appointment_services(position, service:services(name))
      `,
      )
      .eq('id', body.appointment_id)
      .maybeSingle()
      .returns<AppointmentRow>()

    if (apptErr || !appt) {
      console.warn('[send-push] appointment não encontrado', apptErr?.message)
      return jsonResponse({ status: 'ok', sent: 0, revoked: 0, skipped: true })
    }

    const { data: subs, error: subsErr } = await db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_token')
      .eq('user_id', body.user_id)
      .is('revoked_at', null)
      .returns<SubRow[]>()

    if (subsErr) {
      console.error('[send-push] erro ao buscar subs', subsErr.message)
      return errorResponse('db_error', 500)
    }
    if (!subs || subs.length === 0) {
      return jsonResponse({ status: 'ok', sent: 0, revoked: 0 })
    }

    const payload = buildPayload(body.event, appt)
    const bodyStr = JSON.stringify(payload)

    let sent = 0
    let revoked = 0
    const now = new Date().toISOString()

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_token },
            },
            bodyStr,
            { TTL: 60 * 60 * 24 },
          )
          sent += 1
          await db
            .from('push_subscriptions')
            .update({ last_used_at: now })
            .eq('id', sub.id)
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode
          if (code === 404 || code === 410) {
            revoked += 1
            await db
              .from('push_subscriptions')
              .update({ revoked_at: now })
              .eq('id', sub.id)
          } else {
            console.warn('[send-push] erro inesperado', code, (err as Error).message)
          }
        }
      }),
    )

    return jsonResponse({ status: 'ok', sent, revoked })
  } catch (err) {
    console.error('[send-push] erro', (err as Error).message)
    return errorResponse('internal_error', 500)
  }
})

function buildPayload(event: PushEvent, a: AppointmentRow) {
  const start = new Date(a.start_at)
  const dateStr = start.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
  const clientName = a.client?.name ?? 'Cliente'
  const services = (a.services ?? [])
    .slice()
    .sort((x, y) => x.position - y.position)
  const firstService = services[0]?.service?.name ?? 'atendimento'
  const extra = services.length > 1 ? ` +${services.length - 1}` : ''

  if (event === 'appointment_cancelled') {
    return {
      title: 'Agendamento cancelado',
      body: `${clientName} · ${firstService}${extra} · ${dateStr}`,
      tag: `appt-${a.id}`,
      url: '/dashboard/agenda',
    }
  }
  return {
    title: 'Novo agendamento',
    body: `${clientName} · ${firstService}${extra} · ${dateStr}`,
    tag: `appt-${a.id}`,
    url: '/dashboard/agenda',
  }
}

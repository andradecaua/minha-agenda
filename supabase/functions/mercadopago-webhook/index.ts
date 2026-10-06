// Webhook do Mercado Pago. Público (sem auth JWT); segurança em
// camadas:
//
//   HMAC válido → processa (caminho normal, prod).
//
//   HMAC inválido → fallback por **duplo check**:
//     1. `GET /v1/payments/{id}` com nosso MP_ACCESS_TOKEN precisa
//        devolver o resource. Só a conta dona do token consegue
//        consultar seus payments → atacante não forja um payment
//        inexistente.
//     2. O `external_reference` do payment precisa ter formato
//        `user_id:plan_id` E o user_id tem que existir em
//        `auth.users` do NOSSO Supabase. Isso prova que o payment
//        nasceu de uma Preference criada pelo nosso app (ninguém de
//        fora consegue setar external_reference que resolva pra um
//        usuário nosso).
//
// Com esse par, um atacante não consegue forjar webhook mesmo
// conhecendo payment IDs; sem o access token da conta ele não passa
// no check 1, e sem user_ids válidos da nossa base ele não passa no 2.
// O pior cenário residual (payment real + ext_ref válido mas HMAC
// não bate) é um webhook legítimo que já aconteceria — a trava de
// idempotência (`payment_events UNIQUE`) impede repetições.
//
// Esse desenho é tolerante ao bug conhecido do MP em credenciais de
// teste (HMAC inconsistente com `notification_url` de Preference) sem
// relaxar prod — porque mesmo em prod, se HMAC falhar, o fallback só
// aceita payments que realmente são nossos.
//
// Modelo: Checkout Preference. Só processamos `type=payment` — o MP
// emite esse evento quando um pagamento muda de estado. Em `approved`,
// estendemos `current_period_end` em 1 mês chamando
// `activate_subscription_from_webhook` com service_role.
//
// Idempotência: `payment_events` tem UNIQUE (gateway, gateway_event_id).
// Se o MP reenviar o mesmo webhook (acontece), a RPC
// `record_payment_event` devolve false e seguimos adiante.
//
// Secrets:
//   MP_WEBHOOK_SECRET — string do painel do MP.
//   MP_ACCESS_TOKEN   — access token da aplicação (usado no fallback).

import { getPayment, verifyWebhookSignature } from '../_shared/mercadopago.ts'
import { serviceClient } from '../_shared/supabase.ts'

function ok(body = 'ok'): Response {
  return new Response(body, { status: 200 })
}
function bad(status = 400, body = 'bad'): Response {
  return new Response(body, { status })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return bad(405, 'method_not_allowed')

  const rawBody = await req.text()
  let payload: {
    action?: string
    type?: string
    topic?: string
    data?: { id?: string | number }
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return bad(400, 'invalid_json')
  }

  // `data.id` pode vir na query (webhook global do painel) OU no body
  // (notification_url de Preference). Pra assinatura, tentamos as duas.
  const url = new URL(req.url)
  const idFromQuery = url.searchParams.get('data.id') ?? url.searchParams.get('id')
  const idFromBody = payload.data?.id != null ? String(payload.data.id) : null
  const resourceId = idFromQuery ?? idFromBody ?? ''
  if (!resourceId) return bad(400, 'missing_data_id')

  // Topic do webhook. O MP é inconsistente nos nomes de campos
  // dependendo do formato (IPN legacy, novo webhook, notification_url
  // da Preference). Tentamos todos os lugares conhecidos.
  const rawTopic =
    payload.type ??
    payload.topic ??
    url.searchParams.get('type') ??
    url.searchParams.get('topic') ??
    payload.action?.split('.')[0] ??
    ''
  const topic = rawTopic.toLowerCase()

  // Fallback: se temos um resourceId mas o MP não indicou topic, é
  // praticamente certo que é um payment update — este app só cria
  // Preferences, então não há outros tipos de recurso em jogo.
  // `getPayment()` adiante confirma (404 se não for payment real).
  const effectiveTopic = topic || (resourceId ? 'payment' : '')
  const isPaymentTopic = effectiveTopic === 'payment'

  // --- 1. Verifica assinatura ----------------------------------
  const secret = Deno.env.get('MP_WEBHOOK_SECRET')
  if (!secret) {
    console.error('[webhook] MP_WEBHOOK_SECRET não configurado')
    return bad(500, 'misconfigured')
  }
  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id')
  console.log('[webhook] incoming', {
    url: req.url,
    idFromQuery,
    idFromBody,
    topicRaw: topic,
    topicEffective: effectiveTopic,
    hasSignature: !!xSignature,
    hasRequestId: !!xRequestId,
  })
  const sigOk = await verifyWebhookSignature({
    xSignature,
    xRequestId,
    idFromQuery,
    idFromBody,
    secret,
  })

  const db = serviceClient()
  const gatewayEventId = xRequestId ?? `${effectiveTopic}-${resourceId}-${Date.now()}`

  // Topics não-payment (merchant_order, test, etc.) não disparam ação
  // crítica. Se HMAC bate, audita. Se não bate, 200 silencioso — não
  // vale rejeitar e fazer o MP reenviar, nem gastar lookup no DB.
  if (!isPaymentTopic) {
    if (sigOk) {
      try {
        await db.rpc('record_payment_event', {
          p_user_id: null,
          p_plan_id: null,
          p_gateway: 'mercadopago',
          p_gateway_event_id: gatewayEventId,
          p_gateway_resource: effectiveTopic || 'unknown',
          p_gateway_resource_id: resourceId,
          p_event_type: payload.action ?? null,
          p_amount_cents: null,
          p_raw: payload as unknown as Record<string, unknown>,
        })
      } catch (err) {
        console.error('[webhook] audit erro em topic', effectiveTopic, err)
      }
    }
    console.log('[webhook] topic ignorado:', effectiveTopic, 'sigOk=', sigOk)
    return ok()
  }

  // --- Caminho crítico: topic == payment -------------------------
  // Pre-fetch do payment: usado tanto no fallback de assinatura
  // quanto no processamento. Fazemos uma vez só.
  let fetchedPayment: Awaited<ReturnType<typeof getPayment>> | null = null
  if (!sigOk) {
    // Fallback: duplo-check.
    // 1. Payment existe na nossa conta MP (atacante não forja).
    try {
      fetchedPayment = await getPayment(resourceId)
    } catch (err) {
      console.warn('[webhook] HMAC inválido e getPayment falhou:', err)
      return bad(401, 'invalid_signature')
    }
    // 2. External_reference aponta pra user_id que existe no nosso DB.
    const [maybeUserId] = (fetchedPayment.external_reference ?? '').split(':')
    if (!maybeUserId) {
      console.warn('[webhook] HMAC inválido e payment sem external_reference válido', {
        paymentId: resourceId,
      })
      return bad(401, 'invalid_signature')
    }
    const { data: userLookup, error: userErr } =
      await db.auth.admin.getUserById(maybeUserId)
    if (userErr || !userLookup?.user) {
      console.warn('[webhook] HMAC inválido e user_id não encontrado', {
        paymentId: resourceId,
        maybeUserId,
      })
      return bad(401, 'invalid_signature')
    }
    console.warn(
      '[webhook] HMAC inválido mas duplo-check (API + user) ok — aceito via fallback',
      { paymentId: resourceId, userId: maybeUserId },
    )
  }

  try {
    await handlePayment(db, resourceId, gatewayEventId, payload, fetchedPayment)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[webhook] erro ao processar:', msg)
    // 500 faz o MP reagendar — correto quando a falha é nossa.
    return bad(500, 'processing_error')
  }

  return ok()
})

// =============================================================
// Payment handler
// -------------------------------------------------------------
// Estados relevantes do MP:
//   approved  → extende current_period_end em 1 mês
//   rejected  → só grava event (user vai tentar de novo)
//   cancelled → só grava event
//   refunded  → grava event; downgrade só acontece quando current_period_end
//               vence (não forçamos aqui pra evitar perda de janela já paga).
// =============================================================
async function handlePayment(
  db: ReturnType<typeof serviceClient>,
  paymentId: string,
  gatewayEventId: string,
  rawPayload: unknown,
  prefetched: Awaited<ReturnType<typeof getPayment>> | null,
) {
  // Reusa o payment já buscado no fallback de assinatura.
  const payment = prefetched ?? (await getPayment(paymentId))
  const [userId, planId] = (payment.external_reference ?? '').split(':')

  console.log(
    '[webhook] payment',
    paymentId,
    'status=',
    payment.status,
    'method=',
    payment.payment_method_id,
    'ref=',
    payment.external_reference,
  )

  await db.rpc('record_payment_event', {
    p_user_id: userId || null,
    p_plan_id: planId || null,
    p_gateway: 'mercadopago',
    p_gateway_event_id: gatewayEventId,
    p_gateway_resource: 'payment',
    p_gateway_resource_id: paymentId,
    p_event_type: payment.status,
    p_amount_cents: Math.round(payment.transaction_amount * 100),
    p_raw: rawPayload as Record<string, unknown>,
  })

  if (payment.status === 'approved' && userId && planId) {
    const periodEnd = addMonthIso(payment.date_approved ?? null)
    const { error } = await db.rpc('activate_subscription_from_webhook', {
      p_user_id: userId,
      p_plan_id: planId,
      p_gateway: 'mercadopago',
      p_subscription_id: paymentId,
      p_current_period_end: periodEnd,
      p_last_payment_at:
        payment.date_approved ?? new Date().toISOString(),
    })
    if (error) {
      console.error('[webhook] activate_subscription erro:', error)
      throw new Error(`activate_failed: ${error.message}`)
    }
    console.log('[webhook] subscription ativada até', periodEnd)
  }
}

function addMonthIso(baseIso: string | null): string {
  const d = baseIso ? new Date(baseIso) : new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

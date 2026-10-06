// Webhook do Mercado Pago. Público (sem auth JWT); segurança via
// HMAC-SHA256 na header `x-signature`.
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
//   MP_WEBHOOK_SECRET — mesma string configurada no painel do MP.

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
    data?: { id?: string | number }
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return bad(400, 'invalid_json')
  }

  const resourceId = String(payload.data?.id ?? '')
  if (!resourceId) return bad(400, 'missing_data_id')

  // --- 1. Verifica assinatura ----------------------------------
  const secret = Deno.env.get('MP_WEBHOOK_SECRET')
  if (!secret) {
    console.error('[webhook] MP_WEBHOOK_SECRET não configurado')
    return bad(500, 'misconfigured')
  }
  const xSignature = req.headers.get('x-signature')
  const xRequestId = req.headers.get('x-request-id')
  const sigOk = await verifyWebhookSignature(
    xSignature,
    xRequestId,
    resourceId,
    secret,
  )
  if (!sigOk) {
    console.warn('[webhook] assinatura inválida', { xRequestId })
    return bad(401, 'invalid_signature')
  }

  const topic = (payload.type ?? payload.action?.split('.')[0] ?? '')
    .toLowerCase()
  const db = serviceClient()
  const gatewayEventId = xRequestId ?? `${topic}-${resourceId}-${Date.now()}`

  try {
    if (topic === 'payment') {
      await handlePayment(db, resourceId, gatewayEventId, payload)
    } else {
      // Qualquer outro topic (preapproval residual, test ping, etc.):
      // apenas registra pra auditoria.
      await db.rpc('record_payment_event', {
        p_user_id: null,
        p_plan_id: null,
        p_gateway: 'mercadopago',
        p_gateway_event_id: gatewayEventId,
        p_gateway_resource: topic || 'unknown',
        p_gateway_resource_id: resourceId,
        p_event_type: payload.action ?? null,
        p_amount_cents: null,
        p_raw: payload as unknown as Record<string, unknown>,
      })
      console.log('[webhook] topic ignorado:', topic)
    }
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
) {
  const payment = await getPayment(paymentId)
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

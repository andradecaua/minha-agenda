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
import { sendEmail } from '../_shared/email.ts'

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
    // Alerta operacional. Pode indicar MP_WEBHOOK_SECRET rotacionado
    // sem reconfigurar aqui, ou mudança de formato de manifesto do
    // MP, ou crédito de teste com HMAC inconsistente. Em qualquer
    // caso, vale olhar. Fire-and-forget pra não travar a resposta
    // do webhook (que precisa ser rápida pra o MP não reenviar).
    const alertTo = Deno.env.get('ALERT_EMAIL_TO')
    if (alertTo) {
      // deno-lint-ignore no-floating-promises
      sendEmail({
        to: alertTo,
        subject: '[Minha Agenda] HMAC fallback do webhook do MP disparou',
        html: renderHmacAlert({
          paymentId: resourceId,
          userId: maybeUserId,
          requestId: xRequestId,
          firedAt: new Date().toISOString(),
        }),
      }).catch((err) => {
        console.error('[webhook] falha ao enviar alerta HMAC fallback:', err)
      })
    }
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
  // external_reference: `user_id:plan_id[:interval]`. O 3º segmento
  // é opcional pra compat com webhooks de compras antigas (feitas
  // antes da 0025) — fallback 'monthly' nesses casos.
  const refParts = (payment.external_reference ?? '').split(':')
  const userId = refParts[0] ?? ''
  const planId = refParts[1] ?? ''
  const interval: 'monthly' | 'yearly' =
    refParts[2] === 'yearly' ? 'yearly' : 'monthly'

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

  // `record_payment_event` devolve `true` só na primeira vez que
  // esse evento é registrado — a UNIQUE (gateway, gateway_event_id)
  // + ON CONFLICT DO NOTHING garante idempotência. Usamos esse flag
  // pra evitar reenviar o email de agradecimento em replays do MP.
  const { data: isNewEvent, error: recordErr } = await db.rpc('record_payment_event', {
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
  if (recordErr) {
    console.error('[webhook] record_payment_event erro:', recordErr)
  }

  if (payment.status === 'approved' && userId && planId) {
    const periodEnd = addPeriodIso(payment.date_approved ?? null, interval)
    const { error } = await db.rpc('activate_subscription_from_webhook', {
      p_user_id: userId,
      p_plan_id: planId,
      p_gateway: 'mercadopago',
      p_subscription_id: paymentId,
      p_current_period_end: periodEnd,
      p_last_payment_at:
        payment.date_approved ?? new Date().toISOString(),
      p_interval: interval,
    })
    if (error) {
      console.error('[webhook] activate_subscription erro:', error)
      throw new Error(`activate_failed: ${error.message}`)
    }
    console.log('[webhook] subscription ativada até', periodEnd, 'interval=', interval)

    // Email de agradecimento. Fire-and-forget pra não atrasar o 200
    // ao MP (que precisa ser rápido pra não reagendar). Só manda em
    // evento NOVO — webhook replay pelo MP não dispara email duplicado.
    if (isNewEvent) {
      // deno-lint-ignore no-floating-promises
      sendPurchaseThankYouEmail(db, {
        userId,
        planId,
        paymentId,
        amountCents: Math.round(payment.transaction_amount * 100),
        periodEnd,
      }).catch((err) => {
        console.error('[webhook] falha ao enviar email de agradecimento:', err)
      })
    } else {
      console.log('[webhook] evento replay — email de agradecimento pulado')
    }
  }
}

function addPeriodIso(
  baseIso: string | null,
  interval: 'monthly' | 'yearly',
): string {
  const d = baseIso ? new Date(baseIso) : new Date()
  if (interval === 'yearly') {
    d.setFullYear(d.getFullYear() + 1)
  } else {
    d.setMonth(d.getMonth() + 1)
  }
  return d.toISOString()
}

// =============================================================
// Email de agradecimento pela compra
// -------------------------------------------------------------
// Disparado uma vez por evento NOVO de payment.approved. Busca
// email do user via auth.admin e nome do plano. Qualquer erro é
// logado — não re-throw, pra não interferir no retorno do webhook.
// =============================================================
async function sendPurchaseThankYouEmail(
  db: ReturnType<typeof serviceClient>,
  params: {
    userId: string
    planId: string
    paymentId: string
    amountCents: number
    periodEnd: string
  },
): Promise<void> {
  const { data: userData, error: userErr } = await db.auth.admin.getUserById(
    params.userId,
  )
  if (userErr || !userData?.user?.email) {
    console.warn('[webhook] thank-you: user sem email', {
      userId: params.userId,
      err: userErr,
    })
    return
  }

  const { data: plan, error: planErr } = await db
    .from('plans')
    .select('name')
    .eq('id', params.planId)
    .maybeSingle()
  if (planErr || !plan) {
    console.warn('[webhook] thank-you: plano não encontrado', {
      planId: params.planId,
      err: planErr,
    })
    return
  }

  const siteUrl = Deno.env.get('SITE_URL') ?? ''
  const manageUrl = `${siteUrl}/dashboard/configuracoes/assinatura`

  await sendEmail({
    to: userData.user.email,
    subject: `Pagamento confirmado · ${plan.name} · Minha Agenda`,
    html: renderThankYouEmail({
      planName: plan.name,
      amountCents: params.amountCents,
      periodEnd: params.periodEnd,
      paymentId: params.paymentId,
      manageUrl,
    }),
  })

  console.log('[webhook] email de agradecimento enviado', {
    userId: params.userId,
    paymentId: params.paymentId,
  })
}

function renderThankYouEmail(params: {
  planName: string
  amountCents: number
  periodEnd: string
  paymentId: string
  manageUrl: string
}): string {
  const d = new Date(params.periodEnd)
  const dateBR = Number.isNaN(d.getTime())
    ? params.periodEnd
    : new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(d)
  const amountBR = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(params.amountCents / 100)

  // HTML inline-styled, mesma linguagem visual dos outros templates
  // (confirm-signup, send-renewal-reminders).
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Pagamento confirmado · Minha Agenda</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b1220">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">
    Seu plano ${escapeHtml(params.planName)} está ativo até ${escapeHtml(dateBR)}.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f6f8;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <tr><td style="padding:28px 32px 0 32px">
          <div style="font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#111827">Minha Agenda</div>
        </td></tr>

        <tr><td style="padding:20px 32px 8px 32px">
          <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;color:#0b1220;letter-spacing:-0.01em">
            Pagamento confirmado 🎉
          </h1>
        </td></tr>

        <tr><td style="padding:12px 32px 0 32px">
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151">
            Obrigado por assinar a <strong>Minha Agenda</strong>! Seu pagamento foi
            processado e seu plano já está ativo.
          </p>
        </td></tr>

        <!-- Resumo da compra -->
        <tr><td style="padding:4px 32px 20px 32px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:10px">
            <tr>
              <td style="padding:12px 16px;font-size:13px;color:#6b7280;width:40%">Plano</td>
              <td style="padding:12px 16px;font-size:14px;color:#0b1220;font-weight:600">${escapeHtml(params.planName)}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb">Valor pago</td>
              <td style="padding:12px 16px;font-size:14px;color:#0b1220;font-weight:600;border-top:1px solid #e5e7eb">${escapeHtml(amountBR)}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb">Acesso até</td>
              <td style="padding:12px 16px;font-size:14px;color:#0b1220;font-weight:600;border-top:1px solid #e5e7eb">${escapeHtml(dateBR)}</td>
            </tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:0 32px 24px 32px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center">
              <a href="${escapeHtml(params.manageUrl)}" target="_blank"
                 style="display:inline-block;background-color:#0b1220;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 24px;border-radius:8px;letter-spacing:-0.01em">
                Ir para o painel
              </a>
            </td></tr>
          </table>
        </td></tr>

        <!-- Nota sobre renovação -->
        <tr><td style="padding:0 32px 24px 32px">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280">
            A renovação é manual: você paga de novo quando o período acabar.
            Enviaremos um lembrete por email alguns dias antes do vencimento.
          </p>
        </td></tr>

        <!-- Divisor -->
        <tr><td style="padding:0 32px"><div style="height:1px;background-color:#e5e7eb"></div></td></tr>

        <!-- Rodapé -->
        <tr><td style="padding:20px 32px 28px 32px">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280">
            Precisa de recibo ou nota? Responda este email. Guarde-o como
            comprovante — número da transação:
            <code style="font-family:ui-monospace,Menlo,Consolas,monospace;color:#374151">${escapeHtml(params.paymentId)}</code>.
          </p>
        </td></tr>
      </table>

      <p style="margin:16px 0 0 0;font-size:12px;color:#9ca3af">
        Minha Agenda · agendamento online pra profissionais autônomos.
      </p>
    </td></tr>
  </table>
</body>
</html>`
}

// =============================================================
// Email de alerta — HMAC fallback aceito
// -------------------------------------------------------------
// HTML minimalista. O destinatário é o operador (não cliente), então
// não precisamos de design — precisamos dos campos pra investigar.
// =============================================================
function renderHmacAlert(params: {
  paymentId: string
  userId: string
  requestId: string | null
  firedAt: string
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<body style="font-family:ui-monospace,Menlo,Consolas,monospace;color:#111;background:#fff;padding:24px">
  <h2 style="margin:0 0 12px;font-size:16px">⚠️ HMAC fallback do webhook do MP disparou</h2>
  <p style="margin:0 0 16px;font-size:13px;line-height:1.5">
    A assinatura HMAC do payload falhou, mas o duplo-check (API do MP +
    user_id no nosso DB) passou — o webhook foi aceito via fallback. Vale
    conferir se o <code>MP_WEBHOOK_SECRET</code> está atualizado nos
    secrets do Supabase vs. o painel do MP.
  </p>
  <table cellpadding="4" style="font-size:12px;border-collapse:collapse">
    <tr><td style="color:#666">payment_id</td><td><code>${escapeHtml(params.paymentId)}</code></td></tr>
    <tr><td style="color:#666">user_id</td><td><code>${escapeHtml(params.userId)}</code></td></tr>
    <tr><td style="color:#666">x-request-id</td><td><code>${escapeHtml(params.requestId ?? '(nulo)')}</code></td></tr>
    <tr><td style="color:#666">fired_at (UTC)</td><td><code>${escapeHtml(params.firedAt)}</code></td></tr>
  </table>
  <p style="margin:16px 0 0;font-size:12px;color:#666;line-height:1.5">
    Pra investigar: Supabase → Edge Functions → mercadopago-webhook → Logs,
    filtre por <code>${escapeHtml(params.paymentId)}</code>.
  </p>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Cria uma sessão de checkout (Preference) no Mercado Pago para
// o usuário logado + plano escolhido. Devolve `init_point` para redirect.
//
// Modelo: pagamento por período. User paga 1x pelo valor do plano;
// quando o webhook confirma `approved`, estende `current_period_end`
// em 1 mês. Aceita Pix, cartão e boleto (todos nativos do Checkout
// Preference).
//
// A ativação local acontece apenas no webhook — aqui só devolve a URL.

import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { createPreference } from '../_shared/mercadopago.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 405)

    console.log('[create-subscription] step=start')

    // --- 1. Auth: pega user do JWT -----------------------------
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return errorResponse('unauthorized', 401)

    const asUser = userClient(authHeader)
    const { data: userData, error: userErr } = await asUser.auth.getUser()
    if (userErr || !userData.user) {
      console.error('[create-subscription] auth erro:', userErr)
      return errorResponse('unauthorized', 401)
    }
    const user = userData.user
    console.log('[create-subscription] user=', user.id)

    // --- 2. Body: plan_id + interval opcional ------------------
    let body: { plan_id?: string; interval?: string }
    try {
      body = await req.json()
    } catch {
      return errorResponse('invalid_body')
    }
    const planId = body.plan_id
    if (!planId) return errorResponse('plan_id_required')

    const interval: 'monthly' | 'yearly' =
      body.interval === 'yearly' ? 'yearly' : 'monthly'

    // --- 3. Busca plano (service_role bypassa RLS) -------------
    const db = serviceClient()
    const { data: plan, error: planErr } = await db
      .from('plans')
      .select(
        'id, code, name, description, price_cents, price_yearly_cents, active',
      )
      .eq('id', planId)
      .maybeSingle()
    if (planErr) {
      console.error('[create-subscription] db erro:', planErr)
      return errorResponse('db_error', 500)
    }
    if (!plan) return errorResponse('plan_not_found', 404)
    if (!plan.active) return errorResponse('plan_inactive', 400)
    if (plan.price_cents <= 0) return errorResponse('plan_is_free', 400)

    // Decide valor cobrado conforme o intervalo. 'yearly' só é
    // válido se o plano tem price_yearly_cents setado.
    let amountCents: number
    if (interval === 'yearly') {
      if (!plan.price_yearly_cents || plan.price_yearly_cents <= 0) {
        return errorResponse('yearly_not_offered', 400)
      }
      amountCents = plan.price_yearly_cents
    } else {
      amountCents = plan.price_cents
    }

    if (!Deno.env.get('MP_ACCESS_TOKEN')) {
      console.error('[create-subscription] MP_ACCESS_TOKEN não configurado')
      return errorResponse('mp_token_missing', 500)
    }

    // --- 4. Cria Preference no MP ------------------------------
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://localhost'
    // SUPABASE_URL é auto-populado em edge functions.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const notificationUrl = supabaseUrl
      ? `${supabaseUrl}/functions/v1/mercadopago-webhook`
      : undefined
    try {
      const preference = await createPreference({
        title: `${plan.name} ${interval === 'yearly' ? '(anual)' : ''} — Minha Agenda`.trim(),
        description: plan.description ?? undefined,
        amountCents,
        // user_id:plan_id:interval — webhook recupera os três sem
        // round-trip ao DB. `interval` é o 3º segmento, opcional em
        // webhooks de compras antigas (fallback 'monthly').
        externalReference: `${user.id}:${plan.id}:${interval}`,
        backUrlBase: `${siteUrl}/dashboard`,
        notificationUrl,
        payerEmail: user.email ?? undefined,
      })

      console.log(
        '[create-subscription] preference_id=',
        preference.id,
        'interval=',
        interval,
      )
      return jsonResponse({
        status: 'ok',
        init_point: preference.init_point,
        preference_id: preference.id,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[create-subscription] MP error:', msg)
      return errorResponse('mp_error', 502)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error('[create-subscription] UNCAUGHT:', msg, '\n', stack)
    return errorResponse(`uncaught:${msg}`, 500)
  }
})

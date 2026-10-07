// Varre assinaturas pagas vencendo em 3–7 dias e dispara um lembrete
// por email pra que o user renove manualmente (modelo Preference —
// 0023 — não cobra automaticamente).
//
// Invocada por cron (pg_cron + pg_net) uma vez por dia. Autenticação
// é via header `x-cron-secret` conferido contra o secret `CRON_SECRET`.
// Não aceita JWT — o chamador é o Postgres, não um usuário.
//
// Idempotência por ciclo:
//   - `renewal_reminder_sent_at` guarda o último envio.
//   - Se o timestamp cai dentro do ciclo atual (= depois de
//     `current_period_end - 1 month`), pulamos — já mandamos.
//   - Após renovar (webhook `activate_subscription_from_webhook`),
//     `current_period_end` avança e o filtro acima deixa de bater,
//     permitindo mandar o lembrete do PRÓXIMO vencimento quando chegar.

import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { sendEmail } from '../_shared/email.ts'

interface SubRow {
  id: string
  user_id: string
  current_period_end: string
  renewal_reminder_sent_at: string | null
  plans: { id: string; name: string; code: string; price_cents: number }
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 405)

    const provided = req.headers.get('x-cron-secret')
    const expected = Deno.env.get('CRON_SECRET')
    if (!expected || provided !== expected) {
      console.warn('[send-renewal-reminders] unauthorized')
      return errorResponse('unauthorized', 401)
    }

    const db = serviceClient()

    const now = new Date()
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const { data: subs, error } = await db
      .from('subscriptions')
      .select(
        'id, user_id, current_period_end, renewal_reminder_sent_at, plans!inner(id, name, code, price_cents)',
      )
      .eq('status', 'active')
      .eq('cancel_at_period_end', false)
      .gte('current_period_end', in3Days.toISOString())
      .lte('current_period_end', in7Days.toISOString())
      .gt('plans.price_cents', 0)
      .returns<SubRow[]>()

    if (error) {
      console.error('[send-renewal-reminders] db:', error)
      return errorResponse('db_error', 500)
    }

    const siteUrl = Deno.env.get('SITE_URL') ?? ''
    const renewUrl = `${siteUrl}/dashboard/configuracoes/assinatura`

    const results: Array<{
      user_id: string
      status: 'sent' | 'skipped' | 'error'
      reason?: string
    }> = []

    for (const sub of subs ?? []) {
      // Idempotência: já mandamos lembrete DENTRO deste ciclo?
      // O "ciclo" vai de (period_end - 1 mês) até period_end.
      if (sub.renewal_reminder_sent_at) {
        const sentAt = new Date(sub.renewal_reminder_sent_at)
        const cycleStart = new Date(sub.current_period_end)
        cycleStart.setMonth(cycleStart.getMonth() - 1)
        if (sentAt >= cycleStart) {
          results.push({ user_id: sub.user_id, status: 'skipped', reason: 'already_sent_this_cycle' })
          continue
        }
      }

      const { data: userData, error: userErr } =
        await db.auth.admin.getUserById(sub.user_id)
      if (userErr || !userData?.user?.email) {
        results.push({ user_id: sub.user_id, status: 'skipped', reason: 'no_email' })
        continue
      }
      const email = userData.user.email

      try {
        await sendEmail({
          to: email,
          subject: `Seu plano ${sub.plans.name} vence em breve · Minha Agenda`,
          html: renderRenewalEmail({
            planName: sub.plans.name,
            periodEnd: sub.current_period_end,
            renewUrl,
          }),
        })

        const { error: updErr } = await db
          .from('subscriptions')
          .update({ renewal_reminder_sent_at: new Date().toISOString() })
          .eq('id', sub.id)

        if (updErr) {
          console.error('[send-renewal-reminders] update:', updErr)
          results.push({ user_id: sub.user_id, status: 'error', reason: 'update_failed' })
          continue
        }

        results.push({ user_id: sub.user_id, status: 'sent' })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[send-renewal-reminders] send:', msg)
        results.push({ user_id: sub.user_id, status: 'error', reason: msg })
      }
    }

    const summary = {
      candidates: subs?.length ?? 0,
      sent: results.filter((r) => r.status === 'sent').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
    }
    console.log('[send-renewal-reminders] done:', summary)

    return jsonResponse({ status: 'ok', ...summary, results })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error('[send-renewal-reminders] UNCAUGHT:', msg, '\n', stack)
    return errorResponse(`uncaught:${msg}`, 500)
  }
})

function renderRenewalEmail(params: {
  planName: string
  periodEnd: string
  renewUrl: string
}): string {
  const d = new Date(params.periodEnd)
  const dateBR = Number.isNaN(d.getTime())
    ? params.periodEnd
    : new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(d)

  // HTML inline-styled — máxima compatibilidade com clientes de email.
  // Nada de CSS externo / @media complexos.
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seu plano vence em breve</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
        <tr><td style="padding:32px">
          <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#71717a;font-weight:600">Minha Agenda</div>
          <h1 style="font-size:22px;line-height:1.3;margin:16px 0 12px;color:#111;font-weight:600">
            Seu plano ${escapeHtml(params.planName)} vence em breve
          </h1>
          <p style="color:#3f3f46;line-height:1.6;font-size:15px;margin:0 0 20px">
            O período atual da sua assinatura termina em
            <strong style="color:#111">${escapeHtml(dateBR)}</strong>.
            Pra manter o acesso aos recursos do plano, é preciso renovar
            manualmente — a cobrança não é automática.
          </p>
          <table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">
            <tr><td style="background:#111;border-radius:999px">
              <a href="${escapeHtml(params.renewUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px">
                Renovar assinatura
              </a>
            </td></tr>
          </table>
          <p style="color:#71717a;font-size:13px;line-height:1.6;margin:0">
            Se preferir cancelar, acesse a mesma página e clique em
            "Cancelar assinatura" — nada é cobrado automaticamente.
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f4f4f5;color:#a1a1aa;font-size:11px;line-height:1.5">
          Você está recebendo este email porque tem uma assinatura ativa
          no Minha Agenda. Dúvidas? Responda este email.
        </td></tr>
      </table>
    </td></tr>
  </table>
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

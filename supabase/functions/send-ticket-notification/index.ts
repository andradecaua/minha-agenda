// Notificação de ticket por email.
//
// Chamada pelo frontend em fire-and-forget após:
//   - usuário criar um ticket     → event='created'    → envia pro suporte
//   - usuário responder no thread → event='user_reply' → envia pro suporte
//   - admin responder no thread   → event='admin_reply'→ envia pro usuário
//
// Autenticação: JWT do usuário no header Authorization. Se a sessão
// tem permissão de SELECT no ticket (via RLS), a leitura funciona —
// é a mesma política que a UI usa. Nenhum segredo além dos SMTP_*
// e do SUPPORT_EMAIL_TO (destinatário do suporte).
//
// Idempotência: não garantida. Em caso de falha de rede o frontend
// pode re-invocar; pior caso = dois emails do mesmo evento. Como
// email de suporte é humano, aceitável.

import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { serviceClient, userClient } from '../_shared/supabase.ts'
import { sendEmail } from '../_shared/email.ts'

type TicketEvent = 'created' | 'user_reply' | 'admin_reply'

interface Body {
  ticket_id?: string
  event?: TicketEvent
}

interface TicketRow {
  id: string
  user_id: string
  subject: string
  status: string
  priority: string
  sla_due_at: string
  created_at: string
}

interface MessageRow {
  id: string
  author_kind: 'user' | 'admin'
  body: string
  created_at: string
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 405)

    const auth = req.headers.get('Authorization')
    if (!auth) return errorResponse('unauthorized', 401)

    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      return errorResponse('invalid_body', 400)
    }

    const ticketId = body.ticket_id
    const event = body.event
    if (!ticketId || !event) return errorResponse('missing_params', 400)
    if (!['created', 'user_reply', 'admin_reply'].includes(event)) {
      return errorResponse('invalid_event', 400)
    }

    // Checagem de acesso via RLS do caller — se ele não enxerga o
    // ticket, não deveria estar disparando email sobre ele.
    const asUser = userClient(auth)
    const { data: visibleTicket, error: visibleErr } = await asUser
      .from('tickets')
      .select('id')
      .eq('id', ticketId)
      .maybeSingle()
    if (visibleErr || !visibleTicket) {
      return errorResponse('forbidden', 403)
    }

    // A partir daqui usamos service role pra montar o email (precisa
    // de auth.users.email, que o caller não vê). Já validamos acesso.
    const db = serviceClient()

    const { data: ticket, error: ticketErr } = await db
      .from('tickets')
      .select('id, user_id, subject, status, priority, sla_due_at, created_at')
      .eq('id', ticketId)
      .maybeSingle<TicketRow>()
    if (ticketErr || !ticket) {
      return errorResponse('ticket_not_found', 404)
    }

    const { data: lastMsg, error: msgErr } = await db
      .from('ticket_messages')
      .select('id, author_kind, body, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<MessageRow>()
    if (msgErr) {
      return errorResponse('msg_lookup_failed', 500)
    }

    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')
    const supportEmail = Deno.env.get('SUPPORT_EMAIL_TO')

    if (event === 'admin_reply') {
      // Notifica o dono do ticket.
      const { data: userData, error: userErr } =
        await db.auth.admin.getUserById(ticket.user_id)
      if (userErr || !userData?.user?.email) {
        return errorResponse('user_email_missing', 500)
      }
      await sendEmail({
        to: userData.user.email,
        subject: `Resposta do suporte · ${ticket.subject}`,
        html: renderAdminReplyEmail({
          subject: ticket.subject,
          body: lastMsg?.body ?? '',
          ticketUrl: `${siteUrl}/dashboard/suporte/${ticket.id}`,
        }),
      })
      return jsonResponse({ status: 'ok', sent_to: 'user' })
    }

    // 'created' | 'user_reply' → notifica o suporte.
    if (!supportEmail) {
      console.warn('[send-ticket-notification] SUPPORT_EMAIL_TO ausente — pulo envio')
      return jsonResponse({ status: 'skipped', reason: 'no_support_email' })
    }

    const { data: userData } = await db.auth.admin.getUserById(ticket.user_id)
    const userEmail = userData?.user?.email ?? '(sem email)'

    await sendEmail({
      to: supportEmail,
      subject:
        event === 'created'
          ? `[${ticket.priority === 'high' ? 'PRIORIDADE' : 'suporte'}] ${ticket.subject}`
          : `[Resposta usuário] ${ticket.subject}`,
      html: renderSupportEmail({
        event,
        subject: ticket.subject,
        body: lastMsg?.body ?? '',
        priority: ticket.priority,
        slaDueAt: ticket.sla_due_at,
        userEmail,
        adminUrl: `${siteUrl}/admin/tickets/${ticket.id}`,
      }),
    })

    return jsonResponse({ status: 'ok', sent_to: 'support' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error('[send-ticket-notification] UNCAUGHT:', msg, '\n', stack)
    return errorResponse(`uncaught:${msg}`, 500)
  }
})

function renderSupportEmail(params: {
  event: TicketEvent
  subject: string
  body: string
  priority: string
  slaDueAt: string
  userEmail: string
  adminUrl: string
}): string {
  const slaBR = formatDateBR(params.slaDueAt)
  const prioLabel = params.priority === 'high' ? 'Prioritário (plano pago)' : 'Normal (grátis)'
  const header =
    params.event === 'created' ? 'Novo ticket de suporte' : 'Nova resposta no ticket'

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
        <tr><td style="padding:28px 32px">
          <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#71717a;font-weight:600">Minha Agenda · Suporte</div>
          <h1 style="font-size:20px;line-height:1.3;margin:12px 0 6px;color:#111;font-weight:600">${escapeHtml(header)}</h1>
          <p style="color:#111;font-size:16px;line-height:1.5;margin:4px 0 16px"><strong>${escapeHtml(params.subject)}</strong></p>
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;font-size:13px;color:#52525b">
            <tr><td style="padding:2px 10px 2px 0;color:#71717a">De:</td><td>${escapeHtml(params.userEmail)}</td></tr>
            <tr><td style="padding:2px 10px 2px 0;color:#71717a">Prioridade:</td><td>${escapeHtml(prioLabel)}</td></tr>
            <tr><td style="padding:2px 10px 2px 0;color:#71717a">SLA até:</td><td>${escapeHtml(slaBR)}</td></tr>
          </table>
          <div style="border-left:3px solid #e4e4e7;padding:4px 14px;color:#27272a;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(params.body)}</div>
          <table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0">
            <tr><td style="background:#111;border-radius:999px">
              <a href="${escapeHtml(params.adminUrl)}" style="display:inline-block;padding:11px 20px;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px">
                Abrir no painel
              </a>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function renderAdminReplyEmail(params: {
  subject: string
  body: string
  ticketUrl: string
}): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
        <tr><td style="padding:28px 32px">
          <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#71717a;font-weight:600">Minha Agenda · Suporte</div>
          <h1 style="font-size:20px;line-height:1.3;margin:12px 0 6px;color:#111;font-weight:600">Nova resposta do suporte</h1>
          <p style="color:#111;font-size:16px;line-height:1.5;margin:4px 0 16px"><strong>${escapeHtml(params.subject)}</strong></p>
          <div style="border-left:3px solid #111;padding:4px 14px;color:#27272a;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(params.body)}</div>
          <table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0">
            <tr><td style="background:#111;border-radius:999px">
              <a href="${escapeHtml(params.ticketUrl)}" style="display:inline-block;padding:11px 20px;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px">
                Ver no app
              </a>
            </td></tr>
          </table>
          <p style="color:#71717a;font-size:12px;line-height:1.6;margin:18px 0 0">
            Pra responder, abra o ticket no app — a thread fica centralizada lá.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function formatDateBR(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

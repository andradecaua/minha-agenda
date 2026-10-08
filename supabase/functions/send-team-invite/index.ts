// Envio do email de convite de equipe.
//
// Fluxo:
//   1. Chamada pelo frontend após `create_team_invite()` da RPC.
//      Body: `{ invite_id: uuid }`.
//   2. Service role lê o invite + verifica que ainda está pending.
//   3. Checa se o email já tem auth.users:
//        - Não → cria via `auth.admin.createUser({email, email_confirm: true})`.
//          handle_new_user cria profile + solo team + free sub. OK.
//        - Sim → segue direto.
//   4. Monta link `${SITE_URL}/convite/<token>` e envia email SMTP.
//
// Autenticação: JWT do convidador. Confirma via `user_sessions` ou
// RLS? Mais simples: só confere que o invite existe (service role
// bypass RLS). O owner já valida tudo em `create_team_invite`.
//
// Idempotência: enviar duas vezes = user recebe dois emails. Melhor
// não bloquear — frontend decide se re-chama.

import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/supabase.ts'
import { sendEmail } from '../_shared/email.ts'

interface Body {
  invite_id?: string
}

interface InviteRow {
  id: string
  team_id: string
  email: string
  token: string
  status: string
  expires_at: string
  teams: { name: string } | null
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
    if (!body.invite_id) return errorResponse('missing_invite_id', 400)

    const db = serviceClient()

    const { data: invite, error: invErr } = await db
      .from('team_invites')
      .select('id, team_id, email, token, status, expires_at, teams(name)')
      .eq('id', body.invite_id)
      .maybeSingle<InviteRow>()
    if (invErr || !invite) {
      return errorResponse('invite_not_found', 404)
    }
    if (invite.status !== 'pending') {
      return errorResponse(`invite_${invite.status}`, 400)
    }

    // Pré-cria o auth.users se ainda não existe. getUserByEmail
    // existe em supabase-js v2.46+. Fallback: listUsers + filter.
    let userId: string | null = null
    try {
      const { data: existing } = await db.auth.admin.listUsers()
      const match = existing.users.find(
        (u) => (u.email ?? '').toLowerCase() === invite.email,
      )
      if (match) userId = match.id
    } catch (err) {
      console.warn('[send-team-invite] listUsers falhou:', err)
    }

    if (!userId) {
      const { data: created, error: createErr } = await db.auth.admin.createUser({
        email: invite.email,
        email_confirm: true,
      })
      if (createErr) {
        console.error('[send-team-invite] createUser:', createErr)
        return errorResponse('create_user_failed', 500)
      }
      userId = created.user?.id ?? null
      // handle_new_user dispara trigger criando profile + solo team + free sub.
    }

    const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/$/, '')
    const acceptUrl = `${siteUrl}/convite/${invite.token}`
    const teamName = invite.teams?.name ?? 'Equipe'

    await sendEmail({
      to: invite.email,
      subject: `Convite para a equipe ${teamName} · Minha Agenda`,
      html: renderInviteEmail({
        teamName,
        acceptUrl,
        expiresAt: invite.expires_at,
      }),
    })

    return jsonResponse({ status: 'ok', sent_to: invite.email })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error('[send-team-invite] UNCAUGHT:', msg, '\n', stack)
    return errorResponse(`uncaught:${msg}`, 500)
  }
})

function renderInviteEmail(params: {
  teamName: string
  acceptUrl: string
  expiresAt: string
}): string {
  const d = new Date(params.expiresAt)
  const expiresBR = Number.isNaN(d.getTime())
    ? params.expiresAt
    : new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }).format(d)
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
        <tr><td style="padding:32px">
          <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#71717a;font-weight:600">Minha Agenda</div>
          <h1 style="font-size:22px;line-height:1.3;margin:16px 0 12px;color:#111;font-weight:600">
            Convite para a equipe ${escapeHtml(params.teamName)}
          </h1>
          <p style="color:#3f3f46;line-height:1.6;font-size:15px;margin:0 0 20px">
            Você foi convidado(a) a entrar na equipe
            <strong style="color:#111">${escapeHtml(params.teamName)}</strong>
            no Minha Agenda. Pra aceitar, defina sua senha no link abaixo.
          </p>
          <table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">
            <tr><td style="background:#111;border-radius:999px">
              <a href="${escapeHtml(params.acceptUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px">
                Aceitar convite
              </a>
            </td></tr>
          </table>
          <p style="color:#71717a;font-size:13px;line-height:1.6;margin:0">
            O convite expira em <strong>${escapeHtml(expiresBR)}</strong>.
            Se não reconhece esse convite, ignore este email.
          </p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f4f4f5;color:#a1a1aa;font-size:11px;line-height:1.5">
          Minha Agenda · Agendamento online para profissionais autônomos
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

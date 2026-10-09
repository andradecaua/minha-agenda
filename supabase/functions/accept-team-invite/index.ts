// Aceite de convite de equipe.
//
// Fluxo:
//   1. Body: `{ token: uuid, password: string }`.
//   2. Service role resolve o invite via `resolve_team_invite(token)`.
//   3. Pega auth.users pelo email do invite.
//   4. Chama `auth.admin.updateUserById(id, { password })` pra setar
//      a senha. Esse user foi pré-criado via `send-team-invite`.
//   5. Chama `accept_team_invite_server(token, user_id)` que:
//      - valida tudo de novo (defesa em profundidade)
//      - apaga o solo team do user (se existir e for free)
//      - adiciona ao team invitado como member
//      - marca invite accepted
//   6. Retorna `{ status: 'ok', team_id, email }` — frontend faz
//      login do user com email + senha pra continuar.
//
// Autenticação: pública. O token do convite é o segredo. Qualquer
// um com o link válido consegue aceitar — exatamente como funciona
// link mágico padrão.

import { corsHeaders, errorResponse, jsonResponse } from '../_shared/cors.ts'
import { serviceClient } from '../_shared/supabase.ts'

interface Body {
  token?: string
  password?: string
  /**
   * Nome que o convidado quer usar no profile público. Obrigatório
   * desde v0.4.3 — antes o profile.name caía no fallback
   * `split_part(email, '@', 1)` (ex.: "joao.silva") e aparecia como
   * se fosse um email na página pública da equipe.
   */
  name?: string
}

/**
 * Slugifica no mesmo espírito do `public.slugify` do Postgres:
 * remove acentos, lowercase, troca não-alfanumérico por `-`, colapsa
 * `--` e tira hífens das pontas. Mantemos aqui pra evitar criar uma
 * nova RPC só pra isso.
 */
function slugify(input: string): string {
  return input
    .normalize('NFD')
    // U+0300–U+036F: faixa dos "combining diacritical marks" (acentos
    // soltos após o NFD). Esse é o truque pra tirar diacríticos sem
    // depender de lib externa.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 405)

    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      return errorResponse('invalid_body', 400)
    }

    const token = (body.token ?? '').trim()
    const password = (body.password ?? '').trim()
    const name = (body.name ?? '').trim()
    if (!token) return errorResponse('missing_token', 400)
    if (password.length < 6) return errorResponse('weak_password', 400)
    if (name.length < 2 || name.length > 60) {
      return errorResponse('invalid_name', 400)
    }

    const db = serviceClient()

    // Valida invite + pega email
    const { data: resolveData, error: resolveErr } = await db.rpc(
      'resolve_team_invite',
      { p_token: token },
    )
    if (resolveErr) {
      console.error('[accept-team-invite] resolve:', resolveErr)
      return errorResponse('db_error', 500)
    }
    const resolveResult = (resolveData ?? {}) as {
      status?: string
      error?: string
      email?: string
      team_id?: string
    }
    if (resolveResult.status !== 'ok' || !resolveResult.email) {
      return errorResponse(resolveResult.error ?? 'invalid_invite', 400)
    }
    const email = resolveResult.email

    // Encontra o user pelo email
    const { data: list, error: listErr } = await db.auth.admin.listUsers()
    if (listErr) {
      console.error('[accept-team-invite] listUsers:', listErr)
      return errorResponse('user_lookup_failed', 500)
    }
    const user = list.users.find(
      (u) => (u.email ?? '').toLowerCase() === email,
    )
    if (!user) return errorResponse('user_not_found', 404)

    // Seta a senha
    const { error: updateErr } = await db.auth.admin.updateUserById(user.id, {
      password,
    })
    if (updateErr) {
      console.error('[accept-team-invite] updatePassword:', updateErr)
      return errorResponse('set_password_failed', 500)
    }

    // Move pro team invitado
    const { data: acceptData, error: acceptErr } = await db.rpc(
      'accept_team_invite_server',
      { p_token: token, p_user_id: user.id },
    )
    if (acceptErr) {
      console.error('[accept-team-invite] acceptServer:', acceptErr)
      return errorResponse('accept_failed', 500)
    }
    const acceptResult = (acceptData ?? {}) as {
      status?: string
      error?: string
      team_id?: string
    }
    if (acceptResult.status !== 'ok') {
      return errorResponse(acceptResult.error ?? 'accept_rejected', 400)
    }

    // Atualiza profile.name e re-gera slug. Antes vinha o email_prefix
    // (via handle_new_user fallback) e isso vazava na página pública
    // da equipe como "joao.silva" com cara de email. Best-effort: se
    // falhar, o accept em si já deu certo — o member pode editar
    // depois em /dashboard/configuracoes/perfil.
    try {
      const baseSlug = slugify(name) || 'prof'
      let attempt = 0
      let newSlug = baseSlug
      while (attempt < 10) {
        const { error: updErr } = await db
          .from('profiles')
          .update({ name, slug: newSlug })
          .eq('user_id', user.id)
        if (!updErr) break
        const msg = (updErr.message ?? '').toLowerCase()
        const isUniqueViolation =
          msg.includes('duplicate key') ||
          msg.includes('unique') ||
          updErr.code === '23505'
        if (!isUniqueViolation) {
          console.warn('[accept-team-invite] profile update:', updErr.message)
          break
        }
        attempt += 1
        newSlug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`
      }
    } catch (profileErr) {
      console.warn('[accept-team-invite] profile update threw:', profileErr)
    }

    return jsonResponse({
      status: 'ok',
      team_id: acceptResult.team_id ?? resolveResult.team_id,
      email,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error('[accept-team-invite] UNCAUGHT:', msg, '\n', stack)
    return errorResponse(`uncaught:${msg}`, 500)
  }
})

-- =============================================================
-- 0035_team_invites.sql
-- -------------------------------------------------------------
-- Step 2d do refactor "plano por equipe": convites por email.
-- Owner do time digita email → sistema cria convite com token
-- único + a conta é PRÉ-CRIADA via admin API (edge function) com
-- email_confirmed = true e sem senha. Convidado recebe email com
-- link `/convite/<token>` que leva à página pra definir a senha e
-- entrar no time.
--
-- Fluxo:
--   1. Owner chama `create_team_invite(email)` (esta RPC).
--      - Checa capacidade do plano (`max_team_members`).
--      - Insere `team_invites` row com token UUID.
--      - Retorna `{invite_id, token}`.
--   2. Frontend chama edge function `send-team-invite(invite_id)`:
--      - Service role.
--      - Se o email ainda não é um auth.users, usa
--        `auth.admin.createUser({email, email_confirm: true})` —
--        trigger `handle_new_user` cria profile + solo team + sub
--        free. Isso é "waste" aceitável — some depois no accept.
--      - Envia email SMTP com link pra `/convite/<token>`.
--   3. Convidado abre `/convite/<token>` → página pede senha
--      (primeira vez) e confirma aceite. Chama edge function
--      `accept-team-invite(token, password)`:
--      - Service role.
--      - Valida token (pending + não expirado + email match).
--      - Seta senha via `auth.admin.updateUserById(id, {password})`.
--      - Se o convidado tem um solo team com free sub e sem outros
--        members, DELETA (cascade subscriptions + team_members).
--      - Insere team_members(invited_team, user_id, 'member').
--      - Marca invite como accepted.
--
-- Convite expira em 7 dias por default. `revoke_team_invite` deixa
-- o owner cancelar antes do aceite.
-- =============================================================

create table if not exists public.team_invites (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  email        text not null,
  token        uuid not null default gen_random_uuid(),
  invited_by   uuid references auth.users(id) on delete set null,
  status       text not null default 'pending'
                 check (status in ('pending','accepted','revoked','expired')),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  check (length(trim(email)) > 0)
);

create unique index if not exists team_invites_token_unique
  on public.team_invites (token);

-- Um convite pending por email dentro do mesmo team.
create unique index if not exists team_invites_pending_email_unique
  on public.team_invites (team_id, lower(email))
  where status = 'pending';

create index if not exists team_invites_team_idx on public.team_invites (team_id);
create index if not exists team_invites_email_idx on public.team_invites (lower(email));

comment on table public.team_invites is
  'Convites de membros pra teams. Owner cria; convidado aceita via /convite/<token>. Writes via SECURITY DEFINER RPCs.';

-- =============================================================
-- RLS
-- -------------------------------------------------------------
-- Owner lista os convites do próprio time (ver pendentes/cancelar).
-- Resolve e accept passam por SECURITY DEFINER / service role, não
-- precisam de policy adicional.
-- =============================================================
alter table public.team_invites enable row level security;

drop policy if exists "team_invites_owner_select" on public.team_invites;
create policy "team_invites_owner_select"
  on public.team_invites
  for select
  to authenticated
  using (public.is_team_owner(team_id));

grant select on public.team_invites to authenticated;

-- =============================================================
-- create_team_invite — owner cria convite
-- -------------------------------------------------------------
-- Checa capacidade do plano (max_team_members do team). Se null,
-- rejeita (plano individual não pode convidar).
-- =============================================================
drop function if exists public.create_team_invite(text);
create or replace function public.create_team_invite(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id    uuid;
  v_email      text := lower(trim(coalesce(p_email, '')));
  v_cap        int;
  v_current    int;
  v_pending    int;
  v_invite_id  uuid;
  v_token      uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('status','error','error','invalid_email');
  end if;

  select team_id into v_team_id from public.team_members where user_id = auth.uid();
  if v_team_id is null then
    return jsonb_build_object('status','error','error','no_team');
  end if;
  if not public.is_team_owner(v_team_id) then
    return jsonb_build_object('status','error','error','forbidden_not_owner');
  end if;

  -- Capacidade do plano
  select pl.max_team_members into v_cap
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.team_id = v_team_id
      and s.status in ('active','trialing')
      and (s.expires_at is null or s.expires_at > now())
      and pl.active = true
    limit 1;

  if v_cap is null or v_cap < 2 then
    return jsonb_build_object('status','error','error','plan_not_team');
  end if;

  select count(*) into v_current from public.team_members where team_id = v_team_id;
  select count(*) into v_pending  from public.team_invites
    where team_id = v_team_id and status = 'pending' and expires_at > now();

  if (v_current + v_pending) >= v_cap then
    return jsonb_build_object('status','error','error','capacity_full',
                              'cap', v_cap, 'current', v_current, 'pending', v_pending);
  end if;

  -- Email já pertence a um member do time? Convite redundante.
  if exists (
    select 1 from public.team_members tm
    join auth.users u on u.id = tm.user_id
    where tm.team_id = v_team_id and lower(u.email) = v_email
  ) then
    return jsonb_build_object('status','error','error','already_member');
  end if;

  -- Insert — unique parcial pending-por-email cuida de duplicata.
  begin
    insert into public.team_invites (team_id, email, invited_by)
      values (v_team_id, v_email, auth.uid())
      returning id, token into v_invite_id, v_token;
  exception when unique_violation then
    return jsonb_build_object('status','error','error','already_invited');
  end;

  return jsonb_build_object('status','ok',
                            'invite_id', v_invite_id,
                            'token',     v_token);
end;
$$;

grant execute on function public.create_team_invite(text) to authenticated;

-- =============================================================
-- resolve_team_invite — leitura PÚBLICA pelo token
-- -------------------------------------------------------------
-- Chamada da página `/convite/<token>` antes de aceitar. Retorna
-- status + nome do time + email convidado, sem exigir sessão.
-- Não retorna o invite inteiro — só o essencial.
-- =============================================================
drop function if exists public.resolve_team_invite(uuid);
create or replace function public.resolve_team_invite(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select ti.id, ti.email, ti.status, ti.expires_at, ti.team_id, t.name as team_name
    into v_row
    from public.team_invites ti
    join public.teams t on t.id = ti.team_id
    where ti.token = p_token;

  if not found then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  if v_row.status <> 'pending' then
    return jsonb_build_object('status','error','error', v_row.status);
  end if;
  if v_row.expires_at <= now() then
    return jsonb_build_object('status','error','error','expired');
  end if;

  return jsonb_build_object(
    'status','ok',
    'invite_id', v_row.id,
    'email',     v_row.email,
    'team_id',   v_row.team_id,
    'team_name', v_row.team_name,
    'expires_at', v_row.expires_at
  );
end;
$$;

grant execute on function public.resolve_team_invite(uuid) to anon, authenticated;

-- =============================================================
-- revoke_team_invite — owner cancela convite pendente
-- =============================================================
drop function if exists public.revoke_team_invite(uuid);
create or replace function public.revoke_team_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;

  select team_id into v_team_id from public.team_invites where id = p_invite_id;
  if v_team_id is null then
    return jsonb_build_object('status','error','error','not_found');
  end if;
  if not public.is_team_owner(v_team_id) then
    return jsonb_build_object('status','error','error','forbidden_not_owner');
  end if;

  update public.team_invites
    set status = 'revoked'
    where id = p_invite_id and status = 'pending';
  if not found then
    return jsonb_build_object('status','error','error','not_pending');
  end if;

  return jsonb_build_object('status','ok');
end;
$$;

grant execute on function public.revoke_team_invite(uuid) to authenticated;

-- =============================================================
-- accept_team_invite_server — chamada pela edge function
-- -------------------------------------------------------------
-- A edge function roda com service role e já setou a senha do user
-- via auth.admin.updateUserById. Aqui a gente só move o user pra
-- o team invitado, apagando o solo team dele se aplicável.
--
-- Idempotência: se o user já está no team invitado, retorna ok e
-- marca invite accepted mesmo assim.
-- =============================================================
drop function if exists public.accept_team_invite_server(uuid, uuid);
create or replace function public.accept_team_invite_server(
  p_token   uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_current_team uuid;
  v_current_role text;
  v_other_members int;
  v_plan_price int;
begin
  select ti.id, ti.team_id, ti.email, ti.status, ti.expires_at
    into v_inv
    from public.team_invites ti
    where ti.token = p_token
    for update;

  if not found then
    return jsonb_build_object('status','error','error','not_found');
  end if;
  if v_inv.status <> 'pending' then
    return jsonb_build_object('status','error','error', v_inv.status);
  end if;
  if v_inv.expires_at <= now() then
    update public.team_invites set status='expired' where id = v_inv.id;
    return jsonb_build_object('status','error','error','expired');
  end if;

  -- Email do user bate com o convite?
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and lower(u.email) = v_inv.email
  ) then
    return jsonb_build_object('status','error','error','email_mismatch');
  end if;

  -- Team atual do user
  select team_id, role into v_current_team, v_current_role
    from public.team_members where user_id = p_user_id;

  if v_current_team = v_inv.team_id then
    -- Já é member → só marca accepted.
    update public.team_invites
      set status='accepted', accepted_at=now(), accepted_by=p_user_id
      where id = v_inv.id;
    return jsonb_build_object('status','ok','already_in_team', true);
  end if;

  -- Se o user tem team atual, precisa ser SOLO (só ele) e sem plano pago.
  if v_current_team is not null then
    select count(*) into v_other_members
      from public.team_members
      where team_id = v_current_team and user_id <> p_user_id;
    select pl.price_cents into v_plan_price
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.team_id = v_current_team
      limit 1;

    if v_other_members > 0 then
      return jsonb_build_object('status','error','error','already_in_team');
    end if;
    if coalesce(v_plan_price, 0) > 0 then
      return jsonb_build_object('status','error','error','paid_plan_in_use');
    end if;

    -- Deleta o solo team (cascade: team_members, subscriptions).
    delete from public.teams where id = v_current_team;
  end if;

  -- Adiciona ao team invitado como member.
  insert into public.team_members (team_id, user_id, role)
    values (v_inv.team_id, p_user_id, 'member');

  update public.team_invites
    set status='accepted', accepted_at=now(), accepted_by=p_user_id
    where id = v_inv.id;

  return jsonb_build_object('status','ok','team_id', v_inv.team_id);
end;
$$;

-- Só service role chama. Edge function `accept-team-invite` orquestra.
revoke all on function public.accept_team_invite_server(uuid, uuid) from public, anon, authenticated;

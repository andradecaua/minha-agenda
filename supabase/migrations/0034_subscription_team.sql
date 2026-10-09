-- =============================================================
-- 0034_subscription_team.sql
-- -------------------------------------------------------------
-- Step 2c do refactor "plano por equipe" — o passo mais arriscado.
-- Move a subscription de user → team e faz quotas somarem a equipe
-- inteira.
--
-- Mudança central:
--   - `subscriptions.team_id` nova (unique). `user_id` continua
--     gravado como "owner at the time of subscription" pra
--     debug/auditoria, mas o lookup canônico passa a ser team_id.
--   - Todas as funções que consultavam `s.user_id = auth.uid()`
--     passam a usar `s.team_id = current_team_id()`.
--   - Quotas `max_services` e `max_appointments_per_month` passam
--     a ser SOMADAS entre todos os membros do time.
--   - `activate_subscription_from_webhook`, `cancel_my_subscription`
--     e `admin_set_user_plan` continuam recebendo user_id na
--     assinatura (pra não quebrar callers), mas resolvem o team
--     dentro.
--   - `ensure_free_subscription(user_id)` resolve o team do user e
--     cria subscription do team.
--   - `cancel_my_subscription` passa a exigir que o caller seja
--     OWNER do time (membro comum não cancela).
--
-- Compat:
--   - `subscriptions.user_id` NÃO é dropada. Fica como coluna
--     informativa (= owner_user_id efetivamente). Pode ficar
--     obsoleta no futuro, mas remover agora quebraria o cron de
--     renovação (`send-renewal-reminders`) sem necessidade.
--   - Admin set_user_plan continua recebendo user_id — resolve
--     team internamente.
-- =============================================================

-- =============================================================
-- 1) Coluna team_id em subscriptions + backfill + unique
-- =============================================================
alter table public.subscriptions
  add column if not exists team_id uuid references public.teams(id) on delete cascade;

update public.subscriptions s
   set team_id = tm.team_id
  from public.team_members tm
 where tm.user_id = s.user_id
   and s.team_id is null;

-- Cobertura dos eventuais sem team (shouldn't happen depois do
-- backfill 0032, mas defensivo): deleta subscription órfã.
delete from public.subscriptions where team_id is null;

alter table public.subscriptions
  alter column team_id set not null;

-- Troca unique: antes era user_id, agora é team_id.
alter table public.subscriptions drop constraint if exists subscriptions_user_id_key;
create unique index if not exists subscriptions_team_id_key on public.subscriptions (team_id);

create index if not exists subscriptions_team_id_idx on public.subscriptions (team_id);

comment on column public.subscriptions.team_id is
  'Equipe assinante. Chave canônica de lookup. Unique: cada team tem no máximo 1 subscription.';
comment on column public.subscriptions.user_id is
  'Owner do time no momento da assinatura (compat). Fonte da verdade pra "quem é owner agora" é teams.owner_user_id.';

-- =============================================================
-- 2) RLS de subscriptions — ajustado pra team
-- -------------------------------------------------------------
-- Antes: `subscriptions_self_select` liberava quando user_id =
-- auth.uid(). Agora qualquer MEMBRO do team enxerga a subscription
-- do time (owner precisa ver pra renovar; member precisa ver pra
-- entender quais features tem).
-- =============================================================
drop policy if exists "subscriptions_self_select" on public.subscriptions;
drop policy if exists "subscriptions_team_select" on public.subscriptions;

create policy "subscriptions_team_select"
  on public.subscriptions
  for select
  to authenticated
  using (team_id = public.current_team_id());

-- subscriptions_admin_all policy de 0018 continua valendo (admin AAL2).

-- =============================================================
-- 3) has_feature / my_permissions / my_plan / my_subscription_detail
--    → via current_team_id
-- =============================================================
-- has_feature(text) retém a mesma assinatura (returns boolean) desde
-- 0019, então create or replace basta — drop quebraria 6 policies
-- (products_owner_* / portfolio_team_*) que dependem da função.
create or replace function public.has_feature(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.team_id = public.current_team_id()
      and s.status in ('active','trialing')
      and (s.expires_at is null or s.expires_at > now())
      and pl.active = true
      and p_code = any (pl.permissions)
  );
$$;

grant execute on function public.has_feature(text) to authenticated;

drop function if exists public.my_permissions();
create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select pl.permissions
     from public.subscriptions s
     join public.plans pl on pl.id = s.plan_id
     where s.team_id = public.current_team_id()
       and s.status in ('active','trialing')
       and (s.expires_at is null or s.expires_at > now())
       and pl.active = true
     limit 1),
    '{}'::text[]
  );
$$;

grant execute on function public.my_permissions() to authenticated;

drop function if exists public.my_plan();
create or replace function public.my_plan()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select to_jsonb(x) from (
      select
        pl.id                         as plan_id,
        pl.code                       as plan_code,
        pl.name                       as plan_name,
        pl.permissions                as permissions,
        pl.max_services               as max_services,
        pl.max_appointments_per_month as max_appointments_per_month,
        pl.max_team_members           as max_team_members,
        pl.price_cents                as plan_price_cents,
        pl.price_yearly_cents         as plan_price_yearly_cents,
        s.status                      as subscription_status,
        s.expires_at                  as expires_at,
        s.cancel_at_period_end        as cancel_at_period_end,
        s.current_interval            as current_interval
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.team_id = public.current_team_id()
      limit 1
    ) x),
    jsonb_build_object(
      'plan_id', null, 'plan_code', null, 'plan_name', null,
      'permissions', '[]'::jsonb,
      'max_services', null, 'max_appointments_per_month', null,
      'max_team_members', null,
      'plan_price_cents', null, 'plan_price_yearly_cents', null,
      'subscription_status', null, 'expires_at', null,
      'cancel_at_period_end', null, 'current_interval', null
    )
  );
$$;

grant execute on function public.my_plan() to authenticated;

drop function if exists public.my_subscription_detail();
create or replace function public.my_subscription_detail()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select to_jsonb(x) from (
      select
        s.id                        as subscription_id,
        s.status                    as subscription_status,
        s.gateway                   as gateway,
        s.gateway_subscription_id   as gateway_subscription_id,
        s.current_period_end        as current_period_end,
        s.last_payment_at           as last_payment_at,
        s.cancel_at_period_end      as cancel_at_period_end,
        s.expires_at                as expires_at,
        s.renewal_reminder_sent_at  as renewal_reminder_sent_at,
        pl.id                       as plan_id,
        pl.code                     as plan_code,
        pl.name                     as plan_name,
        pl.price_cents              as plan_price_cents,
        pl.billing_interval         as plan_billing_interval
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.team_id = public.current_team_id()
      limit 1
    ) x),
    jsonb_build_object(
      'subscription_id', null,
      'subscription_status', null,
      'plan_id', null,
      'plan_code', null,
      'plan_name', null
    )
  );
$$;

grant execute on function public.my_subscription_detail() to authenticated;

-- =============================================================
-- 4) my_usage: soma a equipe inteira
-- -------------------------------------------------------------
-- Antes: contava services/appointments do profile.id do caller.
-- Agora: resolve TODOS os profiles do mesmo team e soma. Quotas
-- vêm do plano do team.
-- =============================================================
drop function if exists public.my_usage();
create or replace function public.my_usage()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with team as (
    select public.current_team_id() as team_id
  ),
  team_profiles as (
    select p.id as profile_id
      from public.profiles p
      join public.team_members tm on tm.user_id = p.user_id
      where tm.team_id = (select team_id from team)
  ),
  plan as (
    select pl.max_services, pl.max_appointments_per_month
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.team_id = (select team_id from team)
        and s.status in ('active','trialing')
        and (s.expires_at is null or s.expires_at > now())
        and pl.active = true
      limit 1
  )
  select jsonb_build_object(
    'services_count',
      coalesce((select count(*) from public.services
                where professional_id in (select profile_id from team_profiles)), 0),
    'max_services',
      (select max_services from plan),
    'appointments_this_month',
      coalesce((select count(*) from public.appointments
                where professional_id in (select profile_id from team_profiles)
                  and created_at >= date_trunc('month', now())
                  and status != 'cancelled'), 0),
    'max_appointments_per_month',
      (select max_appointments_per_month from plan)
  );
$$;

grant execute on function public.my_usage() to authenticated;

-- =============================================================
-- 5) Triggers de quota: contagem agregada por team
-- -------------------------------------------------------------
-- Antes: só contava rows do próprio professional_id. Agora: soma
-- de TODOS os profiles do mesmo team. Isso significa que um team
-- com 5 profissionais compartilha o mesmo pote de max_services /
-- max_appointments_per_month definido no plano.
-- =============================================================
create or replace function public.enforce_services_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_max     int;
  v_count   int;
begin
  select tm.team_id into v_team_id
    from public.profiles p
    join public.team_members tm on tm.user_id = p.user_id
    where p.id = new.professional_id
    limit 1;

  if v_team_id is null then
    return new;  -- sem team? deixa passar; FK pega integridade antes.
  end if;

  select pl.max_services into v_max
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.team_id = v_team_id
      and s.status in ('active','trialing')
      and (s.expires_at is null or s.expires_at > now())
      and pl.active = true
    limit 1;

  if v_max is null then
    return new;  -- sem limite
  end if;

  select count(*) into v_count
    from public.services sv
    join public.profiles p on p.id = sv.professional_id
    join public.team_members tm on tm.user_id = p.user_id
    where tm.team_id = v_team_id;

  if v_count >= v_max then
    raise exception 'quota_services: max % services na equipe', v_max
      using errcode = 'P0100';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_appointments_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_max     int;
  v_count   int;
begin
  select tm.team_id into v_team_id
    from public.profiles p
    join public.team_members tm on tm.user_id = p.user_id
    where p.id = new.professional_id
    limit 1;

  if v_team_id is null then
    return new;
  end if;

  select pl.max_appointments_per_month into v_max
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.team_id = v_team_id
      and s.status in ('active','trialing')
      and (s.expires_at is null or s.expires_at > now())
      and pl.active = true
    limit 1;

  if v_max is null then
    return new;
  end if;

  select count(*) into v_count
    from public.appointments a
    join public.profiles p on p.id = a.professional_id
    join public.team_members tm on tm.user_id = p.user_id
    where tm.team_id = v_team_id
      and a.created_at >= date_trunc('month', now())
      and a.status != 'cancelled';

  if v_count >= v_max then
    raise exception 'quota_appointments: max % per month na equipe', v_max
      using errcode = 'P0100';
  end if;

  return new;
end;
$$;

-- (triggers já existentes de 0020 continuam disparando as funções
--  acima redefinidas — não precisam ser recriados.)

-- =============================================================
-- 6) ensure_free_subscription: cria sub do team do user
-- -------------------------------------------------------------
-- Assume que o user já tem team (handle_new_user chama
-- provision_team_for_user antes de ensure_free_subscription).
-- =============================================================
drop function if exists public.ensure_free_subscription(uuid);
create or replace function public.ensure_free_subscription(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_team_id uuid;
begin
  select id into v_plan_id
    from public.plans
    where code = 'free' and active = true
    limit 1;
  if v_plan_id is null then
    return;  -- sem plano free configurado, nada a fazer.
  end if;

  select team_id into v_team_id
    from public.team_members
    where user_id = p_user_id;
  if v_team_id is null then
    return;  -- user sem team? ignora (handle_new_user chamou na ordem errada).
  end if;

  insert into public.subscriptions (user_id, plan_id, status, team_id)
    values (p_user_id, v_plan_id, 'active', v_team_id)
    on conflict (team_id) do nothing;
end;
$$;

grant execute on function public.ensure_free_subscription(uuid) to authenticated;

-- =============================================================
-- 7) cancel_my_subscription: só OWNER do team pode cancelar
-- =============================================================
drop function if exists public.cancel_my_subscription();
create or replace function public.cancel_my_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id    uuid;
  v_rows       int;
  v_period_end timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;

  select team_id into v_team_id from public.team_members where user_id = auth.uid();
  if v_team_id is null then
    return jsonb_build_object('status','error','error','no_team');
  end if;
  if not public.is_team_owner(v_team_id) then
    return jsonb_build_object('status','error','error','forbidden_not_owner');
  end if;

  update public.subscriptions s
    set cancel_at_period_end = true,
        updated_at = now()
    where s.team_id = v_team_id
      and s.status in ('active','trialing','past_due')
      and exists (
        select 1 from public.plans p
        where p.id = s.plan_id and p.price_cents > 0
      )
    returning s.current_period_end into v_period_end;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status','error','error','nothing_to_cancel');
  end if;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (
      auth.uid(),
      'user_cancel_subscription',
      'subscriptions',
      v_team_id::text,
      jsonb_build_object('team_id', v_team_id, 'current_period_end', v_period_end)
    );

  return jsonb_build_object(
    'status','ok',
    'current_period_end', v_period_end
  );
end;
$$;

grant execute on function public.cancel_my_subscription() to authenticated;

-- =============================================================
-- 8) activate_subscription_from_webhook: resolve team do user
-- -------------------------------------------------------------
-- Assinatura mantida (p_user_id continua chegando do MP, é a
-- forma mais fácil pro webhook identificar). Internamente resolve
-- team_id e grava com unique por team.
-- =============================================================
drop function if exists public.activate_subscription_from_webhook(uuid, uuid, text, text, timestamptz, timestamptz, text);
create or replace function public.activate_subscription_from_webhook(
  p_user_id             uuid,
  p_plan_id             uuid,
  p_gateway             text,
  p_subscription_id     text,
  p_current_period_end  timestamptz,
  p_last_payment_at     timestamptz,
  p_interval            text default 'monthly'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if p_interval not in ('monthly','yearly') then
    return jsonb_build_object('status','error','error','invalid_interval');
  end if;

  select team_id into v_team_id from public.team_members where user_id = p_user_id;
  if v_team_id is null then
    return jsonb_build_object('status','error','error','no_team');
  end if;

  insert into public.subscriptions
    (user_id, team_id, plan_id, status, gateway, gateway_subscription_id,
     current_period_end, last_payment_at, cancel_at_period_end,
     expires_at, started_at, current_interval)
  values
    (p_user_id, v_team_id, p_plan_id, 'active', p_gateway, p_subscription_id,
     p_current_period_end, p_last_payment_at, false,
     p_current_period_end, now(), p_interval)
  on conflict (team_id) do update
    set user_id                 = excluded.user_id,
        plan_id                 = excluded.plan_id,
        status                  = 'active',
        gateway                 = excluded.gateway,
        gateway_subscription_id = excluded.gateway_subscription_id,
        current_period_end      = excluded.current_period_end,
        last_payment_at         = excluded.last_payment_at,
        cancel_at_period_end    = false,
        expires_at              = excluded.current_period_end,
        current_interval        = excluded.current_interval,
        updated_at              = now();

  return jsonb_build_object('status','ok');
end;
$$;

-- Mesmo grant que antes — só service_role (edge do webhook).
revoke all on function public.activate_subscription_from_webhook(uuid, uuid, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;

-- =============================================================
-- 9) admin_set_user_plan: resolve team e grava por team
-- -------------------------------------------------------------
-- Admin continua selecionando USER no painel; a atribuição afeta
-- o TEAM todo do user (plano é team-scoped agora).
-- =============================================================
drop function if exists public.admin_set_user_plan(uuid, uuid, timestamptz, text);
create or replace function public.admin_set_user_plan(
  p_user_id    uuid,
  p_plan_id    uuid,
  p_expires_at timestamptz default null,
  p_status     text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  if not exists (select 1 from public.plans where id = p_plan_id) then
    return jsonb_build_object('status','error','error','plan_not_found');
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('status','error','error','user_not_found');
  end if;
  if coalesce(p_status, 'active') not in ('active','past_due','cancelled','trialing') then
    return jsonb_build_object('status','error','error','invalid_status');
  end if;

  select team_id into v_team_id from public.team_members where user_id = p_user_id;
  if v_team_id is null then
    return jsonb_build_object('status','error','error','user_no_team');
  end if;

  insert into public.subscriptions (user_id, team_id, plan_id, status, started_at, expires_at)
    values (p_user_id, v_team_id, p_plan_id, coalesce(p_status, 'active'), now(), p_expires_at)
  on conflict (team_id) do update
    set user_id    = excluded.user_id,
        plan_id    = excluded.plan_id,
        status     = excluded.status,
        started_at = now(),
        expires_at = excluded.expires_at,
        updated_at = now();

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'set_user_plan', 'subscriptions', v_team_id::text,
            jsonb_build_object('team_id', v_team_id, 'target_user_id', p_user_id,
                               'plan_id', p_plan_id, 'expires_at', p_expires_at, 'status', p_status));

  return jsonb_build_object('status','ok');
end;
$$;

grant execute on function public.admin_set_user_plan(uuid, uuid, timestamptz, text) to authenticated;

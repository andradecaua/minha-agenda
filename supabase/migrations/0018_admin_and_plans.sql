-- =============================================================
-- 0018_admin_and_plans.sql
-- -------------------------------------------------------------
-- Área administrativa + planos de assinatura + auditoria.
--
-- Princípios de segurança (todos ENFORCADOS no banco):
--
--  1. Separação clara entre "é admin" e "sessão de admin elevada":
--     - public.am_i_admin_user() → user_id está em admin_users.
--     - public.is_admin()        → am_i_admin_user() E a sessão
--       está em AAL2 (segunda etapa de autenticação verificada
--       — Supabase TOTP MFA). O JWT do Supabase carrega
--       `aal`: 'aal1' ou 'aal2'.
--
--  2. Toda RPC administrativa (SECURITY DEFINER) começa com
--     `if not public.is_admin() then return 'forbidden'`.
--     Mesmo que algum RLS tenha brecha, a RPC rejeita.
--
--  3. RLS das tabelas admin_* exige `is_admin()` para qualquer
--     operação (inclusive SELECT na admin_users), com uma
--     exceção controlada: o próprio usuário pode ver sua linha
--     em admin_users (para o frontend saber "sou admin?" sem já
--     ter elevado para AAL2 — detalhe sutil mas necessário).
--
--  4. Toda ação admin grava em admin_audit_log.
--
--  5. Nenhum GRANT para `anon` (exceto SELECT em plans ativos,
--     que é informação pública — página de preços).
--
-- Como promover o primeiro admin (bootstrap):
--     Via SQL Editor do Supabase, logado como service_role:
--       insert into public.admin_users (user_id)
--       values ('<uuid-do-usuario>');
--     Depois o próprio admin pode promover outros pela UI.
-- =============================================================

-- =============================================================
-- 1) Tabela admin_users
-- =============================================================
create table if not exists public.admin_users (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid null references auth.users(id) on delete set null
);

create index if not exists admin_users_user_id_idx on public.admin_users (user_id);

-- =============================================================
-- 2) Tabela plans (catálogo de planos)
-- =============================================================
create table if not exists public.plans (
  id                          uuid primary key default gen_random_uuid(),
  code                        text not null unique,
  name                        text not null,
  description                 text,
  price_cents                 integer not null check (price_cents >= 0),
  billing_interval            text not null default 'monthly'
                                check (billing_interval in ('monthly','yearly','lifetime')),
  features                    jsonb not null default '[]'::jsonb,
  max_services                integer,
  max_appointments_per_month  integer,
  active                      boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

drop trigger if exists plans_updated_at on public.plans;
create trigger plans_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

create index if not exists plans_active_idx on public.plans (active);

-- =============================================================
-- 3) Tabela subscriptions (1:1 user → plan)
-- =============================================================
create table if not exists public.subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  plan_id     uuid not null references public.plans(id) on delete restrict,
  status      text not null default 'active'
                check (status in ('active','past_due','cancelled','trialing')),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index if not exists subscriptions_plan_id_idx on public.subscriptions (plan_id);

-- =============================================================
-- 4) Tabela admin_audit_log (trilha de auditoria)
-- =============================================================
create table if not exists public.admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid references auth.users(id) on delete set null,
  action        text not null,
  target_type   text,
  target_id     text,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_admin_user_idx
  on public.admin_audit_log (admin_user_id);

-- =============================================================
-- 5) Funções de verificação de admin
-- =============================================================

-- Verifica apenas se o usuário está na lista de admins (sem AAL2).
-- Usada apenas para o frontend decidir "mostrar menu admin?" e para
-- a RLS self-select de admin_users.
drop function if exists public.am_i_admin_user();
create or replace function public.am_i_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
  );
$$;

-- Verifica admin COM sessão elevada (AAL2 — MFA verificada na sessão).
-- Esta é a função usada em TODA RLS e RPC administrativa.
drop function if exists public.is_admin();
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
    and exists (
      select 1 from public.admin_users
      where user_id = auth.uid()
    );
$$;

-- RPC que combina as duas checagens e devolve o AAL. O frontend
-- usa para decidir: liberar / forçar enroll / forçar challenge.
drop function if exists public.admin_session_status();
create or replace function public.admin_session_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'is_admin_user', public.am_i_admin_user(),
    'is_elevated',   public.is_admin(),
    'aal',           coalesce(auth.jwt() ->> 'aal', 'aal1')
  );
$$;

-- =============================================================
-- 6) RLS nas tabelas admin_*
-- =============================================================
alter table public.admin_users      enable row level security;
alter table public.plans            enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.admin_audit_log  enable row level security;

-- admin_users ---------------------------------------------------
drop policy if exists "admin_users_self_select"  on public.admin_users;
drop policy if exists "admin_users_admin_all"    on public.admin_users;

-- O próprio usuário pode checar se consta como admin (para o guard
-- do frontend decidir sem precisar já estar em AAL2).
create policy "admin_users_self_select"
  on public.admin_users
  for select
  to authenticated
  using (user_id = auth.uid());

-- Admin elevado (AAL2) faz CRUD em admin_users.
create policy "admin_users_admin_all"
  on public.admin_users
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- plans --------------------------------------------------------
drop policy if exists "plans_public_select"  on public.plans;
drop policy if exists "plans_admin_all"      on public.plans;

-- Planos ativos são informação pública (página de preços).
create policy "plans_public_select"
  on public.plans
  for select
  to anon, authenticated
  using (active = true);

create policy "plans_admin_all"
  on public.plans
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- subscriptions ------------------------------------------------
drop policy if exists "subscriptions_self_select" on public.subscriptions;
drop policy if exists "subscriptions_admin_all"   on public.subscriptions;

-- O próprio usuário vê a assinatura dele.
create policy "subscriptions_self_select"
  on public.subscriptions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "subscriptions_admin_all"
  on public.subscriptions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- admin_audit_log ----------------------------------------------
drop policy if exists "admin_audit_log_admin_select" on public.admin_audit_log;

-- Apenas admin elevado lê. INSERT acontece via SECURITY DEFINER.
create policy "admin_audit_log_admin_select"
  on public.admin_audit_log
  for select
  to authenticated
  using (public.is_admin());

-- =============================================================
-- 7) GRANTs
-- =============================================================
grant usage on schema public to anon, authenticated;

grant select on public.plans to anon;
grant select on public.plans, public.subscriptions, public.admin_users, public.admin_audit_log
  to authenticated;

grant insert, update, delete on
  public.plans, public.subscriptions, public.admin_users
  to authenticated;

grant execute on function public.am_i_admin_user()      to authenticated;
grant execute on function public.is_admin()             to authenticated;
grant execute on function public.admin_session_status() to authenticated;

-- =============================================================
-- 8) RPCs administrativas (SECURITY DEFINER)
--    Toda função checa `public.is_admin()` no topo. "forbidden"
--    é devolvido com `status=error` para o frontend tratar.
-- =============================================================

-- Overview de métricas da plataforma inteira --------------------
drop function if exists public.admin_metrics_overview();
create or replace function public.admin_metrics_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  return jsonb_build_object(
    'status','ok',
    'users_total',                 (select count(*) from public.profiles),
    'users_new_30d',               (select count(*) from public.profiles where created_at >= now() - interval '30 days'),
    'users_new_7d',                (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'appointments_total',          (select count(*) from public.appointments),
    'appointments_30d',            (select count(*) from public.appointments where created_at >= now() - interval '30 days'),
    'appointments_completed_30d',  (select count(*) from public.appointments
                                      where status='completed' and start_at >= now() - interval '30 days'),
    'appointments_cancelled_30d',  (select count(*) from public.appointments
                                      where status='cancelled' and created_at >= now() - interval '30 days'),
    'revenue_completed_30d_cents', (select coalesce(sum(total_price_cents),0) from public.appointments
                                      where status='completed' and start_at >= now() - interval '30 days'),
    'clients_total',               (select count(*) from public.clients),
    'active_subscriptions',        (select count(*) from public.subscriptions where status='active'),
    'plans_active',                (select count(*) from public.plans where active=true),
    'admin_count',                 (select count(*) from public.admin_users),
    'generated_at',                now()
  );
end;
$$;

-- Listagem paginada e com busca de usuários/profissionais -------
drop function if exists public.admin_list_users(text, int, int);
create or replace function public.admin_list_users(
  p_search text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_limit  int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_total  int;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  select count(*) into v_total
  from public.profiles p
  left join auth.users u on u.id = p.user_id
  where v_search is null
     or p.name ilike '%' || v_search || '%'
     or p.slug ilike '%' || v_search || '%'
     or coalesce(u.email, '') ilike '%' || v_search || '%';

  select jsonb_build_object(
    'status','ok',
    'total', v_total,
    'users', coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb)
  )
  into v_result
  from (
    select
      p.id                 as profile_id,
      p.user_id,
      p.name,
      p.slug,
      p.city,
      p.phone,
      p.avatar_url,
      p.created_at,
      u.email,
      u.last_sign_in_at,
      u.email_confirmed_at,
      exists(select 1 from public.admin_users a where a.user_id = p.user_id)        as is_admin,
      (select pl.code from public.subscriptions s
         join public.plans pl on pl.id = s.plan_id
         where s.user_id = p.user_id limit 1)                                       as plan_code,
      (select pl.name from public.subscriptions s
         join public.plans pl on pl.id = s.plan_id
         where s.user_id = p.user_id limit 1)                                       as plan_name,
      (select count(*) from public.appointments a where a.professional_id = p.id)   as appointments_count,
      (select count(*) from public.clients c where c.professional_id = p.id)        as clients_count
    from public.profiles p
    left join auth.users u on u.id = p.user_id
    where v_search is null
       or p.name ilike '%' || v_search || '%'
       or p.slug ilike '%' || v_search || '%'
       or coalesce(u.email, '') ilike '%' || v_search || '%'
    order by p.created_at desc
    limit v_limit offset v_offset
  ) x;

  insert into public.admin_audit_log (admin_user_id, action, target_type, metadata)
    values (auth.uid(), 'list_users', 'profiles',
            jsonb_build_object('search', v_search, 'limit', v_limit, 'offset', v_offset));

  return v_result;
end;
$$;

-- Relatório individual de um usuário ---------------------------
drop function if exists public.admin_user_report(uuid);
create or replace function public.admin_user_report(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_result     jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  select id into v_profile_id from public.profiles where user_id = p_user_id;
  if v_profile_id is null then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  select jsonb_build_object(
    'status','ok',
    'profile',
      (select to_jsonb(p) from public.profiles p where p.id = v_profile_id),
    'auth',
      (select jsonb_build_object(
        'email', u.email,
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'email_confirmed_at', u.email_confirmed_at
      ) from auth.users u where u.id = p_user_id),
    'is_admin',
      exists(select 1 from public.admin_users where user_id = p_user_id),
    'subscription',
      (select to_jsonb(s) from public.subscriptions s where s.user_id = p_user_id),
    'plan',
      (select to_jsonb(pl) from public.plans pl
         where pl.id = (select plan_id from public.subscriptions where user_id = p_user_id)),
    'metrics', jsonb_build_object(
      'appointments_total',      (select count(*) from public.appointments where professional_id = v_profile_id),
      'appointments_completed',  (select count(*) from public.appointments where professional_id = v_profile_id and status='completed'),
      'appointments_cancelled',  (select count(*) from public.appointments where professional_id = v_profile_id and status='cancelled'),
      'appointments_pending',    (select count(*) from public.appointments where professional_id = v_profile_id and status='pending'),
      'revenue_total_cents',     (select coalesce(sum(total_price_cents),0) from public.appointments
                                    where professional_id = v_profile_id and status='completed'),
      'revenue_30d_cents',       (select coalesce(sum(total_price_cents),0) from public.appointments
                                    where professional_id = v_profile_id and status='completed'
                                      and start_at >= now() - interval '30 days'),
      'clients_total',           (select count(*) from public.clients where professional_id = v_profile_id),
      'services_active',         (select count(*) from public.services where professional_id = v_profile_id and active=true),
      'products_active',         (select count(*) from public.products where professional_id = v_profile_id and active=true),
      'portfolio_items',         (select count(*) from public.portfolio_items where professional_id = v_profile_id)
    )
  ) into v_result;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id)
    values (auth.uid(), 'view_user_report', 'profiles', p_user_id::text);

  return v_result;
end;
$$;

-- Atualizar perfil de um usuário (visão admin) ------------------
drop function if exists public.admin_update_user_profile(uuid, text, text, text, text, text);
create or replace function public.admin_update_user_profile(
  p_user_id uuid,
  p_name    text default null,
  p_slug    text default null,
  p_city    text default null,
  p_phone   text default null,
  p_bio     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone_clean text;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  v_phone_clean := case
    when p_phone is null then null
    else nullif(regexp_replace(p_phone, '[^0-9]', '', 'g'), '')
  end;

  update public.profiles
    set name  = coalesce(nullif(trim(p_name), ''), name),
        slug  = coalesce(nullif(trim(lower(p_slug)), ''), slug),
        city  = case when p_city is null then city else nullif(trim(p_city), '') end,
        phone = case when p_phone is null then phone else v_phone_clean end,
        bio   = case when p_bio is null then bio else nullif(trim(p_bio), '') end
    where user_id = p_user_id;

  if not found then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'update_user_profile', 'profiles', p_user_id::text,
            jsonb_build_object('name', p_name, 'slug', p_slug, 'city', p_city));

  return jsonb_build_object('status','ok');
exception when unique_violation then
  return jsonb_build_object('status','error','error','slug_taken');
end;
$$;

-- Toggle "é admin" para outro usuário --------------------------
drop function if exists public.admin_set_admin_flag(uuid, boolean);
create or replace function public.admin_set_admin_flag(
  p_user_id uuid,
  p_is_admin boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  if p_user_id = auth.uid() and p_is_admin = false then
    return jsonb_build_object('status','error','error','cannot_self_demote');
  end if;

  if p_is_admin then
    insert into public.admin_users (user_id, created_by)
      values (p_user_id, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from public.admin_users where user_id = p_user_id;
  end if;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'set_admin_flag', 'admin_users', p_user_id::text,
            jsonb_build_object('is_admin', p_is_admin));

  return jsonb_build_object('status','ok');
end;
$$;

-- CRUD de planos ------------------------------------------------
drop function if exists public.admin_create_plan(text, text, text, int, text, jsonb, int, int, boolean);
create or replace function public.admin_create_plan(
  p_code                        text,
  p_name                        text,
  p_description                 text,
  p_price_cents                 int,
  p_billing_interval            text,
  p_features                    jsonb,
  p_max_services                int,
  p_max_appointments_per_month  int,
  p_active                      boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.plans%rowtype;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('status','error','error','invalid_input');
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    return jsonb_build_object('status','error','error','invalid_price');
  end if;

  insert into public.plans
    (code, name, description, price_cents, billing_interval, features,
     max_services, max_appointments_per_month, active)
    values
    (lower(trim(p_code)), trim(p_name), nullif(trim(p_description), ''),
     p_price_cents, coalesce(p_billing_interval, 'monthly'),
     coalesce(p_features, '[]'::jsonb),
     p_max_services, p_max_appointments_per_month, coalesce(p_active, true))
    returning * into v_plan;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'create_plan', 'plans', v_plan.id::text, to_jsonb(v_plan));

  return jsonb_build_object('status','ok','plan_id', v_plan.id);
exception when unique_violation then
  return jsonb_build_object('status','error','error','code_taken');
end;
$$;

drop function if exists public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean);
create or replace function public.admin_update_plan(
  p_plan_id                     uuid,
  p_name                        text default null,
  p_description                 text default null,
  p_price_cents                 int  default null,
  p_billing_interval            text default null,
  p_features                    jsonb default null,
  p_max_services                int  default null,
  p_max_appointments_per_month  int  default null,
  p_active                      boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  if p_price_cents is not null and p_price_cents < 0 then
    return jsonb_build_object('status','error','error','invalid_price');
  end if;

  update public.plans
    set name              = coalesce(nullif(trim(p_name), ''), name),
        description       = case when p_description is null then description
                                 else nullif(trim(p_description), '') end,
        price_cents       = coalesce(p_price_cents, price_cents),
        billing_interval  = coalesce(p_billing_interval, billing_interval),
        features          = coalesce(p_features, features),
        max_services      = p_max_services,
        max_appointments_per_month = p_max_appointments_per_month,
        active            = coalesce(p_active, active)
    where id = p_plan_id;

  if not found then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id)
    values (auth.uid(), 'update_plan', 'plans', p_plan_id::text);

  return jsonb_build_object('status','ok');
end;
$$;

drop function if exists public.admin_delete_plan(uuid);
create or replace function public.admin_delete_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  delete from public.plans where id = p_plan_id;
  if not found then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id)
    values (auth.uid(), 'delete_plan', 'plans', p_plan_id::text);

  return jsonb_build_object('status','ok');
exception when foreign_key_violation then
  return jsonb_build_object('status','error','error','plan_in_use');
end;
$$;

-- Atribuir plano a usuário --------------------------------------
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

  insert into public.subscriptions (user_id, plan_id, status, started_at, expires_at)
    values (p_user_id, p_plan_id, coalesce(p_status, 'active'), now(), p_expires_at)
  on conflict (user_id) do update
    set plan_id    = excluded.plan_id,
        status     = excluded.status,
        started_at = now(),
        expires_at = excluded.expires_at,
        updated_at = now();

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'set_user_plan', 'subscriptions', p_user_id::text,
            jsonb_build_object('plan_id', p_plan_id, 'expires_at', p_expires_at, 'status', p_status));

  return jsonb_build_object('status','ok');
end;
$$;

-- Listagem paginada de planos (incluindo inativos) --------------
drop function if exists public.admin_list_plans();
create or replace function public.admin_list_plans()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  return jsonb_build_object(
    'status','ok',
    'plans', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at)
      from (
        select p.*,
          (select count(*) from public.subscriptions s where s.plan_id = p.id and s.status='active') as active_subscribers
        from public.plans p
        order by p.created_at
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- Trilha de auditoria ------------------------------------------
drop function if exists public.admin_audit_log_list(int, int);
create or replace function public.admin_audit_log_list(
  p_limit  int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit  int := greatest(1, least(coalesce(p_limit, 100), 500));
  v_offset int := greatest(0, coalesce(p_offset, 0));
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  return jsonb_build_object(
    'status','ok',
    'logs', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select l.id, l.action, l.target_type, l.target_id, l.metadata, l.created_at,
               u.email as admin_email
        from public.admin_audit_log l
        left join auth.users u on u.id = l.admin_user_id
        order by l.created_at desc
        limit v_limit offset v_offset
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- =============================================================
-- 9) GRANTs nas RPCs admin
-- =============================================================
grant execute on function public.admin_metrics_overview()                                               to authenticated;
grant execute on function public.admin_list_users(text, int, int)                                       to authenticated;
grant execute on function public.admin_user_report(uuid)                                                to authenticated;
grant execute on function public.admin_update_user_profile(uuid, text, text, text, text, text)          to authenticated;
grant execute on function public.admin_set_admin_flag(uuid, boolean)                                    to authenticated;
grant execute on function public.admin_create_plan(text, text, text, int, text, jsonb, int, int, boolean) to authenticated;
grant execute on function public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean) to authenticated;
grant execute on function public.admin_delete_plan(uuid)                                                to authenticated;
grant execute on function public.admin_set_user_plan(uuid, uuid, timestamptz, text)                     to authenticated;
grant execute on function public.admin_list_plans()                                                     to authenticated;
grant execute on function public.admin_audit_log_list(int, int)                                         to authenticated;

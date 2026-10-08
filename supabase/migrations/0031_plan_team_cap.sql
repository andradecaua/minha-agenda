-- =============================================================
-- 0031_plan_team_cap.sql
-- -------------------------------------------------------------
-- Adiciona `plans.max_team_members` como preparação pra feature
-- de "plano por equipe". Esta migration é só o DATA MODEL + wiring
-- de RPCs — nenhuma lógica de team ainda. Serve pra admin já
-- conseguir cadastrar/editar plano "pro equipe de 5" antes da gente
-- implementar as tabelas de teams, convites, RLS compartilhada, etc.
--
-- Semântica da coluna:
--   NULL  → plano individual (sem conceito de equipe; só o dono usa)
--   N ≥ 1 → plano de equipe com N vagas TOTAIS (dono + N-1 convidados)
--
-- Nota: ao convidar membros, as quotas (`max_services`,
-- `max_appointments_per_month`) são SOMADAS pela equipe inteira
-- (ver próxima migration, fora deste arquivo).
-- =============================================================

-- =============================================================
-- 1) plans.max_team_members
-- =============================================================
alter table public.plans
  add column if not exists max_team_members int
    check (max_team_members is null or max_team_members >= 1);

comment on column public.plans.max_team_members is
  'Quantas pessoas o plano aceita na mesma equipe (dono incluído). NULL = plano individual (sem equipe). Quotas em `max_services`/`max_appointments_per_month` passam a ser SOMADAS pela equipe inteira quando este valor > 1.';

-- =============================================================
-- 2) admin_create_plan — aceita p_max_team_members
-- -------------------------------------------------------------
-- Novo parâmetro no fim pra manter ordem posicional dos chamadores
-- antigos. Default NULL = plano individual.
-- =============================================================
drop function if exists public.admin_create_plan(text, text, text, int, text, jsonb, int, int, boolean, text[], int);
create or replace function public.admin_create_plan(
  p_code                        text,
  p_name                        text,
  p_description                 text,
  p_price_cents                 int,
  p_billing_interval            text,
  p_features                    jsonb,
  p_max_services                int,
  p_max_appointments_per_month  int,
  p_active                      boolean,
  p_permissions                 text[],
  p_price_yearly_cents          int default null,
  p_max_team_members            int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;
  if p_price_cents is null or p_price_cents < 0 then
    return jsonb_build_object('status','error','error','invalid_price');
  end if;
  if p_price_yearly_cents is not null and p_price_yearly_cents < 0 then
    return jsonb_build_object('status','error','error','invalid_price_yearly');
  end if;
  if p_max_team_members is not null and p_max_team_members < 1 then
    return jsonb_build_object('status','error','error','invalid_team_cap');
  end if;

  begin
    insert into public.plans
      (code, name, description, price_cents, billing_interval,
       features, max_services, max_appointments_per_month, active,
       permissions, price_yearly_cents, max_team_members)
      values
      (lower(trim(p_code)), trim(p_name), nullif(trim(p_description), ''),
       p_price_cents, p_billing_interval, coalesce(p_features, '[]'::jsonb),
       p_max_services, p_max_appointments_per_month, coalesce(p_active, true),
       coalesce(p_permissions, '{}'::text[]), p_price_yearly_cents,
       p_max_team_members)
      returning id into v_plan_id;
  exception
    when unique_violation then
      return jsonb_build_object('status','error','error','code_in_use');
    when check_violation then
      return jsonb_build_object('status','error','error','invalid_permission');
  end;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id)
    values (auth.uid(), 'create_plan', 'plans', v_plan_id::text);

  return jsonb_build_object('status','ok','plan_id', v_plan_id);
end;
$$;

grant execute on function public.admin_create_plan(text, text, text, int, text, jsonb, int, int, boolean, text[], int, int) to authenticated;

-- =============================================================
-- 3) admin_update_plan — aceita p_max_team_members
-- -------------------------------------------------------------
-- Mesma convenção dos outros opcionais nullable: null = NÃO
-- altera; -1 = sentinel pra limpar (desligar equipe). Preço
-- real/cap nunca é -1 (check >= 1), então inambíguo.
-- =============================================================
drop function if exists public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[], int);
create or replace function public.admin_update_plan(
  p_plan_id                     uuid,
  p_name                        text    default null,
  p_description                 text    default null,
  p_price_cents                 int     default null,
  p_billing_interval            text    default null,
  p_features                    jsonb   default null,
  p_max_services                int     default null,
  p_max_appointments_per_month  int     default null,
  p_active                      boolean default null,
  p_permissions                 text[]  default null,
  p_price_yearly_cents          int     default null,
  p_max_team_members            int     default null
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
  if p_price_yearly_cents is not null and p_price_yearly_cents < -1 then
    return jsonb_build_object('status','error','error','invalid_price_yearly');
  end if;
  if p_max_team_members is not null and p_max_team_members < -1 then
    return jsonb_build_object('status','error','error','invalid_team_cap');
  end if;
  if p_max_team_members is not null and p_max_team_members = 0 then
    return jsonb_build_object('status','error','error','invalid_team_cap');
  end if;

  begin
    update public.plans
      set name              = coalesce(nullif(trim(p_name), ''), name),
          description       = case when p_description is null then description
                                   else nullif(trim(p_description), '') end,
          price_cents       = coalesce(p_price_cents, price_cents),
          billing_interval  = coalesce(p_billing_interval, billing_interval),
          features          = coalesce(p_features, features),
          max_services      = p_max_services,
          max_appointments_per_month = p_max_appointments_per_month,
          active            = coalesce(p_active, active),
          permissions       = coalesce(p_permissions, permissions),
          price_yearly_cents = case
            when p_price_yearly_cents is null then price_yearly_cents
            when p_price_yearly_cents = -1   then null
            else p_price_yearly_cents
          end,
          max_team_members   = case
            when p_max_team_members is null then max_team_members
            when p_max_team_members = -1    then null
            else p_max_team_members
          end
      where id = p_plan_id;
  exception when check_violation then
    return jsonb_build_object('status','error','error','invalid_permission');
  end;

  if not found then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id)
    values (auth.uid(), 'update_plan', 'plans', p_plan_id::text);

  return jsonb_build_object('status','ok');
end;
$$;

grant execute on function public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[], int, int) to authenticated;

-- =============================================================
-- 4) my_plan — expõe max_team_members
-- -------------------------------------------------------------
-- Mesmo shape de sempre, só mais um campo. Frontend lê daqui pra
-- decidir se mostra a aba "Equipe" nas configurações.
-- =============================================================
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
      where s.user_id = auth.uid()
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

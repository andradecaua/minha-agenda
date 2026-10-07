-- =============================================================
-- 0025_plan_yearly_price.sql
-- -------------------------------------------------------------
-- Permite que UM plano ofereça duas opções de cobrança (mensal e
-- anual) ao mesmo tempo. Antes cada plano tinha um único
-- `billing_interval` fixo — agora o preço mensal continua em
-- `price_cents`, e um preço anual OPCIONAL vai em
-- `price_yearly_cents`. Quando esse campo é NULL, o plano não
-- oferece anual (comportamento legado).
--
-- O desconto do anual não é guardado — é derivado:
--   desconto_% = (price_cents*12 - price_yearly_cents) / (price_cents*12)
--
-- `subscriptions` ganha `current_interval` pra o webhook saber
-- por quanto estender `current_period_end` na renovação (1 mês
-- vs 12 meses). `activate_subscription_from_webhook` passa a
-- aceitar `p_interval` pra escrever esse campo.
--
-- `admin_create_plan` e `admin_update_plan` ganham o parâmetro
-- `p_price_yearly_cents int`. Convenção segue o padrão existente
-- de `max_services` (NULL = clear). Em `admin_update_plan`, por
-- ter sido no padrão "null = unchanged", usamos sentinel `-1`
-- pra limpar — nenhum preço real cabe em -1, então é inambíguo.
-- =============================================================

-- =============================================================
-- 1) plans.price_yearly_cents
-- =============================================================
alter table public.plans
  add column if not exists price_yearly_cents int
    check (price_yearly_cents is null or price_yearly_cents >= 0);

comment on column public.plans.price_yearly_cents is
  'Preço anual em centavos. NULL = plano não oferece opção anual (só mensal via price_cents).';

-- =============================================================
-- 2) subscriptions.current_interval
-- -------------------------------------------------------------
-- Rastro de qual intervalo o usuário escolheu na compra ATUAL.
-- Usado pelo webhook pra decidir por quantos meses estender
-- `current_period_end` na renovação. Default 'monthly' pros
-- registros existentes.
-- =============================================================
alter table public.subscriptions
  add column if not exists current_interval text not null default 'monthly'
    check (current_interval in ('monthly','yearly'));

comment on column public.subscriptions.current_interval is
  'Intervalo da compra atual (monthly/yearly). Define o período de validação na renovação.';

-- =============================================================
-- 3) admin_create_plan — aceita p_price_yearly_cents
-- -------------------------------------------------------------
-- Mantém a assinatura antiga por compat (drop e recria com
-- parâmetro novo no fim, default null = "sem anual").
-- =============================================================
drop function if exists public.admin_create_plan(text, text, text, int, text, jsonb, int, int, boolean, text[]);
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
  p_price_yearly_cents          int default null
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

  begin
    insert into public.plans
      (code, name, description, price_cents, billing_interval,
       features, max_services, max_appointments_per_month, active,
       permissions, price_yearly_cents)
      values
      (lower(trim(p_code)), trim(p_name), nullif(trim(p_description), ''),
       p_price_cents, p_billing_interval, coalesce(p_features, '[]'::jsonb),
       p_max_services, p_max_appointments_per_month, coalesce(p_active, true),
       coalesce(p_permissions, '{}'::text[]), p_price_yearly_cents)
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

grant execute on function public.admin_create_plan(text, text, text, int, text, jsonb, int, int, boolean, text[], int) to authenticated;

-- =============================================================
-- 4) admin_update_plan — aceita p_price_yearly_cents
-- -------------------------------------------------------------
-- Convenção pro valor anual: `null` = não altera (segue padrão
-- dos outros opcionais); `-1` = sentinel pra LIMPAR (desligar
-- anual). Preço real não pode ser -1 (CHECK >= 0), então o
-- sentinel é inambíguo.
-- =============================================================
drop function if exists public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[]);
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
  p_price_yearly_cents          int     default null
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

grant execute on function public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[], int) to authenticated;

-- =============================================================
-- 5) activate_subscription_from_webhook — aceita p_interval
-- -------------------------------------------------------------
-- Novo param no FIM (default 'monthly' pra compat com chamadas
-- antigas). Escreve `current_interval` na subscription. O
-- período em si (`p_current_period_end`) continua vindo da edge
-- já calculado — o SQL não decide quantos meses adicionar.
-- =============================================================
drop function if exists public.activate_subscription_from_webhook(uuid, uuid, text, text, timestamptz, timestamptz);
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
begin
  if p_interval not in ('monthly','yearly') then
    return jsonb_build_object('status','error','error','invalid_interval');
  end if;

  insert into public.subscriptions
    (user_id, plan_id, status, gateway, gateway_subscription_id,
     current_period_end, last_payment_at, cancel_at_period_end,
     expires_at, started_at, current_interval)
  values
    (p_user_id, p_plan_id, 'active', p_gateway, p_subscription_id,
     p_current_period_end, p_last_payment_at, false,
     p_current_period_end, now(), p_interval)
  on conflict (user_id) do update
    set plan_id                 = excluded.plan_id,
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
-- 6) my_plan — expõe price_yearly_cents + current_interval
-- -------------------------------------------------------------
-- Permite ao frontend render do toggle sem round-trip extra.
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
      'plan_price_cents', null, 'plan_price_yearly_cents', null,
      'subscription_status', null, 'expires_at', null,
      'cancel_at_period_end', null, 'current_interval', null
    )
  );
$$;

grant execute on function public.my_plan() to authenticated;

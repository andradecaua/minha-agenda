-- =============================================================
-- 0021_payments.sql
-- -------------------------------------------------------------
-- Integração com gateway de pagamento (Mercado Pago, modelo
-- Preapproval — assinaturas recorrentes nativas).
--
-- Fluxo em 4 passos:
--
--   1. Admin cria/edita o plano local (0019). Clica "Sincronizar
--      com MP" na UI → Edge Function `sync-plan-to-mp` cria o
--      `preapproval_plan` no MP e grava `plans.gateway_plan_id`.
--
--   2. Usuário clica "Assinar X" → Edge Function
--      `create-subscription` chama POST /preapproval do MP com
--      `preapproval_plan_id` e `external_reference = user_id`.
--      MP devolve `init_point` (URL do checkout) → user confirma.
--
--   3. MP envia webhook `preapproval` (estado da assinatura) ou
--      `authorized_payment` (cada cobrança) para
--      `mercadopago-webhook`. Edge valida x-signature, chama
--      `activate_subscription_from_webhook` (approved) ou
--      `mark_subscription_cancelled` (cancelled/paused).
--
--   4. `has_feature()` (0019) já filtra por `expires_at > now()` e
--      `status in ('active','trialing')`. Assinatura expirada /
--      cancelada deixa de valer automaticamente.
--
-- Decisões de modelagem:
--
--  - `payment_events`: cru auditável de TODO webhook. Idempotente
--     via UNIQUE (gateway, gateway_event_id). Serve pra debug e
--     pra prova em disputa de cobrança.
--
--  - `plans.gateway_plan_id` e `subscriptions.gateway_subscription_id`:
--     ambos UNIQUE WHERE NOT NULL — pode haver múltiplos registros
--     sem gateway (planos gratuitos, assinaturas antigas), mas um
--     plano/assinatura no MP só mapeia pra UM local.
--
--  - RPCs do webhook rodam SECURITY DEFINER e são chamadas pela
--     Edge Function com `service_role`. O frontend NUNCA chama
--     essas RPCs — não há grant pra `authenticated`.
--
--  - `my_subscription_detail()` é a RPC segura pro frontend ler
--     status da assinatura (sem expor outros users).
-- =============================================================

-- =============================================================
-- 1) plans.gateway_plan_id (preapproval_plan no MP)
-- =============================================================
alter table public.plans
  add column if not exists gateway_plan_id text;

create unique index if not exists plans_gateway_plan_id_uq
  on public.plans (gateway_plan_id)
  where gateway_plan_id is not null;

-- =============================================================
-- 2) subscriptions: campos de gateway
-- =============================================================
alter table public.subscriptions
  add column if not exists gateway                  text,
  add column if not exists gateway_subscription_id  text,
  add column if not exists last_payment_at          timestamptz,
  add column if not exists current_period_end       timestamptz,
  add column if not exists cancel_at_period_end     boolean not null default false;

create unique index if not exists subscriptions_gateway_sub_uq
  on public.subscriptions (gateway, gateway_subscription_id)
  where gateway_subscription_id is not null;

-- =============================================================
-- 3) payment_events (auditoria + idempotência)
-- =============================================================
create table if not exists public.payment_events (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references auth.users(id) on delete set null,
  plan_id                uuid references public.plans(id) on delete set null,
  gateway                text not null,
  gateway_event_id       text not null,            -- notification ID enviado pelo gateway
  gateway_resource       text,                     -- preapproval, authorized_payment, ...
  gateway_resource_id    text,                     -- id do recurso referenciado
  event_type             text,                     -- authorized, cancelled, paused, approved, ...
  amount_cents           integer,                  -- opcional, só pra pagamentos
  raw                    jsonb not null,           -- payload cru pra debug
  created_at             timestamptz not null default now()
);

create unique index if not exists payment_events_gateway_event_uq
  on public.payment_events (gateway, gateway_event_id);

create index if not exists payment_events_user_created_idx
  on public.payment_events (user_id, created_at desc);

create index if not exists payment_events_resource_idx
  on public.payment_events (gateway, gateway_resource, gateway_resource_id);

-- RLS
alter table public.payment_events enable row level security;

drop policy if exists "payment_events_self_select" on public.payment_events;
drop policy if exists "payment_events_admin_all"   on public.payment_events;

-- Usuário vê os próprios eventos (histórico de cobranças).
create policy "payment_events_self_select"
  on public.payment_events
  for select
  to authenticated
  using (user_id = auth.uid());

-- Admin elevado vê tudo.
create policy "payment_events_admin_all"
  on public.payment_events
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- NENHUM grant de INSERT/UPDATE/DELETE pra `authenticated`.
-- Escrita só via RPC SECURITY DEFINER (service_role da edge).
grant select on public.payment_events to authenticated;

-- =============================================================
-- 4) RPCs chamadas pelo webhook (service_role via edge)
-- -------------------------------------------------------------
-- SECURITY DEFINER porque atualizam subscriptions de QUALQUER
-- user. Sem grant pra `authenticated` — só service_role chama.
-- =============================================================

-- Idempotente: INSERT com ON CONFLICT (gateway, gateway_event_id).
-- Retorna true se gravou, false se já existia (dedup natural).
drop function if exists public.record_payment_event(uuid, uuid, text, text, text, text, text, integer, jsonb);
create or replace function public.record_payment_event(
  p_user_id             uuid,
  p_plan_id             uuid,
  p_gateway             text,
  p_gateway_event_id    text,
  p_gateway_resource    text,
  p_gateway_resource_id text,
  p_event_type          text,
  p_amount_cents        integer,
  p_raw                 jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean;
begin
  insert into public.payment_events
    (user_id, plan_id, gateway, gateway_event_id, gateway_resource,
     gateway_resource_id, event_type, amount_cents, raw)
    values
    (p_user_id, p_plan_id, p_gateway, p_gateway_event_id, p_gateway_resource,
     p_gateway_resource_id, p_event_type, p_amount_cents, p_raw)
  on conflict (gateway, gateway_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

-- Ativa/renova a assinatura quando o webhook confirma pagamento.
-- Upsert por user_id — se já há subscription, troca plan + estende.
drop function if exists public.activate_subscription_from_webhook(uuid, uuid, text, text, timestamptz, timestamptz);
create or replace function public.activate_subscription_from_webhook(
  p_user_id              uuid,
  p_plan_id              uuid,
  p_gateway              text,
  p_subscription_id      text,
  p_current_period_end   timestamptz,
  p_last_payment_at      timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.subscriptions%rowtype;
begin
  if p_user_id is null or p_plan_id is null or p_subscription_id is null then
    return jsonb_build_object('status','error','error','missing_params');
  end if;

  if not exists (select 1 from public.plans where id = p_plan_id) then
    return jsonb_build_object('status','error','error','plan_not_found');
  end if;

  insert into public.subscriptions
    (user_id, plan_id, status, gateway, gateway_subscription_id,
     current_period_end, last_payment_at, cancel_at_period_end, started_at, expires_at)
  values
    (p_user_id, p_plan_id, 'active', p_gateway, p_subscription_id,
     p_current_period_end, p_last_payment_at, false, now(), p_current_period_end)
  on conflict (user_id) do update
    set plan_id                 = excluded.plan_id,
        status                  = 'active',
        gateway                 = excluded.gateway,
        gateway_subscription_id = excluded.gateway_subscription_id,
        current_period_end      = excluded.current_period_end,
        last_payment_at         = excluded.last_payment_at,
        cancel_at_period_end    = false,
        expires_at              = excluded.current_period_end,
        updated_at              = now();

  return jsonb_build_object('status','ok');
end;
$$;

-- Marca cancelamento vindo do webhook (preapproval.cancelled).
-- Mantém o período atual válido — a assinatura só "morre" quando
-- `expires_at` passar. `has_feature()` já respeita isso.
drop function if exists public.mark_subscription_cancelled(text, text);
create or replace function public.mark_subscription_cancelled(
  p_gateway         text,
  p_subscription_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.subscriptions
    set cancel_at_period_end = true,
        -- Status muda só se já expirou; senão deixa 'active' até o fim.
        status = case
          when current_period_end is null or current_period_end <= now()
            then 'cancelled'::text
          else status
        end,
        updated_at = now()
    where gateway = p_gateway
      and gateway_subscription_id = p_subscription_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  return jsonb_build_object('status','ok');
end;
$$;

-- =============================================================
-- 5) RPC lida pelo frontend: detalhe da própria assinatura
-- =============================================================
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
        s.id                       as subscription_id,
        s.status                   as subscription_status,
        s.gateway                  as gateway,
        s.gateway_subscription_id  as gateway_subscription_id,
        s.current_period_end       as current_period_end,
        s.last_payment_at          as last_payment_at,
        s.cancel_at_period_end     as cancel_at_period_end,
        s.expires_at               as expires_at,
        pl.id                      as plan_id,
        pl.code                    as plan_code,
        pl.name                    as plan_name,
        pl.price_cents             as plan_price_cents,
        pl.billing_interval        as plan_billing_interval,
        pl.gateway_plan_id         as plan_gateway_plan_id
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.user_id = auth.uid()
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
-- 6) Grants das RPCs do webhook — SOMENTE service_role.
-- -------------------------------------------------------------
-- Não damos execute pra `authenticated` nem `anon`. A edge function
-- usa a service_role key (bypassa RLS, pode executar qualquer RPC).
-- =============================================================
revoke all on function public.record_payment_event(uuid, uuid, text, text, text, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.activate_subscription_from_webhook(uuid, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_subscription_cancelled(text, text) from public, anon, authenticated;

-- =============================================================
-- 7) admin_update_plan: aceitar p_gateway_plan_id
-- -------------------------------------------------------------
-- A edge `sync-plan-to-mp` grava `plans.gateway_plan_id` via
-- UPDATE direto (service_role). Mas se o admin quiser forçar
-- manualmente, passa aqui.
-- =============================================================
drop function if exists public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[], text);
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
  p_gateway_plan_id             text    default null
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
          gateway_plan_id   = case
            when p_gateway_plan_id is null then gateway_plan_id
            when p_gateway_plan_id = ''    then null
            else p_gateway_plan_id
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

grant execute on function public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[], text) to authenticated;

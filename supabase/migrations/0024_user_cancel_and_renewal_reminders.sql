-- =============================================================
-- 0024_user_cancel_and_renewal_reminders.sql
-- -------------------------------------------------------------
-- Fecha duas pendências do roadmap pós-piloto:
--
--   1. Cancelamento iniciado pelo próprio usuário (sem passar pelo
--      webhook do MP). No modelo Preference (0023), o MP já cobrou
--      uma única vez — não há recorrência pra "desligar". Logo
--      "cancelar" é só marcar `cancel_at_period_end=true`. O user
--      segue ativo até `current_period_end`; depois `has_feature()`
--      (0019) o rebaixa automaticamente ao free via filtro
--      `expires_at > now()`.
--
--   2. Infra pro lembrete de renovação por email (edge function
--      `send-renewal-reminders`): coluna `renewal_reminder_sent_at`
--      pra idempotência (não mandar duas vezes dentro do mesmo
--      ciclo) + extensões `pg_cron` e `pg_net` pra que o cron possa
--      invocar a edge via HTTP.
--
-- O agendamento do cron em si NÃO vai aqui — depende da URL do
-- projeto + `CRON_SECRET`, que só o operador tem. Instrução SQL
-- de setup pós-deploy está no CONTEXT.md (seção "Deploy").
--
-- Hotfix embutido: `my_subscription_detail` (0021) referenciava
-- `pl.gateway_plan_id`, coluna removida pela 0023. Nenhum caller
-- atual usa a RPC (frontend consome `my_plan`), mas deixar
-- quebrada é dívida. Reescrito sem a coluna.
-- =============================================================

-- =============================================================
-- 1) renewal_reminder_sent_at em subscriptions
-- -------------------------------------------------------------
-- Timestamp do último envio de lembrete. NULL = nunca enviou.
-- A edge compara contra `current_period_end - 1 month` pra decidir
-- se o envio é do ciclo atual (pular) ou de um ciclo anterior
-- (pode mandar de novo).
-- =============================================================
alter table public.subscriptions
  add column if not exists renewal_reminder_sent_at timestamptz;

comment on column public.subscriptions.renewal_reminder_sent_at is
  'Último envio do lembrete de renovação. NULL = nunca enviado. Usado para idempotência da edge send-renewal-reminders.';

-- =============================================================
-- 2) RPC cancel_my_subscription — chamada direta do frontend
-- -------------------------------------------------------------
-- Idempotente: re-chamar quando já está cancelada é no-op.
-- Só opera em plano pago (price_cents > 0); free não tem o que
-- cancelar e devolve 'nothing_to_cancel'.
-- =============================================================
drop function if exists public.cancel_my_subscription();
create or replace function public.cancel_my_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows        int;
  v_period_end  timestamptz;
begin
  if auth.uid() is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;

  update public.subscriptions s
    set cancel_at_period_end = true,
        updated_at = now()
    where s.user_id = auth.uid()
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
      auth.uid()::text,
      jsonb_build_object('current_period_end', v_period_end)
    );

  return jsonb_build_object(
    'status','ok',
    'current_period_end', v_period_end
  );
end;
$$;

grant execute on function public.cancel_my_subscription() to authenticated;

-- =============================================================
-- 3) Extensões pg_cron + pg_net
-- -------------------------------------------------------------
-- Ambas disponíveis em todos os tiers do Supabase. `pg_cron`
-- agenda tarefas; `pg_net` faz HTTP de dentro do Postgres pra
-- invocar edge functions. O agendamento efetivo é feito via
-- SQL manual pós-deploy (ver CONTEXT.md § Deploy — cron de
-- lembretes de renovação).
-- =============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- =============================================================
-- 4) Estende my_plan com cancel_at_period_end
-- -------------------------------------------------------------
-- O frontend usa `my_plan` como fonte única pra UI de assinatura
-- (hot path, cacheada 5min pelo React Query). Expor
-- `cancel_at_period_end` aqui evita um segundo round-trip pra
-- `my_subscription_detail` só pra renderizar o botão "Cancelar".
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
        s.status                      as subscription_status,
        s.expires_at                  as expires_at,
        s.cancel_at_period_end        as cancel_at_period_end
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.user_id = auth.uid()
      limit 1
    ) x),
    jsonb_build_object(
      'plan_id', null, 'plan_code', null, 'plan_name', null,
      'permissions', '[]'::jsonb,
      'max_services', null, 'max_appointments_per_month', null,
      'subscription_status', null, 'expires_at', null,
      'cancel_at_period_end', null
    )
  );
$$;

grant execute on function public.my_plan() to authenticated;

-- =============================================================
-- 5) Hotfix: my_subscription_detail sem pl.gateway_plan_id
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

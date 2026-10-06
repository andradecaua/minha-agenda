-- =============================================================
-- 0023_switch_to_preference.sql
-- -------------------------------------------------------------
-- Troca o modelo de cobrança: Preapproval (recorrência cartão) →
-- Checkout Preference (pagamento avulso, aceita Pix + boleto + cartão).
--
-- Motivação: Preapproval do MP só aceita cartão de crédito. Pra
-- oferecer Pix (prioridade no mercado BR), precisamos usar Preference.
-- Trade-off: não há cobrança recorrente automática — user paga 1 mês
-- → `current_period_end` estendido → quando vence, `has_feature()`
-- já desce pra free (filtro `expires_at > now()` já implementado em
-- 0019). Lembrete por email N dias antes resolve a UX.
--
-- O que muda neste arquivo:
--   1. DROP COLUMN plans.gateway_plan_id (não precisa de template no MP;
--      Preference é criado on-the-fly a cada compra).
--   2. DROP INDEX e DROP TRIGGER relacionados.
--   3. Reescreve `admin_update_plan` SEM `p_gateway_plan_id`.
--
-- O que NÃO muda:
--   - `subscriptions.gateway_subscription_id` fica — passa a guardar o
--     `payment_id` (ou `preference_id`) da compra mais recente, útil
--     pra referência cruzada com o painel do MP.
--   - `payment_events` fica — tabela de auditoria é modelo-agnóstica.
--   - `activate_subscription_from_webhook`, `mark_subscription_cancelled`
--     e `my_subscription_detail` ficam.
-- =============================================================

-- =============================================================
-- 1) Dropa coluna gateway_plan_id e seus artefatos
-- =============================================================
drop index if exists public.plans_gateway_plan_id_uq;
alter table public.plans drop column if exists gateway_plan_id;

-- =============================================================
-- 2) admin_update_plan: assinatura sem p_gateway_plan_id
-- -------------------------------------------------------------
-- Drop das assinaturas antigas (0018, 0019 e 0021) pra evitar
-- ambiguidade de overload.
-- =============================================================
drop function if exists public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean);
drop function if exists public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[]);
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
  p_permissions                 text[]  default null
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
          permissions       = coalesce(p_permissions, permissions)
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

grant execute on function public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[]) to authenticated;

-- =============================================================
-- 0040_admin_reports_exclude_admins.sql
-- -------------------------------------------------------------
-- Admins da plataforma (registros em `public.admin_users`) não
-- devem inflar métricas de "assinantes" / "usuários pagos" nos
-- relatórios admin. Eles tipicamente têm um plano ativo pra
-- testar features, mas são equipe interna — não cliente pagante.
--
-- Mudanças:
--
--  1. `admin_metrics_overview.active_subscriptions` passa a
--     excluir subscriptions cujo user_id está em `admin_users`.
--
--  2. `admin_list_plans.active_subscribers` (contagem por plano)
--     passa a excluir admins pelo mesmo critério.
--
-- Demais contadores (`users_total`, `users_new_7d`, `users_new_30d`,
-- clientes, agendamentos, faturamento) são deixados como estão —
-- o pedido é especificamente sobre assinantes/pagantes.
-- =============================================================

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
    'active_subscriptions',        (select count(*) from public.subscriptions s
                                      where s.status = 'active'
                                        and not exists (
                                          select 1 from public.admin_users a where a.user_id = s.user_id
                                        )),
    'plans_active',                (select count(*) from public.plans where active=true),
    'admin_count',                 (select count(*) from public.admin_users),
    'generated_at',                now()
  );
end;
$$;

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
          (select count(*) from public.subscriptions s
             where s.plan_id = p.id
               and s.status = 'active'
               and not exists (
                 select 1 from public.admin_users a where a.user_id = s.user_id
               )) as active_subscribers
        from public.plans p
        order by p.created_at
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

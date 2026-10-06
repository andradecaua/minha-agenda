-- =============================================================
-- 0019_permissions.sql
-- -------------------------------------------------------------
-- Permissões por plano (feature gating) + ligação user→plano
-- padrão (plano "free") no cadastro.
--
-- Decisões:
--
--  1. Catálogo canônico em `public.permission_catalog` (code PK).
--     Fonte da verdade — frontend referencia os mesmos códigos.
--
--  2. `plans.permissions text[]` substitui o uso do antigo
--     `plans.features jsonb` (que ninguém lia). Mantemos a coluna
--     `features` para não quebrar RPCs existentes; nova verdade
--     é `permissions`. Trigger valida que todo elemento está no
--     catálogo. GIN index para lookup por código via `@>` / `ANY`.
--
--  3. Permissões são booleanas (tem/não tem). Quotas numéricas
--     (max_services, max_appointments_per_month) ficam como estão
--     — modelagem diferente, enforcement em outra iteração.
--
--  4. Enforcement em DUAS camadas (defesa em profundidade):
--     - Frontend: hook `usePermissions` esconde UI/rotas.
--     - Banco:   RLS gates em `products` e `portfolio_items` para
--       INSERT/UPDATE/DELETE (SELECT fica livre p/ a página pública).
--
--  5. Novo usuário recebe plano `free` automaticamente via trigger
--     já existente (`handle_new_user`). Backfill cria subscription
--     para quem ainda não tem.
--
-- Como adicionar uma permissão nova:
--   1. INSERT em permission_catalog com o novo code.
--   2. Atualizar o enum em src/lib/permissions.ts (TS).
--   3. Admin edita os planos pra incluir/excluir o code.
-- =============================================================

-- =============================================================
-- 1) Catálogo de permissões
-- =============================================================
create table if not exists public.permission_catalog (
  code         text primary key,
  name         text not null,
  description  text,
  category     text not null default 'general',
  created_at   timestamptz not null default now()
);

create index if not exists permission_catalog_category_idx
  on public.permission_catalog (category);

-- Seed inicial. Idempotente via ON CONFLICT.
insert into public.permission_catalog (code, name, description, category) values
  ('agenda.manual_booking',      'Agendamento manual',       'Criar agendamentos pelo painel sem passar pelo link público.', 'agenda'),
  ('clients.manage',             'Clientes',                 'Lista, perfil e histórico de clientes.',                        'clients'),
  ('services.manage',            'Serviços',                 'Cadastro e edição de serviços oferecidos.',                     'services'),
  ('products.manage',            'Produtos',                 'Aba de produtos à venda com estoque e imagens.',                'products'),
  ('portfolio.manage',           'Portfólio',                'Galeria de trabalhos exibida na página pública.',               'portfolio'),
  ('public_page.enabled',        'Página pública',           'Página /p/:slug ativa para receber reservas.',                  'public_page'),
  ('booking.cancellation_rules', 'Regras de cancelamento',   'Políticas avançadas de cancelamento (prazo, janelas).',         'booking'),
  ('reports.advanced',           'Relatórios avançados',     'Métricas e exportações além do dashboard básico.',              'reports')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      category = excluded.category;

-- RLS: catálogo é leitura pública (frontend precisa listar na tela
-- de edição de plano). Escrita só admin elevado — via RPC futura.
alter table public.permission_catalog enable row level security;

drop policy if exists "permission_catalog_public_select" on public.permission_catalog;
create policy "permission_catalog_public_select"
  on public.permission_catalog
  for select
  to anon, authenticated
  using (true);

drop policy if exists "permission_catalog_admin_write" on public.permission_catalog;
create policy "permission_catalog_admin_write"
  on public.permission_catalog
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.permission_catalog to anon, authenticated;
grant insert, update, delete on public.permission_catalog to authenticated;

-- =============================================================
-- 2) Coluna permissions em plans + trigger de validação
-- =============================================================
alter table public.plans
  add column if not exists permissions text[] not null default '{}'::text[];

create index if not exists plans_permissions_gin_idx
  on public.plans using gin (permissions);

-- Trigger: todo elemento de `permissions` precisa existir no
-- catálogo. Falha com mensagem indicando qual código é inválido.
create or replace function public.plans_validate_permissions()
returns trigger
language plpgsql
as $$
declare
  v_bad text;
begin
  if new.permissions is null then
    new.permissions := '{}'::text[];
  end if;

  select p
    into v_bad
    from unnest(new.permissions) p
    where not exists (
      select 1 from public.permission_catalog c where c.code = p
    )
    limit 1;

  if v_bad is not null then
    raise exception 'Permission code not in catalog: %', v_bad
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists plans_validate_permissions_trg on public.plans;
create trigger plans_validate_permissions_trg
  before insert or update of permissions on public.plans
  for each row execute function public.plans_validate_permissions();

-- =============================================================
-- 3) Funções de leitura de permissões (frontend e RLS consomem)
-- =============================================================

-- Resposta booleana para a permissão X do usuário atual. Core do
-- enforcement — chamada pelas policies de products/portfolio.
drop function if exists public.has_feature(text);
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
    where s.user_id = auth.uid()
      and s.status in ('active','trialing')
      and (s.expires_at is null or s.expires_at > now())
      and pl.active = true
      and p_code = any (pl.permissions)
  );
$$;

-- Lista completa das permissões do usuário atual. Frontend busca
-- uma vez por sessão e cacheia (react-query).
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
     where s.user_id = auth.uid()
       and s.status in ('active','trialing')
       and (s.expires_at is null or s.expires_at > now())
       and pl.active = true
     limit 1),
    '{}'::text[]
  );
$$;

-- Snapshot do plano do usuário (permissões + quotas) num JSON só.
-- Usado pelo frontend para mostrar "você está no plano X" + quotas.
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
        s.expires_at                  as expires_at
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.user_id = auth.uid()
      limit 1
    ) x),
    jsonb_build_object(
      'plan_id', null, 'plan_code', null, 'plan_name', null,
      'permissions', '[]'::jsonb,
      'max_services', null, 'max_appointments_per_month', null,
      'subscription_status', null, 'expires_at', null
    )
  );
$$;

grant execute on function public.has_feature(text)   to authenticated;
grant execute on function public.my_permissions()    to authenticated;
grant execute on function public.my_plan()           to authenticated;

-- =============================================================
-- 4) Plano `free` padrão + atribuição automática no cadastro
-- =============================================================

-- Garante que o plano "free" exista. Idempotente.
insert into public.plans
  (code, name, description, price_cents, billing_interval, permissions,
   max_services, max_appointments_per_month, active)
values
  ('free', 'Gratuito',
   'Plano inicial. Agenda, clientes, serviços e página pública.',
   0, 'monthly',
   array[
     'agenda.manual_booking',
     'clients.manage',
     'services.manage',
     'public_page.enabled'
   ],
   10,   -- max_services
   100,  -- max_appointments_per_month
   true)
on conflict (code) do update
  set permissions = excluded.permissions,
      active      = true,
      name        = excluded.name,
      description = excluded.description;

-- Plano `pro` com tudo liberado — serve como referência.
insert into public.plans
  (code, name, description, price_cents, billing_interval, permissions,
   max_services, max_appointments_per_month, active)
values
  ('pro', 'Pro',
   'Tudo do Gratuito, mais produtos, portfólio e regras avançadas.',
   2900, 'monthly',
   array[
     'agenda.manual_booking',
     'clients.manage',
     'services.manage',
     'products.manage',
     'portfolio.manage',
     'public_page.enabled',
     'booking.cancellation_rules',
     'reports.advanced'
   ],
   null,
   null,
   true)
on conflict (code) do update
  set permissions = excluded.permissions;

-- Função: assina `user_id` ao plano `free` se ainda não tiver
-- subscription. Idempotente, resistente à ausência do plano free.
drop function if exists public.ensure_free_subscription(uuid);
create or replace function public.ensure_free_subscription(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
begin
  select id into v_plan_id
    from public.plans
    where code = 'free' and active = true
    limit 1;

  if v_plan_id is null then
    return;  -- Sem plano free configurado, nada a fazer.
  end if;

  insert into public.subscriptions (user_id, plan_id, status)
    values (p_user_id, v_plan_id, 'active')
    on conflict (user_id) do nothing;
end;
$$;

grant execute on function public.ensure_free_subscription(uuid) to authenticated;

-- Redefine handle_new_user: além de criar o profile (via
-- provision_profile_for_user de 0005), também assina ao plano free.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.provision_profile_for_user(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );
  perform public.ensure_free_subscription(new.id);
  return new;
end;
$$;

-- Backfill: usuários existentes sem subscription recebem o free.
do $$
declare
  u record;
begin
  for u in
    select p.user_id
    from public.profiles p
    left join public.subscriptions s on s.user_id = p.user_id
    where s.id is null
  loop
    begin
      perform public.ensure_free_subscription(u.user_id);
    exception when others then
      raise notice 'Falha ao assinar plano free para user_id=%: %', u.user_id, sqlerrm;
    end;
  end loop;
end$$;

-- =============================================================
-- 5) RLS gates em products e portfolio_items (defesa em profundidade)
-- -------------------------------------------------------------
-- SELECT público (anon) e SELECT do dono continuam livres: ler
-- não custa nada e a página /p/:slug depende. Só INSERT/UPDATE/
-- DELETE exigem a permissão do plano.
--
-- Estratégia: dropar o policy único `*_owner_all` e recriar em
-- três policies (select / write-insert / write-update-delete). As
-- policies de WRITE adicionam `has_feature('<code>')`.
-- =============================================================

-- products -----------------------------------------------------
drop policy if exists "products_owner_all" on public.products;

create policy "products_owner_select"
  on public.products
  for select
  to authenticated
  using (professional_id = public.current_professional_id());

create policy "products_owner_insert"
  on public.products
  for insert
  to authenticated
  with check (
    professional_id = public.current_professional_id()
    and public.has_feature('products.manage')
  );

create policy "products_owner_update"
  on public.products
  for update
  to authenticated
  using (
    professional_id = public.current_professional_id()
    and public.has_feature('products.manage')
  )
  with check (
    professional_id = public.current_professional_id()
    and public.has_feature('products.manage')
  );

create policy "products_owner_delete"
  on public.products
  for delete
  to authenticated
  using (
    professional_id = public.current_professional_id()
    and public.has_feature('products.manage')
  );

-- portfolio_items ---------------------------------------------
drop policy if exists "portfolio_owner_all" on public.portfolio_items;

create policy "portfolio_owner_select"
  on public.portfolio_items
  for select
  to authenticated
  using (professional_id = public.current_professional_id());

create policy "portfolio_owner_insert"
  on public.portfolio_items
  for insert
  to authenticated
  with check (
    professional_id = public.current_professional_id()
    and public.has_feature('portfolio.manage')
  );

create policy "portfolio_owner_update"
  on public.portfolio_items
  for update
  to authenticated
  using (
    professional_id = public.current_professional_id()
    and public.has_feature('portfolio.manage')
  )
  with check (
    professional_id = public.current_professional_id()
    and public.has_feature('portfolio.manage')
  );

create policy "portfolio_owner_delete"
  on public.portfolio_items
  for delete
  to authenticated
  using (
    professional_id = public.current_professional_id()
    and public.has_feature('portfolio.manage')
  );

-- =============================================================
-- 6) admin_create_plan / admin_update_plan passam a aceitar
--    `p_permissions text[]` (nullable no update → preserva atual).
--    Mantém `p_features jsonb` por compatibilidade com callers
--    existentes — mas o campo canônico é `permissions`.
-- =============================================================

drop function if exists public.admin_create_plan(text, text, text, int, text, jsonb, int, int, boolean);
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
  p_permissions                 text[] default '{}'::text[]
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

  begin
    insert into public.plans
      (code, name, description, price_cents, billing_interval, features,
       max_services, max_appointments_per_month, active, permissions)
      values
      (lower(trim(p_code)), trim(p_name), nullif(trim(p_description), ''),
       p_price_cents, coalesce(p_billing_interval, 'monthly'),
       coalesce(p_features, '[]'::jsonb),
       p_max_services, p_max_appointments_per_month, coalesce(p_active, true),
       coalesce(p_permissions, '{}'::text[]))
      returning * into v_plan;
  exception
    when check_violation then
      return jsonb_build_object('status','error','error','invalid_permission');
    when unique_violation then
      return jsonb_build_object('status','error','error','code_taken');
  end;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'create_plan', 'plans', v_plan.id::text, to_jsonb(v_plan));

  return jsonb_build_object('status','ok','plan_id', v_plan.id);
end;
$$;

drop function if exists public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean);
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

grant execute on function public.admin_create_plan(text, text, text, int, text, jsonb, int, int, boolean, text[]) to authenticated;
grant execute on function public.admin_update_plan(uuid, text, text, int, text, jsonb, int, int, boolean, text[]) to authenticated;

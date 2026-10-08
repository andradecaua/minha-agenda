-- =============================================================
-- 0032_teams.sql
-- -------------------------------------------------------------
-- Primeira camada do refactor "plano por equipe": data model das
-- equipes + relacionamento com usuários + auto-provisão em signup
-- + backfill dos usuários existentes.
--
-- Esta migration NÃO move portfolio nem subscription pra team.
-- Isso vem nas migrations 0033 e 0034. Aqui garantimos:
--
--   1. Todo profile tem exatamente UM team (o solo team dele, onde
--      é owner e único member).
--   2. Signup novo cria o team solo junto com o profile.
--   3. Backfill cria o solo team pros usuários pré-existentes.
--
-- Decisões:
--  - Um usuário só pode estar em UM team (unique index em
--    team_members.user_id). Modelo simples pra começar.
--  - Papéis: só `owner` e `member`. Um team tem exatamente UM owner
--    (quem paga e convida). Members usam, não convidam, não pagam.
--  - teams.slug é copiado de profiles.slug no provisionamento. Como
--    profiles.slug é único, teams.slug também fica único na origem.
--    Owner pode rebrandar via settings depois (migration futura).
--
-- O que ainda falta:
--  - RLS/policies que compartilham portfolio pela equipe (0033).
--  - Subscription do team no lugar do user (0034).
--  - Convite por email, aceitar com setar senha (0035).
--  - UI de equipe (TeamSettingsPage), ajuste da ProfessionalPage
--    pública pra listar membros (frontend).
-- =============================================================

-- =============================================================
-- 1) Tabela teams
-- =============================================================
create table if not exists public.teams (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  owner_user_id  uuid not null references auth.users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists teams_updated_at on public.teams;
create trigger teams_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create index if not exists teams_owner_idx on public.teams (owner_user_id);

comment on table public.teams is
  'Agrupamento de profissionais que compartilham portfolio e assinatura. Todo usuário pertence a exatamente um team (via team_members).';

-- =============================================================
-- 2) Tabela team_members
-- -------------------------------------------------------------
-- Unique por user_id = cada usuário em UM time só. Primary key
-- composta impede duplicata do mesmo par.
-- =============================================================
create table if not exists public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner','member')),
  joined_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);

create unique index if not exists team_members_user_unique
  on public.team_members (user_id);

create index if not exists team_members_role_idx
  on public.team_members (team_id, role);

comment on table public.team_members is
  'Vínculo profissional → equipe. `user_id` é único em todo o schema (user em UM time só). Role owner tem permissão pra convidar/remover membros e assinar planos; member só usa.';

-- =============================================================
-- 3) Helpers
-- -------------------------------------------------------------
-- current_team_id(): equivalente a current_professional_id() (0002),
-- mas pra o team do caller. Usado em RLS de portfolio/subscription
-- quando a gente mover em 0033/0034.
-- =============================================================
drop function if exists public.current_team_id();
create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select team_id from public.team_members where user_id = auth.uid();
$$;

grant execute on function public.current_team_id() to authenticated;

-- is_team_owner(): checa se o caller é owner do team informado.
drop function if exists public.is_team_owner(uuid);
create or replace function public.is_team_owner(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

grant execute on function public.is_team_owner(uuid) to authenticated;

-- =============================================================
-- 4) provision_team_for_user — cria solo team pro user
-- -------------------------------------------------------------
-- Idempotente: se o user já está em algum team, sai sem fazer nada
-- (retorna o team_id existente). Usada pelo trigger de signup e
-- pelo backfill. Retorna o team_id.
-- =============================================================
drop function if exists public.provision_team_for_user(uuid);
create or replace function public.provision_team_for_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_team uuid;
  v_profile       public.profiles%rowtype;
  v_team_id       uuid;
begin
  -- Idempotência: user já tem team? Retorna o existente.
  select tm.team_id into v_existing_team
    from public.team_members tm
    where tm.user_id = p_user_id;
  if v_existing_team is not null then
    return v_existing_team;
  end if;

  -- Lê o profile pra popular slug/name. Se ainda não existe (ordem
  -- de triggers), não dá pra prosseguir — handle_new_user chama
  -- provision_profile ANTES de provision_team, então em prática
  -- sempre existe.
  select * into v_profile
    from public.profiles
    where user_id = p_user_id;
  if not found then
    raise exception 'provision_team_for_user: profile ausente para user_id=%', p_user_id;
  end if;

  insert into public.teams (slug, name, owner_user_id)
    values (v_profile.slug, v_profile.name, p_user_id)
    returning id into v_team_id;

  insert into public.team_members (team_id, user_id, role)
    values (v_team_id, p_user_id, 'owner');

  return v_team_id;
end;
$$;

-- Não é exposta diretamente pelo frontend; só chamada por outras
-- SECURITY DEFINER (handle_new_user, backfill). Sem GRANT execute.

-- =============================================================
-- 5) handle_new_user — passa a provisionar team também
-- -------------------------------------------------------------
-- Ordem importa: provision_profile_for_user ANTES de
-- provision_team_for_user (porque este lê slug/name do profile).
-- ensure_free_subscription continua como antes — move pra 0034
-- quando a gente trocar subscriptions.user_id por team_id.
-- =============================================================
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
  perform public.provision_team_for_user(new.id);
  perform public.ensure_free_subscription(new.id);
  return new;
end;
$$;

-- (o trigger on_auth_user_created já existe desde 0001/0005; só a
-- function foi redefinida.)

-- =============================================================
-- 6) Backfill — todo profile sem team ganha um solo team
-- =============================================================
do $$
declare
  p record;
begin
  for p in
    select pr.user_id
    from public.profiles pr
    left join public.team_members tm on tm.user_id = pr.user_id
    where tm.user_id is null
  loop
    begin
      perform public.provision_team_for_user(p.user_id);
    exception when others then
      raise notice 'backfill team: skipping user_id=% error=%', p.user_id, sqlerrm;
    end;
  end loop;
end$$;

-- =============================================================
-- 7) RLS
-- -------------------------------------------------------------
-- teams:
--   - SELECT público (anon + authenticated): precisamos poder
--     resolver `/p/<team-slug>` sem sessão. Nada sensível na row.
--   - UPDATE: só owner do team.
--   - INSERT/DELETE: via SECURITY DEFINER (provision/invite).
--
-- team_members:
--   - SELECT: visível pra quem é membro do mesmo team (ler colegas)
--     + público pode ler (precisamos listar membros em `/p/<slug>`).
--   - INSERT/DELETE: via SECURITY DEFINER (provision/accept-invite/
--     remove-member).
-- =============================================================
alter table public.teams          enable row level security;
alter table public.team_members   enable row level security;

drop policy if exists "teams_public_select" on public.teams;
drop policy if exists "teams_owner_update"  on public.teams;

create policy "teams_public_select"
  on public.teams
  for select
  to anon, authenticated
  using (true);

create policy "teams_owner_update"
  on public.teams
  for update
  to authenticated
  using (public.is_team_owner(id))
  with check (public.is_team_owner(id));

drop policy if exists "team_members_public_select" on public.team_members;

create policy "team_members_public_select"
  on public.team_members
  for select
  to anon, authenticated
  using (true);

grant select on public.teams, public.team_members to anon, authenticated;
grant update on public.teams to authenticated;

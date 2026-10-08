-- =============================================================
-- 0033_portfolio_team.sql
-- -------------------------------------------------------------
-- Step 2b do refactor "plano por equipe": portfólio passa a ser
-- COMPARTILHADO pela equipe inteira. Qualquer membro do time pode
-- adicionar/editar/remover fotos. `professional_id` continua
-- gravado como "quem subiu" (atribuição), mas o controle de acesso
-- vira baseado em `team_id`.
--
-- Mudanças:
--   1. `portfolio_items.team_id` adicionada + backfill via
--      profile → user → team_members. NOT NULL depois do backfill.
--   2. RLS: policies de INSERT/UPDATE/DELETE agora checam
--      `team_id = current_team_id()` em vez de
--      `professional_id = current_professional_id()`.
--      Permissão `portfolio.manage` continua sendo exigida.
--   3. Storage (`portfolio` bucket): adiciona policies baseadas em
--      `current_team_id()` ao lado das antigas baseadas em
--      `current_professional_id()`. Legacy continua funcionando
--      (membro pode continuar removendo as próprias fotos antigas).
--
-- Observação: endpoint público (`/p/<slug>`) ainda consulta pela
-- lógica atual (ver `src/services/public-profile.ts` — resolver
-- team_id via profile.user_id e re-consultar). Mudança da UI pública
-- vem no Step 2e.
-- =============================================================

-- =============================================================
-- 1) Coluna + backfill + NOT NULL + FK
-- =============================================================
alter table public.portfolio_items
  add column if not exists team_id uuid references public.teams(id) on delete cascade;

update public.portfolio_items pi
   set team_id = tm.team_id
  from public.profiles p
  join public.team_members tm on tm.user_id = p.user_id
 where pi.professional_id = p.id
   and pi.team_id is null;

-- Agora que todos têm team_id, NOT NULL.
alter table public.portfolio_items
  alter column team_id set not null;

create index if not exists portfolio_items_team_pos_idx
  on public.portfolio_items (team_id, position asc, created_at desc);

-- =============================================================
-- 2) RLS: substitui owner_* por team_*
-- -------------------------------------------------------------
-- SELECT público já existe (portfolio_public_select em 0006) e
-- segue intacto — a página /p/<slug> continua lendo sem sessão.
-- O owner_select de 0019 (que restringia o autenticado ao próprio)
-- também é dropado, pois qualquer member do team pode ler os itens.
-- =============================================================
drop policy if exists "portfolio_owner_select" on public.portfolio_items;
drop policy if exists "portfolio_owner_insert" on public.portfolio_items;
drop policy if exists "portfolio_owner_update" on public.portfolio_items;
drop policy if exists "portfolio_owner_delete" on public.portfolio_items;

create policy "portfolio_team_select"
  on public.portfolio_items
  for select
  to authenticated
  using (team_id = public.current_team_id());

create policy "portfolio_team_insert"
  on public.portfolio_items
  for insert
  to authenticated
  with check (
    team_id = public.current_team_id()
    and public.has_feature('portfolio.manage')
  );

create policy "portfolio_team_update"
  on public.portfolio_items
  for update
  to authenticated
  using (
    team_id = public.current_team_id()
    and public.has_feature('portfolio.manage')
  )
  with check (
    team_id = public.current_team_id()
    and public.has_feature('portfolio.manage')
  );

create policy "portfolio_team_delete"
  on public.portfolio_items
  for delete
  to authenticated
  using (
    team_id = public.current_team_id()
    and public.has_feature('portfolio.manage')
  );

-- =============================================================
-- 3) Storage: policies baseadas em current_team_id
-- -------------------------------------------------------------
-- Mantemos as antigas (owner-folder) pra uploads legados
-- continuarem gerenciáveis caso um dia o member precise mexer. As
-- NOVAS policies permitem upload sob o path `{team_id}/<arquivo>`,
-- que é o que o frontend vai usar daqui pra frente.
--
-- Delete de linha em portfolio_items dispara trigger 0029 (service
-- role, bypassa RLS). Então o cleanup funciona independente do
-- formato do path histórico.
-- =============================================================
drop policy if exists "portfolio_team_insert" on storage.objects;
drop policy if exists "portfolio_team_update" on storage.objects;
drop policy if exists "portfolio_team_delete" on storage.objects;

create policy "portfolio_team_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  );

create policy "portfolio_team_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  )
  with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  );

create policy "portfolio_team_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  );

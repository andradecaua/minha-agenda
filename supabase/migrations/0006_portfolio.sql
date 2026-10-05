-- =============================================================
-- 0006_portfolio.sql
-- Tabela de itens de portfólio do profissional.
-- =============================================================

create table if not exists public.portfolio_items (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id) on delete cascade,
  image_url       text not null,          -- URL pública do Storage
  storage_path    text not null,          -- caminho para deletar o blob
  title           text,
  description     text,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  check (length(trim(image_url)) > 0),
  check (length(trim(storage_path)) > 0)
);

create index if not exists portfolio_items_prof_pos_idx
  on public.portfolio_items (professional_id, position asc, created_at desc);

-- RLS ---------------------------------------------------------
alter table public.portfolio_items enable row level security;

drop policy if exists "portfolio_public_select" on public.portfolio_items;
drop policy if exists "portfolio_owner_all"     on public.portfolio_items;

-- Qualquer pessoa pode ler os portfólios (a página /p/:slug depende disso).
create policy "portfolio_public_select"
  on public.portfolio_items
  for select
  to anon, authenticated
  using (true);

-- Só o dono escreve.
create policy "portfolio_owner_all"
  on public.portfolio_items
  for all
  to authenticated
  using (professional_id = public.current_professional_id())
  with check (professional_id = public.current_professional_id());

-- GRANTs ------------------------------------------------------
grant select, insert, update, delete on public.portfolio_items to authenticated;
grant select on public.portfolio_items to anon;

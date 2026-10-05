-- =============================================================
-- 0002_rls_policies.sql
-- Row Level Security — Minha Agenda
-- =============================================================
-- Regra central: todo acesso autenticado é limitado a linhas cujo
-- professional_id pertença ao usuário logado (via mapping user_id→profile).
-- Acesso anônimo é liberado APENAS no que a página pública /p/:slug
-- precisa, e sempre com filtros adicionais (active = true, etc.).
-- =============================================================

-- Helper: id do profile do usuário logado -----------------------
create or replace function public.current_professional_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where user_id = auth.uid();
$$;

-- Enable RLS em todas as tabelas de domínio ---------------------
alter table public.profiles          enable row level security;
alter table public.booking_settings  enable row level security;
alter table public.business_hours    enable row level security;
alter table public.services          enable row level security;
alter table public.clients           enable row level security;
alter table public.appointments      enable row level security;
alter table public.products          enable row level security;

-- =============================================================
-- profiles
-- =============================================================
drop policy if exists "profiles_public_select"  on public.profiles;
drop policy if exists "profiles_owner_update"   on public.profiles;
drop policy if exists "profiles_owner_insert"   on public.profiles;

-- Página pública /p/:slug precisa ler o profile. Nenhum dado sensível aqui.
create policy "profiles_public_select"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

-- Dono atualiza o próprio profile
create policy "profiles_owner_update"
  on public.profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- INSERT em profiles acontece via trigger (handle_new_user) com SECURITY
-- DEFINER. Mesmo assim, se por algum motivo um usuário autenticado
-- tentar inserir, só pode inserir o próprio.
create policy "profiles_owner_insert"
  on public.profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- =============================================================
-- booking_settings
-- =============================================================
drop policy if exists "booking_settings_public_select" on public.booking_settings;
drop policy if exists "booking_settings_owner_all"     on public.booking_settings;

-- Público pode ler regras de agendamento (nada sensível) para a página pública.
create policy "booking_settings_public_select"
  on public.booking_settings
  for select
  to anon, authenticated
  using (true);

create policy "booking_settings_owner_all"
  on public.booking_settings
  for all
  to authenticated
  using (professional_id = public.current_professional_id())
  with check (professional_id = public.current_professional_id());

-- =============================================================
-- business_hours
-- =============================================================
drop policy if exists "business_hours_public_select" on public.business_hours;
drop policy if exists "business_hours_owner_all"     on public.business_hours;

create policy "business_hours_public_select"
  on public.business_hours
  for select
  to anon, authenticated
  using (active = true);

create policy "business_hours_owner_all"
  on public.business_hours
  for all
  to authenticated
  using (professional_id = public.current_professional_id())
  with check (professional_id = public.current_professional_id());

-- =============================================================
-- services
-- =============================================================
drop policy if exists "services_public_select" on public.services;
drop policy if exists "services_owner_all"     on public.services;

create policy "services_public_select"
  on public.services
  for select
  to anon, authenticated
  using (active = true);

create policy "services_owner_all"
  on public.services
  for all
  to authenticated
  using (professional_id = public.current_professional_id())
  with check (professional_id = public.current_professional_id());

-- =============================================================
-- clients  (NUNCA público)
-- =============================================================
drop policy if exists "clients_owner_all" on public.clients;

create policy "clients_owner_all"
  on public.clients
  for all
  to authenticated
  using (professional_id = public.current_professional_id())
  with check (professional_id = public.current_professional_id());

-- =============================================================
-- appointments  (NUNCA público via SELECT direto)
-- =============================================================
drop policy if exists "appointments_owner_all" on public.appointments;

create policy "appointments_owner_all"
  on public.appointments
  for all
  to authenticated
  using (professional_id = public.current_professional_id())
  with check (professional_id = public.current_professional_id());

-- Fluxo público de reserva passa pela RPC `book_appointment` (SECURITY
-- DEFINER), definida em 0003.

-- =============================================================
-- products
-- =============================================================
drop policy if exists "products_public_select" on public.products;
drop policy if exists "products_owner_all"     on public.products;

create policy "products_public_select"
  on public.products
  for select
  to anon, authenticated
  using (active = true);

create policy "products_owner_all"
  on public.products
  for all
  to authenticated
  using (professional_id = public.current_professional_id())
  with check (professional_id = public.current_professional_id());

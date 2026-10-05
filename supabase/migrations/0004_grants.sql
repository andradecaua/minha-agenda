-- =============================================================
-- 0004_grants.sql
-- GRANTs explícitos nas tabelas de domínio.
-- -------------------------------------------------------------
-- Normalmente o Supabase concede isso via `default privileges` do
-- schema `public`. Em alguns projetos o default não "pega" (depende do
-- role que executou a migration / da ordem de criação) e o PostgREST
-- responde HTTP 403 "permission denied" mesmo com RLS correto.
-- RLS só filtra o que o GRANT já permitiu: sem GRANT, não há acesso.
-- =============================================================

-- Schema
grant usage on schema public to anon, authenticated;

-- `authenticated`: CRUD em todas as tabelas de domínio (RLS filtra o
-- que ele pode de fato ler/escrever).
grant select, insert, update, delete on
  public.profiles,
  public.booking_settings,
  public.business_hours,
  public.services,
  public.clients,
  public.appointments,
  public.products
  to authenticated;

-- `anon`: só SELECT nas tabelas expostas publicamente pela RLS. Nunca
-- insere/altera direto; qualquer escrita anônima passa por RPC
-- (`book_appointment`, SECURITY DEFINER).
grant select on
  public.profiles,
  public.booking_settings,
  public.business_hours,
  public.services,
  public.products
  to anon;

-- Função helper usada dentro das policies. Default do Postgres já é
-- GRANT EXECUTE TO PUBLIC em funções novas, mas deixamos explícito.
grant execute on function public.current_professional_id() to anon, authenticated;

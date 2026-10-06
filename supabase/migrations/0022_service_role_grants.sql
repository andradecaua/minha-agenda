-- =============================================================
-- 0022_service_role_grants.sql
-- -------------------------------------------------------------
-- Garante que `service_role` (usado pelas Edge Functions via a
-- SERVICE_ROLE_KEY) possa ler/escrever nas tabelas do schema public.
--
-- Contexto: por padrão o Supabase concede grants a `service_role`
-- automaticamente em cada CREATE TABLE, mas em alguns projetos
-- (configurações de default privileges customizadas) isso não cola.
-- Resultado: a edge function com service_role recebe 42501
-- "permission denied" ao ler tabelas, mesmo bypassando RLS.
--
-- Lembrete: `service_role` já bypassa RLS por default. Grants aqui
-- cobrem a camada de permissões de tabela (ACL), que é separada.
-- =============================================================

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Default privileges: novas tabelas/funções criadas futuramente
-- herdam o grant sem precisar lembrar.
alter default privileges in schema public
  grant all privileges on tables    to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant all privileges on functions to service_role;

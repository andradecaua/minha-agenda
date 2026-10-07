-- =============================================================
-- 0028_tighten_storage_select.sql
-- -------------------------------------------------------------
-- Remove as policies de SELECT amplas em `storage.objects` dos 4
-- buckets públicos (avatars, portfolio, products, services).
--
-- Contexto do advisor Supabase:
--   "Clients can list all files in this bucket. A broad SELECT
--    policy on storage.objects allows clients to retrieve a full
--    list of files."
--
-- Por que podemos dropar com segurança:
--
--  1. Buckets têm `public = true`. O endpoint
--     `/storage/v1/object/public/<bucket>/<path>` SERVE o arquivo
--     direto (CDN), SEM passar por RLS. Logo renderizar <img
--     src={publicUrl}> continua funcionando normal.
--
--  2. Varredura do código em `src/services/storage.ts` + grep
--     global: NENHUMA chamada a `.list()`, `.download()` ou
--     `createSignedUrl()`. Só usamos `upload()` (INSERT),
--     `getPublicUrl()` (bypass RLS) e `remove()` (DELETE).
--
--  3. INSERT/UPDATE/DELETE policies já restringem escrita ao dono
--     via prefixo do path (migrations 0007, 0012, 0026). Nada
--     muda aqui.
--
-- O que a policy ampla permitia e agora NÃO permite mais:
--   - `supabase.storage.from('portfolio').list()` listava arquivos
--     de todos os profissionais pra qualquer visitante — enumeration
--     que concorrente podia usar pra espelhar portfolio alheio.
--   - Mesmo pra buckets intrinsecamente públicos, listar paths com
--     metadados (sizes, timestamps) é mais informação do que o CDN
--     entrega quando serve um arquivo específico.
--
-- Se futuramente precisarmos listar (ex.: galeria "meus uploads"
-- dentro do painel), criamos uma policy de SELECT com check de
-- prefixo (`(storage.foldername(name))[1] =
-- public.current_professional_id()::text`) — dono vê os próprios,
-- ninguém enumera o resto.
-- =============================================================

drop policy if exists "avatars_public_select"   on storage.objects;
drop policy if exists "portfolio_public_select" on storage.objects;
drop policy if exists "products_public_select"  on storage.objects;
drop policy if exists "services_public_select"  on storage.objects;

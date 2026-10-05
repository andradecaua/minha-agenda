-- =============================================================
-- 0007_storage.sql
-- Buckets de Storage e policies para avatars e portfolio.
-- =============================================================
-- Convenção de caminho:
--   avatars/{professional_id}/{random}.{ext}
--   portfolio/{professional_id}/{random}.{ext}
--
-- Com esse padrão, a policy filtra escritas por folder: só o dono
-- (professional_id = current_professional_id()) pode escrever naquele
-- prefixo. SELECT é público, porque /p/:slug precisa carregar as
-- imagens sem autenticação.
-- =============================================================

-- Buckets -----------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',   'avatars',   true, 2 * 1024 * 1024, array['image/jpeg','image/png','image/webp']),
  ('portfolio', 'portfolio', true, 5 * 1024 * 1024, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Policies em storage.objects ---------------------------------
-- (storage.foldername(name))[1] = primeiro segmento do caminho (= professional_id)

-- SELECT público nos dois buckets
drop policy if exists "avatars_public_select"   on storage.objects;
drop policy if exists "portfolio_public_select" on storage.objects;

create policy "avatars_public_select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

create policy "portfolio_public_select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'portfolio');

-- INSERT: só dono (caminho começa com o id do próprio profile)
drop policy if exists "avatars_owner_insert"   on storage.objects;
drop policy if exists "portfolio_owner_insert" on storage.objects;

create policy "avatars_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

create policy "portfolio_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

-- UPDATE: só dono
drop policy if exists "avatars_owner_update"   on storage.objects;
drop policy if exists "portfolio_owner_update" on storage.objects;

create policy "avatars_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

create policy "portfolio_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  )
  with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

-- DELETE: só dono
drop policy if exists "avatars_owner_delete"   on storage.objects;
drop policy if exists "portfolio_owner_delete" on storage.objects;

create policy "avatars_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

create policy "portfolio_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

-- =============================================================
-- 0012_products_bucket.sql
-- Bucket de Storage para imagens de produtos.
-- -------------------------------------------------------------
-- Mesma convenção dos outros buckets:
--   products/{professional_id}/{random}.{ext}
-- Policies: SELECT público; INSERT/UPDATE/DELETE só do dono
-- (identificado pelo prefixo do path).
-- =============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('products', 'products', true, 5 * 1024 * 1024, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- SELECT público
drop policy if exists "products_public_select" on storage.objects;
create policy "products_public_select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'products');

-- INSERT dono
drop policy if exists "products_owner_insert" on storage.objects;
create policy "products_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

-- UPDATE dono
drop policy if exists "products_owner_update" on storage.objects;
create policy "products_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  )
  with check (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

-- DELETE dono
drop policy if exists "products_owner_delete" on storage.objects;
create policy "products_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'products'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

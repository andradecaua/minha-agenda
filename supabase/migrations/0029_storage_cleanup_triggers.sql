-- =============================================================
-- 0029_storage_cleanup_triggers.sql
-- -------------------------------------------------------------
-- Garante que apagar um portfolio_item / service / product / avatar
-- também remove o blob correspondente de `storage.objects`.
--
-- Antes: o frontend chamava `supabase.storage.remove()` depois do
-- DELETE da linha, dentro de try/catch que ENGOLIA erros. Blobs
-- ficavam acumulando no bucket mesmo depois do "excluir" na UI.
--
-- Agora: triggers AFTER DELETE / UPDATE rodam na MESMA transação
-- do write principal, com SECURITY DEFINER (dono do schema =
-- postgres, bypassa RLS de storage). Se o cleanup falhar, a
-- transação toda falha — nunca mais DB sem blob OU blob sem DB.
--
-- Também incluímos cleanup único de órfãos existentes (blobs sem
-- linha dona), rodado no fim da migration.
-- =============================================================

-- =============================================================
-- 1) Helper: extrai o caminho interno de uma public URL
-- -------------------------------------------------------------
-- Útil pros buckets `products` e `avatars`, cujas tabelas donas
-- (products, profiles) guardam só o URL público — não o path cru.
-- Para `portfolio_items` e `services` já temos coluna dedicada e
-- não precisamos deste helper, mas deixamos genérico pra reuso.
-- =============================================================
create or replace function public.storage_path_from_public_url(
  p_bucket text,
  p_url    text
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_url is null then null
    when position('/storage/v1/object/public/' || p_bucket || '/' in p_url) = 0 then null
    else substring(
      p_url
      from position('/storage/v1/object/public/' || p_bucket || '/' in p_url)
         + length('/storage/v1/object/public/' || p_bucket || '/')
    )
  end;
$$;

-- =============================================================
-- 2) Triggers por bucket
-- -------------------------------------------------------------
-- Função genérica DELETE do storage. Idempotente — se o blob já
-- sumiu (apagado por admin, cleanup antigo, etc.) o DELETE
-- continua retornando sem erro.
-- =============================================================

-- --- portfolio_items ----------------------------------------------
create or replace function public.cleanup_portfolio_blob_fn()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if OLD.storage_path is not null and OLD.storage_path <> '' then
    delete from storage.objects
    where bucket_id = 'portfolio' and name = OLD.storage_path;
  end if;
  return OLD;
end;
$$;

drop trigger if exists portfolio_items_cleanup_blob on public.portfolio_items;
create trigger portfolio_items_cleanup_blob
  after delete on public.portfolio_items
  for each row execute function public.cleanup_portfolio_blob_fn();

-- --- services -----------------------------------------------------
create or replace function public.cleanup_services_blob_fn()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_old text;
begin
  if TG_OP = 'DELETE' then
    v_old := coalesce(
      OLD.image_storage_path,
      public.storage_path_from_public_url('services', OLD.image_url)
    );
    if v_old is not null and v_old <> '' then
      delete from storage.objects where bucket_id = 'services' and name = v_old;
    end if;
    return OLD;
  end if;

  -- UPDATE: só limpa se o caminho realmente mudou (ou foi zerado).
  if TG_OP = 'UPDATE' then
    v_old := coalesce(
      OLD.image_storage_path,
      public.storage_path_from_public_url('services', OLD.image_url)
    );
    if v_old is not null and v_old <> '' and v_old is distinct from coalesce(
         NEW.image_storage_path,
         public.storage_path_from_public_url('services', NEW.image_url)
       )
    then
      delete from storage.objects where bucket_id = 'services' and name = v_old;
    end if;
    return NEW;
  end if;

  return null;
end;
$$;

drop trigger if exists services_cleanup_blob_del on public.services;
create trigger services_cleanup_blob_del
  after delete on public.services
  for each row execute function public.cleanup_services_blob_fn();

drop trigger if exists services_cleanup_blob_upd on public.services;
create trigger services_cleanup_blob_upd
  after update of image_url, image_storage_path on public.services
  for each row execute function public.cleanup_services_blob_fn();

-- --- products -----------------------------------------------------
create or replace function public.cleanup_products_blob_fn()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_old text;
begin
  if TG_OP = 'DELETE' then
    v_old := public.storage_path_from_public_url('products', OLD.image_url);
    if v_old is not null and v_old <> '' then
      delete from storage.objects where bucket_id = 'products' and name = v_old;
    end if;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    v_old := public.storage_path_from_public_url('products', OLD.image_url);
    if v_old is not null and v_old <> ''
       and v_old is distinct from public.storage_path_from_public_url('products', NEW.image_url)
    then
      delete from storage.objects where bucket_id = 'products' and name = v_old;
    end if;
    return NEW;
  end if;

  return null;
end;
$$;

drop trigger if exists products_cleanup_blob_del on public.products;
create trigger products_cleanup_blob_del
  after delete on public.products
  for each row execute function public.cleanup_products_blob_fn();

drop trigger if exists products_cleanup_blob_upd on public.products;
create trigger products_cleanup_blob_upd
  after update of image_url on public.products
  for each row execute function public.cleanup_products_blob_fn();

-- --- profiles (avatar) -------------------------------------------
create or replace function public.cleanup_avatar_blob_fn()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_old text;
begin
  if TG_OP = 'DELETE' then
    v_old := public.storage_path_from_public_url('avatars', OLD.avatar_url);
    if v_old is not null and v_old <> '' then
      delete from storage.objects where bucket_id = 'avatars' and name = v_old;
    end if;
    return OLD;
  end if;

  if TG_OP = 'UPDATE' then
    v_old := public.storage_path_from_public_url('avatars', OLD.avatar_url);
    if v_old is not null and v_old <> ''
       and v_old is distinct from public.storage_path_from_public_url('avatars', NEW.avatar_url)
    then
      delete from storage.objects where bucket_id = 'avatars' and name = v_old;
    end if;
    return NEW;
  end if;

  return null;
end;
$$;

drop trigger if exists profiles_cleanup_avatar_del on public.profiles;
create trigger profiles_cleanup_avatar_del
  after delete on public.profiles
  for each row execute function public.cleanup_avatar_blob_fn();

drop trigger if exists profiles_cleanup_avatar_upd on public.profiles;
create trigger profiles_cleanup_avatar_upd
  after update of avatar_url on public.profiles
  for each row execute function public.cleanup_avatar_blob_fn();

-- =============================================================
-- 3) Cleanup único de órfãos
-- -------------------------------------------------------------
-- Blobs que ficaram no bucket por causa do bug anterior (DB row
-- apagada, blob permaneceu). Rodamos uma vez e pronto — triggers
-- previnem reinfestação.
--
-- Idempotente: apagar algo que não existe = no-op.
-- =============================================================

-- portfolio: tudo em storage que não tem linha dona
delete from storage.objects o
where o.bucket_id = 'portfolio'
  and not exists (
    select 1 from public.portfolio_items p
    where p.storage_path = o.name
  );

-- services: pode usar coluna OU url, cobre os dois jeitos
delete from storage.objects o
where o.bucket_id = 'services'
  and not exists (
    select 1 from public.services s
    where s.image_storage_path = o.name
       or public.storage_path_from_public_url('services', s.image_url) = o.name
  );

-- products: usa só url
delete from storage.objects o
where o.bucket_id = 'products'
  and not exists (
    select 1 from public.products p
    where public.storage_path_from_public_url('products', p.image_url) = o.name
  );

-- avatars: ligado a profiles.avatar_url
delete from storage.objects o
where o.bucket_id = 'avatars'
  and not exists (
    select 1 from public.profiles pr
    where public.storage_path_from_public_url('avatars', pr.avatar_url) = o.name
  );

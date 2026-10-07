-- =============================================================
-- 0026_icons_and_custom_images.sql
-- -------------------------------------------------------------
-- Adiciona duas camadas de personalização aos cadastros de
-- serviço e produto:
--
--   1. Ícone (ambos, grátis pra todo mundo) — coluna `icon text`
--      guardando o NOME de um ícone do lucide-react (ex.: 'Scissors',
--      'Sparkles'). O frontend tem um catálogo curado em
--      `src/lib/icons.ts` — a validação de qual ícone é válido
--      acontece no form, não no banco (lista pode evoluir sem
--      migração).
--
--   2. Foto personalizada (atrás da nova permissão `custom_images`):
--      - Produtos já tinham `image_url` desde a 0012. Nada muda no
--        schema aqui — só o frontend passa a esconder o upload pra
--        quem não tem a permissão. Fotos já existentes continuam
--        visíveis.
--      - Serviços ganham `image_url text` + `image_storage_path text`
--        novas colunas, no padrão de produtos.
--      - Novo bucket `services` no Storage, mesmas policies do
--        `products` (SELECT público, CRUD só do dono via prefixo
--        do path).
--
-- Backward compat:
--   - Plano `pro` ganha automaticamente a permissão `custom_images`
--     pra evitar regressão (users atuais no pro já conseguiam
--     mandar foto em produtos).
-- =============================================================

-- =============================================================
-- 1) Colunas icon + image em services; icon em products
-- =============================================================
alter table public.services add column if not exists icon text;
alter table public.services add column if not exists image_url text;
alter table public.services add column if not exists image_storage_path text;

alter table public.products add column if not exists icon text;

comment on column public.services.icon is
  'Nome do ícone (lucide-react) selecionado no form. NULL = sem ícone.';
comment on column public.products.icon is
  'Nome do ícone (lucide-react) selecionado no form. NULL = sem ícone.';
comment on column public.services.image_url is
  'URL pública da foto do serviço no bucket `services`. NULL = sem foto. Acesso restrito à permissão custom_images (gate no UI).';

-- =============================================================
-- 2) Nova permissão `custom_images`
-- =============================================================
insert into public.permission_catalog (code, name, description, category)
values (
  'custom_images',
  'Fotos personalizadas',
  'Permite anexar fotos em serviços e produtos (além dos ícones padrão).',
  'conteudo'
)
on conflict (code) do nothing;

-- =============================================================
-- 3) Plano `pro` herda a permissão nova
-- -------------------------------------------------------------
-- Evita regressão: quem está em `pro` hoje já conseguia subir foto
-- em produtos (desde a 0012). Com `custom_images` virando guard
-- do frontend, o plano precisa ter a permissão pra o fluxo seguir
-- funcionando. Idempotente — se já tiver, mantém.
-- =============================================================
update public.plans
  set permissions = (
    select array(select distinct unnest(permissions || array['custom_images']))
  )
  where code = 'pro'
    and not ('custom_images' = any(permissions));

-- =============================================================
-- 4) Bucket `services` no Storage + policies
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('services', 'services', true, 5 * 1024 * 1024, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- SELECT público
drop policy if exists "services_public_select" on storage.objects;
create policy "services_public_select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'services');

-- INSERT dono
drop policy if exists "services_owner_insert" on storage.objects;
create policy "services_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'services'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

-- UPDATE dono
drop policy if exists "services_owner_update" on storage.objects;
create policy "services_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'services'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  )
  with check (
    bucket_id = 'services'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

-- DELETE dono
drop policy if exists "services_owner_delete" on storage.objects;
create policy "services_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'services'
    and (storage.foldername(name))[1] = public.current_professional_id()::text
  );

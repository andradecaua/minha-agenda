-- =============================================================
-- 0039_profile_background.sql
-- -------------------------------------------------------------
-- Plano de fundo personalizado da página pública da equipe. Nova
-- permissão `profile.background` controla quem pode subir — plano
-- gratuito segue sem o recurso.
--
-- Decisões:
--
--  1. Campo mora em `teams`, não `profiles`. Página pública é só
--     a do owner (/p/<owner-slug>), e o portfólio+serviços já são
--     team-level. Manter background no team mantém a semântica
--     "assets de brand do time". Qualquer membro com a permissão
--     pode trocar — igual portfolio.
--
--  2. Write via RPC `update_team_background` SECURITY DEFINER em
--     vez de policy UPDATE na tabela. Motivo: a policy existente
--     em `teams` restringe UPDATE a `is_team_owner()`. Não quero
--     relaxar isso só pro background, então a RPC checa "é member
--     + tem feature" e faz o UPDATE com privilégio elevado.
--
--  3. Storage bucket novo `backgrounds`, public read. Upload sob
--     path `{team_id}/<rand>.ext`. Policies de escrita checam
--     `current_team_id()` + `has_feature('profile.background')`.
--
--  4. Cleanup do blob é frontend-driven (Storage API). O padrão
--     de 0029 (trigger AFTER DELETE/UPDATE deletando direto em
--     storage.objects) parou de funcionar: Supabase adicionou
--     proteção que bloqueia DELETE direto na tabela mesmo via
--     SECURITY DEFINER ("Direct deletion from storage tables is
--     not allowed. Use the Storage API instead."). O frontend
--     chama `supabase.storage.remove()` após a RPC — se o delete
--     do blob falhar, fica um órfão (aceitável; sem risco de blob
--     sem DB).
-- =============================================================

-- =============================================================
-- 1) Coluna + extração de path do URL público (reusa helper 0029)
-- =============================================================
alter table public.teams
  add column if not exists background_url text,
  add column if not exists background_storage_path text;

-- =============================================================
-- 2) Permissão nova no catálogo
-- =============================================================
insert into public.permission_catalog (code, name, description, category) values
  ('profile.background',
   'Plano de fundo personalizado',
   'Imagem de fundo exibida no topo da página pública da equipe.',
   'profile')
on conflict (code) do update set
  name        = excluded.name,
  description = excluded.description,
  category    = excluded.category;

-- Plano `pro` ganha a permissão (padrão da 0026 pra features novas).
-- Idempotente: se já tiver, mantém. `free` segue sem o recurso.
update public.plans
  set permissions = (
    select array(select distinct unnest(permissions || array['profile.background']))
  )
  where code = 'pro'
    and not ('profile.background' = any(permissions));

-- =============================================================
-- 3) Bucket de storage
-- =============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'backgrounds',
  'backgrounds',
  true,
  5 * 1024 * 1024,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- =============================================================
-- 4) Policies do bucket (path começa com team_id + feature flag)
-- =============================================================
drop policy if exists "backgrounds_team_insert" on storage.objects;
drop policy if exists "backgrounds_team_update" on storage.objects;
drop policy if exists "backgrounds_team_delete" on storage.objects;

create policy "backgrounds_team_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'backgrounds'
    and (storage.foldername(name))[1] = public.current_team_id()::text
    and public.has_feature('profile.background')
  );

create policy "backgrounds_team_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'backgrounds'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  )
  with check (
    bucket_id = 'backgrounds'
    and (storage.foldername(name))[1] = public.current_team_id()::text
    and public.has_feature('profile.background')
  );

create policy "backgrounds_team_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'backgrounds'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  );

-- =============================================================
-- 5) RPC: update_team_background
-- -------------------------------------------------------------
-- Qualquer membro do time atual com `has_feature('profile.background')`
-- pode setar/trocar/remover. Passa `null` nos dois args pra remover.
-- =============================================================
create or replace function public.update_team_background(
  p_url  text,
  p_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid := public.current_team_id();
begin
  if v_team_id is null then
    return jsonb_build_object('status','error','error','no_team');
  end if;

  if not public.has_feature('profile.background') then
    return jsonb_build_object('status','error','error','feature_locked');
  end if;

  update public.teams
     set background_url          = p_url,
         background_storage_path = p_path
   where id = v_team_id;

  return jsonb_build_object('status','ok');
end;
$$;

revoke all on function public.update_team_background(text, text) from public, anon;
grant execute on function public.update_team_background(text, text) to authenticated;

-- =============================================================
-- 6) Cleanup do blob antigo é feito no frontend
-- -------------------------------------------------------------
-- Supabase passou a bloquear DELETE direto em storage.objects
-- (erro 42501, "Use the Storage API instead") mesmo com SECURITY
-- DEFINER, então o padrão da 0029 não serve aqui. O ProfilePage
-- chama `supabase.storage.remove()` depois da RPC de update.
-- Drop defensivo caso uma versão antiga desta migração tenha
-- deixado o trigger criado.
-- =============================================================
drop trigger if exists teams_cleanup_background_del on public.teams;
drop trigger if exists teams_cleanup_background_upd on public.teams;
drop function if exists public.cleanup_team_background_fn();

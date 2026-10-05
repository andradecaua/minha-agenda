-- =============================================================
-- 0005_backfill_profiles.sql
-- -------------------------------------------------------------
-- Objetivo:
--  1) Extrair a lógica de "criar profile + settings + horários default"
--     para uma função reutilizável, `provision_profile_for_user`.
--  2) Refatorar `handle_new_user` para apenas delegar.
--  3) Fazer backfill: para todo usuário em `auth.users` que ainda não
--     tenha um profile, provisionar agora.
--
-- Por que? Em um ciclo de desenvolvimento, usuários podem ter sido
-- criados ANTES do trigger `on_auth_user_created` existir / funcionar.
-- Esse arquivo cobre esse caso de forma idempotente.
-- =============================================================

-- Função reutilizável -----------------------------------------
-- Recebe os campos vindos de `auth.users` e cria profile +
-- booking_settings + business_hours default. É SECURITY DEFINER para
-- bypassar RLS (owner é postgres / superuser em projetos Supabase).
-- Idempotente: se o profile já existe para o user_id, sai como no-op.

create or replace function public.provision_profile_for_user(
  p_user_id              uuid,
  p_email                text,
  p_raw_user_meta_data   jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
  v_slug_base    text;
  v_slug         text;
  v_profile_id   uuid;
  v_attempt      int := 0;
begin
  -- Já existe profile? Retorna o id dele.
  select id into v_profile_id from public.profiles where user_id = p_user_id;
  if v_profile_id is not null then
    return v_profile_id;
  end if;

  -- Nome legível com fallbacks sucessivos
  v_display_name := coalesce(
    nullif(trim(p_raw_user_meta_data ->> 'name'), ''),
    split_part(p_email, '@', 1),
    'Profissional'
  );

  -- Slug a partir do nome, com fallback e desambiguação
  v_slug_base := nullif(public.slugify(v_display_name), '');
  if v_slug_base is null then
    v_slug_base := 'prof';
  end if;

  v_slug := v_slug_base;
  loop
    exit when not exists (select 1 from public.profiles where slug = v_slug);
    v_attempt := v_attempt + 1;
    v_slug := v_slug_base || '-' || substr(md5(random()::text || v_attempt::text), 1, 6);
    if v_attempt > 20 then
      raise exception 'could_not_generate_unique_slug';
    end if;
  end loop;

  insert into public.profiles (user_id, slug, name)
    values (p_user_id, v_slug, v_display_name)
    returning id into v_profile_id;

  insert into public.booking_settings (professional_id) values (v_profile_id);

  -- Horários default: Seg–Sex 08–18, Sáb 08–13, Dom fechado
  insert into public.business_hours (professional_id, weekday, start_time, end_time, active)
  values
    (v_profile_id, 1, '08:00', '18:00', true),
    (v_profile_id, 2, '08:00', '18:00', true),
    (v_profile_id, 3, '08:00', '18:00', true),
    (v_profile_id, 4, '08:00', '18:00', true),
    (v_profile_id, 5, '08:00', '18:00', true),
    (v_profile_id, 6, '08:00', '13:00', true);

  return v_profile_id;
end;
$$;

-- Trigger agora delega a função ------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.provision_profile_for_user(
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  );
  return new;
end;
$$;

-- Garante que o trigger exista (idempotente)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill ----------------------------------------------------
-- Para cada usuário em auth.users sem profile, provisiona agora.
-- Loop em plpgsql para que uma linha problemática não derrube o
-- bloco inteiro (RAISE NOTICE em caso de falha pontual).
do $$
declare
  u record;
begin
  for u in
    select au.id, au.email, coalesce(au.raw_user_meta_data, '{}'::jsonb) as meta
    from auth.users au
    left join public.profiles p on p.user_id = au.id
    where p.id is null
  loop
    begin
      perform public.provision_profile_for_user(u.id, u.email, u.meta);
    exception when others then
      raise notice 'Falha ao provisionar profile para user_id=%: %', u.id, sqlerrm;
    end;
  end loop;
end$$;

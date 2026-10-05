-- =============================================================
-- 0001_initial_schema.sql
-- Minha Agenda — schema inicial
-- =============================================================
-- Idempotente para rodar em dev. Para produção, prefira o Supabase CLI.
-- =============================================================

-- Extensões necessárias ---------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "btree_gist"; -- EXCLUDE com uuid + tstzrange
create extension if not exists "citext";     -- email case-insensitive

-- Enums --------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type public.appointment_status as enum (
      'pending', 'confirmed', 'cancelled', 'completed', 'no_show'
    );
  end if;
end$$;

-- Função genérica de updated_at --------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================
-- profiles (1:1 com auth.users)
-- =============================================================
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  slug        text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  name        text not null check (length(trim(name)) > 0),
  bio         text,
  avatar_url  text,
  phone       text,
  city        text,
  timezone    text not null default 'America/Sao_Paulo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_slug_idx on public.profiles (slug);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =============================================================
-- booking_settings (1:1 com profile)
-- =============================================================
create table if not exists public.booking_settings (
  id                             uuid primary key default gen_random_uuid(),
  professional_id                uuid not null unique
                                   references public.profiles(id) on delete cascade,
  minimum_advance_minutes        integer not null default 120 check (minimum_advance_minutes >= 0),
  maximum_advance_days           integer not null default 30  check (maximum_advance_days  >= 1),
  require_confirmation           boolean not null default false,
  cancellation_enabled           boolean not null default true,
  cancellation_deadline_minutes  integer not null default 120 check (cancellation_deadline_minutes >= 0),
  default_interval_minutes       integer not null default 15  check (default_interval_minutes >= 5),
  online_booking_enabled         boolean not null default true,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

drop trigger if exists trg_booking_settings_updated_at on public.booking_settings;
create trigger trg_booking_settings_updated_at
  before update on public.booking_settings
  for each row execute function public.set_updated_at();

-- =============================================================
-- business_hours (N por profissional/weekday)
-- =============================================================
create table if not exists public.business_hours (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id) on delete cascade,
  weekday         smallint not null check (weekday between 0 and 6), -- 0=Dom .. 6=Sáb
  start_time      time not null,
  end_time        time not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists business_hours_prof_weekday_idx
  on public.business_hours (professional_id, weekday);

-- =============================================================
-- services
-- =============================================================
create table if not exists public.services (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references public.profiles(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  description      text,
  price_cents      integer not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 24*60),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists services_prof_active_idx
  on public.services (professional_id) where active;

drop trigger if exists trg_services_updated_at on public.services;
create trigger trg_services_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- =============================================================
-- clients
-- =============================================================
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  phone           text,
  email           citext,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Mesmo profissional não pode ter dois clientes com o mesmo telefone.
create unique index if not exists clients_prof_phone_unique_idx
  on public.clients (professional_id, phone)
  where phone is not null;

create index if not exists clients_prof_idx on public.clients (professional_id);

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- =============================================================
-- appointments
-- =============================================================
create table if not exists public.appointments (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id) on delete cascade,
  client_id       uuid not null references public.clients(id)  on delete restrict,
  service_id      uuid not null references public.services(id) on delete restrict,
  start_at        timestamptz not null,
  end_at          timestamptz not null,
  status          public.appointment_status not null default 'pending',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_at > start_at),
  -- Prevenção atômica de conflito: nenhum par de agendamentos ATIVOS do
  -- mesmo profissional pode se sobrepor no tempo. O banco garante — não
  -- o aplicativo.
  constraint appointments_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status in ('pending','confirmed'))
);

create index if not exists appointments_prof_start_idx
  on public.appointments (professional_id, start_at);

create index if not exists appointments_client_idx
  on public.appointments (client_id);

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- =============================================================
-- products
-- =============================================================
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.profiles(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  description     text,
  price_cents     integer not null check (price_cents >= 0),
  stock           integer not null default 0 check (stock >= 0),
  sku             text,
  image_url       text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists products_prof_active_idx
  on public.products (professional_id) where active;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- =============================================================
-- Provisionamento automático ao criar usuário
-- =============================================================
-- unaccent é uma extensão; para evitar dependência extra, fazemos um
-- coalesce manual trocando os acentos mais comuns.
create or replace function public.unaccent_coalesce(input text)
returns text
language sql
immutable
as $$
  select translate(
    coalesce(input, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  );
$$;

-- Sanitização simples de slug a partir do nome/email + sufixo aleatório
-- para colisões. Depende de unaccent_coalesce (acima).
create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      lower(public.unaccent_coalesce(input)),
      '[^a-z0-9]+', '-', 'g'
    ),
    '(^-+|-+$)', '', 'g'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
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
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1),
    'Profissional'
  );

  v_slug_base := nullif(public.slugify(v_display_name), '');
  if v_slug_base is null then
    v_slug_base := 'prof';
  end if;

  -- Tenta slug base, depois sufixa até achar livre
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
    values (new.id, v_slug, v_display_name)
    returning id into v_profile_id;

  insert into public.booking_settings (professional_id) values (v_profile_id);

  -- Horários default: Seg-Sex 08-18, Sáb 08-13, Dom fechado
  insert into public.business_hours (professional_id, weekday, start_time, end_time, active)
  values
    (v_profile_id, 1, '08:00', '18:00', true),
    (v_profile_id, 2, '08:00', '18:00', true),
    (v_profile_id, 3, '08:00', '18:00', true),
    (v_profile_id, 4, '08:00', '18:00', true),
    (v_profile_id, 5, '08:00', '18:00', true),
    (v_profile_id, 6, '08:00', '13:00', true);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

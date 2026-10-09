-- =============================================================
-- 0038_services_team.sql
-- -------------------------------------------------------------
-- Services passam a ser COMPARTILHADOS pela equipe (mesmo padrão do
-- portfolio em 0033). Qualquer membro do time edita/cria/remove a
-- mesma lista. `professional_id` continua gravado como "autor"
-- (quem criou) — útil pra auditoria futura — mas o controle de
-- acesso vira baseado em `team_id`.
--
-- Impacto semântico: um corte, um preço, uma duração — iguais pros
-- dois profissionais. Appointments continuam linkando o
-- `professional_id` do pro que vai atender (quem faz, não muda).
-- O `service_id` do appointment aponta pra lista do time.
--
-- Mudanças:
--   1. `services.team_id` adicionada + backfill via profile → user
--      → team_members → team_id. NOT NULL depois.
--   2. RLS: owner_all dropada; team_select/insert/update/delete
--      novas. SELECT público (`services_public_select` de 0002) é
--      mantido intacto — página /p/<slug> continua lendo sem sessão.
--   3. Quota: `enforce_services_quota` passa a contar direto por
--      `services.team_id` em vez do join services→profiles→
--      team_members. Mais simples e consistente com a nova coluna.
--   4. Storage (`services` bucket): policies baseadas em
--      `current_team_id()` ao lado das antigas por
--      `current_professional_id()`. Legacy continua funcionando pra
--      blobs já no bucket; uploads novos usam path `{team_id}/...`.
-- =============================================================

-- =============================================================
-- 1) Coluna + backfill + NOT NULL + índice
-- =============================================================
alter table public.services
  add column if not exists team_id uuid references public.teams(id) on delete cascade;

update public.services s
   set team_id = tm.team_id
  from public.profiles p
  join public.team_members tm on tm.user_id = p.user_id
 where s.professional_id = p.id
   and s.team_id is null;

alter table public.services
  alter column team_id set not null;

create index if not exists services_team_active_idx
  on public.services (team_id, active);

-- =============================================================
-- 2) RLS: substitui owner_all por team_*
-- -------------------------------------------------------------
-- `services_public_select` (0002) continua intacto — qualquer um
-- (anon ou autenticado) lê services com active=true via /p/<slug>.
-- A owner_all protegia leituras privadas (ex.: inativos) e writes
-- — ambos passam a ser team-wide.
-- =============================================================
drop policy if exists "services_owner_all"    on public.services;
drop policy if exists "services_team_select"  on public.services;
drop policy if exists "services_team_insert"  on public.services;
drop policy if exists "services_team_update"  on public.services;
drop policy if exists "services_team_delete"  on public.services;

create policy "services_team_select"
  on public.services
  for select
  to authenticated
  using (team_id = public.current_team_id());

create policy "services_team_insert"
  on public.services
  for insert
  to authenticated
  with check (team_id = public.current_team_id());

create policy "services_team_update"
  on public.services
  for update
  to authenticated
  using (team_id = public.current_team_id())
  with check (team_id = public.current_team_id());

create policy "services_team_delete"
  on public.services
  for delete
  to authenticated
  using (team_id = public.current_team_id());

-- =============================================================
-- 3) Quota: conta por team_id direto
-- -------------------------------------------------------------
-- Antes (0034) fazia services → profiles → team_members pra chegar
-- no team_id. Agora `services.team_id` existe nativamente, então
-- é só contar.
-- =============================================================
create or replace function public.enforce_services_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max   int;
  v_count int;
begin
  if new.team_id is null then
    return new;
  end if;

  select pl.max_services into v_max
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
   where s.team_id = new.team_id
     and s.status in ('active','trialing')
     and (s.expires_at is null or s.expires_at > now())
     and pl.active = true
   limit 1;

  if v_max is null then
    return new;  -- sem limite
  end if;

  select count(*) into v_count
    from public.services
   where team_id = new.team_id;

  if v_count >= v_max then
    raise exception 'quota_services: max % services na equipe', v_max
      using errcode = 'P0100';
  end if;

  return new;
end;
$$;

-- =============================================================
-- 4) Storage: policies baseadas em current_team_id
-- -------------------------------------------------------------
-- Mantemos as antigas (owner-folder) pra uploads já existentes
-- continuarem gerenciáveis. As NOVAS permitem upload sob path
-- `{team_id}/<arquivo>`, que é o que o frontend vai usar daqui pra
-- frente.
--
-- Delete da linha em `services` dispara trigger 0029 (service role,
-- bypassa RLS), então cleanup funciona independente do path.
-- =============================================================
drop policy if exists "services_team_insert" on storage.objects;
drop policy if exists "services_team_update" on storage.objects;
drop policy if exists "services_team_delete" on storage.objects;

create policy "services_team_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'services'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  );

create policy "services_team_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'services'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  )
  with check (
    bucket_id = 'services'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  );

create policy "services_team_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'services'
    and (storage.foldername(name))[1] = public.current_team_id()::text
  );

-- =============================================================
-- 5) `book_appointment`: valida services por team_id
-- -------------------------------------------------------------
-- A versão de 0017 verifica `services.professional_id = v_profile.id`.
-- Com services virando team-shared, essa checagem rejeita (em
-- equipes multi-member) reservas com o pro que NÃO é o criador do
-- service. Rewrite: resolve o team do pro escolhido e valida que o
-- service pertence ao mesmo team. Resto da função fica idêntico.
-- =============================================================
drop function if exists public.book_appointment(text, uuid[], timestamptz, text, text, text, text);

create or replace function public.book_appointment(
  p_slug         text,
  p_service_ids  uuid[],
  p_start_at     timestamptz,
  p_client_name  text,
  p_client_phone text,
  p_client_email text default null,
  p_notes        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile        public.profiles%rowtype;
  v_team_id        uuid;
  v_settings       public.booking_settings%rowtype;
  v_total_price    integer := 0;
  v_total_duration integer := 0;
  v_service        public.services%rowtype;
  v_svc_id         uuid;
  v_svc_ids        uuid[] := coalesce(p_service_ids, array[]::uuid[]);
  v_end_at         timestamptz;
  v_now            timestamptz := now();
  v_weekday        smallint;
  v_local_start    time;
  v_local_end      time;
  v_fits_hours     boolean;
  v_client_id      uuid;
  v_appointment_id uuid;
  v_status         public.appointment_status;
  v_cancel_token   uuid;
  v_name           text;
  v_phone          text;
  v_email          text;
  v_position       integer := 0;
begin
  if array_length(v_svc_ids, 1) is null then
    return jsonb_build_object('status','error','error','service_not_found');
  end if;

  select * into v_profile from public.profiles where slug = p_slug;
  if not found then
    return jsonb_build_object('status','error','error','profile_not_found');
  end if;

  -- Team do pro escolhido. Services são team-shared desde 0038, então
  -- validamos "service pertence ao mesmo team do pro".
  select tm.team_id into v_team_id
    from public.team_members tm
    where tm.user_id = v_profile.user_id;
  if v_team_id is null then
    return jsonb_build_object('status','error','error','profile_not_found');
  end if;

  select * into v_settings
    from public.booking_settings
    where professional_id = v_profile.id;
  if not found or v_settings.online_booking_enabled = false then
    return jsonb_build_object('status','error','error','bookings_disabled');
  end if;

  foreach v_svc_id in array v_svc_ids loop
    select * into v_service
      from public.services
      where id = v_svc_id
        and team_id = v_team_id;

    if not found then
      return jsonb_build_object('status','error','error','service_not_found');
    end if;
    if v_service.active = false then
      return jsonb_build_object('status','error','error','service_inactive');
    end if;

    v_total_price    := v_total_price + v_service.price_cents;
    v_total_duration := v_total_duration + v_service.duration_minutes;
  end loop;

  if v_total_duration <= 0 then
    return jsonb_build_object('status','error','error','service_not_found');
  end if;

  v_name  := nullif(trim(p_client_name), '');
  v_phone := regexp_replace(coalesce(p_client_phone, ''), '[^0-9]', '', 'g');
  v_phone := nullif(v_phone, '');
  v_email := nullif(trim(coalesce(p_client_email, '')), '');

  if v_name is null then
    return jsonb_build_object('status','error','error','invalid_name');
  end if;
  if v_phone is null then
    return jsonb_build_object('status','error','error','invalid_phone');
  end if;

  v_end_at := p_start_at + make_interval(mins => v_total_duration);

  if p_start_at < v_now + make_interval(mins => v_settings.minimum_advance_minutes) then
    return jsonb_build_object('status','error','error','too_soon');
  end if;
  if p_start_at > v_now + make_interval(days => v_settings.maximum_advance_days) then
    return jsonb_build_object('status','error','error','too_far');
  end if;

  v_weekday     := extract(dow from (p_start_at at time zone v_profile.timezone))::smallint;
  v_local_start := (p_start_at at time zone v_profile.timezone)::time;
  v_local_end   := (v_end_at   at time zone v_profile.timezone)::time;

  if (v_end_at at time zone v_profile.timezone)::date
     <> (p_start_at at time zone v_profile.timezone)::date then
    return jsonb_build_object('status','error','error','outside_hours');
  end if;

  select exists (
    select 1 from public.business_hours
    where professional_id = v_profile.id
      and weekday = v_weekday
      and active = true
      and start_time <= v_local_start
      and end_time   >= v_local_end
  ) into v_fits_hours;

  if not v_fits_hours then
    return jsonb_build_object('status','error','error','outside_hours');
  end if;

  insert into public.clients (professional_id, name, phone, email)
    values (v_profile.id, v_name, v_phone, v_email)
  on conflict (professional_id, phone) where phone is not null
    do update set
      name  = excluded.name,
      email = coalesce(excluded.email, public.clients.email),
      updated_at = now()
    returning id into v_client_id;

  v_status := case
    when v_settings.require_confirmation then 'pending'::public.appointment_status
    else 'confirmed'::public.appointment_status
  end;

  begin
    insert into public.appointments (
      professional_id, client_id, service_id,
      start_at, end_at, status, notes,
      total_price_cents, total_duration_minutes
    ) values (
      v_profile.id, v_client_id, v_svc_ids[1],
      p_start_at, v_end_at, v_status, p_notes,
      v_total_price, v_total_duration
    ) returning id, cancel_token into v_appointment_id, v_cancel_token;
  exception
    when exclusion_violation then
      return jsonb_build_object('status','error','error','conflict');
  end;

  foreach v_svc_id in array v_svc_ids loop
    select * into v_service from public.services where id = v_svc_id;
    insert into public.appointment_services
      (appointment_id, service_id, price_cents_snapshot, duration_minutes_snapshot, position)
      values (v_appointment_id, v_service.id, v_service.price_cents, v_service.duration_minutes, v_position);
    v_position := v_position + 1;
  end loop;

  return jsonb_build_object(
    'status','ok',
    'appointment_id', v_appointment_id,
    'appointment_status', v_status,
    'cancel_token', v_cancel_token,
    'total_price_cents', v_total_price,
    'total_duration_minutes', v_total_duration
  );
end;
$$;

grant execute on function public.book_appointment(text, uuid[], timestamptz, text, text, text, text) to anon, authenticated;

-- =============================================================
-- 6) `admin_create_appointment`: idem — valida services por team
-- -------------------------------------------------------------
-- Mesma correção: resolve o team do pro autenticado e valida que
-- cada service_id pertence ao mesmo team. O `v_prof_id` segue sendo
-- `current_professional_id()` (quem está logado como profissional).
-- =============================================================
create or replace function public.admin_create_appointment(
  p_service_ids  uuid[],
  p_start_at     timestamptz,
  p_client_id    uuid default null,
  p_client_name  text default null,
  p_client_phone text default null,
  p_client_email text default null,
  p_notes        text default null,
  p_status       public.appointment_status default 'confirmed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof_id        uuid := public.current_professional_id();
  v_team_id        uuid := public.current_team_id();
  v_total_price    integer := 0;
  v_total_duration integer := 0;
  v_service        public.services%rowtype;
  v_svc_id         uuid;
  v_svc_ids        uuid[] := coalesce(p_service_ids, array[]::uuid[]);
  v_end_at         timestamptz;
  v_client_id      uuid := p_client_id;
  v_name           text;
  v_phone          text;
  v_email          text;
  v_appointment_id uuid;
  v_position       integer := 0;
begin
  if v_prof_id is null or v_team_id is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;

  if array_length(v_svc_ids, 1) is null then
    return jsonb_build_object('status','error','error','service_not_found');
  end if;

  foreach v_svc_id in array v_svc_ids loop
    select * into v_service
      from public.services
      where id = v_svc_id
        and team_id = v_team_id;

    if not found then
      return jsonb_build_object('status','error','error','service_not_found');
    end if;
    if v_service.active = false then
      return jsonb_build_object('status','error','error','service_inactive');
    end if;

    v_total_price    := v_total_price + v_service.price_cents;
    v_total_duration := v_total_duration + v_service.duration_minutes;
  end loop;

  if v_total_duration <= 0 then
    return jsonb_build_object('status','error','error','service_not_found');
  end if;

  v_end_at := p_start_at + make_interval(mins => v_total_duration);

  if v_client_id is not null then
    perform 1 from public.clients
      where id = v_client_id and professional_id = v_prof_id;
    if not found then
      return jsonb_build_object('status','error','error','client_not_found');
    end if;
  else
    v_name  := nullif(trim(coalesce(p_client_name, '')), '');
    v_phone := regexp_replace(coalesce(p_client_phone, ''), '[^0-9]', '', 'g');
    v_phone := nullif(v_phone, '');
    v_email := nullif(trim(coalesce(p_client_email, '')), '');

    if v_name is null then
      return jsonb_build_object('status','error','error','invalid_name');
    end if;
    if v_phone is null then
      return jsonb_build_object('status','error','error','invalid_phone');
    end if;

    insert into public.clients (professional_id, name, phone, email)
      values (v_prof_id, v_name, v_phone, v_email)
    on conflict (professional_id, phone) where phone is not null
      do update set
        name  = excluded.name,
        email = coalesce(excluded.email, public.clients.email),
        updated_at = now()
      returning id into v_client_id;
  end if;

  begin
    insert into public.appointments (
      professional_id, client_id, service_id,
      start_at, end_at, status, notes,
      total_price_cents, total_duration_minutes
    ) values (
      v_prof_id, v_client_id, v_svc_ids[1],
      p_start_at, v_end_at, p_status, p_notes,
      v_total_price, v_total_duration
    ) returning id into v_appointment_id;
  exception
    when exclusion_violation then
      return jsonb_build_object('status','error','error','conflict');
  end;

  foreach v_svc_id in array v_svc_ids loop
    select * into v_service from public.services where id = v_svc_id;
    insert into public.appointment_services
      (appointment_id, service_id, price_cents_snapshot, duration_minutes_snapshot, position)
      values (v_appointment_id, v_service.id, v_service.price_cents, v_service.duration_minutes, v_position);
    v_position := v_position + 1;
  end loop;

  return jsonb_build_object(
    'status','ok',
    'appointment_id', v_appointment_id,
    'total_price_cents', v_total_price,
    'total_duration_minutes', v_total_duration
  );
end;
$$;

revoke all on function public.admin_create_appointment(uuid[], timestamptz, uuid, text, text, text, text, public.appointment_status) from public;
grant execute on function public.admin_create_appointment(uuid[], timestamptz, uuid, text, text, text, text, public.appointment_status)
  to authenticated;

-- =============================================================
-- 0010_multi_service.sql
-- Permite múltiplos serviços por agendamento.
-- -------------------------------------------------------------
-- Modelagem:
--   appointments.service_id    → mantido (serviço "principal",
--                                 geralmente o primeiro escolhido)
--   appointments.total_*       → somas pré-calculadas no momento da
--                                 reserva (preço e duração)
--   appointment_services       → tabela associativa N:M com snapshot
--                                 do preço e duração do serviço no
--                                 momento da reserva (histórico
--                                 consistente mesmo se o serviço for
--                                 editado depois)
-- =============================================================

-- 1) Totais pré-calculados em appointments -----------------------
alter table public.appointments
  add column if not exists total_price_cents      integer not null default 0 check (total_price_cents >= 0),
  add column if not exists total_duration_minutes integer not null default 0 check (total_duration_minutes >= 0);

-- Backfill a partir do service atual
update public.appointments a
set
  total_price_cents      = s.price_cents,
  total_duration_minutes = s.duration_minutes
from public.services s
where a.service_id = s.id
  and (a.total_price_cents = 0 or a.total_duration_minutes = 0);

-- 2) Tabela associativa ----------------------------------------
create table if not exists public.appointment_services (
  id                        uuid primary key default gen_random_uuid(),
  appointment_id            uuid not null references public.appointments(id) on delete cascade,
  service_id                uuid not null references public.services(id)     on delete restrict,
  price_cents_snapshot      integer not null check (price_cents_snapshot >= 0),
  duration_minutes_snapshot integer not null check (duration_minutes_snapshot > 0),
  position                  integer not null default 0,
  created_at                timestamptz not null default now()
);

create index if not exists appointment_services_appt_idx
  on public.appointment_services (appointment_id, position);

create index if not exists appointment_services_service_idx
  on public.appointment_services (service_id);

-- 3) Backfill: 1 linha para cada appointment existente ----------
insert into public.appointment_services
  (appointment_id, service_id, price_cents_snapshot, duration_minutes_snapshot, position)
select a.id, a.service_id, s.price_cents, s.duration_minutes, 0
from public.appointments a
join public.services s on s.id = a.service_id
where not exists (
  select 1 from public.appointment_services aps where aps.appointment_id = a.id
);

-- 4) RLS -------------------------------------------------------
alter table public.appointment_services enable row level security;

drop policy if exists "appointment_services_owner_all" on public.appointment_services;

create policy "appointment_services_owner_all"
  on public.appointment_services
  for all
  to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and a.professional_id = public.current_professional_id()
    )
  )
  with check (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and a.professional_id = public.current_professional_id()
    )
  );

-- 5) GRANTs ----------------------------------------------------
grant select, insert, update, delete on public.appointment_services to authenticated;

-- 6) RPC book_appointment (multi-serviço) ----------------------
-- Dropa a assinatura antiga (service_id único) para não haver ambiguidade.
drop function if exists public.book_appointment(text, uuid, timestamptz, text, text, text, text);

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
  v_name           text;
  v_phone          text;
  v_email          text;
  v_position       integer := 0;
begin
  if array_length(v_svc_ids, 1) is null then
    return jsonb_build_object('status','error','error','service_not_found');
  end if;

  -- 1. Profissional
  select * into v_profile from public.profiles where slug = p_slug;
  if not found then
    return jsonb_build_object('status','error','error','profile_not_found');
  end if;

  -- 2. Settings e booking online
  select * into v_settings
    from public.booking_settings
    where professional_id = v_profile.id;
  if not found or v_settings.online_booking_enabled = false then
    return jsonb_build_object('status','error','error','bookings_disabled');
  end if;

  -- 3. Validar e somar serviços preservando a ordem do array
  foreach v_svc_id in array v_svc_ids loop
    select * into v_service
      from public.services
      where id = v_svc_id
        and professional_id = v_profile.id;

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

  -- 4. Inputs do cliente
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

  -- 5. Antecedência
  v_end_at := p_start_at + make_interval(mins => v_total_duration);

  if p_start_at < v_now + make_interval(mins => v_settings.minimum_advance_minutes) then
    return jsonb_build_object('status','error','error','too_soon');
  end if;
  if p_start_at > v_now + make_interval(days => v_settings.maximum_advance_days) then
    return jsonb_build_object('status','error','error','too_far');
  end if;

  -- 6. Dentro do expediente (uma única janela abrange início→fim)
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

  -- 7. Upsert cliente
  insert into public.clients (professional_id, name, phone, email)
    values (v_profile.id, v_name, v_phone, v_email)
  on conflict (professional_id, phone) where phone is not null
    do update set
      name  = excluded.name,
      email = coalesce(excluded.email, public.clients.email),
      updated_at = now()
    returning id into v_client_id;

  -- 8. Status
  v_status := case
    when v_settings.require_confirmation then 'pending'::public.appointment_status
    else 'confirmed'::public.appointment_status
  end;

  -- 9. Inserir appointment (service_id = primeiro id para compat)
  begin
    insert into public.appointments (
      professional_id, client_id, service_id,
      start_at, end_at, status, notes,
      total_price_cents, total_duration_minutes
    ) values (
      v_profile.id, v_client_id, v_svc_ids[1],
      p_start_at, v_end_at, v_status, p_notes,
      v_total_price, v_total_duration
    ) returning id into v_appointment_id;
  exception
    when exclusion_violation then
      return jsonb_build_object('status','error','error','conflict');
  end;

  -- 10. Linhas de appointment_services com snapshot
  foreach v_svc_id in array v_svc_ids loop
    select * into v_service from public.services where id = v_svc_id;
    insert into public.appointment_services
      (appointment_id, service_id, price_cents_snapshot, duration_minutes_snapshot, position)
      values (v_appointment_id, v_service.id, v_service.price_cents, v_service.duration_minutes, v_position);
    v_position := v_position + 1;
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'appointment_id', v_appointment_id,
    'appointment_status', v_status,
    'total_price_cents', v_total_price,
    'total_duration_minutes', v_total_duration
  );
end;
$$;

revoke all on function public.book_appointment(text, uuid[], timestamptz, text, text, text, text) from public;
grant execute on function public.book_appointment(text, uuid[], timestamptz, text, text, text, text)
  to anon, authenticated;

-- 7) RPC get_available_slots (multi-serviço) ------------------
drop function if exists public.get_available_slots(text, uuid, date);

create or replace function public.get_available_slots(
  p_slug        text,
  p_service_ids uuid[],
  p_date        date
)
returns setof timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile        public.profiles%rowtype;
  v_settings       public.booking_settings%rowtype;
  v_total_duration integer := 0;
  v_svc_id         uuid;
  v_svc_ids        uuid[] := coalesce(p_service_ids, array[]::uuid[]);
  v_service        public.services%rowtype;
  v_weekday        smallint;
  v_now            timestamptz := now();
  v_min_start      timestamptz;
  v_max_start      timestamptz;
  v_window         record;
  v_day_start      timestamptz;
  v_day_end        timestamptz;
  v_slot           timestamptz;
  v_slot_end       timestamptz;
  v_step           interval;
begin
  if array_length(v_svc_ids, 1) is null then return; end if;

  select * into v_profile from public.profiles where slug = p_slug;
  if not found then return; end if;

  select * into v_settings
    from public.booking_settings
    where professional_id = v_profile.id;
  if not found or v_settings.online_booking_enabled = false then return; end if;

  -- Soma duração de todos os serviços (precisam ser ativos e do mesmo profissional)
  foreach v_svc_id in array v_svc_ids loop
    select * into v_service
      from public.services
      where id = v_svc_id
        and professional_id = v_profile.id
        and active = true;
    if not found then return; end if;
    v_total_duration := v_total_duration + v_service.duration_minutes;
  end loop;

  if v_total_duration <= 0 then return; end if;

  v_min_start := v_now + make_interval(mins => v_settings.minimum_advance_minutes);
  v_max_start := v_now + make_interval(days => v_settings.maximum_advance_days);
  v_weekday   := extract(dow from p_date)::smallint;
  v_step      := make_interval(mins => v_total_duration);

  for v_window in
    select start_time, end_time
    from public.business_hours
    where professional_id = v_profile.id
      and weekday = v_weekday
      and active = true
    order by start_time
  loop
    v_day_start := (p_date + v_window.start_time) at time zone v_profile.timezone;
    v_day_end   := (p_date + v_window.end_time)   at time zone v_profile.timezone;

    v_slot := v_day_start;
    while v_slot + v_step <= v_day_end loop
      v_slot_end := v_slot + v_step;

      if v_slot >= v_min_start and v_slot <= v_max_start then
        if not exists (
          select 1 from public.appointments a
          where a.professional_id = v_profile.id
            and a.status in ('pending','confirmed')
            and tstzrange(a.start_at, a.end_at, '[)') &&
                tstzrange(v_slot, v_slot_end, '[)')
        ) then
          return next v_slot;
        end if;
      end if;

      v_slot := v_slot + v_step;
    end loop;
  end loop;
end;
$$;

revoke all on function public.get_available_slots(text, uuid[], date) from public;
grant execute on function public.get_available_slots(text, uuid[], date)
  to anon, authenticated;

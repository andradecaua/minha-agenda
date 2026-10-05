-- =============================================================
-- 0015_public_booking_always_pending.sql
-- -------------------------------------------------------------
-- Novo comportamento: TODO agendamento feito pelo cliente via a RPC
-- pública `book_appointment` entra como `pending`. O profissional
-- confirma depois no dashboard.
--
-- Antes, o status dependia de `booking_settings.require_confirmation`.
-- Agora essa coluna deixa de ser consultada aqui (fica no banco por
-- compat, mas sem efeito). A UI de settings esconde o toggle.
--
-- Agendamentos manuais criados pelo profissional (via
-- `admin_create_appointment`) continuam podendo escolher o status.
-- =============================================================

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

  -- Insere SEMPRE como pending (independente de require_confirmation)
  begin
    insert into public.appointments (
      professional_id, client_id, service_id,
      start_at, end_at, status, notes,
      total_price_cents, total_duration_minutes
    ) values (
      v_profile.id, v_client_id, v_svc_ids[1],
      p_start_at, v_end_at, 'pending'::public.appointment_status, p_notes,
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
    'appointment_status', 'pending',
    'total_price_cents', v_total_price,
    'total_duration_minutes', v_total_duration
  );
end;
$$;

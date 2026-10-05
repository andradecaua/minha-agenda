-- =============================================================
-- 0017_cancel_token.sql
-- -------------------------------------------------------------
-- Permite o cliente cancelar o próprio agendamento sem conta,
-- via link único: /p/{slug}/a/{cancel_token}.
--
-- Alterações:
--   1) Nova coluna `appointments.cancel_token` (uuid único, default
--      gen_random_uuid()). Backfill de linhas existentes.
--   2) RPC pública `get_appointment_by_token(slug, token)` — devolve
--      a visão do cliente (dados do agendamento + se pode cancelar
--      agora). SECURITY DEFINER. Checa que o token pertence ao slug
--      para evitar enumeration cross-tenant.
--   3) RPC pública `cancel_appointment_by_token(slug, token)` —
--      marca o agendamento como cancelled, respeitando
--      `cancellation_enabled` e `cancellation_deadline_minutes`.
--   4) RPC `book_appointment` passa a retornar `cancel_token` para
--      o frontend montar o link.
-- =============================================================

-- 1) Coluna cancel_token --------------------------------------
alter table public.appointments
  add column if not exists cancel_token uuid not null default gen_random_uuid();

-- Backfill: regenera para linhas antigas que porventura tenham o mesmo
-- valor (idempotente — se já são únicas, nada muda).
update public.appointments
set cancel_token = gen_random_uuid()
where cancel_token is null;

create unique index if not exists appointments_cancel_token_unique
  on public.appointments (cancel_token);

-- 2) RPC: ver agendamento por token ---------------------------
drop function if exists public.get_appointment_by_token(text, uuid);

create or replace function public.get_appointment_by_token(
  p_slug  text,
  p_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt     public.appointments%rowtype;
  v_profile  public.profiles%rowtype;
  v_settings public.booking_settings%rowtype;
  v_services jsonb;
  v_can_cancel boolean := false;
  v_cancel_until timestamptz;
  v_client   public.clients%rowtype;
begin
  select * into v_appt
    from public.appointments
    where cancel_token = p_token;
  if not found then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  select * into v_profile
    from public.profiles
    where id = v_appt.professional_id;
  if not found or v_profile.slug <> p_slug then
    -- Token não pertence a esse slug — resposta igual a "não encontrado"
    -- para evitar enumeration entre tenants.
    return jsonb_build_object('status','error','error','not_found');
  end if;

  select * into v_settings
    from public.booking_settings
    where professional_id = v_profile.id;

  select * into v_client
    from public.clients
    where id = v_appt.client_id;

  -- Serviços deste agendamento (snapshot) com nome do serviço atual
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', s.name,
        'price_cents', aps.price_cents_snapshot,
        'duration_minutes', aps.duration_minutes_snapshot
      ) order by aps.position
    ),
    '[]'::jsonb
  )
  into v_services
  from public.appointment_services aps
  left join public.services s on s.id = aps.service_id
  where aps.appointment_id = v_appt.id;

  -- Pode cancelar agora?
  if v_appt.status in ('pending','confirmed') and v_settings.cancellation_enabled then
    v_cancel_until := v_appt.start_at
      - make_interval(mins => v_settings.cancellation_deadline_minutes);
    v_can_cancel := now() <= v_cancel_until;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'appointment', jsonb_build_object(
      'id', v_appt.id,
      'start_at', v_appt.start_at,
      'end_at', v_appt.end_at,
      'status', v_appt.status,
      'notes', v_appt.notes,
      'total_price_cents', v_appt.total_price_cents,
      'total_duration_minutes', v_appt.total_duration_minutes
    ),
    'professional', jsonb_build_object(
      'name', v_profile.name,
      'slug', v_profile.slug,
      'phone', v_profile.phone,
      'avatar_url', v_profile.avatar_url
    ),
    'client', jsonb_build_object(
      'name', v_client.name
    ),
    'services', v_services,
    'can_cancel', v_can_cancel,
    'cancel_until', v_cancel_until,
    'cancellation_enabled', coalesce(v_settings.cancellation_enabled, false)
  );
end;
$$;

revoke all on function public.get_appointment_by_token(text, uuid) from public;
grant execute on function public.get_appointment_by_token(text, uuid)
  to anon, authenticated;

-- 3) RPC: cancelar por token ----------------------------------
drop function if exists public.cancel_appointment_by_token(text, uuid);

create or replace function public.cancel_appointment_by_token(
  p_slug  text,
  p_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt     public.appointments%rowtype;
  v_profile  public.profiles%rowtype;
  v_settings public.booking_settings%rowtype;
begin
  select * into v_appt
    from public.appointments
    where cancel_token = p_token;
  if not found then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  select * into v_profile
    from public.profiles
    where id = v_appt.professional_id;
  if not found or v_profile.slug <> p_slug then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  if v_appt.status not in ('pending','confirmed') then
    return jsonb_build_object('status','error','error','not_cancellable');
  end if;

  select * into v_settings
    from public.booking_settings
    where professional_id = v_profile.id;
  if not found or v_settings.cancellation_enabled = false then
    return jsonb_build_object('status','error','error','cancellation_disabled');
  end if;

  if v_appt.start_at - make_interval(mins => v_settings.cancellation_deadline_minutes) < now() then
    return jsonb_build_object('status','error','error','cancel_deadline_passed');
  end if;

  update public.appointments
    set status = 'cancelled'
    where id = v_appt.id;

  return jsonb_build_object('status','ok');
end;
$$;

revoke all on function public.cancel_appointment_by_token(text, uuid) from public;
grant execute on function public.cancel_appointment_by_token(text, uuid)
  to anon, authenticated;

-- 4) RPC book_appointment passa a retornar cancel_token --------
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

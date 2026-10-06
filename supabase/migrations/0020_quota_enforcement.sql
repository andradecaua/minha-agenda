-- =============================================================
-- 0020_quota_enforcement.sql
-- -------------------------------------------------------------
-- Enforcement das quotas numéricas definidas em `plans`:
--   - plans.max_services                → tabela `services`
--   - plans.max_appointments_per_month  → tabela `appointments`
--
-- Decisões:
--
--  1. Enforcement via trigger BEFORE INSERT — enforcement real,
--     não burlável. Frontend consome `my_usage()` para antecipar
--     e desabilitar botão, mas a verdade está aqui.
--
--  2. SQLSTATE custom `P0100` nas exceções de quota. Isso:
--       (a) Deixa o RPC `book_appointment` detectar e devolver
--           um erro amigável em vez de propagar SQLSTATE cru.
--       (b) Deixa o frontend diferenciar quota de outras check
--           violations ao ler `error.code` do supabase-js.
--
--  3. Regras de contagem:
--       - `services`: conta TODAS as linhas do dono (ativas e
--         inativas). Desativar não libera slot — evita hoarding.
--       - `appointments`: conta linhas criadas no mês corrente
--         (`created_at >= date_trunc('month', now())`) com
--         `status != 'cancelled'`. Cancelar libera.
--
--  4. `plans.max_* = null` → sem limite (comportamento atual
--     dos planos antigos; segue valendo).
--
--  5. `my_usage()` retorna snapshot leve para UI. Separado de
--     `my_plan()` por ter staleTime menor (uso muda a cada
--     create, plano quase nunca).
-- =============================================================

-- =============================================================
-- 1) Trigger: quota de services
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
  -- max_services do plano ativo do dono do profile.
  select pl.max_services into v_max
    from public.profiles p
    join public.subscriptions s on s.user_id = p.user_id
    join public.plans pl on pl.id = s.plan_id
    where p.id = new.professional_id
      and s.status in ('active','trialing')
      and (s.expires_at is null or s.expires_at > now())
      and pl.active = true
    limit 1;

  if v_max is null then
    return new;  -- sem limite
  end if;

  select count(*) into v_count
    from public.services
    where professional_id = new.professional_id;

  if v_count >= v_max then
    raise exception 'quota_services: max % services', v_max
      using errcode = 'P0100';
  end if;

  return new;
end;
$$;

drop trigger if exists services_enforce_quota on public.services;
create trigger services_enforce_quota
  before insert on public.services
  for each row execute function public.enforce_services_quota();

-- =============================================================
-- 2) Trigger: quota de appointments por mês
-- =============================================================
create or replace function public.enforce_appointments_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_max     int;
  v_count   int;
begin
  -- Resolve user_id do profissional dono deste appointment.
  select user_id into v_user_id
    from public.profiles where id = new.professional_id;
  if v_user_id is null then
    return new;  -- profile fantasma? deixa a FK barrar depois
  end if;

  select pl.max_appointments_per_month into v_max
    from public.subscriptions s
    join public.plans pl on pl.id = s.plan_id
    where s.user_id = v_user_id
      and s.status in ('active','trialing')
      and (s.expires_at is null or s.expires_at > now())
      and pl.active = true
    limit 1;

  if v_max is null then
    return new;  -- sem limite
  end if;

  -- Conta este mês, excluindo cancelados.
  select count(*) into v_count
    from public.appointments
    where professional_id = new.professional_id
      and created_at >= date_trunc('month', now())
      and status != 'cancelled';

  if v_count >= v_max then
    raise exception 'quota_appointments: max % per month', v_max
      using errcode = 'P0100';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_enforce_quota on public.appointments;
create trigger appointments_enforce_quota
  before insert on public.appointments
  for each row execute function public.enforce_appointments_quota();

-- =============================================================
-- 3) book_appointment: traduz P0100 em `quota_exceeded`
-- -------------------------------------------------------------
-- O público não deve ver "quota_appointments: max X" cru. Reescreve
-- a versão multi-serviço de 0010 adicionando `when sqlstate 'P0100'`
-- no bloco do INSERT. Mantém a assinatura `(text, uuid[], timestamptz,
-- text, text, text, text)` — não quebra o frontend.
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

  -- 6. Dentro do expediente
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
    -- Trigger de quota (0020) usa SQLSTATE P0100.
    when sqlstate 'P0100' then
      return jsonb_build_object('status','error','error','quota_exceeded');
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

-- =============================================================
-- 3b) admin_create_appointment: traduz P0100 em `quota_exceeded`
-- -------------------------------------------------------------
-- Mesma estratégia da RPC pública: profissional cria manual via
-- painel → trigger de quota pode disparar → RPC devolve erro
-- padronizado. Mantém a assinatura e lógica de 0014 intactas.
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
  if v_prof_id is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;

  if array_length(v_svc_ids, 1) is null then
    return jsonb_build_object('status','error','error','service_not_found');
  end if;

  if p_start_at < (now() - interval '1 minute') then
    return jsonb_build_object('status','error','error','start_in_past');
  end if;

  foreach v_svc_id in array v_svc_ids loop
    select * into v_service
      from public.services
      where id = v_svc_id
        and professional_id = v_prof_id;

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
    when sqlstate 'P0100' then
      return jsonb_build_object('status','error','error','quota_exceeded');
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

-- =============================================================
-- 4) my_usage(): snapshot leve de uso vs. quota
-- =============================================================
drop function if exists public.my_usage();
create or replace function public.my_usage()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id as profile_id, user_id
      from public.profiles
      where user_id = auth.uid()
      limit 1
  ),
  plan as (
    select pl.max_services, pl.max_appointments_per_month
      from public.subscriptions s
      join public.plans pl on pl.id = s.plan_id
      where s.user_id = (select user_id from me)
        and s.status in ('active','trialing')
        and (s.expires_at is null or s.expires_at > now())
        and pl.active = true
      limit 1
  )
  select jsonb_build_object(
    'services_count',
      coalesce((select count(*) from public.services
                where professional_id = (select profile_id from me)), 0),
    'max_services',
      (select max_services from plan),
    'appointments_this_month',
      coalesce((select count(*) from public.appointments
                where professional_id = (select profile_id from me)
                  and created_at >= date_trunc('month', now())
                  and status != 'cancelled'), 0),
    'max_appointments_per_month',
      (select max_appointments_per_month from plan)
  );
$$;

grant execute on function public.my_usage() to authenticated;

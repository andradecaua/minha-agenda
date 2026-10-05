-- =============================================================
-- 0013_admin_create_appointment.sql
-- RPC para o profissional criar agendamento MANUALMENTE pelo dashboard.
-- -------------------------------------------------------------
-- Diferenças em relação a book_appointment:
--   - Autenticada (verifica current_professional_id())
--   - Aceita client_id EXISTENTE ou cria/atualiza por telefone
--   - NÃO exige online_booking_enabled, antecedência ou business_hours
--     (o profissional pode encaixar quando quiser)
--   - Serviços ativos continuam exigidos (profissional precisa reativar
--     se quer vender de novo)
--   - Status default = 'confirmed' (admin confirma na hora)
--   - EXCLUDE constraint ainda protege contra conflito atomicamente
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
  -- 1. Precisa estar autenticado como profissional
  if v_prof_id is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;

  if array_length(v_svc_ids, 1) is null then
    return jsonb_build_object('status','error','error','service_not_found');
  end if;

  -- 2. Validar e somar serviços
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

  -- 3. Resolver cliente -- existente OU criar/atualizar por phone
  if v_client_id is not null then
    -- Garante que pertence ao profissional
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

  -- 4. Inserir appointment
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

  -- 5. appointment_services com snapshot
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

-- =============================================================
-- 0003_booking_rpc.sql
-- RPC pública de reserva — Minha Agenda
-- =============================================================
-- Único caminho pelo qual um visitante anônimo pode escrever em
-- `appointments` e `clients`. SECURITY DEFINER + validações no banco.
-- Retorna JSON com { status, appointment_id?, error? } — nunca
-- propaga SQLSTATE cru.
-- =============================================================

create or replace function public.book_appointment(
  p_slug           text,
  p_service_id     uuid,
  p_start_at       timestamptz,
  p_client_name    text,
  p_client_phone   text,
  p_client_email   text default null,
  p_notes          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile       public.profiles%rowtype;
  v_settings      public.booking_settings%rowtype;
  v_service       public.services%rowtype;
  v_end_at        timestamptz;
  v_now           timestamptz := now();
  v_weekday       smallint;
  v_local_start   time;
  v_local_end     time;
  v_fits_hours    boolean;
  v_client_id     uuid;
  v_appointment_id uuid;
  v_status        public.appointment_status;
  v_name          text;
  v_phone         text;
  v_email         text;
begin
  -- --- 1. Resolver profissional por slug ---------------------
  select * into v_profile from public.profiles where slug = p_slug;
  if not found then
    return jsonb_build_object('status','error','error','profile_not_found');
  end if;

  -- --- 2. Settings e verificar se agendamento online está habilitado --
  select * into v_settings
    from public.booking_settings
    where professional_id = v_profile.id;

  if not found or v_settings.online_booking_enabled = false then
    return jsonb_build_object('status','error','error','bookings_disabled');
  end if;

  -- --- 3. Validar serviço ------------------------------------
  select * into v_service
    from public.services
    where id = p_service_id
      and professional_id = v_profile.id;

  if not found then
    return jsonb_build_object('status','error','error','service_not_found');
  end if;
  if v_service.active = false then
    return jsonb_build_object('status','error','error','service_inactive');
  end if;

  -- --- 4. Normalizar inputs ----------------------------------
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

  -- --- 5. Regras de antecedência -----------------------------
  v_end_at := p_start_at + make_interval(mins => v_service.duration_minutes);

  if p_start_at < v_now + make_interval(mins => v_settings.minimum_advance_minutes) then
    return jsonb_build_object('status','error','error','too_soon');
  end if;

  if p_start_at > v_now + make_interval(days => v_settings.maximum_advance_days) then
    return jsonb_build_object('status','error','error','too_far');
  end if;

  -- --- 6. Dentro do horário de funcionamento -----------------
  -- Converte para o timezone do profissional e checa se cabe em ALGUMA
  -- janela ativa do weekday correspondente.
  v_weekday     := extract(dow from (p_start_at at time zone v_profile.timezone))::smallint;
  v_local_start := (p_start_at at time zone v_profile.timezone)::time;
  v_local_end   := (v_end_at   at time zone v_profile.timezone)::time;

  -- Se a sessão atravessa a meia-noite local, recusa (não suportamos
  -- atendimentos que cruzam dias nesta versão).
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

  -- --- 7. Upsert cliente (chave: professional_id + phone) ----
  insert into public.clients (professional_id, name, phone, email)
    values (v_profile.id, v_name, v_phone, v_email)
  on conflict (professional_id, phone) where phone is not null
    do update set
      name  = excluded.name,
      email = coalesce(excluded.email, public.clients.email),
      updated_at = now()
    returning id into v_client_id;

  -- --- 8. Status conforme regra de confirmação ---------------
  v_status := case
    when v_settings.require_confirmation then 'pending'::public.appointment_status
    else 'confirmed'::public.appointment_status
  end;

  -- --- 9. Inserir agendamento (EXCLUDE constraint resolve conflito) --
  begin
    insert into public.appointments (
      professional_id, client_id, service_id,
      start_at, end_at, status, notes
    ) values (
      v_profile.id, v_client_id, v_service.id,
      p_start_at, v_end_at, v_status, p_notes
    ) returning id into v_appointment_id;
  exception
    when exclusion_violation then
      return jsonb_build_object('status','error','error','conflict');
  end;

  return jsonb_build_object(
    'status','ok',
    'appointment_id', v_appointment_id,
    'appointment_status', v_status
  );
end;
$$;

-- Visitantes anônimos e autenticados podem invocar.
revoke all on function public.book_appointment(text, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.book_appointment(text, uuid, timestamptz, text, text, text, text)
  to anon, authenticated;

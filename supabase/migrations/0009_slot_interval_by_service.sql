-- =============================================================
-- 0009_slot_interval_by_service.sql
-- -------------------------------------------------------------
-- Granularidade dos slots passa a ser a DURAÇÃO DO SERVIÇO em vez de
-- `booking_settings.default_interval_minutes`.
--
-- Antes: com default_interval=15 e serviço de 30min, mostrávamos
--        08:00, 08:15, 08:30, 08:45... — o 08:15 colidia com o 08:00,
--        o 08:45 colidia com o 08:30, e a UI "escondia" esses slots
--        pelo filtro de colisão, mas era ruído.
-- Agora: para o serviço de 30min, mostramos 08:00, 08:30, 09:00...
--        O passo acompanha o serviço escolhido — slots nunca se
--        sobrepõem logicamente.
--
-- A coluna `booking_settings.default_interval_minutes` continua
-- existindo (reservada para "buffer entre atendimentos" ou alinhamento
-- de agenda em versão futura). Não é mais usada por esta RPC.
-- =============================================================

create or replace function public.get_available_slots(
  p_slug       text,
  p_service_id uuid,
  p_date       date
)
returns setof timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile    public.profiles%rowtype;
  v_settings   public.booking_settings%rowtype;
  v_service    public.services%rowtype;
  v_weekday    smallint;
  v_now        timestamptz := now();
  v_min_start  timestamptz;
  v_max_start  timestamptz;
  v_window     record;
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_slot       timestamptz;
  v_slot_end   timestamptz;
  v_step       interval;
begin
  select * into v_profile from public.profiles where slug = p_slug;
  if not found then return; end if;

  select * into v_settings
    from public.booking_settings
    where professional_id = v_profile.id;
  if not found or v_settings.online_booking_enabled = false then
    return;
  end if;

  select * into v_service
    from public.services
    where id = p_service_id
      and professional_id = v_profile.id
      and active = true;
  if not found then return; end if;

  v_min_start := v_now + make_interval(mins => v_settings.minimum_advance_minutes);
  v_max_start := v_now + make_interval(days => v_settings.maximum_advance_days);

  v_weekday := extract(dow from p_date)::smallint;

  -- Passo = duração do serviço (slots consecutivos nunca se sobrepõem)
  v_step := make_interval(mins => v_service.duration_minutes);

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

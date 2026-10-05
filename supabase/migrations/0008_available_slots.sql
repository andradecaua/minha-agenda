-- =============================================================
-- 0008_available_slots.sql
-- RPC get_available_slots(p_slug, p_service_id, p_date)
-- -------------------------------------------------------------
-- Retorna setof timestamptz com os horários disponíveis para o
-- profissional/serviço na data informada.
-- SECURITY DEFINER: a função lê `appointments` (que a RLS protege),
-- mas expõe apenas inícios de slots livres — nunca dados dos
-- agendamentos existentes.
--
-- Regras aplicadas:
--  - `online_booking_enabled` precisa estar `true`
--  - Serviço precisa estar ativo e pertencer ao profissional
--  - Slot começa em uma das janelas de `business_hours` do weekday
--  - Slot inteiro cabe antes do fim da janela (sem transbordar)
--  - Slot >= now() + minimum_advance_minutes
--  - Slot <= now() + maximum_advance_days
--  - Slot não colide com appointments em status
--    ('pending','confirmed')
--  - Granularidade: default_interval_minutes das booking_settings
--  - Respeita timezone do profissional
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

  -- `extract(dow)` no Postgres: 0=Dom .. 6=Sáb — mesmo que business_hours.weekday
  v_weekday := extract(dow from p_date)::smallint;

  for v_window in
    select start_time, end_time
    from public.business_hours
    where professional_id = v_profile.id
      and weekday = v_weekday
      and active = true
    order by start_time
  loop
    -- Converte o par (data, hora) para timestamptz no fuso do profissional
    v_day_start := (p_date + v_window.start_time) at time zone v_profile.timezone;
    v_day_end   := (p_date + v_window.end_time)   at time zone v_profile.timezone;

    v_slot := v_day_start;
    while v_slot + make_interval(mins => v_service.duration_minutes) <= v_day_end loop
      v_slot_end := v_slot + make_interval(mins => v_service.duration_minutes);

      -- Antecedência mínima e máxima
      if v_slot >= v_min_start and v_slot <= v_max_start then
        -- Não colide com agendamento ativo
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

      v_slot := v_slot + make_interval(mins => v_settings.default_interval_minutes);
    end loop;
  end loop;
end;
$$;

revoke all on function public.get_available_slots(text, uuid, date) from public;
grant execute on function public.get_available_slots(text, uuid, date)
  to anon, authenticated;

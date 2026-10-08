-- =============================================================
-- 0036_team_member_ops.sql
-- -------------------------------------------------------------
-- Operações de gestão de membros de team: owner remove membro,
-- member sai sozinho. Em ambos os casos o user removido fica
-- SEM team momentaneamente — e o modelo exige "um user = um team"
-- (unique index em team_members.user_id). Logo o fluxo é atômico:
-- deleta a linha de team_members do time antigo + cria um novo
-- solo team pro user na mesma transação.
--
-- Decisões:
--   - Owner não pode remover a si mesmo. Se quer "sair", precisa
--     transferir o papel (feature futura) ou deletar o team.
--   - Member que sai leva portfolio? NÃO. Portfolio é team-shared,
--     fica com o team.
--   - Services/clients/appointments do member removido FICAM com
--     ele (são por professional_id, não team_id). Vão pro novo
--     solo team dele.
-- =============================================================

-- =============================================================
-- Helper reutilizável: cria solo team pro user APÓS remoção.
-- Idempotente — se já tem team, retorna o existente.
-- =============================================================
-- Já existe `provision_team_for_user(uuid)` em 0032. Reusamos.

-- =============================================================
-- remove_team_member — owner remove um membro
-- =============================================================
drop function if exists public.remove_team_member(uuid);
create or replace function public.remove_team_member(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id   uuid;
  v_target_in_team boolean;
begin
  if auth.uid() is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;
  if p_user_id = auth.uid() then
    return jsonb_build_object('status','error','error','cannot_remove_self');
  end if;

  select team_id into v_team_id from public.team_members where user_id = auth.uid();
  if v_team_id is null then
    return jsonb_build_object('status','error','error','no_team');
  end if;
  if not public.is_team_owner(v_team_id) then
    return jsonb_build_object('status','error','error','forbidden_not_owner');
  end if;

  select exists (
    select 1 from public.team_members
    where team_id = v_team_id and user_id = p_user_id and role = 'member'
  ) into v_target_in_team;

  if not v_target_in_team then
    return jsonb_build_object('status','error','error','not_in_team');
  end if;

  -- Remove da equipe atual + provisiona solo team novo.
  delete from public.team_members
    where team_id = v_team_id and user_id = p_user_id;

  perform public.provision_team_for_user(p_user_id);
  perform public.ensure_free_subscription(p_user_id);

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'team_remove_member', 'teams', v_team_id::text,
            jsonb_build_object('removed_user_id', p_user_id));

  return jsonb_build_object('status','ok');
end;
$$;

grant execute on function public.remove_team_member(uuid) to authenticated;

-- =============================================================
-- leave_team — member sai sozinho
-- =============================================================
drop function if exists public.leave_team();
create or replace function public.leave_team()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_role    text;
begin
  if auth.uid() is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;

  select team_id, role into v_team_id, v_role
    from public.team_members where user_id = auth.uid();
  if v_team_id is null then
    return jsonb_build_object('status','error','error','no_team');
  end if;
  if v_role = 'owner' then
    return jsonb_build_object('status','error','error','owner_cannot_leave');
  end if;

  delete from public.team_members
    where team_id = v_team_id and user_id = auth.uid();

  perform public.provision_team_for_user(auth.uid());
  perform public.ensure_free_subscription(auth.uid());

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'team_leave', 'teams', v_team_id::text,
            jsonb_build_object('left_user_id', auth.uid()));

  return jsonb_build_object('status','ok');
end;
$$;

grant execute on function public.leave_team() to authenticated;

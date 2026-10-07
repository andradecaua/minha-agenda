-- =============================================================
-- 0027_support_tickets.sql
-- -------------------------------------------------------------
-- Suporte via tickets (thread user ↔ admin). Convive com o canal
-- "responda este email" dos emails transacionais; aqui o estado
-- vive no banco pra admin ver tudo em um só lugar.
--
-- Modelo:
--  - tickets               — assunto + status + prioridade + SLA
--  - ticket_messages       — thread de mensagens (user ou admin)
--
-- SLA é CALCULADO E CONGELADO na criação (sla_due_at) com base no
-- plano vigente: 24h pra qualquer plano pago (price_cents > 0),
-- 72h pra free/sem assinatura. Mudar o plano depois não recalcula
-- — ticket já está na fila do suporte, o compromisso vale.
--
-- Priority ('normal' | 'high') é derivada de pago vs grátis e
-- igualmente congelada; serve pro admin ordenar/filtrar.
--
-- RLS:
--  - tickets.SELECT         user vê os seus; admin vê tudo (AAL2)
--  - tickets.INSERT         só pela RPC create_support_ticket
--  - tickets.UPDATE/DELETE  bloqueado via RLS; só admin pela RPC
--  - ticket_messages.*      derivadas (user vê msgs do próprio
--                           ticket; admin vê tudo). Insert via RPC.
--
-- Email: fire-and-forget. A RPC create_support_ticket devolve o
-- ticket_id; o frontend invoca a edge `send-ticket-notification`
-- em seguida. Idempotência fica a cargo do email provider — como
-- é fire-and-forget, pior caso são duas cópias (aceitável).
-- =============================================================

-- =============================================================
-- 1) Tabelas
-- =============================================================
create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  subject       text not null check (length(trim(subject)) between 3 and 200),
  status        text not null default 'open'
                  check (status in ('open','in_progress','resolved','closed')),
  priority      text not null default 'normal'
                  check (priority in ('normal','high')),
  -- SLA congelado na criação. NULL = sem SLA definido (não deve ocorrer).
  sla_due_at    timestamptz not null,
  -- Snapshot do plano no momento da criação, pra debug/relatório.
  plan_code_at_open text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tickets_user_id_created_idx
  on public.tickets (user_id, created_at desc);
create index if not exists tickets_status_priority_idx
  on public.tickets (status, priority, created_at desc);
create index if not exists tickets_sla_due_idx
  on public.tickets (sla_due_at)
  where status in ('open','in_progress');

drop trigger if exists tickets_updated_at on public.tickets;
create trigger tickets_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

create table if not exists public.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  -- 'user' = dono do ticket; 'admin' = qualquer admin elevado.
  -- Sempre congelado na gravação pela RPC — nunca confia no cliente.
  author_kind text not null check (author_kind in ('user','admin')),
  body        text not null check (length(trim(body)) between 1 and 5000),
  created_at  timestamptz not null default now()
);

create index if not exists ticket_messages_ticket_idx
  on public.ticket_messages (ticket_id, created_at asc);

-- =============================================================
-- 2) Helper interno: resolve o SLA do caller
-- -------------------------------------------------------------
-- 24h pra plano pago ativo (price_cents > 0, status ativo e não
-- expirado); 72h pros demais (grátis ou assinatura vencida).
-- =============================================================
drop function if exists public.support_sla_for_user(uuid);
create or replace function public.support_sla_for_user(p_user uuid)
returns table (sla_due timestamptz, priority text, plan_code text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_price   int;
  v_code    text;
  v_active  boolean;
begin
  select pl.price_cents, pl.code,
         (s.status in ('active','trialing','past_due')
          and (s.expires_at is null or s.expires_at > now()))
    into v_price, v_code, v_active
  from public.subscriptions s
  join public.plans pl on pl.id = s.plan_id
  where s.user_id = p_user
  limit 1;

  if v_price is not null and v_price > 0 and v_active then
    return query select (now() + interval '24 hours')::timestamptz,
                        'high'::text,
                        v_code;
  else
    return query select (now() + interval '72 hours')::timestamptz,
                        'normal'::text,
                        coalesce(v_code, 'free');
  end if;
end;
$$;

-- =============================================================
-- 3) RLS
-- =============================================================
alter table public.tickets          enable row level security;
alter table public.ticket_messages  enable row level security;

drop policy if exists "tickets_self_select"   on public.tickets;
drop policy if exists "tickets_admin_select"  on public.tickets;
-- NÃO criamos policies de INSERT/UPDATE/DELETE: toda escrita passa
-- por RPC SECURITY DEFINER com check explícito de ownership/admin.

create policy "tickets_self_select"
  on public.tickets
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "tickets_admin_select"
  on public.tickets
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "ticket_messages_self_select"  on public.ticket_messages;
drop policy if exists "ticket_messages_admin_select" on public.ticket_messages;

create policy "ticket_messages_self_select"
  on public.ticket_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_messages.ticket_id and t.user_id = auth.uid()
    )
  );

create policy "ticket_messages_admin_select"
  on public.ticket_messages
  for select
  to authenticated
  using (public.is_admin());

-- =============================================================
-- 4) RPCs do usuário
-- =============================================================

-- Cria ticket + 1ª mensagem (corpo inicial). Retorna o id pra que o
-- frontend consiga invocar a edge de email em seguida.
drop function if exists public.create_support_ticket(text, text);
create or replace function public.create_support_ticket(
  p_subject text,
  p_body    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_subject    text := nullif(trim(coalesce(p_subject, '')), '');
  v_body       text := nullif(trim(coalesce(p_body, '')), '');
  v_sla        timestamptz;
  v_priority   text;
  v_plan_code  text;
  v_ticket_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;
  if v_subject is null or length(v_subject) < 3 then
    return jsonb_build_object('status','error','error','subject_too_short');
  end if;
  if v_body is null then
    return jsonb_build_object('status','error','error','body_required');
  end if;

  select sla_due, priority, plan_code
    into v_sla, v_priority, v_plan_code
  from public.support_sla_for_user(v_uid);

  insert into public.tickets (user_id, subject, status, priority, sla_due_at, plan_code_at_open)
    values (v_uid, v_subject, 'open', v_priority, v_sla, v_plan_code)
    returning id into v_ticket_id;

  insert into public.ticket_messages (ticket_id, author_id, author_kind, body)
    values (v_ticket_id, v_uid, 'user', v_body);

  return jsonb_build_object(
    'status','ok',
    'ticket_id',   v_ticket_id,
    'sla_due_at',  v_sla,
    'priority',    v_priority
  );
end;
$$;

grant execute on function public.create_support_ticket(text, text) to authenticated;

-- Lista tickets do caller com contagem de mensagens.
drop function if exists public.list_my_support_tickets();
create or replace function public.list_my_support_tickets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(row_to_json(x) order by x.created_at desc),
    '[]'::jsonb
  )
  from (
    select
      t.id,
      t.subject,
      t.status,
      t.priority,
      t.sla_due_at,
      t.created_at,
      t.updated_at,
      t.resolved_at,
      (select count(*) from public.ticket_messages m where m.ticket_id = t.id)      as messages_count,
      (select max(m.created_at) from public.ticket_messages m where m.ticket_id = t.id) as last_message_at
    from public.tickets t
    where t.user_id = auth.uid()
  ) x;
$$;

grant execute on function public.list_my_support_tickets() to authenticated;

-- Detalhe do ticket + thread completa. Checa ownership.
drop function if exists public.get_my_support_ticket(uuid);
create or replace function public.get_my_support_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ticket jsonb;
  v_msgs   jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;

  select to_jsonb(t) into v_ticket
  from (
    select id, user_id, subject, status, priority, sla_due_at,
           created_at, updated_at, resolved_at
    from public.tickets
    where id = p_ticket_id and user_id = auth.uid()
  ) t;

  if v_ticket is null then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at asc), '[]'::jsonb)
    into v_msgs
  from (
    select id, ticket_id, author_kind, body, created_at
    from public.ticket_messages
    where ticket_id = p_ticket_id
  ) m;

  return jsonb_build_object('status','ok', 'ticket', v_ticket, 'messages', v_msgs);
end;
$$;

grant execute on function public.get_my_support_ticket(uuid) to authenticated;

-- User responde no próprio ticket. Reabre se estava resolved.
drop function if exists public.reply_my_support_ticket(uuid, text);
create or replace function public.reply_my_support_ticket(
  p_ticket_id uuid,
  p_body      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_body    text := nullif(trim(coalesce(p_body, '')), '');
  v_owner   uuid;
  v_status  text;
  v_msg_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('status','error','error','unauthorized');
  end if;
  if v_body is null then
    return jsonb_build_object('status','error','error','body_required');
  end if;

  select user_id, status into v_owner, v_status
  from public.tickets where id = p_ticket_id;

  if v_owner is null then
    return jsonb_build_object('status','error','error','not_found');
  end if;
  if v_owner <> v_uid then
    return jsonb_build_object('status','error','error','forbidden');
  end if;
  if v_status = 'closed' then
    return jsonb_build_object('status','error','error','ticket_closed');
  end if;

  insert into public.ticket_messages (ticket_id, author_id, author_kind, body)
    values (p_ticket_id, v_uid, 'user', v_body)
    returning id into v_msg_id;

  -- Resposta do user em ticket resolvido => reabre pro admin olhar.
  update public.tickets
    set status = case when status = 'resolved' then 'open' else status end,
        updated_at = now()
    where id = p_ticket_id;

  return jsonb_build_object('status','ok','message_id', v_msg_id);
end;
$$;

grant execute on function public.reply_my_support_ticket(uuid, text) to authenticated;

-- =============================================================
-- 5) RPCs do admin (todas exigem AAL2 via is_admin())
-- =============================================================

drop function if exists public.admin_list_support_tickets(text, text, int, int);
create or replace function public.admin_list_support_tickets(
  p_status   text default null,
  p_priority text default null,
  p_limit    int  default 50,
  p_offset   int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit  int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_prio   text := nullif(trim(coalesce(p_priority, '')), '');
  v_total  int;
  v_result jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  select count(*) into v_total
  from public.tickets t
  where (v_status is null or t.status = v_status)
    and (v_prio   is null or t.priority = v_prio);

  select jsonb_build_object(
    'status','ok',
    'total', v_total,
    'tickets', coalesce(jsonb_agg(row_to_json(x)
                 order by
                   case when x.status in ('open','in_progress') then 0 else 1 end,
                   case x.priority when 'high' then 0 else 1 end,
                   x.sla_due_at asc), '[]'::jsonb)
  )
  into v_result
  from (
    select
      t.id,
      t.user_id,
      t.subject,
      t.status,
      t.priority,
      t.sla_due_at,
      t.plan_code_at_open,
      t.created_at,
      t.updated_at,
      t.resolved_at,
      (t.status in ('open','in_progress') and t.sla_due_at < now()) as sla_breached,
      (select count(*) from public.ticket_messages m where m.ticket_id = t.id) as messages_count,
      (select max(m.created_at) from public.ticket_messages m where m.ticket_id = t.id) as last_message_at,
      p.name  as user_name,
      p.slug  as user_slug,
      u.email as user_email
    from public.tickets t
    left join public.profiles p on p.user_id = t.user_id
    left join auth.users u on u.id = t.user_id
    where (v_status is null or t.status = v_status)
      and (v_prio   is null or t.priority = v_prio)
    order by
      case when t.status in ('open','in_progress') then 0 else 1 end,
      case t.priority when 'high' then 0 else 1 end,
      t.sla_due_at asc
    limit v_limit offset v_offset
  ) x;

  return v_result;
end;
$$;

grant execute on function public.admin_list_support_tickets(text, text, int, int) to authenticated;

drop function if exists public.admin_get_support_ticket(uuid);
create or replace function public.admin_get_support_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket jsonb;
  v_msgs   jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;

  select to_jsonb(x) into v_ticket
  from (
    select
      t.id, t.user_id, t.subject, t.status, t.priority, t.sla_due_at,
      t.plan_code_at_open, t.created_at, t.updated_at, t.resolved_at,
      p.name  as user_name,
      p.slug  as user_slug,
      u.email as user_email
    from public.tickets t
    left join public.profiles p on p.user_id = t.user_id
    left join auth.users u on u.id = t.user_id
    where t.id = p_ticket_id
  ) x;

  if v_ticket is null then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at asc), '[]'::jsonb)
    into v_msgs
  from (
    select id, ticket_id, author_kind, author_id, body, created_at
    from public.ticket_messages
    where ticket_id = p_ticket_id
  ) m;

  return jsonb_build_object('status','ok', 'ticket', v_ticket, 'messages', v_msgs);
end;
$$;

grant execute on function public.admin_get_support_ticket(uuid) to authenticated;

drop function if exists public.admin_reply_support_ticket(uuid, text);
create or replace function public.admin_reply_support_ticket(
  p_ticket_id uuid,
  p_body      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body   text := nullif(trim(coalesce(p_body, '')), '');
  v_exists boolean;
  v_msg_id uuid;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;
  if v_body is null then
    return jsonb_build_object('status','error','error','body_required');
  end if;

  select true into v_exists from public.tickets where id = p_ticket_id;
  if v_exists is null then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  insert into public.ticket_messages (ticket_id, author_id, author_kind, body)
    values (p_ticket_id, auth.uid(), 'admin', v_body)
    returning id into v_msg_id;

  -- Resposta do admin em ticket aberto => "em andamento".
  update public.tickets
    set status = case when status = 'open' then 'in_progress' else status end,
        updated_at = now()
    where id = p_ticket_id;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'support_reply', 'tickets', p_ticket_id::text,
            jsonb_build_object('message_id', v_msg_id));

  return jsonb_build_object('status','ok','message_id', v_msg_id);
end;
$$;

grant execute on function public.admin_reply_support_ticket(uuid, text) to authenticated;

drop function if exists public.admin_update_support_ticket_status(uuid, text);
create or replace function public.admin_update_support_ticket_status(
  p_ticket_id uuid,
  p_status    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if not public.is_admin() then
    return jsonb_build_object('status','error','error','forbidden');
  end if;
  if p_status not in ('open','in_progress','resolved','closed') then
    return jsonb_build_object('status','error','error','invalid_status');
  end if;

  select true into v_exists from public.tickets where id = p_ticket_id;
  if v_exists is null then
    return jsonb_build_object('status','error','error','not_found');
  end if;

  update public.tickets
    set status      = p_status,
        resolved_at = case
                        when p_status in ('resolved','closed') then coalesce(resolved_at, now())
                        when p_status in ('open','in_progress') then null
                      end,
        updated_at  = now()
    where id = p_ticket_id;

  insert into public.admin_audit_log (admin_user_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'support_status', 'tickets', p_ticket_id::text,
            jsonb_build_object('new_status', p_status));

  return jsonb_build_object('status','ok');
end;
$$;

grant execute on function public.admin_update_support_ticket_status(uuid, text) to authenticated;

-- =============================================================
-- 6) GRANTs básicos de tabela
--    (RLS continua governando; aqui só liberamos acesso ao objeto)
-- =============================================================
grant select on public.tickets, public.ticket_messages to authenticated;

-- =============================================================
-- 0041_push_subscriptions.sql
-- -------------------------------------------------------------
-- Web Push (VAPID) pra notificar o profissional quando um
-- cliente marca ou cancela um agendamento pela página pública.
--
-- Peças:
--
--  1. Tabela `push_subscriptions` — guarda endpoint + chaves
--     ECDH enviadas pelo browser quando o user opta por receber.
--     Mantemos `revoked_at` em vez de deletar: entregas que
--     falham com 404/410 marcam a linha; o frontend re-registra
--     se o user quiser reativar.
--
--  2. RPCs `register_push_subscription` / `remove_push_subscription`
--     — gravadas via usuário logado. RLS cuida de restringir o
--     resto; a RPC existe só pra encapsular o upsert.
--
--  3. Trigger `notify_push_appointment` em `appointments`:
--     - INSERT         → event='appointment_created'
--     - UPDATE p/      → event='appointment_cancelled'
--       status=cancelled
--     Chama a Edge Function `send-push` via `pg_net.http_post`.
--     Fire-and-forget: falha de push não derruba o INSERT.
--
--  4. Pulamos o push se `auth.uid()` = `profiles.user_id` do
--     perfil atendido (ex: o próprio pro criando pelo dashboard
--     ou cancelando um agendamento seu). Push é pra ação
--     ORIGINADA do cliente final — não quero spammar o pro com
--     notificação do que ele mesmo fez.
--
--  5. URL da função + service role key vêm do Vault (padrão
--     Supabase pra segredos). Setup pós-deploy no CONTEXT.md.
--     Se o Vault não tiver os segredos, o `http_post` falha
--     silenciosamente — o appointment ainda é criado.
-- =============================================================

create extension if not exists pg_net;

-- =============================================================
-- 1) Tabela
-- =============================================================
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null,
  p256dh        text not null,
  auth_token    text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id)
  where revoked_at is null;

-- =============================================================
-- 2) RLS
-- =============================================================
alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subs_self_select" on public.push_subscriptions;
create policy "push_subs_self_select"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "push_subs_self_delete" on public.push_subscriptions;
create policy "push_subs_self_delete"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());

-- INSERT/UPDATE só via RPC (SECURITY DEFINER). Sem policy =
-- RLS bloqueia, exatamente o que queremos.

-- =============================================================
-- 3) RPC: upsert de subscription (vinda do browser)
-- =============================================================
create or replace function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth_token text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('status','error','error','not_authenticated');
  end if;
  if p_endpoint is null or length(trim(p_endpoint)) = 0
     or p_p256dh is null or length(trim(p_p256dh)) = 0
     or p_auth_token is null or length(trim(p_auth_token)) = 0 then
    return jsonb_build_object('status','error','error','missing_fields');
  end if;

  insert into public.push_subscriptions
    (user_id, endpoint, p256dh, auth_token, user_agent)
  values
    (v_user, p_endpoint, p_p256dh, p_auth_token, p_user_agent)
  on conflict (user_id, endpoint) do update
    set p256dh       = excluded.p256dh,
        auth_token   = excluded.auth_token,
        user_agent   = excluded.user_agent,
        revoked_at   = null;

  return jsonb_build_object('status','ok');
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- =============================================================
-- 4) RPC: remover subscription (hard delete)
-- =============================================================
create or replace function public.remove_push_subscription(
  p_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('status','error','error','not_authenticated');
  end if;

  delete from public.push_subscriptions
   where user_id = v_user and endpoint = p_endpoint;

  return jsonb_build_object('status','ok');
end;
$$;

revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- =============================================================
-- 5) Trigger: dispara edge function em eventos de appointment
-- -------------------------------------------------------------
-- Lê URL + service role key do Vault:
--   select vault.create_secret('edge_send_push_url',  'https://<proj>.supabase.co/functions/v1/send-push');
--   select vault.create_secret('edge_service_role',   '<SERVICE_ROLE_KEY>');
-- Instrução completa no CONTEXT.md § Deploy.
--
-- `net.http_post` é async por natureza (`pg_net` enfileira o
-- request e devolve o id na hora). Perfeito pra fire-and-forget.
-- =============================================================
create or replace function public.notify_push_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user uuid;
  v_event      text;
  v_url        text;
  v_key        text;
begin
  -- Decide o evento. Em UPDATE, só nos interessa transição pra 'cancelled'.
  if tg_op = 'INSERT' then
    v_event := 'appointment_created';
  elsif tg_op = 'UPDATE' then
    if new.status = 'cancelled' and coalesce(old.status, '') <> 'cancelled' then
      v_event := 'appointment_cancelled';
    else
      return new;
    end if;
  else
    return new;
  end if;

  select user_id into v_owner_user
    from public.profiles where id = new.professional_id;

  if v_owner_user is null then
    return new;
  end if;

  -- Pular se o próprio dono do perfil atendido é o caller.
  -- Push é pra ação do CLIENTE externo (book_appointment anon → auth.uid null,
  -- ou outro membro do time → uid diferente).
  if auth.uid() is not null and auth.uid() = v_owner_user then
    return new;
  end if;

  -- Lê segredos do Vault. Se faltar, apenas abandona (função cria
  -- o appointment normal; push é best-effort).
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'edge_send_push_url' limit 1;
    select decrypted_secret into v_key
      from vault.decrypted_secrets where name = 'edge_service_role' limit 1;
  exception when others then
    v_url := null;
    v_key := null;
  end;

  if v_url is null or v_key is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'event',          v_event,
      'user_id',        v_owner_user,
      'appointment_id', new.id
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_push_appointment_ins on public.appointments;
create trigger trg_notify_push_appointment_ins
  after insert on public.appointments
  for each row execute function public.notify_push_appointment();

drop trigger if exists trg_notify_push_appointment_upd on public.appointments;
create trigger trg_notify_push_appointment_upd
  after update of status on public.appointments
  for each row execute function public.notify_push_appointment();

-- =============================================================
-- 6) Grants residuais
-- =============================================================
grant select, delete on public.push_subscriptions to authenticated;

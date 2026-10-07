-- =============================================================
-- 0030_single_session.sql
-- -------------------------------------------------------------
-- Enforce "um usuário logado em UM lugar por vez" (combate roubo
-- de licença / compartilhamento de credencial).
--
-- Mecânica (toda do lado cliente — este arquivo é só o storage):
--   1. Login novo gera um session_id (uuid) local e grava em
--      `user_sessions.session_id`. Antigo valor é sobrescrito.
--   2. Frontend guarda o session_id em `localStorage` (compartilhado
--      entre abas do MESMO device — abas convivem).
--   3. Heartbeat de 60s compara local vs DB. Mismatch = outro device
--      logou e assumiu a sessão → kicka este, mostra modal.
--
-- Por que tabela separada e NÃO coluna em `profiles`:
--   `profiles` tem `profiles_public_select` (anon lê pra renderizar
--   `/p/<slug>`). Expor um identificador de sessão por aí é ruído
--   desnecessário. `user_sessions` é privada: só o dono lê/escreve
--   a própria linha.
-- =============================================================

create table if not exists public.user_sessions (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  session_id  uuid not null,
  updated_at  timestamptz not null default now()
);

drop trigger if exists user_sessions_updated_at on public.user_sessions;
create trigger user_sessions_updated_at
  before update on public.user_sessions
  for each row execute function public.set_updated_at();

alter table public.user_sessions enable row level security;

drop policy if exists "user_sessions_self_select" on public.user_sessions;
drop policy if exists "user_sessions_self_insert" on public.user_sessions;
drop policy if exists "user_sessions_self_update" on public.user_sessions;

create policy "user_sessions_self_select"
  on public.user_sessions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_sessions_self_insert"
  on public.user_sessions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_sessions_self_update"
  on public.user_sessions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.user_sessions to authenticated;

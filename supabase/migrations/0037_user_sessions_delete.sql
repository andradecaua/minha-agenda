-- =============================================================
-- 0037_user_sessions_delete.sql
-- -------------------------------------------------------------
-- Adiciona DELETE à tabela `user_sessions`. A migration 0030 só
-- previu select/insert/update, assumindo que o próximo login iria
-- sobrescrever o session_id anterior via upsert. Isso deixa linha
-- órfã em dois cenários:
--
--   1. Logout explícito — o botão de "Sair" chama
--      `supabase.auth.signOut()`, que revoga o JWT e limpa o
--      localStorage, mas a linha em `user_sessions` persiste até
--      um próximo login. Semanticamente estranho ("logout não
--      deveria apagar o claim?") e vira ruído no DB.
--
--   2. Reset de senha com signOut forçado — fluxo novo (v0.4.2):
--      após `updateUser({password})` chamamos signOut pro usuário
--      autenticar explicitamente com a senha nova. Precisa que o
--      claim antigo saia do DB antes de uma nova sessão nascer.
--
-- Policy self-only no mesmo padrão das outras (user_id = auth.uid()).
-- =============================================================

drop policy if exists "user_sessions_self_delete" on public.user_sessions;

create policy "user_sessions_self_delete"
  on public.user_sessions
  for delete
  to authenticated
  using (user_id = auth.uid());

grant delete on public.user_sessions to authenticated;
